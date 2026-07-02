'use strict';
// production.js — sidebar economy: build queues, power, placement, sell,
// repair, superweapon timers. Global: Production.

const Production = (function () {

  function categoryOf(key) {
    return DATA.buildings[key] ? 'building' : 'unit';
  }

  function _isHuman(player) { return game && player === game.human; }

  function _ownedFinished(player, type) {
    for (const id of player.buildingIds) {
      const b = game.buildings.get(id);
      if (b && b.type === type && b.buildProgress >= 1) return b;
    }
    return null;
  }

  function _hasFactory(player, factoryKind) {
    for (const id of player.buildingIds) {
      const b = game.buildings.get(id);
      if (!b || b.buildProgress < 1) continue;
      if (DATA.buildings[b.type].factory === factoryKind) return b;
    }
    return null;
  }

  function prereqOk(player, key) {
    const d = DATA.buildings[key] || DATA.units[key];
    if (!d) return false;
    if (d.side && d.side !== player.side) return false;
    const prereq = d.prereq || [];
    if (d.prereqAny && prereq.length) {
      let any = false;
      for (const p of prereq) if (_ownedFinished(player, p)) { any = true; break; }
      if (!any) return false;
    } else {
      for (const p of prereq) if (!_ownedFinished(player, p)) return false;
    }
    if (DATA.buildings[key]) {
      if (!_ownedFinished(player, 'fact')) return false;
    } else {
      if (!_hasFactory(player, d.factory)) return false;
    }
    return true;
  }

  function _lowPower(player) {
    return player.power.drain > player.power.out;
  }

  function items(player) {
    const list = DATA.buildList[player.side];
    const lowPower = _lowPower(player);
    const out = { buildings: [], units: [] };
    for (const strip of ['buildings', 'units']) {
      for (const key of list[strip]) {
        if (!prereqOk(player, key)) continue;
        const cat = strip === 'buildings' ? 'building' : 'unit';
        const job = player.queues[cat];
        let state = 'idle', frac = 0, eta = 0, count = 0;
        if (cat === 'building' && player.ready.building === key) {
          state = 'ready'; frac = 1;
        } else if (job && job.key === key) {
          state = job.hold ? 'hold' : 'building';
          frac = 1 - job.ticksLeft / job.ticksTotal;
          eta = Math.ceil(job.ticksLeft * (lowPower ? 2 : 1) / C.TPS);
        }
        if (cat === 'unit') {
          count = (job && job.key === key ? 1 : 0) +
            player.unitQueue.filter(k => k === key).length;
        }
        out[strip].push({ key, state, frac, eta, count });
      }
    }
    if (player.super.key) {
      out.units.push({
        key: player.super.key,
        super: true, // pseudo-item; 'nuke' would otherwise collide with the Power Plant key
        state: player.super.timer <= 0 ? 'ready' : 'charging',
        frac: player.super.max ? 1 - player.super.timer / player.super.max : 0,
      });
    }
    return out;
  }

  function _startJob(player, key) {
    const d = DATA.buildings[key] || DATA.units[key];
    const cat = categoryOf(key);
    const ticksTotal = Math.max(1, Math.ceil(d.cost * C.BUILD_TPC));
    player.queues[cat] = { key, spent: 0, total: d.cost, ticksLeft: ticksTotal, ticksTotal, hold: false };
  }

  function tryStart(player, key) {
    const human = _isHuman(player);
    const cat = categoryOf(key);
    if (!prereqOk(player, key)) { if (human) AUDIO.play('buzz'); return false; }
    if (cat === 'building') {
      if (player.queues.building || player.ready.building) { if (human) AUDIO.play('buzz'); return false; }
      _startJob(player, key);
      if (human) { AUDIO.eva('building'); AUDIO.play('click'); }
      return true;
    }
    // units: one active job + a pending queue (departure from the original)
    if (player.queues.unit) {
      if (1 + player.unitQueue.length >= C.QUEUE_MAX) { if (human) AUDIO.play('buzz'); return false; }
      player.unitQueue.push(key);
      if (human) AUDIO.play('click');
      return true;
    }
    _startJob(player, key);
    if (human) { AUDIO.eva('building'); AUDIO.play('click'); }
    return true;
  }

  function toggleHold(player, key) {
    const cat = categoryOf(key);
    const job = player.queues[cat];
    if (!job || job.key !== key) return;
    job.hold = !job.hold;
    if (_isHuman(player)) AUDIO.eva(job.hold ? 'onHold' : 'building');
  }

  function cancel(player, key) {
    const cat = categoryOf(key);
    if (cat === 'building' && player.ready.building === key) {
      player.ready.building = null;
      player.credits += DATA.buildings[key].cost;
      if (_isHuman(player)) AUDIO.eva('cancelled');
      return;
    }
    if (cat === 'unit') {
      // pending copies go first (no money spent on them yet)
      const i = player.unitQueue.lastIndexOf(key);
      if (i >= 0) {
        player.unitQueue.splice(i, 1);
        if (_isHuman(player)) AUDIO.play('click');
        return;
      }
    }
    const job = player.queues[cat];
    if (!job || job.key !== key) return;
    player.credits += job.spent;
    player.queues[cat] = null;
    if (cat === 'unit') _advanceQueue(player);
    if (_isHuman(player)) AUDIO.eva('cancelled');
  }

  function _advanceQueue(player) {
    while (player.unitQueue.length && !player.queues.unit) {
      const next = player.unitQueue.shift();
      if (prereqOk(player, next)) _startJob(player, next);
    }
  }

  function computePower(player) {
    let out = 0, drain = 0;
    for (const id of player.buildingIds) {
      const b = game.buildings.get(id);
      if (!b || b.buildProgress < 1) continue;
      const d = DATA.buildings[b.type];
      if (d.power) out += d.power * (b.hp / b.maxHp);
      if (d.drain) drain += d.drain;
    }
    player.power = { out: Math.round(out), drain };
    return player.power;
  }

  function _computeStorage(player) {
    let s = 0;
    for (const id of player.buildingIds) {
      const b = game.buildings.get(id);
      if (!b || b.buildProgress < 1) continue;
      s += DATA.buildings[b.type].storage || 0;
    }
    player.storage = s;
  }

  // ---- placement -------------------------------------------------------------

  function cellOk(g, player, cx, cy) {
    if (!inMap(cx, cy)) return false;
    const i = cellIdx(cx, cy);
    if (!terrainPassable(g.terrain[i])) return false;
    if (g.tib[i] > 0) return false;
    if (g.occ[i]) return false;
    if (!player.isAI && g.shroud[i] !== 1) return false;
    return true;
  }

  function canPlace(g, player, key, cx, cy) {
    const d = DATA.buildings[key];
    if (!d) return false;
    let adjacent = false;
    for (let y = 0; y < d.h; y++) {
      for (let x = 0; x < d.w; x++) {
        if (!cellOk(g, player, cx + x, cy + y)) return false;
      }
    }
    for (const id of player.buildingIds) {
      const b = g.buildings.get(id);
      if (!b || b.buildProgress < 1) continue;
      // footprint gap <= C.ADJACENCY cells in both axes?
      if (cx <= b.cx + b.w + C.ADJACENCY && b.cx <= cx + d.w + C.ADJACENCY &&
          cy <= b.cy + b.h + C.ADJACENCY && b.cy <= cy + d.h + C.ADJACENCY) {
        adjacent = true;
        break;
      }
    }
    return adjacent;
  }

  function _visibleSet(player) {
    const list = DATA.buildList[player.side];
    const s = [];
    for (const key of list.buildings.concat(list.units)) {
      if (prereqOk(player, key)) s.push(key);
    }
    return s.join(',');
  }

  function place(g, player, key, cx, cy) {
    if (player.ready.building !== key) return false;
    if (!canPlace(g, player, key, cx, cy)) {
      if (_isHuman(player)) AUDIO.play('buzz');
      return false;
    }
    const b = makeBuilding(key, player.side, cx, cy);
    const d = DATA.buildings[key];
    b.buildProgress = d.wall ? 1 : 0;
    addBuilding(b);
    if (d.wall) { computePower(player); }
    player.ready.building = null;
    player.queues.building = null;
    if (_isHuman(player)) AUDIO.play('place');
    return true;
  }

  // RA2-style wall run: the pre-paid ready segment goes down first, each
  // further segment charges its cost on the spot; placement chains adjacency
  // (a placed wall is a finished building the next segment can hug).
  function placeWallLine(g, player, key, cells) {
    const d = DATA.buildings[key];
    if (!d || !d.wall || !cells.length) return 0;
    let placed = 0;
    for (const cell of cells) {
      if (player.ready.building === key) {
        if (place(g, player, key, cell.cx, cell.cy)) placed++;
      } else {
        if (player.credits < d.cost) break;
        if (!canPlace(g, player, key, cell.cx, cell.cy)) continue;
        player.credits -= d.cost;
        const b = makeBuilding(key, player.side, cell.cx, cell.cy);
        b.buildProgress = 1;
        addBuilding(b);
        placed++;
      }
    }
    if (placed && _isHuman(player)) AUDIO.play('place');
    return placed;
  }

  // ---- sell / repair -----------------------------------------------------------

  function sell(g, player, building) {
    if (!building || building.owner !== player.side || building._dead) return false;
    const d = DATA.buildings[building.type];
    const refund = Math.floor(d.cost * C.SELL_REFUND * (building.hp / building.maxHp));
    player.credits += refund;
    building._dead = true;
    removeBuilding(building);
    spawnEffect('smoke', (building.cx + building.w / 2) * C.CELL, (building.cy + building.h / 2) * C.CELL);
    computePower(player);
    _computeStorage(player);
    if (d.superweapon && player.super.key === d.superweapon) {
      player.super = { key: null, timer: 0, max: 0 };
    }
    if (_isHuman(player)) AUDIO.play('sell');
    return true;
  }

  function toggleRepair(g, player, building) {
    if (!building || building.owner !== player.side || building.buildProgress < 1) return false;
    if (!building.repairing && building.hp >= building.maxHp) return false;
    building.repairing = !building.repairing;
    if (_isHuman(player)) {
      AUDIO.play('repair');
      if (building.repairing) AUDIO.eva('repairing');
    }
    return true;
  }

  // ---- unit spawning -------------------------------------------------------------

  function _freeCellNear(g, cx0, cy0, w, h, maxR) {
    for (let r = 1; r <= maxR; r++) {
      for (let dy = -r; dy <= h + r - 1; dy++) {
        for (let dx = -r; dx <= w + r - 1; dx++) {
          if (dx > -r && dx < w + r - 1 && dy > -r && dy < h + r - 1) continue;
          const cx = cx0 + dx, cy = cy0 + dy;
          if (inMap(cx, cy) && terrainPassable(g.terrain[cellIdx(cx, cy)]) && !g.occ[cellIdx(cx, cy)]) {
            return { cx, cy };
          }
        }
      }
    }
    return null;
  }

  function _primaryFactory(g, player, kind) {
    // prefer stored primary, else first alive factory of that kind
    const stored = kind === 'infantry' ? player.primaryBar : player.primaryWF;
    if (stored) {
      const b = g.buildings.get(stored);
      if (b && !b._dead && b.buildProgress >= 1) return b;
    }
    const b = _hasFactory(player, kind);
    if (b) {
      if (kind === 'infantry') player.primaryBar = b.id;
      else player.primaryWF = b.id;
    }
    return b;
  }

  function _spawnUnit(g, player, key) {
    const d = DATA.units[key];
    const fac = _primaryFactory(g, player, d.factory);
    if (!fac) return false;

    if (d.factory === 'air') {
      // find an unclaimed pad and spawn hovering on it
      let pad = null;
      for (const id of player.buildingIds) {
        const b = g.buildings.get(id);
        if (!b || b.type !== 'hpad' || b.buildProgress < 1) continue;
        const claimer = b.claimedBy ? g.units.get(b.claimedBy) : null;
        if (!claimer || claimer._dead) { pad = b; break; }
      }
      if (!pad) pad = fac;
      const u = makeUnit(key, player.side, pad.cx, pad.cy);
      u.x = (pad.cx + pad.w / 2) * C.CELL;
      u.y = (pad.cy + pad.h / 2) * C.CELL;
      u.ammo = d.ammo || 0;
      addUnit(u);
      if (pad.type === 'hpad') { pad.claimedBy = u.id; u.padId = pad.id; }
      return true;
    }

    if (d.factory === 'vehicle' && fac.type === 'afld') {
      // Nod airstrip: cargo plane flies across, unit appears at the strip
      const y = (fac.cy + 1) * C.CELL;
      spawnEffect('plane', -48, y, { vx: 10, ttl: Math.ceil((C.MAP_W * C.CELL + 96) / 10) });
    }

    const spot = _freeCellNear(g, fac.cx, fac.cy, fac.w, fac.h, 4);
    if (!spot) return false;
    const u = makeUnit(key, player.side, spot.cx, spot.cy);
    addUnit(u);
    if (d.harvester) {
      u.state = 'harvest'; // auto-seek
    } else {
      const rally = fac.rally || { cx: fac.cx + ((fac.w / 2) | 0), cy: fac.cy + fac.h + 2 };
      orderMove(u, rally.cx, rally.cy);
    }
    return true;
  }

  // ---- superweapons ----------------------------------------------------------------

  function superReady(player) {
    return !!player.super.key && player.super.timer <= 0;
  }

  function launchSuper(g, player, cx, cy) {
    if (!superReady(player)) return false;
    if (!player.isAI && !Fog.isExplored(g, cx, cy)) { AUDIO.play('buzz'); return false; }
    if (player.super.key === 'ion') fireIon(g, cx, cy);
    else { fireNuke(g, cx, cy); AUDIO.eva('nukeLaunched'); }
    player.super.timer = player.super.max;
    return true;
  }

  // ---- per-tick ---------------------------------------------------------------------

  function tick(g, player) {
    const human = _isHuman(player);
    computePower(player);
    _computeStorage(player);
    const lowPower = _lowPower(player);

    // radar state
    const hq = _ownedFinished(player, 'hq');
    const radarNow = !!hq && !lowPower;
    if (radarNow !== player.radar) {
      player.radar = radarNow;
      if (human) AUDIO.play(radarNow ? 'radarOn' : 'radarOff');
    }
    if (human && lowPower) _evaOnceLocal(g, 'lowPower', 450);

    // construction animation on placed buildings + finish hooks + repair
    for (const id of player.buildingIds.slice()) {
      const b = g.buildings.get(id);
      if (!b) continue;
      if (b.buildProgress < 1) {
        b.buildProgress = Math.min(1, b.buildProgress + 1 / 25);
        if (b.buildProgress >= 1) _onBuildingFinished(g, player, b);
      } else if (b.repairing) {
        if (b.hp >= b.maxHp) { b.repairing = false; }
        else {
          const d = DATA.buildings[b.type];
          const costPerHp = (d.cost / b.maxHp) * C.REPAIR_COST;
          if (player.credits >= costPerHp) {
            player.credits -= costPerHp;
            b.hp = Math.min(b.maxHp, b.hp + C.REPAIR_HP);
          }
        }
      }
    }

    // advance queues (low power: half speed)
    for (const cat of ['building', 'unit']) {
      const job = player.queues[cat];
      if (!job || job.hold) continue;
      if (lowPower && (g.tick & 1)) continue;
      const drip = job.total / job.ticksTotal;
      if (player.credits < drip) {
        if (human) _evaOnceLocal(g, 'insufficientFunds', 225);
        continue;
      }
      player.credits -= drip;
      job.spent += drip;
      job.ticksLeft--;
      if (job.ticksLeft <= 0) {
        if (cat === 'building') {
          player.ready.building = job.key;
          player.queues.building = null;
          if (human) {
            AUDIO.eva('constructionComplete');
            AUDIO.play('ready');
            _scrollToKey(player, job.key);
          }
        } else {
          if (_spawnUnit(g, player, job.key)) {
            player.queues.unit = null;
            if (human) AUDIO.eva('unitReady');
            _advanceQueue(player);
          } else {
            job.ticksLeft = 0; // retry next tick (spawn blocked / factory died)
            if (!_hasFactory(player, (DATA.units[job.key] || {}).factory)) {
              player.credits += job.spent;
              player.queues.unit = null;
              _advanceQueue(player);
            }
          }
        }
      }
    }

    // superweapon charge
    const superBld = player.side === 'gdi' ? _ownedFinished(player, 'eye') : _ownedFinished(player, 'tmpl');
    if (superBld) {
      const key = DATA.buildings[superBld.type].superweapon;
      if (player.super.key !== key) {
        player.super = { key, timer: C.SUPER_TICKS[key], max: C.SUPER_TICKS[key] };
      } else if (player.super.timer > 0) {
        player.super.timer--;
        if (player.super.timer <= 0 && human) {
          AUDIO.eva(key === 'ion' ? 'ionReady' : 'nukeReady');
        }
      }
    } else if (player.super.key) {
      player.super = { key: null, timer: 0, max: 0 };
    }
  }

  function _evaOnceLocal(g, key, cd) {
    if (g.tick >= (g.evaCooldowns[key] || 0)) {
      g.evaCooldowns[key] = g.tick + cd;
      AUDIO.eva(key);
    }
  }

  function _onBuildingFinished(g, player, b) {
    const d = DATA.buildings[b.type];
    computePower(player);
    _computeStorage(player);
    // free harvester with a new refinery
    if (d.freeUnit) {
      const spot = _freeCellNear(g, b.cx, b.cy, b.w, b.h, 4);
      if (spot) {
        const u = makeUnit(d.freeUnit, player.side, spot.cx, spot.cy);
        addUnit(u);
        u.state = 'harvest';
      }
    }
    // "new construction options" when the tech tree grows
    if (_isHuman(player)) {
      const now = _visibleSet(player);
      if (player._visSet !== undefined && now !== player._visSet && now.length > player._visSet.length) {
        AUDIO.eva('newOptions');
      }
      player._visSet = now;
    }
  }

  // make sure the icon for `key` sits inside the visible strip window
  function _scrollToKey(player, key) {
    const list = items(player);
    const cat = categoryOf(key);
    const arr = cat === 'building' ? list.buildings : list.units;
    const idx = arr.findIndex(i => i.key === key);
    if (idx < 0) return;
    const s = cat === 'building' ? 'b' : 'u';
    const vis = C.STRIP_VISIBLE;
    if (idx < player.scroll[s] || idx >= player.scroll[s] + vis) {
      player.scroll[s] = clamp(idx - ((vis / 2) | 0), 0, Math.max(0, arr.length - vis));
    }
  }

  return {
    tick, tryStart, toggleHold, cancel, items, canPlace, cellOk, place, sell,
    placeWallLine, toggleRepair, computePower, categoryOf, prereqOk, superReady,
    launchSuper,
  };
})();
