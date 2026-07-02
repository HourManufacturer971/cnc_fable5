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

  function grassTile() {
    const t = mk(24, 24);
    t.g.fillStyle = PAL.grass1;
    t.g.fillRect(0, 0, 24, 24);
    const cols = [PAL.grass2, PAL.grass3, PAL.grass4, PAL.grass2, PAL.grass3];
    for (let i = 0; i < 46; i++) {
      t.g.fillStyle = cols[ri(cols.length)];
      t.g.fillRect(ri(24), ri(24), 1 + ri(2), 1);
    }
    t.g.fillStyle = PAL.grass4;
    for (let i = 0; i < 5; i++) t.g.fillRect(ri(23), ri(22), 1, 2);
    return t.c;
  }

  function dirtTile() {
    const t = mk(24, 24);
    t.g.fillStyle = PAL.dirt1;
    t.g.fillRect(0, 0, 24, 24);
    const cols = [PAL.dirt2, PAL.dirt3, PAL.dirt2, PAL.dirt3];
    for (let i = 0; i < 40; i++) {
      t.g.fillStyle = cols[ri(cols.length)];
      t.g.fillRect(ri(24), ri(24), 1 + ri(2), 1);
    }
    // a few pebbles
    for (let i = 0; i < 4; i++) {
      const x = 1 + ri(21), y = 1 + ri(21);
      t.g.fillStyle = PAL.dirt3; t.g.fillRect(x, y, 2, 1);
      t.g.fillStyle = PAL.rock2; t.g.fillRect(x, y - 1, 1, 1);
    }
    return t.c;
  }

  function boulder(g, cx, cy, r) {
    disk(g, cx, cy, r + 1, PAL.outline);
    disk(g, cx, cy, r, PAL.rock1);
    // bottom shading
    g.fillStyle = PAL.rock3;
    for (let y = Math.max(1, Math.floor(r * 0.4)); y <= r; y++) {
      const w = Math.floor(Math.sqrt(r * r - y * y + 0.25));
      g.fillRect(cx - w, cy + y, w * 2 + 1, 1);
    }
    // top-left highlight
    disk(g, cx - Math.max(1, r >> 2), cy - Math.max(1, r >> 2), Math.max(1, r - 3), PAL.rock2);
    // crack pixel
    g.fillStyle = PAL.outline;
    g.fillRect(cx + ri(3) - 1, cy + ri(2), 1, 1 + ri(2));
  }

  function rockTile(v) {
    const t = mk(24, 24);
    t.g.drawImage(dirtTile(), 0, 0);
    if (v === 0) { boulder(t.g, 11, 12, 8); boulder(t.g, 19, 18, 3); }
    else if (v === 1) { boulder(t.g, 8, 9, 5); boulder(t.g, 16, 15, 6); }
    else { boulder(t.g, 7, 15, 4); boulder(t.g, 15, 7, 4); boulder(t.g, 17, 17, 4); }
    return t.c;
  }

  // shared ripple pattern so the 3 water frames animate in place
  const RIPPLES = [];
  for (let i = 0; i < 14; i++) {
    RIPPLES.push({ x: ri(24), y: ri(24), len: 2 + ri(4), c: R() < 0.35 ? PAL.water3 : PAL.water2 });
  }
  function waterTile(phase) {
    const t = mk(24, 24);
    t.g.fillStyle = PAL.water1;
    t.g.fillRect(0, 0, 24, 24);
    for (const rp of RIPPLES) {
      t.g.fillStyle = rp.c;
      const x = (rp.x + phase * 3) % 24;
      const l = Math.min(rp.len, 24 - x);
      t.g.fillRect(x, rp.y, l, 1);
      if (rp.len > l) t.g.fillRect(0, rp.y, rp.len - l, 1);
    }
    return t.c;
  }

  function canopy(g, cx, cy, r, dark, mid, light) {
    const lumps = [[0, 0, r], [-3, 1, r - 2], [3, 1, r - 2], [0, -3, r - 2]];
    for (const l of lumps) disk(g, cx + l[0], cy + l[1], l[2] + 1, PAL.outline);
    for (const l of lumps) disk(g, cx + l[0], cy + l[1], l[2], dark);
    for (const l of lumps) disk(g, cx + l[0] - 1, cy + l[1] - 1, Math.max(1, l[2] - 2), mid);
    g.fillStyle = light;
    for (let i = 0; i < 10; i++) {
      const a = R() * Math.PI * 2, d = R() * (r - 1);
      g.fillRect(Math.round(cx - 1 + Math.cos(a) * d), Math.round(cy - 1 + Math.sin(a) * d), 1, 1);
    }
  }

  const grassVariants = [grassTile(), grassTile(), grassTile(), grassTile()];

  function treeBase(cx, cy, r) {
    const t = mk(24, 24);
    t.g.drawImage(grassVariants[ri(4)], 0, 0);
    disk(t.g, cx + 3, cy + 4, r, 'rgba(12,16,6,0.4)');       // canopy shadow (bottom-right)
    t.g.fillStyle = '#4a3820'; t.g.fillRect(cx - 1, cy + r - 2, 3, 6); // trunk
    t.g.fillStyle = '#6a5230'; t.g.fillRect(cx - 1, cy + r - 2, 1, 5); // trunk highlight
    return t;
  }

  function treeTile(v) {
    const cx = 11 + (v % 2), cy = 10, r = 6 + (v === 1 ? 1 : 0);
    const t = treeBase(cx, cy, r);
    canopy(t.g, cx, cy, r, PAL.treeDark, PAL.tree, PAL.treeLight);
    return t.c;
  }

  function blossomFrames() {
    const cx = 12, cy = 10, r = 7;
    const base = treeBase(cx, cy, r);
    canopy(base.g, cx, cy, r, '#7c4a5e', '#b07890', '#dcaec0');
    const pods = [];
    for (let i = 0; i < 7; i++) {
      const a = R() * Math.PI * 2, d = R() * (r - 3);
      pods.push([Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d)]);
    }
    const out = [];
    for (let f = 0; f < 2; f++) {
      const t = mk(24, 24);
      t.g.drawImage(base.c, 0, 0);
      for (const p of pods) {
        disk(t.g, p[0], p[1], 2, f === 0 ? '#e8c0d0' : '#f4d8e2');
        t.g.fillStyle = f === 0 ? '#f8ecf2' : '#fffafc';
        t.g.fillRect(p[0] - 1, p[1] - 1, 1, 1);
        if (f === 1) t.g.fillRect(p[0], p[1], 1, 1);
      }
      out.push(t.c);
    }
    return out;
  }

  SPRITES.terrain[0] = grassVariants;
  SPRITES.terrain[1] = [dirtTile(), dirtTile(), dirtTile()];
  SPRITES.terrain[2] = [rockTile(0), rockTile(1), rockTile(2)];
  SPRITES.terrain[3] = [waterTile(0), waterTile(1), waterTile(2)];
  SPRITES.terrain[4] = [treeTile(0), treeTile(1), treeTile(2)];
  SPRITES.terrain[5] = blossomFrames();

  // ==== TIBERIUM ===============================================================

  function crystal(g, cx, cy, s) {
    diamond(g, cx, cy, s + 1, PAL.tibDark);
    diamond(g, cx, cy, s, PAL.tib1);
    if (s >= 2) diamond(g, cx, cy - 1, s - 2, PAL.tib2);
    g.fillStyle = PAL.tib3;
    g.fillRect(cx, cy - s + 1, 1, Math.min(2, s));
  }

  function tibCanvas(n, maxS, carpet) {
    const t = mk(24, 24);
    if (carpet) {
      t.g.fillStyle = PAL.tibDark;
      for (let i = 0; i < 26; i++) t.g.fillRect(1 + ri(22), 1 + ri(22), 1 + ri(2), 1);
    }
    for (let i = 0; i < n; i++) {
      const s = 2 + ri(maxS - 1);
      const x = clamp(3 + ri(18), s + 2, 21 - s);
      const y = clamp(4 + ri(16), s + 2, 21 - s);
      crystal(t.g, x, y, s);
    }
    return t.c;
  }

  SPRITES.tiberium.push(tibCanvas(3, 3, false), tibCanvas(6, 3, false), tibCanvas(11, 4, true));

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
    if (r > 2) disk(g, cx - 1, cy - 1, Math.max(1, Math.round(r * 0.65)), PAL.fire2);
    if (r > 3) disk(g, cx - 1, cy - 1, Math.max(1, Math.round(r * 0.35)), PAL.fire1);
  }

  // one 6-phase explosion (fireball -> smoke) at scale s
  function expPhase(g, cx, cy, phase, s) {
    const r = Math.round;
    if (phase === 0) {
      fireball(g, cx, cy, r(3 * s));
      sparks(g, cx, cy, r(4 * s), 4, PAL.fire1);
    } else if (phase === 1) {
      fireball(g, cx, cy, r(5 * s));
      sparks(g, cx, cy, r(7 * s), 6, PAL.fire2);
    } else if (phase === 2) {
      fireball(g, cx, cy, r(7 * s));
      sparks(g, cx, cy, r(9 * s), 8, PAL.fire3);
    } else if (phase === 3) {
      g.globalAlpha *= 0.9;
      disk(g, cx, cy, r(7 * s), PAL.smoke);
      g.globalAlpha /= 0.9;
      disk(g, cx - r(2 * s), cy + r(s), r(3 * s), PAL.fire3);
      disk(g, cx + r(2 * s), cy - r(s), r(2 * s), PAL.fire2);
      disk(g, cx + r(s), cy + r(2 * s), Math.max(1, r(s)), PAL.fire1);
    } else if (phase === 4) {
      const a = g.globalAlpha;
      g.globalAlpha = a * 0.7;
      disk(g, cx - r(2 * s), cy - r(2 * s), r(4 * s), '#4c4c4c');
      disk(g, cx + r(3 * s), cy - r(s), r(3 * s), PAL.smoke);
      disk(g, cx, cy + r(2 * s), r(3 * s), '#585858');
      g.globalAlpha = a;
    } else {
      const a = g.globalAlpha;
      g.globalAlpha = a * 0.55;
      disk(g, cx - r(s), cy - r(3 * s), r(3.5 * s), '#606060');
      disk(g, cx + r(2 * s), cy - r(4 * s), r(2.5 * s), '#525252');
      g.globalAlpha = a;
    }
  }

  const fx = SPRITES.fx;

  // small explosion 6x 24x24
  fx.expS = [];
  for (let p = 0; p < 6; p++) {
    const t = mk(24, 24);
    expPhase(t.g, 12, 12, p, 1);
    fx.expS.push(t.c);
  }

  // large explosion 8x 48x48 (staggered multi-burst)
  fx.expL = [];
  {
    const centers = [[24, 26, 0], [15, 20, 1], [33, 21, 2], [23, 12, 3]];
    for (let f = 0; f < 8; f++) {
      const t = mk(48, 48);
      for (const c of centers) {
        const p = f - c[2];
        if (p >= 0 && p <= 5) expPhase(t.g, c[0], c[1], p, 1.3);
      }
      fx.expL.push(t.c);
    }
  }

  // muzzle flash 2x 8x8
  fx.muzzle = [];
  {
    const t0 = mk(8, 8);
    t0.g.fillStyle = PAL.fire1;
    t0.g.fillRect(3, 0, 2, 8); t0.g.fillRect(0, 3, 8, 2);
    t0.g.fillStyle = PAL.fire2;
    t0.g.fillRect(1, 1, 1, 1); t0.g.fillRect(6, 1, 1, 1);
    t0.g.fillRect(1, 6, 1, 1); t0.g.fillRect(6, 6, 1, 1);
    t0.g.fillStyle = '#fffce0';
    t0.g.fillRect(3, 3, 2, 2);
    const t1 = mk(8, 8);
    t1.g.fillStyle = PAL.fire2;
    t1.g.fillRect(3, 1, 2, 6); t1.g.fillRect(1, 3, 6, 2);
    t1.g.fillStyle = PAL.fire1;
    t1.g.fillRect(3, 3, 2, 2);
    fx.muzzle.push(t0.c, t1.c);
  }

  // smoke 4x 16x16 rising puffs
  fx.smoke = [];
  for (let i = 0; i < 4; i++) {
    const t = mk(16, 16);
    const cy = Math.round(12 - i * 2.7), r = 2 + i;
    t.g.globalAlpha = 0.85 - i * 0.17;
    disk(t.g, 8, cy, r, PAL.smoke);
    disk(t.g, 7, cy - 1, Math.max(1, r - 1), '#5a5a5a');
    disk(t.g, 8, Math.min(14, cy + r + 1), 1, PAL.smoke);
    t.g.globalAlpha = 1;
    fx.smoke.push(t.c);
  }

  // flame jet 3x 16x16 (points up, base at bottom)
  fx.flame = [];
  for (let f = 0; f < 3; f++) {
    const t = mk(16, 16); const g = t.g;
    const halves = [3, 3, 2, 2, 2, 2, 1, 1, 1, 1, 0, 0, 0];
    for (let i = 0; i < 13; i++) {
      const y = 15 - i;
      let h = halves[i];
      if (i > 3 && (i + f) % 3 === 0) h += 1;
      const dx = i > 5 ? ((i + f) % 2 === 0 ? 1 : -1) : 0;
      g.fillStyle = i < 9 ? PAL.fire2 : PAL.fire3;
      g.fillRect(8 - h + dx, y, h * 2 + 1, 1);
      if (i < 5 && h > 1) {
        g.fillStyle = PAL.fire1;
        g.fillRect(8 - h + 1 + dx, y, h * 2 - 1, 1);
      }
    }
    g.fillStyle = PAL.fire3;
    g.fillRect(8 + (f % 2 === 0 ? -1 : 1), 2, 1, 1);
    fx.flame.push(t.c);
  }

  // scorch mark 1x 24x24 (semi-transparent dark splat)
  {
    const t = mk(24, 24); const g = t.g;
    g.globalAlpha = 0.5;
    disk(g, 12, 12, 8, '#14100a');
    for (let i = 0; i < 7; i++) {
      const a = R() * Math.PI * 2;
      disk(g, Math.round(12 + Math.cos(a) * 7), Math.round(12 + Math.sin(a) * 6), 1 + ri(2), '#14100a');
    }
    g.globalAlpha = 0.75;
    disk(g, 12, 12, 4, '#0c0a06');
    g.globalAlpha = 1;
    fx.scorch = [t.c];
  }

  // crater 1x 24x24
  {
    const t = mk(24, 24); const g = t.g;
    disk(g, 12, 12, 9, '#4c4232');
    disk(g, 12, 12, 7, '#302818');
    disk(g, 12, 13, 4, '#1a160e');
    g.fillStyle = PAL.dirt2;
    for (let a = 3.3; a <= 4.7; a += 0.22) {
      g.fillRect(Math.round(12 + Math.cos(a) * 8), Math.round(12 + Math.sin(a) * 8), 2, 1);
    }
    g.fillStyle = '#4c4232';
    for (let i = 0; i < 6; i++) {
      const a = R() * Math.PI * 2, d = 10 + R() * 1.5;
      g.fillRect(Math.round(12 + Math.cos(a) * d), Math.round(12 + Math.sin(a) * d), 1, 1);
    }
    fx.crater = [t.c];
  }

  // nuke mushroom cloud 6x 64x64
  fx.nukeCloud = [];
  for (let f = 0; f < 6; f++) {
    const t = mk(64, 64); const g = t.g;
    if (f === 0) {
      g.globalAlpha = 0.55;
      g.fillStyle = PAL.fire2; g.fillRect(25, 6, 14, 52);
      g.globalAlpha = 0.9;
      g.fillStyle = PAL.fire1; g.fillRect(29, 6, 6, 52);
      g.globalAlpha = 1;
      disk(g, 32, 56, 10, PAL.fire1);
      disk(g, 32, 56, 6, '#ffffff');
    } else if (f === 1) {
      disk(g, 32, 58, 9, PAL.fire2);
      g.fillStyle = PAL.fire3; g.fillRect(28, 48, 8, 12);
      disk(g, 32, 44, 11, PAL.fire3);
      disk(g, 31, 42, 8, PAL.fire2);
      disk(g, 30, 41, 4, PAL.fire1);
      sparks(g, 32, 44, 14, 10, PAL.fire2);
    } else if (f === 2) {
      disk(g, 32, 58, 12, PAL.smoke);
      disk(g, 32, 57, 8, PAL.fire3);
      g.fillStyle = PAL.fire3; g.fillRect(27, 40, 10, 18);
      g.fillStyle = PAL.fire2; g.fillRect(29, 40, 4, 16);
      disk(g, 32, 30, 14, PAL.fire3);
      disk(g, 30, 28, 10, PAL.fire2);
      disk(g, 29, 27, 5, PAL.fire1);
      sparks(g, 32, 30, 17, 8, PAL.fire2);
    } else if (f === 3) {
      disk(g, 32, 56, 14, '#565656');
      disk(g, 32, 55, 9, PAL.fire3);
      g.fillStyle = '#4c4c4c'; g.fillRect(26, 26, 12, 28);
      g.fillStyle = PAL.fire3; g.fillRect(29, 28, 6, 22);
      disk(g, 32, 20, 17, PAL.smoke);
      disk(g, 31, 19, 13, PAL.fire3);
      disk(g, 29, 18, 8, PAL.fire2);
      disk(g, 28, 17, 4, PAL.fire1);
      g.fillStyle = '#2e2e2e'; g.fillRect(23, 31, 18, 2);
    } else if (f === 4) {
      g.globalAlpha = 0.95;
      disk(g, 32, 55, 15, '#565656');
      g.fillStyle = '#505050'; g.fillRect(25, 24, 14, 30);
      g.fillStyle = PAL.fire3; g.fillRect(29, 30, 6, 16);
      disk(g, 32, 18, 19, '#5a5a5a');
      disk(g, 30, 17, 12, PAL.fire3);
      disk(g, 29, 16, 6, PAL.fire2);
      g.fillStyle = '#303030'; g.fillRect(22, 30, 20, 2);
      g.globalAlpha = 1;
    } else {
      g.globalAlpha = 0.55;
      disk(g, 32, 54, 14, '#5e5e5e');
      g.fillStyle = '#585858'; g.fillRect(26, 22, 12, 30);
      disk(g, 32, 15, 19, '#646464');
      disk(g, 29, 13, 11, '#707070');
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
    g.fillRect(5, 3, 2, 2);
    // tailplane
    g.fillStyle = PAL.nodDark; g.fillRect(2, 9, 7, 2);
    // fuselage
    g.fillStyle = PAL.nod; g.fillRect(7, 10, 34, 7);
    g.fillRect(41, 11, 3, 5); g.fillRect(44, 12, 2, 3);   // nose taper
    g.fillRect(4, 10, 3, 4);                              // tail cone
    g.fillStyle = PAL.nodLight; g.fillRect(7, 10, 34, 2); g.fillRect(41, 11, 3, 1);
    g.fillStyle = PAL.nodDark; g.fillRect(7, 15, 34, 2);
    // wing (dark band) + engines
    g.fillStyle = PAL.nodDark; g.fillRect(18, 12, 12, 3); g.fillRect(16, 13, 2, 1);
    g.fillRect(20, 17, 4, 3); g.fillRect(27, 17, 4, 3);
    g.fillStyle = PAL.nodShadow; g.fillRect(20, 18, 1, 2); g.fillRect(27, 18, 1, 2);
    // cockpit + window row
    g.fillStyle = '#2c3644'; g.fillRect(38, 11, 3, 2);
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

  // classic arrow (solid; outline added after)
  const ARROW = [
    '#..........',
    '##.........',
    '###........',
    '####.......',
    '#####......',
    '######.....',
    '#######....',
    '########...',
    '#########..',
    '######.....',
    '##.###.....',
    '#...###....',
    '....###....',
    '.....###...',
    '.....###...',
  ];
  SPRITES.cursor.default = cur(outline(pad(bmp(ARROW, { '#': WHITE }), 1)), 0, 0);

  // corner brackets helper
  function drawBrackets(g, x0, y0, x1, y1, arm, thick, color) {
    g.fillStyle = color;
    g.fillRect(x0, y0, arm, thick); g.fillRect(x0, y0, thick, arm);
    g.fillRect(x1 - arm + 1, y0, arm, thick); g.fillRect(x1 - thick + 1, y0, thick, arm);
    g.fillRect(x0, y1 - thick + 1, arm, thick); g.fillRect(x0, y1 - arm + 1, thick, arm);
    g.fillRect(x1 - arm + 1, y1 - thick + 1, arm, thick); g.fillRect(x1 - thick + 1, y1 - arm + 1, thick, arm);
  }

  // select: white corner brackets
  {
    const t = mk(20, 20);
    drawBrackets(t.g, 1, 1, 18, 18, 6, 2, WHITE);
    SPRITES.cursor.select = cur(outline(t.c), 10, 10);
  }

  // attack: red brackets, inner pulse marks + dot
  {
    const t = mk(20, 20);
    drawBrackets(t.g, 1, 1, 18, 18, 6, 2, PAL.uiRed);
    drawBrackets(t.g, 5, 5, 14, 14, 3, 1, PAL.nodRedLight);
    t.g.fillStyle = PAL.nodRedLight; t.g.fillRect(9, 9, 2, 2);
    SPRITES.cursor.attack = cur(outline(t.c), 10, 10);
  }

  // 4-arrow cross (outward = move, inward = enter/capture)
  function arrowCrossC(color, inward) {
    const q = mk(20, 20);
    q.g.fillStyle = color;
    if (inward) {
      for (let i = 0; i < 4; i++) q.g.fillRect(6 + i, 2 + i, 8 - 2 * i, 1);
    } else {
      for (let i = 0; i < 4; i++) q.g.fillRect(9 - i, 2 + i, 2 + 2 * i, 1);
      q.g.fillRect(9, 6, 2, 2);
    }
    const t = mk(20, 20);
    for (let k = 0; k < 4; k++) t.g.drawImage(rotQ(q.c, k), 0, 0);
    return t.c;
  }

  SPRITES.cursor.move = cur(outline(arrowCrossC(PAL.uiGreen, false)), 10, 10);
  SPRITES.cursor.nomove = cur(stack(outline(arrowCrossC(PAL.uiRed, false)), SLASH20), 10, 10);
  SPRITES.cursor.enter = cur(outline(arrowCrossC(PAL.uiGreen, true)), 10, 10);
  SPRITES.cursor.capture = cur(outline(arrowCrossC(PAL.uiGold, true)), 10, 10);

  // harvest: green pincer + down-arrow over a crystal
  {
    const t = mk(20, 20); const g = t.g;
    g.fillStyle = PAL.uiGreen;
    g.fillRect(9, 1, 3, 3);
    for (let i = 0; i < 4; i++) g.fillRect(6 + i, 4 + i, 9 - 2 * i, 1);
    g.fillRect(3, 9, 2, 1); g.fillRect(2, 10, 2, 3); g.fillRect(3, 13, 2, 1);
    g.fillRect(15, 9, 2, 1); g.fillRect(16, 10, 2, 3); g.fillRect(15, 13, 2, 1);
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
    return outline(t.c);
  }
  SPRITES.cursor.deploy = cur(deployC(PAL.uiGreen, PAL.uiGreen), 10, 10);
  SPRITES.cursor.nodeploy = cur(stack(deployC(PAL.uiRed, PAL.nodRedLight), SLASH20), 10, 10);

  // sell / nosell: coin with $ and a down arrow
  function coinCursor(main, hi, dark) {
    const t = mk(20, 20); const g = t.g;
    disk(g, 10, 8, 6, main);
    disk(g, 8, 6, 2, hi);
    g.fillStyle = dark;
    g.fillRect(8, 5, 3, 1); g.fillRect(8, 6, 1, 1); g.fillRect(8, 7, 3, 1);
    g.fillRect(10, 8, 1, 1); g.fillRect(8, 9, 3, 1);
    g.fillRect(9, 4, 1, 1); g.fillRect(9, 10, 1, 1);
    g.fillStyle = main;
    for (let i = 0; i < 4; i++) g.fillRect(6 + i, 15 + i, 7 - 2 * i, 1);
    return outline(t.c);
  }
  SPRITES.cursor.sell = cur(coinCursor(PAL.uiGold, PAL.gdiLight, '#6a4c10'), 10, 10);
  SPRITES.cursor.nosell = cur(coinCursor(PAL.nod, PAL.nodLight, '#3a3a40'), 10, 10);

  // repair / norepair: wrench
  function wrenchCursor(color) {
    const t = mk(16, 16);
    t.g.drawImage(bmp(WRENCH, { '#': color }), 2, 2);
    return outline(t.c);
  }
  SPRITES.cursor.repair = cur(wrenchCursor(PAL.uiGold), 8, 8);
  SPRITES.cursor.norepair = cur(wrenchCursor(PAL.nod), 8, 8);

  // super: large red crosshair 24x24
  {
    const t = mk(24, 24); const g = t.g;
    ring(g, 12, 12, 10, 8, PAL.uiRed);
    g.fillStyle = PAL.uiRed;
    g.fillRect(11, 1, 2, 5); g.fillRect(11, 18, 2, 5);
    g.fillRect(1, 11, 5, 2); g.fillRect(18, 11, 5, 2);
    g.fillStyle = PAL.nodRedLight;
    g.fillRect(11, 11, 2, 2);
    SPRITES.cursor.super = cur(outline(t.c), 12, 12);
  }

  // scroll arrows: cardinal + diagonal masters, rotated in exact quarter turns
  function scrollCardinal() { // points up (N)
    const t = mk(16, 16);
    t.g.fillStyle = WHITE;
    for (let i = 0; i < 6; i++) t.g.fillRect(8 - i, 1 + i, i * 2 + 1, 1);
    t.g.fillRect(6, 7, 5, 6);
    return t.c;
  }
  function scrollDiag() { // points NE
    const t = mk(16, 16);
    t.g.fillStyle = WHITE;
    for (let i = 0; i < 6; i++) t.g.fillRect(9 + i, 1 + i, 6 - i, 1);
    for (let i = 0; i < 8; i++) t.g.fillRect(9 - i, 4 + i, 3, 1);
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

  const FONT = {
    G: ['.####', '#....', '#..##', '#...#', '.###.'],
    D: ['####.', '#...#', '#...#', '#...#', '####.'],
    I: ['#####', '..#..', '..#..', '..#..', '#####'],
    N: ['#...#', '##..#', '#.#.#', '#..##', '#...#'],
    O: ['.###.', '#...#', '#...#', '#...#', '.###.'],
  };

  function drawWord(g, word, x, y, scale, color, shadow) {
    for (let pass = 0; pass < 2; pass++) {
      let px = x;
      for (const ch of word) {
        const rows = FONT[ch];
        for (let ry = 0; ry < rows.length; ry++) {
          for (let rx = 0; rx < rows[ry].length; rx++) {
            if (rows[ry][rx] !== '#') continue;
            if (pass === 0 && shadow) {
              g.fillStyle = shadow;
              g.fillRect(px + rx * scale + 2, y + ry * scale + 2, scale, scale);
            } else if (pass === 1) {
              g.fillStyle = color;
              g.fillRect(px + rx * scale, y + ry * scale, scale, scale);
            }
          }
        }
        px += 6 * scale;
      }
    }
  }

  // GDI: gold ring + spread-wing eagle on navy, 'GDI'
  const EAGLE = [
    '..........#..........',
    '.........###.........',
    '#.......#####.......#',
    '##.....##.#.##.....##',
    '####..###.#.###..####',
    '#####################',
    '.###################.',
    '..#####.#####.#####..',
    '....###..###..###....',
    '.........###.........',
    '........#####........',
    '.......##.#.##.......',
  ];
  {
    const t = mk(120, 90); const g = t.g;
    g.fillStyle = '#16203a'; g.fillRect(0, 0, 120, 90);
    g.fillStyle = PAL.uiGold;
    g.fillRect(0, 0, 120, 2); g.fillRect(0, 88, 120, 2);
    g.fillRect(0, 0, 2, 90); g.fillRect(118, 0, 2, 90);
    disk(g, 60, 34, 25, '#1c2a4a');
    ring(g, 60, 34, 29, 25, PAL.uiGold);
    // top-left rim light arc
    g.fillStyle = PAL.gdiLight;
    for (let a = 3.4; a <= 4.9; a += 0.09) {
      g.fillRect(Math.round(60 + Math.cos(a) * 28), Math.round(34 + Math.sin(a) * 28), 1, 1);
    }
    const eagle = outline(pad(bmp(EAGLE, { '#': PAL.uiGold }, 2), 1), '#0a1226');
    g.drawImage(eagle, 60 - (eagle.width >> 1), 34 - (eagle.height >> 1));
    // wing glints
    g.fillStyle = PAL.gdiLight;
    g.fillRect(42, 32, 10, 1); g.fillRect(68, 32, 10, 1);
    drawWord(g, 'GDI', 35, 68, 3, PAL.uiGold, '#0a1226');
    SPRITES.logo.gdi = t.c;
  }

  // Nod: red-bordered triangle + scorpion-tail sickle on black, 'NOD'
  const TAIL = [
    '....########...',
    '..###########..',
    '.####.....####.',
    '.###.......###.',
    '####.........##',
    '###...........#',
    '###............',
    '###.........#..',
    '.###.......###.',
    '..####...#####.',
    '...##########..',
    '.....######....',
  ];
  {
    const t = mk(120, 90); const g = t.g;
    g.fillStyle = '#0c0c0c'; g.fillRect(0, 0, 120, 90);
    g.fillStyle = PAL.nodRed;
    g.fillRect(0, 0, 120, 2); g.fillRect(0, 88, 120, 2);
    g.fillRect(0, 0, 2, 90); g.fillRect(118, 0, 2, 90);
    const apexY = 5, baseY = 60, hw0 = 40;
    for (let y = apexY; y <= baseY; y++) {
      const hw = Math.round((y - apexY) / (baseY - apexY) * hw0);
      g.fillStyle = PAL.nodRed;
      g.fillRect(60 - hw, y, hw * 2 + 1, 1);
    }
    for (let y = apexY + 6; y <= baseY - 4; y++) {
      const hw = Math.round((y - apexY) / (baseY - apexY) * hw0) - 6;
      if (hw > 0) { g.fillStyle = '#0c0c0c'; g.fillRect(60 - hw, y, hw * 2 + 1, 1); }
    }
    // triangle edge highlight
    g.fillStyle = PAL.nodRedLight;
    g.fillRect(59, apexY, 3, 2);
    const tail = outline(pad(bmp(TAIL, { '#': PAL.nodRed }, 2), 1), '#2a0808');
    g.drawImage(tail, 60 - (tail.width >> 1), 41 - (tail.height >> 1));
    // tail sheen
    g.fillStyle = PAL.nodRedLight;
    g.fillRect(54, 32, 10, 1); g.fillRect(50, 34, 4, 1);
    drawWord(g, 'NOD', 35, 66, 3, PAL.nodRedLight, '#300a06');
    SPRITES.logo.nod = t.c;
  }

  // ==== SHROUD EDGES ===========================================================
  // index 0=N,1=NE,2=E,3=SE,4=S,5=SW,6=W,7=NW. Cardinal = jagged fade along that
  // edge of the explored tile; corners only darken the corner.

  function shroudBand(frac) {
    return frac > 0.62 ? 'rgba(0,0,0,0.92)' : frac > 0.3 ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.28)';
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
    }
    return t.c;
  }

  function shroudCorner(cx, cy) {
    const t = mk(24, 24); const g = t.g;
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 24; x++) {
        const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
        const rr = 6.5 + ((x * 7 + y * 13) % 5) * 0.5; // deterministic jag
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
