'use strict';
// ai.js — skirmish opponent. Drives game.ai purely through public APIs.
// Global: AI.

const AI = (function () {
  let S = null; // per-game state

  function init(g) {
    S = {
      waveAt: 2700,             // first attack ~3 minutes in
      waveEvery: 2200,
      brokeSince: -1,
      builtFix: false,
      builtHpad: false,
      defenses: 0,
    };
  }

  function _player(g) { return g.ai; }

  function _conyard(g, p) {
    for (const id of p.buildingIds) {
      const b = g.buildings.get(id);
      if (b && b.type === 'fact' && b.buildProgress >= 1) return b;
    }
    return null;
  }

  function _count(g, p, type, finishedOnly) {
    let n = 0;
    for (const id of p.buildingIds) {
      const b = g.buildings.get(id);
      if (b && b.type === type && (!finishedOnly || b.buildProgress >= 1)) n++;
    }
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

  // spiral-search a placement spot around an anchor building
  function _findSpot(g, p, key, anchor, biasDir) {
    const d = DATA.buildings[key];
    const acx = anchor.cx + ((anchor.w / 2) | 0);
    const acy = anchor.cy + ((anchor.h / 2) | 0);
    let best = null, bestScore = -Infinity;
    for (let r = 2; r <= 14; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const cx = acx + dx - ((d.w / 2) | 0), cy = acy + dy - ((d.h / 2) | 0);
          if (!Production.canPlace(g, p, key, cx, cy)) continue;
          let score = -r + g.rng() * 0.5;
          if (biasDir) score += (dx * biasDir.x + dy * biasDir.y) / r * 3;
          if (score > bestScore) { bestScore = score; best = { cx, cy }; }
        }
      }
      if (best && bestScore > -r + 2) break; // good enough at this ring
    }
    return best;
  }

  function _biasTowardHuman(g, p) {
    const cy2 = _conyard(g, p);
    if (!cy2 || !g.startPos) return null;
    const hx = g.startPos.human.cx, hy = g.startPos.human.cy;
    const dx = hx - cy2.cx, dy = hy - cy2.cy;
    const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    return { x: dx / len, y: dy / len };
  }

  // what building does the AI want next? returns a key or null
  function _nextBuilding(g, p) {
    const side = p.side;
    const inf = side === 'gdi' ? 'pyle' : 'hand';
    const veh = side === 'gdi' ? 'weap' : 'afld';
    const powerShort = p.power.out - p.power.drain < 30;

    if (powerShort) {
      if (Production.prereqOk(p, 'nuk2') && p.credits > 900) return 'nuk2';
      if (Production.prereqOk(p, 'nuke')) return 'nuke';
      return null;
    }
    if (_count(g, p, 'proc') < 1) return 'proc';
    if (_count(g, p, inf) < 1) return inf;
    if (_count(g, p, veh) < 1 && p.credits > 1200) return veh;
    if (_count(g, p, 'proc') < 2 && p.credits > 2200) return 'proc';
    if (_count(g, p, 'hq') < 1 && p.credits > 1400) return 'hq';
    // defenses
    const defPlan = side === 'gdi' ? ['gtwr', 'gtwr', 'atwr', 'atwr'] : ['gun', 'gun', 'sam', 'obli'];
    if (S.defenses < defPlan.length && p.credits > 1000) {
      const want = defPlan[S.defenses];
      if (Production.prereqOk(p, want)) return want;
    }
    if (side === 'gdi' && !S.builtFix && p.credits > 2000 && Production.prereqOk(p, 'fix')) return 'fix';
    if (!S.builtHpad && p.credits > 2800 && Production.prereqOk(p, 'hpad')) return 'hpad';
    if (_count(g, p, 'proc') < 3 && p.credits > 3200) return 'proc';
    const tech = side === 'gdi' ? 'eye' : 'tmpl';
    if (_count(g, p, tech) < 1 && p.credits > 3500 && Production.prereqOk(p, tech)) return tech;
    if (p.credits > 500 && p.storage - p.credits < 200 && Production.prereqOk(p, 'silo')) return 'silo';
    return null;
  }

  const WEIGHTS = {
    gdi: [['e1', 2], ['e2', 2], ['e3', 2], ['jeep', 2], ['mtnk', 5], ['msam', 2], ['htnk', 2], ['orca', 1]],
    nod: [['e1', 2], ['e3', 2], ['e4', 2], ['bggy', 2], ['bike', 2], ['ltnk', 5], ['arty', 2], ['ftnk', 2], ['stnk', 1], ['heli', 1]],
  };

  function _pickUnit(g, p) {
    // keep harvesters topped up first
    const procs = _count(g, p, 'proc', true);
    const harvs = _unitCount(g, p, 'harv');
    if (procs > 0 && harvs < Math.min(4, procs * 2) && p.credits > 1400 && Production.prereqOk(p, 'harv')) {
      return 'harv';
    }
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

  function _denseHumanTarget(g) {
    // human building with the most neighbors within 3 cells
    let best = null, bestScore = -1;
    const hb = [];
    for (const id of g.human.buildingIds) {
      const b = g.buildings.get(id);
      if (b) hb.push(b);
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
      if (!b) continue;
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

  function tick(g) {
    if (!S) init(g);
    const p = _player(g);

    // --- defense reaction (every 15 ticks) ---
    if (g.tick % 15 === 3) {
      let intruder = null;
      for (const id of g.human.unitIds) {
        const u = g.units.get(id);
        if (!u || u.cloaked) continue;
        for (const bid of p.buildingIds) {
          const b = g.buildings.get(bid);
          if (b && dist(u.x, u.y, (b.cx + b.w / 2) * C.CELL, (b.cy + b.h / 2) * C.CELL) < 10 * C.CELL) {
            intruder = u;
            break;
          }
        }
        if (intruder) break;
      }
      if (intruder) {
        for (const u of _military(g, p)) {
          if (u.state === 'idle' && dist(u.x, u.y, intruder.x, intruder.y) < 20 * C.CELL) {
            orderAttack(u, intruder);
          }
        }
      }
    }

    if (g.tick % 30 !== 7) return; // main cadence

    // --- bailout if starved ---
    if (p.credits < 100 && _unitCount(g, p, 'harv') === 0) {
      if (S.brokeSince < 0) S.brokeSince = g.tick;
      else if (g.tick - S.brokeSince > 900) { p.credits += 2000; S.brokeSince = -1; }
    } else S.brokeSince = -1;

    const conyard = _conyard(g, p);

    // --- place any ready building ---
    if (p.ready.building && conyard) {
      const key = p.ready.building;
      const d = DATA.buildings[key];
      const isDefense = !!d.weapon;
      const bias = isDefense ? _biasTowardHuman(g, p) : null;
      const spot = _findSpot(g, p, key, conyard, bias);
      if (spot && Production.place(g, p, key, spot.cx, spot.cy)) {
        if (isDefense) S.defenses++;
        if (key === 'fix') S.builtFix = true;
        if (key === 'hpad') S.builtHpad = true;
      } else if (!spot) {
        Production.cancel(p, key); // hopeless spot; refund and move on
      }
    }

    // --- start next building ---
    if (conyard && !p.queues.building && !p.ready.building) {
      const want = _nextBuilding(g, p);
      if (want) Production.tryStart(p, want);
    }

    // --- keep unit production busy ---
    if (!p.queues.unit && p.credits > 600) {
      const want = _pickUnit(g, p);
      if (want) Production.tryStart(p, want);
    }

    // --- repair damaged buildings ---
    if (p.credits > 300) {
      for (const id of p.buildingIds) {
        const b = g.buildings.get(id);
        if (b && b.buildProgress >= 1 && !b.repairing && b.hp < b.maxHp * 0.6) {
          Production.toggleRepair(g, p, b);
        }
      }
    }

    // --- superweapon ---
    if (Production.superReady(p)) {
      const t = _denseHumanTarget(g);
      if (t) Production.launchSuper(g, p, t.cx + ((t.w / 2) | 0), t.cy + ((t.h / 2) | 0));
    }

    // --- attack waves ---
    if (g.tick >= S.waveAt) {
      const idle = _military(g, p).filter(u => u.state === 'idle');
      if (idle.length >= 4) {
        S.waveAt = g.tick + S.waveEvery;
        for (const u of idle) {
          const t = _nearestHumanTarget(g, u);
          if (t) orderAttack(u, t);
        }
      } else {
        S.waveAt = g.tick + 300; // not enough force yet, check again soon
      }
    }
  }

  return { init, tick };
})();
