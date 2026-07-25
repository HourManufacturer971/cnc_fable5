'use strict';
// production.js — sidebar economy: build queues, power, placement, sell,
// repair, superweapon timers. Global: Production.

const Production = (function () {

  // 'building' for structures; for units, the factory kind that builds them
  // ('infantry' | 'vehicle' | 'air') — each kind is its own concurrent line
  function categoryOf(key) {
    if (DATA.buildings[key]) return 'building';
    return DATA.units[key].factory;
  }

  function _isHuman(player) { return game && player === game.human; }

  function _ownedFinished(player, type) {
    for (const id of player.buildingIds) {
      const b = game.buildings.get(id);
      if (b && b.type === type && b.buildProgress >= 1) return b;
    }
    return null;
  }

  function _countFinished(player, type) {
    let n = 0;
    for (const id of player.buildingIds) {
      const b = game.buildings.get(id);
      if (b && b.type === type && b.buildProgress >= 1) n++;
    }
    return n;
  }

  // finished factory buildings of a given kind ('infantry'|'vehicle'|'air')
  function _countFactories(player, kind) {
    let n = 0;
    for (const id of player.buildingIds) {
      const b = game.buildings.get(id);
      if (b && b.buildProgress >= 1 && DATA.buildings[b.type].factory === kind) n++;
    }
    return n;
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
    if (!_missionAllows(key)) return false;
    if (d.side && d.side !== baseSide(player.side)) return false;
    // skirmish option: superweapon buildings removed from the game entirely
    if (d.superweapon && game && game._noSupers) return false;
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
    const list = DATA.buildList[baseSide(player.side)];
    const lowPower = _lowPower(player);
    const out = { buildings: [], units: [] };
    for (const strip of ['buildings', 'units']) {
      for (const key of list[strip]) {
        const cat = categoryOf(key);
        const job = player.queues[cat];
        let state = 'idle', frac = 0, eta = 0, count = 0;
        if (cat === 'building' && player.ready.building === key) {
          state = 'ready'; frac = 1;
        } else if (job && job.key === key) {
          state = job.hold ? 'hold' : 'building';
          frac = 1 - job.ticksLeft / job.ticksTotal;
          eta = Math.ceil(job.ticksLeft * (lowPower ? 2 : 1) / C.TPS);
        }
        if (cat !== 'building') {
          count = (job && job.key === key ? 1 : 0) +
            player.unitQueue[cat].filter(k => k === key).length;
        }
        // a broken prereq gates new STARTS but must never hide work already
        // in flight: an invisible job wedges the one-slot building line with
        // no way to cancel it or place the finished structure (lose the Comm
        // Center mid-Adv.-Guard-Tower and construction is dead forever)
        if (state === 'idle' && !count && !prereqOk(player, key)) continue;
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

  // campaign tech gates: an op may carry an `allow` whitelist of building and
  // unit keys — early missions fight with a period-correct toolset (the
  // classic growing tech tree). Applies to EVERY player in the mission, so
  // the AI garrison lives under the same rules as the commander.
  function _missionAllows(key) {
    const m = typeof game !== 'undefined' && game && game.mission;
    return !m || !m.allow || m.allow.includes(key);
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
    // units: one active job per factory kind + a pending queue per kind, so
    // infantry/vehicles/aircraft can all build at once (departure from the
    // original, which shared one line for every unit type)
    const q = player.unitQueue[cat];
    if (player.queues[cat]) {
      if (1 + q.length >= C.QUEUE_MAX) { if (human) AUDIO.play('buzz'); return false; }
      q.push(key);
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
    if (cat !== 'building') {
      // pending copies go first (no money spent on them yet)
      const q = player.unitQueue[cat];
      const i = q.lastIndexOf(key);
      if (i >= 0) {
        q.splice(i, 1);
        if (_isHuman(player)) AUDIO.play('click');
        return;
      }
    }
    const job = player.queues[cat];
    if (!job || job.key !== key) return;
    player.credits += job.spent;
    player.queues[cat] = null;
    if (cat !== 'building') _advanceQueue(player, cat);
    if (_isHuman(player)) AUDIO.eva('cancelled');
  }

  function _advanceQueue(player, cat) {
    const q = player.unitQueue[cat];
    while (q.length && !player.queues[cat]) {
      const next = q.shift();
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
    // the shroud test uses the LOCAL player's fog, so it is pre-validation
    // only: multiplayer command execution (NET.applying, the issuer already
    // checked their own fog) must skip it or the two sims diverge
    if (!player.isAI && !(typeof NET !== 'undefined' && NET.applying) && g.shroud[i] !== 1) return false;
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
    // never let a building sit on one of your refineries' DOCK cells — a
    // sealed dock silently starves the economy (the AI already refuses
    // this via _crowdsRefinery; the player deserves the same guard rail).
    // Likewise a NEW refinery must be born with a usable dock cell.
    for (const id of player.buildingIds) {
      const b = g.buildings.get(id);
      if (!b || b.type !== 'proc') continue;
      const dcx = b.cx + 1, dcy = b.cy + b.h;
      if (dcx >= cx && dcx < cx + d.w && dcy >= cy && dcy < cy + d.h) return false;
    }
    if (key === 'proc') {
      const dcx = cx + 1, dcy = cy + d.h;
      if (!inMap(dcx, dcy) || !terrainPassable(g.terrain[cellIdx(dcx, dcy)])) return false;
      const o = g.occ[cellIdx(dcx, dcy)];
      if (o) { const e = getEnt(o); if (e && e.kind === 'building') return false; }
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
    const list = DATA.buildList[baseSide(player.side)];
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

  // ---- gates: 3-cell spans that slot into a wall run -------------------------

  // orientation follows the walls around the CLICKED cell: wall segments
  // north/south mean the run is vertical, so the gate is too
  function gateOrient(g, cx, cy) {
    const wallAt = (x, y) => {
      if (!inMap(x, y)) return false;
      const o = g.occ[cellIdx(x, y)];
      if (!o) return false;
      const e = getEnt(o);
      return e && e.kind === 'building' && DATA.buildings[e.type].wall;
    };
    return (wallAt(cx, cy - 1) || wallAt(cx, cy + 1)) ? 'v' : 'h';
  }

  // footprint centered on the clicked cell
  function gateFootprint(g, cx, cy) {
    return gateOrient(g, cx, cy) === 'v'
      ? { cx, cy: cy - 1, w: 1, h: 3 }
      : { cx: cx - 1, cy, w: 3, h: 1 };
  }

  function _gateCellOk(g, player, x, y) {
    if (!inMap(x, y)) return false;
    const i = cellIdx(x, y);
    if (!terrainPassable(g.terrain[i]) || g.tib[i] > 0) return false;
    const o = g.occ[i];
    if (o) {
      const e = getEnt(o);
      // own plain wall segments make way for the gate; anything else blocks
      if (!(e && e.kind === 'building' && e.owner === player.side &&
            DATA.buildings[e.type].wall && !DATA.buildings[e.type].gate)) return false;
    }
    if (!player.isAI && !(typeof NET !== 'undefined' && NET.applying) && g.shroud[i] !== 1) return false;
    return true;
  }

  // cx,cy is the clicked CENTER cell
  function canPlaceGate(g, player, cx, cy) {
    const fp = gateFootprint(g, cx, cy);
    for (let k = 0; k < 3; k++) {
      const x = fp.cx + (fp.w === 3 ? k : 0), y = fp.cy + (fp.h === 3 ? k : 0);
      if (!_gateCellOk(g, player, x, y)) return false;
    }
    for (const id of player.buildingIds) {
      const b = g.buildings.get(id);
      if (!b || b.buildProgress < 1) continue;
      if (fp.cx <= b.cx + b.w + C.ADJACENCY && b.cx <= fp.cx + fp.w + C.ADJACENCY &&
          fp.cy <= b.cy + b.h + C.ADJACENCY && b.cy <= fp.cy + fp.h + C.ADJACENCY) return true;
    }
    return false;
  }

  function _placeGate(g, player, key, cell) {
    if (player.ready.building !== key) return 0;
    if (!canPlaceGate(g, player, cell.cx, cell.cy)) {
      if (_isHuman(player)) AUDIO.play('buzz');
      return 0;
    }
    const fp = gateFootprint(g, cell.cx, cell.cy);
    // own wall segments under the frame are absorbed by the gate
    for (let k = 0; k < 3; k++) {
      const x = fp.cx + (fp.w === 3 ? k : 0), y = fp.cy + (fp.h === 3 ? k : 0);
      const o = g.occ[cellIdx(x, y)];
      if (o) {
        const e = getEnt(o);
        if (e && e.kind === 'building') removeBuilding(e);
      }
    }
    const b = makeBuilding(key, player.side, fp.cx, fp.cy);
    b.w = fp.w; b.h = fp.h;
    b.hp = b.maxHp = DATA.buildings[key].hp;
    b.buildProgress = 1;
    addBuilding(b);
    computePower(player);
    player.ready.building = null;
    player.queues.building = null;
    if (_isHuman(player)) AUDIO.play('place');
    return 1;
  }

  // RA2-style wall run: the pre-paid ready segment goes down first, each
  // further segment charges its cost on the spot; placement chains adjacency
  // (a placed wall is a finished building the next segment can hug).
  function placeWallLine(g, player, key, cells) {
    const d = DATA.buildings[key];
    if (!d || !d.wall || !cells.length) return 0;
    if (d.gate) return _placeGate(g, player, key, cells[0]);
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
    // a factory hard against a field would otherwise pop every unit out
    // standing in the crystal: take the first clear ring cell, and only fall
    // back to a crystal one if the building is fully hemmed in
    let dusty = null;
    for (let r = 1; r <= maxR; r++) {
      for (let dy = -r; dy <= h + r - 1; dy++) {
        for (let dx = -r; dx <= w + r - 1; dx++) {
          if (dx > -r && dx < w + r - 1 && dy > -r && dy < h + r - 1) continue;
          const cx = cx0 + dx, cy = cy0 + dy;
          if (!inMap(cx, cy)) continue;
          const i = cellIdx(cx, cy);
          if (!terrainPassable(g.terrain[i]) || g.occ[i]) continue;
          if (g.tib[i] > 0) { if (!dusty) dusty = { cx, cy }; continue; }
          return { cx, cy };
        }
      }
    }
    return dusty;
  }

  function _primaryFactory(g, player, kind) {
    // prefer stored primary, else first alive factory of that kind
    const stored = player.primary[kind];
    if (stored) {
      const b = g.buildings.get(stored);
      if (b && !b._dead && b.buildProgress >= 1) return b;
    }
    const b = _hasFactory(player, kind);
    if (b) player.primary[kind] = b.id;
    return b;
  }

  // player designates `building` as the primary factory of its kind — new
  // units/aircraft spawn there instead of whichever one happened to be found
  // first (the classic "set primary building" convenience)
  function setPrimary(player, building) {
    if (!building || building.owner !== player.side) return false;
    const kind = DATA.buildings[building.type] && DATA.buildings[building.type].factory;
    if (!kind) return false;
    player.primary[kind] = building.id;
    return true;
  }

  function _spawnUnit(g, player, key) {
    const d = DATA.units[key];
    const fac = _primaryFactory(g, player, d.factory);
    if (!fac) return false;

    if (d.factory === 'air') {
      // find an unclaimed pad — the PRIMARY pad gets first claim, so setting
      // a primary helipad genuinely routes new aircraft to it
      const free = b => {
        if (!b || b.type !== 'hpad' || b.buildProgress < 1) return false;
        const claimer = b.claimedBy ? g.units.get(b.claimedBy) : null;
        return !claimer || claimer._dead;
      };
      let pad = free(fac) ? fac : null;
      if (!pad) {
        for (const id of player.buildingIds) {
          const b = g.buildings.get(id);
          if (free(b)) { pad = b; break; }
        }
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
      // Brotherhood airstrip: cargo plane flies across, unit appears at the strip
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
      const rally = fac.rally || _defaultRally(g, player, fac);
      orderMove(u, rally.cx, rally.cy);
    }
    return true;
  }

  // fresh units must not congregate on a refinery dock: a squad parked there
  // starves the whole economy (harvesters can never unload). Only the DEFAULT
  // rally dodges docks — a rally the player set deliberately is respected.
  function _nearOwnDock(g, player, cx, cy) {
    for (const id of player.buildingIds) {
      const b = g.buildings.get(id);
      if (!b || b.type !== 'proc') continue;
      const dx = cx - (b.cx + 1), dy = cy - (b.cy + b.h);
      if (dx * dx + dy * dy <= 2) return true;   // the dock cell or touching it
    }
    return false;
  }

  function _defaultRally(g, player, fac) {
    const base = { cx: fac.cx + ((fac.w / 2) | 0), cy: fac.cy + fac.h + 2 };
    // a factory built beside a field would otherwise muster the whole army
    // standing in the crystal — infantry take damage there and it looks daft.
    // A rally the player set deliberately is still respected.
    const bad = (cx, cy) => _nearOwnDock(g, player, cx, cy) ||
      (inMap(cx, cy) && g.tib[cellIdx(cx, cy)] > 0);
    if (!bad(base.cx, base.cy)) return base;
    for (let r = 1; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const cx = base.cx + dx, cy = base.cy + dy;
          if (!inMap(cx, cy)) continue;
          if (bad(cx, cy)) continue;
          if (!terrainPassable(g.terrain[cellIdx(cx, cy)])) continue;
          // a cell inside a building would make findPath retarget — quite
          // possibly right back onto the dock this dodge exists to avoid
          const o = g.occ[cellIdx(cx, cy)];
          if (o && g.buildings.has(o)) continue;
          return { cx, cy };
        }
      }
    }
    return base;
  }

  // ---- superweapons ----------------------------------------------------------------

  function superReady(player) {
    return !!player.super.key && player.super.timer <= 0;
  }

  function launchSuper(g, player, cx, cy) {
    if (!superReady(player)) return false;
    // fog gate is per-client pre-validation — skipped for lockstep exec
    if (!player.isAI && !(typeof NET !== 'undefined' && NET.applying) &&
        !Fog.isExplored(g, cx, cy)) { AUDIO.play('buzz'); return false; }
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

    // advance queues (low power: half speed). Infantry/vehicle/air each run
    // independently so e.g. a barracks and a war factory build at once; more
    // finished factories of a kind speed that line up (diminishing, capped).
    for (const cat of ['building', 'infantry', 'vehicle', 'air']) {
      const job = player.queues[cat];
      if (!job || job.hold) continue;
      if (lowPower && (g.tick & 1)) continue;
      const mult = cat === 'building' ? 1 : Math.min(2.5, 1 + 0.5 * (_countFactories(player, cat) - 1));
      const drip = (job.total / job.ticksTotal) * mult;
      if (player.credits < drip) {
        if (human && g.tick >= (g.evaCooldowns.insufficientFunds || 0)) {
          // escalating throttle: chronic poverty shouldn't drone every 15s —
          // the nag spaces out (15s, 30s, 60s, 120s) until money flows again
          // (the unload handler resets g._fundsNags on a real delivery)
          const nag = Math.min(g._fundsNags || 0, 3);
          g.evaCooldowns.insufficientFunds = g.tick + 225 * Math.pow(2, nag);
          g._fundsNags = (g._fundsNags || 0) + 1;
          AUDIO.eva('insufficientFunds');
        }
        continue;
      }
      player.credits -= drip;
      job.spent += drip;
      job.ticksLeft -= mult;
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
            player.queues[cat] = null;
            if (human) AUDIO.eva('unitReady');
            _advanceQueue(player, cat);
          } else {
            job.ticksLeft = 0; // retry next tick (spawn blocked / factory died)
            if (!_hasFactory(player, (DATA.units[job.key] || {}).factory)) {
              player.credits += job.spent;
              player.queues[cat] = null;
              _advanceQueue(player, cat);
            }
          }
        }
      }
    }

    // superweapon charge — more Adv. Comm. Centers / Temples of Seth charge
    // the orbital lance / nuke proportionally faster (capped so it can't be
    // instant-fired by spamming the tech building)
    const superKey = baseSide(player.side) === 'udc' ? 'eye' : 'tmpl';
    const superCount = _countFinished(player, superKey);
    if (superCount > 0) {
      const key = DATA.buildings[superKey].superweapon;
      if (player.super.key !== key) {
        player.super = { key, timer: C.SUPER_TICKS[key], max: C.SUPER_TICKS[key] };
      } else if (player.super.timer > 0) {
        player.super.timer = Math.max(0, player.super.timer - Math.min(superCount, 4));
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
    // a new helipad ships with its aircraft (the classic bundle — the pad
    // price includes the first airframe)
    if (d.freeUnitAir) {
      const key = baseSide(player.side) === 'udc' ? 'orca' : 'heli';
      const u = makeUnit(key, player.side, b.cx, b.cy);
      u.x = (b.cx + b.w / 2) * C.CELL;
      u.y = (b.cy + b.h / 2) * C.CELL;
      u.ammo = DATA.units[key].ammo || 0;
      addUnit(u);
      b.claimedBy = u.id;
      u.padId = b.id;
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
    launchSuper, setPrimary, gateFootprint, canPlaceGate,
  };
})();
