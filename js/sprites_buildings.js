'use strict';
// sprites_buildings.js — procedurally drawn building sprites + cameos.
// Fills, for every key in DATA.buildings and BOTH sides:
//   SPRITES.buildings[key][side] = { normal:[frames], damaged:[frames] }
//   (+ gun turret rotation frames, obelisk charge frames, SAM open frames)
// and SPRITES.cameo[key] for every building, plus SPRITES.cameo.ion and
// SPRITES.cameo.nuke superweapon cameos. Defines no globals (IIFE).
//
// Canvas size per building: w*24 x (h*24 + 8). The bottom 8 rows are the
// concrete bib apron; render anchors the canvas top-left to the footprint
// top-left cell, so the bib hangs just below the footprint.

(function () {
  if (typeof document === 'undefined' || typeof SPRITES === 'undefined' ||
      typeof DATA === 'undefined' || typeof PAL === 'undefined') return;

  const OUT = PAL.outline;

  // shared shade constants (concrete / steel / glass / olive drab)
  const SLAB = '#73736b', SLAB_L = '#84847b', SLAB_D = '#595952';
  const CONC = '#a8a8a0', CONC_L = '#c8c8c0', CONC_D = '#70706a';
  const STEEL = '#9a9a92', STEEL_L = '#c4c4bc', STEEL_D = '#6e6e68';
  const GLASS = '#20303c', GLASS_L = '#7ea8c8';
  const DOOR = '#33332e';
  const OLV = '#5c6634', OLV_L = '#79844a', OLV_D = '#3f4722';

  function sidePal(side) {
    return side === 'gdi'
      ? { base: PAL.gdi, light: PAL.gdiLight, dark: PAL.gdiDark, shadow: PAL.gdiShadow,
          trim: PAL.uiGold, trim2: '#f4dc80',
          blackA: '#2b2822', blackB: '#38342c', blackC: '#474033' }
      : { base: PAL.nod, light: PAL.nodLight, dark: PAL.nodDark, shadow: PAL.nodShadow,
          trim: PAL.nodRed, trim2: PAL.nodRedLight,
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

  // half-dome sitting on baseY (rows above baseY), shaded, outlined
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

  // top-down cooling stack (power plant); hot = bright glowing core
  function stack(ctx, cx, cy, r, hot) {
    circleFill(ctx, cx, cy, r + 1, OUT);
    circleFill(ctx, cx, cy, r, '#9b9b93');
    circleFill(ctx, cx - 2, cy - 2, Math.max(2, r - 3), '#b7b7ae');
    circleFill(ctx, cx, cy, Math.max(2, r - 3), '#3a3a34');
    circleFill(ctx, cx, cy, Math.max(1, r - 5), hot ? '#f0e060' : '#262621');
    if (hot && r - 7 >= 1) circleFill(ctx, cx, cy, r - 7, '#fff8c0');
  }

  function steam(ctx, cx, cy, f) {
    const pts = f
      ? [[-4, -1], [0, -4], [3, -2], [-1, -7], [4, -6]]
      : [[3, -1], [-2, -4], [-5, -3], [1, -6], [-3, -8]];
    for (let i = 0; i < pts.length; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(238,240,238,0.85)' : 'rgba(212,216,212,0.6)';
      ctx.fillRect(cx + pts[i][0], cy + pts[i][1], 2, 2);
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

  // concrete bib apron: bottom 8 rows, grey slabs with dark seams
  function drawBib(ctx, W, H) {
    P(ctx, 0, H, W, 8, PAL.rock2);
    P(ctx, 0, H + 4, W, 1, PAL.rock3);
    for (let x = 0; x < W; x += 12) P(ctx, x, H, 1, 4, PAL.rock3);
    for (let x = 6; x < W; x += 12) P(ctx, x, H + 5, 1, 3, PAL.rock3);
    P(ctx, 0, H, W, 1, '#9c9c92');
    P(ctx, 0, H + 7, W, 1, '#45453f');
  }

  // ---- building drawers -------------------------------------------------------
  // signature: (ctx, W, H, pal, f, side); W/H = footprint px (bib excluded)

  function drawFact(ctx, W, H, pal, f) { // 72x48 — construction pad + yellow crane
    baseSlab(ctx, W, H);
    // construction pad
    P(ctx, 4, 8, 40, 36, '#5f5f58');
    outlineRect(ctx, 3, 7, 42, 38);
    P(ctx, 5, 9, 38, 1, '#4c4c46');
    for (let i = 0; i < 9; i++) P(ctx, 6 + i * 4, 11, 2, 2, i % 2 ? PAL.uiGold : '#2e2e28');
    P(ctx, 10, 22, 26, 1, '#50504a'); P(ctx, 10, 33, 26, 1, '#50504a');
    P(ctx, 23, 15, 1, 26, '#50504a');
    // main structure (right)
    panel(ctx, 46, 4, 24, 40, pal.base, pal.light, pal.dark);
    P(ctx, 48, 8, 20, 3, pal.trim);
    P(ctx, 50, 16, 5, 4, GLASS); P(ctx, 50, 16, 5, 1, GLASS_L);
    P(ctx, 60, 16, 5, 4, GLASS); P(ctx, 60, 16, 5, 1, GLASS_L);
    P(ctx, 53, 32, 10, 12, DOOR);
    outlineRect(ctx, 52, 31, 12, 13);
    P(ctx, 54, 34, 8, 1, '#57574f');
    // crane mast
    P(ctx, 40, 6, 4, 26, '#caa22a');
    P(ctx, 40, 6, 1, 26, '#f0d060');
    P(ctx, 43, 6, 1, 26, '#8a6e18');
    outlineRect(ctx, 39, 5, 6, 28);
    // boom — shifts 2px between frames
    const bx = 8 - f * 2;
    P(ctx, bx, 6, 44 - bx, 3, '#caa22a');
    P(ctx, bx, 6, 44 - bx, 1, '#f0d060');
    for (let x = bx + 3; x < 40; x += 4) P(ctx, x, 7, 1, 2, '#8a6e18');
    P(ctx, bx, 9, 44 - bx, 1, OUT);
    // cable + hook block over the pad
    P(ctx, bx + 2, 10, 1, 9, '#1a1a16');
    P(ctx, bx, 19, 6, 4, '#8a8a90');
    outlineRect(ctx, bx, 19, 6, 4);
    // roof beacon
    P(ctx, 66, 6, 2, 2, f ? PAL.fire1 : '#5c2014');
  }

  function drawNukePlant(ctx, W, H, pal, f, adv) { // 48x48 — cooling stacks
    baseSlab(ctx, W, H);
    panel(ctx, 4, 30, 40, 14, pal.base, pal.light, pal.dark);
    P(ctx, 6, 32, 36, 2, pal.trim);
    P(ctx, 20, 36, 8, 8, DOOR);
    outlineRect(ctx, 19, 35, 10, 9);
    stack(ctx, 14, 16, 9, adv);
    stack(ctx, 34, 16, 9, adv);
    if (adv) stack(ctx, 24, 24, 5, true);
    if (!adv && f) { circleFill(ctx, 14, 16, 2, '#34342c'); circleFill(ctx, 34, 16, 2, '#34342c'); }
    steam(ctx, 14, 9, f);
    steam(ctx, 34, 9, f ? 0 : 1);
    if (adv) steam(ctx, 24, 19, f);
  }

  function drawProc(ctx, W, H, pal, f) { // 72x48 — tank + south-center dock arm
    baseSlab(ctx, W, H);
    // processing hall (right)
    panel(ctx, 44, 4, 24, 26, pal.base, pal.light, pal.dark);
    P(ctx, 46, 7, 20, 2, pal.trim);
    P(ctx, 48, 13, 4, 3, GLASS); P(ctx, 56, 13, 4, 3, GLASS);
    P(ctx, 48, 13, 4, 1, GLASS_L); P(ctx, 56, 13, 4, 1, GLASS_L);
    P(ctx, 50, 22, 10, 8, '#3f3f39');
    // pipes hall -> tank
    P(ctx, 32, 12, 12, 3, STEEL); P(ctx, 32, 12, 12, 1, STEEL_L);
    P(ctx, 32, 12, 1, 3, OUT); P(ctx, 32, 14, 12, 1, STEEL_D);
    // big tiberium storage tank (left, top-down)
    circleFill(ctx, 18, 17, 14, OUT);
    circleFill(ctx, 18, 17, 13, pal.base);
    circleFill(ctx, 15, 14, 8, pal.light);
    circleFill(ctx, 18, 17, 6, pal.dark);
    circleFill(ctx, 18, 17, 4, PAL.tibDark);
    P(ctx, 16, 15, 2, 1, PAL.tib2);
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2 + 0.39;
      P(ctx, Math.round(18 + Math.cos(a) * 11), Math.round(17 + Math.sin(a) * 11), 1, 1, pal.shadow);
    }
    // dock (south-center cell x24..48): pit, canopy arm, rails
    P(ctx, 26, 32, 20, 14, '#46463f');
    outlineRect(ctx, 25, 31, 22, 16);
    P(ctx, 28, 46, 2, 8, '#5e5e56'); P(ctx, 42, 46, 2, 8, '#5e5e56');
    P(ctx, 28, 25, 16, 8, pal.base);
    P(ctx, 28, 25, 16, 1, pal.light);
    P(ctx, 28, 31, 16, 2, pal.dark);
    outlineRect(ctx, 27, 24, 18, 10);
    // intake lights (anim)
    for (let i = 0; i < 3; i++)
      P(ctx, 30 + i * 5, 29, 2, 2, ((i + f) % 2) ? PAL.tib2 : '#1e4a22');
    // tiberium spill pixels around the dock
    const spill = [[27, 44], [30, 47], [34, 43], [38, 46], [42, 44], [45, 47], [32, 50], [40, 51], [25, 49], [36, 49]];
    const tibCols = [PAL.tib1, PAL.tib2, PAL.tib3];
    for (let i = 0; i < spill.length; i++)
      P(ctx, spill[i][0], spill[i][1], 2, 2, tibCols[i % 3]);
  }

  function drawSilo(ctx, W, H, pal, f) { // 48x24 — twin silver domes
    baseSlab(ctx, W, H);
    P(ctx, 3, 14, 42, 8, pal.dark);
    P(ctx, 3, 14, 42, 1, pal.base);
    dome(ctx, 12, 21, 9, '#b4b4bc', '#e2e2e8', '#74747c');
    dome(ctx, 35, 21, 9, '#b4b4bc', '#e2e2e8', '#74747c');
    siloStripe(ctx, 12, 21, 9);
    siloStripe(ctx, 35, 21, 9);
    P(ctx, 22, 16, 4, 5, pal.base);
    P(ctx, 23, 17, 2, 2, f ? PAL.uiGreen : '#1e4a22');
  }
  function siloStripe(ctx, cx, baseY, r) { // fill-level hint stripe
    for (let k = 0; k < 2; k++) {
      const dy = 4 + k;
      const hw = Math.floor(Math.sqrt(r * r - dy * dy));
      P(ctx, cx - hw, baseY - dy, hw * 2 + 1, 1, k ? PAL.tib2 : PAL.tibDark);
    }
  }

  function hut(ctx, x, y, w, h, pal) { // olive quonset hut
    outlineRect(ctx, x - 1, y - 1, w + 2, h + 2);
    P(ctx, x, y, w, h, OLV);
    P(ctx, x, y, w, 3, OLV_L);
    P(ctx, x, y + h - 4, w, 4, OLV_D);
    for (let i = x + 5; i < x + w - 8; i += 6) P(ctx, i, y, 1, h, 'rgba(18,22,10,0.35)');
    P(ctx, x + w - 7, y + 3, 6, h - 5, OLV_D);
    P(ctx, x + w - 6, y + 5, 4, h - 8, '#272c16');
    P(ctx, x + w - 7, y + 3, 6, 1, pal.trim);
  }

  function drawPyle(ctx, W, H, pal, f) { // 48x48 — two barracks huts + flag
    baseSlab(ctx, W, H);
    hut(ctx, 4, 6, 38, 15, pal);
    hut(ctx, 4, 27, 31, 15, pal);
    // flag pole (flutter anim)
    P(ctx, 41, 25, 1, 15, '#d8d8d0');
    P(ctx, 41, 24, 1, 1, '#ffffff');
    if (f) { P(ctx, 42, 25, 5, 3, pal.trim); P(ctx, 42, 28, 3, 1, pal.trim); }
    else { P(ctx, 42, 26, 4, 3, pal.trim); P(ctx, 46, 27, 1, 1, pal.trim2); }
    // crates
    P(ctx, 38, 36, 7, 7, '#8a7444');
    outlineRect(ctx, 38, 36, 7, 7);
    P(ctx, 39, 37, 3, 1, '#a89058');
  }

  const HAND_EMBLEM = [
    '.r.r.r.',
    '.r.r.r.',
    '.rrrrr.',
    'rrrrrrr',
    'rrrrrrr',
    '.rrrrr.',
    '.rrrr..',
    '..rrr..',
    '..rrr..',
  ];

  function drawHand(ctx, W, H, pal, f) { // 48x48 — dark angular block + hand emblem
    baseSlab(ctx, W, H);
    for (let x = 6; x < 42; x++) {
      const top = 24 - Math.floor((x - 6) * 0.45);
      P(ctx, x, top - 1, 1, 1, OUT);
      P(ctx, x, top, 1, 44 - top, pal.blackB);
      P(ctx, x, top, 1, 1, pal.blackC);
      if (x % 3 === 0) P(ctx, x, top + 2, 2, 1, pal.trim);
    }
    P(ctx, 5, 22, 1, 23, OUT);
    P(ctx, 42, 7, 1, 38, OUT);
    P(ctx, 6, 44, 36, 1, OUT);
    P(ctx, 6, 35, 36, 8, pal.blackA);
    // emblem panel + hand
    P(ctx, 20, 19, 15, 17, '#141419');
    outlineRect(ctx, 19, 18, 17, 19, '#000000');
    blit(ctx, 24, 23, HAND_EMBLEM, { r: pal.trim2 });
    // door
    P(ctx, 8, 36, 8, 8, '#101014');
    outlineRect(ctx, 7, 35, 10, 9);
    // beacon at apex
    P(ctx, 40, 5, 2, 2, f ? pal.trim2 : '#401410');
  }

  function drawWeap(ctx, W, H, pal, f) { // 72x48 — factory hall + roller door
    baseSlab(ctx, W, H);
    panel(ctx, 4, 6, 64, 38, pal.base, pal.light, pal.dark);
    for (let y = 10; y < 21; y += 3) P(ctx, 7, y, 58, 1, pal.dark);
    P(ctx, 6, 7, 60, 2, pal.light);
    P(ctx, 6, 22, 60, 2, pal.trim);
    // roof vent
    P(ctx, 11, 10, 7, 9, pal.dark);
    outlineRect(ctx, 10, 9, 9, 11);
    P(ctx, 12, 11, 5, 1, pal.shadow);
    // big grey roller door
    P(ctx, 22, 26, 28, 18, '#9a9a92');
    P(ctx, 22, 26, 28, 1, '#c0c0b8');
    for (let y = 29; y < 43; y += 3) P(ctx, 23, y, 26, 1, '#6e6e68');
    outlineRect(ctx, 21, 25, 30, 19);
    // front windows
    P(ctx, 9, 30, 6, 4, GLASS); P(ctx, 9, 30, 6, 1, GLASS_L);
    P(ctx, 57, 30, 6, 4, GLASS); P(ctx, 57, 30, 6, 1, GLASS_L);
    // roof beacon (blink)
    P(ctx, 61, 9, 3, 3, f ? PAL.fire1 : '#5c2014');
    outlineRect(ctx, 60, 8, 5, 5);
  }

  function drawAfld(ctx, W, H, pal, f) { // 96x48 — runway + chase lights + tower
    baseSlab(ctx, W, H, '#5a5a53', '#6b6b62', '#484841');
    // runway strip
    P(ctx, 2, 20, 92, 22, '#3e3e39');
    outlineRect(ctx, 1, 19, 94, 24);
    P(ctx, 3, 21, 90, 1, '#565650');
    for (let i = 0; i < 5; i++) { P(ctx, 5, 22 + i * 4, 4, 2, '#c9c9c0'); P(ctx, 87, 22 + i * 4, 4, 2, '#c9c9c0'); }
    for (let x = 14; x < 84; x += 10) P(ctx, x, 30, 6, 2, '#b9b9b0');
    // landing lights (chase anim)
    for (let i = 0; i < 6; i++) {
      const on = (i + f) % 2 === 0;
      P(ctx, 26 + i * 11, 16, 2, 2, on ? PAL.uiGold : '#4a3a14');
      P(ctx, 26 + i * 11, 44, 2, 2, on ? '#4a3a14' : PAL.uiGold);
    }
    // control tower (top-left)
    panel(ctx, 4, 2, 18, 15, pal.base, pal.light, pal.dark);
    P(ctx, 6, 5, 14, 4, GLASS);
    P(ctx, 6, 5, 14, 1, GLASS_L);
    P(ctx, 8, 0, 1, 3, '#2a2a26');
    P(ctx, 18, 3, 2, 2, f ? pal.trim2 : '#401410');
    // hangar (top-right)
    panel(ctx, 64, 2, 28, 15, pal.base, pal.light, pal.dark);
    P(ctx, 66, 4, 24, 2, pal.trim);
    P(ctx, 68, 8, 20, 7, '#77776f');
    for (let y = 9; y < 15; y += 2) P(ctx, 69, y, 18, 1, '#54544e');
    outlineRect(ctx, 67, 7, 22, 9);
    // windsock
    P(ctx, 46, 4, 1, 12, '#3a3a34');
    if (f) { P(ctx, 47, 5, 6, 3, '#e07820'); P(ctx, 51, 6, 3, 1, '#f8f0e0'); }
    else { P(ctx, 47, 6, 5, 3, '#e07820'); P(ctx, 50, 7, 2, 1, '#f8f0e0'); }
  }

  function drawDish(ctx, cx, cy, f) { // radar dish, 4 rotation states (N,E,S,W)
    const L = '#dcdcd6', M = '#a8a8a2', D = '#63635e';
    if (f === 0) {           // north — convex back of dish
      ellipseFill(ctx, cx, cy, 8, 4, OUT);
      ellipseFill(ctx, cx, cy, 7, 3, M);
      ellipseFill(ctx, cx - 2, cy - 1, 3, 1, L);
      P(ctx, cx, cy - 6, 1, 2, D);
    } else if (f === 2) {    // south — open bowl toward viewer
      ellipseFill(ctx, cx, cy, 8, 4, OUT);
      ellipseFill(ctx, cx, cy, 7, 3, L);
      ellipseFill(ctx, cx, cy, 5, 2, M);
      ellipseFill(ctx, cx, cy, 2, 1, D);
      P(ctx, cx, cy + 3, 1, 3, D);
      P(ctx, cx, cy + 5, 1, 1, '#f4f4ee');
    } else {                 // east (1) / west (3) — edge on
      const s = f === 1 ? 1 : -1;
      ellipseFill(ctx, cx, cy, 3, 6, OUT);
      ellipseFill(ctx, cx, cy, 2, 5, M);
      ellipseFill(ctx, cx + s, cy, 1, 4, L);
      P(ctx, cx + s * 3, cy - 1, 2, 2, D);
    }
  }

  function drawHq(ctx, W, H, pal, f) { // 48x48 — bunker + rotating dish (f 0..3)
    baseSlab(ctx, W, H);
    panel(ctx, 4, 18, 40, 26, pal.base, pal.light, pal.dark);
    P(ctx, 6, 21, 36, 2, pal.trim);
    P(ctx, 28, 25, 10, 4, GLASS);
    P(ctx, 28, 25, 10, 1, GLASS_L);
    P(ctx, 10, 34, 8, 10, DOOR);
    outlineRect(ctx, 9, 33, 10, 11);
    // antenna
    P(ctx, 40, 8, 1, 10, '#262622');
    P(ctx, 38, 10, 5, 1, '#262622');
    P(ctx, 39, 6, 3, 2, (f % 2) ? PAL.nodRedLight : '#5c2014');
    // dish pedestal + dish (4 rotation frames)
    P(ctx, 13, 12, 8, 7, pal.dark);
    outlineRect(ctx, 12, 11, 10, 9);
    drawDish(ctx, 17, 8, f);
  }

  function drawEye(ctx, W, H, pal, f) { // 48x48 — geodesic dome ball on bunker
    baseSlab(ctx, W, H);
    ball(ctx, 18, 15, 12, '#dededa', '#f4f4f0', '#a2a29c');
    // facet lines
    ctx.fillStyle = 'rgba(88,88,84,0.5)';
    ctx.fillRect(8, 11, 21, 1); ctx.fillRect(6, 15, 25, 1); ctx.fillRect(8, 19, 21, 1);
    for (let x = 9; x < 28; x += 4) { ctx.fillRect(x, 13, 1, 1); ctx.fillRect(x + 2, 17, 1, 1); ctx.fillRect(x, 21, 1, 1); }
    // bunker
    panel(ctx, 4, 26, 40, 18, pal.base, pal.light, pal.dark);
    P(ctx, 6, 29, 36, 2, pal.trim);
    P(ctx, 33, 34, 7, 10, DOOR);
    outlineRect(ctx, 32, 33, 9, 11);
    // antenna + ion uplink blink
    P(ctx, 41, 12, 1, 14, '#2a2a26');
    P(ctx, 40, 10, 3, 2, f ? PAL.ion : '#28506c');
  }

  function tstep(ctx, x, y, w, h, pal) { // one pyramid step, red-trimmed
    P(ctx, x, y, w, h, pal.blackB);
    P(ctx, x, y, w, 3, pal.blackC);
    P(ctx, x, y, 2, h, pal.blackC);
    P(ctx, x + w - 3, y, 3, h, pal.blackA);
    P(ctx, x, y + h - 2, w, 2, pal.blackA);
    outlineRect(ctx, x, y, w, h);
    P(ctx, x + 2, y + 3, w - 4, 1, pal.trim);
  }
  function pylon(ctx, x, y, pal) {
    P(ctx, x, y, 3, 10, pal.blackB);
    P(ctx, x, y, 1, 10, pal.blackC);
    outlineRect(ctx, x - 1, y - 1, 5, 12);
    P(ctx, x, y - 1, 3, 1, pal.trim2);
  }

  function drawTmpl(ctx, W, H, pal, f) { // 72x72 — black step pyramid
    baseSlab(ctx, W, H, '#68685f', '#79796f', '#525249');
    tstep(ctx, 6, 44, 60, 24, pal);
    tstep(ctx, 15, 26, 42, 20, pal);
    tstep(ctx, 23, 12, 26, 16, pal);
    tstep(ctx, 30, 5, 12, 9, pal);
    // glowing top slit
    P(ctx, 32, 8, 8, 2, f ? '#ff7050' : PAL.nodRed);
    P(ctx, 33, 7, 6, 1, f ? '#ffc0a0' : '#e04028');
    ctx.fillStyle = f ? 'rgba(255,96,56,0.28)' : 'rgba(255,96,56,0.16)';
    ctx.fillRect(30, 5, 12, 7);
    // entrance
    P(ctx, 32, 58, 8, 10, '#0d0d10');
    outlineRect(ctx, 31, 57, 10, 11);
    P(ctx, 31, 57, 10, 1, pal.trim);
    // corner pylons
    pylon(ctx, 10, 48, pal);
    pylon(ctx, 59, 48, pal);
  }

  function drawHpad(ctx, W, H, pal, f) { // 48x48 — pad with white H
    baseSlab(ctx, W, H, '#62625a', '#73736a', '#50504a');
    P(ctx, 4, 4, 40, 40, '#42423d');
    outlineRect(ctx, 3, 3, 42, 42);
    outlineRect(ctx, 7, 7, 34, 34, '#8a8a80');
    // white H
    P(ctx, 17, 14, 4, 20, '#e8e8e0');
    P(ctx, 27, 14, 4, 20, '#e8e8e0');
    P(ctx, 21, 22, 6, 4, '#e8e8e0');
    P(ctx, 17, 33, 4, 1, '#b0b0a8'); P(ctx, 27, 33, 4, 1, '#b0b0a8');
    // corner lights (blink alternating diagonals)
    const on = PAL.uiGold, off = '#4a3a14';
    P(ctx, 5, 5, 3, 3, f ? on : off); P(ctx, 40, 5, 3, 3, f ? off : on);
    P(ctx, 5, 40, 3, 3, f ? off : on); P(ctx, 40, 40, 3, 3, f ? on : off);
    // fuel console strip
    P(ctx, 36, 8, 6, 5, pal.base);
    outlineRect(ctx, 35, 7, 8, 7);
    P(ctx, 37, 9, 2, 2, pal.trim);
  }

  function drawFix(ctx, W, H, pal, f) { // 72x72 — ring platform + service arms
    baseSlab(ctx, W, H);
    const cx = 36, cy = 36;
    circleFill(ctx, cx, cy, 32, OUT);
    circleFill(ctx, cx, cy, 31, '#8f8f86');
    circleFill(ctx, cx, cy, 29, '#9b9b92');
    circleFill(ctx, cx, cy, 24, OUT);
    circleFill(ctx, cx, cy, 23, '#4e4e48');
    // hazard marks around ring
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2;
      P(ctx, Math.round(cx + Math.cos(a) * 27) - 1, Math.round(cy + Math.sin(a) * 27) - 1,
        2, 2, i % 2 ? PAL.uiGold : '#33332e');
    }
    // center pad
    circleFill(ctx, cx, cy, 10, OUT);
    circleFill(ctx, cx, cy, 9, '#8f8f86');
    circleFill(ctx, cx - 2, cy - 2, 5, '#a5a59c');
    circleFill(ctx, cx, cy, 4, '#6e6e66');
    // two service arms (west + east)
    P(ctx, 5, 33, 22, 6, pal.base);
    P(ctx, 5, 33, 22, 1, pal.light);
    P(ctx, 5, 38, 22, 1, pal.dark);
    outlineRect(ctx, 4, 32, 24, 8);
    P(ctx, 45, 33, 22, 6, pal.base);
    P(ctx, 45, 33, 22, 1, pal.light);
    P(ctx, 45, 38, 22, 1, pal.dark);
    outlineRect(ctx, 44, 32, 24, 8);
    // arm tip work lights (alternate)
    P(ctx, 25, 35, 2, 2, f ? PAL.uiGreen : '#1e4a22');
    P(ctx, 45, 35, 2, 2, f ? '#1e4a22' : PAL.uiGreen);
    // control hut
    panel(ctx, 56, 2, 14, 12, pal.base, pal.light, pal.dark);
    P(ctx, 58, 5, 10, 3, GLASS);
    P(ctx, 58, 5, 10, 1, GLASS_L);
  }

  function drawGtwr(ctx, W, H, pal, f) { // 24x24 — sandbag ring + MG nest
    baseSlab(ctx, W, H);
    const SB = '#b3a06a', SBD = '#7e6f45', SBL = '#cbbc85';
    circleFill(ctx, 12, 12, 11, OUT);
    circleFill(ctx, 12, 12, 10, SB);
    circleFill(ctx, 12, 12, 6, '#4e4e46');
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2;
      P(ctx, Math.round(12 + Math.cos(a) * 8), Math.round(12 + Math.sin(a) * 8), 1, 2, SBD);
    }
    for (let a = 3.4; a < 5.4; a += 0.35)
      P(ctx, Math.round(12 + Math.cos(a) * 8), Math.round(12 + Math.sin(a) * 8), 2, 1, SBL);
    // MG nest + barrel (recoil shift anim)
    P(ctx, 9, 9, 6, 6, '#5c5c54');
    outlineRect(ctx, 9, 9, 6, 6);
    P(ctx, 11, 2 + f, 2, 8, '#26262a');
    P(ctx, 11, 2 + f, 1, 8, '#4a4a44');
    P(ctx, 14, 8, 2, 2, pal.trim);
  }

  function missileBox(ctx, x, y, pal) {
    P(ctx, x, y, 7, 9, pal.base);
    P(ctx, x, y, 7, 1, pal.light);
    P(ctx, x, y + 8, 7, 1, pal.dark);
    outlineRect(ctx, x - 1, y - 1, 9, 11);
    P(ctx, x + 1, y + 2, 2, 2, '#e8e8e0'); P(ctx, x + 4, y + 2, 2, 2, '#e8e8e0');
    P(ctx, x + 1, y + 5, 2, 2, '#e8e8e0'); P(ctx, x + 4, y + 5, 2, 2, '#e8e8e0');
    P(ctx, x + 1, y + 2, 2, 1, PAL.nodRed); P(ctx, x + 4, y + 2, 2, 1, PAL.nodRed);
    P(ctx, x + 1, y + 5, 2, 1, PAL.nodRed); P(ctx, x + 4, y + 5, 2, 1, PAL.nodRed);
  }

  function drawAtwr(ctx, W, H, pal, f) { // 24x48 — tall tower, twin missile boxes
    baseSlab(ctx, W, H);
    P(ctx, 3, 40, 18, 5, CONC_D);
    outlineRect(ctx, 2, 39, 20, 7);
    // shaft
    P(ctx, 7, 16, 10, 24, CONC);
    P(ctx, 7, 16, 2, 24, CONC_L);
    P(ctx, 15, 16, 2, 24, CONC_D);
    outlineRect(ctx, 6, 15, 12, 26);
    P(ctx, 8, 34, 8, 2, pal.trim);
    P(ctx, 9, 22, 6, 4, GLASS);
    // top platform
    P(ctx, 3, 10, 18, 5, CONC);
    P(ctx, 3, 10, 18, 1, CONC_L);
    outlineRect(ctx, 2, 9, 20, 7);
    // twin missile boxes
    missileBox(ctx, 4, 2, pal);
    missileBox(ctx, 14, 2, pal);
    // beacon
    P(ctx, 11, 0, 2, 2, f ? pal.trim2 : '#4a1810');
  }

  function drawGun(ctx, W, H, pal, f) { // 24x24 — low round base only
    baseSlab(ctx, W, H);
    circleFill(ctx, 12, 12, 11, OUT);
    circleFill(ctx, 12, 12, 10, pal.dark);
    circleFill(ctx, 12, 12, 8, pal.base);
    circleFill(ctx, 10, 10, 4, pal.light);
    circleFill(ctx, 12, 12, 4, pal.shadow);
    circleFill(ctx, 12, 12, 3, '#2a2a26');
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
    P(ctx, 9, 13, 6, 5, pal.dark);
    outlineRect(ctx, 8, 12, 8, 7);
    // barrel (north)
    P(ctx, 10, 2, 4, 2, '#22222a');
    P(ctx, 11, 2, 2, 10, '#33333a');
    P(ctx, 11, 2, 1, 10, '#5a5a64');
    // hub
    circleFill(ctx, 12, 12, 5, OUT);
    circleFill(ctx, 12, 12, 4, pal.base);
    circleFill(ctx, 11, 11, 2, pal.light);
    P(ctx, 12, 12, 1, 1, pal.shadow);
    return rotFrames(c, 16);
  }

  function drawObli(ctx, W, H, pal, f, glow) { // 24x48 — black spike; glow 0..3
    baseSlab(ctx, W, H);
    P(ctx, 4, 40, 16, 5, '#2c2c33');
    P(ctx, 4, 40, 16, 1, '#3d3d48');
    outlineRect(ctx, 3, 39, 18, 7);
    // tapered spike
    for (let y = 5; y < 41; y++) {
      const t = (y - 5) / 36;
      const hw = Math.max(1, Math.round(1 + t * 5));
      P(ctx, 12 - hw - 1, y, 1, 1, OUT);
      P(ctx, 12 + hw, y, 1, 1, OUT);
      P(ctx, 12 - hw, y, hw * 2, 1, '#22222a');
      P(ctx, 12 - hw, y, 1, 1, '#3d3d48');
      P(ctx, 12 + hw - 1, y, 1, 1, '#15151a');
    }
    P(ctx, 11, 4, 2, 1, OUT);
    P(ctx, 11, 9, 1, 30, pal.trim); // front groove
    if (glow > 0) {
      const tip = ['#a02818', '#e04028', '#ff7050'][glow - 1];
      const core = ['#ff8060', '#ffc0a0', '#ffffff'][glow - 1];
      P(ctx, 10, 3, 4, 3 + glow, tip);
      P(ctx, 11, 4, 2, 2 + glow, core);
      P(ctx, 11, 9, 1, 30, glow >= 2 ? '#ff6a50' : '#d04030');
      ctx.fillStyle = 'rgba(255,80,44,' + (0.12 * glow).toFixed(2) + ')';
      ctx.fillRect(6, 0, 12, 12 + glow * 3);
    } else {
      P(ctx, 11, 5, 2, 2, f ? '#8a2418' : '#5c1810');
    }
  }

  function drawSam(ctx, W, H, pal, f, open) { // 48x24 — domed launcher; open 0..3
    baseSlab(ctx, W, H);
    P(ctx, 4, 6, 40, 16, pal.dark);
    P(ctx, 5, 7, 38, 1, pal.base);
    outlineRect(ctx, 3, 5, 42, 18);
    P(ctx, 5, 8, 2, 2, PAL.uiGold);
    P(ctx, 41, 8, 2, 2, PAL.uiGold);
    if (!open) {
      dome(ctx, 24, 21, 10, pal.base, pal.light, pal.shadow);
      P(ctx, 24, 12, 1, 9, pal.dark);           // center seam
      P(ctx, 19, 14, 2, 1, pal.dark);
      P(ctx, 28, 14, 2, 1, pal.dark);
      P(ctx, 7, 16, 2, 2, f ? pal.trim2 : '#3a1410');
    } else {
      const gap = [0, 2, 5, 8][open];
      // pit interior
      P(ctx, 24 - gap - 1, 11, (gap + 1) * 2, 11, '#191914');
      if (open >= 2) {
        P(ctx, 21, 12, 2, 9, '#e2e2da'); P(ctx, 26, 12, 2, 9, '#e2e2da');
        P(ctx, 21, 12, 2, 2, PAL.nodRedLight); P(ctx, 26, 12, 2, 2, PAL.nodRedLight);
      }
      if (open >= 3) {
        P(ctx, 23, 10, 3, 11, '#f0f0e8');
        P(ctx, 23, 10, 3, 2, PAL.nodRedLight);
      }
      // dome halves slid apart
      for (let dy = 0; dy <= 9; dy++) {
        const hw = Math.floor(Math.sqrt(81 - dy * dy) + 0.5);
        if (hw < 2) continue;
        const y = 21 - dy;
        P(ctx, 24 - hw - gap, y, hw - 1, 1, pal.base);
        P(ctx, 24 - hw - gap, y, 2, 1, pal.light);
        P(ctx, 24 + gap + 1, y, hw - 1, 1, pal.base);
        P(ctx, 24 + gap + hw - 2, y, 2, 1, pal.shadow);
      }
      P(ctx, 7, 16, 2, 2, pal.trim2);
    }
  }

  // ---- builders table / frame counts -----------------------------------------

  const BUILDERS = {
    fact: drawFact,
    nuke: (ctx, W, H, p, f) => drawNukePlant(ctx, W, H, p, f, false),
    nuk2: (ctx, W, H, p, f) => drawNukePlant(ctx, W, H, p, f, true),
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
    obli: (ctx, W, H, p, f) => drawObli(ctx, W, H, p, f, 0),
    sam: (ctx, W, H, p, f) => drawSam(ctx, W, H, p, f, 0),
  };

  const FRAME_COUNT = { hq: 4 }; // dish rotation; everything else 2

  // ---- damage overlay (deterministic per key+side, identical on all frames) --

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

  // ---- frame factories --------------------------------------------------------

  function renderBuildingFrame(key, side, f, damaged) {
    const d = DATA.buildings[key];
    const W = d.w * C.CELL, H = d.h * C.CELL;
    const c = mkCanvas(W, H + 8);
    const ctx = c.getContext('2d');
    drawBib(ctx, W, H);
    BUILDERS[key](ctx, W, H, sidePal(side), f, side);
    if (damaged) damageOverlay(ctx, W, H, key + ':' + side);
    return c;
  }

  function renderObliCharge(side, glow) {
    const d = DATA.buildings.obli;
    const W = d.w * C.CELL, H = d.h * C.CELL;
    const c = mkCanvas(W, H + 8);
    const ctx = c.getContext('2d');
    drawBib(ctx, W, H);
    drawObli(ctx, W, H, sidePal(side), 0, glow);
    return c;
  }

  function renderSamOpen(side, stage) {
    const d = DATA.buildings.sam;
    const W = d.w * C.CELL, H = d.h * C.CELL;
    const c = mkCanvas(W, H + 8);
    const ctx = c.getContext('2d');
    drawBib(ctx, W, H);
    drawSam(ctx, W, H, sidePal(side), 0, stage);
    return c;
  }

  // ---- cameos -------------------------------------------------------------------

  function cameoCanvas() {
    const c = mkCanvas(C.CAMEO_W, C.CAMEO_H);
    const ctx = c.getContext('2d');
    P(ctx, 0, 0, 64, 48, PAL.cameoBg);
    ctx.fillStyle = '#2b2b25';
    for (let y = 2; y < 38; y += 4)
      for (let x = (y % 8 === 2) ? 2 : 4; x < 62; x += 4) ctx.fillRect(x, y, 1, 1);
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
    const c = cameoCanvas();
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    let s = Math.min(56 / spr.width, 32 / spr.height, 1.6);
    const dw = Math.max(1, Math.round(spr.width * s));
    const dh = Math.max(1, Math.round(spr.height * s));
    ctx.drawImage(spr, Math.round((64 - dw) / 2), Math.round((37 - dh) / 2) + 1, dw, dh);
    finishCameo(ctx, d.name);
    return c;
  }

  function ionCameo() {
    const c = cameoCanvas();
    const ctx = c.getContext('2d');
    // stars
    const stars = [[6, 5], [16, 10], [54, 6], [46, 14], [59, 22], [10, 20], [50, 30]];
    for (let i = 0; i < stars.length; i++)
      P(ctx, stars[i][0], stars[i][1], 1, 1, i % 2 ? '#8890a0' : '#c8d0dc');
    // beam from the sky
    P(ctx, 38, 1, 10, 32, 'rgba(168,216,248,0.35)');
    P(ctx, 40, 1, 6, 32, PAL.ion);
    P(ctx, 42, 1, 2, 32, '#e8f6ff');
    // impact glow
    ellipseFill(ctx, 43, 33, 8, 2, 'rgba(168,216,248,0.55)');
    ellipseFill(ctx, 43, 33, 4, 1, '#e8f6ff');
    // gold satellite dish aiming up
    P(ctx, 7, 25, 15, 2, PAL.uiGold);
    P(ctx, 7, 25, 15, 1, '#f0d878');
    P(ctx, 9, 27, 11, 2, '#b08820');
    P(ctx, 11, 29, 7, 2, '#907020');
    P(ctx, 14, 20, 1, 5, '#f0d878');   // feed arm
    P(ctx, 13, 19, 3, 2, '#f8ecb0');
    P(ctx, 13, 31, 3, 5, '#6a6a60');   // pedestal
    P(ctx, 10, 35, 9, 2, '#55554e');
    finishCameo(ctx, 'Ion Cannon');
    return c;
  }

  function nukeCameo() {
    const c = cameoCanvas();
    const ctx = c.getContext('2d');
    P(ctx, 1, 1, 62, 7, '#33201a'); // ominous sky tint
    // missile body
    P(ctx, 28, 7, 8, 20, '#b8b8c0');
    P(ctx, 28, 7, 2, 20, '#e0e0e6');
    P(ctx, 34, 7, 2, 20, '#74747c');
    outlineRect(ctx, 27, 6, 10, 22, '#15151a');
    // red nose cone
    P(ctx, 31, 1, 2, 2, PAL.nodRedLight);
    P(ctx, 30, 3, 4, 2, PAL.nodRedLight);
    P(ctx, 29, 5, 6, 2, PAL.nodRed);
    // band + emblem
    P(ctx, 28, 14, 8, 2, PAL.nodRed);
    // fins
    P(ctx, 24, 23, 4, 6, '#8a8a94'); P(ctx, 24, 23, 4, 1, '#b8b8c2');
    P(ctx, 36, 23, 4, 6, '#5e5e68');
    P(ctx, 23, 27, 2, 2, '#15151a'); P(ctx, 39, 27, 2, 2, '#15151a');
    // exhaust flame
    P(ctx, 29, 28, 6, 2, PAL.fire1);
    P(ctx, 30, 30, 4, 3, PAL.fire2);
    P(ctx, 31, 33, 2, 3, PAL.fire3);
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
