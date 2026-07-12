'use strict';
// ai.js — skirmish opponent. Drives game.ai purely through public APIs.
// Global: AI.
//
// Shape: a base PLANNER that places buildings by role (power tucked behind the
// conyard, refineries toward the tiberium, defenses arced toward the enemy),
// an ECONOMY loop, and a WAVE machine that gathers each attack at a staging
// point before launching, on a sustained 2.5-4 minute cadence that scales up.

const AI = (function () {
  let S = null;

  // mission difficulty knobs (missions.js): cadence multiplier + wave-size cap
  function _calm(g) { return (g.mission && g.mission.aiCalm) || 1; }
  function _waveCap(g) { return (g.mission && g.mission.aiWaveCap) || 9; }

  function init(g) {
    S = {
      wave: 0,
      // first strike ~3-4 min at calm 1, scaled by the mission's cadence
      nextWaveAt: Math.round((2700 + ((g.rng() * 900) | 0)) * _calm(g)),
      staging: null,        // {ids:[], target:id, launchAt, cell:{cx,cy}}
      approachAng: 0,       // this wave's attack bearing offset (radians)
      savingFor: null,      // building key the treasury is reserved for
      brokeSince: -1,
      builtHpad: false,
    };
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

  // unit vector from the AI base toward the human base
  function _threatDir(g, p) {
    const cyd = _conyard(g, p);
    const from = cyd ? { cx: cyd.cx + 1, cy: cyd.cy + 1 } : g.startPos.ai;
    const to = g.startPos.human;
    const dx = to.cx - from.cx, dy = to.cy - from.cy;
    const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    return { x: dx / len, y: dy / len, from };
  }

  // direction toward the richest nearby tiberium
  function _tibDir(g, p) {
    const t = _threatDir(g, p);
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
  function _findSpot(g, p, key) {
    const cyd = _conyard(g, p);
    if (!cyd) return null;
    const role = ROLE[key] || 'core';
    const threat = _threatDir(g, p);
    const tib = _tibDir(g, p);
    const defs = role === 'defense' ? _defenseSpots(g, p) : null;
    const d = DATA.buildings[key];
    const acx = cyd.cx + 1, acy = cyd.cy + 1;
    let best = null, bestScore = -Infinity;

    for (let dy = -10; dy <= 10; dy++) {
      for (let dx = -10; dx <= 10; dx++) {
        const r = Math.sqrt(dx * dx + dy * dy);
        if (r < 2 || r > 10) continue;
        const cx = acx + dx - ((d.w / 2) | 0), cy = acy + dy - ((d.h / 2) | 0);
        if (!Production.canPlace(g, p, key, cx, cy)) continue;
        if (_crowdsRefinery(g, p, key, cx, cy, d.w, d.h)) continue;
        const nx = dx / r, ny = dy / r;
        let score = g.rng() * 0.6;
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
        if (score > bestScore) { bestScore = score; best = { cx, cy }; }
      }
    }
    return best;
  }

  // ---- build order -----------------------------------------------------------------

  const DEF_PLAN = {
    gdi: ['gtwr', 'gtwr', 'atwr', 'gtwr', 'atwr', 'gtwr', 'atwr', 'atwr', 'gtwr'],
    nod: ['gun', 'gun', 'obli', 'sam', 'gun', 'obli', 'sam', 'obli', 'gun'],
  };

  // Strict-priority build goals. The first applicable goal either starts
  // (credits above its bar) or becomes the SAVINGS TARGET (S.savingFor): the
  // unit lines then stop draining credits until it is funded. Without this
  // the three unit lines pin the treasury near zero forever and the base
  // stops developing after the opening build-out.
  function _nextBuilding(g, p) {
    S.savingFor = null;
    const side = p.side;
    const inf = side === 'gdi' ? 'pyle' : 'hand';
    const veh = side === 'gdi' ? 'weap' : 'afld';
    const projectedPower = p.power.out - p.power.drain;
    const pick = (key, bar) => {
      // never set a savings bar the treasury cannot physically reach: the
      // balance is capped at p.storage, so an early one-refinery economy
      // (storage 1000) must still be able to fund a 1000+ goal
      bar = Math.min(bar, Math.max(300, p.storage - 200));
      if (p.credits > bar) return key;
      S.savingFor = key;
      return null;
    };

    // a key that failed placement recently is skipped so the goals below it
    // still run — retried when its no-spot cooldown expires
    const blocked = key => S.noSpot && S.noSpot[key] > g.tick;

    if (projectedPower < 30) {
      if (Production.prereqOk(p, 'nuk2') && p.credits > 800 && !blocked('nuk2')) return 'nuk2';
      if (Production.prereqOk(p, 'nuke') && !blocked('nuke')) return 'nuke';
      return null;
    }
    if (_planned(g, p, 'proc') < 1 && !blocked('proc')) return 'proc';
    if (_planned(g, p, inf) < 1 && !blocked(inf)) return inf;
    // vehicle factory before hq/defense: tanks matter more than walls
    if (_planned(g, p, veh) < 1 && !blocked(veh)) return pick(veh, 1200);
    // second refinery EARLY — the whole midgame stalls on a one-proc economy
    if (_planned(g, p, 'proc') < 2 && !blocked('proc')) return pick('proc', 1000);
    if (_planned(g, p, 'hq') < 1 && !blocked('hq')) return pick('hq', 900);

    // defense line grows with the war — with the war CLOCK as well as the
    // wave count. Until the superweapon tech building exists the perimeter
    // goal caps at 4, so the ever-rising defense appetite can't starve the
    // nuke/lance out of the build order forever (it used to).
    const tech = side === 'gdi' ? 'eye' : 'tmpl';
    const techDone = _planned(g, p, tech) >= 1;
    const defWant = Math.min(2 + Math.floor(S.wave / 2) + Math.floor(g.tick / 4500), 9);
    const defHave = _defenseSpots(g, p).length +
      (p.queues.building && ROLE[p.queues.building.key] === 'defense' ? 1 : 0) +
      (p.ready.building && ROLE[p.ready.building] === 'defense' ? 1 : 0);
    if (defHave < (techDone ? defWant : Math.min(defWant, 4))) {
      const want = DEF_PLAN[side][Math.min(defHave, DEF_PLAN[side].length - 1)];
      if (Production.prereqOk(p, want) && !blocked(want)) return pick(want, 500);
    }

    if (side === 'gdi' && _planned(g, p, 'fix') < 1 &&
        Production.prereqOk(p, 'fix') && !blocked('fix')) return pick('fix', 1500);
    if (!S.builtHpad && Production.prereqOk(p, 'hpad') && !blocked('hpad')) return pick('hpad', 2000);
    // late-game economy keeps pace with the growing army bill
    if (_planned(g, p, 'proc') < 3 && g.tick > 5000 && !blocked('proc')) return pick('proc', 1500);
    if (!techDone && Production.prereqOk(p, tech) && g.tick > 6000 && !blocked(tech)) return pick(tech, 2200);
    if (defHave < defWant) {
      const want = DEF_PLAN[side][Math.min(defHave, DEF_PLAN[side].length - 1)];
      if (Production.prereqOk(p, want) && !blocked(want)) return pick(want, 500);
    }
    if (_planned(g, p, 'proc') < 4 && g.tick > 12000 && !blocked('proc')) return pick('proc', 2500);
    if (p.storage - p.credits < 400 && Production.prereqOk(p, 'silo') &&
        _planned(g, p, 'silo') < 4 && !blocked('silo')) return pick('silo', 500);
    return null;
  }

  const WEIGHTS = {
    gdi: [['e1', 2], ['e2', 2], ['e3', 2], ['jeep', 2], ['mtnk', 5], ['msam', 2], ['htnk', 2], ['orca', 1]],
    nod: [['e1', 2], ['e3', 2], ['e4', 2], ['e5', 1], ['bggy', 2], ['bike', 2], ['ltnk', 5], ['arty', 2], ['ftnk', 2], ['stnk', 1], ['heli', 1]],
  };

  // kind: 'infantry' | 'vehicle' | 'air' — each factory line picks only its
  // own unit types, so the three lines can run concurrently
  function _pickUnit(g, p, kind) {
    if (kind === 'vehicle') {
      // harvester fleet scales with the refineries (and replaces losses
      // eagerly — a starved AI stops doing anything interesting)
      const procs = _planned(g, p, 'proc');
      const harvs = _unitCount(g, p, 'harv');
      if (procs > 0 && harvs < Math.min(6, procs * 2 + 1) && p.credits > 900 &&
          Production.prereqOk(p, 'harv')) return 'harv';
    }
    const opts = WEIGHTS[p.side].filter(([k]) => DATA.units[k].factory === kind && Production.prereqOk(p, k));
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

  function _denseHumanTarget(g) {
    let best = null, bestScore = -1;
    const hb = [];
    for (const id of g.human.buildingIds) {
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

  function _nearestHumanTarget(g, from) {
    let best = null, bestD = Infinity;
    for (const id of g.human.buildingIds) {
      const b = g.buildings.get(id);
      if (!b || DATA.buildings[b.type].wall) continue;
      const d = dist(from.x, from.y, (b.cx + b.w / 2) * C.CELL, (b.cy + b.h / 2) * C.CELL);
      if (d < bestD) { bestD = d; best = b; }
    }
    if (!best) {
      for (const id of g.human.unitIds) {
        const u = g.units.get(id);
        if (!u) continue;
        const d = dist(from.x, from.y, u.x, u.y);
        if (d < bestD) { bestD = d; best = u; }
      }
    }
    return best;
  }

  // ---- waves ---------------------------------------------------------------------------

  // per-wave approach bearings (radians off the direct line): the strike
  // masses on a rotated bearing around the HUMAN base, so attacks come in
  // from the front, the flanks, and occasionally near the rear instead of
  // marching down the same lane every time
  const APPROACHES = [0, -0.55, 0.55, -1.1, 1.1, -1.7, 1.7];

  function _stageCell(g, p) {
    const t = _threatDir(g, p);
    const hs = g.startPos.human;
    // rotate the (target -> us) bearing by this wave's approach angle and
    // stage 13-18 cells out from the target on that bearing
    const back = Math.atan2(t.from.cy - hs.cy, t.from.cx - hs.cx) + (S.approachAng || 0);
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

  function _waves(g, p) {
    const cyd = _conyard(g, p);
    const baseX = cyd ? (cyd.cx + 1) * C.CELL : cellCenterX(g.startPos.ai.cx);
    const baseY = cyd ? (cyd.cy + 1) * C.CELL : cellCenterY(g.startPos.ai.cy);

    if (S.staging) {
      const alive = S.staging.ids.map(id => g.units.get(id)).filter(Boolean);
      if (!alive.length) { S.staging = null; return; }
      const sc = S.staging.cell;
      const near = alive.filter(u =>
        dist(u.x, u.y, cellCenterX(sc.cx), cellCenterY(sc.cy)) < 6 * C.CELL).length;

      if (S.staging.phase === 'gather') {
        // gathered: don't attack yet — advance AS A GROUP to a forward point
        // just outside the enemy base, so the strike lands together instead
        // of trickling in over a minute of travel (the old dribble problem)
        if (near >= alive.length * 0.7 || g.tick >= S.staging.launchAt) {
          let target = getEnt(S.staging.target);
          if (!target || target._dead) target = _nearestHumanTarget(g, { x: baseX, y: baseY });
          if (!target) { S.staging = null; return; }
          S.staging.target = target.id;
          const hs = g.startPos.human;
          const back = Math.atan2(baseY / C.CELL - hs.cy, baseX / C.CELL - hs.cx) + S.approachAng;
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
          let i = 0;
          for (const u of alive) {
            const dx = (i % 3) - 1, dy = ((i / 3) | 0) % 3 - 1;
            orderMove(u, clamp(fwd.cx + dx, 0, C.MAP_W - 1), clamp(fwd.cy + dy, 0, C.MAP_H - 1));
            i++;
          }
          S.staging.phase = 'strike';
          S.staging.cell = fwd;
          S.staging.launchAt = g.tick + 380;
        }
        return;
      }

      // strike phase: once the group has closed up at the forward point (or
      // the leash runs out), everyone attacks at once
      if (near >= alive.length * 0.6 || g.tick >= S.staging.launchAt) {
        let target = getEnt(S.staging.target);
        if (!target || target._dead) target = _nearestHumanTarget(g, { x: baseX, y: baseY });
        if (target) {
          for (const u of alive) {
            if (!orderAttack(u, target)) {
              orderMove(u, worldToCell(_entXSafe(target)), worldToCell(_entYSafe(target)));
            }
          }
        }
        S.staging = null;
        // 2-3.2 min between launches at calm 1
        S.nextWaveAt = g.tick + Math.round((1800 + ((g.rng() * 1100) | 0)) * _calm(g));
      }
      return;
    }

    if (g.tick < S.nextWaveAt) return;
    // gather the strike force: everything idle beyond a small home garrison
    const idle = _military(g, p).filter(u => u.state === 'idle' && !DATA.units[u.type].air);
    const garrison = 2;
    const need = Math.min(3 + S.wave, _waveCap(g));
    if (idle.length - garrison < need) {
      S.nextWaveAt = g.tick + 300; // keep producing, check again shortly
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
    S.approachAng = APPROACHES[(g.rng() * Math.min(APPROACHES.length, 3 + S.wave)) | 0];
    const cell = _stageCell(g, p);
    let i = 0;
    for (const u of force) {
      const dx = (i % 3) - 1, dy = ((i / 3) | 0) % 3 - 1;
      orderMove(u, clamp(cell.cx + dx, 0, C.MAP_W - 1), clamp(cell.cy + dy, 0, C.MAP_H - 1));
      i++;
    }
    const target = _nearestHumanTarget(g, { x: baseX, y: baseY });
    S.wave++;
    S.staging = {
      ids: force.map(u => u.id),
      target: target ? target.id : 0,
      cell,
      phase: 'gather',
      launchAt: g.tick + 600,  // longer leash: crossing a ford takes time
    };
    // aircraft join the strike directly (they rearm on their own)
    for (const u of _military(g, p)) {
      if (DATA.units[u.type].air && u.state === 'idle' && target) orderAttack(u, target);
    }
  }

  function _entXSafe(e) { return e.kind === 'unit' ? e.x : (e.cx + e.w / 2) * C.CELL; }
  function _entYSafe(e) { return e.kind === 'unit' ? e.y : (e.cy + e.h / 2) * C.CELL; }

  // ---- main tick -------------------------------------------------------------------------

  function tick(g) {
    if (!S) init(g);
    const p = g.ai;

    // defense reaction: intercept intruders near the base (every 15 ticks)
    if (g.tick % 15 === 3) {
      let intruder = null;
      for (const id of g.human.unitIds) {
        const u = g.units.get(id);
        if (!u || u.cloaked) continue;
        for (const bid of p.buildingIds) {
          const b = g.buildings.get(bid);
          if (b && !DATA.buildings[b.type].wall &&
              dist(u.x, u.y, (b.cx + b.w / 2) * C.CELL, (b.cy + b.h / 2) * C.CELL) < 10 * C.CELL) {
            intruder = u;
            break;
          }
        }
        if (intruder) break;
      }
      if (intruder) {
        for (const u of _military(g, p)) {
          // staging units break off to defend home too
          if ((u.state === 'idle' || (S.staging && S.staging.ids.includes(u.id))) &&
              dist(u.x, u.y, intruder.x, intruder.y) < 20 * C.CELL) {
            orderAttack(u, intruder);
          }
        }
      }
    }

    if (g.tick % 30 !== 7) return; // main cadence

    // bailout if fully starved with no way back — but only while the AI can
    // still actually restore an INCOME: a conyard rebuilds anything, and
    // prereqOk('harv') means refinery + vehicle factory both stand so the
    // money can buy a harvester. A bare surviving refinery (no factory, no
    // conyard) has no path back to an economy — funding it would drip-feed
    // infantry forever and drag the endgame out.
    if (p.credits < 100 && _unitCount(g, p, 'harv') === 0 &&
        (_conyard(g, p) || Production.prereqOk(p, 'harv'))) {
      if (S.brokeSince < 0) S.brokeSince = g.tick;
      else if (g.tick - S.brokeSince > 900) { p.credits += 2000; S.brokeSince = -1; }
    } else S.brokeSince = -1;

    const conyard = _conyard(g, p);

    // place any ready building by role
    if (p.ready.building && conyard) {
      const key = p.ready.building;
      const spot = _findSpot(g, p, key);
      if (spot && Production.place(g, p, key, spot.cx, spot.cy)) {
        if (key === 'hpad') S.builtHpad = true;
      } else if (!spot) {
        // no legal spot: refund AND remember — without the cooldown the
        // planner re-picks the same key next tick and the build->cancel
        // livelock freezes every goal below it (tech was the worst case)
        Production.cancel(p, key);
        (S.noSpot || (S.noSpot = {}))[key] = g.tick + 1500;
      }
    }

    // start the next building
    if (conyard && !p.queues.building && !p.ready.building) {
      const want = _nextBuilding(g, p);
      if (want) Production.tryStart(p, want);
    }

    // keep every unit line running — infantry/vehicle/air build concurrently.
    // While the planner is saving toward a building, hold NEW unit starts so
    // the treasury can actually climb; harvesters are exempt (an eco stall
    // would defeat the whole point of saving).
    if (p.queues.building || p.ready.building) S.savingFor = null;
    const armyFloor = _military(g, p).length < 9;   // never save yourself defenseless
    for (const kind of ['infantry', 'vehicle', 'air']) {
      if (p.queues[kind] || p.credits <= 400) continue;
      const want = _pickUnit(g, p, kind);
      if (!want) continue;
      if (S.savingFor && want !== 'harv' && !armyFloor) continue;
      Production.tryStart(p, want);
    }

    // superweapon at the densest human cluster
    if (Production.superReady(p)) {
      const t = _denseHumanTarget(g);
      if (t) Production.launchSuper(g, p, t.cx + ((t.w / 2) | 0), t.cy + ((t.h / 2) | 0));
    }

    _waves(g, p);

    // sustain the push: idle attackers deep in the field re-acquire
    if (g.tick % 90 === 37) {
      const cydX = conyard ? (conyard.cx + 1) * C.CELL : cellCenterX(g.startPos.ai.cx);
      const cydY = conyard ? (conyard.cy + 1) * C.CELL : cellCenterY(g.startPos.ai.cy);
      for (const u of _military(g, p)) {
        if (u.state !== 'idle' || DATA.units[u.type].air) continue;
        if (S.staging && S.staging.ids.includes(u.id)) continue;
        if (dist(u.x, u.y, cydX, cydY) > 16 * C.CELL) {
          const t = _nearestHumanTarget(g, u);
          if (t) orderAttack(u, t);
        }
      }
    }
  }

  // debug/test hook: read-only peek at the wave machine's internal state
  function _peek() { return S; }

  return { init, tick, _peek };
})();
