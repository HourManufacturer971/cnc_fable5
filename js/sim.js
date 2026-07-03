'use strict';
// sim.js — the core simulation: movement, combat, bullets, harvesting,
// tiberium, cloaking, aircraft, superweapon strikes, death.
// Globals: Sim, orderMove, orderAttack, orderHarvest, orderDeploy, orderEnter,
// stopUnit, killEntity, fireIon, fireNuke, spawnEffect, spawnBullet.

// ---- small helpers ----------------------------------------------------------

function _entX(e) { return e.kind === 'unit' ? e.x : (e.cx + e.w / 2) * C.CELL; }
function _entY(e) { return e.kind === 'unit' ? e.y : (e.cy + e.h / 2) * C.CELL; }
function _data(e) { return e.kind === 'unit' ? DATA.units[e.type] : DATA.buildings[e.type]; }
function _isAir(e) { return e.kind === 'unit' && !!DATA.units[e.type].air; }

// distance from a point to an entity, buildings measured to footprint edge
function _distTo(x, y, e) {
  if (e.kind === 'unit') return dist(x, y, e.x, e.y);
  const x0 = e.cx * C.CELL, y0 = e.cy * C.CELL;
  const x1 = x0 + e.w * C.CELL, y1 = y0 + e.h * C.CELL;
  const dx = Math.max(x0 - x, 0, x - x1), dy = Math.max(y0 - y, 0, y - y1);
  return Math.sqrt(dx * dx + dy * dy);
}

function _evaOnce(key, cooldownTicks) {
  const g = game;
  if (g.tick >= (g.evaCooldowns[key] || 0)) {
    g.evaCooldowns[key] = g.tick + cooldownTicks;
    AUDIO.eva(key);
  }
}

// play a positional sound only if the human could plausibly hear it
function _maybePlay(name, x, y) {
  if (x === undefined) { AUDIO.play(name); return; }
  const g = game;
  const cx = worldToCell(x), cy = worldToCell(y);
  if (!Fog.isExplored(g, cx, cy)) return;
  const m = 6 * C.CELL;
  if (x >= g.camera.x - m && x <= g.camera.x + C.VIEW_W + m &&
      y >= g.camera.y - m && y <= g.camera.y + C.VIEW_H + m) AUDIO.play(name);
}

function _canTarget(w, target) {
  if (!w) return false;
  if (_isAir(target)) return !!w.antiAir;
  return !w.airOnly;
}

function _pickWeapon(u, target) {
  const d = DATA.units[u.type];
  if (d.weapon2 && target &&
      ((target.kind === 'unit' && (DATA.units[target.type].infantry || _isAir(target))))) {
    return Object.assign({ key: d.weapon2 }, DATA.weapons[d.weapon2]);
  }
  return d.weapon ? Object.assign({ key: d.weapon }, DATA.weapons[d.weapon]) : null;
}

function _nearestEnemy(e, rangeCells, opts) {
  opts = opts || {};
  const g = game;
  const ex = _entX(e), ey = _entY(e);
  const maxD = rangeCells * C.CELL;
  let best = null, bestD = Infinity;
  for (const u of g.units.values()) {
    if (u.owner === e.owner || u._dead) continue;
    // nobody auto-guns bystanders — except tiberium creatures, which
    // terrorise the village like everything else (explicit orders still work)
    if (u.owner === 'civ' && e.owner !== 'mut') continue;
    if (u.cloaked && !opts.seeCloaked) continue;
    if (_isAir(u) && !opts.antiAir) continue;
    if (opts.airOnly && !_isAir(u)) continue;
    const d = dist(ex, ey, u.x, u.y);
    if (d <= maxD && d < bestD) { bestD = d; best = u; }
  }
  if (!opts.airOnly && !opts.unitsOnly) {
    for (const b of g.buildings.values()) {
      if (b.owner === e.owner || b._dead) continue;
      if (b.owner === 'civ' && e.owner !== 'mut') continue;
      if (DATA.buildings[b.type].wall) continue; // walls aren't worth auto-fire
      const d = _distTo(ex, ey, b);
      if (d > maxD) continue;
      // defensive structures draw fire first: the deadlier the tower, the
      // shorter it "feels" to the targeting scan (AGT/obelisk over gtwr)
      const bd = DATA.buildings[b.type];
      const score = bd.threat ? d * (1 - bd.threat * 0.6) : d;
      if (score < bestD) { bestD = score; best = b; }
    }
  }
  return best;
}

// ---- effects & bullets -------------------------------------------------------

function spawnEffect(name, x, y, opts) {
  const e = Object.assign({ name, x, y, frame: 0, tick: 0 }, opts || {});
  game.effects.push(e);
  return e;
}

function spawnBullet(shooter, w, target, opts) {
  opts = opts || {};
  let tx = _entX(target), ty = _entY(target);
  if (w.inaccurate) {
    tx += (game.rng() - 0.5) * 20;
    ty += (game.rng() - 0.5) * 20;
  }
  const sx = shooter.kind === 'unit' ? shooter.x : _entX(shooter);
  const sy = shooter.kind === 'unit' ? shooter.y : _entY(shooter);
  game.bullets.push({
    x: sx, y: sy, tx, ty,
    targetId: w.homing ? target.id : 0,
    w, key: w.key, owner: shooter.owner, shooterId: shooter.id,
    total: Math.max(1, dist(sx, sy, tx, ty)), traveled: 0, z: 0,
  });
}

function _splashDamage(x, y, dmg, warhead, splash, attacker) {
  const g = game;
  const victims = [];
  for (const u of g.units.values()) {
    if (attacker && u.id === attacker.id) continue;
    if (_distTo(x, y, u) <= splash) victims.push(u);
  }
  for (const b of g.buildings.values()) {
    if (_distTo(x, y, b) <= splash) victims.push(b);
  }
  for (const v of victims) {
    const d = _distTo(x, y, v);
    const factor = 1 - 0.6 * Math.min(1, d / splash);
    applyDamage(v, dmg * factor, warhead, attacker);
  }
}

function _bulletImpact(b) {
  const w = b.w;
  const target = getEnt(b.targetId);
  if (w.splash > 0) {
    _splashDamage(b.tx, b.ty, w.dmg, w.warhead, w.splash, getEnt(b.shooterId));
    spawnEffect(w.warhead === 'fire' ? 'flame' : 'expS', b.tx, b.ty);
    _maybePlay('expS', b.tx, b.ty);
  } else if (target && !target._dead) {
    applyDamage(target, w.dmg, w.warhead, getEnt(b.shooterId));
    spawnEffect('expS', b.tx, b.ty);
  } else {
    spawnEffect('smoke', b.tx, b.ty);
  }
}

function _tickBullets(g) {
  for (let i = g.bullets.length - 1; i >= 0; i--) {
    const b = g.bullets[i];
    const t = b.targetId ? getEnt(b.targetId) : null;
    if (b.targetId && t && !t._dead) { b.tx = _entX(t); b.ty = _entY(t); }
    else if (b.targetId && b.w.antiAir && (!t || t._dead)) {
      // homing AA missile lost its air target: fizzle
      spawnEffect('smoke', b.x, b.y);
      g.bullets.splice(i, 1);
      continue;
    }
    const d = dist(b.x, b.y, b.tx, b.ty);
    const spd = b.w.speed;
    if (d <= spd) {
      _bulletImpact(b);
      g.bullets.splice(i, 1);
      continue;
    }
    b.x += (b.tx - b.x) / d * spd;
    b.y += (b.ty - b.y) / d * spd;
    b.traveled += spd;
    if (b.w.arc) {
      const frac = clamp(b.traveled / b.total, 0, 1);
      b.z = 4 * 14 * frac * (1 - frac);
    }
  }
}

// ---- firing ------------------------------------------------------------------

function _muzzleXY(e, facing) {
  const x = e.kind === 'unit' ? e.x : _entX(e);
  const y = e.kind === 'unit' ? e.y : _entY(e);
  const a = angleOf16(facing);
  return { x: x + Math.sin(a) * 10, y: y - Math.cos(a) * 10 };
}

function _fireWeapon(shooter, w, target) {
  const d = _data(shooter);
  const facing = shooter.kind === 'unit'
    ? (d.turret ? shooter.turretFacing : shooter.facing)
    : shooter.turretFacing;
  const m = _muzzleXY(shooter, facing);
  const tx = _entX(target), ty = _entY(target);
  if (shooter.kind === 'unit') shooter.decloakTicks = Math.max(shooter.decloakTicks || 0, 45);

  if (w.speed === 0) {
    // hitscan
    let dmg = w.dmg;
    if (shooter.kind === 'unit' && target.kind === 'building' && d.antiBuildingBonus) {
      dmg *= d.antiBuildingBonus;
    }
    if (w.splash > 0) {
      _splashDamage(tx, ty, dmg, w.warhead, w.splash, shooter);
    } else {
      applyDamage(target, dmg, w.warhead, shooter);
    }
    if (w.warhead === 'fire') spawnEffect('flame', tx, ty);
    else if (w.key === 'obelisk') spawnEffect('laserBeam', m.x, m.y, { x1: m.x, y1: m.y - 14, x2: tx, y2: ty, ttl: 6 });
    else spawnEffect('tracer', m.x, m.y, { x1: m.x, y1: m.y, x2: tx, y2: ty, ttl: 3 });
  } else {
    spawnBullet(shooter, w, target);
  }
  spawnEffect('muzzle', m.x, m.y);
  _maybePlay(w.sound, m.x, m.y);
}

// ---- orders ------------------------------------------------------------------

function orderMove(u, cx, cy) {
  const d = DATA.units[u.type];
  u.targetId = 0;
  u.guardAnchor = null;
  if (d.air) {
    u.state = 'air-move';
    u.moveTarget = { cx, cy };
    _releasePad(u);
    return;
  }
  u.state = 'move';
  u.moveTarget = { cx, cy };
  u.path = findPath(u, cx, cy);
  u.pathi = 0;
  u._repathFails = 0;
}

function orderAttack(u, target, keepAnchor) {
  const d = DATA.units[u.type];
  if (!d.weapon || !target || target._dead) return false;
  const w = _pickWeapon(u, target);
  if (!_canTarget(w, target)) return false;
  u.targetId = target.id;
  if (!keepAnchor) u.guardAnchor = null;
  if (d.air) { u.state = 'air-attack'; _releasePad(u); }
  else u.state = 'attack';
  return true;
}

function orderHarvest(u, cx, cy) {
  if (!DATA.units[u.type].harvester) return;
  u.state = 'harvest';
  u.fieldCell = { cx, cy };
  u.targetId = 0;
  u.path = findPath(u, cx, cy);
  u.pathi = 0;
}

function orderDeploy(u) {
  if (!DATA.units[u.type].deploysTo) return false;
  const g = game;
  const cx0 = worldToCell(u.x) - 1, cy0 = worldToCell(u.y) - 1;
  const d = DATA.buildings.fact;
  for (let y = 0; y < d.h; y++) {
    for (let x = 0; x < d.w; x++) {
      const cx = cx0 + x, cy = cy0 + y;
      if (!inMap(cx, cy)) return false;
      const i = cellIdx(cx, cy);
      if (!terrainPassable(g.terrain[i]) || g.tib[i] > 0) return false;
      const o = g.occ[i];
      if (o && o !== u.id) return false;
    }
  }
  const owner = u.owner;
  removeUnit(u);
  const b = makeBuilding('fact', owner, cx0, cy0);
  b.buildProgress = 1;
  addBuilding(b);
  if (typeof Production !== 'undefined') Production.computePower(g.players[owner]);
  _maybePlay('place', _entX(b), _entY(b));
  return true;
}

function orderEnter(u, target) {
  if (!DATA.units[u.type].engineer || !target || target.kind !== 'building') return false;
  u.state = 'enter';
  u.targetId = target.id;
  // path to nearest perimeter cell
  const cells = [];
  for (let x = -1; x <= target.w; x++) {
    cells.push({ cx: target.cx + x, cy: target.cy - 1 }, { cx: target.cx + x, cy: target.cy + target.h });
  }
  for (let y = 0; y < target.h; y++) {
    cells.push({ cx: target.cx - 1, cy: target.cy + y }, { cx: target.cx + target.w, cy: target.cy + y });
  }
  let best = null, bestD = Infinity;
  for (const c of cells) {
    if (!inMap(c.cx, c.cy) || !isPassable(c.cx, c.cy, u)) continue;
    const d = dist(u.x, u.y, cellCenterX(c.cx), cellCenterY(c.cy));
    if (d < bestD) { bestD = d; best = c; }
  }
  if (!best) best = { cx: target.cx, cy: target.cy - 1 };
  u.path = findPath(u, best.cx, best.cy);
  u.pathi = 0;
  return true;
}

function stopUnit(u) {
  // release a mid-transit cell commit; a stopped unit never steps again to
  // heal its own bookkeeping
  if (u._commit >= 0) {
    clearOcc(u._commit % C.MAP_W, (u._commit / C.MAP_W) | 0, u.id);
    u._commit = -1;
    if (!DATA.units[u.type].air) setOcc(worldToCell(u.x), worldToCell(u.y), u.id);
  }
  u.path = [];
  u.pathi = 0;
  u.targetId = 0;
  u.moveTarget = null;
  u.state = 'idle';
  u.guardAnchor = { x: u.x, y: u.y };
}

// ---- movement ----------------------------------------------------------------

// advance one tick along u.path. Returns 'arrived' | 'moving' | 'blocked'
function _stepAlongPath(u, d) {
  const g = game;
  if (u.pathi >= u.path.length) return 'arrived';
  const wp = u.path[u.pathi];
  const nx = cellCenterX(wp.cx), ny = cellCenterY(wp.cy);
  const curCx = worldToCell(u.x), curCy = worldToCell(u.y);

  // commit to the next cell before physically entering it
  const wantIdx = cellIdx(wp.cx, wp.cy);
  if (u._commit !== wantIdx) {
    // heal a stale commit left by an abandoned path (re-order mid-transit):
    // release the old committed cell and re-anchor on the cell we stand in
    if (u._commit >= 0) {
      clearOcc(u._commit % C.MAP_W, (u._commit / C.MAP_W) | 0, u.id);
      u._commit = -1;
      if (!occAt(curCx, curCy)) setOcc(curCx, curCy, u.id);
    }
    if (!isPassable(wp.cx, wp.cy, u)) {
      // occupied: repath toward final destination
      u._repathFails = (u._repathFails || 0) + 1;
      if (u._repathFails > 3) { u.path = []; u.pathi = 0; return 'blocked'; }
      const dest = u.moveTarget || wp;
      u.path = findPath(u, dest.cx, dest.cy);
      u.pathi = 0;
      return 'moving';
    }
    // crush enemy infantry standing there
    const o = occAt(wp.cx, wp.cy);
    if (o && o !== u.id) {
      const e = getEnt(o);
      if (e && e.kind === 'unit' && e.owner !== u.owner && DATA.units[e.type].infantry && d.crush) {
        spawnEffect('squish', e.x, e.y);
        _maybePlay('squish', e.x, e.y);
        killEntity(e, u);
      }
    }
    clearOcc(curCx, curCy, u.id);
    setOcc(wp.cx, wp.cy, u.id);
    u._commit = wantIdx;
    u._repathFails = 0;
  }

  // turn before moving (vehicles); infantry snap
  const want = dirTo16(nx - u.x, ny - u.y);
  if (d.infantry) u.facing = want;
  else if (u.facing !== want) {
    u.facing = turnFacing(u.facing, want, d.turn || 2);
    if (u.facing !== want) return 'moving';
  }

  const spd = d.speed;
  const dd = dist(u.x, u.y, nx, ny);
  if (dd <= spd) {
    u.x = nx; u.y = ny;
    u.pathi++;
    u._commit = -1;
    u.anim++;
    if (u.pathi >= u.path.length) return 'arrived';
  } else {
    u.x += (nx - u.x) / dd * spd;
    u.y += (ny - u.y) / dd * spd;
    u.anim++;
  }
  return 'moving';
}

// ---- unit behaviors ----------------------------------------------------------

function _autoAcquire(u, d) {
  const g = game;
  if (!d.weapon || d.harvester || d.deploysTo || d.engineer || d.air) return;
  if ((g.tick + u.id) % 8 !== 0) return;
  const w = DATA.weapons[d.weapon];
  const t = _nearestEnemy(u, d.sight + 1, { antiAir: !!(w.antiAir || d.weapon2), airOnly: !!w.airOnly });
  if (t) {
    const anchor = u.guardAnchor || { x: u.x, y: u.y };
    if (orderAttack(u, t, true)) u.guardAnchor = anchor;
  }
}

function _combat(u, d) {
  const g = game;
  const t = getEnt(u.targetId);
  if (!t || t._dead || (t.kind === 'unit' && t.cloaked && t.owner !== u.owner && !g.players[u.owner].isAI)) {
    // target gone: return to guard anchor if any
    u.targetId = 0;
    if (u.guardAnchor) {
      const a = u.guardAnchor;
      orderMove(u, worldToCell(a.x), worldToCell(a.y));
      u.guardAnchor = a;
    } else u.state = 'idle';
    return;
  }
  const w = _pickWeapon(u, t);
  if (!_canTarget(w, t)) { u.state = 'idle'; return; }

  // leash: don't chase forever when guarding
  if (u.guardAnchor && dist(u.x, u.y, u.guardAnchor.x, u.guardAnchor.y) > 6 * C.CELL) {
    const a = u.guardAnchor;
    u.targetId = 0;
    orderMove(u, worldToCell(a.x), worldToCell(a.y));
    u.guardAnchor = a;
    return;
  }

  const tx = _entX(t), ty = _entY(t);
  const inRange = _distTo(u.x, u.y, t) <= w.range * C.CELL;
  if (inRange) {
    u.path = []; u.pathi = 0;
    const want = dirTo16(tx - u.x, ty - u.y);
    let aimed;
    if (d.turret) {
      u.turretFacing = turnFacing(u.turretFacing, want, 2);
      aimed = u.turretFacing === want;
    } else if (d.infantry) {
      u.facing = want; aimed = true;
    } else {
      u.facing = turnFacing(u.facing, want, d.turn || 2);
      aimed = u.facing === want;
    }
    u._firing = true;
    if (aimed && u.cooldown <= 0) {
      _fireWeapon(u, w, t);
      u.cooldown = w.rof;
    }
  } else {
    u._firing = false;
    const tcx = worldToCell(tx), tcy = worldToCell(ty);
    if (!u.path.length || u.pathi >= u.path.length || (g.tick + u.id) % 20 === 0) {
      u.path = findPath(u, tcx, tcy, { range: Math.max(0.5, w.range - 0.25) });
      u.pathi = 0;
    }
    _stepAlongPath(u, d);
  }
}

// ---- harvester ---------------------------------------------------------------

function _findTibCell(u, radius) {
  const g = game;
  const cx = worldToCell(u.x), cy = worldToCell(u.y);
  const human = !g.players[u.owner].isAI;
  let best = null, bestD = Infinity;
  const r0 = Math.max(0, cx - radius), r1 = Math.min(C.MAP_W - 1, cx + radius);
  const s0 = Math.max(0, cy - radius), s1 = Math.min(C.MAP_H - 1, cy + radius);
  for (let y = s0; y <= s1; y++) {
    for (let x = r0; x <= r1; x++) {
      const i = cellIdx(x, y);
      if (g.tib[i] <= 0) continue;
      if (u._noReach && u._noReach.has(i)) continue;   // known-unreachable cells
      if (human && g.shroud[i] !== 1) continue;
      const o = g.occ[i];
      if (o && o !== u.id) continue;
      const dd = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (dd < bestD) { bestD = dd; best = { cx: x, cy: y }; }
    }
  }
  return best;
}

function _nearestProc(u) {
  const g = game;
  let best = null, bestD = Infinity;
  for (const id of g.players[u.owner].buildingIds) {
    const b = g.buildings.get(id);
    if (!b || b.type !== 'proc' || b.buildProgress < 1) continue;
    const d = _distTo(u.x, u.y, b);
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

function _procDock(b) { return { cx: b.cx + 1, cy: b.cy + b.h }; }

function _harvester(u, d) {
  const g = game;
  if (u.state === 'harvest') {
    if (u.tib >= C.HARV_CAP) { u.state = 'return'; u.path = []; return; }
    const cx = worldToCell(u.x), cy = worldToCell(u.y);
    const i = cellIdx(cx, cy);
    if (u.pathi < u.path.length) { _stepAlongPath(u, d); _harvWatchdog(u); return; }
    if (g.tib[i] > 0) {
      u._eat = (u._eat || 0) + 1;
      u.anim++;
      if (u._eat >= 10) {
        u._eat = 0;
        const take = Math.min(C.BAIL, g.tib[i]);
        g.tib[i] -= take;
        u.tib += take;
        u.fieldCell = { cx, cy };
        if (!g.players[u.owner].isAI) _maybePlay('harvest', u.x, u.y);
      }
      return;
    }
    // find more tiberium nearby; cells no path can reach (sealed forest
    // pockets, walled-off fields) get blacklisted for a while so the sweep
    // moves on instead of re-targeting them forever
    let tries = 8;
    for (const r of [3, 6, 10, 16, 24, 40]) {
      let c;
      while ((c = _findTibCell(u, r))) {
        const path = findPath(u, c.cx, c.cy);
        if (path.length) {
          u.path = path;
          u.pathi = 0;
          return;
        }
        if (g.tick - (u._noReachAt || -1e9) > 900) { u._noReach = new Set(); u._noReachAt = g.tick; }
        u._noReach.add(cellIdx(c.cx, c.cy));
        if (--tries <= 0) return;  // resume next tick, blacklist kept
      }
    }
    if (u.tib > 0) { u.state = 'return'; u.path = []; }
    else { u.state = 'idle'; _clearDock(u); }
    return;
  }
  if (u.state === 'return') {
    const proc = _nearestProc(u);
    if (!proc) {
      if (g.tick % 30 === 0) u.state = u.tib > 0 ? 'return' : 'idle'; // retry / stand down
      return;
    }
    const dock = _procDock(proc);
    // 1.5 cells covers diagonal-adjacent waiting spots, so a queued harvester
    // can always unload instead of wedging beside an occupied dock
    if (dist(u.x, u.y, cellCenterX(dock.cx), cellCenterY(dock.cy)) <= C.CELL * 1.5) {
      u.state = 'unload';
      u._unload = 60;
      u._chunk = u.tib / 60;
      u.facing = 0; // face the refinery
      u.path = [];
      return;
    }
    if (!u.path.length || u.pathi >= u.path.length || (g.tick + u.id) % 25 === 0) {
      u.path = findPath(u, dock.cx, dock.cy);
      u.pathi = 0;
    }
    _stepAlongPath(u, d);
    _harvWatchdog(u);
    return;
  }
  if (u.state === 'unload') {
    const p = g.players[u.owner];
    const room = Math.max(0, p.storage - p.credits);
    const add = Math.min(u._chunk, u.tib, room);
    p.credits += add;
    u.tib = Math.max(0, u.tib - u._chunk);
    if (u._chunk > add + 0.01 && !p.isAI) _evaOnce('silosNeeded', 450);
    if (!p.isAI) g.stats.harvested += add;
    u._unload--;
    if (u._unload <= 0 || u.tib <= 0) {
      u.tib = 0;
      u.state = 'harvest';
      if (u.fieldCell) {
        u.path = findPath(u, u.fieldCell.cx, u.fieldCell.cy);
        u.pathi = 0;
      }
    }
    return;
  }
  // idle: auto-seek (whole-map radius, staggered)
  if ((g.tick + u.id) % 30 === 0) {
    const c = _findTibCell(u, 40);
    if (c) orderHarvest(u, c.cx, c.cy);
    else _clearDock(u);
  }
}

// stuck-detector: a harvester that hasn't moved or made progress for ~6s
// while trying to work gets shaken loose (repath from a side-step, or re-seek)
function _harvWatchdog(u) {
  const g = game;
  const key = (u.x | 0) * 4096 + (u.y | 0);
  if (u._wdKey !== key) {
    u._wdKey = key;
    u._wdSince = g.tick;
    return;
  }
  if (g.tick - u._wdSince < 90) return;
  u._wdSince = g.tick;
  // side-step to any free neighbor, then let the normal logic re-plan
  const cx = worldToCell(u.x), cy = worldToCell(u.y);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
  const start = (g.rng() * dirs.length) | 0;
  for (let i = 0; i < dirs.length; i++) {
    const [dx, dy] = dirs[(start + i) % dirs.length];
    if (isPassable(cx + dx, cy + dy, u)) {
      const wasState = u.state;
      u.path = findPath(u, cx + dx, cy + dy);
      u.pathi = 0;
      u.state = wasState; // keep purpose; the step just breaks the wedge
      return;
    }
  }
}

// an idle harvester must never squat on a refinery dock cell
function _clearDock(u) {
  const g = game;
  const cx = worldToCell(u.x), cy = worldToCell(u.y);
  for (const b of g.buildings.values()) {
    if (b.type !== 'proc') continue;
    const dock = _procDock(b);
    if (Math.abs(cx - dock.cx) <= 0 && Math.abs(cy - dock.cy) <= 0) {
      // step aside to any nearby free cell
      for (let r = 1; r <= 3; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const nx = dock.cx + dx, ny = dock.cy + dy;
            if (isPassable(nx, ny, u)) {
              orderMove(u, nx, ny);
              return;
            }
          }
        }
      }
      return;
    }
  }
}

// ---- aircraft ----------------------------------------------------------------

function _releasePad(u) {
  const g = game;
  for (const b of g.buildings.values()) {
    if (b.type === 'hpad' && b.claimedBy === u.id) b.claimedBy = 0;
  }
}

function _findPad(u) {
  const g = game;
  let best = null, bestD = Infinity;
  for (const id of g.players[u.owner].buildingIds) {
    const b = g.buildings.get(id);
    if (!b || b.type !== 'hpad' || b.buildProgress < 1) continue;
    if (b.claimedBy && b.claimedBy !== u.id) {
      const claimer = g.units.get(b.claimedBy);
      if (claimer && !claimer._dead) continue;
    }
    const d = _distTo(u.x, u.y, b);
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

function _flyToward(u, x, y, spd) {
  const dd = dist(u.x, u.y, x, y);
  u.facing = dirTo16(x - u.x, y - u.y);
  if (dd <= spd) { u.x = x; u.y = y; return true; }
  u.x += (x - u.x) / dd * spd;
  u.y += (y - u.y) / dd * spd;
  return false;
}

function _aircraft(u, d) {
  const g = game;
  u.anim++;
  if (u.state === 'air-move') {
    const t = u.moveTarget;
    if (!t || _flyToward(u, cellCenterX(t.cx), cellCenterY(t.cy), d.speed)) {
      u.state = 'idle';
      u.moveTarget = null;
    }
    return;
  }
  if (u.state === 'air-attack') {
    const t = getEnt(u.targetId);
    if (!t || t._dead) { u.targetId = 0; u.state = 'idle'; _goRearm(u, d); return; }
    if (u.ammo <= 0) { u._resume = t.id; _goRearm(u, d); return; }
    const tx = _entX(t), ty = _entY(t);
    const w = _pickWeapon(u, t);
    if (dist(u.x, u.y, tx, ty) <= w.range * C.CELL) {
      u.facing = dirTo16(tx - u.x, ty - u.y);
      if (u.cooldown <= 0) {
        _fireWeapon(u, w, t);
        u.ammo--;
        u.cooldown = w.rof;
        // jink sideways after each shot
        const a = angleOf16((u.facing + (g.tick % 2 ? 4 : 12)) & 15);
        u.x += Math.sin(a) * 6;
        u.y -= Math.cos(a) * 6;
      }
    } else {
      _flyToward(u, tx, ty, d.speed);
    }
    return;
  }
  if (u.state === 'air-return') {
    const pad = getEnt(u.padId);
    if (!pad || pad._dead || pad.type !== 'hpad') { u.padId = 0; u.state = 'idle'; return; }
    pad.claimedBy = u.id;
    if (_flyToward(u, _entX(pad), _entY(pad), d.speed)) u.state = 'air-rearm';
    return;
  }
  if (u.state === 'air-rearm') {
    const pad = getEnt(u.padId);
    if (!pad || pad._dead) { u.padId = 0; u.state = 'idle'; return; }
    if (u.ammo < (d.ammo || 0)) {
      if ((g.tick + u.id) % 15 === 0) u.ammo++;
      return;
    }
    // rearmed: resume attack if the old target is alive
    const t = u._resume ? getEnt(u._resume) : null;
    u._resume = 0;
    if (t && !t._dead) orderAttack(u, t);
    else u.state = 'idle';
    return;
  }
  // idle: hover (bob handled by render via anim)
}

function _goRearm(u, d) {
  const pad = _findPad(u);
  if (pad) {
    u.padId = pad.id;
    pad.claimedBy = u.id;
    u.state = 'air-return';
  } else {
    u.state = 'idle';
  }
}

// ---- engineer ----------------------------------------------------------------

function _engineer(u, d) {
  const g = game;
  const t = getEnt(u.targetId);
  if (!t || t._dead || t.kind !== 'building') { u.state = 'idle'; u.targetId = 0; return; }
  const cx = worldToCell(u.x), cy = worldToCell(u.y);
  const adjacent = cx >= t.cx - 1 && cx <= t.cx + t.w && cy >= t.cy - 1 && cy <= t.cy + t.h;
  if (adjacent) {
    if (t.owner !== u.owner) {
      // capture!
      const oldOwner = t.owner;
      const ids = g.players[oldOwner].buildingIds;
      const i = ids.indexOf(t.id);
      if (i >= 0) ids.splice(i, 1);
      t.owner = u.owner;
      t.repairing = false;
      g.players[u.owner].buildingIds.push(t.id);
      if (typeof Production !== 'undefined') {
        Production.computePower(g.players[oldOwner]);
        Production.computePower(g.players[u.owner]);
      }
      if (!g.players[u.owner].isAI) _evaOnce('buildingCaptured', 30);
      _maybePlay('radarOn', u.x, u.y);
    } else if (t.hp < t.maxHp) {
      t.hp = t.maxHp;
      _maybePlay('repair', u.x, u.y);
    }
    removeUnit(u); // consumed
    return;
  }
  if (u.pathi < u.path.length) _stepAlongPath(u, d);
  else orderEnter(u, t); // repath
}

// ---- per-unit tick -----------------------------------------------------------

function _tickUnit(u) {
  const g = game;
  const d = DATA.units[u.type];
  if (u.cooldown > 0) u.cooldown--;
  if (u.decloakTicks > 0) u.decloakTicks--;

  if (d.air) { _aircraft(u, d); return; }
  if (d.harvester) {
    if (u.state === 'move') {
      if (_stepAlongPath(u, d) === 'arrived') { u.state = 'idle'; u.guardAnchor = { x: u.x, y: u.y }; }
    } else _harvester(u, d);
    return;
  }
  if (d.engineer && u.state === 'enter') { _engineer(u, d); return; }

  switch (u.state) {
    case 'move': {
      // a unit jammed by traffic retries toward its ordered destination a few
      // times (staggered) before giving up, instead of freezing on the spot
      if (u._retryAt && u.moveTarget && u.pathi >= u.path.length) {
        if (g.tick < u._retryAt) break;
        u._retryAt = 0;
        u.path = findPath(u, u.moveTarget.cx, u.moveTarget.cy);
        u.pathi = 0;
      }
      const r = _stepAlongPath(u, d);
      if (r === 'blocked' && u.moveTarget && (u._blockRetries = (u._blockRetries || 0) + 1) <= 6) {
        u._retryAt = g.tick + 12 + ((u.id * 7) % 10);
        break;
      }
      if (r === 'arrived' || r === 'blocked') {
        if (u._retryAt && u.moveTarget) break; // retry pending — not done yet
        u.state = 'idle';
        u._blockRetries = 0;
        if (!u.guardAnchor) u.guardAnchor = { x: u.x, y: u.y };
      }
      break;
    }
    case 'attack':
      _combat(u, d);
      break;
    default: // idle
      u._firing = false;
      _autoAcquire(u, d);
      // mammoth self-heal to 50%
      if (d.selfHeal && u.hp < u.maxHp / 2 && g.tick % 8 === 0) u.hp++;
      // creatures roam the fields between meals
      if (d.creature && (g.tick + u.id) % 45 === 0) {
        const cx = worldToCell(u.x) + ((g.rng() * 7) | 0) - 3;
        const cy = worldToCell(u.y) + ((g.rng() * 7) | 0) - 3;
        if (inMap(cx, cy) && isPassable(cx, cy, u)) orderMove(u, cx, cy);
      }
      // villagers potter about near home
      if (d.civilian && (g.tick + u.id) % 75 === 0 && g.rng() < 0.6) {
        const home = u.guardAnchor || { x: u.x, y: u.y };
        const cx = worldToCell(home.x) + ((g.rng() * 7) | 0) - 3;
        const cy = worldToCell(home.y) + ((g.rng() * 7) | 0) - 3;
        const anchor = u.guardAnchor;
        if (inMap(cx, cy) && isPassable(cx, cy, u)) { orderMove(u, cx, cy); u.guardAnchor = anchor; }
      }
      break;
  }

  // infantry wading THROUGH tiberium take damage; standing still is safe
  if (d.infantry && !d.tibImmune && g.tick % 8 === 0 &&
      u.path && u.pathi < u.path.length) {
    const i = cellIdx(worldToCell(u.x), worldToCell(u.y));
    if (g.tib[i] > 0) {
      u.hp -= 1;
      if (u.hp <= 0) { u.hp = 0; killEntity(u, null); }
    }
  }
}

// ---- buildings ---------------------------------------------------------------

function _tickBuildingWeapon(b) {
  const g = game;
  const bd = DATA.buildings[b.type];
  if (!bd.weapon || b.buildProgress < 1) return;
  const p = g.players[b.owner];
  const lowPower = p.power.drain > p.power.out;
  if (bd.needsPower && lowPower) { b.charging = 0; b.targetId = 0; return; }
  if (b.cooldown > 0) b.cooldown--;

  const w = Object.assign({ key: bd.weapon }, DATA.weapons[bd.weapon]);
  let t = getEnt(b.targetId);
  const seeCloaked = false;
  if (!t || t._dead || _distTo(_entX(b), _entY(b), t) > w.range * C.CELL ||
      (t.kind === 'unit' && t.cloaked) || !_canTarget(w, t)) {
    t = null;
    b.targetId = 0;
    if ((g.tick + b.id) % 4 === 0) {
      t = _nearestEnemy(b, w.range, { antiAir: !!w.antiAir, airOnly: !!w.airOnly, seeCloaked });
      if (t) b.targetId = t.id;
    }
  }
  if (!t) { b.charging = 0; return; }

  const tx = _entX(t), ty = _entY(t);
  if (w.charge) {
    // obelisk: charge-up, then zap
    if (b.cooldown > 0) return;
    if (!b.charging) {
      b.charging = w.charge;
      _maybePlay('obeliskCharge', _entX(b), _entY(b));
    }
    b.charging--;
    if (b.charging <= 0) {
      b.charging = 0;
      _fireWeapon(b, w, t);
      b.cooldown = w.rof;
    }
    return;
  }
  const want = dirTo16(tx - _entX(b), ty - _entY(b));
  if (bd.turret) {
    b.turretFacing = turnFacing(b.turretFacing, want, 2);
    if (b.turretFacing !== want) return;
  } else {
    b.turretFacing = want;
  }
  if (b.cooldown <= 0) {
    _fireWeapon(b, w, t);
    b.cooldown = w.rof;
  }
}

// ---- tiberium growth -----------------------------------------------------------

function _tickTiberium(g) {
  if (g.tick % 75 !== 0) return;
  if (!g._blossoms) {
    g._blossoms = [];
    for (let i = 0; i < g.terrain.length; i++) {
      if (g.terrain[i] === 5) g._blossoms.push(i);
    }
  }
  const rich = [];
  for (let i = 0; i < g.tib.length; i++) if (g.tib[i] >= 125) rich.push(i);
  const spreads = Math.min(6, rich.length);
  for (let s = 0; s < spreads; s++) {
    const i = rich[(g.rng() * rich.length) | 0];
    const cx = i % C.MAP_W, cy = (i / C.MAP_W) | 0;
    const dx = ((g.rng() * 3) | 0) - 1, dy = ((g.rng() * 3) | 0) - 1;
    const nx = cx + dx, ny = cy + dy;
    if (!inMap(nx, ny)) continue;
    const ni = cellIdx(nx, ny);
    if (g.terrain[ni] > 1) continue; // only grass/dirt hold tiberium (not bridges)
    const o = g.occ[ni];
    if (o) { const e = getEnt(o); if (e && e.kind === 'building') continue; }
    g.tib[ni] = Math.min(C.TIB_MAX, g.tib[ni] + 25);
  }
  for (const bi of g._blossoms) {
    const cx = bi % C.MAP_W, cy = (bi / C.MAP_W) | 0;
    for (let n = 0; n < 2; n++) {
      const nx = cx + ((g.rng() * 3) | 0) - 1, ny = cy + ((g.rng() * 3) | 0) - 1;
      if (!inMap(nx, ny)) continue;
      const ni = cellIdx(nx, ny);
      if (g.terrain[ni] > 1) continue; // only grass/dirt hold tiberium (not bridges)
      const o = g.occ[ni];
      if (o) { const e = getEnt(o); if (e && e.kind === 'building') continue; }
      g.tib[ni] = Math.min(C.TIB_MAX, g.tib[ni] + 25);
    }
  }
}

// ---- cloaking ------------------------------------------------------------------

function _tickCloak(g) {
  if (g.tick % 5 !== 0) return;
  for (const u of g.units.values()) {
    const d = DATA.units[u.type];
    if (!d.stealth) continue;
    if (u.decloakTicks > 0) { u.cloaked = false; continue; }
    // enemy infantry or defense building within 2 cells forces decloak
    let near = false;
    const enemy = enemyOf(u.owner);
    for (const e of g.units.values()) {
      if (e.owner !== enemy || !DATA.units[e.type].infantry) continue;
      if (dist(u.x, u.y, e.x, e.y) <= 2 * C.CELL) { near = true; break; }
    }
    if (!near) {
      for (const b of g.buildings.values()) {
        if (b.owner !== enemy || !DATA.buildings[b.type].weapon) continue;
        if (_distTo(u.x, u.y, b) <= 2 * C.CELL) { near = true; break; }
      }
    }
    u.cloaked = !near;
  }
}

// ---- death ---------------------------------------------------------------------

function killEntity(ent, attacker) {
  if (ent._dead) return;
  ent._dead = true;
  const g = game;
  const human = g.humanSide;

  if (ent.kind === 'unit') {
    const d = DATA.units[ent.type];
    removeUnit(ent);
    _releasePad(ent);
    if (d.infantry) {
      spawnEffect('infdie', ent.x, ent.y, { itype: ent.type, side: ent.owner });
      // dying on a tiberium field mutates the body into a visceroid
      const tc = cellIdx(worldToCell(ent.x), worldToCell(ent.y));
      if (g.tib[tc] > 0 && DATA.units.vice) {
        const v = makeUnit('vice', 'mut', worldToCell(ent.x), worldToCell(ent.y));
        if (isPassable(worldToCell(ent.x), worldToCell(ent.y), v)) {
          addUnit(v);
          _maybePlay('squish', ent.x, ent.y);
        }
      }
    } else {
      const big = d.hp >= 300 || d.harvester;
      spawnEffect(big ? 'expL' : 'expS', ent.x, ent.y);
      if (!d.air) spawnEffect('scorch', ent.x, ent.y);
      _maybePlay(big ? 'expL' : 'expS', ent.x, ent.y);
    }
    if (ent.owner === human) {
      g.stats.losses++;
      _evaOnce('unitLost', 120);
    } else {
      g.stats.kills++;
    }
  } else {
    const d = DATA.buildings[ent.type];
    removeBuilding(ent);
    spawnEffect('expL', _entX(ent), _entY(ent));
    spawnEffect('scorch', _entX(ent), _entY(ent));
    _maybePlay('expL', _entX(ent), _entY(ent));
    const p = g.players[ent.owner];
    if (typeof Production !== 'undefined') Production.computePower(p);
    if (d.superweapon && p.super.key === d.superweapon) {
      p.super = { key: null, timer: 0, max: 0 };
    }
    if (ent.owner === human) g.stats.buildingsLost++;
    else g.stats.buildingsKilled++;
  }
  EV.emit('destroyed', ent, attacker);
}

// return fire / flee when damaged; base-under-attack warning
EV.on('damaged', function (target, attacker) {
  const g = game;
  if (!g || !attacker || attacker.owner === target.owner) return;
  if (target.kind === 'building') {
    if (target.owner === g.humanSide) _evaOnce('baseUnderAttack', 450);
    // auto-repair: damaged finished buildings start repairing on their own
    // (costs credits per hp as usual; the repair toggle can still switch it off)
    if (target.buildProgress >= 1 && !target.repairing && target.hp < target.maxHp &&
        g.players[target.owner].credits > 100) {
      target.repairing = true;
    }
    return;
  }
  const d = DATA.units[target.type];
  if (d.stealth) target.decloakTicks = Math.max(target.decloakTicks, 30);
  if (d.civilian) {
    // panicked villager: run away from the shooter
    const ax = _entX(attacker), ay = _entY(attacker);
    const len = Math.max(1, dist(target.x, target.y, ax, ay));
    const fx = worldToCell(target.x + (target.x - ax) / len * 6 * C.CELL);
    const fy = worldToCell(target.y + (target.y - ay) / len * 6 * C.CELL);
    orderMove(target, clamp(fx, 1, C.MAP_W - 2), clamp(fy, 1, C.MAP_H - 2));
    return;
  }
  if (d.harvester) {
    if (target.state !== 'return' && target.state !== 'unload') {
      const proc = _nearestProc(target);
      if (proc) { target.state = 'return'; target.path = []; }
    }
    return;
  }
  if (target.state === 'idle' && d.weapon && !d.engineer && !d.deploysTo && !d.air) {
    const w = _pickWeapon(target, attacker);
    if (_canTarget(w, attacker)) {
      const anchor = target.guardAnchor || { x: target.x, y: target.y };
      if (orderAttack(target, attacker, true)) target.guardAnchor = anchor;
    }
  }
});

// ---- superweapons ---------------------------------------------------------------

function _strikes(g) {
  if (!g._strikes) g._strikes = [];
  return g._strikes;
}

function fireIon(a, b, c) {
  const g = typeof a === 'number' ? game : a;
  const cx = typeof a === 'number' ? a : b;
  const cy = typeof a === 'number' ? b : c;
  AUDIO.play('ionHum');
  _strikes(g).push({ kind: 'ion', cx, cy, t: 15 });
}

function fireNuke(a, b, c) {
  const g = typeof a === 'number' ? game : a;
  const cx = typeof a === 'number' ? a : b;
  const cy = typeof a === 'number' ? b : c;
  AUDIO.play('nukeSiren');
  _strikes(g).push({ kind: 'nuke', cx, cy, t: 45 });
}

function _tickStrikes(g) {
  const list = _strikes(g);
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    s.t--;
    const x = cellCenterX(s.cx), y = cellCenterY(s.cy);
    if (s.kind === 'nuke' && s.t === 10) {
      spawnEffect('nukeMissile', x, y, { ttl: 10 });
    }
    if (s.t > 0) continue;
    if (s.kind === 'ion') {
      AUDIO.play('ionBlast');
      spawnEffect('ionBeam', x, y, { ttl: 12 });
      _splashDamage(x, y, 900, 'laser', 36, null);
      spawnEffect('scorch', x, y);
    } else {
      AUDIO.play('nukeBoom');
      _splashDamage(x, y, 600, 'he', 84, null);
      spawnEffect('nukeCloud', x, y);
      spawnEffect('crater', x, y);
      spawnEffect('scorch', x + 10, y + 6);
      g.flash = 12;
      g.shake = 18;
    }
    list.splice(i, 1);
  }
}

// ---- effects aging ---------------------------------------------------------------

const _PERSISTENT = { scorch: true, crater: true };

function _tickEffects(g) {
  let persistent = 0;
  for (let i = g.effects.length - 1; i >= 0; i--) {
    const e = g.effects[i];
    e.tick++;
    if (_PERSISTENT[e.name]) { persistent++; continue; }
    if (e.vx) e.x += e.vx;
    if (e.vy) e.y += e.vy;
    if (e.ttl !== undefined) {
      if (e.tick >= e.ttl) g.effects.splice(i, 1);
      continue;
    }
    if (e.name === 'infdie') {
      e.frame = (e.tick / 4) | 0;
      if (e.frame >= 4) g.effects.splice(i, 1);
      continue;
    }
    e.frame = (e.tick / 3) | 0;
    const frames = SPRITES.fx[e.name];
    if (frames && e.frame >= frames.length) g.effects.splice(i, 1);
  }
  // cap persistent ground marks, oldest out
  if (persistent > 60) {
    let toDrop = persistent - 60;
    for (let i = 0; i < g.effects.length && toDrop > 0; i++) {
      if (_PERSISTENT[g.effects[i].name]) { g.effects.splice(i, 1); i--; toDrop--; }
    }
  }
}

// ---- main tick --------------------------------------------------------------------

const Sim = {
  tick(g) {
    _tickBullets(g);
    const units = Array.from(g.units.values());
    for (const u of units) {
      if (!u._dead) _tickUnit(u);
    }
    const buildings = Array.from(g.buildings.values());
    for (const b of buildings) {
      if (!b._dead) _tickBuildingWeapon(b);
    }
    _tickStrikes(g);
    _tickEffects(g);
    _tickTiberium(g);
    _tickCloak(g);
  },
};
