'use strict';
// ai.js — skirmish opponent. Drives game.ai purely through public APIs.
// Global: AI.
//
// Shape: a base PLANNER that places buildings by role (power tucked behind the
// conyard, refineries toward the tiberium, defenses arced toward the enemy),
// an ECONOMY loop, and a WAVE machine that gathers each attack at a staging
// point before launching, on a sustained 2.5-4 minute cadence that scales up.

const AI = (function () {
  let ST = null;   // per-AI-side state, keyed by side (multi-AI skirmish)

  // mission difficulty knobs (missions.js): cadence multiplier + wave-size cap.
  // Campaign ops keep the classic 9 unless they say otherwise; open skirmish
  // masses higher so late-game strikes feel like offensives, not patrols.
  function _calm(g) { return (g.mission && g.mission.aiCalm) || 1; }
  function _waveCap(g) {
    if (g.mission && g.mission.aiWaveCap) return g.mission.aiWaveCap;
    if (g.mission && g.mission.n) return 9;
    return 11;
  }
  // elite = top difficulty: crate runs, depot capture, garrisons, expansion,
  // sharper economy, bigger coordinated waves, unit micro
  function _elite(g) { return !!(g.mission && g.mission.aiElite); }
  function _cellDist(ax, ay, bx, by) {
    const dx = ax - bx, dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function init(g) {
    // one state per AI-driven combat side, created in g.sides order so the
    // rng draws stay deterministic (and identical to the old 1v1 sequence)
    ST = {};
    for (const side of g.sides) {
      if (!g.players[side].isAI) continue;
      ST[side] = {
        wave: 0,
        // first strike ~3-4 min at calm 1, scaled by the mission's cadence
        nextWaveAt: Math.round((2700 + ((g.rng() * 900) | 0)) * _calm(g)),
        staging: null,        // {ids:[], target:id, launchAt, cell:{cx,cy}}
        approachAng: 0,       // this wave's attack bearing offset (radians)
        savingFor: null,      // building key the treasury is reserved for
        brokeSince: -1,
        builtHpad: false,
        enemy: null,          // current target side (re-picked on elimination)
        nextSellAt: 0,        // liquidation cooldown (bankrupt economy)
        rushed: false,        // final all-in fired
        wantEng: false,       // depot duty: next infantry slot goes to an engineer
        wantMcv: false,       // expansion duty: next vehicle slot goes to the MCV
        expandAt: 0,          // {cx,cy} the MCV is trekking toward
        expanded: false,
        defGuardAt: null,     // placement hint: guard THIS refinery next
      };
    }
  }

  // ---- enemy selection (FFA) -------------------------------------------------
  function _sideAlive(g, s) {
    const pp = g.players[s];
    return pp.unitIds.length > 0 || pp.buildingIds.some(id => {
      const b = g.buildings.get(id);
      return b && !DATA.buildings[b.type].wall;
    });
  }

  // each AI fights ONE enemy at a time: the nearest living side by start
  // position, kept until eliminated (deterministic — sim state only)
  function _pickEnemy(g, side, st) {
    if (st.enemy && st.enemy !== side && g.sides.includes(st.enemy) &&
        _sideAlive(g, st.enemy)) return st.enemy;
    const my = g.startPos[side] || g.startPos.ai;
    let best = null, bestD = Infinity;
    for (const s of g.sides) {
      if (s === side || !_sideAlive(g, s)) continue;
      const sp = g.startPos[s] || g.startPos.human;
      const d = (sp.cx - my.cx) ** 2 + (sp.cy - my.cy) ** 2;
      if (d < bestD) { bestD = d; best = s; }
    }
    st.enemy = best;
    return best;
  }

  // ---- helpers -----------------------------------------------------------------

  function _conyard(g, p) {
    for (const id of p.buildingIds) {
      const b = g.buildings.get(id);
      if (b && b.type === 'fact' && b.buildProgress >= 1) return b;
    }
    return null;
  }

  // buildings of `type` that exist at any stage, plus queued/ready plans —
  // prevents the planner double-ordering while one is in flight
  function _planned(g, p, type) {
    let n = 0;
    for (const id of p.buildingIds) {
      const b = g.buildings.get(id);
      if (b && b.type === type) n++;
    }
    if (p.queues.building && p.queues.building.key === type) n++;
    if (p.ready.building === type) n++;
    return n;
  }

  function _unitCount(g, p, type) {
    let n = 0;
    for (const id of p.unitIds) {
      const u = g.units.get(id);
      if (u && u.type === type) n++;
    }
    return n;
  }

  function _military(g, p) {
    const out = [];
    for (const id of p.unitIds) {
      const u = g.units.get(id);
      if (!u) continue;
      const d = DATA.units[u.type];
      if (d.harvester || d.deploysTo || d.engineer || !d.weapon) continue;
      out.push(u);
    }
    return out;
  }

  // unit vector from this AI's base toward its current enemy's base
  function _threatDir(g, p, st) {
    const cyd = _conyard(g, p);
    const from = cyd ? { cx: cyd.cx + 1, cy: cyd.cy + 1 }
      : (g.startPos[p.side] || g.startPos.ai);
    const to = (st && st.enemy && g.startPos[st.enemy]) || g.startPos.human;
    const dx = to.cx - from.cx, dy = to.cy - from.cy;
    const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    return { x: dx / len, y: dy / len, from };
  }

  // direction toward the richest nearby tiberium
  function _tibDir(g, p, st) {
    const t = _threatDir(g, p, st);
    let sx = 0, sy = 0, n = 0;
    for (let i = 0; i < g.tib.length; i++) {
      if (g.tib[i] <= 0) continue;
      const cx = i % C.MAP_W, cy = (i / C.MAP_W) | 0;
      const dd = (cx - t.from.cx) ** 2 + (cy - t.from.cy) ** 2;
      if (dd < 400) { sx += cx; sy += cy; n++; }
    }
    if (!n) return { x: -t.x, y: -t.y };
    const dx = sx / n - t.from.cx, dy = sy / n - t.from.cy;
    const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    return { x: dx / len, y: dy / len };
  }

  // ---- placement planner ---------------------------------------------------------

  const ROLE = {
    nuke: 'power', nuk2: 'power',
    proc: 'eco', silo: 'eco',
    gtwr: 'defense', atwr: 'defense', gun: 'defense', obli: 'defense', sam: 'defense',
  }; // everything else: 'core'

  function _defenseSpots(g, p) {
    const spots = [];
    for (const id of p.buildingIds) {
      const b = g.buildings.get(id);
      if (b && DATA.buildings[b.type].defense) spots.push(b);
    }
    return spots;
  }

  // would placing `key` at (cx,cy,w,h) violate a refinery's 1-cell clear
  // ring? Harvesters need that ring free to dock — a hugging power plant can
  // wall the refinery in and starve the economy. Checked in both directions:
  // buildings near an existing refinery, AND a new refinery near existing
  // buildings (the rect test is symmetric: it flags any pair with less than
  // one empty cell between footprints).
  function _crowdsRefinery(g, p, key, cx, cy, w, h) {
    for (const id of p.buildingIds) {
      const b = g.buildings.get(id);
      if (!b) continue;
      if (b.type !== 'proc' && key !== 'proc') continue;
      if (cx <= b.cx + b.w && cx + w - 1 >= b.cx - 1 &&
          cy <= b.cy + b.h && cy + h - 1 >= b.cy - 1) return true;
    }
    return false;
  }

  // pick the best cell for `key` around the conyard, by role
  // every finished conyard (elite AIs expand to a second one)
  function _conyards(g, p) {
    const out = [];
    for (const id of p.buildingIds) {
      const b = g.buildings.get(id);
      if (b && b.type === 'fact' && b.buildProgress >= 1) out.push(b);
    }
    return out;
  }

  function _findSpot(g, p, st, key) {
    const yards = _conyards(g, p);
    if (!yards.length) return null;
    const role = ROLE[key] || 'core';
    // guard hint: a defense ordered for a specific refinery plants beside it
    const hint = role === 'defense' && st.defGuardAt ? st.defGuardAt : null;
    const threat = _threatDir(g, p, st);
    const tib = _tibDir(g, p, st);
    const defs = role === 'defense' ? _defenseSpots(g, p) : null;
    const d = DATA.buildings[key];
    let best = null, bestScore = -Infinity;
    for (const cyd of yards) {
    const acx = hint ? hint.cx : cyd.cx + 1, acy = hint ? hint.cy : cyd.cy + 1;

    for (let dy = -10; dy <= 10; dy++) {
      for (let dx = -10; dx <= 10; dx++) {
        const r = Math.sqrt(dx * dx + dy * dy);
        if (r < 2 || r > 10) continue;
        const cx = acx + dx - ((d.w / 2) | 0), cy = acy + dy - ((d.h / 2) | 0);
        if (!Production.canPlace(g, p, key, cx, cy)) continue;
        if (_crowdsRefinery(g, p, key, cx, cy, d.w, d.h)) continue;
        const nx = dx / r, ny = dy / r;
        let score = g.rng() * 0.6;
        // splash + traffic spacing: one nuke shouldn't gut three packed
        // structures, and a fully hugged base walls its own units in —
        // prefer a clear cell between footprints (ADJACENCY 1 allows it)
        for (const bid of p.buildingIds) {
          const b = g.buildings.get(bid);
          if (!b || DATA.buildings[b.type].wall) continue;
          if (cx <= b.cx + b.w && cx + d.w >= b.cx &&
              cy <= b.cy + b.h && cy + d.h >= b.cy) { score -= 3; break; }
        }
        if (role === 'power') {
          // tucked behind the yard, away from the shooting
          score += (-(nx * threat.x + ny * threat.y)) * 4 - Math.abs(r - 4) * 0.8;
        } else if (role === 'eco') {
          score += (nx * tib.x + ny * tib.y) * 4 - Math.abs(r - 4) * 0.8;
        } else if (role === 'defense') {
          // arc facing the enemy, pushed to the perimeter, spread apart
          score += (nx * threat.x + ny * threat.y) * 5 - Math.abs(r - 7) * 1.2;
          for (const b of defs) {
            const dd = Math.max(Math.abs(b.cx - cx), Math.abs(b.cy - cy));
            if (dd < 3) score -= (3 - dd) * 2.5;
          }
        } else { // core: middle of the base, mildly lateral
          score += -Math.abs(r - 4) - Math.abs(nx * threat.x + ny * threat.y) * 1.2;
        }
        if (hint) score += 6 - Math.abs(r - 3) * 1.5;   // hug the flagged refinery
        if (score > bestScore) { bestScore = score; best = { cx, cy }; }
      }
    }
    if (hint) break;   // hint anchors the search; other yards are irrelevant
    }
    return best;
  }

  // ---- build order -----------------------------------------------------------------

  const DEF_PLAN = {
    udc: ['gtwr', 'gtwr', 'atwr', 'gtwr', 'atwr', 'gtwr', 'atwr', 'atwr', 'gtwr'],
    // SAMs moved late: they are air-ONLY, and with the enemy wing capped at
    // a few gunships an early SAM was a dead slot exactly when the ground
    // waves arrived — the Basilisk now meets those with guns and Spires
    srp: ['gun', 'gun', 'obli', 'gun', 'obli', 'sam', 'obli', 'gun', 'sam'],
  };

  // Strict-priority build goals. The first applicable goal either starts
  // (credits above its bar) or becomes the SAVINGS TARGET (st.savingFor): the
  // unit lines then stop draining credits until it is funded. Without this
  // the three unit lines pin the treasury near zero forever and the base
  // stops developing after the opening build-out.
  function _nextBuilding(g, p, st) {
    st.savingFor = null;
    const side = baseSide(p.side);
    const inf = side === 'udc' ? 'pyle' : 'hand';
    const veh = side === 'udc' ? 'weap' : 'afld';
    const projectedPower = p.power.out - p.power.drain;
    const pick = (key, bar) => {
      // never set a savings bar the treasury cannot physically reach: the
      // balance is capped at p.storage, so an early one-refinery economy
      // (storage 1000) must still be able to fund a 1000+ goal
      bar = Math.min(bar, Math.max(300, p.storage - 200));
      if (p.credits > bar) return key;
      st.savingFor = key;
      return null;
    };

    // a key that failed placement recently is skipped so the goals below it
    // still run — retried when its no-spot cooldown expires
    const blocked = key => st.noSpot && st.noSpot[key] > g.tick;

    if (projectedPower < 30) {
      if (Production.prereqOk(p, 'nuk2') && p.credits > 800 && !blocked('nuk2')) return 'nuk2';
      if (Production.prereqOk(p, 'nuke') && !blocked('nuke')) return 'nuke';
      return null;
    }
    // every goal checks prereqOk: campaign missions may carry an `allow`
    // whitelist, and a goal returning a gated key forever would freeze the
    // whole build queue at that rung
    if (_planned(g, p, 'proc') < 1 && Production.prereqOk(p, 'proc') && !blocked('proc')) return 'proc';
    if (_planned(g, p, inf) < 1 && Production.prereqOk(p, inf) && !blocked(inf)) return inf;
    // vehicle factory before hq/defense: tanks matter more than walls
    if (_planned(g, p, veh) < 1 && Production.prereqOk(p, veh) && !blocked(veh)) return pick(veh, 1200);
    // ...but a base with NO guns at all is an invitation: the first two
    // defenses jump the big-ticket savings queue (which can otherwise starve
    // them out forever while combat losses churn the treasury)
    {
      const defNow = _defenseSpots(g, p).length +
        (p.queues.building && ROLE[p.queues.building.key] === 'defense' ? 1 : 0) +
        (p.ready.building && ROLE[p.ready.building] === 'defense' ? 1 : 0);
      if (defNow < 2 && _planned(g, p, veh) >= 1) {
        const want = DEF_PLAN[side][Math.min(defNow, DEF_PLAN[side].length - 1)];
        if (Production.prereqOk(p, want) && !blocked(want)) return pick(want, 400);
      }
    }
    // second refinery EARLY — the whole midgame stalls on a one-proc economy
    if (_planned(g, p, 'proc') < 2 && Production.prereqOk(p, 'proc') && !blocked('proc')) return pick('proc', 1000);
    if (_planned(g, p, 'hq') < 1 && Production.prereqOk(p, 'hq') && !blocked('hq')) return pick('hq', 900);

    // defense line grows with the war — with the war CLOCK as well as the
    // wave count. Until the superweapon tech building exists the perimeter
    // goal caps at 4, so the ever-rising defense appetite can't starve the
    // nuke/lance out of the build order forever (it used to).
    const tech = side === 'udc' ? 'eye' : 'tmpl';
    const techDone = _planned(g, p, tech) >= 1;
    const defWant = Math.min(2 + Math.floor(st.wave / 2) + Math.floor(g.tick / 4500), 9);
    const defHave = _defenseSpots(g, p).length +
      (p.queues.building && ROLE[p.queues.building.key] === 'defense' ? 1 : 0) +
      (p.ready.building && ROLE[p.ready.building] === 'defense' ? 1 : 0);
    if (defHave < (techDone ? defWant : Math.min(defWant, 4))) {
      const want = DEF_PLAN[side][Math.min(defHave, DEF_PLAN[side].length - 1)];
      if (Production.prereqOk(p, want) && !blocked(want)) return pick(want, 500);
    }
    // elite: refineries are the economy's throat — each gets a close guard
    if (_elite(g)) {
      for (const id of p.buildingIds) {
        const b = g.buildings.get(id);
        if (!b || b.type !== 'proc' || b.buildProgress < 1) continue;
        let guarded = false;
        for (const did of p.buildingIds) {
          const db = g.buildings.get(did);
          if (db && DATA.buildings[db.type].defense &&
              Math.abs(db.cx - b.cx) <= 6 && Math.abs(db.cy - b.cy) <= 6) { guarded = true; break; }
        }
        if (!guarded) {
          const want = side === 'udc' ? 'gtwr' : 'gun';
          if (Production.prereqOk(p, want) && !blocked(want)) {
            st.defGuardAt = { cx: b.cx + 1, cy: b.cy + 1 };
            return pick(want, 600);
          }
        }
      }
    }

    // BOTH war machines run a Repair Facility: wounded armor gets a pad to
    // limp to, and the expansion MCV (prereq 'fix') opens up for either
    // side — this was udc-gated, so the Basilisk never fielded an MCV at all
    if (_planned(g, p, 'fix') < 1 &&
        Production.prereqOk(p, 'fix') && !blocked('fix')) return pick('fix', 1500);
    if (!st.builtHpad && Production.prereqOk(p, 'hpad') && !blocked('hpad')) return pick('hpad', 2000);
    // late-game economy keeps pace with the growing army bill
    if (_planned(g, p, 'proc') < 3 && g.tick > (_elite(g) ? 3800 : 5000) &&
        Production.prereqOk(p, 'proc') && !blocked('proc')) return pick('proc', 1500);
    if (!techDone && Production.prereqOk(p, tech) && g.tick > 6000 && !blocked(tech)) return pick(tech, 2200);
    if (defHave < defWant) {
      const want = DEF_PLAN[side][Math.min(defHave, DEF_PLAN[side].length - 1)];
      if (Production.prereqOk(p, want) && !blocked(want)) return pick(want, 500);
    }
    if (_planned(g, p, 'proc') < 4 && g.tick > (_elite(g) ? 8500 : 12000) &&
        Production.prereqOk(p, 'proc') && !blocked('proc')) return pick('proc', 2500);
    if (p.storage - p.credits < 400 && Production.prereqOk(p, 'silo') &&
        _planned(g, p, 'silo') < 4 && !blocked('silo')) return pick('silo', 500);
    return null;
  }

  // measured, not guessed: the mixes are tuned by AI-vs-AI soak runs
  // (scratchpad balance53) toward an even UDC/Basilisk win rate
  const WEIGHTS = {
    udc: [['e1', 2], ['e2', 2], ['e3', 2], ['jeep', 2], ['mtnk', 4], ['msam', 2], ['htnk', 1], ['orca', 1]],
    srp: [['e1', 3], ['e3', 2], ['e4', 1], ['e5', 1], ['bggy', 2], ['bike', 2], ['ltnk', 6], ['arty', 3], ['ftnk', 3], ['stnk', 1], ['heli', 1]],
  };

  // kind: 'infantry' | 'vehicle' | 'air' — each factory line picks only its
  // own unit types, so the three lines can run concurrently
  function _pickUnit(g, p, kind, st) {
    // elite duties preempt the regular mix: the lines of a rich AI never sit
    // empty, so the engineer/MCV would otherwise wait forever for a free slot
    if (st && kind === 'infantry' && st.wantEng && p.credits > 600 &&
        Production.prereqOk(p, 'e6')) return 'e6';
    if (st && kind === 'vehicle' && st.wantMcv && p.credits > 1500 &&
        Production.prereqOk(p, 'mcv')) return 'mcv';
    if (kind === 'vehicle') {
      // harvester fleet scales with the refineries (and replaces losses
      // eagerly — a starved AI stops doing anything interesting)
      const procs = _planned(g, p, 'proc');
      const harvs = _unitCount(g, p, 'harv');
      // a DEAD economy outranks every credit bar: with zero harvesters the
      // treasury only shrinks, so the first vehicle is always the harvester
      if (procs > 0 && harvs === 0 && Production.prereqOk(p, 'harv')) return 'harv';
      const fleet = _elite(g) ? Math.min(8, procs * 2 + 2) : Math.min(6, procs * 2 + 1);
      if (procs > 0 && harvs < fleet && p.credits > (_elite(g) ? 700 : 900) &&
          Production.prereqOk(p, 'harv')) return 'harv';
    }
    if (kind === 'air') {
      // air is a scalpel, not the army: cap the wing well below the ground
      // force so the factories keep feeding the front line
      let wing = 0;
      for (const id of p.unitIds) {
        const u = g.units.get(id);
        if (u && DATA.units[u.type].air) wing++;
      }
      const ground = _military(g, p).length - wing;
      const cap = Math.max(2, Math.min(_elite(g) ? 5 : 3, (ground / 4) | 0));
      if (wing >= cap) return null;
    }
    const opts = WEIGHTS[baseSide(p.side)].filter(([k]) => DATA.units[k].factory === kind && Production.prereqOk(p, k));
    if (!opts.length) return null;
    let total = 0;
    for (const [, w] of opts) total += w;
    let roll = g.rng() * total;
    for (const [k, w] of opts) {
      roll -= w;
      if (roll <= 0) return k;
    }
    return opts[opts.length - 1][0];
  }

  // ---- targeting ---------------------------------------------------------------------

  function _denseEnemyTarget(g, ep) {
    let best = null, bestScore = -1;
    const hb = [];
    for (const id of ep.buildingIds) {
      const b = g.buildings.get(id);
      if (b && !DATA.buildings[b.type].wall) hb.push(b);
    }
    for (const b of hb) {
      let score = 0;
      for (const o of hb) {
        if (Math.abs(o.cx - b.cx) <= 3 && Math.abs(o.cy - b.cy) <= 3) score++;
      }
      if (score > bestScore) { bestScore = score; best = b; }
    }
    return best;
  }

  function _nearestEnemyTarget(g, ep, from) {
    let best = null, bestD = Infinity;
    for (const id of ep.buildingIds) {
      const b = g.buildings.get(id);
      if (!b || DATA.buildings[b.type].wall) continue;
      const d = dist(from.x, from.y, (b.cx + b.w / 2) * C.CELL, (b.cy + b.h / 2) * C.CELL);
      if (d < bestD) { bestD = d; best = b; }
    }
    if (!best) {
      for (const id of ep.unitIds) {
        const u = g.units.get(id);
        if (!u) continue;
        const d = dist(from.x, from.y, u.x, u.y);
        if (d < bestD) { bestD = d; best = u; }
      }
    }
    return best;
  }

  // aircraft pick PAYING targets — production, tech, harvesters — never the
  // nearest sandbag. Value over distance: a sortie crosses the map for a
  // refinery but not for a silo.
  function _airTarget(g, ep, from, maxCells) {
    const cap = maxCells ? maxCells * C.CELL : Infinity;
    let best = null, bestS = 0;
    for (const id of ep.buildingIds) {
      const b = g.buildings.get(id);
      if (!b || b.buildProgress < 1) continue;
      const bd = DATA.buildings[b.type];
      if (bd.wall || (bd.cost || 0) < 500) continue;   // not worth the fuel
      const d = dist(from.x, from.y, (b.cx + b.w / 2) * C.CELL, (b.cy + b.h / 2) * C.CELL);
      if (d > cap) continue;
      const s = bd.cost / (1 + d / (30 * C.CELL));
      if (s > bestS) { bestS = s; best = b; }
    }
    for (const id of ep.unitIds) {
      const u = g.units.get(id);
      if (!u || u._dead) continue;
      const ud = DATA.units[u.type];
      if (!ud.harvester) continue;   // eco strikes: the classic gunship errand
      const d = dist(from.x, from.y, u.x, u.y);
      if (d > cap) continue;
      const s = (ud.cost || 1100) * 1.2 / (1 + d / (30 * C.CELL));
      if (s > bestS) { bestS = s; best = u; }
    }
    return best;
  }

  // nearest anchor to `at` where an MCV can actually unfold: a conyard-sized
  // footprint of clear, crystal-free, unoccupied ground. Aiming the MCV at
  // the middle of a rich field parks it on crystal where deploy always fails.
  // The ring around the footprint must be mostly open too — the new yard
  // needs elbow room for a refinery and the rest of a working base.
  function _deploySpotNear(g, at, rMax) {
    const d = DATA.buildings.fact;
    const fits = (mcx, mcy) => {
      for (let y = 0; y < d.h; y++) {
        for (let x = 0; x < d.w; x++) {
          const cx = mcx - 1 + x, cy = mcy - 1 + y;
          if (!inMap(cx, cy)) return false;
          const i = cellIdx(cx, cy);
          if (!terrainPassable(g.terrain[i]) || g.tib[i] > 0 || g.occ[i]) return false;
        }
      }
      // elbow room: most of the surrounding ring buildable as well
      let open = 0, ring = 0;
      for (let y = -2; y <= d.h; y++) {
        for (let x = -2; x <= d.w; x++) {
          if (y >= 0 && y < d.h && x >= 0 && x < d.w) continue;   // footprint itself
          const cx = mcx - 1 + x, cy = mcy - 1 + y;
          ring++;
          if (!inMap(cx, cy)) continue;
          const i = cellIdx(cx, cy);
          if (terrainPassable(g.terrain[i]) && g.tib[i] === 0) open++;
        }
      }
      return open >= ring * 0.6;
    };
    for (let r = 0; r <= (rMax || 7); r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (fits(at.cx + dx, at.cy + dy)) return { cx: at.cx + dx, cy: at.cy + dy };
        }
      }
    }
    return null;
  }

  // ---- waves ---------------------------------------------------------------------------

  // per-wave approach bearings (radians off the direct line): the strike
  // masses on a rotated bearing around the HUMAN base, so attacks come in
  // from the front, the flanks, and occasionally near the rear instead of
  // marching down the same lane every time
  const APPROACHES = [0, -0.55, 0.55, -1.1, 1.1, -1.7, 1.7];

  function _stageCell(g, p, st) {
    const t = _threatDir(g, p, st);
    const hs = (st.enemy && g.startPos[st.enemy]) || g.startPos.human;
    // rotate the (target -> us) bearing by this wave's approach angle and
    // stage 13-18 cells out from the target on that bearing
    const back = Math.atan2(t.from.cy - hs.cy, t.from.cx - hs.cx) + (st.approachAng || 0);
    for (let r = 13; r <= 18; r++) {
      const cx = Math.round(hs.cx + Math.cos(back) * r);
      const cy = Math.round(hs.cy + Math.sin(back) * r);
      for (let dr = 0; dr < 4; dr++) {
        for (let dy = -dr; dy <= dr; dy++) {
          for (let dx = -dr; dx <= dr; dx++) {
            if (inMap(cx + dx, cy + dy) && isPassable(cx + dx, cy + dy)) {
              return { cx: cx + dx, cy: cy + dy };
            }
          }
        }
      }
    }
    // fallback: gather on the direct attack route itself, ~14 cells short of
    // the enemy base (any ford or forest choke is crossed BEFORE massing)
    const probe = { x: cellCenterX(t.from.cx), y: cellCenterY(t.from.cy), id: -1, owner: p.side, type: 'ltnk', r: 0.4 };
    const route = findPath(probe, hs.cx, hs.cy);
    if (route && route.length > 20) {
      const c = route[route.length - 14];
      if (c && isPassable(c.cx, c.cy)) return { cx: c.cx, cy: c.cy };
    }
    return t.from;
  }

  function _waves(g, p, st, ep) {
    const cyd = _conyard(g, p);
    const home = g.startPos[p.side] || g.startPos.ai;
    const baseX = cyd ? (cyd.cx + 1) * C.CELL : cellCenterX(home.cx);
    const baseY = cyd ? (cyd.cy + 1) * C.CELL : cellCenterY(home.cy);

    if (st.staging) {
      // reinforcements pour into the muster while it gathers: the wave that
      // finally launches is the whole production run, not just the batch
      // that happened to be idle when the timer fired (the dribble problem)
      if (st.staging.phase === 'gather' && st.staging.ids.length < 16) {
        const sc0 = st.staging.cell;
        const joiners = _military(g, p).filter(u =>
          u.state === 'idle' && !DATA.units[u.type].air && !st.staging.ids.includes(u.id));
        // the two closest to home stay behind as the garrison
        joiners.sort((a, b) =>
          dist(b.x, b.y, baseX, baseY) - dist(a.x, a.y, baseX, baseY));
        for (const u of joiners.slice(0, Math.max(0, joiners.length - 2))) {
          if (st.staging.ids.length >= 16) break;
          st.staging.ids.push(u.id);
          const spots = formationCells(g, sc0.cx, sc0.cy, st.staging.ids.length);
          const s = spots[spots.length - 1];
          orderMove(u, s.cx, s.cy);
        }
      }
      const alive = st.staging.ids.map(id => g.units.get(id)).filter(Boolean);
      if (!alive.length) { st.staging = null; return; }
      const sc = st.staging.cell;
      const near = alive.filter(u =>
        dist(u.x, u.y, cellCenterX(sc.cx), cellCenterY(sc.cy)) < 6 * C.CELL).length;

      if (st.staging.phase === 'gather') {
        // gathered: don't attack yet — advance AS A GROUP to a forward point
        // just outside the enemy base, so the strike lands together instead
        // of trickling in over a minute of travel (the old dribble problem)
        if (near >= alive.length * 0.7 || g.tick >= st.staging.launchAt) {
          let target = getEnt(st.staging.target);
          if (!target || target._dead) target = _nearestEnemyTarget(g, ep, { x: baseX, y: baseY });
          if (!target) { st.staging = null; return; }
          st.staging.target = target.id;
          const hs = (st.enemy && g.startPos[st.enemy]) || g.startPos.human;
          const back = Math.atan2(baseY / C.CELL - hs.cy, baseX / C.CELL - hs.cx) + st.approachAng;
          let fwd = null;
          for (let r = 7; r <= 11 && !fwd; r++) {
            const cx = Math.round(worldToCell(_entXSafe(target)) + Math.cos(back) * r);
            const cy = Math.round(worldToCell(_entYSafe(target)) + Math.sin(back) * r);
            for (let dr = 0; dr < 3 && !fwd; dr++) {
              for (let dy = -dr; dy <= dr && !fwd; dy++) {
                for (let dx = -dr; dx <= dr && !fwd; dx++) {
                  if (inMap(cx + dx, cy + dy) && isPassable(cx + dx, cy + dy)) fwd = { cx: cx + dx, cy: cy + dy };
                }
              }
            }
          }
          if (!fwd) fwd = sc;
          const fSpots = formationCells(g, fwd.cx, fwd.cy, alive.length);
          alive.forEach((u, i) => {
            const s = fSpots[Math.min(i, fSpots.length - 1)];
            orderMove(u, s.cx, s.cy);
          });
          st.staging.phase = 'strike';
          st.staging.cell = fwd;
          st.staging.launchAt = g.tick + 380;
        }
        return;
      }

      // strike phase: once the group has closed up at the forward point (or
      // the leash runs out), everyone sweeps in as an ATTACK-MOVE onto the
      // target — the wave fights through whatever stands in the way instead
      // of tunnel-visioning one building while turrets shoot it in the back
      if (near >= alive.length * 0.6 || g.tick >= st.staging.launchAt) {
        let target = getEnt(st.staging.target);
        if (!target || target._dead) target = _nearestEnemyTarget(g, ep, { x: baseX, y: baseY });
        if (target) {
          const tcx = worldToCell(_entXSafe(target)), tcy = worldToCell(_entYSafe(target));
          for (const u of alive) orderAttackMove(u, tcx, tcy);
        }
        st.staging = null;
        // 2-3.2 min between launches at calm 1
        st.nextWaveAt = g.tick + Math.round((1800 + ((g.rng() * 1100) | 0)) * _calm(g));
      }
      return;
    }

    if (g.tick < st.nextWaveAt) return;
    // gather the strike force: everything idle beyond a small home garrison
    const idle = _military(g, p).filter(u => u.state === 'idle' && !DATA.units[u.type].air);
    const garrison = 2;
    // readiness is measured in VALUE, not headcount: a count bar let the
    // cheap-roster faction launch earlier, lighter waves that broke on the
    // defenses while the expensive roster arrived in real punches — the
    // same credits now buy the same weight of attack for either side
    let idleVal = 0;
    for (const u of idle) idleVal += DATA.units[u.type].cost || 0;
    const needVal = _elite(g)
      ? Math.min(2800 + st.wave * 1200, Math.max(_waveCap(g) * 800, 9000))
      : Math.min(2400 + st.wave * 800, _waveCap(g) * 650);
    if (idle.length <= garrison || idleVal < needVal) {
      st.nextWaveAt = g.tick + 300; // keep producing, check again shortly
      return;
    }
    // garrison keeps the units closest to home. Missions with an explicit
    // wave cap also cap the launched force itself — otherwise a long calm
    // gap accumulates a strike far bigger than the mission intends
    // (skirmish keeps the classic everything-but-the-garrison launch).
    idle.sort((a, b) =>
      dist(b.x, b.y, baseX, baseY) - dist(a.x, a.y, baseX, baseY));
    let launch = idle.length - garrison;
    if (g.mission && g.mission.aiWaveCap) launch = Math.min(launch, g.mission.aiWaveCap);
    const force = idle.slice(0, launch);
    // pick this wave's approach: the first strikes come in near-frontal, the
    // repertoire widens to full flanking sweeps as the war grinds on
    st.approachAng = APPROACHES[(g.rng() * Math.min(APPROACHES.length, 3 + st.wave)) | 0];
    const cell = _stageCell(g, p, st);
    const mSpots = formationCells(g, cell.cx, cell.cy, force.length);
    force.forEach((u, i) => {
      const s = mSpots[Math.min(i, mSpots.length - 1)];
      orderMove(u, s.cx, s.cy);
    });
    const target = _nearestEnemyTarget(g, ep, { x: baseX, y: baseY });
    st.wave++;
    st.staging = {
      ids: force.map(u => u.id),
      target: target ? target.id : 0,
      cell,
      phase: 'gather',
      launchAt: g.tick + 600,  // longer leash: crossing a ford takes time
    };
    // aircraft join the strike directly (they rearm on their own) — but they
    // pick their OWN mark: the highest-value target in reach, not whatever
    // ground building the wave happens to be marching on
    for (const u of _military(g, p)) {
      if (DATA.units[u.type].air && u.state === 'idle') {
        const at = _airTarget(g, ep, u) || target;
        if (at) orderAttack(u, at);
      }
    }
  }

  // what a bankrupt AI can bear to part with, most expendable first. The
  // war machine survives: never the conyard, refinery, factories, or the
  // last power plant.
  const SALE_ORDER = ['silo', 'hpad', 'fix', 'eye', 'tmpl', 'hq', 'sam', 'gtwr', 'gun', 'atwr', 'obli', 'nuk2', 'nuke'];

  // campaign: the mission's objective building is never for sale — a bankrupt
  // garrison cashing out the raid target would end the mission by ledger
  // entry (demolish would auto-win, capture would auto-fail)
  function _saleForbidden(g, b) {
    const ob = g.mission && g.mission.objective;
    if (!ob || (ob.type !== 'demolish' && ob.type !== 'capture')) return false;
    const bt = typeof ob.btype === 'object' ? ob.btype[g.humanSide] : ob.btype;
    return b.type === bt;
  }

  function _pickSale(g, p) {
    let power = 0;
    for (const id of p.buildingIds) {
      const b = g.buildings.get(id);
      if (b && (b.type === 'nuke' || b.type === 'nuk2')) power++;
    }
    for (const type of SALE_ORDER) {
      if ((type === 'nuke' || type === 'nuk2') && power <= 1) continue;
      for (const id of p.buildingIds) {
        const b = g.buildings.get(id);
        if (b && b.type === type && b.buildProgress >= 1 && !_saleForbidden(g, b)) return b;
      }
    }
    return null;
  }

  function _finalRush(g, p, st, ep) {
    if (st.rushed) return;
    st.rushed = true;
    // cash out every structure...
    for (const id of p.buildingIds.slice()) {
      const b = g.buildings.get(id);
      if (b && !b._dead && !_saleForbidden(g, b)) Production.sell(g, p, b);
    }
    // ...and march everything that moves at the enemy
    const tgt = _nearestEnemyTarget(g, ep, { x: p.side && g.startPos[p.side] ? cellCenterX(g.startPos[p.side].cx) : 0, y: p.side && g.startPos[p.side] ? cellCenterY(g.startPos[p.side].cy) : 0 });
    if (!tgt) return;
    const tcx = worldToCell(_entXSafe(tgt)), tcy = worldToCell(_entYSafe(tgt));
    for (const id of p.unitIds.slice()) {
      const u = g.units.get(id);
      if (!u || u._dead) continue;
      const d = DATA.units[u.type];
      if (d.weapon) orderAttackMove(u, tcx, tcy);
      else if (!d.air) orderMove(u, tcx, tcy);
    }
    st.staging = null;
  }

  function _entXSafe(e) { return e.kind === 'unit' ? e.x : (e.cx + e.w / 2) * C.CELL; }
  function _entYSafe(e) { return e.kind === 'unit' ? e.y : (e.cy + e.h / 2) * C.CELL; }

  // ---- main tick -------------------------------------------------------------------------

  function tick(g) {
    if (!ST) init(g);
    // every AI-driven side takes its turn, in canonical g.sides order —
    // in classic 1v1 that is exactly the old single opponent
    for (const side of g.sides) {
      const st = ST[side];
      if (!st) continue;
      const p = g.players[side];
      if (!p.isAI) continue;
      _tickOne(g, p, st);
    }
  }

  function _tickOne(g, p, st) {
    const enemySide = _pickEnemy(g, p.side, st);
    if (!enemySide) return;
    const ep = g.players[enemySide];

    // elite micro runs on its own fast clock — battles turn on seconds
    if (_elite(g) && g.tick % 12 === 5) _microUnits(g, p, ep);

    // defense reaction: intercept intruders near the base (every 15 ticks)
    if (g.tick % 15 === 3) {
      let intruder = null;
      outer:
      for (const s of g.sides) {
        if (s === p.side) continue;
        for (const id of g.players[s].unitIds) {
          const u = g.units.get(id);
          if (!u || u.cloaked) continue;
          for (const bid of p.buildingIds) {
            const b = g.buildings.get(bid);
            if (b && !DATA.buildings[b.type].wall &&
                dist(u.x, u.y, (b.cx + b.w / 2) * C.CELL, (b.cy + b.h / 2) * C.CELL) < 10 * C.CELL) {
              intruder = u;
              break outer;
            }
          }
        }
      }
      if (intruder) {
        for (const u of _military(g, p)) {
          // staging units break off to defend home too
          if ((u.state === 'idle' || (st.staging && st.staging.ids.includes(u.id))) &&
              dist(u.x, u.y, intruder.x, intruder.y) < 20 * C.CELL) {
            orderAttack(u, intruder);
          }
        }
      }
    }

    if (g.tick % 30 !== 7) return; // main cadence

    // bankrupt with no income: LIQUIDATE, honestly. While a way back to an
    // economy exists (conyard, or refinery+factory for a fresh harvester),
    // sell one expendable building at a time and let the refunds fund the
    // war. When nothing can restore an income — or there is nothing left
    // worth selling — sell EVERYTHING and throw the whole army at the
    // enemy. No more quietly going docile in a corner.
    // scripted garrisons hold their ground: a mission may pin the AI in
    // place (aiNoSell) — a listening post does not liquidate itself
    if (!(g.mission && g.mission.aiNoSell) &&
        p.credits < 150 && _unitCount(g, p, 'harv') === 0 && !st.rushed) {
      if (st.brokeSince < 0) st.brokeSince = g.tick;
      const canRebuild = _conyard(g, p) || Production.prereqOk(p, 'harv');
      if (g.tick - st.brokeSince > 450) {
        if (canRebuild && g.tick >= st.nextSellAt) {
          const sale = _pickSale(g, p);
          if (sale) {
            Production.sell(g, p, sale);
            st.nextSellAt = g.tick + 240;
          } else if (g.tick - st.brokeSince > 1200) {
            _finalRush(g, p, st, ep);   // sold the sofa too — all in
          }
        } else if (!canRebuild) {
          _finalRush(g, p, st, ep);
        }
      }
    } else if (_unitCount(g, p, 'harv') > 0 || p.credits >= 150) {
      st.brokeSince = -1;
    }

    const conyard = _conyard(g, p);

    // the yard is the war machine's heart: any damage, repairs go on (the
    // damaged-event auto-repair covers most cases; this catches the rest)
    for (const cyd of _conyards(g, p)) {
      if (cyd.hp < cyd.maxHp && !cyd.repairing) Production.toggleRepair(g, p, cyd);
    }

    // place any ready building by role
    if (p.ready.building && conyard) {
      const key = p.ready.building;
      const spot = _findSpot(g, p, st, key);
      if (spot && Production.place(g, p, key, spot.cx, spot.cy)) {
        if (key === 'hpad') st.builtHpad = true;
        st.defGuardAt = null;
      } else if (!spot) {
        st.defGuardAt = null;
        // no legal spot: refund AND remember — without the cooldown the
        // planner re-picks the same key next tick and the build->cancel
        // livelock freezes every goal below it (tech was the worst case)
        Production.cancel(p, key);
        (st.noSpot || (st.noSpot = {}))[key] = g.tick + 1500;
      }
    }

    // start the next building
    if (conyard && !p.queues.building && !p.ready.building) {
      const want = _nextBuilding(g, p, st);
      if (want) Production.tryStart(p, want);
    }

    // keep every unit line running — infantry/vehicle/air build concurrently.
    // While the planner is saving toward a building, hold NEW unit starts so
    // the treasury can actually climb; harvesters are exempt (an eco stall
    // would defeat the whole point of saving).
    if (p.queues.building || p.ready.building) st.savingFor = null;
    // never save yourself defenseless — UNLESS the economy itself is the
    // casualty: a battered AI that spends every trickle credit on replacement
    // units can never save for the second refinery and starves forever (the
    // poverty trap that decided most one-sided AI battles)
    const ecoWeak = _planned(g, p, 'proc') < 2 || _unitCount(g, p, 'harv') < 2;
    const armyFloor = _military(g, p).length < 9 && !ecoWeak;
    // a dead economy restarts below the normal credit gate: the harvester is
    // the only purchase that ever brings the number back up
    const ecoDead = _unitCount(g, p, 'harv') === 0;
    for (const kind of ['infantry', 'vehicle', 'air']) {
      if (p.queues[kind]) continue;
      if (p.credits <= (kind === 'vehicle' && ecoDead ? 100 : 400)) continue;
      const want = _pickUnit(g, p, kind, st);
      if (!want) continue;
      if (st.savingFor && want !== 'harv' && want !== 'e6' && want !== 'mcv' && !armyFloor) continue;
      Production.tryStart(p, want);
    }

    // superweapon at the current enemy's densest cluster
    if (Production.superReady(p)) {
      const t = _denseEnemyTarget(g, ep);
      if (t) Production.launchSuper(g, p, t.cx + ((t.w / 2) | 0), t.cy + ((t.h / 2) | 0));
    }

    _waves(g, p, st, ep);

    // sustain the push: idle attackers deep in the field re-acquire
    if (g.tick % 90 === 37) {
      const home = g.startPos[p.side] || g.startPos.ai;
      const cydX = conyard ? (conyard.cx + 1) * C.CELL : cellCenterX(home.cx);
      const cydY = conyard ? (conyard.cy + 1) * C.CELL : cellCenterY(home.cy);
      const deep = [];
      for (const u of _military(g, p)) {
        if (u.state !== 'idle' || DATA.units[u.type].air) continue;
        if (st.staging && st.staging.ids.includes(u.id)) continue;
        if (dist(u.x, u.y, cydX, cydY) > 16 * C.CELL) deep.push(u);
      }
      // elite: lone survivors regroup and strike TOGETHER; a single tank
      // trickling into a defended base is a free kill for the turrets
      if (!_elite(g) || deep.length >= 4) {
        for (const u of deep) {
          const t = _nearestEnemyTarget(g, ep, u);
          if (t) orderAttack(u, t);
        }
      } else if (deep.length) {
        for (const u of deep) orderMove(u, worldToCell(cydX), worldToCell(cydY));
      }

      // aircraft never hover over enemy ground: hit something worth the fuel
      // if it's near, otherwise fly home (the rearm logic takes over there)
      const home2 = g.startPos[p.side] || g.startPos.ai;
      for (const id of p.unitIds) {
        const u = g.units.get(id);
        if (!u || !DATA.units[u.type].air || u.state !== 'idle') continue;
        if (_cellDist(worldToCell(u.x), worldToCell(u.y), home2.cx, home2.cy) <= 14) continue;
        const t = u.ammo > 0 ? _airTarget(g, ep, u, 12) : null;
        if (t) orderAttack(u, t);
        else orderMove(u, home2.cx, home2.cy);
      }
    }

    // crate runs at every difficulty: loose salvage near an idle raider is
    // free money/tech — the elite AI ranges much further for it
    if (g.tick % 150 === 7) _crateRuns(g, p, _elite(g) ? 26 : 14);

    if (_elite(g)) _eliteMoves(g, p, st, ep);
  }

  // send the nearest fast idle raider at each crate within `maxCells`
  function _crateRuns(g, p, maxCells) {
    if (!g.crates || !g.crates.length) return;
    for (const c of g.crates) {
      let best = null, bestD = maxCells * maxCells * C.CELL * C.CELL;
      for (const u of _military(g, p)) {
        if (u.state !== 'idle' || DATA.units[u.type].air) continue;
        if (DATA.units[u.type].speed < 2.4) continue;
        const d = (u.x - cellCenterX(c.cx)) ** 2 + (u.y - cellCenterY(c.cy)) ** 2;
        if (d < bestD) { bestD = d; best = u; }
      }
      if (best) orderMove(best, c.cx, c.cy);
    }
  }

  // ---- elite side-quests: crates, depots, garrisons, expansion ---------------

  function _eliteMoves(g, p, st, ep) {
    // (crate runs moved to _crateRuns — every difficulty grabs convenient
    // salvage now; elite just ranges further for it)

    // supply depots: keep an engineer alive and send it at the free money
    if (g.tick % 120 === 37) {
      let depot = null, depotD = Infinity;
      const my = g.startPos[p.side] || g.startPos.ai;
      for (const b of g.buildings.values()) {
        if (b.type !== 'depo' || b.owner !== 'civ') continue;
        const d = (b.cx - my.cx) ** 2 + (b.cy - my.cy) ** 2;
        if (d < depotD) { depotD = d; depot = b; }
      }
      let eng = null;
      for (const id of p.unitIds) {
        const u = g.units.get(id);
        if (u && DATA.units[u.type].engineer) { eng = u; break; }
      }
      if (depot) {
        st.wantEng = !eng;
        if (eng && eng.state === 'idle') orderEnter(eng, depot);
      } else {
        st.wantEng = false;
      }
    }

    // garrisons: riflemen man the village houses on our side of the map.
    // Hard-capped at TWO manned houses — garrison duty must never bleed the
    // field army below wave strength (it did: no waves ever launched)
    if (g.tick % 180 === 67 && _military(g, p).length >= 10) {
      let owned = 0;
      for (const b of g.buildings.values()) {
        if (DATA.buildings[b.type].garrison && b.owner === p.side &&
            (b.garrison || []).length) owned++;
      }
      if (owned < 2) {
        const my = g.startPos[p.side] || g.startPos.ai;
        for (const b of g.buildings.values()) {
          const bd = DATA.buildings[b.type];
          if (!bd.garrison || b.owner !== 'civ') continue;
          if (_cellDist(b.cx, b.cy, my.cx, my.cy) > 24) continue;
          let sent = 0;
          for (const id of p.unitIds) {
            if (sent >= 2) break;
            const u = g.units.get(id);
            if (!u || u.state !== 'idle') continue;
            const ud = DATA.units[u.type];
            if (!ud.infantry || !ud.weapon || ud.engineer) continue;
            if (st.staging && st.staging.ids.includes(u.id)) continue;
            if (orderEnter(u, b)) sent++;
          }
          if (sent) break;   // one house per sweep
        }
      }
    }

    // expansion: a second MCV plants a forward yard by the richest far field.
    // The anchor is a DEPLOYABLE clear pad beside the field (aiming at the
    // field itself parks the MCV on crystal where deploy can never succeed),
    // and the convoy travels with an escort instead of trundling out alone.
    if (!st.expanded && g.tick > 4200 && g.tick % 150 === 97) {
      let mcv = null;
      for (const id of p.unitIds) {
        const u = g.units.get(id);
        if (u && u.type === 'mcv') { mcv = u; break; }
      }
      const yards = _conyards(g, p);
      if (mcv && st.expandAt) {
        // the convoy exists: the vehicle line goes straight back to tanks.
        // (wantMcv used to stay true for the whole trek, so the factory
        // quietly turned out MCV after MCV after MCV.)
        st.wantMcv = false;
        const d = dist(mcv.x, mcv.y, cellCenterX(st.expandAt.cx), cellCenterY(st.expandAt.cy));
        if (d <= C.CELL * 2.5) {
          if (orderDeploy(mcv)) {
            st.expanded = true;
          } else {
            // blocked after all (a unit wandered in, crystal spread): re-anchor
            // on fresh clear ground near the MCV, widening the search each try
            st.expandTries = (st.expandTries || 0) + 1;
            const re = _deploySpotNear(g,
              { cx: worldToCell(mcv.x), cy: worldToCell(mcv.y) }, 3 + st.expandTries * 2);
            if (re) { st.expandAt = re; orderMove(mcv, re.cx, re.cy); }
          }
        } else if (mcv.state === 'idle') {
          orderMove(mcv, st.expandAt.cx, st.expandAt.cy);
          _escortTo(g, p, st, st.expandAt);
        }
      } else if (!mcv && yards.length === 1 && p.credits > 2500 &&
                 Production.prereqOk(p, 'mcv')) {
        // is there a SAFE field worth trekking to — with buildable ground on
        // its far side? Anchor on the end of the field facing away from the
        // enemy, so the new yard grows behind its own crystal moat.
        const field = _richFarField(g, yards[0], st);
        if (field) {
          const es = (st.enemy && g.startPos[st.enemy]) || g.startPos.human;
          let ax = field.cx - es.cx, ay = field.cy - es.cy;
          const al = Math.max(1, Math.sqrt(ax * ax + ay * ay));
          const at = {
            cx: clamp(Math.round(field.cx + ax / al * 4), 2, C.MAP_W - 3),
            cy: clamp(Math.round(field.cy + ay / al * 4), 2, C.MAP_H - 3),
          };
          const spot = _deploySpotNear(g, at, 7);
          if (spot) {
            st.expandAt = spot;
            st.wantMcv = true;      // the vehicle line's next slot builds it
          }
        }
      } else if (mcv) {
        st.wantMcv = false;
      }
    }
  }

  // a few idle guns ride along and hold the ground at the destination —
  // picketing 4 cells out on the threat side, NEVER inside the deploy
  // footprint (an escort parked on the pad blocks the unfold it came to guard)
  function _escortTo(g, p, st, cell) {
    const t = _threatDir(g, p, st);
    const px = clamp(Math.round(cell.cx + t.x * 4), 1, C.MAP_W - 2);
    const py = clamp(Math.round(cell.cy + t.y * 4), 1, C.MAP_H - 2);
    const spots = formationCells(g, px, py, 6);
    let sent = 0;
    for (const u of _military(g, p)) {
      if (sent >= 3) break;
      if (u.state !== 'idle' || DATA.units[u.type].air) continue;
      if (st.staging && st.staging.ids.includes(u.id)) continue;
      const s = spots[Math.min(sent, spots.length - 1)];
      if (Math.abs(s.cx - cell.cx) <= 2 && Math.abs(s.cy - cell.cy) <= 2) continue;
      orderAttackMove(u, s.cx, s.cy);
      sent++;
    }
  }

  // richest tiberium pocket further than 20 cells from the given yard —
  // and a SAFE one: pockets in the enemy's lap are a harvester graveyard,
  // so anything within 25 cells of the current enemy's base is skipped
  function _richFarField(g, cyd, st) {
    const es = (st && st.enemy && g.startPos[st.enemy]) || g.startPos.human;
    let best = null, bestRich = 500;   // must be a REAL field to bother
    for (let cy = 3; cy < C.MAP_H - 3; cy += 3) {
      for (let cx = 3; cx < C.MAP_W - 3; cx += 3) {
        if (_cellDist(cx, cy, cyd.cx, cyd.cy) < 20) continue;
        if (es && _cellDist(cx, cy, es.cx, es.cy) < 25) continue;
        let rich = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (inMap(cx + dx, cy + dy)) rich += g.tib[cellIdx(cx + dx, cy + dy)];
          }
        }
        if (rich > bestRich) { bestRich = rich; best = { cx, cy }; }
      }
    }
    return best;
  }

  // ---- elite micro: focus fire + wounded pullback ----------------------------

  function _microUnits(g, p, ep) {
    for (const u of _military(g, p)) {
      const ud = DATA.units[u.type];
      if (ud.air) continue;
      const w = ud.weapon && DATA.weapons[ud.weapon];
      if (!w) continue;
      // wounded armor breaks off: UDC limps to the repair pad, everyone
      // else falls back home out of the firefight
      if (u.hp < u.maxHp * 0.3 && !ud.infantry && !u._fallback) {
        u._fallback = true;
        let pad = null;
        for (const id of p.buildingIds) {
          const b = g.buildings.get(id);
          if (b && DATA.buildings[b.type].repairPad && b.buildProgress >= 1) { pad = b; break; }
        }
        const to = pad ? { cx: pad.cx + 1, cy: pad.cy + b0h(pad) } :
          (g.startPos[p.side] || g.startPos.ai);
        orderMove(u, to.cx, to.cy);
        continue;
      }
      if (u._fallback && u.hp > u.maxHp * 0.7) u._fallback = false;
      if (u._fallback) continue;
      // focus fire: prefer the weakest enemy UNIT in range over buildings
      // and over healthier targets — kills remove guns from the fight
      if (u.state !== 'attack' && u.state !== 'idle') continue;
      const cur = u.targetId ? getEnt(u.targetId) : null;
      const range = (w.range + 0.4) * C.CELL;
      let alt = null, altHp = Infinity;
      for (const id of ep.unitIds) {
        const e = g.units.get(id);
        if (!e || e._dead) continue;
        if (e.cloaked) continue;
        const ed = DATA.units[e.type];
        if (ed.air && !w.antiAir) continue;
        if (dist(u.x, u.y, e.x, e.y) > range) continue;
        if (e.hp < altHp) { altHp = e.hp; alt = e; }
      }
      if (alt && (!cur || cur.kind === 'building' ||
          (cur.kind === 'unit' && alt.id !== cur.id && alt.hp < cur.hp * 0.55))) {
        orderAttack(u, alt);
      }
    }
  }

  function b0h(b) { return b.h || DATA.buildings[b.type].h; }

  // debug/test hook: read-only peek at a wave machine's internal state.
  // No arg = the classic single opponent (primary enemy of the human).
  function _peek(side) {
    if (!ST) return null;
    return ST[side || (typeof game !== 'undefined' && game ? enemyOf(game.humanSide) : 'srp')] || null;
  }

  return { init, tick, _peek };
})();
