'use strict';
// sprites_buildings.js — procedurally drawn building sprites + cameos.
// Fills, for every key in DATA.buildings and BOTH sides:
//   SPRITES.buildings[key][side] = { normal:[frames], damaged:[frames] }
//   (+ gun turret rotation frames, obelisk charge frames, SAM open frames)
// and SPRITES.cameo[key] for every building, plus SPRITES.cameo.ionStrike and
// SPRITES.cameo.nukeStrike superweapon cameos. Defines no globals (IIFE).
//
// Canvas size per building: w*24 x (h*24 + 8). The bottom 8 rows are the
// concrete bib apron; render anchors the canvas top-left to the footprint
// top-left cell, so the bib hangs just below the footprint.

(function () {
  if (typeof document === 'undefined' || typeof SPRITES === 'undefined' ||
      typeof DATA === 'undefined' || typeof PAL === 'undefined') return;

  const OUT = PAL.outline;

  // ---- shared material ramps (highlight / base / shade / dark) --------------
  const SLAB = '#73736b', SLAB_L = '#85857c', SLAB_D = '#5a5a53';
  const CONC = '#a8a89e', CONC_L = '#c9c9bd', CONC_D = '#73736a', CONC_D2 = '#53534d';
  const STEEL = '#9a9a92', STEEL_L = '#c4c4bc', STEEL_D = '#6e6e68', STEEL_D2 = '#4b4b46';
  const IRON = '#3c3c42', IRON_L = '#5b5b64', IRON_D = '#26262b';
  const GLASS = '#1c2c3a', GLASS_L = '#4e7290', GLASS_HI = '#a6d2ec';
  const DOOR = '#33332e', DOOR_D = '#22221e';
  const OLV = '#5c6634', OLV_L = '#79844a', OLV_D = '#3f4722', OLV_D2 = '#2c3218';
  const ASPH = '#3a3a34', ASPH_L = '#51514a', ASPH_D = '#2a2a26';
  const HAZK = '#16160f';                 // hazard-stripe dark
  const SH = 'rgba(10,10,6,0.35)';        // cast shadow
  const WHT = '#e8e8e0', WHT_D = '#b0b0a8';

  function sidePal(side) {
    return side === 'gdi'
      ? { base: PAL.gdi, light: PAL.gdiLight, dark: PAL.gdiDark, shadow: PAL.gdiShadow,
          trim: PAL.uiGold, trim2: '#f4dc80', haz: '#e0b840',
          blackA: '#2b2822', blackB: '#38342c', blackC: '#474033' }
      : { base: PAL.nod, light: PAL.nodLight, dark: PAL.nodDark, shadow: PAL.nodShadow,
          trim: PAL.nodRed, trim2: PAL.nodRedLight, haz: '#c8321e',
          blackA: '#25252d', blackB: '#32323c', blackC: '#41414d' };
  }

  // ---- tiny drawing helpers -------------------------------------------------

  function P(ctx, x, y, w, h, col) { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); }

  function outlineRect(ctx, x, y, w, h, col) {
    col = col || OUT;
    P(ctx, x, y, w, 1, col); P(ctx, x, y + h - 1, w, 1, col);
    P(ctx, x, y, 1, h, col); P(ctx, x + w - 1, y, 1, h, col);
  }

  // beveled building block: base fill, light top/left, dark bottom/right, outline
  function panel(ctx, x, y, w, h, base, light, dark) {
    P(ctx, x, y, w, h, base);
    P(ctx, x + 1, y + 1, w - 2, 1, light);
    P(ctx, x + 1, y + 1, 1, h - 2, light);
    P(ctx, x + 1, y + h - 2, w - 2, 1, dark);
    P(ctx, x + w - 2, y + 1, 1, h - 2, dark);
    outlineRect(ctx, x, y, w, h);
  }

  function circleFill(ctx, cx, cy, r, col) {
    for (let dy = -r; dy <= r; dy++) {
      const hw = Math.floor(Math.sqrt(r * r - dy * dy) + 0.5);
      P(ctx, cx - hw, cy + dy, hw * 2 + 1, 1, col);
    }
  }

  function ellipseFill(ctx, cx, cy, rx, ry, col) {
    for (let dy = -ry; dy <= ry; dy++) {
      const t = 1 - (dy * dy) / ((ry * ry) || 1);
      if (t < 0) continue;
      const hw = Math.floor(rx * Math.sqrt(t) + 0.5);
      P(ctx, cx - hw, cy + dy, hw * 2 + 1, 1, col);
    }
  }

  // half-dome sitting on baseY (rows above baseY), 4-shade, outlined
  function dome(ctx, cx, baseY, r, mid, light, dark) {
    const rr = r + 1;
    for (let dy = 0; dy <= rr; dy++) {
      const hw = Math.floor(Math.sqrt(Math.max(0, rr * rr - dy * dy)) + 0.5);
      P(ctx, cx - hw, baseY - dy, hw * 2 + 1, 1, OUT);
    }
    for (let dy = 0; dy <= r; dy++) {
      const hw = Math.floor(Math.sqrt(r * r - dy * dy) + 0.5);
      P(ctx, cx - hw, baseY - dy, hw * 2 + 1, 1, mid);
      if (hw > 2) P(ctx, cx + hw - 2, baseY - dy, 2, 1, dark);
    }
    for (let dy = Math.floor(r * 0.35); dy < r; dy++) {
      const hw = Math.floor(Math.sqrt(r * r - dy * dy) + 0.5);
      if (hw > 2) P(ctx, cx - hw + 1, baseY - dy, Math.max(2, Math.floor(hw * 0.5)), 1, light);
    }
  }

  // full shaded sphere (eye dome ball)
  function ball(ctx, cx, cy, r, mid, light, dark) {
    circleFill(ctx, cx, cy, r + 1, OUT);
    circleFill(ctx, cx, cy, r, mid);
    for (let dy = -r; dy <= r; dy++) {
      const hw = Math.floor(Math.sqrt(r * r - dy * dy) + 0.5);
      const w = dy > 0 ? 3 : 2;
      if (hw > w) P(ctx, cx + hw - w, cy + dy, w, 1, dark);
    }
    circleFill(ctx, cx - Math.round(r * 0.35), cy - Math.round(r * 0.35),
               Math.max(2, Math.round(r * 0.35)), light);
  }

  // top-down cooling stack; hot = bright glowing core
  function stack(ctx, cx, cy, r, hot) {
    circleFill(ctx, cx + 2, cy + 2, r, SH);            // cast shadow SE
    circleFill(ctx, cx, cy, r + 1, OUT);
    circleFill(ctx, cx, cy, r, '#9b9b93');
    circleFill(ctx, cx - 2, cy - 2, Math.max(2, r - 2), '#bcbcb2');
    circleFill(ctx, cx - 3, cy - 3, Math.max(1, r - 5), '#d4d4c8');
    // rim tick marks
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2 + 0.39;
      P(ctx, Math.round(cx + Math.cos(a) * (r - 1)), Math.round(cy + Math.sin(a) * (r - 1)), 1, 1, '#5e5e58');
    }
    circleFill(ctx, cx, cy, Math.max(2, r - 3), '#33332e');
    circleFill(ctx, cx, cy, Math.max(1, r - 5), hot ? '#f0e060' : '#22221e');
    if (hot && r - 7 >= 1) circleFill(ctx, cx, cy, r - 7, '#fff8c0');
    if (!hot) P(ctx, cx - 1, cy - 1, 1, 1, '#3c3c36'); // faint inner reflection
  }

  // three-phase steam wisp rising from (cx, topY); p = 0..2
  function steam3(ctx, cx, topY, p) {
    const ph = [
      [[0, 0, 4, 0.95], [-3, -3, 3, 0.7], [2, -6, 2, 0.45]],
      [[-1, -2, 4, 0.85], [2, -5, 3, 0.6], [-3, -9, 2, 0.4]],
      [[1, -3, 3, 0.7], [-2, -7, 3, 0.5], [3, -11, 2, 0.3]],
    ][p];
    for (const [dx, dy, s, a] of ph) {
      ctx.fillStyle = 'rgba(240,244,240,' + a + ')';
      ctx.fillRect(cx + dx, topY + dy, s, s);
      ctx.fillStyle = 'rgba(255,255,255,' + (a * 0.7).toFixed(2) + ')';
      ctx.fillRect(cx + dx, topY + dy, s, 1);
      ctx.fillStyle = 'rgba(200,206,200,' + (a * 0.5).toFixed(2) + ')';
      ctx.fillRect(cx + dx - 1, topY + dy + s, s + 2, 1);
    }
  }

  function blit(ctx, x, y, rows, map) {
    for (let j = 0; j < rows.length; j++) {
      const s = rows[j];
      for (let i = 0; i < s.length; i++) {
        const col = map[s[i]];
        if (col) P(ctx, x + i, y + j, 1, 1, col);
      }
    }
  }

  // horizontal hazard stripes, 2px tall, slight diagonal offset
  function hazardH(ctx, x, y, w, haz) {
    for (let i = 0; i < w; i++) {
      P(ctx, x + i, y, 1, 1, (((i / 3) | 0) % 2) ? HAZK : haz);
      P(ctx, x + i, y + 1, 1, 1, ((((i + 1) / 3) | 0) % 2) ? HAZK : haz);
    }
  }
  // vertical hazard stripes, 2px wide
  function hazardV(ctx, x, y, h, haz) {
    for (let j = 0; j < h; j++) {
      P(ctx, x, y + j, 1, 1, (((j / 3) | 0) % 2) ? HAZK : haz);
      P(ctx, x + 1, y + j, 1, 1, ((((j + 1) / 3) | 0) % 2) ? HAZK : haz);
    }
  }

  // row of dark window slits, one lit
  function winRow(ctx, x, y, n, gap, lit) {
    for (let i = 0; i < n; i++) {
      const wx = x + i * gap;
      P(ctx, wx - 1, y - 1, 5, 6, OUT);
      P(ctx, wx, y, 3, 4, GLASS);
      P(ctx, wx, y, 3, 1, GLASS_L);
      if (i === lit) P(ctx, wx + 1, y + 2, 1, 1, GLASS_HI);
    }
  }

  // thick beam segment from (x0,y0) to (x1,y1) — crane booms etc.
  function beam(ctx, x0, y0, x1, y1, top, bot) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x0 + (x1 - x0) * i / steps);
      const y = Math.round(y0 + (y1 - y0) * i / steps);
      P(ctx, x, y - 2, 2, 1, OUT);
      P(ctx, x, y - 1, 2, 1, top);
      P(ctx, x, y, 2, 1, bot);
      P(ctx, x, y + 1, 2, 1, OUT);
    }
  }

  // ground plate filling the whole footprint (buildings must fill their cells)
  function baseSlab(ctx, W, H, base, light, dark) {
    base = base || SLAB; light = light || SLAB_L; dark = dark || SLAB_D;
    P(ctx, 0, 0, W, H, base);
    P(ctx, 1, 1, W - 2, 1, light);
    P(ctx, 1, 1, 1, H - 2, light);
    P(ctx, 1, H - 2, W - 2, 1, dark);
    P(ctx, W - 2, 1, 1, H - 2, dark);
    outlineRect(ctx, 0, 0, W, H);
  }

  // deterministic speckle + oil stains on the slab (call right after baseSlab)
  function slabNoise(ctx, W, H, rnd) {
    const n = (W * H / 20) | 0;
    for (let i = 0; i < n; i++) {
      const x = (2 + rnd() * (W - 4)) | 0, y = (2 + rnd() * (H - 4)) | 0;
      const r = rnd();
      ctx.fillStyle = r < 0.35 ? 'rgba(255,255,250,0.06)' : r < 0.7 ? 'rgba(0,0,0,0.10)' : 'rgba(0,0,0,0.05)';
      ctx.fillRect(x, y, 1, 1);
    }
    const st = Math.max(1, (W / 40) | 0);
    ctx.fillStyle = 'rgba(14,12,8,0.10)';
    for (let i = 0; i < st; i++) {
      const sx = 4 + rnd() * (W - 14), sy = 4 + rnd() * (H - 10);
      for (let j = 0; j < 8; j++)
        ctx.fillRect((sx + rnd() * 9) | 0, (sy + rnd() * 5) | 0, 2, 1);
    }
  }

  // concrete bib apron: bottom 8 rows — slabs, 1px seams, cracks, stains
  function drawBib(ctx, W, H, rnd) {
    P(ctx, 0, H, W, 8, '#8b8b82');
    P(ctx, 0, H, W, 1, '#a8a89e');
    P(ctx, 0, H + 3, W, 1, '#6e6e66');
    P(ctx, 0, H + 6, W, 1, '#5f5f58');
    P(ctx, 0, H + 7, W, 1, '#3f3f39');
    for (let x = 4; x < W; x += 12) P(ctx, x, H, 1, 4, '#6e6e66');
    for (let x = 10; x < W; x += 12) P(ctx, x, H + 4, 1, 3, '#6e6e66');
    // cracks
    const nC = Math.max(1, (W / 34) | 0);
    for (let i = 0; i < nC; i++) {
      let x = 2 + rnd() * (W - 8), y = H + 1 + rnd() * 4;
      for (let s = 0; s < 5; s++) {
        P(ctx, x | 0, y | 0, 1, 1, '#4a4a44');
        x += rnd() < 0.65 ? 1 : -1;
        y = clamp(y + (rnd() < 0.5 ? 1 : 0), H, H + 6);
      }
    }
    // stains
    ctx.fillStyle = 'rgba(18,16,10,0.16)';
    const nS = Math.max(1, (W / 32) | 0);
    for (let i = 0; i < nS; i++) {
      const sx = rnd() * (W - 10), sy = H + rnd() * 4;
      for (let j = 0; j < 5; j++)
        ctx.fillRect((sx + rnd() * 9) | 0, (sy + rnd() * 3) | 0, 2, 1);
    }
  }

  // ---- building drawers -------------------------------------------------------
  // signature: (ctx, W, H, pal, f, side, rnd); W/H = footprint px (bib excluded)

  function drawFact(ctx, W, H, pal, f, side, rnd) { // 72x48 — pad + swinging crane
    baseSlab(ctx, W, H); slabNoise(ctx, W, H, rnd);
    // --- recessed construction pit (left) ---
    P(ctx, 3, 7, 42, 38, '#54544d');
    outlineRect(ctx, 2, 6, 44, 40);
    P(ctx, 5, 10, 38, 33, '#454540');
    P(ctx, 5, 10, 38, 1, '#31312c');           // recess: dark top/left
    P(ctx, 5, 10, 1, 33, '#31312c');
    P(ctx, 42, 11, 1, 32, '#60605a');          // lit bottom/right lip
    P(ctx, 6, 42, 37, 1, '#60605a');
    for (let x = 12; x < 42; x += 8) P(ctx, x, 11, 1, 31, '#3a3a35');
    for (let y = 18; y < 42; y += 8) P(ctx, 6, y, 36, 1, '#3a3a35');
    hazardH(ctx, 4, 7, 40, pal.haz);
    // half-poured foundation slab with rebar stubs
    P(ctx, 11, 17, 22, 12, CONC_D);
    P(ctx, 11, 17, 22, 2, CONC);
    P(ctx, 11, 17, 1, 12, CONC);
    P(ctx, 31, 18, 2, 11, CONC_D2);
    outlineRect(ctx, 10, 16, 24, 14);
    P(ctx, 14, 21, 16, 1, '#3a3a35');
    P(ctx, 22, 18, 1, 10, '#3a3a35');
    for (let x = 14; x < 32; x += 5) { P(ctx, x, 15, 1, 3, '#5a4a1e'); P(ctx, x, 15, 1, 1, '#8a7130'); }
    // girder pallet at south of pit
    P(ctx, 10, 35, 14, 5, '#6a5a20');
    P(ctx, 10, 35, 14, 1, '#8f7c30');
    P(ctx, 10, 36, 14, 1, '#544716');
    P(ctx, 10, 38, 14, 1, '#8f7c30');
    outlineRect(ctx, 9, 34, 16, 7);
    // --- HQ structure (right) ---
    P(ctx, 48, 6, 23, 41, SH);
    panel(ctx, 46, 3, 23, 42, pal.base, pal.light, pal.dark);
    P(ctx, 48, 5, 19, 1, pal.light);
    for (let y = 8; y < 16; y += 4) P(ctx, 48, y, 19, 1, pal.dark);
    P(ctx, 47, 16, 21, 2, pal.trim);
    P(ctx, 47, 18, 21, 1, pal.shadow);
    winRow(ctx, 49, 22, 3, 6, f % 3);
    // door with hazard lintel
    hazardH(ctx, 51, 31, 12, pal.haz);
    P(ctx, 52, 34, 10, 11, DOOR);
    P(ctx, 52, 34, 10, 1, '#4a4a42');
    for (let y = 37; y < 44; y += 3) P(ctx, 53, y, 8, 1, DOOR_D);
    outlineRect(ctx, 51, 33, 12, 13);
    // rooftop vent + aerial
    P(ctx, 62, 7, 5, 4, pal.dark); outlineRect(ctx, 61, 6, 7, 6);
    P(ctx, 63, 8, 3, 1, pal.shadow);
    // --- crane mast + swinging boom ---
    P(ctx, 41, 5, 4, 28, '#caa22a');
    P(ctx, 41, 5, 1, 28, '#f0d060');
    P(ctx, 44, 5, 1, 28, '#8a6e18');
    for (let y = 9; y < 31; y += 5) P(ctx, 41, y, 4, 1, '#6e5814');
    outlineRect(ctx, 40, 4, 6, 30);
    const ends = [[12, 8], [16, 15], [21, 22], [16, 15]];
    const e = ends[f % 4];
    beam(ctx, e[0], e[1], 41, 7, '#e8c040', '#8a6e18');
    // cable + hook + carried girder
    const cl = [9, 12, 15, 12][f % 4];
    P(ctx, e[0] + 1, e[1] + 2, 1, cl, '#151512');
    P(ctx, e[0] - 1, e[1] + 2 + cl, 5, 3, '#8a8a90');
    P(ctx, e[0] - 1, e[1] + 2 + cl, 5, 1, '#b8b8c0');
    outlineRect(ctx, e[0] - 2, e[1] + 1 + cl, 7, 5);
    if ((f % 4) === 2) { P(ctx, e[0] - 4, e[1] + 7 + cl, 11, 2, IRON_L); outlineRect(ctx, e[0] - 5, e[1] + 6 + cl, 13, 4); }
    // blinking warning light on mast top
    P(ctx, 42, 2, 2, 2, (f % 2) ? '#ff5030' : '#571b12');
    if (f % 2) { ctx.fillStyle = 'rgba(255,80,48,0.25)'; ctx.fillRect(40, 0, 6, 5); }
  }

  function drawNukePlant(ctx, W, H, pal, f, side, rnd, adv) { // 48x48 — cooling stacks
    baseSlab(ctx, W, H); slabNoise(ctx, W, H, rnd);
    // turbine hall (south)
    P(ctx, 6, 32, 40, 14, SH);
    panel(ctx, 4, 29, 40, 15, pal.base, pal.light, pal.dark);
    for (let y = 32; y < 36; y += 3) P(ctx, 6, y, 36, 1, pal.dark);
    P(ctx, 5, 36, 38, 2, pal.trim);
    P(ctx, 5, 38, 38, 1, pal.shadow);
    // door + hazard
    hazardH(ctx, 19, 38, 10, pal.haz);
    P(ctx, 20, 40, 8, 4, DOOR);
    outlineRect(ctx, 19, 39, 10, 5);
    // transformer coil (left corner) + cables to stacks
    P(ctx, 6, 40, 6, 4, IRON); P(ctx, 6, 40, 6, 1, IRON_L);
    outlineRect(ctx, 5, 39, 8, 6);
    P(ctx, 7, 41, 1, 2, adv ? '#f0e060' : pal.trim2); P(ctx, 10, 41, 1, 2, adv ? '#f0e060' : pal.trim2);
    P(ctx, 13, 25, 1, 5, '#22221e'); P(ctx, 34, 25, 1, 5, '#22221e');
    // cooling stacks
    stack(ctx, 14, 15, 9, adv);
    stack(ctx, 34, 15, 9, adv);
    if (adv) stack(ctx, 24, 23, 5, true);
    // steam (3-phase wisps)
    steam3(ctx, 14, 10, f % 3);
    steam3(ctx, 34, 10, (f + 1) % 3);
    if (adv) steam3(ctx, 24, 19, (f + 2) % 3);
    // status light
    P(ctx, 40, 33, 2, 2, (f % 3 === 0) ? PAL.uiGreen : '#1e4a22');
  }

  function drawProc(ctx, W, H, pal, f, side, rnd) { // 72x48 — tank + cycling dock arm
    baseSlab(ctx, W, H); slabNoise(ctx, W, H, rnd);
    // --- processing hall (right) ---
    P(ctx, 46, 7, 25, 27, SH);
    panel(ctx, 44, 4, 25, 27, pal.base, pal.light, pal.dark);
    P(ctx, 46, 6, 21, 1, pal.light);
    for (let y = 9; y < 16; y += 3) P(ctx, 46, y, 21, 1, pal.dark);
    P(ctx, 45, 16, 23, 2, pal.trim);
    P(ctx, 45, 18, 23, 1, pal.shadow);
    winRow(ctx, 48, 21, 3, 7, f % 3);
    // rooftop vent
    P(ctx, 60, 8, 6, 5, pal.dark); outlineRect(ctx, 59, 7, 8, 7);
    P(ctx, 61, 9, 4, 1, pal.shadow);
    // --- pipe gantry hall -> tank ---
    P(ctx, 31, 10, 14, 1, OUT);
    P(ctx, 31, 11, 14, 2, STEEL); P(ctx, 31, 11, 14, 1, STEEL_L);
    P(ctx, 31, 13, 14, 1, STEEL_D);
    P(ctx, 31, 14, 14, 1, OUT);
    P(ctx, 34, 10, 1, 6, IRON_D); P(ctx, 41, 10, 1, 6, IRON_D);
    // --- tiberium storage tank (left, top-down) ---
    circleFill(ctx, 20, 19, 14, SH);
    circleFill(ctx, 18, 17, 14, OUT);
    circleFill(ctx, 18, 17, 13, pal.dark);
    circleFill(ctx, 17, 16, 12, pal.base);
    circleFill(ctx, 15, 14, 7, pal.light);
    circleFill(ctx, 18, 17, 8, pal.dark);
    circleFill(ctx, 18, 17, 6, '#0e2010');
    circleFill(ctx, 17, 16, 5, PAL.tibDark);
    circleFill(ctx, 17, 16, 3, PAL.tib1);
    P(ctx, 16, 15, 3, 2, PAL.tib2);
    if (f === 1 || f === 3) { P(ctx, 16, 15, 2, 1, PAL.tib3); ctx.fillStyle = 'rgba(72,216,88,0.18)'; ctx.fillRect(11, 10, 14, 14); }
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2 + 0.39;
      P(ctx, Math.round(18 + Math.cos(a) * 11), Math.round(17 + Math.sin(a) * 11), 1, 1, pal.shadow);
    }
    // tank hatch
    P(ctx, 23, 8, 4, 3, pal.light); outlineRect(ctx, 22, 7, 6, 5);
    // --- dock pit (south-center cell) ---
    P(ctx, 26, 32, 20, 13, '#38382f');
    P(ctx, 26, 32, 20, 1, '#26261f');
    P(ctx, 26, 32, 1, 13, '#26261f');
    P(ctx, 45, 33, 1, 12, '#4c4c40');
    outlineRect(ctx, 25, 31, 22, 15);
    P(ctx, 29, 33, 1, 11, '#57574f'); P(ctx, 42, 33, 1, 11, '#57574f');
    // guide chevron
    P(ctx, 34, 41, 4, 1, pal.haz); P(ctx, 33, 42, 2, 1, pal.haz); P(ctx, 37, 42, 2, 1, pal.haz);
    // tiberium glow spill (pulses)
    ctx.fillStyle = 'rgba(72,216,88,' + [0.10, 0.18, 0.26, 0.18][f % 4] + ')';
    ctx.fillRect(27, 33, 18, 11);
    // --- intake canopy arm (cycles down into the pit) ---
    const ay = 23 + [0, 2, 4, 2][f % 4];
    P(ctx, 30, ay + 9, 14, 2, SH);
    P(ctx, 28, ay, 16, 8, pal.base);
    P(ctx, 28, ay, 16, 1, pal.light);
    P(ctx, 28, ay + 6, 16, 2, pal.dark);
    outlineRect(ctx, 27, ay - 1, 18, 10);
    hazardH(ctx, 29, ay + 1, 14, pal.haz);
    for (let i = 0; i < 3; i++) {
      const ph = (i + f) % 3;
      P(ctx, 30 + i * 5, ay + 4, 2, 2, ph === 0 ? PAL.tib3 : ph === 1 ? PAL.tib1 : '#1e4a22');
    }
    // tiberium spill crystals around the dock
    const spill = [[27, 44], [30, 46], [34, 43], [38, 46], [42, 44], [45, 46], [32, 50], [40, 51], [25, 49], [36, 49]];
    const tibCols = [PAL.tib1, PAL.tib2, PAL.tib3];
    for (let i = 0; i < spill.length; i++) {
      P(ctx, spill[i][0], spill[i][1], 2, 2, tibCols[i % 3]);
      P(ctx, spill[i][0], spill[i][1] + 2, 2, 1, PAL.tibDark);
    }
  }

  function drawSilo(ctx, W, H, pal, f, side, rnd) { // 48x24 — twin silver domes
    baseSlab(ctx, W, H); slabNoise(ctx, W, H, rnd);
    P(ctx, 3, 14, 42, 8, pal.dark);
    P(ctx, 3, 14, 42, 1, pal.base);
    // connecting pipe behind console
    P(ctx, 19, 12, 10, 1, OUT); P(ctx, 19, 13, 10, 2, STEEL); P(ctx, 19, 13, 10, 1, STEEL_L);
    P(ctx, 19, 15, 10, 1, OUT);
    dome(ctx, 12, 21, 9, '#b4b4bc', '#e2e2e8', '#74747c');
    dome(ctx, 35, 21, 9, '#b4b4bc', '#e2e2e8', '#74747c');
    // fill-level stripe + moving gleam
    siloStripe(ctx, 12, 21, 9);
    siloStripe(ctx, 35, 21, 9);
    P(ctx, 8 - f, 15, 2, 1, '#f6f6fa');
    P(ctx, 31 - f, 15, 2, 1, '#f6f6fa');
    // rivet seam down each dome
    P(ctx, 12, 13, 1, 3, '#8e8e96'); P(ctx, 35, 13, 1, 3, '#8e8e96');
    // console between domes
    P(ctx, 21, 16, 6, 6, pal.base);
    P(ctx, 21, 16, 6, 1, pal.light);
    outlineRect(ctx, 20, 15, 8, 8);
    P(ctx, 22, 17, 2, 2, f ? PAL.uiGreen : '#1e4a22');
    P(ctx, 25, 17, 1, 2, PAL.tib1);
  }
  function siloStripe(ctx, cx, baseY, r) { // fill-level gauge band
    for (let k = 0; k < 2; k++) {
      const dy = 4 + k;
      const hw = Math.floor(Math.sqrt(r * r - dy * dy));
      P(ctx, cx - hw, baseY - dy, hw * 2 + 1, 1, k ? PAL.tib2 : PAL.tibDark);
    }
  }

  function hut(ctx, x, y, w, h, pal, f) { // olive quonset hut, corrugated
    P(ctx, x + 2, y + 2, w, h, SH);
    outlineRect(ctx, x - 1, y - 1, w + 2, h + 2);
    P(ctx, x, y, w, h, OLV);
    P(ctx, x, y, w, 2, OLV_L);
    P(ctx, x, y + 2, w, 1, '#8a955a');
    P(ctx, x, y + h - 4, w, 4, OLV_D);
    P(ctx, x, y + h - 1, w, 1, OLV_D2);
    for (let i = x + 4; i < x + w - 8; i += 4) {
      P(ctx, i, y, 1, h, 'rgba(18,22,10,0.4)');
      P(ctx, i + 1, y + 1, 1, h - 2, 'rgba(160,180,110,0.25)');
    }
    // end door with hazard lintel
    hazardH(ctx, x + w - 8, y + 1, 7, pal.haz);
    P(ctx, x + w - 7, y + 3, 6, h - 5, OLV_D);
    P(ctx, x + w - 6, y + 4, 4, h - 7, '#20250f');
    P(ctx, x + w - 6, y + 4, 4, 1, '#31371a');
    // window slit
    P(ctx, x + 2, y + Math.floor(h / 2), 3, 2, GLASS);
    P(ctx, x + 2, y + Math.floor(h / 2), 3, 1, GLASS_L);
  }

  function drawPyle(ctx, W, H, pal, f, side, rnd) { // 48x48 — barracks huts + flag
    baseSlab(ctx, W, H); slabNoise(ctx, W, H, rnd);
    hut(ctx, 4, 5, 38, 15, pal, f);
    hut(ctx, 4, 26, 31, 15, pal, f);
    // sandbag arc by lower hut door
    const SB = '#b3a06a', SBD = '#7e6f45';
    P(ctx, 25, 43, 10, 2, SB); P(ctx, 25, 43, 10, 1, '#cbbc85');
    P(ctx, 28, 42, 4, 1, SB);
    P(ctx, 27, 44, 1, 1, SBD); P(ctx, 31, 43, 1, 2, SBD);
    outlineRect(ctx, 24, 42, 12, 4);
    // flag pole (flutter anim)
    P(ctx, 41, 23, 1, 17, '#d8d8d0');
    P(ctx, 41, 22, 1, 1, '#ffffff');
    if (f) { P(ctx, 42, 23, 5, 3, pal.trim); P(ctx, 42, 26, 3, 1, pal.trim); P(ctx, 46, 24, 1, 1, pal.trim2); }
    else { P(ctx, 42, 24, 4, 3, pal.trim); P(ctx, 45, 25, 2, 1, pal.trim2); }
    // crates
    P(ctx, 38, 34, 7, 7, '#8a7444');
    outlineRect(ctx, 38, 34, 7, 7);
    P(ctx, 39, 35, 5, 1, '#a89058');
    P(ctx, 41, 35, 1, 5, '#6e5c30');
    P(ctx, 37, 39, 5, 4, '#7c6838');
    outlineRect(ctx, 37, 39, 5, 4);
  }

  const HAND_EMBLEM = [
    '.r.r.r.',
    '.r.r.r.',
    '.rrrrr.',
    'Rrrrrrr',
    'Rrrrrrr',
    '.Rrrrr.',
    '.Rrrr..',
    '..rrr..',
    '..rrr..',
  ];

  function drawHand(ctx, W, H, pal, f, side, rnd) { // 48x48 — dark sloped monolith
    baseSlab(ctx, W, H); slabNoise(ctx, W, H, rnd);
    P(ctx, 9, 24, 38, 22, SH);
    for (let x = 6; x < 42; x++) {
      const top = 24 - Math.floor((x - 6) * 0.45);
      P(ctx, x, top - 1, 1, 1, OUT);
      P(ctx, x, top, 1, 44 - top, pal.blackB);
      P(ctx, x, top, 1, 1, '#4e4e5c');           // lit ridge
      P(ctx, x, top + 1, 1, 1, pal.blackC);
      if ((x & 3) === 0) P(ctx, x, top + 3, 1, 40 - top, 'rgba(10,10,14,0.30)');
    }
    P(ctx, 5, 22, 1, 23, OUT);
    P(ctx, 42, 7, 1, 38, OUT);
    P(ctx, 6, 44, 36, 1, OUT);
    // red trim chevron along the slope
    for (let x = 8; x < 40; x += 4) {
      const top = 24 - Math.floor((x - 6) * 0.45);
      P(ctx, x, top + 3, 2, 1, pal.trim);
    }
    // base band
    P(ctx, 6, 35, 36, 9, pal.blackA);
    P(ctx, 6, 35, 36, 1, '#15151b');
    // emblem panel + hand
    P(ctx, 21, 18, 15, 18, '#121217');
    outlineRect(ctx, 20, 17, 17, 20, '#000000');
    P(ctx, 21, 18, 15, 1, '#2a2a34');
    blit(ctx, 25, 22, HAND_EMBLEM, { r: pal.trim2, R: '#ff8a70' });
    // door with red hazard
    hazardH(ctx, 7, 34, 10, pal.haz);
    P(ctx, 8, 36, 8, 8, '#101014');
    P(ctx, 8, 36, 8, 1, '#26262e');
    outlineRect(ctx, 7, 35, 10, 9);
    // beacon at apex
    P(ctx, 40, 5, 2, 2, f ? pal.trim2 : '#401410');
    if (f) { ctx.fillStyle = 'rgba(224,80,56,0.22)'; ctx.fillRect(38, 3, 6, 6); }
  }

  function drawWeap(ctx, W, H, pal, f, side, rnd) { // 72x48 — hall + welding door
    baseSlab(ctx, W, H); slabNoise(ctx, W, H, rnd);
    P(ctx, 6, 8, 66, 39, SH);
    panel(ctx, 3, 4, 66, 41, pal.base, pal.light, pal.dark);
    // roof: three big panels with seams + skylight
    P(ctx, 5, 6, 62, 1, pal.light);
    for (let y = 9, i = 0; y < 21; y += 4, i++) P(ctx, 5, y, 62, 1, pal.dark);
    P(ctx, 25, 7, 1, 15, pal.shadow); P(ctx, 47, 7, 1, 15, pal.shadow);
    P(ctx, 8, 9, 12, 4, GLASS); P(ctx, 8, 9, 12, 1, GLASS_L);
    P(ctx, 12, 10, 1, 3, '#101c26'); P(ctx, 16, 10, 1, 3, '#101c26');
    outlineRect(ctx, 7, 8, 14, 6);
    // roof vents
    P(ctx, 52, 9, 8, 5, pal.dark); outlineRect(ctx, 51, 8, 10, 7);
    P(ctx, 53, 10, 6, 1, pal.shadow); P(ctx, 53, 12, 6, 1, pal.shadow);
    // trim band
    P(ctx, 4, 22, 64, 2, pal.trim);
    P(ctx, 4, 24, 64, 1, pal.shadow);
    // face + roller door
    hazardV(ctx, 21, 27, 17, pal.haz);
    hazardV(ctx, 49, 27, 17, pal.haz);
    P(ctx, 24, 26, 24, 15, '#9a9a92');
    P(ctx, 24, 26, 24, 1, '#c0c0b8');
    for (let y = 29; y < 40; y += 3) P(ctx, 24, y, 24, 1, '#6e6e68');
    P(ctx, 46, 27, 2, 13, '#7c7c74');
    outlineRect(ctx, 23, 25, 26, 19);
    // door raised: dark interior gap with welding flashes
    P(ctx, 24, 40, 24, 3, '#141418');
    if (f === 1) { P(ctx, 30, 40, 2, 2, '#e8f6ff'); P(ctx, 29, 41, 4, 1, '#8ec8f0'); ctx.fillStyle = 'rgba(160,220,255,0.35)'; ctx.fillRect(27, 38, 8, 5); }
    if (f === 3) { P(ctx, 41, 41, 2, 2, '#e8f6ff'); P(ctx, 40, 41, 4, 1, '#8ec8f0'); ctx.fillStyle = 'rgba(160,220,255,0.35)'; ctx.fillRect(38, 39, 8, 5); }
    // door status lamp
    P(ctx, 35, 27, 2, 1, (f % 2) ? PAL.uiGreen : '#1e4a22');
    // face windows
    winRow(ctx, 8, 30, 2, 7, f % 2);
    winRow(ctx, 55, 30, 2, 7, (f + 1) % 2);
    // service door right
    P(ctx, 58, 37, 6, 7, DOOR); outlineRect(ctx, 57, 36, 8, 9);
    // roof beacon (blink)
    P(ctx, 62, 8, 3, 3, (f % 2) ? PAL.fire1 : '#5c2014');
    outlineRect(ctx, 61, 7, 5, 5);
  }

  function drawAfld(ctx, W, H, pal, f, side, rnd) { // 96x48 — runway, chase lights
    baseSlab(ctx, W, H, '#5a5a53', '#6b6b62', '#484841'); slabNoise(ctx, W, H, rnd);
    // runway strip
    P(ctx, 2, 19, 92, 24, ASPH);
    P(ctx, 3, 20, 90, 1, ASPH_L);
    P(ctx, 3, 41, 90, 1, ASPH_D);
    outlineRect(ctx, 1, 18, 94, 26);
    // threshold bars
    for (let i = 0; i < 5; i++) { P(ctx, 5, 22 + i * 4, 5, 2, '#c9c9c0'); P(ctx, 86, 22 + i * 4, 5, 2, '#c9c9c0'); }
    // centerline dashes + tire marks
    for (let x = 15; x < 82; x += 10) P(ctx, x, 30, 6, 2, '#b9b9b0');
    ctx.fillStyle = 'rgba(12,12,10,0.35)';
    for (let i = 0; i < 6; i++) ctx.fillRect((16 + rnd() * 60) | 0, (23 + rnd() * 15) | 0, 5, 1);
    // landing lights (4-frame chase)
    for (let i = 0; i < 8; i++) {
      const on = (i + f) % 4 === 0;
      const gx = 14 + i * 10;
      P(ctx, gx, 15, 2, 2, on ? '#ffd860' : '#4a3a14');
      P(ctx, gx, 45, 2, 2, ((i + f + 2) % 4 === 0) ? '#ffd860' : '#4a3a14');
      if (on) { ctx.fillStyle = 'rgba(255,216,96,0.30)'; ctx.fillRect(gx - 1, 14, 4, 4); }
    }
    // control tower (top-left)
    P(ctx, 6, 4, 18, 15, SH);
    panel(ctx, 4, 1, 18, 16, pal.base, pal.light, pal.dark);
    P(ctx, 6, 4, 14, 4, GLASS);
    P(ctx, 6, 4, 14, 1, GLASS_L);
    P(ctx, 9 + (f % 4), 6, 1, 1, GLASS_HI);
    P(ctx, 5, 10, 16, 2, pal.trim);
    P(ctx, 8, 13, 4, 3, DOOR);
    P(ctx, 8, 0, 1, 2, '#2a2a26');
    P(ctx, 19, 1, 2, 2, (f % 2) ? pal.trim2 : '#401410');
    // fuel drums by the tower
    for (let i = 0; i < 3; i++) {
      circleFill(ctx, 28 + i * 6, 8, 2, OUT);
      circleFill(ctx, 28 + i * 6, 8, 1, i === 1 ? pal.haz : STEEL_L);
    }
    // hangar (top-right), arched corrugated roof
    P(ctx, 64, 4, 30, 14, SH);
    outlineRect(ctx, 61, 1, 32, 16);
    P(ctx, 62, 2, 30, 14, pal.base);
    P(ctx, 62, 2, 30, 2, pal.light);
    P(ctx, 62, 4, 30, 1, pal.base);
    P(ctx, 62, 12, 30, 4, pal.dark);
    for (let x = 65; x < 90; x += 4) P(ctx, x, 2, 1, 14, 'rgba(20,20,16,0.35)');
    P(ctx, 62, 6, 30, 1, pal.trim);
    // hangar mouth
    P(ctx, 66, 8, 22, 8, '#1c1c18');
    P(ctx, 66, 8, 22, 1, '#3a3a32');
    outlineRect(ctx, 65, 7, 24, 10);
    // windsock (4-position flutter)
    P(ctx, 47, 2, 1, 14, '#3a3a34');
    P(ctx, 47, 1, 1, 1, '#5c5c54');
    const sock = [[48, 3, 7, 3], [48, 4, 6, 3], [48, 5, 5, 3], [48, 4, 6, 3]][f % 4];
    P(ctx, sock[0], sock[1], sock[2], sock[3], '#e07820');
    P(ctx, sock[0], sock[1], sock[2], 1, '#f8a850');
    P(ctx, sock[0] + sock[2] - 2, sock[1] + 1, 2, 1, '#f8f0e0');
  }

  // radar dish, 8 rotation frames (N, NE, E, SE, S, SW, W, NW)
  function drawDish(ctx, cx, cy, f) {
    const L = '#c8c8c2', M = '#93938c', M2 = '#7e7e78', D = '#54544f', B = '#f2f2ec';
    if (f === 0) {                    // N — convex back
      ellipseFill(ctx, cx, cy, 8, 4, OUT);
      ellipseFill(ctx, cx, cy, 7, 3, M);
      ellipseFill(ctx, cx, cy + 1, 6, 2, M2);
      ellipseFill(ctx, cx - 3, cy - 1, 3, 1, L);
      P(ctx, cx - 6, cy, 13, 1, D);           // rib
      P(ctx, cx - 1, cy - 6, 2, 3, D);        // feed horn behind
      P(ctx, cx - 1, cy - 6, 1, 1, L);
    } else if (f === 4) {             // S — full open bowl
      ellipseFill(ctx, cx, cy, 8, 4, OUT);
      ellipseFill(ctx, cx, cy, 7, 3, M);
      P(ctx, cx - 6, cy - 2, 5, 1, L);        // lit upper rim
      ellipseFill(ctx, cx, cy + 1, 5, 2, M2);
      ellipseFill(ctx, cx, cy + 1, 3, 1, D);
      P(ctx, cx - 4, cy + 1, 9, 1, D);        // radial ribs
      P(ctx, cx, cy - 1, 1, 4, D);
      P(ctx, cx, cy + 2, 1, 3, D);            // feed strut
      P(ctx, cx, cy + 4, 1, 1, B);            // feed tip glint
    } else if (f === 2 || f === 6) {  // E / W — edge on
      const s = f === 2 ? 1 : -1;
      ellipseFill(ctx, cx, cy, 3, 6, OUT);
      ellipseFill(ctx, cx, cy, 2, 5, M2);
      ellipseFill(ctx, cx + s, cy, 1, 4, M);
      P(ctx, cx + s, cy - 3, 1, 2, L);
      P(ctx, cx + s * 3, cy - 1, 2, 2, D);    // feed arm
      P(ctx, cx + s * 4, cy, 1, 1, B);
    } else {                          // diagonals
      const s = (f === 1 || f === 3) ? 1 : -1;   // east-ish?
      const bowl = (f === 3 || f === 5);         // south-ish -> bowl visible
      ellipseFill(ctx, cx, cy, 6, 5, OUT);
      ellipseFill(ctx, cx, cy, 5, 4, M);
      if (bowl) {
        P(ctx, cx - s * 3, cy - 3, 3, 1, L);     // lit rim
        ellipseFill(ctx, cx + s, cy + 1, 3, 2, M2);
        ellipseFill(ctx, cx + s, cy + 1, 1, 1, D);
        P(ctx, cx - s, cy, s * 4, 1, D);
        P(ctx, cx + s * 2, cy + 2, 1, 2, D);
        P(ctx, cx + s * 2, cy + 3, 1, 1, B);
      } else {
        ellipseFill(ctx, cx, cy + 1, 4, 2, M2);
        ellipseFill(ctx, cx - s * 2, cy - 2, 2, 1, L);
        P(ctx, cx - s * 3, cy, 7, 1, D);
        P(ctx, cx + s * 2, cy - 4, 2, 2, D);
        P(ctx, cx + s * 2, cy - 4, 1, 1, L);
      }
    }
  }

  function drawHq(ctx, W, H, pal, f, side, rnd) { // 48x48 — bunker + rotating dish
    baseSlab(ctx, W, H); slabNoise(ctx, W, H, rnd);
    P(ctx, 6, 21, 40, 26, SH);
    panel(ctx, 4, 18, 40, 27, pal.base, pal.light, pal.dark);
    P(ctx, 6, 20, 36, 1, pal.light);
    for (let y = 23; y < 27; y += 3) P(ctx, 6, y, 36, 1, pal.dark);
    P(ctx, 5, 27, 38, 2, pal.trim);
    P(ctx, 5, 29, 38, 1, pal.shadow);
    winRow(ctx, 26, 32, 3, 6, f % 3);
    // door with hazard
    hazardH(ctx, 8, 32, 12, pal.haz);
    P(ctx, 10, 34, 8, 10, DOOR);
    P(ctx, 10, 34, 8, 1, '#4a4a42');
    for (let y = 37; y < 43; y += 3) P(ctx, 11, y, 6, 1, DOOR_D);
    outlineRect(ctx, 9, 33, 10, 11);
    // antenna mast + blink
    P(ctx, 40, 7, 1, 11, '#262622');
    P(ctx, 38, 10, 5, 1, '#262622');
    P(ctx, 39, 5, 3, 2, (f % 2) ? PAL.nodRedLight : '#5c2014');
    // dish pedestal + rotating dish (8 frames)
    P(ctx, 15, 14, 8, 6, SH);
    P(ctx, 13, 12, 8, 7, pal.dark);
    P(ctx, 13, 12, 8, 1, pal.base);
    outlineRect(ctx, 12, 11, 10, 9);
    P(ctx, 14, 13, 2, 2, pal.light);
    drawDish(ctx, 17, 7, f % 8);
    // cable dish -> bunker
    P(ctx, 21, 18, 1, 2, '#22221e');
  }

  function drawEye(ctx, W, H, pal, f, side, rnd) { // 48x48 — dome + scanner glint
    baseSlab(ctx, W, H); slabNoise(ctx, W, H, rnd);
    // bunker
    P(ctx, 6, 29, 40, 18, SH);
    panel(ctx, 4, 26, 40, 19, pal.base, pal.light, pal.dark);
    P(ctx, 5, 30, 38, 2, pal.trim);
    P(ctx, 5, 32, 38, 1, pal.shadow);
    winRow(ctx, 8, 36, 2, 7, f % 2);
    hazardH(ctx, 30, 32, 12, pal.haz);
    P(ctx, 32, 34, 8, 10, DOOR);
    P(ctx, 32, 34, 8, 1, '#4a4a42');
    outlineRect(ctx, 31, 33, 10, 11);
    // geodesic ball
    circleFill(ctx, 20, 18, 12, SH);
    ball(ctx, 18, 15, 12, '#dededa', '#f4f4f0', '#a2a29c');
    ctx.fillStyle = 'rgba(88,88,84,0.5)';
    ctx.fillRect(8, 11, 21, 1); ctx.fillRect(6, 15, 25, 1); ctx.fillRect(8, 19, 21, 1);
    for (let x = 9; x < 28; x += 4) { ctx.fillRect(x, 13, 1, 1); ctx.fillRect(x + 2, 17, 1, 1); ctx.fillRect(x, 21, 1, 1); }
    // equator sensor slit with a slow scanner glint running along it
    P(ctx, 9, 14, 19, 2, '#2e3e4a');
    P(ctx, 9, 14, 19, 1, '#22303a');
    const sx = 10 + (f % 4) * 5;
    P(ctx, sx, 14, 3, 2, GLASS_HI);
    P(ctx, sx + 1, 14, 1, 2, '#ffffff');
    ctx.fillStyle = 'rgba(166,210,236,0.30)';
    ctx.fillRect(sx - 1, 13, 5, 4);
    // ion uplink antenna
    P(ctx, 41, 10, 1, 16, '#2a2a26');
    P(ctx, 39, 13, 5, 1, '#2a2a26');
    P(ctx, 40, 8, 3, 2, (f % 2) ? PAL.ion : '#28506c');
    if (f % 2) { ctx.fillStyle = 'rgba(168,216,248,0.25)'; ctx.fillRect(38, 6, 7, 5); }
  }

  function tstep(ctx, x, y, w, h, pal) { // one pyramid step, red-trimmed
    P(ctx, x, y, w, h, pal.blackB);
    P(ctx, x, y, w, 2, pal.blackC);
    P(ctx, x, y, 1, 1, '#50505e');
    P(ctx, x, y, 2, h, pal.blackC);
    P(ctx, x + w - 3, y, 3, h, pal.blackA);
    P(ctx, x, y + h - 2, w, 2, pal.blackA);
    for (let i = x + 3; i < x + w - 4; i += 2) P(ctx, i, y + 2 + ((i >> 1) & 1), 1, 1, 'rgba(90,90,106,0.30)');
    outlineRect(ctx, x, y, w, h);
    P(ctx, x + 2, y + 3, w - 4, 1, pal.trim);
  }
  function pylon(ctx, x, y, pal) { // squat obsidian spike
    P(ctx, x - 1, y + 8, 6, 3, SH);
    P(ctx, x - 1, y + 6, 5, 4, pal.blackA);
    P(ctx, x, y + 2, 3, 5, pal.blackB);
    P(ctx, x + 1, y - 1, 1, 4, pal.blackB);
    P(ctx, x, y + 2, 1, 5, pal.blackC);
    outlineRect(ctx, x - 2, y + 5, 7, 6);
    P(ctx, x - 1, y + 1, 5, 1, OUT);
    P(ctx, x, y - 2, 3, 1, OUT);
    P(ctx, x + 1, y - 2, 1, 1, pal.trim2);
    P(ctx, x + 1, y - 1, 1, 2, pal.trim);
  }

  function drawTmpl(ctx, W, H, pal, f, side, rnd) { // 72x72 — black step pyramid
    baseSlab(ctx, W, H, '#68685f', '#79796f', '#525249'); slabNoise(ctx, W, H, rnd);
    P(ctx, 10, 48, 60, 22, SH);
    tstep(ctx, 6, 44, 60, 24, pal);
    tstep(ctx, 15, 26, 42, 20, pal);
    tstep(ctx, 23, 12, 26, 16, pal);
    tstep(ctx, 30, 5, 12, 9, pal);
    const g = [0, 1, 2, 1][f % 4];  // rune-glow pulse 0..2
    // glowing top slit
    const slitCol = ['#b02818', '#e04028', '#ff7050'][g];
    const slitHi = ['#d04030', '#ffa080', '#ffd0b0'][g];
    P(ctx, 32, 8, 8, 2, slitCol);
    P(ctx, 33, 7, 6, 1, slitHi);
    ctx.fillStyle = 'rgba(255,96,56,' + (0.12 + g * 0.09).toFixed(2) + ')';
    ctx.fillRect(29, 4, 14, 8);
    // rune dots along the step fronts, pulsing with the slit
    const runeCol = ['#8a2015', '#c83422', '#ff6a4a'][g];
    for (let i = 0; i < 5; i++) P(ctx, 20 + i * 8, 40, 2, 2, runeCol);
    for (let i = 0; i < 3; i++) P(ctx, 27 + i * 7, 23, 2, 2, runeCol);
    // entrance with red arch
    P(ctx, 32, 58, 8, 10, '#0d0d10');
    P(ctx, 33, 58, 6, 1, '#2a1215');
    outlineRect(ctx, 31, 57, 10, 11);
    P(ctx, 31, 57, 10, 1, pal.trim);
    P(ctx, 30, 56, 12, 1, pal.blackC);
    hazardH(ctx, 31, 66, 10, pal.haz);
    // corner pylons
    pylon(ctx, 10, 48, pal);
    pylon(ctx, 59, 48, pal);
  }

  function drawHpad(ctx, W, H, pal, f, side, rnd) { // 48x48 — pad + rotating beacon
    baseSlab(ctx, W, H, '#62625a', '#73736a', '#50504a'); slabNoise(ctx, W, H, rnd);
    P(ctx, 4, 4, 40, 40, '#42423d');
    P(ctx, 5, 5, 38, 1, '#35352f');
    P(ctx, 5, 5, 1, 38, '#35352f');
    P(ctx, 5, 42, 38, 1, '#54544c');
    outlineRect(ctx, 3, 3, 42, 42);
    outlineRect(ctx, 7, 7, 34, 34, '#8a8a80');
    // corner hazard chevrons
    hazardH(ctx, 8, 8, 8, pal.haz); hazardH(ctx, 32, 8, 8, pal.haz);
    hazardH(ctx, 8, 38, 8, pal.haz); hazardH(ctx, 32, 38, 8, pal.haz);
    // white H with shading
    P(ctx, 17, 14, 4, 20, WHT);
    P(ctx, 27, 14, 4, 20, WHT);
    P(ctx, 21, 22, 6, 4, WHT);
    P(ctx, 17, 14, 1, 20, '#ffffff'); P(ctx, 27, 14, 1, 20, '#ffffff');
    P(ctx, 20, 14, 1, 20, WHT_D); P(ctx, 30, 14, 1, 20, WHT_D);
    P(ctx, 17, 33, 4, 1, WHT_D); P(ctx, 27, 33, 4, 1, WHT_D);
    P(ctx, 21, 25, 6, 1, WHT_D);
    // scuff marks on the pad
    ctx.fillStyle = 'rgba(12,12,10,0.30)';
    for (let i = 0; i < 5; i++) ctx.fillRect((10 + rnd() * 26) | 0, (10 + rnd() * 26) | 0, 3, 1);
    // corner landing lights: rotating chase (one lit per frame)
    const corners = [[5, 5], [40, 5], [40, 40], [5, 40]];
    for (let i = 0; i < 4; i++) {
      const lit = (f % 4) === i;
      P(ctx, corners[i][0], corners[i][1], 3, 3, lit ? '#ffd860' : '#4a3a14');
      if (lit) { ctx.fillStyle = 'rgba(255,216,96,0.30)'; ctx.fillRect(corners[i][0] - 1, corners[i][1] - 1, 5, 5); }
    }
    // fuel console + hose
    P(ctx, 36, 8, 7, 6, pal.base);
    P(ctx, 36, 8, 7, 1, pal.light);
    outlineRect(ctx, 35, 7, 9, 8);
    P(ctx, 37, 9, 2, 2, pal.trim);
    P(ctx, 40, 9, 2, 3, GLASS);
    P(ctx, 39, 14, 1, 4, '#22221e'); P(ctx, 38, 17, 1, 2, '#22221e');
    // rotating beacon mast (bottom-right corner console)
    P(ctx, 8, 10, 2, 5, '#2e2e2a');
    const bdir = [[0, -2], [2, 0], [0, 2], [-2, 0]][f % 4];
    P(ctx, 8, 8, 2, 2, '#e84838');
    P(ctx, 8 + bdir[0], 8 + bdir[1], 2, 2, 'rgba(255,120,90,0.65)');
  }

  function drawFix(ctx, W, H, pal, f, side, rnd) { // 72x72 — ring platform + arms
    baseSlab(ctx, W, H); slabNoise(ctx, W, H, rnd);
    const cx = 36, cy = 36;
    circleFill(ctx, cx + 2, cy + 2, 31, SH);
    circleFill(ctx, cx, cy, 32, OUT);
    circleFill(ctx, cx, cy, 31, '#8f8f86');
    circleFill(ctx, cx - 1, cy - 1, 29, '#9d9d94');
    circleFill(ctx, cx - 2, cy - 2, 26, '#a8a89e');
    circleFill(ctx, cx, cy, 24, OUT);
    circleFill(ctx, cx, cy, 23, '#4e4e48');
    circleFill(ctx, cx, cy, 22, '#454540');
    // hazard marks around ring
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2;
      P(ctx, Math.round(cx + Math.cos(a) * 27) - 1, Math.round(cy + Math.sin(a) * 27) - 1,
        2, 2, i % 2 ? pal.haz : '#33332e');
    }
    // chevrons in the pit pointing center
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * Math.PI * 2 + Math.PI / 4;
      const px = Math.round(cx + Math.cos(a) * 16), py = Math.round(cy + Math.sin(a) * 16);
      P(ctx, px - 1, py, 3, 1, '#5f5f58'); P(ctx, px, py - 1, 1, 3, '#5f5f58');
    }
    // center lift pad
    circleFill(ctx, cx, cy, 10, OUT);
    circleFill(ctx, cx, cy, 9, '#8f8f86');
    circleFill(ctx, cx - 2, cy - 2, 5, '#a5a59c');
    circleFill(ctx, cx, cy, 4, '#6e6e66');
    P(ctx, cx - 3, cy, 7, 1, '#54544e'); P(ctx, cx, cy - 3, 1, 7, '#54544e');
    // two service arms (west + east) with pistons
    for (const s of [-1, 1]) {
      const ax = s < 0 ? 5 : 45;
      P(ctx, ax + 2, 35, 22, 7, SH);
      P(ctx, ax, 33, 22, 6, pal.base);
      P(ctx, ax, 33, 22, 1, pal.light);
      P(ctx, ax, 38, 22, 1, pal.dark);
      outlineRect(ctx, ax - 1, 32, 24, 8);
      P(ctx, ax + (s < 0 ? 16 : 2), 34, 4, 4, IRON);
      P(ctx, ax + (s < 0 ? 16 : 2), 34, 4, 1, IRON_L);
      hazardH(ctx, ax + (s < 0 ? 2 : 10), 34, 9, pal.haz);
    }
    // blinking service lights + weld spark
    P(ctx, 25, 35, 2, 2, f ? PAL.uiGreen : '#1e4a22');
    P(ctx, 45, 35, 2, 2, f ? '#1e4a22' : PAL.uiGreen);
    if (f) { P(ctx, 33, 40, 2, 2, '#e8f6ff'); ctx.fillStyle = 'rgba(160,220,255,0.35)'; ctx.fillRect(31, 38, 6, 6); }
    // control hut
    P(ctx, 58, 4, 14, 12, SH);
    panel(ctx, 56, 2, 14, 12, pal.base, pal.light, pal.dark);
    P(ctx, 58, 5, 10, 3, GLASS);
    P(ctx, 58, 5, 10, 1, GLASS_L);
    P(ctx, 60 + (f ? 3 : 0), 6, 1, 1, GLASS_HI);
  }

  function drawGtwr(ctx, W, H, pal, f, side, rnd) { // 24x24 — sandbag MG nest
    baseSlab(ctx, W, H); slabNoise(ctx, W, H, rnd);
    const SB = '#b3a06a', SBD = '#7e6f45', SBL = '#cfc088', SBD2 = '#5e5233';
    circleFill(ctx, 13, 13, 10, SH);
    circleFill(ctx, 12, 12, 11, OUT);
    circleFill(ctx, 12, 12, 10, SB);
    // sandbag courses: radial seams + a middle course line
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * Math.PI * 2 + 0.2;
      P(ctx, Math.round(12 + Math.cos(a) * 8.5), Math.round(12 + Math.sin(a) * 8.5), 1, 2, SBD);
    }
    for (let i = 0; i < 360; i += 20) {
      const a = i * Math.PI / 180;
      P(ctx, Math.round(12 + Math.cos(a) * 7), Math.round(12 + Math.sin(a) * 7), 1, 1, SBD2);
    }
    // top-left highlight arc
    for (let a = 3.3; a < 5.3; a += 0.3) {
      P(ctx, Math.round(12 + Math.cos(a) * 9), Math.round(12 + Math.sin(a) * 9), 2, 1, SBL);
    }
    // nest interior
    circleFill(ctx, 12, 12, 6, '#3e3e38');
    circleFill(ctx, 11, 11, 5, '#34342f');
    // MG on tripod, barrel north with muzzle glint
    P(ctx, 10, 9, 5, 5, IRON);
    P(ctx, 10, 9, 5, 1, IRON_L);
    outlineRect(ctx, 9, 8, 7, 7);
    P(ctx, 11, 2, 2, 8, '#22222a');
    P(ctx, 11, 2, 1, 8, '#5a5a64');
    P(ctx, 10, 2, 4, 1, OUT);
    if (f) { P(ctx, 11, 2, 2, 1, '#ffffff'); P(ctx, 12, 3, 1, 1, GLASS_HI); }
    // ammo belt + crate
    P(ctx, 15, 10, 2, 3, pal.haz);
    P(ctx, 15, 11, 2, 1, HAZK);
    P(ctx, 16, 16, 4, 3, '#8a7444');
    outlineRect(ctx, 16, 16, 4, 3);
  }

  function missileBox(ctx, x, y, pal) { // 8x9 launcher box, split hatch doors
    P(ctx, x, y, 8, 9, pal.base);
    P(ctx, x, y, 8, 1, pal.light);
    P(ctx, x, y, 1, 9, pal.light);
    P(ctx, x + 6, y + 1, 2, 8, pal.dark);
    P(ctx, x, y + 8, 8, 1, pal.dark);
    outlineRect(ctx, x - 1, y - 1, 10, 11);
    // center door split + hinge lines
    P(ctx, x + 3, y + 1, 1, 7, pal.shadow);
    P(ctx, x + 1, y + 3, 6, 1, pal.shadow);
    P(ctx, x + 1, y + 6, 6, 1, pal.shadow);
    // missile tips peeking from the cracked top doors
    P(ctx, x + 1, y + 1, 2, 1, '#d8d8d2');
    P(ctx, x + 5, y + 1, 2, 1, '#d8d8d2');
    P(ctx, x + 1, y + 1, 1, 1, PAL.nodRed);
    P(ctx, x + 5, y + 1, 1, 1, PAL.nodRed);
    // warning diamond
    P(ctx, x + 3, y + 4, 2, 2, pal.haz);
  }

  function drawAtwr(ctx, W, H, pal, f, side, rnd) { // 24x48 — tall missile tower
    baseSlab(ctx, W, H); slabNoise(ctx, W, H, rnd);
    // base plinth with hazard
    P(ctx, 5, 41, 18, 5, SH);
    panel(ctx, 3, 38, 18, 8, CONC, CONC_L, CONC_D);
    hazardH(ctx, 5, 42, 14, pal.haz);
    // shaft
    P(ctx, 17, 17, 3, 22, SH);
    P(ctx, 7, 14, 10, 25, CONC);
    P(ctx, 7, 14, 2, 25, CONC_L);
    P(ctx, 15, 14, 2, 25, CONC_D);
    P(ctx, 16, 14, 1, 25, CONC_D2);
    outlineRect(ctx, 6, 13, 12, 27);
    P(ctx, 8, 20, 8, 1, CONC_D); P(ctx, 8, 28, 8, 1, CONC_D);
    // window slit + gold band
    P(ctx, 9, 22, 6, 3, GLASS);
    P(ctx, 9, 22, 6, 1, GLASS_L);
    P(ctx, 10 + (f ? 2 : 0), 23, 1, 1, GLASS_HI);
    P(ctx, 8, 33, 8, 2, pal.trim);
    P(ctx, 8, 35, 8, 1, pal.shadow);
    // platform with struts
    P(ctx, 5, 12, 2, 3, CONC_D2); P(ctx, 17, 12, 2, 3, CONC_D2);
    P(ctx, 3, 9, 18, 5, CONC);
    P(ctx, 3, 9, 18, 1, CONC_L);
    P(ctx, 3, 12, 18, 2, CONC_D);
    outlineRect(ctx, 2, 8, 20, 7);
    // twin missile boxes with hatch doors
    missileBox(ctx, 3, 1, pal);
    missileBox(ctx, 14, 1, pal);
    // beacon
    P(ctx, 11, 0, 2, 2, f ? pal.trim2 : '#4a1810');
    if (f) { ctx.fillStyle = 'rgba(244,220,128,0.25)'; ctx.fillRect(9, 0, 6, 4); }
  }

  function drawGun(ctx, W, H, pal, f, side, rnd) { // 24x24 — turret base + ammo
    baseSlab(ctx, W, H); slabNoise(ctx, W, H, rnd);
    // ammo boxes on the slab corner
    P(ctx, 1, 18, 5, 4, '#6a5a20');
    P(ctx, 1, 18, 5, 1, '#8f7c30');
    outlineRect(ctx, 1, 18, 5, 4);
    P(ctx, 2, 19, 1, 1, pal.haz);
    P(ctx, 18, 1, 4, 4, '#6a5a20');
    P(ctx, 18, 1, 4, 1, '#8f7c30');
    outlineRect(ctx, 18, 1, 4, 4);
    // round base
    circleFill(ctx, 13, 13, 10, SH);
    circleFill(ctx, 12, 12, 11, OUT);
    circleFill(ctx, 12, 12, 10, pal.dark);
    circleFill(ctx, 12, 12, 8, pal.base);
    circleFill(ctx, 10, 10, 4, pal.light);
    circleFill(ctx, 12, 12, 4, pal.shadow);
    circleFill(ctx, 12, 12, 3, '#26262a');
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2 + 0.39;
      P(ctx, Math.round(12 + Math.cos(a) * 9), Math.round(12 + Math.sin(a) * 9), 1, 1, '#2e2e2a');
    }
    P(ctx, 11, 19, 2, 2, f ? pal.trim2 : '#3a1410');
  }

  function makeGunTurret(pal) { // 16 rotation frames, canonical north
    const c = mkCanvas(24, 24);
    const ctx = c.getContext('2d');
    // rear counterweight
    P(ctx, 9, 14, 6, 4, pal.dark);
    P(ctx, 9, 14, 6, 1, pal.base);
    outlineRect(ctx, 8, 13, 8, 6);
    // barrel: sleeve, tube with highlight, muzzle brake
    P(ctx, 10, 1, 4, 1, OUT);
    P(ctx, 10, 2, 4, 2, '#1d1d24');   // muzzle brake
    P(ctx, 10, 2, 4, 1, '#4a4a54');
    P(ctx, 10, 2, 1, 11, OUT); P(ctx, 13, 2, 1, 11, OUT);
    P(ctx, 11, 4, 2, 9, '#2e2e36');
    P(ctx, 11, 4, 1, 9, '#585862');
    P(ctx, 10, 7, 4, 3, '#3a3a44');   // recoil collar
    P(ctx, 10, 7, 4, 1, '#4e4e58');
    // mantlet + hub
    P(ctx, 9, 10, 6, 4, pal.dark);
    circleFill(ctx, 12, 13, 5, OUT);
    circleFill(ctx, 12, 13, 4, pal.base);
    circleFill(ctx, 11, 12, 2, pal.light);
    P(ctx, 12, 13, 2, 1, pal.shadow);
    P(ctx, 11, 15, 3, 1, pal.dark);   // rear hatch
    return rotFrames(c, 16);
  }

  function drawObli(ctx, W, H, pal, f, side, rnd, glow) { // 24x48 — black monolith
    baseSlab(ctx, W, H); slabNoise(ctx, W, H, rnd);
    // plinth with vents
    P(ctx, 6, 42, 16, 4, SH);
    P(ctx, 4, 40, 16, 5, '#26262d');
    P(ctx, 4, 40, 16, 1, '#3a3a46');
    outlineRect(ctx, 3, 39, 18, 7);
    P(ctx, 6, 42, 3, 1, '#15151a'); P(ctx, 11, 42, 3, 1, '#15151a'); P(ctx, 16, 42, 3, 1, '#15151a');
    // sleek tapered monolith
    for (let y = 4; y < 41; y++) {
      const t = (y - 4) / 37;
      const hw = Math.max(1, Math.round(1 + t * 4));
      P(ctx, 12 - hw - 1, y, 1, 1, OUT);
      P(ctx, 12 + hw, y, 1, 1, OUT);
      P(ctx, 12 - hw, y, hw * 2, 1, '#191920');
      P(ctx, 12 - hw, y, 1, 1, '#34343f');       // lit west edge
      P(ctx, 12 + hw - 1, y, 1, 1, '#0e0e13');   // dark east edge
    }
    P(ctx, 11, 3, 2, 1, OUT);
    // subtle red edge-light groove down the face
    P(ctx, 11, 8, 1, 31, glow ? '#d04030' : '#571812');
    if (!glow && f) P(ctx, 11, 8, 1, 31, '#7a1f16');
    if (glow > 0) {
      const tip = ['#a02818', '#e04028', '#ff7050'][glow - 1];
      const core = ['#ff8060', '#ffc0a0', '#ffffff'][glow - 1];
      P(ctx, 10, 2, 4, 3 + glow, tip);
      P(ctx, 11, 3, 2, 2 + glow, core);
      P(ctx, 11, 8, 1, 31, glow >= 2 ? '#ff6a50' : '#d04030');
      if (glow >= 2) P(ctx, 12, 12, 1, 20, '#a03224');
      ctx.fillStyle = 'rgba(255,80,44,' + (0.12 * glow).toFixed(2) + ')';
      ctx.fillRect(6, 0, 12, 12 + glow * 4);
      if (glow === 3) { P(ctx, 9, 0, 6, 2, 'rgba(255,220,200,0.55)'); }
    } else {
      P(ctx, 11, 4, 2, 2, f ? '#8a2418' : '#5c1810');
    }
  }

  function drawSam(ctx, W, H, pal, f, side, rnd, open) { // 48x24 — dome launcher
    baseSlab(ctx, W, H); slabNoise(ctx, W, H, rnd);
    P(ctx, 6, 8, 40, 15, SH);
    P(ctx, 4, 6, 40, 16, pal.dark);
    P(ctx, 5, 7, 38, 1, pal.base);
    P(ctx, 5, 20, 38, 1, pal.shadow);
    outlineRect(ctx, 3, 5, 42, 18);
    // deck seams + hazard corners
    P(ctx, 10, 8, 1, 12, pal.shadow); P(ctx, 38, 8, 1, 12, pal.shadow);
    hazardH(ctx, 5, 17, 5, pal.haz); hazardH(ctx, 38, 17, 5, pal.haz);
    P(ctx, 5, 8, 2, 2, PAL.uiGold);
    P(ctx, 41, 8, 2, 2, PAL.uiGold);
    if (!open) {
      dome(ctx, 24, 21, 10, pal.base, pal.light, pal.shadow);
      // meridian panel lines
      P(ctx, 24, 11, 1, 10, pal.dark);
      for (const dx of [-5, 5]) {
        for (let dy = 0; dy <= 8; dy++) {
          const hw = Math.floor(Math.sqrt(100 - dy * dy) + 0.5);
          if (Math.abs(dx) < hw) P(ctx, 24 + (dx < 0 ? -Math.round(hw * 0.55) : Math.round(hw * 0.55)), 21 - dy, 1, 1, pal.dark);
        }
      }
      // latitude seam
      for (let dx = -7; dx <= 7; dx++) {
        const dy = Math.round(Math.sqrt(Math.max(0, 100 - dx * dx)) * 0.55);
        P(ctx, 24 + dx, 21 - dy - 2, 1, 1, pal.dark);
      }
      P(ctx, 20, 13, 2, 1, pal.light);
      P(ctx, 7, 16, 2, 2, f ? pal.trim2 : '#3a1410');
    } else {
      const gap = [0, 2, 5, 8][open];
      // pit interior with rack
      P(ctx, 24 - gap - 1, 11, (gap + 1) * 2, 11, '#15150f');
      P(ctx, 24 - gap - 1, 11, (gap + 1) * 2, 1, '#060604');
      if (open >= 1) { P(ctx, 24 - gap, 20, gap * 2, 1, '#3a3a32'); }
      if (open >= 2) {
        // rack rails + twin missiles, white with red noses
        P(ctx, 24 - gap, 18, gap * 2, 1, '#4c4c44');
        P(ctx, 20, 12, 2, 9, '#e2e2da'); P(ctx, 20, 12, 1, 9, '#ffffff');
        P(ctx, 26, 12, 2, 9, '#e2e2da'); P(ctx, 26, 12, 1, 9, '#ffffff');
        P(ctx, 20, 12, 2, 2, PAL.nodRedLight); P(ctx, 26, 12, 2, 2, PAL.nodRedLight);
        P(ctx, 20, 19, 2, 1, '#8a8a84'); P(ctx, 26, 19, 2, 1, '#8a8a84');
      }
      if (open >= 3) {
        // center missile raised on the elevator
        P(ctx, 23, 9, 3, 12, '#f0f0e8');
        P(ctx, 23, 9, 1, 12, '#ffffff');
        P(ctx, 23, 9, 3, 2, PAL.nodRedLight);
        P(ctx, 23, 10, 1, 1, '#ffe0d0');
        P(ctx, 22, 20, 5, 1, '#6a6a62');
      }
      // dome halves slid apart, with hydraulic arms
      for (let dy = 0; dy <= 9; dy++) {
        const hw = Math.floor(Math.sqrt(81 - dy * dy) + 0.5);
        if (hw < 2) continue;
        const y = 21 - dy;
        P(ctx, 24 - hw - gap, y, hw - 1, 1, pal.base);
        P(ctx, 24 - hw - gap, y, 2, 1, pal.light);
        P(ctx, 24 + gap + 1, y, hw - 1, 1, pal.base);
        P(ctx, 24 + gap + hw - 2, y, 2, 1, pal.shadow);
      }
      P(ctx, 24 - gap - 1, 20, 2, 1, IRON_L); P(ctx, 24 + gap - 1, 20, 2, 1, IRON_L);
      P(ctx, 7, 16, 2, 2, pal.trim2);
    }
  }

  // ---- builders table / frame counts -----------------------------------------

  const BUILDERS = {
    fact: drawFact,
    nuke: (ctx, W, H, p, f, s, r) => drawNukePlant(ctx, W, H, p, f, s, r, false),
    nuk2: (ctx, W, H, p, f, s, r) => drawNukePlant(ctx, W, H, p, f, s, r, true),
    proc: drawProc,
    silo: drawSilo,
    pyle: drawPyle,
    hand: drawHand,
    weap: drawWeap,
    afld: drawAfld,
    hq: drawHq,
    eye: drawEye,
    tmpl: drawTmpl,
    hpad: drawHpad,
    fix: drawFix,
    gtwr: drawGtwr,
    atwr: drawAtwr,
    gun: drawGun,
    obli: (ctx, W, H, p, f, s, r) => drawObli(ctx, W, H, p, f, s, r, 0),
    sam: (ctx, W, H, p, f, s, r) => drawSam(ctx, W, H, p, f, s, r, 0),
  };

  // idle animation frame counts (default 2)
  const FRAME_COUNT = {
    fact: 4, nuke: 3, nuk2: 3, proc: 4, weap: 4, afld: 4,
    hq: 8, eye: 4, tmpl: 4, hpad: 4,
  };

  // ---- damage overlay (deterministic per key+side; fires flicker per frame) --

  function hashStr(s) {
    let h = 9;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 387420489);
    return h >>> 0;
  }

  function damageOverlay(ctx, W, H, seedStr) {
    const rnd = mulberry(hashStr(seedStr));
    const scale = Math.max(1, Math.round((W * H) / 1800));
    const CR = '#12120e';
    // cracks
    const nCracks = Math.min(4, 1 + scale);
    for (let i = 0; i < nCracks; i++) {
      let x = 4 + rnd() * (W - 8), y = 4 + rnd() * (H - 8);
      let dx = rnd() < 0.5 ? -1 : 1, dy = rnd() < 0.5 ? -1 : 1;
      const steps = 5 + Math.floor(rnd() * 5);
      for (let s = 0; s < steps; s++) {
        P(ctx, Math.round(x), Math.round(y), 2, 1, CR);
        P(ctx, Math.round(x), Math.round(y) + 1, 1, 1, CR);
        x += dx * (1 + rnd() * 2);
        y += dy * (1 + rnd() * 2);
        if (rnd() < 0.3) dx = -dx;
        if (rnd() < 0.3) dy = -dy;
        x = clamp(x, 1, W - 3);
        y = clamp(y, 1, H - 2);
      }
    }
    // soot smears
    ctx.fillStyle = 'rgba(16,14,10,0.45)';
    const nSoot = Math.min(4, 1 + scale);
    for (let i = 0; i < nSoot; i++) {
      const sx = 3 + rnd() * (W - 12), sy = 3 + rnd() * (H - 10);
      for (let j = 0; j < 14; j++)
        ctx.fillRect(Math.round(sx + (rnd() - 0.5) * 10), Math.round(sy + (rnd() - 0.5) * 8), 2, 2);
    }
    // broken details: 1-2 torn holes
    const nHoles = Math.min(2, scale);
    for (let i = 0; i < nHoles; i++) {
      const hx = Math.round(4 + rnd() * (W - 12)), hy = Math.round(4 + rnd() * (H - 12));
      P(ctx, hx, hy, 6, 4, '#0d0d0a');
      P(ctx, hx + 1, hy - 1, 3, 1, '#0d0d0a');
      P(ctx, hx + 2, hy + 4, 3, 1, '#0d0d0a');
      P(ctx, hx, hy, 1, 1, '#55554e');
      P(ctx, hx + 5, hy + 3, 1, 1, '#55554e');
    }
  }

  // burning fires + smoke, positions seeded, flames flicker with frame parity
  function fireOverlay(ctx, W, H, seedStr, f) {
    // battle-worn wash
    ctx.fillStyle = 'rgba(16,12,8,0.14)';
    ctx.fillRect(1, 1, W - 2, H - 2);
    const rnd = mulberry(hashStr(seedStr));
    const n = clamp(Math.round(W * H / 1400), 2, 4);
    for (let i = 0; i < n; i++) {
      const x = (5 + rnd() * (W - 12)) | 0;
      const y = (8 + rnd() * (H - 16)) | 0;
      const k = (f + i) % 2;
      // scorch bed
      P(ctx, x - 2, y + 3, 8, 2, '#15130e');
      P(ctx, x - 1, y + 5, 6, 1, '#0f0e0a');
      // smoke rising (alternates side)
      ctx.fillStyle = 'rgba(44,42,40,0.55)';
      ctx.fillRect(x + (k ? -1 : 2), y - 6, 3, 3);
      ctx.fillStyle = 'rgba(60,58,56,0.35)';
      ctx.fillRect(x + (k ? 2 : -2), y - 10, 3, 3);
      // flame body
      P(ctx, x - 1, y + 1, 6, 3, PAL.fire3);
      P(ctx, x, y, 4, 3, PAL.fire2);
      if (k) {
        P(ctx, x + 1, y - 2, 2, 3, PAL.fire1);
        P(ctx, x, y, 1, 2, PAL.fire1);
      } else {
        P(ctx, x, y - 2, 2, 2, PAL.fire1);
        P(ctx, x + 2, y - 1, 2, 2, PAL.fire1);
      }
    }
  }

  // ---- frame factories --------------------------------------------------------

  function renderBuildingFrame(key, side, f, damaged) {
    const d = DATA.buildings[key];
    const W = d.w * C.CELL, H = d.h * C.CELL;
    const c = mkCanvas(W, H + 8);
    const ctx = c.getContext('2d');
    const rnd = mulberry(hashStr(key + ':' + side));
    drawBib(ctx, W, H, rnd);
    BUILDERS[key](ctx, W, H, sidePal(side), f, side, rnd);
    if (damaged) {
      damageOverlay(ctx, W, H, key + ':' + side);
      fireOverlay(ctx, W, H, key + ':' + side + ':fire', f);
    }
    return c;
  }

  function renderObliCharge(side, glow) {
    const d = DATA.buildings.obli;
    const W = d.w * C.CELL, H = d.h * C.CELL;
    const c = mkCanvas(W, H + 8);
    const ctx = c.getContext('2d');
    const rnd = mulberry(hashStr('obli:' + side));
    drawBib(ctx, W, H, rnd);
    drawObli(ctx, W, H, sidePal(side), 0, side, rnd, glow);
    return c;
  }

  function renderSamOpen(side, stage) {
    const d = DATA.buildings.sam;
    const W = d.w * C.CELL, H = d.h * C.CELL;
    const c = mkCanvas(W, H + 8);
    const ctx = c.getContext('2d');
    const rnd = mulberry(hashStr('sam:' + side));
    drawBib(ctx, W, H, rnd);
    drawSam(ctx, W, H, sidePal(side), 0, side, rnd, stage);
    return c;
  }

  // ---- cameos -------------------------------------------------------------------

  function cameoCanvas() {
    const c = mkCanvas(C.CAMEO_W, C.CAMEO_H);
    const ctx = c.getContext('2d');
    P(ctx, 0, 0, 64, 48, PAL.cameoBg);
    // diagonal slate bands + dot dither
    for (let y = 0; y < 38; y++) {
      for (let x = 1; x < 63; x++) {
        if ((((x + y) / 8) | 0) % 2) P(ctx, x, y, 1, 1, '#1e1e19');
      }
    }
    ctx.fillStyle = '#2b2b25';
    for (let y = 2; y < 38; y += 4)
      for (let x = (y % 8 === 2) ? 2 : 4; x < 62; x += 4) ctx.fillRect(x, y, 1, 1);
    // soft key-light from top-left
    ctx.fillStyle = 'rgba(216,208,168,0.05)';
    for (let y = 0; y < 16; y++) ctx.fillRect(1, y, Math.max(0, 20 - y), 1);
    return c;
  }

  function finishCameo(ctx, label) {
    P(ctx, 1, 38, 62, 9, PAL.uiGold);
    P(ctx, 1, 38, 62, 1, '#f0d878');
    P(ctx, 1, 46, 62, 1, '#907020');
    ctx.font = '7px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#241c08';
    const w = ctx.measureText(label).width;
    if (w > 58) {
      ctx.save();
      ctx.translate(32, 43);
      ctx.scale(58 / w, 1);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    } else {
      ctx.fillText(label, 32, 43);
    }
    outlineRect(ctx, 0, 0, 64, 48, '#000000');
  }

  function buildingCameo(key) {
    const d = DATA.buildings[key];
    const side = d.side || 'gdi';
    const entry = SPRITES.buildings[key][side];
    let spr = entry.normal[0];
    if (key === 'gun') { // composite base + north turret so it reads as a turret
      const t = mkCanvas(spr.width, spr.height);
      const tc = t.getContext('2d');
      tc.drawImage(spr, 0, 0);
      tc.drawImage(entry.turret[0], 0, 0);
      spr = t;
    }
    if (key === 'obli') spr = entry.charge[1]; // mid glow reads better
    if (key === 'sam') spr = entry.open[1];    // cracked-open pose reads better
    const c = cameoCanvas();
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    let s = Math.min(56 / spr.width, 32 / spr.height, 1.6);
    const dw = Math.max(1, Math.round(spr.width * s));
    const dh = Math.max(1, Math.round(spr.height * s));
    // grounding shadow behind the portrait
    ellipseFill(ctx, 32, Math.round((37 - dh) / 2) + dh - 1, Math.min(28, (dw >> 1) + 4), 3, 'rgba(0,0,0,0.35)');
    ctx.drawImage(spr, Math.round((64 - dw) / 2), Math.round((37 - dh) / 2) + 1, dw, dh);
    finishCameo(ctx, d.name);
    return c;
  }

  function ionCameo() {
    const c = cameoCanvas();
    const ctx = c.getContext('2d');
    // deep space
    P(ctx, 1, 1, 62, 37, '#0a0e16');
    const stars = [[6, 4], [16, 9], [55, 4], [45, 10], [59, 18], [9, 18], [24, 3], [36, 7]];
    for (let i = 0; i < stars.length; i++)
      P(ctx, stars[i][0], stars[i][1], 1, 1, i % 2 ? '#8890a0' : '#d8e0ec');
    // earth horizon curve at bottom
    for (let x = 1; x < 63; x++) {
      const y = 34 - Math.round(Math.sqrt(Math.max(0, 900 - (x - 32) * (x - 32))) * 0.14);
      P(ctx, x, y, 1, 38 - y, '#14281c');
      P(ctx, x, y, 1, 1, '#2c5a3a');
    }
    // orbital cannon platform (top-left), dish aimed down-right
    P(ctx, 4, 8, 8, 5, '#b8b8ae');           // hull
    P(ctx, 4, 8, 8, 1, '#e0e0d6');
    P(ctx, 4, 12, 8, 1, '#6e6e64');
    outlineRect(ctx, 3, 7, 10, 7);
    // solar panels
    P(ctx, 1, 9, 3, 3, '#1c3a5c'); P(ctx, 1, 9, 3, 1, '#3a6a9c');
    P(ctx, 12, 9, 6, 3, '#1c3a5c'); P(ctx, 12, 9, 6, 1, '#3a6a9c');
    P(ctx, 14, 9, 1, 3, '#0e2038'); P(ctx, 16, 9, 1, 3, '#0e2038');
    // firing dish
    P(ctx, 8, 13, 6, 3, PAL.uiGold);
    P(ctx, 9, 14, 5, 2, '#f0d878');
    P(ctx, 10, 16, 4, 2, '#b08820');
    // the beam, diagonal to impact
    for (let i = 0; i < 22; i++) {
      const bx = 12 + i * 1.6, by = 16 + i;
      P(ctx, Math.round(bx) - 2, Math.round(by), 7, 1, 'rgba(168,216,248,0.30)');
      P(ctx, Math.round(bx) - 1, Math.round(by), 5, 1, PAL.ion);
      P(ctx, Math.round(bx), Math.round(by), 2, 1, '#eef8ff');
    }
    // impact glow
    ellipseFill(ctx, 48, 36, 10, 3, 'rgba(168,216,248,0.5)');
    ellipseFill(ctx, 48, 36, 6, 2, PAL.ion);
    ellipseFill(ctx, 48, 36, 3, 1, '#ffffff');
    finishCameo(ctx, 'Ion Cannon');
    return c;
  }

  function nukeCameo() {
    const c = cameoCanvas();
    const ctx = c.getContext('2d');
    // ominous red-black sky
    P(ctx, 1, 1, 62, 37, '#1a0f0c');
    P(ctx, 1, 1, 62, 8, '#33201a');
    P(ctx, 1, 9, 62, 3, '#26160f');
    const embers = [[8, 6], [52, 9], [14, 14], [58, 25], [6, 28]];
    for (let i = 0; i < embers.length; i++) P(ctx, embers[i][0], embers[i][1], 1, 1, '#7c3018');
    // warhead body
    P(ctx, 28, 7, 8, 20, '#b8b8c0');
    P(ctx, 28, 7, 2, 20, '#e0e0e6');
    P(ctx, 30, 7, 1, 20, '#cccccf');
    P(ctx, 34, 7, 2, 20, '#74747c');
    outlineRect(ctx, 27, 6, 10, 22, '#15151a');
    // red nose cone
    P(ctx, 31, 1, 2, 2, PAL.nodRedLight);
    P(ctx, 30, 3, 4, 2, PAL.nodRedLight);
    P(ctx, 29, 5, 6, 2, PAL.nodRed);
    P(ctx, 30, 3, 1, 3, '#ff8a70');
    // radiation trefoil band
    P(ctx, 28, 13, 8, 6, '#e8d048');
    P(ctx, 28, 13, 8, 1, '#f6ecac');
    P(ctx, 28, 18, 8, 1, '#a89020');
    P(ctx, 31, 15, 2, 2, '#15151a');           // hub
    P(ctx, 30, 13, 1, 2, '#15151a'); P(ctx, 33, 13, 1, 2, '#15151a'); // upper blades
    P(ctx, 29, 17, 2, 1, '#15151a'); P(ctx, 33, 17, 2, 1, '#15151a'); // lower blades
    // fins
    P(ctx, 24, 23, 4, 6, '#8a8a94'); P(ctx, 24, 23, 4, 1, '#b8b8c2');
    P(ctx, 36, 23, 4, 6, '#5e5e68');
    P(ctx, 23, 27, 2, 2, '#15151a'); P(ctx, 39, 27, 2, 2, '#15151a');
    // exhaust flame
    P(ctx, 29, 28, 6, 2, PAL.fire1);
    P(ctx, 30, 30, 4, 3, PAL.fire2);
    P(ctx, 31, 33, 2, 3, PAL.fire3);
    P(ctx, 28, 29, 1, 2, 'rgba(240,144,32,0.5)'); P(ctx, 35, 29, 1, 2, 'rgba(240,144,32,0.5)');
    finishCameo(ctx, 'Nuclear Strike');
    return c;
  }

  // ---- generate everything at load ---------------------------------------------

  for (const key of Object.keys(DATA.buildings)) {
    SPRITES.buildings[key] = SPRITES.buildings[key] || {};
    for (const side of ['gdi', 'nod']) {
      const n = FRAME_COUNT[key] || 2;
      const normal = [], damaged = [];
      for (let f = 0; f < n; f++) {
        normal.push(renderBuildingFrame(key, side, f, false));
        damaged.push(renderBuildingFrame(key, side, f, true));
      }
      const entry = { normal, damaged };
      if (key === 'gun') entry.turret = makeGunTurret(sidePal(side));
      if (key === 'obli') entry.charge = [1, 2, 3].map(g => renderObliCharge(side, g));
      if (key === 'sam') entry.open = [1, 2, 3].map(g => renderSamOpen(side, g));
      SPRITES.buildings[key][side] = entry;
    }
    SPRITES.cameo[key] = buildingCameo(key);
  }
  // Superweapon cameos live under dedicated keys: 'nuke' is the Power Plant
  // (its original internal name) and must keep its own cameo.
  SPRITES.cameo.ionStrike = ionCameo();
  SPRITES.cameo.nukeStrike = nukeCameo();
})();
