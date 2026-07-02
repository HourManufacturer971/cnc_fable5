'use strict';
// sprites_terrain.js — terrain tiles, tiberium, FX, cursors, faction logos, shroud edges.
// Fills SPRITES.terrain / .tiberium / .fx / .cursor / .logo / .shroudEdge (registry in core.js).
// Everything is generated at load time with integer fillRect pixels. No new globals.

(function () {
  // Defensive boot: bail silently if the DOM or core.js are unavailable.
  if (typeof document === 'undefined' || typeof SPRITES === 'undefined' ||
      typeof mkCanvas === 'undefined' || typeof PAL === 'undefined') return;

  // Cosmetic-only deterministic rng (art is stable across loads; never game.rng).
  const R = mulberry(0xA55E71);
  function ri(n) { return (R() * n) | 0; }

  // ---- local shade ramps (PAL-derived extras for 3-4 step materials) ---------
  const GRASS_HI = '#688a44', GRASS_DK = '#38502a', GRASS_FLOWER = '#d8cc70';
  const DIRT_HI = '#b09a68', DIRT_DK = '#6a5a38', DIRT_RUT = '#5e4e30';
  const ROCK_HI = '#a2a296', ROCK_MOSS = '#5a6a42';
  const WATER_GLINT = '#7fb6d8', WATER_SPARK = '#b8e0f0', WATER_DEEP = '#173a58';
  const GOLD_L = '#f0dc98', GOLD = '#dcb648', GOLD_D = '#a8842c', GOLD_S = '#6a5418';
  const NAVY_BG = '#0e1628', NAVY = '#1b2a4a', NAVY_L = '#243a64', NAVY_OUT = '#070c18';
  const RED_L = '#e8503a', RED = '#b02818', RED_D = '#701410', RED_S = '#3c0a06';
  const SMOKE_L = '#6a6a6a', SMOKE_XL = '#8a8a8a', WHITE_HOT = '#fffbe8';

  // ---- drawing helpers -------------------------------------------------------

  function mk(w, h) {
    const c = mkCanvas(w, h);
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    return { c, g };
  }

  // filled pixel disk (row-run fillRects)
  function disk(g, cx, cy, r, color) {
    g.fillStyle = color;
    for (let y = -r; y <= r; y++) {
      const w = Math.floor(Math.sqrt(r * r - y * y + 0.25));
      g.fillRect(cx - w, cy + y, w * 2 + 1, 1);
    }
  }

  // filled pixel ellipse
  function ell(g, cx, cy, rx, ry, color) {
    g.fillStyle = color;
    for (let y = -ry; y <= ry; y++) {
      const w = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))) + 0.5);
      g.fillRect(cx - w, cy + y, w * 2 + 1, 1);
    }
  }

  // pixel ring (donut) between radii
  function ring(g, cx, cy, ro, rIn, color) {
    g.fillStyle = color;
    for (let y = -ro; y <= ro; y++) {
      const wo = Math.floor(Math.sqrt(ro * ro - y * y + 0.25));
      if (Math.abs(y) > rIn) {
        g.fillRect(cx - wo, cy + y, wo * 2 + 1, 1);
      } else {
        const wi = Math.floor(Math.sqrt(rIn * rIn - y * y + 0.25));
        g.fillRect(cx - wo, cy + y, wo - wi, 1);
        g.fillRect(cx + wi + 1, cy + y, wo - wi, 1);
      }
    }
  }

  // vertical diamond (crystal facet)
  function diamond(g, cx, cy, s, color) {
    g.fillStyle = color;
    for (let j = -s; j <= s; j++) {
      const w = s - Math.abs(j);
      g.fillRect(cx - w, cy + j, w * 2 + 1, 1);
    }
  }

  // bitmap from string rows; map = {char: color}; chars not in map are transparent
  function bmp(rows, map, scale) {
    scale = scale || 1;
    let w = 0;
    for (const r of rows) w = Math.max(w, r.length);
    const t = mk(w * scale, rows.length * scale);
    for (let y = 0; y < rows.length; y++) {
      for (let x = 0; x < rows[y].length; x++) {
        const col = map[rows[y][x]];
        if (col) { t.g.fillStyle = col; t.g.fillRect(x * scale, y * scale, scale, scale); }
      }
    }
    return t.c;
  }

  // copy src onto a canvas m px bigger on every side
  function pad(src, m) {
    const t = mk(src.width + 2 * m, src.height + 2 * m);
    t.g.drawImage(src, m, m);
    return t.c;
  }

  // recolor all opaque pixels
  function tint(src, color) {
    const t = mk(src.width, src.height);
    t.g.drawImage(src, 0, 0);
    t.g.globalCompositeOperation = 'source-in';
    t.g.fillStyle = color;
    t.g.fillRect(0, 0, src.width, src.height);
    return t.c;
  }

  // add a 1px outline around every opaque pixel (keep 1px margin in src)
  function outline(src, color) {
    const sil = tint(src, color || PAL.outline);
    const t = mk(src.width, src.height);
    const offs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const o of offs) t.g.drawImage(sil, o[0], o[1]);
    t.g.drawImage(src, 0, 0);
    return t.c;
  }

  // stack layers (all same size) into a new canvas
  function stack() {
    const t = mk(arguments[0].width, arguments[0].height);
    for (let i = 0; i < arguments.length; i++) t.g.drawImage(arguments[i], 0, 0);
    return t.c;
  }

  // rotate by q quarter turns (pixel-exact for even sizes)
  function rotQ(src, q) {
    const t = mk(src.width, src.height);
    t.g.translate(src.width / 2, src.height / 2);
    t.g.rotate(q * Math.PI / 2);
    t.g.drawImage(src, -src.width / 2, -src.height / 2);
    return t.c;
  }

  // ==== TERRAIN ================================================================

  // grass: mottled olive base, clumped tufts in 3 greens, occasional detail pixel
  function grassTile(v) {
    const t = mk(24, 24);
    t.g.fillStyle = PAL.grass1;
    t.g.fillRect(0, 0, 24, 24);
    // broad mottle: soft blotches of the darker/lighter greens
    for (let i = 0; i < 7; i++) {
      const x = ri(24), y = ri(24), w = 2 + ri(4);
      t.g.fillStyle = R() < 0.5 ? PAL.grass3 : PAL.grass2;
      t.g.fillRect(x, y, w, 1);
      if (R() < 0.6) t.g.fillRect(x + 1, y + 1, Math.max(1, w - 2), 1);
    }
    // fine grain
    const cols = [PAL.grass2, PAL.grass3, PAL.grass4, GRASS_DK];
    for (let i = 0; i < 30; i++) {
      t.g.fillStyle = cols[ri(cols.length)];
      t.g.fillRect(ri(24), ri(24), 1 + ri(2), 1);
    }
    // grass tufts: little clumps of 2-3 blades with a dark root shadow
    for (let i = 0; i < 4; i++) {
      const x = 2 + ri(19), y = 3 + ri(18);
      t.g.fillStyle = GRASS_DK; t.g.fillRect(x - 1, y + 1, 3, 1);
      t.g.fillStyle = PAL.grass4;
      t.g.fillRect(x - 1, y, 1, 2); t.g.fillRect(x + 1, y - 1, 1, 3);
      t.g.fillStyle = GRASS_HI; t.g.fillRect(x, y - 1, 1, 2);
    }
    // signature detail per variant: flower / pebble / bare patch
    if (v === 0) {
      const x = 4 + ri(16), y = 4 + ri(16);
      t.g.fillStyle = GRASS_FLOWER;
      t.g.fillRect(x, y, 1, 1); t.g.fillRect(x + 1, y - 1, 1, 1);
      t.g.fillStyle = '#a89040'; t.g.fillRect(x + 1, y, 1, 1);
    } else if (v === 2) {
      const x = 4 + ri(16), y = 4 + ri(16);
      t.g.fillStyle = PAL.rock3; t.g.fillRect(x, y, 2, 2);
      t.g.fillStyle = PAL.rock2; t.g.fillRect(x, y, 1, 1);
      t.g.fillStyle = GRASS_DK; t.g.fillRect(x - 1, y + 2, 4, 1);
    } else if (v === 3) {
      const x = 3 + ri(14), y = 3 + ri(14);
      t.g.fillStyle = PAL.dirt3; t.g.fillRect(x, y + 1, 4, 2);
      t.g.fillStyle = PAL.dirt1; t.g.fillRect(x + 1, y + 1, 2, 1);
    }
    return t.c;
  }

  // dirt: tan base with dither, pebbles with lit tops, faint wheel-rut hints
  function dirtTile(v) {
    const t = mk(24, 24);
    t.g.fillStyle = PAL.dirt1;
    t.g.fillRect(0, 0, 24, 24);
    // broad tonal blotches
    for (let i = 0; i < 6; i++) {
      const x = ri(24), y = ri(24), w = 3 + ri(5);
      t.g.fillStyle = R() < 0.5 ? PAL.dirt3 : PAL.dirt2;
      t.g.fillRect(x, y, w, 1);
      t.g.fillRect(x + 1, y + 1, Math.max(1, w - 2), 1);
    }
    const cols = [PAL.dirt2, PAL.dirt3, DIRT_HI, DIRT_DK];
    for (let i = 0; i < 26; i++) {
      t.g.fillStyle = cols[ri(cols.length)];
      t.g.fillRect(ri(24), ri(24), 1 + ri(2), 1);
    }
    // wheel-rut hints: two faint straight worn tracks on one variant
    if (v === 1) {
      for (let x = 0; x < 24; x++) {
        if ((x & 7) === 6) continue;               // broken, weathered tracks
        t.g.fillStyle = DIRT_RUT; t.g.fillRect(x, 9, 1, 1); t.g.fillRect(x, 15, 1, 1);
        if ((x & 3) === 1) {
          t.g.fillStyle = DIRT_HI; t.g.fillRect(x, 8, 1, 1); t.g.fillRect(x, 14, 1, 1);
        }
      }
    }
    // pebbles: shadow, body, lit top-left
    for (let i = 0; i < 4; i++) {
      const x = 2 + ri(20), y = 2 + ri(20);
      t.g.fillStyle = DIRT_DK; t.g.fillRect(x, y + 1, 3, 1);
      t.g.fillStyle = PAL.rock1; t.g.fillRect(x, y, 2, 1);
      t.g.fillStyle = PAL.rock2; t.g.fillRect(x, y, 1, 1);
    }
    return t.c;
  }

  // boulder with cast shadow, 3-shade rounding, top glint and cracks
  function boulder(g, cx, cy, r) {
    // soft cast shadow to the bottom-right (light source top-left)
    ell(g, cx + 2, cy + r - 1, r, Math.max(2, r >> 1), 'rgba(16,16,8,0.35)');
    disk(g, cx, cy, r + 1, PAL.outline);
    disk(g, cx, cy, r, PAL.rock1);
    // bottom-right core shadow
    g.fillStyle = PAL.rock3;
    for (let y = Math.max(1, Math.floor(r * 0.25)); y <= r; y++) {
      const w = Math.floor(Math.sqrt(r * r - y * y + 0.25));
      g.fillRect(cx - w + Math.max(1, y >> 1), cy + y, w * 2, 1);
    }
    // top-left mid tone + highlight
    disk(g, cx - Math.max(1, r >> 2), cy - Math.max(1, r >> 2), Math.max(1, r - 2), PAL.rock2);
    disk(g, cx - Math.max(1, r >> 1), cy - Math.max(1, r >> 1), Math.max(1, r - 4), ROCK_HI);
    if (r >= 5) { g.fillStyle = '#c0c0b4'; g.fillRect(cx - (r >> 1), cy - (r >> 1), 2, 1); }
    // one crack toward the lower-right + moss fleck
    g.fillStyle = PAL.rock3;
    g.fillRect(cx + 1 + ri(2), cy + 1, 1, 2);
    g.fillRect(cx + 2 + ri(2), cy + 3, 1, 1);
    if (r >= 5) { g.fillStyle = ROCK_MOSS; g.fillRect(cx - r + 1, cy + (r >> 1), 2, 1); }
  }

  function rockTile(v) {
    const t = mk(24, 24);
    t.g.drawImage(dirtTile(0), 0, 0);
    if (v === 0) { boulder(t.g, 11, 11, 8); boulder(t.g, 19, 18, 3); }
    else if (v === 1) { boulder(t.g, 8, 9, 5); boulder(t.g, 16, 15, 6); }
    else { boulder(t.g, 7, 15, 4); boulder(t.g, 15, 7, 4); boulder(t.g, 17, 17, 4); }
    // scattered rubble
    for (let i = 0; i < 3; i++) {
      const x = 2 + ri(20), y = 2 + ri(20);
      t.g.fillStyle = PAL.rock3; t.g.fillRect(x, y, 2, 1);
      t.g.fillStyle = PAL.rock2; t.g.fillRect(x, y, 1, 1);
    }
    return t.c;
  }

  // water: deep base, drifting ripple lines and animated glints (3 frames loop)
  const RIPPLES = [];
  for (let i = 0; i < 12; i++) {
    RIPPLES.push({ x: ri(24), y: 1 + ri(22), len: 3 + ri(4), c: R() < 0.35 ? PAL.water3 : PAL.water2 });
  }
  const GLINTS = [];
  for (let i = 0; i < 5; i++) GLINTS.push({ x: ri(24), y: 1 + ri(22), p: ri(3) });
  function waterTile(phase) {
    const t = mk(24, 24);
    t.g.fillStyle = PAL.water1;
    t.g.fillRect(0, 0, 24, 24);
    // deep-water dither blotches (static)
    t.g.fillStyle = WATER_DEEP;
    for (let i = 0; i < 8; i++) t.g.fillRect(ri(23), ri(23), 2, 1);
    for (const rp of RIPPLES) {
      t.g.fillStyle = rp.c;
      const x = (rp.x + phase * 2) % 24;
      const l = Math.min(rp.len, 24 - x);
      t.g.fillRect(x, rp.y, l, 1);
      if (rp.len > l) t.g.fillRect(0, rp.y, rp.len - l, 1);
    }
    // sparkling glints: each glint brightens on its own frame
    for (const gl of GLINTS) {
      const on = gl.p === phase;
      t.g.fillStyle = on ? WATER_SPARK : WATER_GLINT;
      const x = (gl.x + phase) % 23;
      t.g.fillRect(x, gl.y, on ? 2 : 1, 1);
      if (on) { t.g.fillStyle = PAL.water3; t.g.fillRect((x + 23) % 23, gl.y, 1, 1); }
    }
    return t.c;
  }

  const grassVariants = [grassTile(0), grassTile(1), grassTile(2), grassTile(3)];

  // layered tree canopy: dark under-mass, mid lumps, light dapples
  function canopy(g, cx, cy, r, dark, mid, light, hi) {
    const lumps = [[0, 0, r], [-3, 1, r - 2], [3, 1, r - 2], [0, -3, r - 2], [-2, -2, r - 3]];
    for (const l of lumps) if (l[2] > 0) disk(g, cx + l[0], cy + l[1], l[2] + 1, PAL.outline);
    for (const l of lumps) if (l[2] > 0) disk(g, cx + l[0], cy + l[1], l[2], dark);
    for (const l of lumps) if (l[2] > 1) disk(g, cx + l[0] - 1, cy + l[1] - 1, l[2] - 2, mid);
    // clustered light dapples toward the top-left
    g.fillStyle = light;
    for (let i = 0; i < 9; i++) {
      const a = R() * Math.PI * 2, d = R() * (r - 2);
      const x = Math.round(cx - 1 + Math.cos(a) * d * 0.9), y = Math.round(cy - 1 + Math.sin(a) * d * 0.9);
      g.fillRect(x, y, 1 + ri(2), 1);
    }
    g.fillStyle = hi || GRASS_HI;
    g.fillRect(cx - 3, cy - r + 1, 2, 1); g.fillRect(cx - r + 2, cy - 2, 1, 1);
    // dark leaf holes for texture
    g.fillStyle = PAL.treeDark;
    g.fillRect(cx + 2, cy + 1, 1, 1); g.fillRect(cx - 2, cy + 3, 2, 1);
  }

  function treeBase(cx, cy, r) {
    const t = mk(24, 24);
    t.g.drawImage(grassVariants[ri(4)], 0, 0);
    // soft ground shadow (offset bottom-right of the trunk)
    ell(t.g, cx + 3, cy + r + 2, r - 1, 3, 'rgba(10,14,6,0.42)');
    // trunk with lit left edge and root flare
    t.g.fillStyle = PAL.outline; t.g.fillRect(cx - 2, cy + r - 3, 5, 8);
    t.g.fillStyle = '#4a3820'; t.g.fillRect(cx - 1, cy + r - 3, 3, 7);
    t.g.fillStyle = '#6a5230'; t.g.fillRect(cx - 1, cy + r - 3, 1, 6);
    t.g.fillStyle = '#2e2214'; t.g.fillRect(cx + 1, cy + r - 2, 1, 6);
    t.g.fillStyle = '#4a3820';
    t.g.fillRect(cx - 2, cy + r + 3, 1, 1); t.g.fillRect(cx + 2, cy + r + 3, 1, 1);
    return t;
  }

  function treeTile(v) {
    const cx = 11 + (v % 2), cy = 10, r = 6 + (v === 1 ? 1 : 0);
    const t = treeBase(cx, cy, r);
    canopy(t.g, cx, cy, r, PAL.treeDark, PAL.tree, PAL.treeLight);
    return t.c;
  }

  // blossom tree: big pulsing pale-pink spore pod on a gnarled trunk
  function blossomFrames() {
    const out = [];
    const cx = 12, cy = 10;
    for (let f = 0; f < 2; f++) {
      const t = mk(24, 24); const g = t.g;
      g.drawImage(grassVariants[1], 0, 0);
      // tiberium-tainted soil ring at the base
      g.fillStyle = PAL.tibDark;
      for (let i = 0; i < 8; i++) g.fillRect(4 + ri(16), 17 + ri(6), 1 + ri(2), 1);
      g.fillStyle = PAL.tib1;
      g.fillRect(6, 20, 1, 1); g.fillRect(17, 19, 1, 1); g.fillRect(11, 22, 1, 1);
      ell(g, cx + 2, 19, 6, 2, 'rgba(10,14,6,0.42)');
      // trunk
      g.fillStyle = PAL.outline; g.fillRect(cx - 2, 12, 5, 8);
      g.fillStyle = '#4a3820'; g.fillRect(cx - 1, 12, 3, 7);
      g.fillStyle = '#6a5230'; g.fillRect(cx - 1, 12, 1, 6);
      // pod: dark magenta under-sphere, pale pulsing crown
      const r = 6 + f;                       // swells on frame 1
      disk(g, cx, cy, r + 1, PAL.outline);
      disk(g, cx, cy, r, '#6e3050');
      disk(g, cx, cy - 1, r - 1, '#a05878');
      disk(g, cx - 1, cy - 2, r - 3, f === 0 ? '#d898b4' : '#f0d0dc');
      // vein lines
      g.fillStyle = '#5a2440';
      g.fillRect(cx, cy - r + 2, 1, r); g.fillRect(cx - 3, cy - 1, 2, 1); g.fillRect(cx + 2, cy, 2, 1);
      // glossy highlight
      g.fillStyle = f === 0 ? '#f0d0dc' : '#fdf2f6';
      g.fillRect(cx - 3, cy - 4, 2, 1); g.fillRect(cx - 4, cy - 3, 1, 1);
      if (f === 1) {
        // released spores drifting up
        g.fillStyle = '#f4d8e2';
        g.fillRect(cx - 5, 2, 1, 1); g.fillRect(cx + 4, 1, 1, 1); g.fillRect(cx + 7, 4, 1, 1);
        g.fillStyle = '#e8c0d0';
        g.fillRect(cx - 2, 1, 1, 1); g.fillRect(cx + 6, 7, 1, 1);
      }
      out.push(t.c);
    }
    return out;
  }

  SPRITES.terrain[0] = grassVariants;
  SPRITES.terrain[1] = [dirtTile(0), dirtTile(1), dirtTile(2)];
  SPRITES.terrain[2] = [rockTile(0), rockTile(1), rockTile(2)];
  SPRITES.terrain[3] = [waterTile(0), waterTile(1), waterTile(2)];
  SPRITES.terrain[4] = [treeTile(0), treeTile(1), treeTile(2)];
  SPRITES.terrain[5] = blossomFrames();

  // ==== TIBERIUM ===============================================================

  // faceted crystal: lit left face, shaded right face, sparkling tip
  function crystal(g, cx, cy, s) {
    diamond(g, cx, cy, s + 1, PAL.tibDark);
    // right (shaded) face
    g.fillStyle = PAL.tib1;
    for (let j = -s; j <= s; j++) {
      const w = s - Math.abs(j);
      g.fillRect(cx, cy + j, w + 1, 1);
    }
    // left (lit) face
    g.fillStyle = PAL.tib2;
    for (let j = -s; j <= s; j++) {
      const w = s - Math.abs(j);
      g.fillRect(cx - w, cy + j, w, 1);
    }
    // facet seam + tip sparkle
    g.fillStyle = PAL.tib3;
    g.fillRect(cx, cy - s + 1, 1, Math.max(1, s - 1));
    if (s >= 3) { g.fillRect(cx - 1, cy - 1, 1, 1); }
    g.fillStyle = '#e0ffe4';
    g.fillRect(cx, cy - s, 1, 1);
  }

  function tibCanvas(n, maxS, carpet) {
    const t = mk(24, 24); const g = t.g;
    // green under-glow soaked into the soil (stronger with density)
    g.globalAlpha = carpet ? 0.38 : n > 4 ? 0.18 : 0.1;
    disk(g, 12, 13, carpet ? 11 : n > 4 ? 8 : 6, PAL.tibDark);
    g.globalAlpha = 1;
    if (carpet) {
      g.fillStyle = PAL.tibDark;
      for (let i = 0; i < 24; i++) g.fillRect(1 + ri(22), 1 + ri(22), 1 + ri(2), 1);
      g.fillStyle = PAL.tib1;
      for (let i = 0; i < 8; i++) g.fillRect(2 + ri(20), 2 + ri(20), 1, 1);
    }
    for (let i = 0; i < n; i++) {
      const s = 2 + ri(maxS - 1);
      const x = clamp(3 + ri(18), s + 2, 21 - s);
      const y = clamp(4 + ri(16), s + 2, 21 - s);
      crystal(g, x, y, s);
    }
    // loose shard sparkles between crystals
    const shards = carpet ? 5 : n >= 6 ? 3 : 2;
    for (let i = 0; i < shards; i++) {
      const x = 2 + ri(20), y = 3 + ri(18);
      g.fillStyle = PAL.tib2; g.fillRect(x, y, 1, 2);
      g.fillStyle = PAL.tib3; g.fillRect(x, y, 1, 1);
    }
    return t.c;
  }

  SPRITES.tiberium.push(tibCanvas(3, 3, false), tibCanvas(6, 3, false), tibCanvas(12, 4, true));

  // ==== FX =====================================================================

  function sparks(g, cx, cy, rad, n, color) {
    g.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, d = rad * (0.7 + R() * 0.3);
      g.fillRect(Math.round(cx + Math.sin(a) * d), Math.round(cy - Math.cos(a) * d), 1, 1);
    }
  }

  function fireball(g, cx, cy, r) {
    disk(g, cx, cy, r, PAL.fire3);
    if (r > 2) disk(g, cx - 1, cy - 1, Math.max(1, Math.round(r * 0.68)), PAL.fire2);
    if (r > 3) disk(g, cx - 1, cy - 1, Math.max(1, Math.round(r * 0.4)), PAL.fire1);
    if (r > 4) disk(g, cx - 1, cy - 1, Math.max(1, Math.round(r * 0.18)), WHITE_HOT);
  }

  // one 8-phase explosion: white flash -> fireball -> dark fire -> rolling smoke
  function expPhase(g, cx, cy, phase, s) {
    const r = Math.round;
    if (phase === 0) {
      disk(g, cx, cy, r(2.5 * s), WHITE_HOT);
      disk(g, cx, cy, Math.max(1, r(1.2 * s)), '#ffffff');
      g.fillStyle = WHITE_HOT;
      g.fillRect(cx - r(4 * s), cy, r(8 * s) + 1, 1);
      g.fillRect(cx, cy - r(4 * s), 1, r(8 * s) + 1);
    } else if (phase === 1) {
      fireball(g, cx, cy, r(4 * s));
      disk(g, cx - 1, cy - 1, Math.max(1, r(2 * s)), WHITE_HOT);
      sparks(g, cx, cy, r(5.5 * s), 6, PAL.fire1);
    } else if (phase === 2) {
      fireball(g, cx, cy, r(6 * s));
      sparks(g, cx, cy, r(8 * s), 8, PAL.fire2);
      sparks(g, cx, cy, r(7 * s), 4, PAL.fire1);
    } else if (phase === 3) {
      fireball(g, cx, cy, r(7.5 * s));
      // charred bites out of the edge
      g.fillStyle = PAL.smoke;
      g.fillRect(cx - r(6 * s), cy - r(4 * s), r(2 * s), r(2 * s));
      g.fillRect(cx + r(4 * s), cy + r(3 * s), r(2.5 * s), r(2 * s));
      sparks(g, cx, cy, r(9 * s), 8, PAL.fire3);
    } else if (phase === 4) {
      g.globalAlpha *= 0.92;
      disk(g, cx, cy, r(7.5 * s), PAL.smoke);
      disk(g, cx - r(2 * s), cy - r(2 * s), r(4 * s), SMOKE_L);
      g.globalAlpha /= 0.92;
      disk(g, cx - r(2 * s), cy + r(s), r(3 * s), PAL.fire3);
      disk(g, cx + r(2 * s), cy - r(s), r(2.5 * s), PAL.fire2);
      disk(g, cx + r(s), cy + r(2 * s), Math.max(1, r(1.2 * s)), PAL.fire1);
    } else if (phase === 5) {
      const a = g.globalAlpha;
      g.globalAlpha = a * 0.8;
      disk(g, cx - r(2 * s), cy - r(2 * s), r(4.5 * s), '#4c4c4c');
      disk(g, cx + r(3 * s), cy - r(s), r(3.5 * s), PAL.smoke);
      disk(g, cx, cy + r(2 * s), r(3.5 * s), '#585858');
      disk(g, cx - r(3 * s), cy - r(3 * s), r(2 * s), SMOKE_L);
      g.globalAlpha = a;
      disk(g, cx + r(s), cy + r(s), Math.max(1, r(1.5 * s)), PAL.fire3);
      g.fillStyle = PAL.fire2;
      g.fillRect(cx - r(2 * s), cy, 1, 1); g.fillRect(cx + r(3 * s), cy + r(2 * s), 1, 1);
    } else if (phase === 6) {
      const a = g.globalAlpha;
      g.globalAlpha = a * 0.6;
      disk(g, cx - r(s), cy - r(3 * s), r(4 * s), '#606060');
      disk(g, cx + r(2 * s), cy - r(4 * s), r(3 * s), '#525252');
      disk(g, cx - r(3 * s), cy - r(s), r(2.5 * s), SMOKE_L);
      g.globalAlpha = a;
      g.fillStyle = PAL.fire3;
      g.fillRect(cx, cy + r(s), 1, 1);
    } else {
      const a = g.globalAlpha;
      g.globalAlpha = a * 0.35;
      disk(g, cx - r(s), cy - r(5 * s), r(3.5 * s), SMOKE_L);
      disk(g, cx + r(2.5 * s), cy - r(5.5 * s), r(2.5 * s), SMOKE_XL);
      disk(g, cx - r(3 * s), cy - r(3.5 * s), r(2 * s), '#787878');
      g.globalAlpha = a;
    }
  }

  const fx = SPRITES.fx;

  // small explosion 8x 24x24
  fx.expS = [];
  for (let p = 0; p < 8; p++) {
    const t = mk(24, 24);
    expPhase(t.g, 12, 13, p, 1);
    fx.expS.push(t.c);
  }

  // large explosion 10x 48x48 (shockwave ring + staggered multi-burst)
  fx.expL = [];
  {
    const centers = [[24, 26, 0], [15, 20, 1], [33, 21, 2], [23, 12, 3], [30, 30, 3]];
    for (let f = 0; f < 10; f++) {
      const t = mk(48, 48);
      if (f === 1) {
        // faint expanding heat shockwave, one frame only
        t.g.globalAlpha = 0.4;
        ring(t.g, 24, 25, 16, 15, '#f8e8c0');
        t.g.globalAlpha = 0.18;
        ring(t.g, 24, 25, 18, 16, '#ffffff');
        t.g.globalAlpha = 1;
      }
      for (const c of centers) {
        const p = f - c[2];
        if (p >= 0 && p <= 7) expPhase(t.g, c[0], c[1], p, 1.3);
      }
      fx.expL.push(t.c);
    }
  }

  // muzzle flash 2x 8x8 (hot white star, then orange fade)
  fx.muzzle = [];
  {
    const t0 = mk(8, 8);
    t0.g.fillStyle = PAL.fire2;
    t0.g.fillRect(2, 2, 1, 1); t0.g.fillRect(5, 2, 1, 1);
    t0.g.fillRect(2, 5, 1, 1); t0.g.fillRect(5, 5, 1, 1);
    t0.g.fillStyle = PAL.fire1;
    t0.g.fillRect(3, 0, 2, 8); t0.g.fillRect(0, 3, 8, 2);
    t0.g.fillStyle = WHITE_HOT;
    t0.g.fillRect(3, 1, 2, 6); t0.g.fillRect(1, 3, 6, 2);
    t0.g.fillStyle = '#ffffff';
    t0.g.fillRect(3, 3, 2, 2);
    const t1 = mk(8, 8);
    t1.g.fillStyle = PAL.fire3;
    t1.g.fillRect(3, 1, 2, 6); t1.g.fillRect(1, 3, 6, 2);
    t1.g.fillStyle = PAL.fire2;
    t1.g.fillRect(3, 2, 2, 4); t1.g.fillRect(2, 3, 4, 2);
    t1.g.fillStyle = PAL.fire1;
    t1.g.fillRect(3, 3, 2, 2);
    fx.muzzle.push(t0.c, t1.c);
  }

  // smoke 4x 16x16 — soft layered alpha puffs rising and thinning
  fx.smoke = [];
  for (let i = 0; i < 4; i++) {
    const t = mk(16, 16); const g = t.g;
    const cy = Math.round(12 - i * 2.7), r = 2 + i;
    g.globalAlpha = 0.32 - i * 0.04;
    disk(g, 8, cy, r + 1, PAL.smoke);
    g.globalAlpha = 0.5 - i * 0.09;
    disk(g, 8, cy, r, PAL.smoke);
    disk(g, 9, cy + 1, Math.max(1, r - 1), '#333333');
    g.globalAlpha = 0.55 - i * 0.1;
    disk(g, 7, cy - 1, Math.max(1, r - 1), SMOKE_L);
    g.globalAlpha = 0.4 - i * 0.07;
    disk(g, 6, cy - 2, Math.max(1, r - 2), SMOKE_XL);
    disk(g, 8, Math.min(14, cy + r + 1), 1, PAL.smoke);
    g.globalAlpha = 1;
    fx.smoke.push(t.c);
  }

  // flame jet 3x 16x16 (points up, base at bottom): white root, yellow core, orange licks
  fx.flame = [];
  for (let f = 0; f < 3; f++) {
    const t = mk(16, 16); const g = t.g;
    const halves = [3, 3, 3, 2, 2, 2, 1, 1, 1, 1, 0, 0, 0];
    for (let i = 0; i < 13; i++) {
      const y = 15 - i;
      let h = halves[i];
      if (i > 3 && (i + f) % 3 === 0) h += 1;
      const dx = i > 5 ? ((i + f) % 2 === 0 ? 1 : -1) : 0;
      g.fillStyle = i < 8 ? PAL.fire2 : PAL.fire3;
      g.fillRect(8 - h + dx, y, h * 2 + 1, 1);
      if (i < 7 && h > 0) {
        g.fillStyle = PAL.fire1;
        g.fillRect(8 - h + 1 + dx, y, Math.max(1, h * 2 - 1), 1);
      }
      if (i < 3) {
        g.fillStyle = WHITE_HOT;
        g.fillRect(8 - 1, y, 3, 1);
      }
    }
    // detached licks and embers
    g.fillStyle = PAL.fire3;
    g.fillRect(8 + (f % 2 === 0 ? -2 : 2), 3, 1, 2);
    g.fillRect(8 + (f % 2 === 0 ? 1 : -1), 1, 1, 1);
    g.fillStyle = PAL.fire2;
    g.fillRect(8 + (f === 1 ? 2 : -2), 6, 1, 1);
    fx.flame.push(t.c);
  }

  // scorch mark 1x 24x24 — charred splat with sooty rim and ember flecks
  {
    const t = mk(24, 24); const g = t.g;
    g.globalAlpha = 0.35;
    disk(g, 12, 12, 10, '#1c1610');
    g.globalAlpha = 0.55;
    disk(g, 12, 12, 8, '#14100a');
    for (let i = 0; i < 8; i++) {
      const a = R() * Math.PI * 2;
      disk(g, Math.round(12 + Math.cos(a) * 8), Math.round(12 + Math.sin(a) * 7), 1 + ri(2), '#14100a');
    }
    g.globalAlpha = 0.8;
    disk(g, 12, 12, 4, '#0a0806');
    g.globalAlpha = 0.5;
    // soot streak rays
    g.fillStyle = '#0e0c08';
    for (let i = 0; i < 6; i++) {
      const a = R() * Math.PI * 2, d = 9 + ri(3);
      g.fillRect(Math.round(12 + Math.cos(a) * d), Math.round(12 + Math.sin(a) * d), 2, 1);
    }
    g.globalAlpha = 0.7;
    g.fillStyle = PAL.fire3;
    g.fillRect(10, 11, 1, 1); g.fillRect(14, 13, 1, 1);
    g.globalAlpha = 1;
    fx.scorch = [t.c];
  }

  // crater 1x 24x24 — raised lit rim, dark pit, charred floor, debris
  {
    const t = mk(24, 24); const g = t.g;
    ell(g, 13, 14, 10, 8, 'rgba(16,12,6,0.4)');
    disk(g, 12, 12, 9, '#4c4232');
    // lit rim upper-left
    g.fillStyle = DIRT_HI;
    for (let a = 3.0; a <= 5.2; a += 0.16) {
      g.fillRect(Math.round(12 + Math.cos(a) * 8), Math.round(12 + Math.sin(a) * 8), 2, 1);
    }
    disk(g, 12, 12, 7, '#302818');
    disk(g, 12, 13, 4, '#16120c');
    // charred streaks on the floor
    g.fillStyle = '#0e0c08';
    g.fillRect(10, 12, 4, 1); g.fillRect(12, 14, 3, 1);
    // dark inner rim shadow lower-right
    g.fillStyle = '#221c10';
    for (let a = -0.2; a <= 1.4; a += 0.18) {
      g.fillRect(Math.round(12 + Math.cos(a) * 7), Math.round(12 + Math.sin(a) * 7), 2, 1);
    }
    // ejected debris
    g.fillStyle = '#4c4232';
    for (let i = 0; i < 7; i++) {
      const a = R() * Math.PI * 2, d = 10 + R() * 1.5;
      g.fillRect(Math.round(12 + Math.cos(a) * d), Math.round(12 + Math.sin(a) * d), 1 + ri(2), 1);
    }
    g.fillStyle = DIRT_HI;
    g.fillRect(4, 6, 1, 1); g.fillRect(19, 16, 1, 1);
    fx.crater = [t.c];
  }

  // nuke mushroom cloud 8x 64x64 — flash column, rising fireball, rolling cap
  fx.nukeCloud = [];
  for (let f = 0; f < 8; f++) {
    const t = mk(64, 64); const g = t.g;
    if (f === 0) {
      // searing light column
      g.globalAlpha = 0.5;
      g.fillStyle = PAL.fire2; g.fillRect(23, 2, 18, 56);
      g.globalAlpha = 0.9;
      g.fillStyle = PAL.fire1; g.fillRect(27, 2, 10, 56);
      g.globalAlpha = 1;
      g.fillStyle = WHITE_HOT; g.fillRect(30, 2, 4, 56);
      disk(g, 32, 56, 11, PAL.fire1);
      disk(g, 32, 56, 7, '#ffffff');
    } else if (f === 1) {
      // ground flash + shock ring
      g.globalAlpha = 0.75;
      ring(g, 32, 56, 21, 18, WHITE_HOT);
      g.globalAlpha = 1;
      disk(g, 32, 56, 12, PAL.fire2);
      disk(g, 32, 55, 8, PAL.fire1);
      disk(g, 32, 55, 4, '#ffffff');
      g.fillStyle = PAL.fire1; g.fillRect(29, 30, 6, 26);
      g.fillStyle = WHITE_HOT; g.fillRect(31, 34, 2, 22);
      sparks(g, 32, 46, 15, 10, PAL.fire1);
    } else if (f === 2) {
      disk(g, 32, 58, 10, PAL.fire3);
      g.fillStyle = PAL.fire3; g.fillRect(27, 44, 10, 15);
      g.fillStyle = PAL.fire2; g.fillRect(29, 44, 6, 14);
      disk(g, 32, 40, 12, PAL.fire3);
      disk(g, 31, 38, 9, PAL.fire2);
      disk(g, 30, 37, 5, PAL.fire1);
      disk(g, 30, 36, 2, WHITE_HOT);
      sparks(g, 32, 40, 15, 10, PAL.fire2);
    } else if (f === 3) {
      disk(g, 32, 58, 12, PAL.smoke);
      disk(g, 32, 57, 8, PAL.fire3);
      g.fillStyle = PAL.fire3; g.fillRect(27, 36, 10, 22);
      g.fillStyle = PAL.fire2; g.fillRect(29, 36, 5, 20);
      disk(g, 32, 26, 14, PAL.fire3);
      disk(g, 30, 24, 10, PAL.fire2);
      disk(g, 29, 23, 5, PAL.fire1);
      // cap starting to curl at the edges
      disk(g, 19, 30, 4, PAL.fire3); disk(g, 45, 30, 4, PAL.fire3);
      sparks(g, 32, 26, 17, 8, PAL.fire2);
    } else if (f === 4) {
      disk(g, 32, 57, 14, '#565656');
      disk(g, 32, 56, 9, PAL.fire3);
      g.fillStyle = '#4c4c4c'; g.fillRect(26, 24, 12, 30);
      g.fillStyle = PAL.fire3; g.fillRect(29, 26, 6, 24);
      g.fillStyle = PAL.fire2; g.fillRect(31, 30, 2, 16);
      disk(g, 32, 18, 16, PAL.smoke);
      disk(g, 31, 17, 12, PAL.fire3);
      disk(g, 29, 16, 8, PAL.fire2);
      disk(g, 28, 15, 4, PAL.fire1);
      // rolling curls
      disk(g, 19, 26, 5, PAL.smoke); disk(g, 45, 26, 5, PAL.smoke);
      disk(g, 18, 25, 3, PAL.fire3); disk(g, 44, 25, 3, PAL.fire3);
      g.fillStyle = '#2e2e2e'; g.fillRect(22, 28, 20, 2);
    } else if (f === 5) {
      g.globalAlpha = 0.95;
      disk(g, 32, 56, 14, '#565656');
      g.fillStyle = '#505050'; g.fillRect(26, 20, 13, 34);
      g.fillStyle = PAL.fire3; g.fillRect(29, 28, 6, 16);
      disk(g, 32, 15, 19, '#5a5a5a');
      disk(g, 30, 14, 13, PAL.fire3);
      disk(g, 29, 13, 7, PAL.fire2);
      // cap rolling outward: curls beyond the dome
      disk(g, 13, 20, 6, '#5e5e5e'); disk(g, 51, 20, 6, '#5e5e5e');
      disk(g, 12, 19, 4, '#525252'); disk(g, 50, 19, 3, PAL.fire3);
      disk(g, 14, 18, 2, PAL.fire3);
      g.fillStyle = '#303030'; g.fillRect(20, 26, 24, 2);
      g.globalAlpha = 1;
    } else if (f === 6) {
      g.globalAlpha = 0.85;
      disk(g, 32, 55, 13, '#5a5a5a');
      g.fillStyle = '#565656'; g.fillRect(27, 16, 11, 38);
      disk(g, 32, 12, 20, '#626262');
      disk(g, 30, 11, 13, '#6e6e6e');
      disk(g, 11, 17, 6, '#5e5e5e'); disk(g, 53, 17, 6, '#5e5e5e');
      disk(g, 10, 15, 3, SMOKE_L); disk(g, 52, 15, 3, SMOKE_L);
      g.fillStyle = PAL.fire3; g.fillRect(30, 30, 3, 6);
      disk(g, 29, 12, 3, PAL.fire3);
      g.fillStyle = '#383838'; g.fillRect(19, 22, 26, 2);
      g.globalAlpha = 1;
    } else {
      g.globalAlpha = 0.45;
      disk(g, 32, 54, 13, '#606060');
      g.fillStyle = '#5a5a5a'; g.fillRect(27, 14, 11, 38);
      disk(g, 32, 10, 20, '#686868');
      disk(g, 29, 8, 12, '#747474');
      disk(g, 10, 14, 5, '#666666'); disk(g, 54, 14, 5, '#666666');
      g.globalAlpha = 1;
    }
    fx.nukeCloud.push(t.c);
  }

  // cargo plane 1x 48x24, side view, nose pointing RIGHT, grey w/ red tail fin
  {
    const t = mk(48, 24); const g = t.g;
    // tail fin (red, swept)
    g.fillStyle = PAL.nodRed;
    for (let i = 0; i < 8; i++) g.fillRect(5, 3 + i, 2 + i, 1);
    g.fillStyle = PAL.nodRedLight;
    g.fillRect(5, 3, 2, 2); g.fillRect(6, 5, 1, 1);
    // tailplane
    g.fillStyle = PAL.nodDark; g.fillRect(2, 9, 7, 2);
    g.fillStyle = PAL.nodLight; g.fillRect(2, 9, 6, 1);
    // fuselage
    g.fillStyle = PAL.nod; g.fillRect(7, 10, 34, 7);
    g.fillRect(41, 11, 3, 5); g.fillRect(44, 12, 2, 3);   // nose taper
    g.fillRect(4, 10, 3, 4);                              // tail cone
    g.fillStyle = PAL.nodLight; g.fillRect(7, 10, 34, 2); g.fillRect(41, 11, 3, 1);
    g.fillStyle = PAL.nodDark; g.fillRect(7, 15, 34, 2); g.fillRect(41, 15, 3, 1);
    // wing (dark band) + engines
    g.fillStyle = PAL.nodDark; g.fillRect(18, 12, 12, 3); g.fillRect(16, 13, 2, 1);
    g.fillStyle = PAL.nodShadow; g.fillRect(18, 14, 12, 1);
    g.fillStyle = PAL.nodDark;
    g.fillRect(20, 17, 4, 3); g.fillRect(27, 17, 4, 3);
    g.fillStyle = PAL.nodLight; g.fillRect(20, 17, 4, 1); g.fillRect(27, 17, 4, 1);
    g.fillStyle = PAL.nodShadow; g.fillRect(20, 19, 4, 1); g.fillRect(27, 19, 4, 1);
    g.fillStyle = '#181820'; g.fillRect(19, 18, 1, 1); g.fillRect(26, 18, 1, 1);
    // cockpit + window row
    g.fillStyle = '#2c3644'; g.fillRect(38, 11, 3, 2);
    g.fillStyle = '#6a86a0'; g.fillRect(38, 11, 1, 1);
    g.fillStyle = '#2c3644';
    for (let x = 12; x <= 34; x += 4) g.fillRect(x, 12, 1, 1);
    fx.plane = [outline(t.c)];
  }

  // wrench 2x 12x12 (gold, blinking)
  const WRENCH = [
    '............',
    '...##..##...',
    '...##..##...',
    '...######...',
    '....####....',
    '.....##.....',
    '.....##.....',
    '....####....',
    '...######...',
    '...##..##...',
    '....####....',
    '............',
  ];
  {
    const w0 = outline(bmp(WRENCH, { '#': PAL.uiGold }));
    const t1 = mk(12, 12);
    t1.g.drawImage(outline(bmp(WRENCH, { '#': PAL.gdiLight })), 0, 0);
    t1.g.fillStyle = '#ffffff';
    t1.g.fillRect(4, 2, 1, 1); t1.g.fillRect(5, 5, 1, 1);
    fx.wrench = [w0, t1.c];
  }

  // squish 1x 16x16 dark red splat
  {
    const t = mk(16, 16); const g = t.g;
    g.globalAlpha = 0.9;
    disk(g, 8, 8, 5, '#701616');
    disk(g, 5, 6, 2, '#701616');
    disk(g, 11, 10, 2, '#701616');
    disk(g, 10, 4, 1, '#701616');
    disk(g, 8, 8, 3, '#4e0e0e');
    g.globalAlpha = 1;
    g.fillStyle = '#701616';
    g.fillRect(2, 3, 1, 1); g.fillRect(13, 5, 1, 1); g.fillRect(3, 12, 1, 1);
    g.fillRect(14, 12, 1, 1); g.fillRect(8, 14, 1, 1);
    g.fillStyle = '#8a2020';
    g.fillRect(6, 6, 2, 1); g.fillRect(9, 9, 1, 1);
    fx.squish = [t.c];
  }

  // ==== CURSORS ================================================================

  function cur(c, hx, hy) { return { c, hx, hy }; }
  const WHITE = '#f0f0f0';

  // universal "no" slash (white, outlined); anti = bottom-left to top-right
  function slashC(size, anti) {
    const s = mk(size, size);
    s.g.fillStyle = '#f8f8f8';
    for (let i = 2; i <= size - 5; i++) {
      s.g.fillRect(i, anti ? size - 3 - i : i, 2, 2);
    }
    return outline(s.c);
  }
  const SLASH16 = slashC(16, false), SLASH16A = slashC(16, true), SLASH20 = slashC(20, false);

  // classic arrow: white face, gold left bevel, dark outline
  const ARROW = [
    'g..........',
    'gg.........',
    'g#g........',
    'g##g.......',
    'g###g......',
    'g####g.....',
    'g#####g....',
    'g######g...',
    'g###gggg...',
    'g#g##g.....',
    'gg.g##g....',
    'g...g##g...',
    '....g##g...',
    '.....g##g..',
    '.....gggg..',
  ];
  SPRITES.cursor.default =
    cur(outline(pad(bmp(ARROW, { '#': WHITE, 'g': PAL.uiGold }), 1)), 0, 0);

  // corner brackets helper
  function drawBrackets(g, x0, y0, x1, y1, arm, thick, color) {
    g.fillStyle = color;
    g.fillRect(x0, y0, arm, thick); g.fillRect(x0, y0, thick, arm);
    g.fillRect(x1 - arm + 1, y0, arm, thick); g.fillRect(x1 - thick + 1, y0, thick, arm);
    g.fillRect(x0, y1 - thick + 1, arm, thick); g.fillRect(x0, y1 - arm + 1, thick, arm);
    g.fillRect(x1 - arm + 1, y1 - thick + 1, arm, thick); g.fillRect(x1 - thick + 1, y1 - arm + 1, thick, arm);
  }

  // select: white corner brackets with gold corner studs
  {
    const t = mk(20, 20);
    drawBrackets(t.g, 1, 1, 18, 18, 6, 2, WHITE);
    t.g.fillStyle = PAL.uiGold;
    t.g.fillRect(1, 1, 2, 2); t.g.fillRect(17, 1, 2, 2);
    t.g.fillRect(1, 17, 2, 2); t.g.fillRect(17, 17, 2, 2);
    SPRITES.cursor.select = cur(outline(t.c), 10, 10);
  }

  // attack: red brackets, inner pulse marks + hot dot
  {
    const t = mk(20, 20);
    drawBrackets(t.g, 1, 1, 18, 18, 6, 2, PAL.uiRed);
    drawBrackets(t.g, 1, 1, 18, 18, 3, 1, PAL.nodRedLight);
    drawBrackets(t.g, 5, 5, 14, 14, 3, 1, PAL.nodRedLight);
    t.g.fillStyle = PAL.nodRedLight; t.g.fillRect(9, 9, 2, 2);
    t.g.fillStyle = '#ffd0c0'; t.g.fillRect(9, 9, 1, 1);
    SPRITES.cursor.attack = cur(outline(t.c), 10, 10);
  }

  // 4-arrow cross (outward = move, inward = enter/capture)
  function arrowCrossC(color, inward, hi) {
    const q = mk(20, 20);
    q.g.fillStyle = color;
    if (inward) {
      for (let i = 0; i < 4; i++) q.g.fillRect(6 + i, 2 + i, 8 - 2 * i, 1);
    } else {
      for (let i = 0; i < 4; i++) q.g.fillRect(9 - i, 2 + i, 2 + 2 * i, 1);
      q.g.fillRect(9, 6, 2, 2);
    }
    if (hi) { q.g.fillStyle = hi; q.g.fillRect(9, 2, inward ? 2 : 2, 1); }
    const t = mk(20, 20);
    for (let k = 0; k < 4; k++) t.g.drawImage(rotQ(q.c, k), 0, 0);
    return t.c;
  }

  SPRITES.cursor.move = cur(outline(arrowCrossC(PAL.uiGreen, false, '#a8f0a8')), 10, 10);
  SPRITES.cursor.nomove = cur(stack(outline(arrowCrossC(PAL.uiRed, false)), SLASH20), 10, 10);
  SPRITES.cursor.enter = cur(outline(arrowCrossC(PAL.uiGreen, true, '#a8f0a8')), 10, 10);
  SPRITES.cursor.capture = cur(outline(arrowCrossC(PAL.uiGold, true, GOLD_L)), 10, 10);

  // harvest: green pincer + down-arrow over a crystal
  {
    const t = mk(20, 20); const g = t.g;
    g.fillStyle = PAL.uiGreen;
    g.fillRect(9, 1, 3, 3);
    for (let i = 0; i < 4; i++) g.fillRect(6 + i, 4 + i, 9 - 2 * i, 1);
    g.fillRect(3, 9, 2, 1); g.fillRect(2, 10, 2, 3); g.fillRect(3, 13, 2, 1);
    g.fillRect(15, 9, 2, 1); g.fillRect(16, 10, 2, 3); g.fillRect(15, 13, 2, 1);
    g.fillStyle = '#a8f0a8';
    g.fillRect(9, 1, 1, 2); g.fillRect(2, 10, 1, 2);
    const f = mk(20, 20);
    f.g.drawImage(outline(t.c), 0, 0);
    crystal(f.g, 10, 14, 3);
    SPRITES.cursor.harvest = cur(f.c, 10, 10);
  }

  // deploy / nodeploy: expanding double brackets
  function deployC(c1, c2) {
    const t = mk(20, 20);
    drawBrackets(t.g, 1, 1, 18, 18, 6, 2, c1);
    drawBrackets(t.g, 6, 6, 13, 13, 3, 1, c2);
    t.g.fillStyle = c2; t.g.fillRect(9, 9, 2, 2);
    return outline(t.c);
  }
  SPRITES.cursor.deploy = cur(deployC(PAL.uiGreen, '#a8f0a8'), 10, 10);
  SPRITES.cursor.nodeploy = cur(stack(deployC(PAL.uiRed, PAL.nodRedLight), SLASH20), 10, 10);

  // sell / nosell: coin with $ and a down arrow
  function coinCursor(main, hi, dark) {
    const t = mk(20, 20); const g = t.g;
    disk(g, 10, 8, 6, dark);
    disk(g, 10, 7, 6, main);
    disk(g, 8, 6, 2, hi);
    g.fillStyle = dark;
    g.fillRect(8, 4, 4, 1); g.fillRect(8, 5, 1, 1); g.fillRect(8, 6, 4, 1);
    g.fillRect(11, 7, 1, 1); g.fillRect(8, 8, 4, 1);
    g.fillRect(9, 3, 1, 1); g.fillRect(9, 9, 1, 1);
    g.fillStyle = hi;
    g.fillRect(9, 4, 2, 1);
    g.fillStyle = main;
    for (let i = 0; i < 4; i++) g.fillRect(6 + i, 15 + i, 7 - 2 * i, 1);
    g.fillStyle = hi;
    g.fillRect(6, 15, 3, 1);
    return outline(t.c);
  }
  SPRITES.cursor.sell = cur(coinCursor(PAL.uiGold, GOLD_L, '#6a4c10'), 10, 10);
  SPRITES.cursor.nosell = cur(coinCursor(PAL.nod, PAL.nodLight, '#3a3a40'), 10, 10);

  // repair / norepair: wrench
  function wrenchCursor(color, hi) {
    const t = mk(16, 16);
    t.g.drawImage(bmp(WRENCH, { '#': color }), 2, 2);
    if (hi) {
      t.g.fillStyle = hi;
      t.g.fillRect(5, 3, 1, 2); t.g.fillRect(7, 7, 1, 1);
    }
    return outline(t.c);
  }
  SPRITES.cursor.repair = cur(wrenchCursor(PAL.uiGold, GOLD_L), 8, 8);
  SPRITES.cursor.norepair = cur(wrenchCursor(PAL.nod, PAL.nodLight), 8, 8);

  // super: large red crosshair 24x24 with gold center tick
  {
    const t = mk(24, 24); const g = t.g;
    ring(g, 12, 12, 10, 8, PAL.uiRed);
    // rim light on the ring, upper-left
    g.fillStyle = PAL.nodRedLight;
    for (let a = 3.4; a <= 4.6; a += 0.2) {
      g.fillRect(Math.round(12 + Math.cos(a) * 9), Math.round(12 + Math.sin(a) * 9), 1, 1);
    }
    g.fillStyle = PAL.uiRed;
    g.fillRect(11, 1, 2, 5); g.fillRect(11, 18, 2, 5);
    g.fillRect(1, 11, 5, 2); g.fillRect(18, 11, 5, 2);
    g.fillStyle = PAL.nodRedLight;
    g.fillRect(11, 1, 1, 2); g.fillRect(1, 11, 2, 1);
    g.fillStyle = PAL.uiGold;
    g.fillRect(11, 11, 2, 2);
    SPRITES.cursor.super = cur(outline(t.c), 12, 12);
  }

  // scroll arrows: cardinal + diagonal masters, rotated in exact quarter turns
  function scrollCardinal() { // points up (N)
    const t = mk(16, 16);
    t.g.fillStyle = WHITE;
    for (let i = 0; i < 6; i++) t.g.fillRect(8 - i, 1 + i, i * 2 + 1, 1);
    t.g.fillRect(6, 7, 5, 6);
    t.g.fillStyle = PAL.uiGold;
    for (let i = 0; i < 6; i++) t.g.fillRect(8 - i, 1 + i, 1, 1);
    t.g.fillRect(6, 7, 1, 6);
    return t.c;
  }
  function scrollDiag() { // points NE
    const t = mk(16, 16);
    t.g.fillStyle = WHITE;
    for (let i = 0; i < 6; i++) t.g.fillRect(9 + i, 1 + i, 6 - i, 1);
    for (let i = 0; i < 8; i++) t.g.fillRect(9 - i, 4 + i, 3, 1);
    t.g.fillStyle = PAL.uiGold;
    for (let i = 0; i < 6; i++) t.g.fillRect(9 + i, 1 + i, 1, 1);
    for (let i = 0; i < 8; i++) t.g.fillRect(9 - i, 4 + i, 1, 1);
    return t.c;
  }
  {
    const cardN = scrollCardinal(), diagNE = scrollDiag();
    const hot = [[8, 0], [15, 0], [15, 8], [15, 15], [8, 15], [0, 15], [0, 8], [0, 0]];
    for (let d = 0; d < 8; d++) {
      const base = d % 2 === 0 ? rotQ(cardN, d / 2) : rotQ(diagNE, (d - 1) / 2);
      SPRITES.cursor['scroll' + d] = cur(outline(base), hot[d][0], hot[d][1]);
      // slash perpendicular to diagonal arrows so the arrow stays readable
      const sl = (d === 3 || d === 7) ? SLASH16A : SLASH16;
      SPRITES.cursor['noscroll' + d] =
        cur(stack(outline(tint(base, PAL.uiRed)), sl), hot[d][0], hot[d][1]);
    }
  }

  // ==== LOGOS ==================================================================
  // Both are original stylized crests, 120x90, built from chunky 2px "pixels".

  // blocky 5x6 letterforms for the crest wordmarks
  const FONT = {
    G: ['#####', '#....', '#.###', '#...#', '#...#', '#####'],
    D: ['####.', '#...#', '#...#', '#...#', '#...#', '####.'],
    I: ['#####', '..#..', '..#..', '..#..', '..#..', '#####'],
    N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
    O: ['#####', '#...#', '#...#', '#...#', '#...#', '#####'],
  };

  // word with hard drop shadow, dark outline, and a lit top row on each letter
  function drawWord(g, word, x, y, scale, color, hi, shadow) {
    for (let pass = 0; pass < 3; pass++) {
      let px = x;
      for (const ch of word) {
        const rows = FONT[ch];
        for (let ry = 0; ry < rows.length; ry++) {
          for (let rx = 0; rx < rows[ry].length; rx++) {
            if (rows[ry][rx] !== '#') continue;
            if (pass === 0) {           // drop shadow
              g.fillStyle = shadow;
              g.fillRect(px + rx * scale + 2, y + ry * scale + 2, scale, scale);
            } else if (pass === 1) {    // body
              g.fillStyle = color;
              g.fillRect(px + rx * scale, y + ry * scale, scale, scale);
            } else if (ry === 0 || (ry > 0 && rows[ry - 1][rx] !== '#')) {
              g.fillStyle = hi;         // lit top edge
              g.fillRect(px + rx * scale, y + ry * scale, scale, 1);
            }
          }
        }
        px += 6 * scale;
      }
    }
  }

  // --- GDI crest: gold riveted roundel, navy field, layered spread-wing raptor
  {
    const t = mk(120, 90); const g = t.g;
    // field with subtle horizontal scanline weave
    g.fillStyle = NAVY_BG; g.fillRect(0, 0, 120, 90);
    g.fillStyle = '#131e36';
    for (let y = 1; y < 90; y += 3) g.fillRect(0, y, 120, 1);
    // corner braces
    g.fillStyle = GOLD_D;
    g.fillRect(0, 0, 120, 2); g.fillRect(0, 88, 120, 2);
    g.fillRect(0, 0, 2, 90); g.fillRect(118, 0, 2, 90);
    g.fillStyle = GOLD;
    g.fillRect(0, 0, 120, 1); g.fillRect(0, 0, 1, 90);
    g.fillStyle = GOLD_L;
    g.fillRect(0, 0, 8, 1); g.fillRect(0, 0, 1, 8);
    g.fillStyle = GOLD;
    g.fillRect(3, 3, 4, 1); g.fillRect(3, 3, 1, 4);
    g.fillRect(113, 3, 4, 1); g.fillRect(116, 3, 1, 4);
    g.fillRect(3, 86, 4, 1); g.fillRect(3, 83, 1, 4);
    g.fillRect(113, 86, 4, 1); g.fillRect(116, 83, 1, 4);

    const cx = 60, cy = 33;
    // roundel: shadowed gold ring with rivets, deep navy inner field
    disk(g, cx + 1, cy + 2, 29, 'rgba(4,8,16,0.6)');       // drop shadow
    disk(g, cx, cy, 29, GOLD_S);
    disk(g, cx, cy, 28, GOLD_D);
    ring(g, cx, cy, 28, 24, GOLD);
    // rim light top-left / core shadow bottom-right on the ring
    for (let a = 0; a < Math.PI * 2; a += 0.045) {
      const lx = Math.cos(a), ly = Math.sin(a);
      const x26 = Math.round(cx + lx * 26.5), y26 = Math.round(cy + ly * 26.5);
      if (lx + ly < -0.9) { g.fillStyle = GOLD_L; g.fillRect(x26, y26, 1, 1); }
      else if (lx + ly > 0.9) { g.fillStyle = GOLD_D; g.fillRect(x26, y26, 1, 1); }
    }
    // rivets around the ring
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2 + 0.26;
      const rx2 = Math.round(cx + Math.cos(a) * 26), ry2 = Math.round(cy + Math.sin(a) * 26);
      g.fillStyle = GOLD_S; g.fillRect(rx2 - 1, ry2 - 1, 2, 2);
      g.fillStyle = GOLD_L; g.fillRect(rx2 - 1, ry2 - 1, 1, 1);
    }
    // inner navy field with a lighter upper arc (sky glow)
    disk(g, cx, cy, 23, NAVY_OUT);
    disk(g, cx, cy, 22, NAVY);
    for (let y = -22; y < -8; y++) {
      const w = Math.floor(Math.sqrt(22 * 22 - y * y + 0.25));
      if ((y & 1) === 0) { g.fillStyle = NAVY_L; g.fillRect(cx - w + 1, cy + y + 1, w * 2 - 1, 1); }
    }
    // tiny stars in the field
    g.fillStyle = '#4a6a9a';
    g.fillRect(cx - 16, cy - 12, 1, 1); g.fillRect(cx + 14, cy - 14, 1, 1);
    g.fillRect(cx + 18, cy - 4, 1, 1); g.fillRect(cx - 19, cy - 3, 1, 1);

    // raptor: hand-drawn bitmap in chunky 2px pixels, layered golds.
    // Left wing (col 0 = tip, upswept top edge, stepped feather tiers below).
    const LWING = [
      '.ll.......',
      'llggl.....',
      'lggggll...',
      '.sggggggll',
      '.sdggggggg',
      '..sddggggg',
      '...s.ddggg',
      '....s..sdg',
      '.......s.d',
    ];
    // Body column: head turned right w/ hooked beak, chest, fanned tail.
    const BODY = [
      '..lll..',
      '.llggl.',
      '.lgggpp',
      '..lgg.p',
      '..lgg..',
      '..lggd.',
      '.lgggd.',
      '.lgggd.',
      '..ggd..',
      '..gds..',
      '.dgggd.',
      'ddgggdd',
      '.d.g.d.',
      '..s.s..',
    ];
    const grid = [];
    for (let y2 = 0; y2 < 14; y2++) grid.push(new Array(25).fill('.'));
    function blit(rows, ox, oy) {
      for (let y2 = 0; y2 < rows.length; y2++)
        for (let x2 = 0; x2 < rows[y2].length; x2++)
          if (rows[y2][x2] !== '.') grid[oy + y2][ox + x2] = rows[y2][x2];
    }
    const RWING = LWING.map(r2 => r2.split('').reverse().join(''));
    blit(LWING, 0, 2); blit(RWING, 15, 2); blit(BODY, 9, 0);
    const eagle = outline(pad(bmp(grid.map(r2 => r2.join('')), {
      l: GOLD_L, g: GOLD, d: GOLD_D, s: GOLD_S, p: '#c89838',
    }, 2), 1), NAVY_OUT);
    const ex = cx - (eagle.width >> 1), ey = cy - 15;
    g.drawImage(eagle, ex, ey);
    // eye (dark socket + glint) at the front of the turned head
    g.fillStyle = NAVY_OUT; g.fillRect(ex + 1 + 13 * 2, ey + 2 + 2 * 2, 2, 2);
    g.fillStyle = '#ffffff'; g.fillRect(ex + 1 + 13 * 2, ey + 2 + 2 * 2, 1, 1);
    // wing glint dashes along the lit upper edge
    g.fillStyle = '#f8ecc0';
    g.fillRect(ex + 5, ey + 7, 6, 1); g.fillRect(ex + eagle.width - 11, ey + 7, 6, 1);

    // wordmark with flanking chevrons
    drawWord(g, 'GDI', 35, 66, 3, GOLD, GOLD_L, NAVY_OUT);
    g.fillStyle = GOLD_D;
    for (let i = 0; i < 4; i++) {
      g.fillRect(24 - i, 72 + i, 2, 1); g.fillRect(24 - i, 78 - i, 2, 1);
      g.fillRect(94 + i, 72 + i, 2, 1); g.fillRect(94 + i, 78 - i, 2, 1);
    }
    SPRITES.logo.gdi = t.c;
  }

  // --- Nod crest: layered red delta, segmented scorpion-tail sweep, black field
  {
    const t = mk(120, 90); const g = t.g;
    g.fillStyle = '#080808'; g.fillRect(0, 0, 120, 90);
    // faint ember glow behind the badge
    g.globalAlpha = 0.28; disk(g, 60, 36, 34, '#200604');
    g.globalAlpha = 0.35; disk(g, 60, 34, 24, '#30080a'); g.globalAlpha = 1;
    // scanline weave
    g.fillStyle = '#0e0c0c';
    for (let y = 1; y < 90; y += 3) g.fillRect(0, y, 120, 1);
    // frame with notched corners
    g.fillStyle = RED_D;
    g.fillRect(0, 0, 120, 2); g.fillRect(0, 88, 120, 2);
    g.fillRect(0, 0, 2, 90); g.fillRect(118, 0, 2, 90);
    g.fillStyle = RED;
    g.fillRect(0, 0, 120, 1); g.fillRect(0, 0, 1, 90);
    g.fillStyle = RED_L; g.fillRect(0, 0, 8, 1); g.fillRect(0, 0, 1, 8);
    g.fillStyle = RED;
    g.fillRect(3, 3, 5, 1); g.fillRect(3, 3, 1, 5);
    g.fillRect(112, 3, 5, 1); g.fillRect(116, 3, 1, 5);
    g.fillRect(3, 86, 5, 1); g.fillRect(3, 82, 1, 5);
    g.fillRect(112, 86, 5, 1); g.fillRect(116, 82, 1, 5);

    // inverted-triangle badge: scanline fill with layered border
    const apexX = 60, topY = 7, apexY = 61, hw0 = 37;
    function hwAt(y) { return (apexY - y) / (apexY - topY) * hw0; }
    for (let y = topY; y <= apexY; y++) {
      const hw = hwAt(y);
      const o = Math.round(hw);
      // dark red outer band (4px thick, follows the slant)
      g.fillStyle = RED_D;
      g.fillRect(apexX - o, y, o * 2 + 1, 1);
    }
    for (let y = topY + 4; y <= apexY - 7; y++) {
      const w1 = Math.round(hwAt(y)) - 4;
      if (w1 > 0) { g.fillStyle = RED; g.fillRect(apexX - w1, y, w1 * 2 + 1, 1); } // bright line band
    }
    for (let y = topY + 6; y <= apexY - 10; y++) {
      const w2 = Math.round(hwAt(y)) - 6;
      if (w2 > 0) { g.fillStyle = '#0a0a0a'; g.fillRect(apexX - w2, y, w2 * 2 + 1, 1); } // black core
    }
    // subtle dark-red inner sheen at the top of the core
    g.fillStyle = '#1c0806';
    for (let y = topY + 7; y <= topY + 12; y++) {
      const w2 = Math.round(hwAt(y)) - 7;
      if (w2 > 0 && (y & 1)) g.fillRect(apexX - w2, y, w2 * 2 + 1, 1);
    }
    // top edge highlight + lit left slant
    g.fillStyle = RED_L;
    g.fillRect(apexX - hw0, topY, hw0 * 2 + 1, 1);
    for (let y = topY; y <= apexY; y++) {
      const o = Math.round(hwAt(y));
      g.fillRect(apexX - o, y, 1, 1);
    }
    // apex glint
    g.fillStyle = '#ff9070'; g.fillRect(apexX - 1, apexY - 1, 2, 2);

    // scorpion tail: one smooth, strongly tapered limb sweeping in from the
    // lower-left, crossing the badge border, arching over the top and hooking
    // down into a stinger. Lower interior stays open so the badge reads.
    const spine = [
      [41, 48], [39, 41], [40, 34], [43, 28], [48, 23], [54, 20], [60, 19],
      [66, 21], [70, 25], [71, 30], [70, 34], [68, 38], [65, 41], [62, 44],
    ];
    const rad = [6, 6, 5, 5, 4, 4, 4, 3, 3, 3, 2, 2, 1, 1];
    // interpolated points for a smooth continuous body
    const pts = [];
    for (let i = 0; i < spine.length - 1; i++) {
      for (let tt = 0; tt < 2; tt++) {
        const f2 = tt / 2;
        pts.push([
          Math.round(lerp(spine[i][0], spine[i + 1][0], f2)),
          Math.round(lerp(spine[i][1], spine[i + 1][1], f2)),
          Math.round(lerp(rad[i], rad[i + 1], f2)),
        ]);
      }
    }
    pts.push([spine[spine.length - 1][0], spine[spine.length - 1][1], rad[rad.length - 1]]);
    // dark halo so the tail pops off both the black field and the red border
    for (const p of pts) disk(g, p[0], p[1], p[2] + 1, '#120202');
    // body: dark base, red mid, lit top-left crest; thin tip stays bright
    for (const p of pts) disk(g, p[0], p[1], p[2], RED_D);
    for (const p of pts) if (p[2] > 1) disk(g, p[0], p[1] - 1, p[2] - 1, RED);
    for (const p of pts) if (p[2] <= 2) disk(g, p[0], p[1], Math.max(1, p[2] - 1), RED);
    for (const p of pts) if (p[2] >= 4) disk(g, p[0] - 1, p[1] - 2, p[2] - 3, RED_L);
    // segmentation bands + carapace glints at the thick spine knuckles
    for (let i = 1; i < 9; i += 2) {
      ring(g, spine[i][0], spine[i][1], rad[i], rad[i] - 1, RED_D);
      g.fillStyle = '#ff9070';
      g.fillRect(spine[i][0] - 1, spine[i][1] - rad[i] + 1, 2, 1);
    }
    // stinger point: sharp venom tip finishing the stroke
    g.fillStyle = RED; g.fillRect(61, 44, 2, 2);
    g.fillStyle = RED_L; g.fillRect(61, 44, 1, 1);
    g.fillStyle = '#ffb090'; g.fillRect(60, 46, 1, 1);
    g.fillStyle = '#120202'; g.fillRect(59, 47, 1, 1);
    // inner shadow along the right slant so the badge reads dimensional
    g.fillStyle = RED_S;
    for (let y = topY + 2; y <= apexY - 2; y++) {
      const o = Math.round(hwAt(y)) - 1;
      if (o > 0) g.fillRect(apexX + o - 1, y, 1, 1);
    }

    // wordmark
    drawWord(g, 'NOD', 35, 66, 3, RED, RED_L, '#1a0402');
    // flanking blades
    g.fillStyle = RED_D;
    for (let i = 0; i < 4; i++) {
      g.fillRect(24 - i, 72 + i, 2, 1); g.fillRect(24 - i, 78 - i, 2, 1);
      g.fillRect(94 + i, 72 + i, 2, 1); g.fillRect(94 + i, 78 - i, 2, 1);
    }
    SPRITES.logo.nod = t.c;
  }

  // ==== SHROUD EDGES ===========================================================
  // index 0=N,1=NE,2=E,3=SE,4=S,5=SW,6=W,7=NW. Cardinal = jagged fade along that
  // edge of the explored tile; corners only darken the corner.

  function shroudBand(frac) {
    return frac > 0.72 ? 'rgba(0,0,0,0.95)' : frac > 0.45 ? 'rgba(0,0,0,0.68)' :
           frac > 0.22 ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.18)';
  }

  function shroudCardinal(dir) {
    const t = mk(24, 24); const g = t.g;
    let d = 4 + ri(3);
    for (let i = 0; i < 24; i++) {
      d = clamp(d + ri(3) - 1, 3, 9);
      for (let j = 0; j < d; j++) {
        g.fillStyle = shroudBand(1 - j / d);
        if (dir === 0) g.fillRect(i, j, 1, 1);           // N: fade from top
        else if (dir === 4) g.fillRect(i, 23 - j, 1, 1); // S
        else if (dir === 6) g.fillRect(j, i, 1, 1);      // W
        else g.fillRect(23 - j, i, 1, 1);                // E
      }
      // stray speck past the edge for a torn look
      if (ri(4) === 0) {
        g.fillStyle = 'rgba(0,0,0,0.3)';
        if (dir === 0) g.fillRect(i, d, 1, 1);
        else if (dir === 4) g.fillRect(i, 23 - d, 1, 1);
        else if (dir === 6) g.fillRect(d, i, 1, 1);
        else g.fillRect(23 - d, i, 1, 1);
      }
    }
    return t.c;
  }

  function shroudCorner(cx, cy) {
    const t = mk(24, 24); const g = t.g;
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 24; x++) {
        const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
        const rr = 6.5 + ((x * 7 + y * 13) % 5) * 0.6; // deterministic jag
        if (d < rr) {
          g.fillStyle = shroudBand(1 - d / rr);
          g.fillRect(x, y, 1, 1);
        }
      }
    }
    return t.c;
  }

  SPRITES.shroudEdge.push(
    shroudCardinal(0),      // N
    shroudCorner(23, 0),    // NE
    shroudCardinal(2),      // E
    shroudCorner(23, 23),   // SE
    shroudCardinal(4),      // S
    shroudCorner(0, 23),    // SW
    shroudCardinal(6),      // W
    shroudCorner(0, 0)      // NW
  );
})();
