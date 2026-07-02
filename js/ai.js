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

  function init(g) {
    S = {
      wave: 0,
      nextWaveAt: 2700 + ((g.rng() * 900) | 0),   // first strike ~3-4 min
      staging: null,        // {ids:[], target:id, launchAt, cell:{cx,cy}}
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
    gdi: ['gtwr', 'gtwr', 'atwr', 'gtwr', 'atwr', 'atwr'],
    nod: ['gun', 'gun', 'obli', 'sam', 'gun', 'obli'],
  };

  function _nextBuilding(g, p) {
    const side = p.side;
    const inf = side === 'gdi' ? 'pyle' : 'hand';
    const veh = side === 'gdi' ? 'weap' : 'afld';
    const projectedPower = p.power.out - p.power.drain;

    if (projectedPower < 30) {
      if (Production.prereqOk(p, 'nuk2') && p.credits > 800) return 'nuk2';
      if (Production.prereqOk(p, 'nuke')) return 'nuke';
      return null;
    }
    if (_planned(g, p, 'proc') < 1) return 'proc';
    if (_planned(g, p, inf) < 1) return inf;
    if (_planned(g, p, 'proc') < 2 && p.credits > 1800) return 'proc';
    if (_planned(g, p, veh) < 1 && p.credits > 1400) return veh;
    if (_planned(g, p, 'hq') < 1 && p.credits > 1200) return 'hq';

    // defense line grows with the war
    const defWant = Math.min(2 + Math.floor(S.wave / 2) + (g.tick > 9000 ? 1 : 0), 6);
    const defHave = _defenseSpots(g, p).length +
      (p.queues.building && ROLE[p.queues.building.key] === 'defense' ? 1 : 0) +
      (p.ready.building && ROLE[p.ready.building] === 'defense' ? 1 : 0);
    if (defHave < defWant && p.credits > 800) {
      const want = DEF_PLAN[side][Math.min(defHave, DEF_PLAN[side].length - 1)];
      if (Production.prereqOk(p, want)) return want;
    }

    if (side === 'gdi' && _planned(g, p, 'fix') < 1 && p.credits > 2000 &&
        Production.prereqOk(p, 'fix')) return 'fix';
    if (!S.builtHpad && p.credits > 2800 && Production.prereqOk(p, 'hpad')) return 'hpad';
    if (_planned(g, p, 'proc') < 3 && p.credits > 3200 && g.tick > 7000) return 'proc';
    const tech = side === 'gdi' ? 'eye' : 'tmpl';
    if (_planned(g, p, tech) < 1 && p.credits > 3500 && Production.prereqOk(p, tech)) return tech;
    if (p.storage - p.credits < 250 && p.credits > 600 && Production.prereqOk(p, 'silo') &&
        _planned(g, p, 'silo') < 3) return 'silo';
    return null;
  }

  const WEIGHTS = {
    gdi: [['e1', 2], ['e2', 2], ['e3', 2], ['jeep', 2], ['mtnk', 5], ['msam', 2], ['htnk', 2], ['orca', 1]],
    nod: [['e1', 2], ['e3', 2], ['e4', 2], ['bggy', 2], ['bike', 2], ['ltnk', 5], ['arty', 2], ['ftnk', 2], ['stnk', 1], ['heli', 1]],
  };

  function _pickUnit(g, p) {
    const procs = _planned(g, p, 'proc');
    const harvs = _unitCount(g, p, 'harv');
    if (procs > 0 && harvs < Math.min(4, procs * 2) && p.credits > 1400 &&
        Production.prereqOk(p, 'harv')) return 'harv';
    const opts = WEIGHTS[p.side].filter(([k]) => Production.prereqOk(p, k));
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

  function _stageCell(g, p) {
    const t = _threatDir(g, p);
    for (let r = 9; r <= 14; r++) {
      const cx = Math.round(t.from.cx + t.x * r);
      const cy = Math.round(t.from.cy + t.y * r);
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
    return t.from;
  }

  function _waves(g, p) {
    const cyd = _conyard(g, p);
    const baseX = cyd ? (cyd.cx + 1) * C.CELL : cellCenterX(g.startPos.ai.cx);
    const baseY = cyd ? (cyd.cy + 1) * C.CELL : cellCenterY(g.startPos.ai.cy);

    if (S.staging) {
      // launch when most of the force has gathered, or on timeout
      const alive = S.staging.ids.map(id => g.units.get(id)).filter(Boolean);
      if (!alive.length) { S.staging = null; return; }
      const sc = S.staging.cell;
      const near = alive.filter(u =>
        dist(u.x, u.y, cellCenterX(sc.cx), cellCenterY(sc.cy)) < 6 * C.CELL).length;
      if (near >= alive.length * 0.7 || g.tick >= S.staging.launchAt) {
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
        S.nextWaveAt = g.tick + 1800 + ((g.rng() * 1100) | 0); // 2-3.2 min between launches
      }
      return;
    }

    if (g.tick < S.nextWaveAt) return;
    // gather the strike force: everything idle beyond a small home garrison
    const idle = _military(g, p).filter(u => u.state === 'idle' && !DATA.units[u.type].air);
    const garrison = 2;
    const need = Math.min(3 + S.wave, 9);
    if (idle.length - garrison < need) {
      S.nextWaveAt = g.tick + 300; // keep producing, check again shortly
      return;
    }
    // garrison keeps the units closest to home
    idle.sort((a, b) =>
      dist(b.x, b.y, baseX, baseY) - dist(a.x, a.y, baseX, baseY));
    const force = idle.slice(0, idle.length - garrison);
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
      launchAt: g.tick + 450,
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

    // bailout if fully starved with no way back
    if (p.credits < 100 && _unitCount(g, p, 'harv') === 0) {
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
        Production.cancel(p, key); // no legal spot: refund, try something else
      }
    }

    // start the next building
    if (conyard && !p.queues.building && !p.ready.building) {
      const want = _nextBuilding(g, p);
      if (want) Production.tryStart(p, want);
    }

    // keep the unit line running
    if (!p.queues.unit && p.credits > 400) {
      const want = _pickUnit(g, p);
      if (want) Production.tryStart(p, want);
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

  return { init, tick };
})();
