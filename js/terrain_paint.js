'use strict';
// terrain_paint.js — continuous full-map ground painter (no tile grid).
// Defines exactly one global: TERRAINPAINT. See SPEC.md "Terrain painting".
//
// TERRAINPAINT.build(game) -> { canvas, anim }
//   canvas : full-map prerender at C.CELL*C.ZOOM screen px per cell. The
//            ground is painted per-pixel at 24 px/cell in world space from
//            bilinear-sampled cell fields + value noise, so grass, dirt,
//            water and rock flow across cell borders with ragged organic
//            edges instead of tile seams. Forests, boulders and ground
//            doodads are layered on top, then the whole painting is
//            nearest-upscaled x2 to keep the chunky pixel look.
//   anim   : [{cx, cy, frames:[canvas...], phase}] transparent overlays the
//            renderer redraws live (blossom tree pods, water glints).
//
// Deterministic from game.seed. Cosmetic only: never touches game.rng or
// Math.random, never reads or writes game state besides terrain/tib/seed.

const TERRAINPAINT = (function () {
  const T_GRASS = 0, T_DIRT = 1, T_ROCK = 2, T_WATER = 3, T_TREE = 4, T_BLOSSOM = 5;

  // ---- hashing / noise -------------------------------------------------------

  // integer coordinate hash -> [0,1)
  function h2(x, y, s) {
    let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ s;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // single-octave value noise at integer lattice `period`, smoothstep interp
  function vnoise(x, y, period, s) {
    const gx = x / period, gy = y / period;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    let tx = gx - x0, ty = gy - y0;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const a = h2(x0, y0, s), b = h2(x0 + 1, y0, s);
    const c = h2(x0, y0 + 1, s), d = h2(x0 + 1, y0 + 1, s);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  }

  function fbm(x, y, period, oct, s) {
    let v = 0, amp = 1, tot = 0, p = period;
    for (let i = 0; i < oct; i++) {
      v += vnoise(x, y, p, s + i * 131) * amp;
      tot += amp; amp *= 0.5; p /= 2;
    }
    return v / tot;
  }

  // Dense noise grid: fbm evaluated every `step` px, bilinear-sampled later.
  function noiseGrid(pw, ph, step, period, oct, s) {
    const gw = Math.ceil(pw / step) + 2, gh = Math.ceil(ph / step) + 2;
    const a = new Float32Array(gw * gh);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) a[y * gw + x] = fbm(x * step, y * step, period, oct, s);
    }
    return { a, gw, gh, step };
  }

  function gridAt(gr, x, y) {
    const gx = x / gr.step, gy = y / gr.step;
    let x0 = gx | 0, y0 = gy | 0;
    if (x0 > gr.gw - 2) x0 = gr.gw - 2;
    if (y0 > gr.gh - 2) y0 = gr.gh - 2;
    const tx = gx - x0, ty = gy - y0;
    const i = y0 * gr.gw + x0, a = gr.a;
    const t0 = a[i] + (a[i + 1] - a[i]) * tx;
    const t1 = a[i + gr.gw] + (a[i + gr.gw + 1] - a[i + gr.gw]) * tx;
    return t0 + (t1 - t0) * ty;
  }

  // Bilinear sample of a per-cell Float32 field at world-pixel coords
  // (cell-centered, clamped at the map rim).
  function cellAt(f, x, y) {
    const W = C.MAP_W, H = C.MAP_H;
    const gx = x / C.CELL - 0.5, gy = y / C.CELL - 0.5;
    let x0 = Math.floor(gx), y0 = Math.floor(gy);
    let tx = gx - x0, ty = gy - y0;
    if (x0 < 0) { x0 = 0; tx = 0; } else if (x0 > W - 2) { x0 = W - 2; tx = 1; }
    if (y0 < 0) { y0 = 0; ty = 0; } else if (y0 > H - 2) { y0 = H - 2; ty = 1; }
    const i = y0 * W + x0;
    const t0 = f[i] + (f[i + 1] - f[i]) * tx;
    const t1 = f[i + W] + (f[i + W + 1] - f[i + W]) * tx;
    return t0 + (t1 - t0) * ty;
  }

  // ---- palette ----------------------------------------------------------------

  function u32(hex) {
    const n = parseInt(hex.slice(1), 16);
    return (0xff000000 | ((n & 0xff) << 16) | (n & 0xff00) | (n >>> 16)) >>> 0;
  }
  function ramp(hexes) { const r = new Uint32Array(hexes.length); for (let i = 0; i < hexes.length; i++) r[i] = u32(hexes[i]); return r; }

  // dark -> light ground ramps (PAL-adjacent, a step darker & lighter added)
  const GR = ramp(['#374d22', '#42592b', '#4c6832', '#546e36', '#5b7a3c', '#688a46']);
  const DR = ramp(['#59492c', '#6a5a38', '#7c6a42', '#8f7a4e', '#9c8656', '#ab9663']);
  const RK = ramp(['#41413b', '#4c4c45', '#58584f', '#63635a', '#6f6f66', '#7d7d74']);
  const WET = ramp(['#41371f', '#4d4126', '#5a4c2d', '#665735']);
  // waterline -> deep
  const WR = ramp(['#4b8292', '#3d7490', '#356690', '#2b5880', '#224a6e', '#1a3c5c', '#132e4a']);
  const U_FOAM = u32('#c2dcce'), U_FOAMD = u32('#8fb4ab');
  const U_RIP = u32('#5d92b4'), U_RIPHI = u32('#7fb6d8');

  // ---- tiny pixel painters (24 px/cell layer) ---------------------------------

  function P(q, x, y, w, h, c) { q.fillStyle = c; q.fillRect(x, y, w, h); }

  function disk(q, cx, cy, r, color) {
    q.fillStyle = color;
    for (let y = -r; y <= r; y++) {
      const w = Math.floor(Math.sqrt(r * r - y * y + 0.25));
      q.fillRect(cx - w, cy + y, w * 2 + 1, 1);
    }
  }

  function ell(q, cx, cy, rx, ry, color) {
    q.fillStyle = color;
    for (let y = -ry; y <= ry; y++) {
      const w = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))) + 0.5);
      q.fillRect(cx - w, cy + y, w * 2 + 1, 1);
    }
  }

  // ---- doodads ---------------------------------------------------------------

  function tuft(q, x, y, dry) {
    const dk = dry ? '#4e422a' : '#38502a';
    const lo = dry ? '#8a7a4e' : '#5b7a3c';
    const hi = dry ? '#b09a68' : '#688a46';
    P(q, x - 1, y + 1, 3, 1, dk);
    P(q, x - 1, y, 1, 2, lo); P(q, x + 1, y - 1, 1, 3, lo);
    P(q, x, y - 1, 1, 2, hi);
  }

  function flower(q, x, y, k) {
    const col = k < 0.5 ? '#d8cc70' : '#ded8c4';
    P(q, x, y + 1, 1, 1, '#38502a');
    P(q, x, y, 1, 1, col); P(q, x + 2, y - 1, 1, 1, col);
    P(q, x + 1, y, 1, 1, '#a89040');
  }

  function pebbles(q, x, y, k) {
    const n = 2 + ((k * 3) | 0);
    for (let i = 0; i < n; i++) {
      const px = x + ((h2(x + i, y, 0x5eb) * 7) | 0) - 3;
      const py = y + ((h2(x, y + i, 0x3c1) * 5) | 0) - 2;
      P(q, px, py + 1, 2, 1, '#55554e');
      P(q, px, py, 2, 1, '#6e6e66');
      P(q, px, py, 1, 1, '#8a8a80');
    }
  }

  function crack(q, x, y, k) {
    q.fillStyle = '#514426';
    let px = x, py = y;
    for (let i = 0; i < 3 + ((k * 3) | 0); i++) {
      q.fillRect(px, py, 2, 1);
      px += 1 + ((h2(px, py, 0x77) * 2) | 0);
      py += ((h2(py, px, 0x99) * 3) | 0) - 1;
    }
  }

  function bush(q, x, y) {
    ell(q, x + 1, y + 3, 4, 1, 'rgba(10,14,6,0.35)');
    ell(q, x, y, 5, 3, PAL.outline);
    ell(q, x, y, 4, 2, PAL.treeDark);
    ell(q, x - 1, y - 1, 3, 1, PAL.tree);
    P(q, x - 3, y - 2, 3, 1, PAL.treeLight);
    P(q, x, y - 3, 2, 1, PAL.tree);
    P(q, x + 2, y - 2, 1, 1, PAL.treeLight);
  }

  // ---- boulders ---------------------------------------------------------------

  // 3/4-view boulder: SE cast shadow, lit NW cap, shaded SE flank.
  function boulder(q, cx, cy, r, k) {
    const ry = Math.max(2, Math.round(r * 0.78));
    ell(q, cx + 2, cy + Math.max(1, ry - 1) + 1, r, Math.max(2, (ry >> 1) + 1), 'rgba(16,16,8,0.4)');
    ell(q, cx, cy, r + 1, ry + 1, PAL.outline);
    ell(q, cx, cy, r, ry, PAL.rock1);
    q.fillStyle = PAL.rock3;
    for (let y = 1; y <= ry; y++) {
      const w = Math.floor(r * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))) + 0.5);
      const inset = Math.max(1, y);
      if (w * 2 + 1 - inset > 0) q.fillRect(cx - w + inset, cy + y, w * 2 + 1 - inset, 1);
    }
    q.fillStyle = '#3c3c36';
    for (let y = Math.max(1, ry - 1); y <= ry; y++) {
      const w = Math.floor(r * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))) + 0.5);
      const inset = Math.min(w * 2, y + 2);
      if (w * 2 + 1 - inset > 0) q.fillRect(cx - w + inset, cy + y, w * 2 + 1 - inset, 1);
    }
    ell(q, cx - Math.max(1, r >> 2), cy - Math.max(1, ry >> 2), Math.max(1, r - 2), Math.max(1, ry - 2), PAL.rock2);
    if (r >= 4) ell(q, cx - (r >> 2) - 1, cy - (ry >> 2) - 1, Math.max(1, r - 4), Math.max(1, ry - 3), '#a2a296');
    if (r >= 5) { q.fillStyle = '#c0c0b4'; q.fillRect(cx - (r >> 1), cy - (ry >> 1), 2, 1); }
    q.fillStyle = PAL.rock3;
    q.fillRect(cx + 1 + ((k * 3) | 0), cy, 1, 2);
    if (r >= 5) { q.fillStyle = '#5a6a42'; q.fillRect(cx - r + 1, cy + (ry >> 1), 2, 1); }
  }

  // ---- trees -------------------------------------------------------------------

  // broad deciduous: lumpy foreshortened canopy, lit NW, dark south rim
  function treeDec(q, x, gy, rx, ry, k) {
    ell(q, x + 4, gy - 1, rx - 1, 3, 'rgba(10,14,6,0.42)');
    const yc = gy - ry - 4;
    // trunk below the canopy's south edge
    P(q, x - 2, yc + ry - 1, 5, gy - (yc + ry) + 1, PAL.outline);
    P(q, x - 1, yc + ry - 1, 3, gy - (yc + ry), '#4a3820');
    P(q, x - 1, yc + ry - 1, 1, gy - (yc + ry) - 1, '#6a5230');
    const lumps = [
      [0, 0, rx, ry],
      [-(rx - 3), 1, 3 + (rx >> 2), Math.max(2, ry - 2)],
      [rx - 4, 0, 4, Math.max(2, ry - 1)],
      [-1, -(ry - 2), Math.max(3, rx - 3), 3],
      [(k * 5 | 0) - 2, 1 - (k * 3 | 0), Math.max(2, rx - 4), Math.max(2, ry - 2)],
    ];
    for (const l of lumps) ell(q, x + l[0], yc + l[1], l[2] + 1, l[3] + 1, PAL.outline);
    for (const l of lumps) ell(q, x + l[0], yc + l[1], l[2], l[3], PAL.treeDark);
    for (const l of lumps) if (l[2] > 1 && l[3] > 1) ell(q, x + l[0] - 1, yc + l[1] - 1, l[2] - 1, l[3] - 1, PAL.tree);
    ell(q, x - 2, yc - 2, Math.max(2, rx - 3), Math.max(1, ry - 2), PAL.treeLight);
    ell(q, x - 3, yc - 2, Math.max(1, rx - 6), Math.max(1, ry - 3), '#4a7434');
    // dappled light on the top face
    q.fillStyle = PAL.treeLight;
    for (let i = 0; i < 7; i++) {
      const a = h2(x + i, gy, 0xda) * Math.PI * 2, d = h2(gy + i, x, 0xdb) * (rx - 3);
      q.fillRect(Math.round(x - 1 + Math.cos(a) * d), Math.round(yc - 2 + Math.sin(a) * d * 0.5), 1 + ((h2(i, x, 0xdc) * 2) | 0), 1);
    }
    // dark leaf holes along the shaded south rim
    q.fillStyle = PAL.treeDark;
    q.fillRect(x + 2, yc + ry - 2, 2, 1); q.fillRect(x - 3, yc + ry - 1, 2, 1);
  }

  // conifer: narrow stacked silhouette with jagged skirts, west-lit
  function treeCon(q, x, gy, hgt, k) {
    ell(q, x + 3, gy - 1, 4, 2, 'rgba(10,14,6,0.42)');
    P(q, x - 1, gy - 3, 3, 4, PAL.outline);
    P(q, x, gy - 3, 1, 3, '#4a3820');
    const top = gy - hgt;
    const maxHalf = 3 + (hgt > 13 ? 2 : 1);
    for (let i = 0; i <= hgt - 4; i++) {
      const y = top + i;
      let half = Math.round((i / (hgt - 4)) * maxHalf);
      // jagged skirt: every few rows kick 1px wider
      if (i > 2 && h2(x, y, 0xc0 ^ (k * 97 | 0)) < 0.4) half += 1;
      P(q, x - half - 1, y, half * 2 + 3, 1, PAL.outline);
    }
    for (let i = 0; i <= hgt - 4; i++) {
      const y = top + i;
      let half = Math.round((i / (hgt - 4)) * maxHalf);
      if (i > 2 && h2(x, y, 0xc0 ^ (k * 97 | 0)) < 0.4) half += 1;
      P(q, x - half, y, half * 2 + 1, 1, i > hgt - 7 ? '#1c3418' : '#26471d');
      P(q, x - half, y, Math.max(1, half), 1, '#2f5522');       // west-lit
      if (i < 3) P(q, x, y, 1, 1, '#3f6f2c');                   // bright tip
    }
    P(q, x, top - 1, 1, 1, '#3f6f2c');
  }

  // ---- animated overlays --------------------------------------------------------

  // blossom tree pod (transparent bg; soil stain + shadow are baked in the cache)
  function blossomOverlay() {
    const out = [];
    const cx = 12, cy = 8;
    for (let f = 0; f < 2; f++) {
      const c = mkCanvas(24, 24); const q = c.getContext('2d');
      q.imageSmoothingEnabled = false;
      P(q, cx - 2, 11, 5, 9, PAL.outline);
      P(q, cx - 1, 11, 3, 8, '#4a3820');
      P(q, cx - 1, 11, 1, 7, '#6a5230');
      P(q, cx + 1, 12, 1, 7, '#2e2214');
      const rx = 6 + f, ry = 4 + f;
      ell(q, cx, cy, rx + 1, ry + 1, PAL.outline);
      ell(q, cx, cy, rx, ry, '#6e3050');
      ell(q, cx, cy - 1, rx - 1, ry - 1, '#a05878');
      ell(q, cx - 1, cy - 2, rx - 3, Math.max(1, ry - 3), f === 0 ? '#d898b4' : '#f0d0dc');
      q.fillStyle = '#5a2440';
      q.fillRect(cx, cy - ry + 1, 1, ry + 2); q.fillRect(cx - 4, cy, 2, 1); q.fillRect(cx + 3, cy + 1, 2, 1);
      q.fillStyle = f === 0 ? '#f0d0dc' : '#fdf2f6';
      q.fillRect(cx - 3, cy - 3, 2, 1); q.fillRect(cx - 4, cy - 2, 1, 1);
      if (f === 1) {
        q.fillStyle = '#f4d8e2';
        q.fillRect(cx - 5, 1, 1, 1); q.fillRect(cx + 4, 0, 1, 1); q.fillRect(cx + 7, 3, 1, 1);
        q.fillStyle = '#e8c0d0';
        q.fillRect(cx - 2, 0, 1, 1); q.fillRect(cx + 6, 6, 1, 1);
      }
      out.push(c);
    }
    return out;
  }

  // drifting glints for open-water cells (4 frames, transparent bg)
  function glintFrames(vs) {
    const marks = [];
    for (let i = 0; i < 3; i++) {
      marks.push({ x: 4 + ((h2(i, vs, 0x11) * 15) | 0), y: 4 + ((h2(vs, i, 0x22) * 15) | 0), p: (h2(i, i, vs) * 4) | 0 });
    }
    const out = [];
    for (let f = 0; f < 4; f++) {
      const c = mkCanvas(24, 24); const q = c.getContext('2d');
      q.imageSmoothingEnabled = false;
      for (const m of marks) {
        const ph = (f + m.p) & 3;
        if (ph === 3) continue;                      // resting frame
        const x = (m.x + f) % 20 + 2;
        q.fillStyle = ph === 1 ? '#b8e0f0' : '#7fb6d8';
        q.fillRect(x, m.y, ph === 1 ? 3 : 2, 1);
        if (ph === 1) { q.fillStyle = '#356690'; q.fillRect(x - 1, m.y, 1, 1); }
      }
      out.push(c);
    }
    return out;
  }

  // ---- main build ---------------------------------------------------------------

  function build(g) {
    const W = C.MAP_W, H = C.MAP_H, CS = C.CELL;
    const PW = W * CS, PH = H * CS;
    const seed = g.seed >>> 0;
    const GSEED = seed ^ 0x9e3779b9;

    // per-cell material fields (what the ground blends toward between cells)
    const dirtF = new Float32Array(W * H);
    const waterF = new Float32Array(W * H);
    const rockF = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const t = g.terrain[i];
      dirtF[i] = t === T_DIRT ? 1 : t === T_ROCK ? 0.9 : t === T_WATER ? 0.6 :
                 t === T_BLOSSOM ? 0.5 : t === T_TREE ? 0.2 : 0;
      waterF[i] = t === T_WATER ? 1 : 0;
      rockF[i] = t === T_ROCK ? 1 : 0;
    }

    // noise layers: broad tonal mottle + two decorrelated edge-raggedness fields
    const mott = noiseGrid(PW, PH, 6, 110, 3, seed ^ 0x51ab3d);
    const edgeA = noiseGrid(PW, PH, 3, 26, 2, seed ^ 0x77c1e5);
    const edgeB = noiseGrid(PW, PH, 3, 22, 2, seed ^ 0x2d9f47);

    // ---- pass 1: per-pixel ground into an ImageData -------------------------
    const img = new ImageData(PW, PH);
    const px = new Uint32Array(img.data.buffer);
    let o = 0;
    for (let y = 0; y < PH; y++) {
      for (let x = 0; x < PW; x++, o++) {
        const m = gridAt(mott, x, y);
        const gr = h2(x, y, GSEED);
        const w = cellAt(waterF, x, y);
        let wv = 0;
        if (w > 0.03) {
          wv = w + (gridAt(edgeA, x, y) - 0.5) * 0.5;
          if (wv > 0.5) {
            // WATER: depth bands from the noisy waterline inward
            const dd = (wv - 0.5) * 2.6 + (m - 0.5) * 0.35;
            if (dd < 0.08) {
              px[o] = gr > 0.6 ? U_FOAM : WR[0];
            } else if (h2(x >> 2, y, GSEED ^ 0xa1) < 0.05 && dd < 0.95) {
              px[o] = gr > 0.8 ? U_RIPHI : U_RIP;      // drifting ripple dashes
            } else {
              let wi = 1 + (dd * 5.4) | 0;
              if (wi > 6) wi = 6;
              px[o] = WR[wi];
            }
            continue;
          }
        }
        // LAND: rocky ground / dirt / grass with dithered ragged boundaries
        const eB = gridAt(edgeB, x, y);
        let rampSel;
        const r = cellAt(rockF, x, y);
        const rv = r > 0.03 ? r + (eB - 0.5) * 0.44 : 0;
        if (rv > 0.55 || (rv > 0.45 && (rv - 0.45) * 10 > gr)) {
          rampSel = RK;
        } else {
          const dv = cellAt(dirtF, x, y) + (eB - 0.5) * 0.62 + (m - 0.5) * 0.18;
          rampSel = dv > 0.55 ? DR : dv > 0.45 ? ((dv - 0.45) * 10 > gr ? DR : GR) : GR;
        }
        let t = 0.5 + (m - 0.5) * 0.85 + (gr - 0.5) * 0.34;
        if (wv > 0.33) {
          // wet shoreline band on the land side, dither-blended
          const k = (wv - 0.33) / 0.17;
          if (wv > 0.465 && gr > 0.8) { px[o] = U_FOAMD; continue; }
          if (gr < k) rampSel = WET;
          t *= 1 - k * 0.4;
        }
        let idx = (t * rampSel.length) | 0;
        if (idx < 0) idx = 0; else if (idx >= rampSel.length) idx = rampSel.length - 1;
        px[o] = rampSel[idx];
      }
    }

    const low = mkCanvas(PW, PH);
    const q = low.getContext('2d');
    q.imageSmoothingEnabled = false;
    q.putImageData(img, 0, 0);

    // ---- pass 2: decorations painted over the ground -------------------------
    // forest floor shade first, so overlapping canopies sit on darkened ground
    for (let cy = 0; cy < H; cy++) {
      for (let cx = 0; cx < W; cx++) {
        if (g.terrain[cellIdx(cx, cy)] !== T_TREE) continue;
        q.globalAlpha = 0.16;
        disk(q, cx * CS + 12, cy * CS + 12, 13, '#1c2c12');
        q.globalAlpha = 1;
      }
    }

    // ground doodads on open land (cosmetic; buildings/units draw over them)
    for (let cy = 1; cy < H - 1; cy++) {
      for (let cx = 1; cx < W - 1; cx++) {
        const i = cellIdx(cx, cy);
        const t = g.terrain[i];
        if ((t !== T_GRASS && t !== T_DIRT) || g.tib[i] > 0) continue;
        const dh = h2(cx, cy, seed ^ 0xd00d);
        if (dh > 0.20) continue;
        const k = h2(cy, cx, seed ^ 0xd11d);
        const x = cx * CS + 4 + ((k * 16) | 0), y = cy * CS + 4 + ((dh * 80) | 0) % 16;
        if (t === T_GRASS) {
          if (k < 0.42) tuft(q, x, y, false);
          else if (k < 0.58) flower(q, x, y, dh * 5 % 1);
          else if (k < 0.72) bush(q, x, y);
          else pebbles(q, x, y, dh * 5 % 1);
        } else {
          if (k < 0.40) pebbles(q, x, y, dh * 5 % 1);
          else if (k < 0.62) crack(q, x, y, dh * 5 % 1);
          else if (k < 0.82) tuft(q, x, y, true);
          else bush(q, x, y);
        }
      }
    }

    // boulder outcrops on rock cells (+ scree spilling onto neighbours)
    for (let cy = 0; cy < H; cy++) {
      for (let cx = 0; cx < W; cx++) {
        const i = cellIdx(cx, cy);
        if (g.terrain[i] !== T_ROCK) {
          // scree at the skirt of an outcrop
          if ((g.terrain[i] === T_GRASS || g.terrain[i] === T_DIRT) && g.tib[i] === 0) {
            let near = false;
            if (cx > 0 && g.terrain[i - 1] === T_ROCK) near = true;
            else if (cx < W - 1 && g.terrain[i + 1] === T_ROCK) near = true;
            else if (cy > 0 && g.terrain[i - W] === T_ROCK) near = true;
            else if (cy < H - 1 && g.terrain[i + W] === T_ROCK) near = true;
            if (near && h2(cx, cy, seed ^ 0x5c3e) < 0.5) {
              pebbles(q, cx * CS + 8 + ((h2(cy, cx, 0x71) * 8) | 0), cy * CS + 8 + ((h2(cx, cy, 0x72) * 8) | 0), h2(cx, cy, 0x73));
            }
          }
          continue;
        }
        // count 8-neighbourhood rock to size the formation
        let n8 = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = cx + dx, ny = cy + dy;
            if (inMap(nx, ny) && g.terrain[cellIdx(nx, ny)] === T_ROCK) n8++;
          }
        }
        const bh = h2(cx, cy, seed ^ 0xb01d);
        const jx = cx * CS + 10 + ((bh * 9) | 0) - 4;
        const jy = cy * CS + 10 + ((h2(cy, cx, seed ^ 0xb02d) * 9) | 0) - 4;
        // vary hard so outcrops don't read as bubble-wrap: some cells get one
        // big slab, some a pair, some just bare rocky ground with rubble
        if (n8 >= 6) {
          if (bh < 0.35) boulder(q, jx + 1, jy + 1, 7 + ((bh * 9) | 0), bh);
          else if (bh < 0.7) boulder(q, jx - 1, jy, 4 + ((bh * 4) | 0), bh);
          else pebbles(q, jx, jy, bh);
        } else if (n8 >= 3) {
          if (bh < 0.55) {
            boulder(q, jx - 2, jy - 2, 4 + ((bh * 4) | 0), bh);
            if (bh < 0.25) boulder(q, jx + 6, jy + 5, 3, 1 - bh);
          } else if (bh < 0.85) {
            boulder(q, jx + 2, jy + 1, 3 + ((bh * 3) | 0), bh);
          } else {
            pebbles(q, jx, jy, bh); pebbles(q, jx + 5, jy + 6, 1 - bh);
          }
        } else {
          boulder(q, jx, jy, 3 + ((bh * 3) | 0), bh);
          if (bh > 0.6) pebbles(q, jx + 6, jy + 4, bh);
        }
      }
    }

    // blossom tree ground: tiberium-stained soil + static cast shadow
    for (let cy = 0; cy < H; cy++) {
      for (let cx = 0; cx < W; cx++) {
        if (g.terrain[cellIdx(cx, cy)] !== T_BLOSSOM) continue;
        const bx = cx * CS, by = cy * CS;
        q.globalAlpha = 0.3;
        disk(q, bx + 12, by + 14, 9, PAL.tibDark);
        q.globalAlpha = 1;
        q.fillStyle = PAL.tibDark;
        for (let i = 0; i < 8; i++) q.fillRect(bx + 4 + ((h2(i, cx, cy) * 16) | 0), by + 17 + ((h2(cx, i, cy) * 6) | 0), 1 + (i & 1), 1);
        q.fillStyle = PAL.tib1;
        q.fillRect(bx + 6, by + 20, 1, 1); q.fillRect(bx + 17, by + 19, 1, 1);
        ell(q, bx + 17, by + 20, 7, 2, 'rgba(10,14,6,0.5)');
      }
    }

    // trees, row by row so southern canopies overlap northern ones
    for (let cy = 0; cy < H; cy++) {
      for (let cx = 0; cx < W; cx++) {
        const ti = cellIdx(cx, cy);
        if (g.terrain[ti] !== T_TREE) continue;
        const th = h2(cx, cy, seed ^ 0x7e3e);
        const jx = ((h2(cx, cy, seed ^ 0x7e4e) * 11) | 0) - 5;
        const jy = ((h2(cy, cx, seed ^ 0x7e5e) * 7) | 0) - 3;
        const x = cx * CS + 12 + jx, gy = cy * CS + 20 + jy;
        // in dense woods, a second canopy fills the gaps between cells
        let orth = 0;
        if (cx > 0 && g.terrain[ti - 1] === T_TREE) orth++;
        if (cx < W - 1 && g.terrain[ti + 1] === T_TREE) orth++;
        if (cy > 0 && g.terrain[ti - W] === T_TREE) orth++;
        if (cy < H - 1 && g.terrain[ti + W] === T_TREE) orth++;
        const th2 = h2(cx * 3, cy * 5, seed ^ 0x7e6e);
        if (orth >= 3 && th2 < 0.6) {
          treeDec(q, x + (th2 < 0.3 ? -9 : 9), gy - 7, 7, 4, th2);
        }
        if (th < 0.3) {
          treeCon(q, x, gy, 12 + ((th * 26) | 0), th);
        } else if (th < 0.5) {
          treeDec(q, x, gy, 8, 5, th);
        } else {
          treeDec(q, x, gy, 8 + ((th * 8) | 0) - 4, 5 + (th > 0.8 ? 2 : 1), th);
        }
      }
    }

    // ---- upscale x2 (nearest) into the screen-scale cache --------------------
    const Z = C.ZOOM;
    const cache = mkCanvas(PW * Z, PH * Z);
    const cc = cache.getContext('2d');
    cc.imageSmoothingEnabled = false;
    cc.drawImage(low, 0, 0, PW * Z, PH * Z);

    // ---- animated overlays -----------------------------------------------------
    const anim = [];
    const bloF = blossomOverlay();
    const gliV = [glintFrames(0x31), glintFrames(0x62), glintFrames(0x93)];
    for (let cy = 0; cy < H; cy++) {
      for (let cx = 0; cx < W; cx++) {
        const i = cellIdx(cx, cy);
        const t = g.terrain[i];
        if (t === T_BLOSSOM) {
          anim.push({ cx, cy, frames: bloF, phase: (h2(cx, cy, 0xb10) * 4) | 0 });
        } else if (t === T_WATER) {
          // glints only on open water (all orthogonal neighbours wet)
          if (cx > 0 && cx < W - 1 && cy > 0 && cy < H - 1 &&
              g.terrain[i - 1] === T_WATER && g.terrain[i + 1] === T_WATER &&
              g.terrain[i - W] === T_WATER && g.terrain[i + W] === T_WATER) {
            anim.push({ cx, cy, frames: gliV[(h2(cx, cy, 0x6a1) * 3) | 0], phase: (h2(cy, cx, 0x6a2) * 4) | 0 });
          }
        }
      }
    }

    return { canvas: cache, anim };
  }

  return { build };
})();
