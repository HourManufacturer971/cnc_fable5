'use strict';
// core.js — shared constants, helpers, and game-state factories.
// Source of truth for every shared data shape. See SPEC.md.

const C = {
  // world units: the simulation still runs on 24px cells — only the display
  // doubles ("hi-res mode": 48 screen px per cell at 1280x800 internal)
  CELL: 24,
  ZOOM: 2,
  MAP_W: 64,
  MAP_H: 64,
  TPS: 15,
  SCREEN_W: 1600,
  SCREEN_H: 1000,
  TAB_H: 32,
  VIEW_W: 640,   // viewport span in WORLD px (640 world = 1280 screen)
  VIEW_H: 484,
  VIEW_PW: 1280, // viewport span in SCREEN px
  VIEW_PH: 968,
  SIDEBAR_X: 1280,
  SIDEBAR_W: 320,
  RADAR_X: 1280, RADAR_Y: 32, RADAR_W: 320, RADAR_H: 260,
  GROUP_X: 140, GROUP_W: 60, GROUP_SPACING: 68, GROUP_N: 5, // tab-bar control-group chips
  MM_X: 1312, MM_Y: 34, MM_S: 256,      // radar minimap blit rect (4px/cell)
  BTN_Y: 292, BTN_H: 40,
  STRIP_BX: 1288, STRIP_UX: 1424, STRIP_Y: 344, STRIP_SPACING: 100, STRIP_VISIBLE: 6,
  CAMEO_W: 64, CAMEO_H: 48,             // cameo SOURCE size (art authored at this)
  CAMEO_PW: 128, CAMEO_PH: 96,          // cameo SCREEN slot size
  HARV_CAP: 700,
  BAIL: 25,
  TIB_MAX: 300,
  BUILD_TPC: 0.4,          // ticks per credit at full power
  QUEUE_MAX: 20,           // max units queued per production line
  ADJACENCY: 1,            // max cell gap to friendly building for placement
  REPAIR_HP: 1,            // hp per tick while repairing
  REPAIR_COST: 0.3,        // fraction of cost/maxHp paid per hp repaired
  SELL_REFUND: 0.5,
  SUPER_TICKS: { ion: 5400, nuke: 6300 },
  EDGE_SCROLL: 16,         // SCREEN px border that triggers edge scrolling
  SCROLL_SPEED: 12,        // WORLD px per frame while scrolling
  // display names for the internal side keys (the keys themselves are legacy
  // identifiers baked into save-free game state; only the labels are shown)
  SIDE_NAME: { gdi: 'UDC', nod: 'SERPENT' },
};

// Widen the fixed 16:10 layout to a device's real aspect (phones in landscape
// are ~19.5:9): the sidebar keeps its width on the right edge and the
// battlefield viewport absorbs every extra pixel. Every consumer reads these
// constants live, so recomputing them re-flows the whole UI. The caller
// (main.js _fitScreen) also resizes the canvas element to match.
function applyScreenAspect(aspect) {
  const w = Math.round(clamp(aspect, 1.6, 2.4) * C.SCREEN_H / 2) * 2;
  C.SCREEN_W = w;
  C.SIDEBAR_X = w - C.SIDEBAR_W;
  C.VIEW_PW = C.SIDEBAR_X;
  C.VIEW_W = C.VIEW_PW / C.ZOOM;
  C.RADAR_X = C.SIDEBAR_X;
  C.MM_X = C.SIDEBAR_X + 32;
  C.STRIP_BX = C.SIDEBAR_X + 8;
  C.STRIP_UX = C.SIDEBAR_X + 144;
}

// Shared palette — every sprite file draws from these so the art reads as one set.
const PAL = {
  outline: '#101008',
  // UDC: desert gold/tan
  gdi: '#c8a84c', gdiDark: '#8a7230', gdiLight: '#e8d088', gdiShadow: '#5c4c20',
  // Serpent Order: steel grey + red accents
  nod: '#8a8a94', nodDark: '#54545e', nodLight: '#b8b8c2', nodShadow: '#36363e',
  nodRed: '#b02818', nodRedLight: '#e05038',
  // terrain
  grass1: '#4c6832', grass2: '#546e36', grass3: '#42592b', grass4: '#5b7a3c',
  dirt1: '#8f7a4e', dirt2: '#9c8656', dirt3: '#7c6a42',
  rock1: '#746c59', rock2: '#8f8570', rock3: '#5b5546',
  water1: '#1e4468', water2: '#28547c', water3: '#356690',
  treeDark: '#1e3416', tree: '#2c4a1e', treeLight: '#3a6128',
  // tiberium
  tib1: '#2ea838', tib2: '#48d858', tib3: '#8cf898', tibDark: '#187824',
  // ui
  uiMetal: '#4a4a42', uiMetalLight: '#6a6a60', uiMetalDark: '#2e2e28',
  uiText: '#d8d0a8', uiGold: '#e0b840', uiRed: '#c03020', uiGreen: '#40c040',
  cameoBg: '#23231e',
  // fx
  fire1: '#f8e850', fire2: '#f09020', fire3: '#c03818', smoke: '#404040',
  laser: '#f03030', ion: '#a8d8f8',
};

// The live game object (set by main.js). Declared here so every file can reference it.
let game = null;

// Sprite registry — filled by the sprites_*.js files at load time.
const SPRITES = {
  terrain: {},    // terrain[id] = [canvas variants]
  tiberium: [],   // [3 densities][3 variant canvases]
  units: {},      // units[type][side] = {body:[16], turret?:[16], anim?:[...]}
  infantry: {},   // infantry[type][side] = {stand:[8], walk:[8][4], fire:[8][2], die:[4]}
  buildings: {},  // buildings[type][side] = {normal:[frames], damaged:[frames]}
  cameo: {},      // cameo[key] = 64x48 canvas (units, buildings, ion, nuke)
  fx: {},         // named frame arrays, see SPEC
  cursor: {},     // cursor[kind] = {c: canvas, hx, hy} hotspot
  logo: {},       // logo.gdi / logo.nod big emblems
  shroudEdge: [], // 8 directional edge tiles
};

// ---- tiny utils ------------------------------------------------------------

let _uid = 0;
function uid() { return ++_uid; }

function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function dist(x1, y1, x2, y2) { const dx = x2 - x1, dy = y2 - y1; return Math.sqrt(dx * dx + dy * dy); }

function cellIdx(cx, cy) { return cy * C.MAP_W + cx; }
function inMap(cx, cy) { return cx >= 0 && cy >= 0 && cx < C.MAP_W && cy < C.MAP_H; }
function worldToCell(w) { return Math.floor(w / C.CELL); }
function cellCenterX(cx) { return cx * C.CELL + C.CELL / 2; }
function cellCenterY(cy) { return cy * C.CELL + C.CELL / 2; }

// facing: 0..15, 0 = north, clockwise.
function dirTo16(dx, dy) {
  // atan2 with north = 0, clockwise
  let a = Math.atan2(dx, -dy); // radians, 0 = up
  if (a < 0) a += Math.PI * 2;
  return Math.round(a / (Math.PI * 2) * 16) & 15;
}
function angleOf16(f) { return f / 16 * Math.PI * 2; } // radians for facing f (0=north cw)
// rotate cur toward target by at most `rate` steps around the 16-facing ring
function turnFacing(cur, target, rate) {
  let d = (target - cur) & 15;
  if (d === 0) return cur;
  if (d <= 8) return (cur + Math.min(rate, d)) & 15;
  return (cur - Math.min(rate, 16 - d)) & 15;
}

function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Produce n rotation frames from a canonical NORTH-facing sprite canvas.
// Nearest-neighbour rotation for the chunky prerendered-rotation look.
function rotFrames(src, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = mkCanvas(src.width, src.height);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.translate(src.width / 2, src.height / 2);
    ctx.rotate(angleOf16(i * (16 / n)));
    ctx.drawImage(src, -src.width / 2, -src.height / 2);
    out.push(c);
  }
  return out;
}

// Pseudo-3D rotation frames, for the tilted 3/4 camera of mid-90s RTS games.
// The top-face sprite is rotated per facing, then composited over a SCREEN-SPACE
// extrusion (the vehicle's dark sides, offset downward) and a soft ground
// shadow — so depth cues stay consistent for all facings instead of spinning
// with the hull. opts: {height: px of extrusion (default 2), squash: y-scale of
// the top face (default 0.86), shadow: alpha (default 0.30)}.
function rot3D(src, n, opts) {
  opts = opts || {};
  const height = opts.height !== undefined ? opts.height : 2;
  const squash = opts.squash !== undefined ? opts.squash : 0.86;
  const shadow = opts.shadow !== undefined ? opts.shadow : 0.30;
  const w = src.width, h = src.height;

  // dark-side plate: the sprite's silhouette filled with a darkened version
  const side = mkCanvas(w, h);
  {
    const sctx = side.getContext('2d');
    sctx.drawImage(src, 0, 0);
    sctx.globalCompositeOperation = 'source-atop';
    sctx.fillStyle = 'rgba(8,8,12,0.72)';
    sctx.fillRect(0, 0, w, h);
  }
  const sil = mkCanvas(w, h);
  {
    const sctx = sil.getContext('2d');
    sctx.drawImage(src, 0, 0);
    sctx.globalCompositeOperation = 'source-atop';
    sctx.fillStyle = '#000';
    sctx.fillRect(0, 0, w, h);
  }

  const out = [];
  for (let i = 0; i < n; i++) {
    const c = mkCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const a = angleOf16(i * (16 / n));
    const sy = squash;
    // squashed, rotated draw at a vertical offset
    const put = (img, dy, alpha) => {
      ctx.save();
      ctx.globalAlpha = alpha !== undefined ? alpha : 1;
      ctx.translate(w / 2, h / 2 + dy);
      ctx.scale(1, sy);
      ctx.rotate(a);
      ctx.drawImage(img, -w / 2, -h / 2);
      ctx.restore();
    };
    if (shadow > 0) put(sil, height + 2, shadow); // ground shadow
    for (let d = height; d >= 1; d--) put(side, d); // extruded sides
    put(src, 0);                                    // top face
    out.push(c);
  }
  return out;
}

// ---- event bus -------------------------------------------------------------

const EV = {
  _h: {},
  on(name, fn) { (this._h[name] = this._h[name] || []).push(fn); },
  emit(name, ...args) {
    const hs = this._h[name];
    if (hs) for (const fn of hs) fn(...args);
  },
};

// ---- state factories -------------------------------------------------------

function makePlayer(side, isAI) {
  return {
    side, isAI,
    credits: 5000,
    storage: 0,
    power: { out: 0, drain: 0 },
    // one Job {key, spent, total, ticksLeft, ticksTotal, hold} per line —
    // infantry/vehicle/air build concurrently, each its own line
    queues: { building: null, infantry: null, vehicle: null, air: null },
    unitQueue: { infantry: [], vehicle: [], air: [] }, // pending keys per line (max C.QUEUE_MAX each)
    ready: { building: null },              // finished building key awaiting placement
    scroll: { b: 0, u: 0 },                 // sidebar strip scroll offsets
    radar: false,
    super: { key: null, timer: 0, max: 0 },
    unitIds: [],
    buildingIds: [],
    primary: { infantry: 0, vehicle: 0, air: 0 }, // building ids (0 = none)
  };
}

function makeGame(opts) {
  // fresh id sequence per game: multiplayer lockstep needs both clients to
  // mint identical entity ids, whatever they played before this match
  _uid = 0;
  const seed = (opts && opts.seed) || ((Math.random() * 1e9) | 0);
  const n = C.MAP_W * C.MAP_H;
  const g = {
    tick: 0,
    seed,
    rng: mulberry(seed),
    terrain: new Uint8Array(n),
    tvar: new Uint8Array(n),
    tib: new Uint16Array(n),
    occ: new Int32Array(n),
    units: new Map(),
    buildings: new Map(),
    bullets: [],
    effects: [],
    // mut is a stub owner for tiberium creatures (visceroids): no base, no
    // production, hostile to everyone, never checked for win/lose.
    // civ is the neutral village: bystanders no one auto-targets.
    players: { gdi: makePlayer('gdi', false), nod: makePlayer('nod', true), mut: makePlayer('mut', true), civ: makePlayer('civ', true) },
    humanSide: (opts && opts.side) || 'gdi',
    human: null, ai: null,
    camera: { x: 0, y: 0 },
    selection: [],
    groups: {},
    shroud: new Uint8Array(n),
    visible: new Uint8Array(n), // cells currently within human sight (recomputed by Fog)
    startPos: null,
    status: 'playing',
    paused: false,
    speed: 1,
    stats: { kills: 0, losses: 0, buildingsKilled: 0, buildingsLost: 0, harvested: 0 },
    evaCooldowns: {},
    startTime: 0, // wall ms, set by main
  };
  g.human = g.players[g.humanSide];
  g.ai = g.players[enemyOf(g.humanSide)];
  g.ai.isAI = true; g.human.isAI = false;
  return g;
}

function enemyOf(side) { return side === 'gdi' ? 'nod' : 'gdi'; }

function makeUnit(type, owner, cx, cy) {
  const d = DATA.units[type];
  return {
    id: uid(), kind: 'unit', type, owner,
    x: cellCenterX(cx), y: cellCenterY(cy),
    facing: 4, turretFacing: 4,
    hp: d.hp, maxHp: d.hp,
    path: [], pathi: 0,
    moveTarget: null,      // {cx,cy} final destination or null
    targetId: 0,
    state: 'idle',
    cooldown: 0,
    tib: 0,                // harvester load in credits
    kills: 0,              // veterancy: 3 = veteran, 6 = elite
    ammo: d.ammo || 0,
    cloaked: false, decloakTicks: 0,
    anim: 0,
    spawnTick: game ? game.tick : 0,
    guardAnchor: null,
    cargo: d.transport ? [] : null,   // passenger unit objects, if a transport
    boardTargetId: 0,
    _commit: -1,
  };
}

function makeBuilding(type, owner, cx, cy) {
  const d = DATA.buildings[type];
  return {
    id: uid(), kind: 'building', type, owner,
    cx, cy, w: d.w, h: d.h,
    hp: d.hp, maxHp: d.hp,
    turretFacing: 0,
    targetId: 0,
    cooldown: 0,
    buildProgress: 0,      // 0..1; 1 = construction finished
    repairing: false,
    anim: 0,
    rally: null,
    spawnTick: game ? game.tick : 0,
  };
}

function getEnt(id) {
  if (!id) return null;
  return game.units.get(id) || game.buildings.get(id) || null;
}

// ---- occupancy / passability ----------------------------------------------

function occAt(cx, cy) { return inMap(cx, cy) ? game.occ[cellIdx(cx, cy)] : -1; }
function setOcc(cx, cy, id) { if (inMap(cx, cy)) game.occ[cellIdx(cx, cy)] = id; }
function clearOcc(cx, cy, id) {
  if (inMap(cx, cy) && game.occ[cellIdx(cx, cy)] === id) game.occ[cellIdx(cx, cy)] = 0;
}

function terrainPassable(t) { return t === 0 || t === 1 || t === 6; } // grass, dirt, bridge

// Is cell enterable by `unit` (or by any ground unit if unit omitted)?
// Air units never call this. Occupied-by-self is passable.
function isPassable(cx, cy, unit) {
  if (!inMap(cx, cy)) return false;
  if (!terrainPassable(game.terrain[cellIdx(cx, cy)])) return false;
  const o = game.occ[cellIdx(cx, cy)];
  if (o === 0) return true;
  if (unit && o === unit.id) return true;
  // crushers may enter cells held by enemy infantry
  if (unit) {
    const ent = getEnt(o);
    if (ent && ent.kind === 'unit' && DATA.units[unit.type].crush &&
        ent.owner !== unit.owner && DATA.units[ent.type].infantry) return true;
  }
  return false;
}

function footprintCells(b) {
  const cells = [];
  const d = DATA.buildings[b.type] || b; // accept building or {cx,cy,w,h}
  const w = b.w || d.w, h = b.h || d.h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.push({ cx: b.cx + x, cy: b.cy + y });
  return cells;
}

// ---- registry mutation -----------------------------------------------------

function addUnit(u) {
  game.units.set(u.id, u);
  game.players[u.owner].unitIds.push(u.id);
  if (!DATA.units[u.type].air) setOcc(worldToCell(u.x), worldToCell(u.y), u.id);
  return u;
}

function addBuilding(b) {
  game.buildings.set(b.id, b);
  game.players[b.owner].buildingIds.push(b.id);
  for (const c of footprintCells(b)) setOcc(c.cx, c.cy, b.id);
  return b;
}

function removeUnit(u) {
  game.units.delete(u.id);
  const ids = game.players[u.owner].unitIds;
  const i = ids.indexOf(u.id); if (i >= 0) ids.splice(i, 1);
  clearOcc(worldToCell(u.x), worldToCell(u.y), u.id);
  // a unit removed mid-step still holds its committed next cell — release it,
  // or the cell stays marked with a dead id forever (a phantom wall)
  if (u._commit >= 0) clearOcc(u._commit % C.MAP_W, (u._commit / C.MAP_W) | 0, u.id);
  if (game.selection.includes(u.id)) game.selection = game.selection.filter(id => id !== u.id);
}

function removeBuilding(b) {
  game.buildings.delete(b.id);
  const ids = game.players[b.owner].buildingIds;
  const i = ids.indexOf(b.id); if (i >= 0) ids.splice(i, 1);
  for (const c of footprintCells(b)) clearOcc(c.cx, c.cy, b.id);
  if (game.selection.includes(b.id)) game.selection = game.selection.filter(id => id !== b.id);
}

// ---- damage ----------------------------------------------------------------

// Apply damage with warhead/armor scaling. Calls killEntity (sim.js) at <= 0 hp.
function applyDamage(target, amount, warhead, attacker) {
  if (!target || target.hp <= 0) return;
  const d = target.kind === 'unit' ? DATA.units[target.type] : DATA.buildings[target.type];
  const mult = (DATA.warheads[warhead] || DATA.warheads.he)[d.armor];
  const dmg = Math.max(1, Math.round(amount * mult));
  target.hp -= dmg;
  target._hitT = game.tick;           // brief white hit-flash (render)
  EV.emit('damaged', target, attacker, dmg);
  if (target.hp <= 0) {
    target.hp = 0;
    killEntity(target, attacker); // defined in sim.js
  }
}
