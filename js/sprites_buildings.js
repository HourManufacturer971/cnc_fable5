'use strict';
// sprites_buildings.js — procedurally drawn building sprites + cameos.
// Fills, for every key in DATA.buildings and BOTH sides:
//   SPRITES.buildings[key][side] = { normal:[frames], damaged:[frames], yOff? }
//   (+ gun turret rotation frames, obelisk charge frames, SAM open frames)
// and SPRITES.cameo[key] for every building, plus SPRITES.cameo.ionStrike and
// SPRITES.cameo.nukeStrike superweapon cameos. Defines no globals (IIFE).
//
// PERSPECTIVE: classic mid-90s RTS tilted top-down (camera ~60deg from the
// south). Every structure shows a foreshortened ROOF (bright, NW key light)
// above a SOUTH FACADE wall (mid-shade, doors/windows/vents), with a 1px
// bright parapet where they meet, a darkest line at the facade base, and a
// soft cast shadow falling SE. Tall structures rise ABOVE their footprint by
// yOff pixels; render anchors the canvas yOff px above the footprint top.
//
// Canvas size per building: w*24 x (yOff + h*24 + 8). The bottom 8 rows are
// the concrete bib apron (defenses skip it and sit on round pads instead).

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
  const WIN_LIT = '#ffd870', WIN_LIT_HI = '#fff4c0';
  const DOOR = '#33332e', DOOR_D = '#22221e';
  const OLV = '#5c6634', OLV_L = '#79844a', OLV_D = '#3f4722', OLV_D2 = '#2c3218';
  const ASPH = '#3a3a34', ASPH_L = '#51514a', ASPH_D = '#2a2a26';
  const HAZK = '#16160f';                 // hazard-stripe dark
  const SH = 'rgba(10,10,6,0.35)';        // cast shadow
  const WHT = '#e8e8e0', WHT_D = '#b0b0a8';

  function sidePal(side) {
    return side === 'udc'
      ? { base: PAL.udc, light: PAL.udcLight, dark: PAL.udcDark, shadow: PAL.udcShadow,
          trim: PAL.uiGold, trim2: '#f4dc80', haz: '#e0b840',
          blackA: '#2b2822', blackB: '#38342c', blackC: '#474033' }
      : { base: PAL.srp, light: PAL.srpLight, dark: PAL.srpDark, shadow: PAL.srpShadow,
          trim: PAL.srpRed, trim2: PAL.srpRedLight, haz: '#c8321e',
          blackA: '#25252d', blackB: '#32323c', blackC: '#41414d' };
  }

  // faction material set for the 3/4 box helpers: bright roof, mid facade
  function mats(pal) {
    return { roof: pal.base, roofL: pal.light, roofD: pal.dark, para: pal.light,
             face: pal.dark, faceL: pal.base, faceD: pal.shadow };
  }
  const CMAT = { roof: CONC, roofL: CONC_L, roofD: CONC_D, para: CONC_L,
                 face: CONC_D, faceL: CONC, faceD: CONC_D2 };

  // ---- tiny drawing helpers -------------------------------------------------

  function P(ctx, x, y, w, h, col) { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); }

  function outlineRect(ctx, x, y, w, h, col) {
    col = col || OUT;
    P(ctx, x, y, w, 1, col); P(ctx, x, y + h - 1, w, 1, col);
    P(ctx, x, y, 1, h, col); P(ctx, x + w - 1, y, 1, h, col);
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

  // ---- 3/4 perspective toolkit ----------------------------------------------

  // cast shadow for a box at x..x+w, y..y+h: east strip + SE spill (L-shape)
  function castE(ctx, x, y, w, h, d) {
    d = d || 3;
    ctx.fillStyle = SH;
    ctx.fillRect(x + w, y + d, d, h);
    ctx.fillRect(x + d, y + h, w - d, d);
  }

  // south facade wall: rows y..y+fh; mid-shade, darker at the bottom, darkest
  // 1px base line, east end darkest. Wide walls get panel seams and a grime
  // line under the parapet so big faces don't read as flat slabs.
  function facade(ctx, x, y, w, fh, m) {
    P(ctx, x, y, w, fh, m.face);
    P(ctx, x + w - 2, y, 2, fh, m.faceD);
    P(ctx, x, y + fh - 3, w, 2, m.faceD);
    P(ctx, x, y + fh - 1, w, 1, OUT);
    if (fh >= 8 && w >= 16) {
      ctx.fillStyle = 'rgba(0,0,0,0.14)';
      for (let sx = x + 8; sx < x + w - 4; sx += 9) ctx.fillRect(sx, y + 1, 1, fh - 3);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(x, y + 1, w, 1);
      // faint drip stains from the parapet
      ctx.fillStyle = 'rgba(0,0,0,0.10)';
      ctx.fillRect(x + 3, y + 1, 1, 3);
      ctx.fillRect(x + w - 6, y + 1, 1, 4);
    }
    // wide walls carry a cable conduit along the base with pin brackets,
    // ending in a small junction box with a status LED
    if (fh >= 10 && w >= 22) {
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(x + 2, y + fh - 5, w - 8, 1);
      for (let sx = x + 4; sx < x + w - 8; sx += 6) ctx.fillRect(sx, y + fh - 4, 1, 1);
      const jx = x + w - 7 - ((w * 7) % 4);
      P(ctx, jx - 1, y + fh - 8, 5, 5, OUT);
      P(ctx, jx, y + fh - 7, 3, 3, '#5a5a52');
      P(ctx, jx, y + fh - 7, 3, 1, '#7a7a70');
      P(ctx, jx + 1, y + fh - 6, 1, 1, '#d8b040');
    }
  }

  // full 3/4 box: bright roof rows y..y+rh, facade y+rh..y+rh+fh, parapet
  // line at the junction, outline, SE cast shadow
  function box3(ctx, x, y, w, rh, fh, m) {
    castE(ctx, x, y, w, rh + fh);
    outlineRect(ctx, x - 1, y - 1, w + 2, rh + fh + 2);
    P(ctx, x, y, w, rh, m.roof);
    P(ctx, x, y, w, 1, m.roofL);
    P(ctx, x, y, 1, rh, m.roofL);
    P(ctx, x + w - 2, y + 1, 2, rh - 1, m.roofD);
    P(ctx, x, y + rh - 1, w, 1, m.para);
    // roomy roofs get panel seams and corner rivets (builders draw over them)
    if (rh >= 10 && w >= 14) {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      for (let sx = x + 7; sx < x + w - 3; sx += 8) ctx.fillRect(sx, y + 2, 1, rh - 4);
      for (let sy = y + 6; sy < y + rh - 3; sy += 7) ctx.fillRect(x + 2, sy, w - 4, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(x + 2, y + 2, 1, 1); ctx.fillRect(x + w - 4, y + 2, 1, 1);
      ctx.fillRect(x + 2, y + rh - 3, 1, 1); ctx.fillRect(x + w - 4, y + rh - 3, 1, 1);
    }
    // big roofs also get furniture: an access hatch and a vent grille row
    // (position keyed to the box size so it varies between buildings)
    if (rh >= 14 && w >= 24) {
      const hx = x + 3 + ((w * 13 + rh * 7) % Math.max(1, w - 12));
      const hy = y + 3 + ((w * 5 + rh * 11) % Math.max(1, rh - 10));
      P(ctx, hx - 1, hy - 1, 7, 6, OUT);
      P(ctx, hx, hy, 5, 4, m.roofL);
      P(ctx, hx, hy + 3, 5, 1, m.roofD);
      P(ctx, hx + 1, hy + 1, 1, 1, m.roofD);
      const vx = x + 3 + ((w * 3 + rh * 17) % Math.max(1, w - 14));
      const vy = hy > y + rh / 2 ? y + 3 : y + rh - 6;
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      for (let k = 0; k < 3; k++) ctx.fillRect(vx + k * 3, vy, 2, 3);
      // an AC unit with a spinner grille, tucked to whichever side the
      // hatch left free, plus hazard ticks on the parapet corners
      const ax = hx > x + w / 2 ? x + 4 : x + w - 12;
      const ay = y + rh - 8;
      P(ctx, ax - 1, ay - 1, 9, 8, OUT);
      P(ctx, ax, ay, 7, 6, m.roofD);
      P(ctx, ax, ay, 7, 1, m.roofL);
      circleFill(ctx, ax + 3, ay + 3, 2, '#2c2c26');
      P(ctx, ax + 3, ay + 2, 1, 3, '#8a8a80');
      P(ctx, ax + 2, ay + 3, 3, 1, '#8a8a80');
      ctx.fillStyle = '#b09a34';
      ctx.fillRect(x + 1, y + rh - 2, 3, 1); ctx.fillRect(x + w - 4, y + rh - 2, 3, 1);
    }
    facade(ctx, x, y + rh, w, fh, m);
  }

  // small rooftop structure with its own south face + shadow so it pops up
  function roofBox(ctx, x, y, w, rh, fh, m) {
    ctx.fillStyle = SH;
    ctx.fillRect(x + w, y + 1, 2, rh + fh);
    ctx.fillRect(x + 1, y + rh + fh, w + 1, 2);
    outlineRect(ctx, x - 1, y - 1, w + 2, rh + fh + 2);
    P(ctx, x, y, w, rh, m.roof);
    P(ctx, x, y, w, 1, m.roofL);
    P(ctx, x, y + rh - 1, w, 1, m.para);
    P(ctx, x, y + rh, w, fh, m.face);
    P(ctx, x, y + rh + fh - 1, w, 1, m.faceD);
  }

  // roll-up door on a facade
  function rollDoor(ctx, x, y, w, h) {
    P(ctx, x - 1, y - 1, w + 2, h + 2, OUT);
    P(ctx, x, y, w, h, '#87877f');
    P(ctx, x, y, w, 1, '#b5b5ac');
    for (let yy = y + 2; yy < y + h - 1; yy += 2) P(ctx, x, yy, w, 1, '#5f5f58');
    P(ctx, x + w - 2, y, 2, h, '#6b6b64');
  }

  // personnel door on a facade
  function pDoor(ctx, x, y, w, h) {
    P(ctx, x - 1, y - 1, w + 2, h + 1, OUT);
    P(ctx, x, y, w, h, DOOR);
    P(ctx, x, y, w, 1, '#4a4a42');
    P(ctx, x + 1, y + 2, w - 2, 1, DOOR_D);
  }

  // row of window slits on a facade, one lit warm
  function faceWin(ctx, x, y, n, gap, lit) {
    for (let i = 0; i < n; i++) {
      const wx = x + i * gap;
      P(ctx, wx - 1, y - 1, 4, 5, OUT);
      P(ctx, wx, y, 2, 3, i === lit ? WIN_LIT : GLASS);
      P(ctx, wx, y, 2, 1, i === lit ? WIN_LIT_HI : GLASS_L);
    }
  }

  // vertical cylinder: top ellipse center (cx, ty), radii rx/ry, wall height
  // bh. wc = wall colors [westLight, mid, dark, eastDark]; cc = cap colors
  // [top, topL, innerRimSE]. Curved south wall + bright cap + SE shadow.
  function cyl3(ctx, cx, ty, rx, ry, bh, wc, cc) {
    ctx.fillStyle = SH;
    ctx.fillRect(cx + rx + 2, ty + ry + 2, 2, bh);
    for (let dx = -rx; dx <= rx; dx++) {
      const e = Math.round(ry * Math.sqrt(Math.max(0, 1 - (dx * dx) / ((rx * rx) || 1))));
      const t = (dx + rx) / ((2 * rx) || 1);
      const col = t < 0.26 ? wc[0] : t < 0.58 ? wc[1] : t < 0.84 ? wc[2] : wc[3];
      P(ctx, cx + dx, ty + e, 1, bh, col);
      P(ctx, cx + dx, ty + e + bh, 1, 1, OUT);
    }
    P(ctx, cx - rx - 1, ty, 1, bh + 1, OUT);
    P(ctx, cx + rx + 1, ty, 1, bh + 1, OUT);
    // weld-band seams around tall drums
    if (bh >= 9) {
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fillRect(cx - rx, ty + ry + (bh >> 1), rx * 2 + 1, 1);
      if (bh >= 14) ctx.fillRect(cx - rx, ty + ry + 3, rx * 2 + 1, 1);
    }
    // maintenance ladder up the west shoulder of tall drums
    if (bh >= 10 && rx >= 6) {
      const lx = cx - rx + 2;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(lx, ty + ry + 1, 1, bh - 2);
      ctx.fillRect(lx + 2, ty + ry + 1, 1, bh - 2);
      for (let yy = ty + ry + 2; yy < ty + ry + bh - 2; yy += 3) ctx.fillRect(lx, yy, 3, 1);
    }
    ellipseFill(ctx, cx, ty, rx + 1, ry + 1, OUT);
    ellipseFill(ctx, cx, ty, rx, ry, cc[0]);
    ellipseFill(ctx, cx - 1, ty - 1, Math.max(1, rx - 2), Math.max(1, ry - 1), cc[1]);
    for (let dx = 0; dx <= rx; dx++) {
      const e = Math.round(ry * Math.sqrt(Math.max(0, 1 - dx * dx / ((rx * rx) || 1))));
      if (e > 0) P(ctx, cx + dx, ty + e - 1, 1, 1, cc[2]);
    }
  }

  // 3/4 dome: base center (cx, by), radius r. Bright crown, mid south face,
  // dark east rim, NW glint. m = {top, topL, face, dark}
  function dome3(ctx, cx, by, r, m) {
    const rh = Math.max(3, Math.round(r * 0.8));
    ellipseFill(ctx, cx + 2, by + 1, r, 2, SH); // ground shadow SE
    for (let dy = 0; dy <= rh + 1; dy++) {
      const hw = Math.floor((r + 1) * Math.sqrt(Math.max(0, 1 - (dy * dy) / ((rh + 1) * (rh + 1)))) + 0.5);
      P(ctx, cx - hw, by - dy, hw * 2 + 1, 1, OUT);
    }
    for (let dy = 0; dy <= rh; dy++) {
      const hw = Math.floor(r * Math.sqrt(Math.max(0, 1 - (dy * dy) / (rh * rh))) + 0.5);
      const y = by - dy;
      P(ctx, cx - hw, y, hw * 2 + 1, 1, dy < rh * 0.45 ? m.face : m.top);
      const dw = Math.max(1, Math.round(hw * 0.28));
      P(ctx, cx + hw - dw, y, dw, 1, m.dark);
    }
    ellipseFill(ctx, cx - Math.round(r * 0.3), by - Math.round(rh * 0.6),
                Math.max(2, Math.round(r * 0.32)), Math.max(1, Math.round(rh * 0.24)), m.topL);
    P(ctx, cx - r, by, r * 2 + 1, 1, OUT);
  }

  // quonset hut / hangar with N-S ridge: curved roof surface (west-lit) that
  // rolls down to the ground at the sides, and a south arch face with a
  // bright curved parapet edge. cols = {hi, mid, dk, dk2, face, faceD}
  function hut3(ctx, x, y, w, len, cols) {
    const half = (w - 1) / 2;
    const ah = Math.round(w * 0.42);
    ctx.fillStyle = SH;
    ctx.fillRect(x + w, y + 3, 2, len + ah - 3);
    ctx.fillRect(x + 3, y + len + ah + 1, w - 3, 2);
    for (let dx = 0; dx < w; dx++) {
      const t = Math.abs(dx - half) / half;
      const e = Math.round(ah * Math.sqrt(Math.max(0, 1 - t * t)));
      const st = dx / (w - 1);
      const col = st < 0.14 ? cols.mid : st < 0.4 ? cols.hi : st < 0.68 ? cols.mid : st < 0.88 ? cols.dk : cols.dk2;
      const rlen = len + (ah - e);
      P(ctx, x + dx, y, 1, rlen, col);              // roof (curves down at S)
      if (e > 0) {
        P(ctx, x + dx, y + rlen - 1, 1, 1, cols.hi); // curved parapet edge
        P(ctx, x + dx, y + rlen, 1, e, st > 0.8 ? cols.faceD : cols.face);
        P(ctx, x + dx, y + len + ah - 2, 1, 2, cols.faceD);
      }
      P(ctx, x + dx, y + len + ah, 1, 1, OUT);      // ground line
    }
    // corrugation ribs across the roof
    for (let yy = y + 2; yy < y + len - 1; yy += 3)
      P(ctx, x + 1, yy, w - 2, 1, 'rgba(16,20,10,0.28)');
    P(ctx, x - 1, y - 1, w + 2, 1, OUT);
    P(ctx, x - 1, y, 1, len + ah + 1, OUT);
    P(ctx, x + w, y, 1, len + ah + 1, OUT);
  }

  // quonset hut with E-W ridge: bright rounded roof strip, curved south wall
  // falling to the ground, dark east end, corrugation ribs. Reads as a long
  // half-cylinder under the NW light.
  function hutEW(ctx, x, y, w, rh, fh, hi) {
    const hh = rh + fh;
    castE(ctx, x, y, w, hh, 2);
    for (let dy = 0; dy < hh; dy++) {
      const t = dy / (hh - 1);
      const ins = dy === 0 ? 3 : dy === 1 ? 1 : dy >= hh - 2 ? 1 : 0;
      let col;
      if (dy < 2) col = hi;                  // lit ridge north
      else if (dy < rh) col = OLV_L;         // roof slope
      else if (dy === rh) col = hi;          // parapet curve
      else if (t < 0.72) col = OLV;          // upper wall
      else if (t < 0.9) col = OLV_D;         // lower wall
      else col = OLV_D2;
      P(ctx, x + ins, y + dy, w - ins * 2, 1, col);
    }
    // east end cap shading + west edge light
    P(ctx, x + w - 3, y + 2, 3, hh - 3, 'rgba(20,26,12,0.45)');
    P(ctx, x + 1, y + 2, 1, hh - 3, 'rgba(210,225,150,0.30)');
    // corrugation ribs
    for (let rx = x + 4; rx < x + w - 4; rx += 3)
      P(ctx, rx, y + 1, 1, hh - 2, 'rgba(18,22,10,0.22)');
    P(ctx, x, y + hh - 1, w, 1, OUT);
    outlineRect(ctx, x - 1, y - 1, w + 2, hh + 2);
  }

  // compact steam wisp above (cx, topY); p = 0..2, stays within ~6px above
  function steamUp(ctx, cx, topY, p) {
    const ph = [
      [[0, -2, 4, 0.9], [-3, -4, 3, 0.6], [3, -6, 2, 0.4]],
      [[-1, -3, 4, 0.8], [2, -5, 3, 0.55], [-3, -6, 2, 0.35]],
      [[1, -2, 3, 0.65], [-2, -5, 3, 0.45], [3, -4, 2, 0.3]],
    ][p];
    for (const [dx, dy, s, a] of ph) {
      ctx.fillStyle = 'rgba(240,244,240,' + a + ')';
      ctx.fillRect(cx + dx, topY + dy, s, s);
      ctx.fillStyle = 'rgba(255,255,255,' + (a * 0.7).toFixed(2) + ')';
      ctx.fillRect(cx + dx, topY + dy, s, 1);
    }
  }

  // ---- ground helpers ---------------------------------------------------------

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

  // round concrete pad for defensive structures — they sit on a small circular
  // emplacement instead of the square slab + bib regular buildings get
  function roundPad(ctx, cx, cy, r, rnd) {
    circleFill(ctx, cx + 1, cy + 1, r, 'rgba(0,0,0,0.28)'); // cast shadow
    circleFill(ctx, cx, cy, r, OUT);
    circleFill(ctx, cx, cy, r - 1, SLAB);
    circleFill(ctx, cx - 1, cy - 1, r - 2, SLAB_L);
    circleFill(ctx, cx, cy, r - 2, SLAB);
    // rim seam + speckle
    for (let i = 0; i < 10; i++) {
      const a = rnd() * Math.PI * 2, rr = rnd() * (r - 3);
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,250,0.06)';
      ctx.fillRect((cx + Math.cos(a) * rr) | 0, (cy + Math.sin(a) * rr) | 0, 1, 1);
    }
  }

  // wide elliptical pad (SAM site)
  function ovalPad(ctx, cx, cy, rx, ry, rnd) {
    ctx.fillStyle = OUT;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = SLAB;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx - 1, ry - 1, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = SLAB_L;
    ctx.beginPath(); ctx.ellipse(cx - 1, cy - 1, rx - 2, ry - 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = SLAB;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx - 2, ry - 2, 0, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,250,0.06)';
      ctx.fillRect((cx - rx + 3 + rnd() * (rx * 2 - 6)) | 0, (cy - ry + 2 + rnd() * (ry * 2 - 4)) | 0, 1, 1);
    }
  }

  // ---- building drawers -------------------------------------------------------
  // signature: (ctx, W, H, pal, f, side, rnd) with the origin at the FOOTPRINT
  // top-left. W/H = footprint px. Structures may draw up into negative y
  // (the yOff headroom) and down into the bib rows H..H+8.

  function drawFact(ctx, W, H, pal, f, side, rnd) { // 72x48 +6 — hall + crane
    baseSlab(ctx, W, H); slabNoise(ctx, W, H, rnd);
    const m = mats(pal);
    // --- open construction pit (ground level, west) ---
    P(ctx, 3, 10, 22, 34, '#45453f');
    P(ctx, 3, 10, 22, 1, '#2c2c27'); P(ctx, 3, 10, 1, 34, '#2c2c27');
    P(ctx, 24, 11, 1, 33, '#5f5f57'); P(ctx, 4, 43, 21, 1, '#5f5f57');
    outlineRect(ctx, 2, 9, 24, 36);
    for (let y = 18; y < 43; y += 8) P(ctx, 4, y, 20, 1, '#3a3a35');
    for (let x = 10; x < 24; x += 7) P(ctx, x, 11, 1, 32, '#3a3a35');
    hazardH(ctx, 3, 6, 22, pal.haz);
    // half-poured foundation + rebar stubs
    P(ctx, 7, 17, 14, 9, CONC_D);
    P(ctx, 7, 17, 14, 2, CONC);
    outlineRect(ctx, 6, 16, 16, 11);
    for (let x = 9; x < 20; x += 4) { P(ctx, x, 14, 1, 3, '#5a4a1e'); P(ctx, x, 14, 1, 1, '#8a7130'); }
    // girder pallet
    P(ctx, 8, 34, 13, 4, '#6a5a20'); P(ctx, 8, 34, 13, 1, '#8f7c30');
    outlineRect(ctx, 7, 33, 15, 6);
    // --- main hall (east): roof + south facade ---
    box3(ctx, 28, -4, 41, 32, 14, m);
    for (let y = 2; y < 26; y += 6) P(ctx, 30, y, 37, 1, pal.dark);
    P(ctx, 32, 4, 10, 5, GLASS); P(ctx, 32, 4, 10, 1, GLASS_L);
    P(ctx, 36, 5, 1, 4, '#101c26');
    outlineRect(ctx, 31, 3, 12, 7);
    roofBox(ctx, 56, 8, 8, 3, 3, m);              // roof vent housing
    P(ctx, 57, 9, 6, 1, pal.shadow);
    P(ctx, 47, 14, 4, 4, pal.dark); outlineRect(ctx, 46, 13, 6, 6); // hatch
    // facade: big roll-up door + hazard lintel + windows + lamp
    hazardH(ctx, 39, 29, 22, pal.haz);
    rollDoor(ctx, 41, 32, 18, 9);
    faceWin(ctx, 31, 31, 2, 5, f % 2);
    pDoor(ctx, 62, 34, 5, 7);
    P(ctx, 49, 30, 2, 1, (f % 2) ? PAL.uiGreen : '#1e4a22');
    // --- crane mast (west of the hall, standing at the pit rim) ---
    ctx.fillStyle = SH; ctx.fillRect(29, -3, 2, 19);
    P(ctx, 25, -6, 4, 22, '#caa22a');
    P(ctx, 25, -6, 1, 22, '#f0d060');
    P(ctx, 28, -6, 1, 22, '#8a6e18');
    for (let y = -3; y < 15; y += 4) P(ctx, 25, y, 4, 1, '#6e5814');
    outlineRect(ctx, 24, -7, 6, 24);
    // mast base plate on the pit rim
    P(ctx, 23, 15, 8, 3, CONC_D); P(ctx, 23, 15, 8, 1, CONC);
    outlineRect(ctx, 22, 14, 10, 5);
    // swinging boom + cable + hook (4 frames)
    const ends = [[7, -2], [11, 6], [15, 14], [11, 6]];
    const e = ends[f % 4];
    beam(ctx, e[0], e[1], 26, -5, '#e8c040', '#8a6e18');
    const cl = [11, 13, 16, 13][f % 4];
    P(ctx, e[0] + 1, e[1] + 2, 1, cl, '#151512');
    P(ctx, e[0] - 1, e[1] + 2 + cl, 5, 3, '#8a8a90');
    P(ctx, e[0] - 1, e[1] + 2 + cl, 5, 1, '#b8b8c0');
    outlineRect(ctx, e[0] - 2, e[1] + 1 + cl, 7, 5);
    if ((f % 4) === 2) { P(ctx, e[0] - 4, e[1] + 7 + cl, 11, 2, IRON_L); outlineRect(ctx, e[0] - 5, e[1] + 6 + cl, 13, 4); }
    // blinking warning light on mast top
    P(ctx, 26, -8, 2, 2, (f % 2) ? '#ff5030' : '#571b12');
    if (f % 2) { ctx.fillStyle = 'rgba(255,80,48,0.25)'; ctx.fillRect(24, -10, 6, 5); }
  }

  function drawNukePlant(ctx, W, H, pal, f, side, rnd, adv) { // 48x48 +10 — stacks
    baseSlab(ctx, W, H); slabNoise(ctx, W, H, rnd);
    const m = mats(pal);
    // cooling stacks (north, rising above the footprint) — cylinders
    const wc = ['#d0d0c4', '#a8a89e', '#83837b', '#66665f'];
    const cc = ['#b6b6ab', '#d4d4c8', '#7d7d74'];
    cyl3(ctx, 13, -3, 8, 3, 16, wc, cc);
    cyl3(ctx, 34, -3, 8, 3, 16, wc, cc);
    // stack mouths
    for (const cx of [13, 34]) {
      ellipseFill(ctx, cx, -3, 5, 2, '#33332e');
      ellipseFill(ctx, cx, -3, 3, 1, adv ? '#f0e060' : '#22221e');
      if (adv) P(ctx, cx - 1, -3, 2, 1, '#fff8c0');
      // trim ring on the wall
      P(ctx, cx - 8, 4, 17, 1, adv ? pal.trim : '#8a8a80');
    }
    if (adv) { // third small stack between
      cyl3(ctx, 24, 5, 4, 2, 8, wc, cc);
      ellipseFill(ctx, 24, 5, 2, 1, '#f0e060');
    }
    // steam wisps
    steamUp(ctx, 13, -6, f % 3);
    steamUp(ctx, 34, -6, (f + 1) % 3);
    if (adv) steamUp(ctx, 24, 2, (f + 2) % 3);
    // turbine hall (south): roof + facade
    box3(ctx, 3, 16, 42, 14, 13, m);
    for (let y = 19; y < 28; y += 4) P(ctx, 5, y, 38, 1, pal.dark);
    P(ctx, 22, 17, 1, 12, pal.shadow);
    roofBox(ctx, 36, 19, 6, 3, 2, m);            // roof machinery
    // feed pipes stacks -> hall roof
    for (const cx of [11, 32]) {
      P(ctx, cx, 12, 3, 5, STEEL); P(ctx, cx, 12, 1, 5, STEEL_L);
      P(ctx, cx + 3, 12, 1, 5, STEEL_D2);
    }
    // facade details: door + hazard, vent grilles, transformer, status light
    hazardH(ctx, 18, 31, 12, pal.haz);
    pDoor(ctx, 20, 34, 8, 8);
    for (const vx of [8, 34]) {
      P(ctx, vx - 1, 33, 8, 6, OUT);
      P(ctx, vx, 34, 6, 4, pal.shadow);
      P(ctx, vx, 34, 6, 1, '#2a2a24'); P(ctx, vx, 36, 6, 1, '#2a2a24');
    }
    P(ctx, 30, 33, 2, 2, (f % 3 === 0) ? PAL.uiGreen : '#1e4a22');
    P(ctx, 39, 34, 1, 2, adv ? '#f0e060' : pal.trim2);
    P(ctx, 41, 34, 1, 2, adv ? '#f0e060' : pal.trim2);
  }

  function drawProc(ctx, W, H, pal, f, side, rnd) { // 72x48 +6 — tank + dock
    baseSlab(ctx, W, H); slabNoise(ctx, W, H, rnd);
    const m = mats(pal);
    // --- chrysalite storage tank (west): big cylinder ---
    const wc = [pal.light, pal.base, pal.dark, pal.shadow];
    cyl3(ctx, 17, 1, 13, 5, 14, wc, [pal.base, pal.light, pal.shadow]);
    // cap: glass viewport into the chrysalite
    ellipseFill(ctx, 17, 1, 8, 3, pal.shadow);
    ellipseFill(ctx, 17, 1, 7, 2, '#0e2010');
    ellipseFill(ctx, 16, 1, 5, 2, PAL.tibDark);
    ellipseFill(ctx, 16, 0, 3, 1, PAL.tib1);
    P(ctx, 15, 0, 2, 1, PAL.tib2);
    if (f === 1 || f === 3) { P(ctx, 15, 0, 2, 1, PAL.tib3); ctx.fillStyle = 'rgba(72,216,88,0.16)'; ctx.fillRect(10, -3, 14, 8); }
    // hatch on the cap + green drip stains down the south wall
    P(ctx, 22, -3, 4, 2, pal.light); outlineRect(ctx, 21, -4, 6, 4);
    ctx.fillStyle = 'rgba(24,120,36,0.4)';
    ctx.fillRect(11, 8, 1, 7); ctx.fillRect(20, 9, 1, 6); ctx.fillRect(24, 8, 1, 5);
    // --- processing hall (east): roof + facade ---
    box3(ctx, 44, -4, 25, 22, 13, m);
    for (let y = 0; y < 16; y += 5) P(ctx, 46, y, 21, 1, pal.dark);
    P(ctx, 47, 2, 8, 4, GLASS); P(ctx, 47, 2, 8, 1, GLASS_L);
    outlineRect(ctx, 46, 1, 10, 6);
    roofBox(ctx, 60, 8, 6, 3, 2, m);
    // facade: windows + vent + lamp
    faceWin(ctx, 47, 21, 3, 7, f % 3);
    P(ctx, 46, 26, 8, 3, pal.shadow); P(ctx, 46, 26, 8, 1, '#2a2a24');
    outlineRect(ctx, 45, 25, 10, 5);
    P(ctx, 64, 26, 2, 2, (f % 2) ? PAL.uiGreen : '#1e4a22');
    // --- elevated pipe gantry tank -> hall ---
    P(ctx, 31, 4, 14, 1, OUT);
    P(ctx, 31, 5, 14, 2, STEEL); P(ctx, 31, 5, 14, 1, STEEL_L);
    P(ctx, 31, 7, 14, 1, OUT);
    P(ctx, 34, 8, 1, 6, IRON_D); P(ctx, 41, 8, 1, 6, IRON_D);
    ctx.fillStyle = SH; ctx.fillRect(33, 14, 10, 2);
    // --- dock pit (south-center cell, ground level) ---
    P(ctx, 26, 32, 20, 13, '#38382f');
    P(ctx, 26, 32, 20, 1, '#26261f');
    P(ctx, 26, 32, 1, 13, '#26261f');
    P(ctx, 45, 33, 1, 12, '#4c4c40');
    outlineRect(ctx, 25, 31, 22, 15);
    P(ctx, 29, 33, 1, 11, '#57574f'); P(ctx, 42, 33, 1, 11, '#57574f');
    P(ctx, 34, 41, 4, 1, pal.haz); P(ctx, 33, 42, 2, 1, pal.haz); P(ctx, 37, 42, 2, 1, pal.haz);
    ctx.fillStyle = 'rgba(72,216,88,' + [0.10, 0.18, 0.26, 0.18][f % 4] + ')';
    ctx.fillRect(27, 33, 18, 11);
    // --- intake canopy arm (cycles down over the pit): tiny roof + face ---
    const ay = 20 + [0, 2, 4, 2][f % 4];
    ctx.fillStyle = SH; ctx.fillRect(30, ay + 10, 14, 2);
    outlineRect(ctx, 26, ay - 1, 20, 10);
    P(ctx, 27, ay, 18, 4, pal.base);
    P(ctx, 27, ay, 18, 1, pal.light);
    P(ctx, 27, ay + 3, 18, 1, pal.light);          // parapet
    P(ctx, 27, ay + 4, 18, 4, pal.dark);           // canopy south face
    P(ctx, 27, ay + 7, 18, 1, pal.shadow);
    hazardH(ctx, 28, ay + 1, 16, pal.haz);
    for (let i = 0; i < 3; i++) {
      const ph = (i + f) % 3;
      P(ctx, 29 + i * 6, ay + 5, 2, 2, ph === 0 ? PAL.tib3 : ph === 1 ? PAL.tib1 : '#1e4a22');
    }
    // chrysalite spill crystals around the dock
    const spill = [[27, 46], [30, 49], [34, 46], [38, 50], [42, 47], [45, 49], [32, 52], [25, 51]];
    const tibCols = [PAL.tib1, PAL.tib2, PAL.tib3];
    for (let i = 0; i < spill.length; i++) {
      P(ctx, spill[i][0], spill[i][1], 2, 2, tibCols[i % 3]);
      P(ctx, spill[i][0], spill[i][1] + 2, 2, 1, PAL.tibDark);
    }
  }

  function drawSilo(ctx, W, H, pal, f, side, rnd) { // 48x24 +6 — twin tank domes
    baseSlab(ctx, W, H); slabNoise(ctx, W, H, rnd);
    // connecting pipe behind console
    P(ctx, 19, 9, 10, 1, OUT); P(ctx, 19, 10, 10, 2, STEEL); P(ctx, 19, 10, 10, 1, STEEL_L);
    P(ctx, 19, 12, 10, 1, OUT);
    const wc = ['#e0e0e6', '#b4b4bc', '#8e8e96', '#6e6e76'];
    for (const cx of [12, 35]) {
      // drum wall + silver dome cap
      cyl3(ctx, cx, 2, 9, 3, 12, wc, ['#b4b4bc', '#d8d8de', '#74747c']);
      dome3(ctx, cx, 2, 9, { top: '#c6c6ce', topL: '#eef0f4', face: '#9a9aa4', dark: '#6e6e76' });
      // fill-level gauge band on the south wall (+ moving gleam)
      P(ctx, cx - 6, 8, 13, 1, PAL.tibDark);
      P(ctx, cx - 6, 9, 9, 1, PAL.tib2);
      P(ctx, cx - 6 + (f ? 5 : 2), 9, 2, 1, PAL.tib3);
      // seam rivets down the wall
      P(ctx, cx, 11, 1, 4, '#8e8e96');
    }
    // console between domes: mini roof + face
    outlineRect(ctx, 20, 12, 8, 10);
    P(ctx, 21, 13, 6, 3, pal.base); P(ctx, 21, 13, 6, 1, pal.light);
    P(ctx, 21, 15, 6, 1, pal.light);
    P(ctx, 21, 16, 6, 5, pal.dark);
    P(ctx, 21, 20, 6, 1, pal.shadow);
    P(ctx, 22, 17, 2, 2, f ? PAL.uiGreen : '#1e4a22');
    P(ctx, 25, 17, 1, 2, PAL.tib1);
  }

  function drawPyle(ctx, W, H, pal, f, side, rnd) { // 48x48 +4 — barracks huts
    baseSlab(ctx, W, H); slabNoise(ctx, W, H, rnd);
    const HI = '#98a562';
    // rear hut (long) — south wall with door + windows
    hutEW(ctx, 5, -3, 40, 7, 10, HI);
    hazardH(ctx, 10, 5, 8, pal.haz);
    pDoor(ctx, 12, 8, 5, 5);
    P(ctx, 22, 8, 3, 3, GLASS); P(ctx, 22, 8, 3, 1, GLASS_L);
    P(ctx, 30, 8, 3, 3, f ? WIN_LIT : GLASS); P(ctx, 30, 8, 3, 1, f ? WIN_LIT_HI : GLASS_L);
    P(ctx, 37, 8, 3, 3, GLASS); P(ctx, 37, 8, 3, 1, GLASS_L);
    // front hut — bigger door, hazard lintel, windows
    hutEW(ctx, 3, 23, 42, 8, 11, HI);
    hazardH(ctx, 18, 32, 12, pal.haz);
    pDoor(ctx, 21, 35, 7, 6);
    faceWin(ctx, 9, 35, 2, 5, f % 2);
    faceWin(ctx, 33, 35, 2, 5, (f + 1) % 2);
    // roof vent stacks on both ridges
    for (const [vx, vy] of [[13, -1], [33, -1], [11, 25], [35, 25]]) {
      P(ctx, vx, vy, 3, 2, OLV_D); P(ctx, vx, vy, 3, 1, HI);
      outlineRect(ctx, vx - 1, vy - 1, 5, 4);
    }
    // flag pole in the yard between the huts (flutter anim)
    P(ctx, 40, 9, 1, 13, '#d8d8d0');
    P(ctx, 40, 8, 1, 1, '#ffffff');
    if (f) { P(ctx, 41, 9, 5, 3, pal.trim); P(ctx, 41, 12, 3, 1, pal.trim); P(ctx, 45, 10, 1, 1, pal.trim2); }
    else { P(ctx, 41, 10, 4, 3, pal.trim); P(ctx, 44, 11, 2, 1, pal.trim2); }
    ctx.fillStyle = SH; ctx.fillRect(41, 21, 3, 1);
    // sandbags + crates in the yard
    const SB = '#b3a06a', SBD = '#7e6f45';
    P(ctx, 4, 17, 10, 2, SB); P(ctx, 4, 17, 10, 1, '#cbbc85');
    P(ctx, 7, 16, 4, 1, SB);
    P(ctx, 6, 18, 1, 1, SBD); P(ctx, 10, 17, 1, 2, SBD);
    outlineRect(ctx, 3, 16, 12, 4);
    P(ctx, 25, 15, 6, 5, '#8a7444'); outlineRect(ctx, 25, 15, 6, 5);
    P(ctx, 26, 16, 4, 1, '#a89058'); P(ctx, 28, 16, 1, 3, '#6e5c30');
    P(ctx, 32, 17, 4, 3, '#7c6838'); outlineRect(ctx, 32, 17, 4, 3);
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

  function drawHand(ctx, W, H, pal, f, side, rnd) { // 48x48 +6 — black block
    baseSlab(ctx, W, H); slabNoise(ctx, W, H, rnd);
    const dm = { roof: pal.blackC, roofL: '#5a5a68', roofD: pal.blackA, para: '#6a6a7c',
                 face: pal.blackB, faceL: pal.blackC, faceD: '#1a1a20' };
    box3(ctx, 4, -6, 40, 26, 22, dm);
    // roof: red chevron stripe + panel seams + intake
    for (let y = -2; y < 18; y += 5) P(ctx, 6, y, 36, 1, pal.blackA);
    for (let i = 0; i < 7; i++) P(ctx, 12 + i * 3, 6 - (i % 2), 2, 2, pal.trim);
    roofBox(ctx, 32, 10, 8, 3, 3, dm);
    P(ctx, 33, 11, 6, 1, '#15151a');
    // roof edge pylon fins (north corners)
    for (const px of [6, 38]) {
      P(ctx, px, -9, 3, 5, pal.blackB);
      P(ctx, px, -9, 1, 5, '#50505e');
      outlineRect(ctx, px - 1, -10, 5, 7);
      P(ctx, px + 1, -11, 1, 1, pal.trim2);
    }
    // facade: red trim band under the parapet + emblem panel + door
    P(ctx, 5, 21, 38, 2, pal.trim);
    P(ctx, 5, 23, 38, 1, '#601812');
    P(ctx, 17, 25, 15, 14, '#121217');
    outlineRect(ctx, 16, 24, 17, 16, '#000000');
    P(ctx, 17, 25, 15, 1, '#2a2a34');
    blit(ctx, 21, 27, HAND_EMBLEM, { r: pal.trim2, R: '#ff8a70' });
    // buttress grooves
    for (const bx of [10, 38]) P(ctx, bx, 24, 1, 16, '#1c1c22');
    // door with red hazard + slit windows
    hazardH(ctx, 6, 31, 9, pal.haz);
    pDoor(ctx, 7, 34, 7, 8);
    P(ctx, 36, 30, 2, 3, f ? '#c83422' : '#5c1812');
    P(ctx, 40, 30, 2, 3, f ? '#5c1812' : '#c83422');
    // beacon at the roof's south edge
    P(ctx, 23, 16, 2, 2, f ? pal.trim2 : '#401410');
    if (f) { ctx.fillStyle = 'rgba(224,80,56,0.22)'; ctx.fillRect(21, 14, 6, 6); }
  }

  function drawWeap(ctx, W, H, pal, f, side, rnd) { // 72x48 +6 — high-bay hall
    baseSlab(ctx, W, H); slabNoise(ctx, W, H, rnd);
    const m = mats(pal);
    box3(ctx, 3, -6, 66, 30, 18, m);
    // roof: three big panels + skylight + vents + beacon
    P(ctx, 25, -5, 1, 28, pal.shadow); P(ctx, 47, -5, 1, 28, pal.shadow);
    for (let y = -2, i = 0; y < 20; y += 5, i++) P(ctx, 5, y, 62, 1, pal.dark);
    P(ctx, 8, 0, 12, 4, GLASS); P(ctx, 8, 0, 12, 1, GLASS_L);
    P(ctx, 12, 1, 1, 3, '#101c26'); P(ctx, 16, 1, 1, 3, '#101c26');
    outlineRect(ctx, 7, -1, 14, 6);
    roofBox(ctx, 52, 0, 10, 4, 3, m);
    P(ctx, 53, 1, 8, 1, pal.shadow); P(ctx, 53, 3, 8, 1, pal.shadow);
    P(ctx, 30, 0, 10, 4, GLASS); P(ctx, 30, 0, 10, 1, GLASS_L);
    P(ctx, 34, 1, 1, 3, '#101c26');
    outlineRect(ctx, 29, -1, 12, 6);
    roofBox(ctx, 31, 10, 7, 3, 3, m);
    P(ctx, 64, -4, 3, 3, (f % 2) ? PAL.fire1 : '#5c2014');
    outlineRect(ctx, 63, -5, 5, 5);
    // facade: giant roller door with raised gap + welding flashes
    hazardV(ctx, 20, 26, 15, pal.haz);
    hazardV(ctx, 50, 26, 15, pal.haz);
    rollDoor(ctx, 24, 26, 24, 12);
    P(ctx, 24, 38, 24, 3, '#141418');                       // raised-door gap
    P(ctx, 23, 37, 26, 1, OUT);
    P(ctx, 24, 41, 24, 1, OUT);
    if (f === 1) { P(ctx, 30, 38, 2, 2, '#e8f6ff'); P(ctx, 29, 39, 4, 1, '#8ec8f0'); ctx.fillStyle = 'rgba(160,220,255,0.35)'; ctx.fillRect(27, 36, 8, 5); }
    if (f === 3) { P(ctx, 41, 39, 2, 2, '#e8f6ff'); P(ctx, 40, 39, 4, 1, '#8ec8f0'); ctx.fillStyle = 'rgba(160,220,255,0.35)'; ctx.fillRect(38, 37, 8, 5); }
    P(ctx, 35, 27, 2, 1, (f % 2) ? PAL.uiGreen : '#1e4a22'); // door status lamp
    // facade windows + service door
    faceWin(ctx, 7, 28, 2, 6, f % 2);
    faceWin(ctx, 55, 28, 2, 6, (f + 1) % 2);
    pDoor(ctx, 58, 35, 6, 7);
  }

  function drawAfld(ctx, W, H, pal, f, side, rnd) { // 96x48 +6 — runway
    baseSlab(ctx, W, H, '#5a5a53', '#6b6b62', '#484841'); slabNoise(ctx, W, H, rnd);
    const m = mats(pal);
    // runway strip (flat ground)
    P(ctx, 2, 20, 92, 23, ASPH);
    P(ctx, 3, 21, 90, 1, ASPH_L);
    P(ctx, 3, 41, 90, 1, ASPH_D);
    outlineRect(ctx, 1, 19, 94, 25);
    for (let i = 0; i < 5; i++) { P(ctx, 5, 23 + i * 4, 5, 2, '#c9c9c0'); P(ctx, 86, 23 + i * 4, 5, 2, '#c9c9c0'); }
    for (let x = 15; x < 82; x += 10) P(ctx, x, 30, 6, 2, '#b9b9b0');
    ctx.fillStyle = 'rgba(12,12,10,0.35)';
    for (let i = 0; i < 6; i++) ctx.fillRect((16 + rnd() * 60) | 0, (24 + rnd() * 14) | 0, 5, 1);
    // landing lights (4-frame chase)
    for (let i = 0; i < 8; i++) {
      const on = (i + f) % 4 === 0;
      const gx = 14 + i * 10;
      P(ctx, gx, 16, 2, 2, on ? '#ffd860' : '#4a3a14');
      P(ctx, gx, 45, 2, 2, ((i + f + 2) % 4 === 0) ? '#ffd860' : '#4a3a14');
      if (on) { ctx.fillStyle = 'rgba(255,216,96,0.30)'; ctx.fillRect(gx - 1, 15, 4, 4); }
    }
    // control tower (NW): roof + glassed cab facade
    box3(ctx, 4, -6, 20, 9, 12, m);
    P(ctx, 6, -4, 6, 5, pal.dark); outlineRect(ctx, 5, -5, 8, 7); // radar shed
    P(ctx, 20, -6, 1, 3, '#2a2a26');
    P(ctx, 19, -8, 3, 2, (f % 2) ? pal.trim2 : '#401410');
    P(ctx, 6, 4, 16, 4, GLASS);                    // cab band on the facade
    P(ctx, 6, 4, 16, 1, GLASS_L);
    P(ctx, 9 + (f % 4) * 3, 6, 2, 1, GLASS_HI);
    P(ctx, 11, 8, 1, 4, pal.shadow);
    pDoor(ctx, 8, 10, 4, 4);
    // fuel drums (small cylinders)
    for (let i = 0; i < 3; i++) {
      cyl3(ctx, 30 + i * 7, 6, 2, 1, 5, ['#d8d8ce', STEEL, STEEL_D, STEEL_D2],
           [i === 1 ? pal.haz : STEEL_L, '#e6e6dc', STEEL_D]);
    }
    // windsock (4-position flutter)
    P(ctx, 52, 0, 1, 15, '#3a3a34');
    P(ctx, 52, -1, 1, 1, '#5c5c54');
    const sock = [[53, 1, 7, 3], [53, 2, 6, 3], [53, 3, 5, 3], [53, 2, 6, 3]][f % 4];
    P(ctx, sock[0], sock[1], sock[2], sock[3], '#e07820');
    P(ctx, sock[0], sock[1], sock[2], 1, '#f8a850');
    P(ctx, sock[0] + sock[2] - 2, sock[1] + 1, 2, 1, '#f8f0e0');
    // hangar (NE): arched roof with a dark south mouth
    hut3(ctx, 61, -6, 31, 10, { hi: pal.light, mid: pal.base, dk: pal.dark, dk2: pal.shadow,
                                face: pal.dark, faceD: pal.shadow });
    P(ctx, 62, -3, 29, 1, pal.trim);
    // mouth opening in the arch face
    for (let dx = -9; dx <= 9; dx++) {
      const e = Math.round(9 * Math.sqrt(Math.max(0, 1 - (dx * dx) / 81)));
      if (e > 1) {
        P(ctx, 76 + dx, 17 - e, 1, e, '#1c1c18');
        P(ctx, 76 + dx, 17 - e, 1, 1, '#3a3a32');
      }
    }
    P(ctx, 66, 16, 20, 1, OUT);
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

  function drawHq(ctx, W, H, pal, f, side, rnd) { // 48x48 +8 — bunker + dish
    baseSlab(ctx, W, H); slabNoise(ctx, W, H, rnd);
    const m = mats(pal);
    box3(ctx, 3, 4, 42, 24, 14, m);
    // roof: seams + skylight + hatch
    for (let y = 8; y < 26; y += 5) P(ctx, 5, y, 38, 1, pal.dark);
    P(ctx, 28, 8, 9, 4, GLASS); P(ctx, 28, 8, 9, 1, GLASS_L);
    outlineRect(ctx, 27, 7, 11, 6);
    P(ctx, 30, 20, 5, 4, pal.dark); outlineRect(ctx, 29, 19, 7, 6);
    // dish pedestal on the roof (own face + shadow) + rotating dish above
    roofBox(ctx, 10, 8, 12, 6, 5, m);
    P(ctx, 12, 15, 2, 2, pal.light);
    ellipseFill(ctx, 19, 9, 7, 2, SH);                       // dish shadow
    P(ctx, 15, 4, 2, 4, IRON); P(ctx, 15, 4, 1, 4, IRON_L); // mast
    drawDish(ctx, 16, 0, f % 8);
    // antenna mast (east roof) + blink
    P(ctx, 39, -4, 1, 11, '#262622');
    P(ctx, 37, -1, 5, 1, '#262622');
    P(ctx, 38, -6, 3, 2, (f % 2) ? PAL.srpRedLight : '#5c2014');
    // facade: hazard door + windows + comms panel
    hazardH(ctx, 7, 30, 12, pal.haz);
    pDoor(ctx, 9, 33, 8, 9);
    faceWin(ctx, 25, 32, 3, 6, f % 3);
    P(ctx, 38, 32, 4, 6, IRON); P(ctx, 38, 32, 4, 1, IRON_L);
    outlineRect(ctx, 37, 31, 6, 8);
    P(ctx, 39, 34, 2, 1, (f % 2) ? PAL.uiGreen : '#1e4a22');
  }

  function drawEye(ctx, W, H, pal, f, side, rnd) { // 48x48 +8 — dome tower
    baseSlab(ctx, W, H); slabNoise(ctx, W, H, rnd);
    const m = mats(pal);
    box3(ctx, 3, 14, 42, 14, 14, m);
    // roof seams + machinery
    for (let y = 18; y < 26; y += 4) P(ctx, 5, y, 38, 1, pal.dark);
    roofBox(ctx, 34, 17, 7, 3, 3, m);
    // support drum + geodesic ball rising over the roof
    cyl3(ctx, 18, 12, 8, 3, 4, [pal.light, pal.base, pal.dark, pal.shadow],
         [pal.base, pal.light, pal.shadow]);
    ellipseFill(ctx, 21, 16, 10, 3, SH);            // ball shadow on the roof
    circleFill(ctx, 18, 3, 11, OUT);
    circleFill(ctx, 18, 3, 10, '#dededa');
    for (let dy = -10; dy <= 10; dy++) {            // east shade
      const hw = Math.floor(Math.sqrt(100 - dy * dy) + 0.5);
      const w = dy > 0 ? 3 : 2;
      if (hw > w) P(ctx, 18 + hw - w, 3 + dy, w, 1, '#a2a29c');
    }
    for (let dy = 5; dy <= 10; dy++) {              // south face mid-shade
      const hw = Math.floor(Math.sqrt(100 - dy * dy) + 0.5);
      P(ctx, 18 - hw, 3 + dy, hw * 2 - 2, 1, '#c2c2bc');
    }
    circleFill(ctx, 14, -1, 3, '#f4f4f0');          // NW glint
    // geodesic lines
    ctx.fillStyle = 'rgba(88,88,84,0.5)';
    ctx.fillRect(10, -1, 17, 1); ctx.fillRect(8, 3, 21, 1); ctx.fillRect(10, 7, 17, 1);
    for (let x = 10; x < 27; x += 4) { ctx.fillRect(x, 1, 1, 1); ctx.fillRect(x + 2, 5, 1, 1); }
    // equator sensor slit + scanner glint
    P(ctx, 10, 2, 17, 2, '#2e3e4a');
    P(ctx, 10, 2, 17, 1, '#22303a');
    const sx = 11 + (f % 4) * 4;
    P(ctx, sx, 2, 3, 2, GLASS_HI);
    P(ctx, sx + 1, 2, 1, 2, '#ffffff');
    ctx.fillStyle = 'rgba(166,210,236,0.30)';
    ctx.fillRect(sx - 1, 1, 5, 4);
    // ion uplink antenna
    P(ctx, 40, -2, 1, 16, '#2a2a26');
    P(ctx, 38, 1, 5, 1, '#2a2a26');
    P(ctx, 39, -4, 3, 2, (f % 2) ? PAL.ion : '#28506c');
    if (f % 2) { ctx.fillStyle = 'rgba(168,216,248,0.25)'; ctx.fillRect(37, -6, 7, 5); }
    // facade: door + hazard + windows
    hazardH(ctx, 28, 30, 12, pal.haz);
    pDoor(ctx, 30, 33, 8, 8);
    faceWin(ctx, 7, 32, 2, 7, f % 2);
    P(ctx, 20, 33, 2, 2, (f % 2) ? PAL.ion : '#28506c');
  }

  // one temple tier: foreshortened top platform + south face with red trim
  function tier(ctx, x, w, topY, topH, fh, pal, rnd) {
    ctx.fillStyle = SH;
    ctx.fillRect(x + w, topY + 3, 3, topH + fh);
    P(ctx, x, topY, w, topH, pal.blackC);
    P(ctx, x, topY, w, 1, '#5a5a68');
    P(ctx, x, topY, 1, topH, '#4c4c58');
    P(ctx, x + w - 2, topY, 2, topH, pal.blackA);
    for (let i = 0; i < w / 4; i++)
      P(ctx, (x + 2 + rnd() * (w - 5)) | 0, (topY + 1 + rnd() * (topH - 2)) | 0, 1, 1, 'rgba(96,96,112,0.35)');
    P(ctx, x, topY + topH - 1, w, 1, '#63637a');            // parapet
    P(ctx, x, topY + topH, w, fh, pal.blackB);              // south face
    P(ctx, x, topY + topH, w, 1, pal.blackC);
    P(ctx, x + 2, topY + topH + 2, w - 4, 1, pal.trim);     // red trim line
    P(ctx, x + w - 2, topY + topH, 2, fh, '#1a1a20');
    P(ctx, x, topY + topH + fh - 2, w, 1, pal.blackA);
    P(ctx, x, topY + topH + fh - 1, w, 1, OUT);
    outlineRect(ctx, x - 1, topY - 1, w + 2, topH + fh + 2);
  }

  function pylon(ctx, x, y, pal) { // squat obsidian spike with its own shadow
    ctx.fillStyle = SH; ctx.fillRect(x + 4, y + 6, 2, 4);
    P(ctx, x - 1, y + 4, 6, 4, pal.blackA);
    P(ctx, x, y - 2, 3, 7, pal.blackB);
    P(ctx, x + 1, y - 5, 1, 4, pal.blackB);
    P(ctx, x, y - 2, 1, 7, pal.blackC);
    outlineRect(ctx, x - 2, y + 3, 8, 6);
    P(ctx, x - 1, y - 3, 5, 1, OUT);
    P(ctx, x, y - 6, 3, 1, OUT);
    P(ctx, x + 1, y - 6, 1, 1, pal.trim2);
    P(ctx, x + 1, y - 5, 1, 2, pal.trim);
  }

  function drawTmpl(ctx, W, H, pal, f, side, rnd) { // 72x72 +12 — obsidian monolith
    baseSlab(ctx, W, H, '#68685f', '#79796f', '#525249'); slabNoise(ctx, W, H, rnd);
    const g = [0, 1, 2, 1][f % 4];  // ember pulse 0..2
    const glow = ['#8a2015', '#c83422', '#ff6a4a'][g];
    const glowHi = ['#d04030', '#ffa080', '#ffd0b0'][g];

    // wide temple terrace + low western annex wing
    tier(ctx, 4, 64, 44, 6, 12, pal, rnd);
    tier(ctx, 8, 26, 28, 7, 11, pal, rnd);
    // annex roof detail: a shallow ember channel feeding the monolith
    P(ctx, 12, 31, 20, 1, '#1a1a20');
    P(ctx, 13, 31, (6 + g * 5), 1, glow);

    // the monolith: an asymmetric obsidian slab, roofline climbing to an
    // eastern peak — drawn per-column so the silhouette stays razor sharp
    const mx0 = 34, mx1 = 64, peak = 56;
    ctx.fillStyle = SH;
    ctx.fillRect(mx1 + 1, 0, 3, 46);           // east cast shadow
    for (let x = mx0; x <= mx1; x++) {
      const t = x <= peak
        ? (x - mx0) / (peak - mx0)              // long climb west->peak
        : 1 - (x - peak) / (mx1 - peak) * 0.45; // short drop past the peak
      const topY = Math.round(4 - 16 * t);
      P(ctx, x, topY - 1, 1, 1, OUT);
      P(ctx, x, topY, 1, 2, '#5a5a68');                       // lit ridge
      P(ctx, x, topY + 2, 1, 44 - (topY + 2), x > mx1 - 3 ? pal.blackA : pal.blackB);
      if (x === mx0) P(ctx, x, topY, 1, 44 - topY, '#4c4c58'); // west edge light
    }
    P(ctx, mx0 - 1, 3, 1, 42, OUT);
    P(ctx, mx1 + 1, -6, 1, 51, OUT);
    // faceted panel seams on the front face
    ctx.fillStyle = 'rgba(96,96,112,0.30)';
    ctx.fillRect(mx0 + 5, -2, 1, 45); ctx.fillRect(mx0 + 19, -8, 1, 51);
    // west-side buttress fins stepping down off the monolith
    for (let i = 0; i < 3; i++) {
      const bx = mx0 - 4 - i * 5, ty = 14 + i * 9;
      P(ctx, bx, ty, 5, 30 - ty + 14, pal.blackB);
      P(ctx, bx, ty, 5, 1, '#5a5a68');
      P(ctx, bx, ty, 1, 30 - ty + 14, '#4c4c58');
      P(ctx, bx - 1, ty - 1, 5, 1, OUT);
      P(ctx, bx + 4, ty, 1, 30 - ty + 14, pal.blackA);
    }

    // the basilisk's eye: a glowing vertical seam splitting the monolith,
    // swelling to an almond eye at its heart
    const ex = 48;
    P(ctx, ex, -6, 2, 48, '#14141a');
    P(ctx, ex, -4 + (g === 0 ? 6 : 0), 2, 44 - (g === 0 ? 6 : 0), glow);
    P(ctx, ex - 2, 16, 6, 10, '#14141a');       // socket
    P(ctx, ex - 1, 18, 4, 6, glow);
    P(ctx, ex, 20, 2, 2, glowHi);
    ctx.fillStyle = 'rgba(255,96,56,' + (0.10 + g * 0.08).toFixed(2) + ')';
    ctx.fillRect(ex - 4, 12, 10, 18);           // eye halo
    // apex spire + slow-blinking summit beacon
    P(ctx, peak, -22, 2, 10, '#26262e');
    P(ctx, peak - 1, -24, 4, 3, (f % 2) ? glowHi : '#571b12');
    if (f % 2) { ctx.fillStyle = 'rgba(255,96,56,0.25)'; ctx.fillRect(peak - 3, -27, 8, 7); }

    // ember seam along the terrace face (in place of the old rune dots)
    for (let i = 0; i < 6; i++) P(ctx, 10 + i * 10, 55, 4, 1, i % 3 === g ? glow : '#3a1410');

    // entrance in the annex face: tall black arch, red lintel, hazard skirt
    P(ctx, 16, 44, 10, 14, '#0d0d10');
    P(ctx, 17, 44, 8, 1, '#2a1215');
    outlineRect(ctx, 15, 43, 12, 15);
    P(ctx, 15, 43, 12, 1, pal.trim);
    P(ctx, 14, 42, 14, 1, pal.blackC);
    hazardH(ctx, 15, 59, 12, pal.haz);
    // twin horn pylons flanking the approach
    pylon(ctx, 8, 52, pal);
    pylon(ctx, 30, 52, pal);
  }

  function drawHpad(ctx, W, H, pal, f, side, rnd) { // 48x48 — raised deck
    baseSlab(ctx, W, H, '#62625a', '#73736a', '#50504a'); slabNoise(ctx, W, H, rnd);
    // raised landing deck: flat top + south lip face + SE shadow
    ctx.fillStyle = SH; ctx.fillRect(44, 7, 2, 36); ctx.fillRect(7, 42, 37, 2);
    outlineRect(ctx, 3, 3, 42, 40);
    P(ctx, 4, 4, 40, 32, '#42423d');
    P(ctx, 4, 4, 40, 1, '#5c5c53');
    P(ctx, 4, 4, 1, 32, '#5c5c53');
    P(ctx, 42, 5, 2, 31, '#33332e');
    P(ctx, 4, 35, 40, 1, '#74746a');       // parapet lip
    P(ctx, 4, 36, 40, 5, '#31312c');       // deck south face
    P(ctx, 4, 36, 40, 1, '#4a4a44');
    P(ctx, 4, 40, 40, 2, '#262622');
    hazardH(ctx, 17, 37, 14, pal.haz);
    outlineRect(ctx, 7, 7, 34, 26, '#8a8a80');
    // corner hazard chevrons on the deck
    hazardH(ctx, 8, 8, 8, pal.haz); hazardH(ctx, 32, 8, 8, pal.haz);
    hazardH(ctx, 8, 29, 8, pal.haz); hazardH(ctx, 32, 29, 8, pal.haz);
    // white H (foreshortened)
    P(ctx, 17, 12, 4, 16, WHT);
    P(ctx, 27, 12, 4, 16, WHT);
    P(ctx, 21, 18, 6, 4, WHT);
    P(ctx, 17, 12, 1, 16, '#ffffff'); P(ctx, 27, 12, 1, 16, '#ffffff');
    P(ctx, 20, 12, 1, 16, WHT_D); P(ctx, 30, 12, 1, 16, WHT_D);
    P(ctx, 17, 27, 4, 1, WHT_D); P(ctx, 27, 27, 4, 1, WHT_D);
    P(ctx, 21, 21, 6, 1, WHT_D);
    // scuff marks
    ctx.fillStyle = 'rgba(12,12,10,0.30)';
    for (let i = 0; i < 5; i++) ctx.fillRect((10 + rnd() * 26) | 0, (10 + rnd() * 20) | 0, 3, 1);
    // corner landing lights: rotating chase (one lit per frame)
    const corners = [[5, 5], [40, 5], [40, 31], [5, 31]];
    for (let i = 0; i < 4; i++) {
      const lit = (f % 4) === i;
      P(ctx, corners[i][0], corners[i][1], 3, 3, lit ? '#ffd860' : '#4a3a14');
      if (lit) { ctx.fillStyle = 'rgba(255,216,96,0.30)'; ctx.fillRect(corners[i][0] - 1, corners[i][1] - 1, 5, 5); }
    }
    // fuel console: mini roof + face, on the deck NE
    ctx.fillStyle = SH; ctx.fillRect(43, 9, 1, 7); ctx.fillRect(37, 15, 7, 1);
    outlineRect(ctx, 35, 7, 9, 9);
    P(ctx, 36, 8, 7, 3, pal.base); P(ctx, 36, 8, 7, 1, pal.light);
    P(ctx, 36, 10, 7, 1, pal.light);
    P(ctx, 36, 11, 7, 4, pal.dark);
    P(ctx, 36, 14, 7, 1, pal.shadow);
    P(ctx, 37, 12, 2, 2, pal.trim);
    P(ctx, 40, 12, 2, 2, GLASS);
    P(ctx, 39, 15, 1, 3, '#22221e'); P(ctx, 38, 17, 1, 2, '#22221e');
    // rotating beacon mast (west edge)
    P(ctx, 8, 11, 2, 4, '#2e2e2a');
    const bdir = [[0, -2], [2, 0], [0, 2], [-2, 0]][f % 4];
    P(ctx, 8, 9, 2, 2, '#e84838');
    P(ctx, 8 + bdir[0], 9 + bdir[1], 2, 2, 'rgba(255,120,90,0.65)');
  }

  function drawFix(ctx, W, H, pal, f, side, rnd) { // 72x72 — ring platform
    baseSlab(ctx, W, H); slabNoise(ctx, W, H, rnd);
    const cx = 36, cy = 33, rx = 31, ry = 25, lip = 4;
    // cast shadow SE + platform rim face (the pad is a raised disc)
    ctx.fillStyle = SH;
    ctx.fillRect(cx + rx - 4, cy + 8, 4, ry); // east spill
    for (let dx = -rx; dx <= rx; dx++) {
      const e = Math.round(ry * Math.sqrt(Math.max(0, 1 - dx * dx / (rx * rx))));
      P(ctx, cx + dx, cy + e, 1, lip, dx > rx * 0.45 ? CONC_D2 : CONC_D);
      P(ctx, cx + dx, cy + e + lip, 1, 1, OUT);
      if (dx > -rx * 0.5) { ctx.fillStyle = SH; ctx.fillRect(cx + dx, cy + e + lip + 1, 1, 2); }
    }
    ellipseFill(ctx, cx, cy, rx + 1, ry + 1, OUT);
    ellipseFill(ctx, cx, cy, rx, ry, '#94948b');
    ellipseFill(ctx, cx - 1, cy - 1, rx - 2, ry - 2, '#a4a49a');
    ellipseFill(ctx, cx, cy, rx - 4, ry - 4, '#99998f');
    // hazard ring marks
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2;
      P(ctx, Math.round(cx + Math.cos(a) * (rx - 4)) - 1, Math.round(cy + Math.sin(a) * (ry - 4)) - 1,
        2, 2, i % 2 ? pal.haz : '#33332e');
    }
    // recessed service pit
    ellipseFill(ctx, cx, cy, 22, 17, OUT);
    ellipseFill(ctx, cx, cy, 21, 16, '#4e4e48');
    ellipseFill(ctx, cx, cy + 1, 20, 15, '#454540');
    P(ctx, cx - 14, cy - 15, 24, 1, '#2e2e2a');     // recess: dark north lip
    P(ctx, cx - 16, cy + 15, 26, 1, '#5f5f58');     // lit south lip
    // chevrons pointing center
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * Math.PI * 2 + Math.PI / 4;
      const px = Math.round(cx + Math.cos(a) * 13), py = Math.round(cy + Math.sin(a) * 11);
      P(ctx, px - 1, py, 3, 1, '#5f5f58'); P(ctx, px, py - 1, 1, 3, '#5f5f58');
    }
    // center lift pad: small raised disc with 2px face
    for (let dx = -9; dx <= 9; dx++) {
      const e = Math.round(7 * Math.sqrt(Math.max(0, 1 - dx * dx / 81)));
      P(ctx, cx + dx, cy + e, 1, 2, CONC_D);
      P(ctx, cx + dx, cy + e + 2, 1, 1, OUT);
    }
    ellipseFill(ctx, cx, cy, 10, 8, OUT);
    ellipseFill(ctx, cx, cy, 9, 7, '#8f8f86');
    ellipseFill(ctx, cx - 2, cy - 2, 5, 4, '#a5a59c');
    ellipseFill(ctx, cx, cy, 4, 3, '#6e6e66');
    P(ctx, cx - 3, cy, 7, 1, '#54544e'); P(ctx, cx, cy - 2, 1, 5, '#54544e');
    // two service arm gantries (west + east): mini roof + face + piston
    for (const s of [-1, 1]) {
      const ax = s < 0 ? 5 : 45;
      ctx.fillStyle = SH; ctx.fillRect(ax + 22, cy - 1, 2, 6); ctx.fillRect(ax + 2, cy + 5, 21, 2);
      outlineRect(ctx, ax - 1, cy - 4, 24, 9);
      P(ctx, ax, cy - 3, 22, 3, pal.base);
      P(ctx, ax, cy - 3, 22, 1, pal.light);
      P(ctx, ax, cy - 1, 22, 1, pal.light);
      P(ctx, ax, cy, 22, 4, pal.dark);
      P(ctx, ax, cy + 3, 22, 1, pal.shadow);
      P(ctx, ax + (s < 0 ? 17 : 1), cy - 2, 4, 5, IRON);
      P(ctx, ax + (s < 0 ? 17 : 1), cy - 2, 4, 1, IRON_L);
      hazardH(ctx, ax + (s < 0 ? 2 : 9), cy + 1, 9, pal.haz);
    }
    // blinking service lights + weld spark in the pit
    P(ctx, 25, cy - 6, 2, 2, f ? PAL.uiGreen : '#1e4a22');
    P(ctx, 45, cy - 6, 2, 2, f ? '#1e4a22' : PAL.uiGreen);
    if (f) { P(ctx, 33, cy + 6, 2, 2, '#e8f6ff'); ctx.fillStyle = 'rgba(160,220,255,0.35)'; ctx.fillRect(31, cy + 4, 6, 6); }
    // control hut (NE): mini box with glassed face
    box3(ctx, 56, 1, 13, 5, 8, mats(pal));
    P(ctx, 58, 7, 9, 3, GLASS);
    P(ctx, 58, 7, 9, 1, GLASS_L);
    P(ctx, 60 + (f ? 3 : 0), 8, 1, 1, GLASS_HI);
  }

  function drawGtwr(ctx, W, H, pal, f, side, rnd) { // 24x24 — sandbag MG nest
    roundPad(ctx, 12, 13, 11, rnd);
    const SB = '#b3a06a', SBL = '#cfc088', SBD = '#7e6f45', SBD2 = '#5e5233';
    // raised sandbag ring: bright top ring + 3px bag-course south face
    ctx.fillStyle = SH; ctx.fillRect(21, 8, 2, 9);
    for (let dx = -9; dx <= 9; dx++) {
      const e = Math.round(7 * Math.sqrt(Math.max(0, 1 - dx * dx / 81)));
      const x = 12 + dx;
      P(ctx, x, 9 + e, 1, 3, dx > 4 ? SBD2 : SBD);
      P(ctx, x, 10 + e, 1, 1, dx > 4 ? '#463d24' : SBD2); // bag course seam
      P(ctx, x, 12 + e, 1, 1, OUT);
    }
    ellipseFill(ctx, 12, 9, 10, 8, OUT);
    ellipseFill(ctx, 12, 9, 9, 7, SB);
    // bag texture on the top ring: radial seams + NW highlight arc
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2 + 0.2;
      P(ctx, Math.round(12 + Math.cos(a) * 7.5), Math.round(9 + Math.sin(a) * 5.5), 1, 2, SBD);
    }
    for (let a = 3.4; a < 5.2; a += 0.3)
      P(ctx, Math.round(12 + Math.cos(a) * 8), Math.round(9 + Math.sin(a) * 6), 2, 1, SBL);
    // nest interior (sunken)
    ellipseFill(ctx, 12, 9, 5, 4, '#3e3e38');
    ellipseFill(ctx, 12, 10, 4, 3, '#34342f');
    P(ctx, 8, 6, 8, 1, '#26261f');
    // MG on tripod, barrel north with muzzle glint
    P(ctx, 10, 7, 5, 4, IRON);
    P(ctx, 10, 7, 5, 1, IRON_L);
    outlineRect(ctx, 9, 6, 7, 6);
    P(ctx, 11, 0, 2, 7, '#22222a');
    P(ctx, 11, 0, 1, 7, '#5a5a64');
    P(ctx, 10, 0, 4, 1, OUT);
    if (f) { P(ctx, 11, 0, 2, 1, '#ffffff'); P(ctx, 12, 1, 1, 1, GLASS_HI); }
    // ammo crate on the pad SE
    P(ctx, 16, 16, 5, 3, '#8a7444');
    P(ctx, 16, 16, 5, 1, '#a89058');
    outlineRect(ctx, 16, 16, 5, 4);
    P(ctx, 17, 17, 1, 1, pal.haz);
  }

  function missileBox(ctx, x, y, pal) { // 8x10 launcher: bright top + south face
    ctx.fillStyle = SH; ctx.fillRect(x + 8, y + 1, 1, 9);
    P(ctx, x - 1, y - 1, 10, 12, OUT);
    // top: split hatch doors seen from above, missile tips peeking
    P(ctx, x, y, 8, 4, pal.base);
    P(ctx, x, y, 8, 1, pal.light);
    P(ctx, x + 3, y, 1, 4, pal.shadow);
    P(ctx, x + 1, y + 1, 2, 2, '#d8d8d2'); P(ctx, x + 5, y + 1, 2, 2, '#d8d8d2');
    P(ctx, x + 1, y + 1, 1, 1, PAL.srpRed); P(ctx, x + 5, y + 1, 1, 1, PAL.srpRed);
    P(ctx, x, y + 3, 8, 1, pal.light);          // parapet
    // south face with warning diamond
    P(ctx, x, y + 4, 8, 6, pal.dark);
    P(ctx, x + 6, y + 4, 2, 6, pal.shadow);
    P(ctx, x + 3, y + 6, 2, 2, pal.haz);
    P(ctx, x, y + 9, 8, 1, pal.shadow);
  }

  function drawAtwr(ctx, W, H, pal, f, side, rnd) { // 24x24 +24 — missile tower
    roundPad(ctx, 12, 12, 11, rnd);
    ctx.fillStyle = SH;                       // tower shadow east + SE on pad
    ctx.fillRect(18, -6, 2, 22);
    ellipseFill(ctx, 16, 18, 5, 2, SH);
    // base plinth: bright top + hazard face
    outlineRect(ctx, 2, 11, 20, 11);
    P(ctx, 3, 12, 18, 3, CONC);
    P(ctx, 3, 12, 18, 1, CONC_L);
    P(ctx, 3, 14, 18, 1, CONC_L);
    P(ctx, 3, 15, 18, 6, CONC_D);
    hazardH(ctx, 5, 16, 14, pal.haz);
    P(ctx, 3, 20, 18, 1, CONC_D2);
    // concrete shaft, west-lit / east-dark
    P(ctx, 7, -10, 10, 23, CONC);
    P(ctx, 7, -10, 2, 23, CONC_L);
    P(ctx, 15, -10, 2, 23, CONC_D);
    P(ctx, 16, -10, 1, 23, CONC_D2);
    outlineRect(ctx, 6, -11, 12, 25);
    P(ctx, 8, -4, 8, 1, CONC_D); P(ctx, 8, 4, 8, 1, CONC_D);
    // lit window slit + gold band
    P(ctx, 9, -2, 6, 3, GLASS);
    P(ctx, 9, -2, 6, 1, GLASS_L);
    P(ctx, 10 + (f ? 2 : 0), -1, 1, 1, WIN_LIT);
    P(ctx, 8, 8, 8, 2, pal.trim);
    P(ctx, 8, 10, 8, 1, pal.shadow);
    // launcher platform: bright top slab + south lip + struts
    P(ctx, 5, -13, 2, 3, CONC_D2); P(ctx, 17, -13, 2, 3, CONC_D2);
    outlineRect(ctx, 2, -16, 20, 6);
    P(ctx, 3, -15, 18, 2, CONC_L);
    P(ctx, 3, -13, 18, 1, CONC);
    P(ctx, 3, -12, 18, 2, CONC_D);
    // twin missile boxes on the platform
    missileBox(ctx, 3, -24, pal);
    missileBox(ctx, 14, -24, pal);
    // beacon
    P(ctx, 11, -24, 2, 2, f ? pal.trim2 : '#4a1810');
    if (f) { ctx.fillStyle = 'rgba(244,220,128,0.25)'; ctx.fillRect(9, -24, 6, 4); }
  }

  function drawGun(ctx, W, H, pal, f, side, rnd) { // 24x24 — turret drum base
    roundPad(ctx, 12, 13, 11, rnd);
    // ammo boxes on the pad corners (tiny top + face)
    P(ctx, 1, 17, 5, 2, '#8f7c30'); P(ctx, 1, 19, 5, 2, '#554712');
    outlineRect(ctx, 1, 17, 5, 5); P(ctx, 2, 18, 1, 1, pal.haz);
    P(ctx, 18, 1, 4, 2, '#8f7c30'); P(ctx, 18, 3, 4, 2, '#554712');
    outlineRect(ctx, 18, 1, 4, 5);
    // raised drum: curved south wall + bright cap where the turret seats
    cyl3(ctx, 12, 9, 8, 3, 6, [pal.light, pal.base, pal.dark, pal.shadow],
         [pal.base, pal.light, pal.shadow]);
    ellipseFill(ctx, 12, 9, 5, 2, pal.shadow);
    ellipseFill(ctx, 12, 9, 4, 2, '#26262a');
    for (let i = 0; i < 8; i++) {   // cap bolts
      const a = i / 8 * Math.PI * 2 + 0.39;
      P(ctx, Math.round(12 + Math.cos(a) * 6.5), Math.round(9 + Math.sin(a) * 2.6), 1, 1, '#2e2e2a');
    }
    P(ctx, 11, 19, 2, 2, f ? pal.trim2 : '#3a1410');
  }

  function makeGunTurret(pal) { // 16 pseudo-3D rotation frames, canonical north
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
    return rot3D(c, 16, { height: 1 });
  }

  function drawObli(ctx, W, H, pal, f, side, rnd, glow) { // 24x24 +24 — spike
    roundPad(ctx, 12, 12, 11, rnd);
    ctx.fillStyle = SH;                        // spike shadow SE on the pad
    ellipseFill(ctx, 16, 19, 5, 2, SH);
    // plinth with vents: bright top edge + dark face
    P(ctx, 6, 18, 16, 4, SH);
    P(ctx, 4, 16, 16, 5, '#26262d');
    P(ctx, 4, 16, 16, 1, '#3a3a46');
    outlineRect(ctx, 3, 15, 18, 7);
    P(ctx, 6, 18, 3, 1, '#15151a'); P(ctx, 11, 18, 3, 1, '#15151a'); P(ctx, 16, 18, 3, 1, '#15151a');
    // slim tapered shaft rising to the crown (narrow at top, wider at base)
    for (let y = -14; y < 17; y++) {
      const t = (y + 14) / 31;
      const hw = Math.max(2, Math.round(2 + t * 3));
      P(ctx, 12 - hw - 1, y, 1, 1, OUT);
      P(ctx, 12 + hw, y, 1, 1, OUT);
      P(ctx, 12 - hw, y, hw * 2, 1, '#191920');
      P(ctx, 12 - hw, y, 1, 1, '#34343f');       // lit west edge
      P(ctx, 12 + hw - 1, y, 1, 1, '#0e0e13');   // dark east edge
      if (y > -8) { ctx.fillStyle = SH; ctx.fillRect(12 + hw + 1, y + 2, 1, 1); }
    }
    // THE CROWN: an angular head clearly wider than the shaft, jutting out
    // over the front — the obelisk's identity. Bright north edge, flared
    // cheeks, dark underside shading the shaft below it.
    const CROWN = [4, 6, 7, 7, 7, 6, 5];         // half-widths, y -23..-17
    for (let i = 0; i < CROWN.length; i++) {
      const y = -23 + i, hw = CROWN[i];
      P(ctx, 12 - hw - 1, y, 1, 1, OUT);
      P(ctx, 12 + hw, y, 1, 1, OUT);
      P(ctx, 12 - hw, y, hw * 2, 1, i === 0 ? '#3e3e4c' : '#23232c');
      P(ctx, 12 - hw, y, 1, 1, '#4a4a5a');       // lit west cheek
      P(ctx, 12 + hw - 1, y, 1, 1, '#101016');   // dark east cheek
    }
    P(ctx, 5, -24, 14, 1, OUT);                  // crown top outline
    P(ctx, 6, -16, 12, 1, '#0a0a0e');            // dark underside lip
    P(ctx, 9, -15, 6, 1, 'rgba(0,0,0,0.35)');                   // overhang shadow on the shaft
    // EMITTER: blazing band across the crown's slanted face
    const band = glow > 0
      ? ['#e04028', '#ff7050', '#ffd0b0'][glow - 1]
      : (f ? '#a82818' : '#8a2014');
    P(ctx, 7, -20, 10, 2, band);
    P(ctx, 9, -20, 6, 1, glow > 0 ? '#ffe8d8' : '#d04030');   // hot core line
    P(ctx, 6, -20, 1, 2, '#4a1008'); P(ctx, 17, -20, 1, 2, '#4a1008');
    if (glow > 0) {
      ctx.fillStyle = 'rgba(255,80,44,' + (0.14 * glow).toFixed(2) + ')';
      ctx.fillRect(4, -25, 16, 12 + glow * 3);
      if (glow === 3) P(ctx, 7, -24, 10, 1, 'rgba(255,220,200,0.6)');
    }
  }

  function drawSam(ctx, W, H, pal, f, side, rnd, open) { // 48x24 — dome launcher
    ovalPad(ctx, 24, 13, 23, 10, rnd);
    // raised launcher deck: bright top + south lip face + SE shadow
    ctx.fillStyle = SH; ctx.fillRect(44, 5, 2, 14); ctx.fillRect(7, 18, 37, 2);
    outlineRect(ctx, 3, 2, 42, 16);
    P(ctx, 4, 3, 40, 10, pal.base);
    P(ctx, 4, 3, 40, 1, pal.light);
    P(ctx, 4, 3, 1, 10, pal.light);
    P(ctx, 42, 4, 2, 9, pal.dark);
    P(ctx, 4, 12, 40, 1, pal.light);           // parapet lip
    P(ctx, 4, 13, 40, 4, pal.dark);            // deck south face
    P(ctx, 4, 16, 40, 1, pal.shadow);
    hazardH(ctx, 6, 14, 6, pal.haz); hazardH(ctx, 36, 14, 6, pal.haz);
    P(ctx, 6, 4, 2, 2, PAL.uiGold);
    P(ctx, 40, 4, 2, 2, PAL.uiGold);
    P(ctx, 10, 4, 1, 8, pal.dark); P(ctx, 38, 4, 1, 8, pal.dark); // deck seams
    if (!open) {
      dome3(ctx, 24, 12, 10, { top: pal.base, topL: pal.light, face: pal.dark, dark: pal.shadow });
      // meridian panel lines
      P(ctx, 24, 4, 1, 8, pal.dark);
      P(ctx, 19, 6, 1, 6, pal.dark); P(ctx, 29, 6, 1, 6, pal.dark);
      for (let dx = -7; dx <= 7; dx++) {          // latitude seam
        const dy = Math.round(Math.sqrt(Math.max(0, 100 - dx * dx)) * 0.45);
        P(ctx, 24 + dx, 12 - dy - 2, 1, 1, pal.dark);
      }
      P(ctx, 7, 9, 2, 2, f ? pal.trim2 : '#3a1410');
    } else {
      const gap = [0, 2, 5, 8][open];
      // pit interior with rack
      P(ctx, 24 - gap - 1, 3, (gap + 1) * 2, 10, '#15150f');
      P(ctx, 24 - gap - 1, 3, (gap + 1) * 2, 1, '#060604');
      if (open >= 1) { P(ctx, 24 - gap, 11, gap * 2, 1, '#3a3a32'); }
      if (open >= 2) {
        // rack rails + twin missiles, white with red noses
        P(ctx, 24 - gap, 9, gap * 2, 1, '#4c4c44');
        P(ctx, 20, 3, 2, 9, '#e2e2da'); P(ctx, 20, 3, 1, 9, '#ffffff');
        P(ctx, 26, 3, 2, 9, '#e2e2da'); P(ctx, 26, 3, 1, 9, '#ffffff');
        P(ctx, 20, 3, 2, 2, PAL.srpRedLight); P(ctx, 26, 3, 2, 2, PAL.srpRedLight);
        P(ctx, 20, 10, 2, 1, '#8a8a84'); P(ctx, 26, 10, 2, 1, '#8a8a84');
      }
      if (open >= 3) {
        // center missile raised on the elevator
        P(ctx, 23, 0, 3, 12, '#f0f0e8');
        P(ctx, 23, 0, 1, 12, '#ffffff');
        P(ctx, 23, 0, 3, 2, PAL.srpRedLight);
        P(ctx, 23, 1, 1, 1, '#ffe0d0');
        P(ctx, 22, 11, 5, 1, '#6a6a62');
      }
      // dome halves slid apart (south face shading on the lower rows)
      for (let dy = 0; dy <= 8; dy++) {
        const hw = Math.floor(Math.sqrt(64 - dy * dy) * 1.1 + 0.5);
        if (hw < 2) continue;
        const y = 12 - dy;
        const col = dy < 3 ? pal.dark : pal.base;
        P(ctx, 24 - hw - gap, y, hw - 1, 1, col);
        P(ctx, 24 - hw - gap, y, 2, 1, pal.light);
        P(ctx, 24 + gap + 1, y, hw - 1, 1, col);
        P(ctx, 24 + gap + hw - 2, y, 2, 1, pal.shadow);
      }
      P(ctx, 24 - gap - 1, 11, 2, 1, IRON_L); P(ctx, 24 + gap - 1, 11, 2, 1, IRON_L);
      P(ctx, 7, 9, 2, 2, pal.trim2);
    }
  }

  // ---- builders table / frame counts / yOff -----------------------------------

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

  // extra pixels drawn ABOVE the footprint (render offsets by entry yOff):
  // tall structures rise over their anchor cells
  const YOFF = {
    fact: 10, nuke: 12, nuk2: 12, proc: 6, silo: 6, pyle: 4, hand: 12,
    weap: 6, afld: 8, hq: 8, eye: 12, tmpl: 12, atwr: 24, obli: 24,
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
    const over = YOFF[key] || 0;
    const W = d.w * C.CELL, H = d.h * C.CELL;
    // defenses sit on their own pads: no concrete bib apron
    const c = mkCanvas(W, over + H + (d.defense ? 0 : 8));
    const ctx = c.getContext('2d');
    const rnd = mulberry(hashStr(key + ':' + side));
    ctx.save();
    ctx.translate(0, over);
    if (!d.defense) drawBib(ctx, W, H, rnd);
    BUILDERS[key](ctx, W, H, sidePal(side), f, side, rnd);
    if (damaged) {
      if (d.defense) {
        // clip wear to the sprite silhouette (transparent around the pad)
        ctx.restore(); ctx.save();
        ctx.globalCompositeOperation = 'source-atop';
        damageOverlay(ctx, W, over + H, key + ':' + side);
        fireOverlay(ctx, W, over + H, key + ':' + side + ':fire', f);
      } else {
        // overlays land on the footprint body (below the yOff headroom)
        damageOverlay(ctx, W, H, key + ':' + side);
        fireOverlay(ctx, W, H, key + ':' + side + ':fire', f);
      }
    }
    ctx.restore();
    return c;
  }

  function renderObliCharge(side, glow) {
    const d = DATA.buildings.obli;
    const over = YOFF.obli;
    const W = d.w * C.CELL, H = d.h * C.CELL;
    const c = mkCanvas(W, over + H);
    const ctx = c.getContext('2d');
    ctx.translate(0, over);
    const rnd = mulberry(hashStr('obli:' + side));
    drawObli(ctx, W, H, sidePal(side), 0, side, rnd, glow);
    return c;
  }

  function renderSamOpen(side, stage) {
    const d = DATA.buildings.sam;
    const W = d.w * C.CELL, H = d.h * C.CELL;
    const c = mkCanvas(W, H);
    const ctx = c.getContext('2d');
    const rnd = mulberry(hashStr('sam:' + side));
    drawSam(ctx, W, H, sidePal(side), 0, side, rnd, stage);
    return c;
  }

  // ---- cameos -------------------------------------------------------------------

  // Cameos are authored at 2x (128x96) so the sidebar's 128x96 slot gets a
  // 1:1 blit: fine 1px dither, hairline framing, and READABLE 13px labels
  // instead of a blown-up 7px squint. The portrait art stays chunky pixel
  // art by design — the finesse is in the plate, not the subject.
  function cameoCanvas() {
    const c = mkCanvas(C.CAMEO_W * 2, C.CAMEO_H * 2);
    const ctx = c.getContext('2d');
    P(ctx, 0, 0, 128, 96, PAL.cameoBg);
    // diagonal slate bands + dot dither (native-res: half the grain size)
    for (let y = 0; y < 76; y++) {
      for (let x = 1; x < 127; x++) {
        if ((((x + y) / 16) | 0) % 2) P(ctx, x, y, 1, 1, '#1e1e19');
      }
    }
    ctx.fillStyle = '#2b2b25';
    for (let y = 4; y < 76; y += 6)
      for (let x = (y % 12 === 4) ? 3 : 6; x < 125; x += 6) ctx.fillRect(x, y, 1, 1);
    // soft key-light from top-left
    ctx.fillStyle = 'rgba(216,208,168,0.05)';
    for (let y = 0; y < 32; y++) ctx.fillRect(1, y, Math.max(0, 40 - y), 1);
    return c;
  }

  function finishCameo(ctx, label) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);   // label plate at native resolution
    P(ctx, 2, 76, 124, 18, PAL.uiGold);
    P(ctx, 2, 76, 124, 1, '#f0d878');
    P(ctx, 2, 92, 124, 2, '#907020');
    ctx.font = '13px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#241c08';
    const w = ctx.measureText(label).width;
    if (w > 118) {
      ctx.translate(64, 85);
      ctx.scale(118 / w, 1);
      ctx.fillText(label, 0, 0);
    } else {
      ctx.fillText(label, 64, 85);
    }
    ctx.restore();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    outlineRect(ctx, 0, 0, 128, 96, '#000000');
    outlineRect(ctx, 1, 1, 126, 94, '#000000');
    ctx.restore();
  }

  // opaque-pixel bounding box, so tall sprites with empty yOff headroom still
  // fill the cameo portrait
  function cropAlpha(c) {
    const img = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        if (img[(y * c.width + x) * 4 + 3] > 40) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return { x: 0, y: 0, w: c.width, h: c.height };
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  function buildingCameo(key) {
    const d = DATA.buildings[key];
    const side = d.side || 'udc';
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
    const cr = cropAlpha(spr);
    // scale computed against the 2x plate: fractional nearest-neighbour
    // steps are half as coarse, so uneven pixel rows mostly disappear
    const s = Math.min(112 / cr.w, 64 / cr.h, 3.2);
    const dw = Math.max(1, Math.round(cr.w * s));
    const dh = Math.max(1, Math.round(cr.h * s));
    // grounding shadow behind the portrait
    ellipseFill(ctx, 64, Math.round((74 - dh) / 2) + dh - 2, Math.min(56, (dw >> 1) + 8), 6, 'rgba(0,0,0,0.35)');
    ctx.drawImage(spr, cr.x, cr.y, cr.w, cr.h,
                  Math.round((128 - dw) / 2), Math.round((74 - dh) / 2) + 2, dw, dh);
    finishCameo(ctx, d.name);
    return c;
  }

  function ionCameo() {
    const c = cameoCanvas();
    const ctx = c.getContext('2d');
    ctx.save();
    ctx.scale(2, 2);   // scene authored in 64x48 coords on the 2x plate
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
    ctx.restore();
    finishCameo(ctx, 'Orbital Lance');
    return c;
  }

  function nukeCameo() {
    const c = cameoCanvas();
    const ctx = c.getContext('2d');
    ctx.save();
    ctx.scale(2, 2);   // scene authored in 64x48 coords on the 2x plate
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
    P(ctx, 31, 1, 2, 2, PAL.srpRedLight);
    P(ctx, 30, 3, 4, 2, PAL.srpRedLight);
    P(ctx, 29, 5, 6, 2, PAL.srpRed);
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
    ctx.restore();
    finishCameo(ctx, 'Nuclear Strike');
    return c;
  }

  // ---- generate everything at load ---------------------------------------------

  for (const key of Object.keys(DATA.buildings)) {
    if (DATA.buildings[key].wall) continue; // walls have their own generator below
    if (DATA.buildings[key].civ) continue;  // village houses too (end of file)
    SPRITES.buildings[key] = SPRITES.buildings[key] || {};
    for (const side of ['udc', 'srp']) {
      const n = FRAME_COUNT[key] || 2;
      const normal = [], damaged = [];
      for (let f = 0; f < n; f++) {
        normal.push(renderBuildingFrame(key, side, f, false));
        damaged.push(renderBuildingFrame(key, side, f, true));
      }
      const entry = { normal, damaged };
      if (YOFF[key]) entry.yOff = YOFF[key];
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

// Concrete wall (brik) — 16 auto-connect variants indexed by neighbor bitmask
// (1=N, 2=E, 4=S, 8=W). Pseudo-3D: light top face, shaded south face, posts at
// junctions. Same look for both factions. Render picks the frame by mask.
(function () {
  if (typeof SPRITES === 'undefined' || typeof mkCanvas === 'undefined' ||
      typeof document === 'undefined') return;

  const TOP = '#a8a89c', TOP_L = '#c2c2b4', FACE = '#7e7e74', FACE_D = '#5c5c54';
  const OUT = '#14140f';
  const H = 10; // wall height in px (south face rows)

  function seg(g, x, y, w, h, top) {
    // one wall chunk: top face + south face + outline
    g.fillStyle = OUT;
    g.fillRect(x - 1, y - 1, w + 2, h + H + 2);
    g.fillStyle = top ? TOP_L : TOP;
    g.fillRect(x, y, w, h);
    g.fillStyle = FACE;
    g.fillRect(x, y + h, w, H - 2);
    g.fillStyle = FACE_D;
    g.fillRect(x, y + h + H - 2, w, 2);
  }

  function wallFrame(mask, damaged) {
    const c = mkCanvas(24, 32); // 8px rises above the cell (yOff 8 world px /2)
    const g = c.getContext('2d');
    const cx = 12, cy = 14; // wall center on the cell (top-face coords)
    // arms first so the post overlaps them
    if (mask & 1) seg(g, 8, 0, 8, cy - 4, false);           // north arm
    // south arm must reach the canvas bottom (32) so consecutive cells in a
    // N-S run meet — seg's total height is h + H face rows
    if (mask & 4) seg(g, 8, cy, 8, 32 - cy - H, false);
    if (mask & 8) seg(g, 0, cy - 4, cx, 6, false);          // west arm
    if (mask & 2) seg(g, cx, cy - 4, 12, 6, false);         // east arm
    // center post: slightly taller block
    g.fillStyle = OUT;
    g.fillRect(6, 2, 12, 26);
    g.fillStyle = TOP_L;
    g.fillRect(7, 3, 10, 8);
    g.fillStyle = TOP;
    g.fillRect(7, 6, 10, 5);
    g.fillStyle = FACE;
    g.fillRect(7, 11, 10, 12);
    g.fillStyle = FACE_D;
    g.fillRect(7, 21, 10, 2);
    g.fillRect(7, 3, 1, 20);
    // cap highlight
    g.fillStyle = '#d8d8ca';
    g.fillRect(7, 3, 10, 1);
    if (damaged) {
      g.fillStyle = 'rgba(20,16,10,0.35)';
      g.fillRect(0, 0, 24, 32);
      g.fillStyle = OUT;
      g.fillRect(9, 8, 2, 3); g.fillRect(14, 14, 3, 2); g.fillRect(8, 18, 2, 2);
    }
    // soft SE shadow
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.fillRect(18, 24, 6, 4);
    return c;
  }

  const normal = [], damagedArr = [];
  for (let m = 0; m < 16; m++) {
    normal.push(wallFrame(m, false));
    damagedArr.push(wallFrame(m, true));
  }
  const entry = { normal, damaged: damagedArr, yOff: 4, wallMask: true };
  SPRITES.buildings.brik = { udc: entry, srp: entry, mut: entry };

  // corner stubs toward diagonal-only neighbors: two stepped chunks from the
  // post toward the cell corner, drawn UNDER the frame so hand-placed
  // diagonal runs read as a connected zig-zag instead of scattered posts.
  // Order matches render's mask bits: [NE, SE, SW, NW].
  function stubFrame(which) {
    const c = mkCanvas(24, 32);
    const g = c.getContext('2d');
    if (which === 0) { seg(g, 14, 6, 7, 5, false); seg(g, 18, 1, 6, 5, false); }
    if (which === 1) { seg(g, 14, 16, 7, 5, false); seg(g, 18, 20, 6, 5, false); }
    if (which === 2) { seg(g, 3, 16, 7, 5, false); seg(g, 0, 20, 6, 5, false); }
    if (which === 3) { seg(g, 3, 6, 7, 5, false); seg(g, 0, 1, 6, 5, false); }
    return c;
  }
  SPRITES.wallStub = [stubFrame(0), stubFrame(1), stubFrame(2), stubFrame(3)];

  // cameo: a short wall run (2x plate, native label — see cameoCanvas)
  const cam = mkCanvas(128, 96);
  const g = cam.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.fillStyle = PAL.cameoBg; g.fillRect(0, 0, 128, 96);
  g.drawImage(wallFrame(10, false), 8, 8, 48, 64);   // E+W run piece
  g.drawImage(wallFrame(10, false), 44, 8, 48, 64);
  g.drawImage(wallFrame(10, false), 80, 4, 48, 64);
  g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, 72, 128, 16);
  g.font = '13px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = PAL.uiText; g.fillText('Concrete Wall', 64, 80, 124);
  g.fillStyle = PAL.uiGold; g.fillRect(0, 88, 128, 8);
  SPRITES.cameo.brik = cam;

  // ---- wall gate: a 3-cell security checkpoint. Frames indexed
  // [closedH, openH, closedV, openV]; render picks the orientation from the
  // instance footprint and opens it when the owner's units approach.
  //
  // Design rule: ALL THREE cells are traversable, so the structure lives at
  // the span's outer BOUNDARY edges only — two slim housings that the hazard
  // curtain retracts into. Open = three visually clear paved squares (units
  // drive through without clipping any artwork); closed = a striped curtain
  // stretched between the housings. Lamps read the state: green open, red
  // closed.

  // one low curtain housing hugging a boundary edge; lamps face the roadway
  function gateBox(g2, x, y, w, h, open) {
    g2.fillStyle = OUT; g2.fillRect(x - 1, y - 1, w + 2, h + 2);
    g2.fillStyle = TOP_L; g2.fillRect(x, y, w, 2);                 // lit cap
    g2.fillStyle = TOP; g2.fillRect(x, y + 2, w, Math.max(1, ((h / 2) | 0) - 1));
    g2.fillStyle = FACE; g2.fillRect(x, y + (h / 2 | 0) + 1, w, h - (h / 2 | 0) - 1);
    g2.fillStyle = FACE_D; g2.fillRect(x, y + h - 1, w, 1);
    g2.fillStyle = open ? '#3fbf46' : '#d03428';                   // status lamp
    g2.fillRect(x + (w >> 1) - 1, y + (h >> 1) - 1, 2, 2);
  }

  // shared paving: a flat crossing plate — ground detail, never "structure"
  function gateRoad(g2, x, y, w, h, dashesVert) {
    g2.fillStyle = 'rgba(0,0,0,0.26)'; g2.fillRect(x, y, w, h);
    g2.fillStyle = 'rgba(255,255,255,0.07)';
    g2.fillRect(x, y, dashesVert ? 1 : w, dashesVert ? h : 1);     // lit near curb
    g2.fillStyle = 'rgba(0,0,0,0.30)';
    g2.fillRect(dashesVert ? x + w - 1 : x, dashesVert ? y : y + h - 1,
      dashesVert ? 1 : w, dashesVert ? h : 1);                     // far curb
    g2.fillStyle = 'rgba(232,224,200,0.14)';                       // lane ticks
    if (dashesVert) {                                              // traffic E-W
      for (let dy = y + 6; dy < y + h - 5; dy += 12) g2.fillRect(x + (w >> 1) - 4, dy, 8, 1);
    } else {                                                       // traffic N-S
      for (let dx = x + 8; dx < x + w - 6; dx += 12) g2.fillRect(dx, y + (h >> 1), 1, 6);
    }
  }

  function gateFrame(vert, open, damaged) {
    const c2 = vert ? mkCanvas(24, 80) : mkCanvas(72, 32);
    const g2 = c2.getContext('2d');
    if (!vert) {
      // ---- horizontal span (3 wide, traffic crosses north-south) ----
      gateRoad(g2, 1, 9, 70, 14, false);
      if (open) {
        // curtain fully swallowed by the housings; yellow tips peek out
        g2.fillStyle = '#c8a83c'; g2.fillRect(7, 13, 2, 6); g2.fillRect(63, 13, 2, 6);
      } else {
        // striped curtain stretched between the housings + south shadow
        g2.fillStyle = OUT; g2.fillRect(6, 10, 60, 12);
        g2.fillStyle = '#8a8a7e'; g2.fillRect(7, 11, 58, 2);       // lit top rail
        for (let i = 0; i < 14; i++) {
          g2.fillStyle = i & 1 ? '#c8a83c' : '#2c2c26';
          g2.fillRect(7 + i * 4, 13, 4, 7);
        }
        g2.fillStyle = '#1c1c16'; g2.fillRect(35, 11, 2, 10);      // meeting seam
        g2.fillStyle = 'rgba(0,0,0,0.25)'; g2.fillRect(7, 22, 58, 3);
      }
      // slim housings on the outer E/W boundary edges — in a run the
      // adjoining wall posts overlap them, so the end cells stay clear
      gateBox(g2, 1, 8, 5, 17, open);
      gateBox(g2, 66, 8, 5, 17, open);
    } else {
      // ---- vertical span (3 tall, traffic crosses east-west) ----
      gateRoad(g2, 3, 9, 18, 69, true);
      if (open) {
        g2.fillStyle = '#c8a83c'; g2.fillRect(8, 9, 8, 2); g2.fillRect(8, 71, 8, 2);
      } else {
        // curtain: lit west rail, striped bands, shaded east edge
        g2.fillStyle = OUT; g2.fillRect(5, 9, 14, 64);
        g2.fillStyle = '#8a8a7e'; g2.fillRect(6, 10, 2, 62);       // lit west rail
        for (let i = 0; i < 15; i++) {
          g2.fillStyle = i & 1 ? '#c8a83c' : '#2c2c26';
          g2.fillRect(8, 10 + i * 4, 8, 4);
        }
        g2.fillStyle = '#3c3c34'; g2.fillRect(16, 10, 2, 62);      // shaded east
        g2.fillStyle = '#1c1c16'; g2.fillRect(6, 40, 12, 2);       // meeting seam
        g2.fillStyle = 'rgba(0,0,0,0.25)'; g2.fillRect(19, 11, 2, 62);
      }
      // housings on the outer N/S boundary edges: the north one lives
      // ENTIRELY in the sprite's rise rows (zero cell obstruction), the
      // south one is a slim threshold the adjoining wall post overlaps —
      // all three paved squares stay clear for the units driving through
      gateBox(g2, 1, 0, 22, 8, open);
      gateBox(g2, 1, 74, 22, 5, open);
    }
    if (damaged) {
      g2.fillStyle = 'rgba(20,16,10,0.35)'; g2.fillRect(0, 0, c2.width, c2.height);
      g2.fillStyle = OUT;
      g2.fillRect(c2.width / 2 - 3, c2.height / 2 - 4, 4, 3);
      g2.fillRect(c2.width / 2 + 4, c2.height / 2 + 2, 3, 2);
      g2.fillRect(c2.width / 2 - 9, c2.height / 2 + 4, 2, 2);
    }
    return c2;
  }
  const gateN = [gateFrame(false, false, false), gateFrame(false, true, false),
    gateFrame(true, false, false), gateFrame(true, true, false)];
  const gateD = [gateFrame(false, false, true), gateFrame(false, true, true),
    gateFrame(true, false, true), gateFrame(true, true, true)];
  const gateEntry = { normal: gateN, damaged: gateD, yOff: 4, gateFrames: true };
  SPRITES.buildings.gate = { udc: gateEntry, srp: gateEntry, mut: gateEntry, civ: gateEntry };

  const gcam = mkCanvas(128, 96);
  const gg = gcam.getContext('2d');
  gg.imageSmoothingEnabled = false;
  gg.fillStyle = PAL.cameoBg; gg.fillRect(0, 0, 128, 96);
  gg.drawImage(gateFrame(false, false, false), 4, 10, 120, 54);
  gg.fillStyle = 'rgba(0,0,0,0.5)'; gg.fillRect(0, 72, 128, 16);
  gg.font = '13px monospace'; gg.textAlign = 'center'; gg.textBaseline = 'middle';
  gg.fillStyle = PAL.uiText; gg.fillText('Wall Gate', 64, 80, 124);
  gg.fillStyle = PAL.uiGold; gg.fillRect(0, 88, 128, 8);
  SPRITES.cameo.gate = gcam;

  // ==== CIVILIAN VILLAGE ========================================================
  // Neutral houses (48x48, 2x2 cells): pitched roofs with a lit NW slope and a
  // shaded SE slope, timber/plaster south facades, chimneys, SE cast shadows.

  function _vilBase() {
    const c = mkCanvas(48, 48);
    const q = c.getContext('2d');
    q.imageSmoothingEnabled = false;
    return { c, q };
  }
  function VP(q, x, y, w, h, col) { q.fillStyle = col; q.fillRect(x, y, w, h); }

  // gabled roof, ridge E-W: rows from ridge down to the eaves on both slopes
  function _roof(q, x0, x1, ridgeY, depth, lit, mid, dark, ridgeCol) {
    for (let i = 0; i < depth; i++) {
      const w = x1 - x0 + i;                          // slight flare toward eaves
      VP(q, x0 - (i >> 1), ridgeY - depth + i, w, 1, i < 2 ? lit : mid);       // north slope
      VP(q, x0 - (i >> 1), ridgeY + i, w, 1, dark);                            // south slope
    }
    VP(q, x0 - (depth >> 1) + 1, ridgeY - 1, x1 - x0 + depth - 2, 1, ridgeCol); // ridge cap
  }

  function _houseFrame(kind, dmg) {
    const { c, q } = _vilBase();
    // cast shadow SE
    q.fillStyle = 'rgba(10,12,8,0.35)';
    q.fillRect(10, 38, 32, 5); q.fillRect(38, 16, 5, 24);

    if (kind === 'vil1') {
      // farmhouse: white plaster, terracotta roof, brick chimney
      VP(q, 5, 26, 34, 14, '#101008');                       // outline mass
      VP(q, 6, 27, 32, 12, '#d8d2c2');                       // plaster facade
      VP(q, 6, 36, 32, 3, '#b6b0a0');                        // footing shade
      _roof(q, 6, 38, 20, 9, '#c07858', '#a06048', '#7a4534', '#d8906c');
      VP(q, 30, 8, 5, 10, '#7a746a'); VP(q, 30, 8, 5, 1, '#94908a'); // chimney
      VP(q, 30, 8, 1, 10, '#8c887e');
      VP(q, 19, 30, 6, 9, '#5a4530'); VP(q, 20, 31, 4, 7, '#6e563c'); // door
      VP(q, 21, 34, 1, 1, '#c8a84c');                                  // handle
      for (const wx of [9, 30]) {                                      // windows
        VP(q, wx, 30, 6, 5, '#31414f'); VP(q, wx, 30, 2, 2, '#88a8c0');
        VP(q, wx - 1, 35, 8, 1, '#b6b0a0');
      }
    } else if (kind === 'vil2') {
      // cottage: stone footing, warm thatch roof, green door
      VP(q, 8, 27, 30, 13, '#101008');
      VP(q, 9, 28, 28, 11, '#c9c2ae');
      VP(q, 9, 35, 28, 4, '#8e8878');                        // stone base
      for (let k = 0; k < 6; k++) VP(q, 10 + k * 4, 36, 3, 1, '#7a7466');
      _roof(q, 9, 37, 22, 8, '#b09a58', '#98803e', '#6f5c2c', '#c8b070');
      VP(q, 26, 11, 4, 9, '#6e6a60'); VP(q, 26, 11, 4, 1, '#8a867c');
      VP(q, 15, 31, 5, 8, '#3c5232'); VP(q, 16, 32, 3, 6, '#4c6840'); // door
      VP(q, 24, 31, 5, 4, '#31414f'); VP(q, 24, 31, 2, 2, '#88a8c0'); // window
    } else if (kind === 'depo') {
      // abandoned supply depot: concrete pad, corrugated shed, fuel drums,
      // strapped crates — obviously worth an engineer's trip
      VP(q, 4, 24, 38, 16, '#101008');                       // pad outline
      VP(q, 5, 25, 36, 14, '#8e8a80');                       // concrete pad
      VP(q, 5, 25, 36, 2, '#a09c92');
      VP(q, 6, 10, 20, 16, '#101008');                       // shed outline
      VP(q, 7, 11, 18, 14, '#6e7462');                       // shed wall
      for (let k = 0; k < 6; k++) VP(q, 8 + k * 3, 12, 1, 12, '#5d6353'); // corrugation
      _roof(q, 7, 25, 10, 6, '#9aa0aa', '#7d838d', '#5a6068', '#aab0ba');
      VP(q, 20, 18, 4, 7, '#3a4034');                        // shed door
      for (const [dx, dy] of [[28, 14], [34, 14], [31, 19]]) { // fuel drums
        VP(q, dx, dy, 6, 9, '#101008');
        VP(q, dx + 1, dy + 1, 4, 7, '#8a4c30');
        VP(q, dx + 1, dy + 1, 4, 1, '#a86040');
        VP(q, dx + 1, dy + 4, 4, 1, '#6e3a24');
      }
      VP(q, 8, 28, 10, 9, '#101008');                        // crate stack
      VP(q, 9, 29, 8, 7, '#8a6a3c');
      VP(q, 9, 32, 8, 1, '#6a4f2a');
      VP(q, 12, 29, 2, 7, '#c8a84c');                        // gold strap
      VP(q, 22, 29, 9, 8, '#101008');
      VP(q, 23, 30, 7, 6, '#7a5c34');
      VP(q, 26, 30, 1, 6, '#c8a84c');
    } else if (kind === 'chur') {
      // chapel: whitewashed nave, slate roof, bell tower with a gold cross
      VP(q, 16, 25, 26, 15, '#101008');                       // nave outline
      VP(q, 17, 26, 24, 13, '#e2dccc');                       // whitewash
      VP(q, 17, 36, 24, 3, '#b9b3a3');                        // footing
      _roof(q, 17, 40, 23, 8, '#98a0b0', '#7a8292', '#565c68', '#aab2c0');
      for (const wx of [21, 29]) {                            // arched windows
        VP(q, wx, 29, 4, 7, '#31414f');
        VP(q, wx + 1, 28, 2, 1, '#31414f');
        VP(q, wx, 29, 1, 2, '#88a8c0');
      }
      VP(q, 7, 10, 11, 30, '#101008');                        // tower outline
      VP(q, 8, 11, 9, 28, '#d8d2c2');                         // tower body
      VP(q, 8, 11, 9, 2, '#eae4d4');
      VP(q, 10, 15, 5, 6, '#31414f');                         // belfry louvre
      VP(q, 10, 15, 5, 1, '#20303c');
      VP(q, 10, 31, 5, 8, '#5a4530');                         // door
      VP(q, 11, 32, 3, 7, '#6e563c');
      for (let i = 0; i < 5; i++) VP(q, 8 + i, 10 - i, 9 - i * 2, 1, i < 2 ? '#6f7787' : '#565c68'); // spire
      VP(q, 12, 1, 1, 5, '#e8c84c');                          // cross
      VP(q, 11, 2, 3, 1, '#e8c84c');
    } else {
      // barn: oxblood timber, grey roof, big X-braced door
      VP(q, 4, 22, 38, 18, '#101008');
      VP(q, 5, 23, 36, 16, '#8e3b2c');
      VP(q, 5, 23, 36, 2, '#a54a38');
      VP(q, 5, 36, 36, 3, '#6e2c20');
      _roof(q, 5, 41, 16, 9, '#8a847a', '#787066', '#565048', '#9c968c');
      VP(q, 17, 27, 12, 12, '#5f2418');                       // door
      VP(q, 18, 28, 10, 10, '#7a3225');
      q.strokeStyle = '#d8d2c2'; q.lineWidth = 1;              // white X braces
      q.beginPath(); q.moveTo(18.5, 28.5); q.lineTo(27.5, 37.5);
      q.moveTo(27.5, 28.5); q.lineTo(18.5, 37.5); q.stroke();
      VP(q, 8, 27, 5, 4, '#31414f'); VP(q, 33, 27, 5, 4, '#31414f'); // side windows
    }

    if (dmg) {
      // charring, roof holes, broken glass
      q.fillStyle = 'rgba(16,12,8,0.45)';
      q.fillRect(8, 14, 14, 8); q.fillRect(24, 30, 12, 8);
      VP(q, 14, 16, 7, 4, '#14100c'); VP(q, 28, 12, 5, 3, '#14100c');
      VP(q, 10, 32, 4, 3, '#1c1814'); VP(q, 30, 33, 4, 2, '#1c1814');
    }
    return c;
  }

  for (const key of ['vil1', 'vil2', 'vil3', 'chur', 'depo']) {
    const entry = { normal: [_houseFrame(key, false)], damaged: [_houseFrame(key, true)] };
    SPRITES.buildings[key] = { civ: entry, udc: entry, srp: entry };
  }

  // bridge control room (24x24, 1x1 cell): a squat concrete blockhouse with a
  // hazard-striped door, a comms whip and a status lamp — obviously the thing
  // an engineer should be sent into
  function _bhutFrame(dmg) {
    const c = mkCanvas(24, 24);
    const q = c.getContext('2d');
    q.imageSmoothingEnabled = false;
    q.fillStyle = 'rgba(10,12,8,0.35)';                       // cast shadow SE
    q.fillRect(4, 19, 17, 3); q.fillRect(19, 8, 3, 12);
    VP(q, 2, 6, 17, 14, '#101008');                           // outline mass
    VP(q, 3, 7, 15, 12, '#8e8a80');                           // concrete body
    VP(q, 3, 7, 15, 2, '#a09c92');                            // lit roof edge
    VP(q, 3, 16, 15, 3, '#6f6b62');                           // footing shade
    VP(q, 5, 9, 4, 3, '#31414f'); VP(q, 5, 9, 1, 1, '#88a8c0'); // window
    VP(q, 11, 10, 5, 9, '#3a3a32');                           // door recess
    for (let k = 0; k < 4; k++) VP(q, 11, 11 + k * 2, 5, 1, k & 1 ? '#c8a84c' : '#23231c');
    VP(q, 4, 3, 1, 4, '#4f4a41'); VP(q, 3, 2, 3, 1, '#4f4a41'); // comms whip
    VP(q, 16, 7, 2, 2, dmg ? '#5a2318' : '#d8a028');          // status lamp
    if (dmg) { q.fillStyle = 'rgba(16,12,8,0.45)'; q.fillRect(5, 8, 8, 5); }
    return c;
  }
  {
    const entry = { normal: [_bhutFrame(false)], damaged: [_bhutFrame(true)] };
    SPRITES.buildings.bhut = { civ: entry, udc: entry, srp: entry };
  }
})();

// ==== EXTRA COMBAT SIDES: recolored faction art ==================================
// The multi-AI skirmish fields up to four armies. Slots 3 and 4 ('ud2'/'sr2')
// play by their base faction's rules and art, with the TEAM COLORS remapped so
// the four forces read apart at a glance: UDC AZURE swaps the desert gold for
// steel blue, BASILISK AMETHYST swaps the crimson accents (and tints the greys)
// toward royal violet — green was retired, it read as chrysalite. Generated
// lazily on the first game that needs them — classic 1v1 pays nothing.
(function () {
  if (typeof SPRITES === 'undefined' || typeof document === 'undefined') return;

  const REMAP = {
    ud2: {
      '#c8a84c': '#6088c0', '#8a7230': '#40608e', '#e8d088': '#9cbce4', '#5c4c20': '#2a3c5e',
    },
    sr2: {
      '#8a8a94': '#8c7c9e', '#54545e': '#564a66', '#b8b8c2': '#b6a8ce', '#36363e': '#382e46',
      '#b02818': '#7c2cc0', '#e05038': '#ae66ec',
    },
  };
  // Basilisk art leans on many auxiliary gunmetal greys beyond the 4-color
  // ramp — AMETHYST also tilts every near-grey pixel toward violet so the
  // two basilisk armies never read as the same force
  const GREY_TILT = { sr2: [7, -8, 14] };

  function _lut(map) {
    const out = new Map();
    for (const [from, to] of Object.entries(map)) {
      const f = parseInt(from.slice(1), 16);
      const t = parseInt(to.slice(1), 16);
      out.set(f, [(t >> 16) & 255, (t >> 8) & 255, t & 255]);
    }
    return out;
  }

  function _recolorCanvas(src, lut, tilt) {
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const r = d[i], gg = d[i + 1], bb = d[i + 2];
      const m = lut.get((r << 16) | (gg << 8) | bb);
      if (m) { d[i] = m[0]; d[i + 1] = m[1]; d[i + 2] = m[2]; continue; }
      if (tilt) {
        const mx = Math.max(r, gg, bb), mn = Math.min(r, gg, bb);
        if (mx - mn < 14 && mx > 40 && mx < 210) {   // a mid-tone grey
          d[i] = Math.max(0, Math.min(255, r + tilt[0]));
          d[i + 1] = Math.max(0, Math.min(255, gg + tilt[1]));
          d[i + 2] = Math.max(0, Math.min(255, bb + tilt[2]));
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  // deep-walk a sprite entry ({normal:[canvas..], turret:[..], yOff, ...}),
  // cloning canvases through the color remap and passing scalars through
  function _recolorEntry(v, lut, seen, tilt) {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return seen.get(v);
    let out;
    if (typeof HTMLCanvasElement !== 'undefined' && v instanceof HTMLCanvasElement) {
      out = _recolorCanvas(v, lut, tilt);
    } else if (Array.isArray(v)) {
      out = [];
      seen.set(v, out);
      for (const e of v) out.push(_recolorEntry(e, lut, seen, tilt));
      return out;
    } else {
      out = {};
      seen.set(v, out);
      for (const k of Object.keys(v)) out[k] = _recolorEntry(v[k], lut, seen, tilt);
      return out;
    }
    seen.set(v, out);
    return out;
  }

  SPRITES.ensureSideArt = function (side) {
    const base = baseSide(side);
    if (side === base || !REMAP[side]) return;
    const lut = _lut(REMAP[side]);
    const tilt = GREY_TILT[side] || null;
    const seen = new Map();
    for (const col of [SPRITES.units, SPRITES.infantry, SPRITES.buildings]) {
      if (!col) continue;
      for (const key of Object.keys(col)) {
        const entry = col[key];
        if (!entry || entry[side] || !entry[base]) continue;
        // faction-neutral art (walls, gates, houses share one entry across
        // sides) needs no recolor — alias it instead of cloning
        if (entry.udc && entry.udc === entry.srp) {
          entry[side] = entry[base];
        } else {
          entry[side] = _recolorEntry(entry[base], lut, seen, tilt);
        }
      }
    }
  };
})();
