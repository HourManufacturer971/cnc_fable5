'use strict';
// sprites_infantry.js — procedurally drawn infantry sprites + cameos.
// Fills SPRITES.infantry[key][side] for e1,e2,e3,e4,e5,e6,rmbo (both sides) with
// { stand:[8], walk:[8][4], fire:[8][2], die:[4] } 24x24 canvases, and
// SPRITES.cameo[key] 64x48 bust-portrait icons. Original pixel art, C&C-95 style.
// Facing index 0 = N, 1 = NE, ... clockwise (unit facing16 >> 1).

(function () {
  // Defensive boot guards: needs DOM canvases and the core registry.
  if (typeof document === 'undefined') return;
  if (typeof SPRITES === 'undefined' || typeof PAL === 'undefined' ||
      typeof C === 'undefined' || typeof mkCanvas === 'undefined') return;

  // 8-facing unit direction vectors, index 0 = N (up), clockwise.
  const DIR8 = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

  // ---- local shade ramps (PAL-adjacent extra hex shades) ---------------------
  const SKIN_HI = '#f2c894', SKIN = '#d8a878', SKIN_SH = '#a87652', SKIN_DK = '#6e4830';
  const BOOT = '#0e0e08', BOOT_HI = '#26261e';
  const GUN = '#54544c', GUN_HI = '#8a8a80', GUN_WOOD = '#6e5230';
  const TUBE = '#5a6446', TUBE_HI = '#84906a', TUBE_DK = '#333a26';
  const GRN = '#3c4c2c', GRN_HI = '#5a7042';
  const METAL = '#b4b8c0', METAL_SH = '#70747c', METAL_DK = '#3c4046';
  const OR = '#c96f1e', OR_HI = '#eb9840', OR_DK = '#8c4a12', OR_SH = '#5c300c';
  const GRSUIT = '#38b040', GRSUIT_HI = '#72e068', GRSUIT_DK = '#1f7c26', GRSUIT_SH = '#124e16';
  const HOSE = '#2c2c26';
  const HEAP = '#26241a', HEAP_HI = '#38352a';

  const INF_KEYS = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'rmbo'];

  function hexRgb(h) {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  const OUTLINE_RGB = hexRgb(PAL.outline);

  // Darken a hex color by factor f (0..1) — used to sink legs/boots into the ground.
  function darken(hex, f) {
    const [r, g, b] = hexRgb(hex);
    const h = v => ('0' + Math.max(0, Math.round(v * f)).toString(16)).slice(-2);
    return '#' + h(r) + h(g) + h(b);
  }

  // Trace a 1px dark outline around every opaque region of `src` (4-neighbour).
  function outlined(src) {
    const w = src.width, h = src.height;
    const out = mkCanvas(w, h);
    const octx = out.getContext('2d');
    octx.drawImage(src, 0, 0);
    const img = octx.getImageData(0, 0, w, h);
    const d = img.data;
    const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] >= 128;
    const marks = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (solid(x, y)) continue;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) marks.push((y * w + x) * 4);
    }
    for (const i of marks) {
      d[i] = OUTLINE_RGB[0]; d[i + 1] = OUTLINE_RGB[1]; d[i + 2] = OUTLINE_RGB[2]; d[i + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    return out;
  }

  // ---- per type+side figure configuration ------------------------------------

  function makeCfg(type, side) {
    const gdi = side === 'gdi';
    const cfg = {
      type,
      // torso 3-shade ramp (lit left, dark right)
      uniform: gdi ? PAL.gdi : PAL.nod,
      uniformHi: gdi ? PAL.gdiLight : PAL.nodLight,
      uniformDk: gdi ? PAL.gdiDark : PAL.nodDark,
      pants: gdi ? PAL.gdiDark : PAL.nodDark,
      pantsDk: gdi ? PAL.gdiShadow : PAL.nodShadow,
      belt: gdi ? PAL.gdiShadow : '#26262e',
      helmet: gdi ? '#7c6c30' : '#4c4c58',
      helmetHi: gdi ? '#a4904a' : '#6e6e80',
      helmetDk: gdi ? '#544a1e' : '#32323c',
      hairTop: null,          // draws hair instead of helmet dome (rmbo)
      face: SKIN,
      visor: false,           // face row is a visor (e4/e5)
      visorGlint: null,
      arm: gdi ? PAL.gdi : PAL.nod,
      armDk: gdi ? PAL.gdiDark : PAL.nodDark,
      hand: SKIN,
      chest: gdi ? PAL.gdiLight : PAL.nodRed, // 1px chest strap/emblem accent
      weapon: 'rifle',        // 'rifle' | 'tube' | 'nozzle' | 'throw' | 'none'
      gunLen: 4,
      bigFlash: false,
      pack: null, packHi: null, packDk: null,
      packStyle: 'tanks',     // 'tanks' | 'box'
      hose: false,
      toolbox: false,
      jet: null,              // 3 flame-jet colors used in fire pose
      backblast: false,       // rocket launcher blast behind tube
    };
    switch (type) {
      case 'e2': // Grenadier: bulky backpack, throws in fire frames
        cfg.weapon = 'throw';
        cfg.packStyle = 'box';
        cfg.pack = gdi ? '#8a7440' : '#565662';
        cfg.packHi = gdi ? '#ac9458' : '#787886';
        cfg.packDk = gdi ? '#5e4e28' : '#3a3a44';
        break;
      case 'e3': // Rocket Soldier: big tube on the shoulder + backblast
        cfg.weapon = 'tube';
        cfg.backblast = true;
        break;
      case 'e4': // Flamethrower: orange suit, back tanks + hose, dark mask
        cfg.uniform = OR; cfg.uniformHi = OR_HI; cfg.uniformDk = OR_DK;
        cfg.pants = OR_DK; cfg.pantsDk = OR_SH;
        cfg.belt = OR_SH;
        cfg.helmet = OR; cfg.helmetHi = OR_HI; cfg.helmetDk = OR_DK;
        cfg.face = '#20242a'; cfg.visor = true; cfg.visorGlint = '#8a929e';
        cfg.arm = OR; cfg.armDk = OR_DK;
        cfg.hand = OR_DK; // gloves
        cfg.chest = gdi ? PAL.gdiLight : PAL.nodRed;
        cfg.weapon = 'nozzle';
        cfg.gunLen = 2;
        cfg.pack = METAL_SH; cfg.packHi = METAL; cfg.packDk = METAL_DK;
        cfg.hose = true;
        cfg.jet = [PAL.fire1, PAL.fire2, PAL.fire3];
        break;
      case 'e5': // Chem Warrior: toxic green suit, tanks + sprayer, green jet
        cfg.uniform = GRSUIT; cfg.uniformHi = GRSUIT_HI; cfg.uniformDk = GRSUIT_DK;
        cfg.pants = GRSUIT_DK; cfg.pantsDk = GRSUIT_SH;
        cfg.belt = GRSUIT_SH;
        cfg.helmet = GRSUIT; cfg.helmetHi = GRSUIT_HI; cfg.helmetDk = GRSUIT_DK;
        cfg.face = '#0f2a1c'; cfg.visor = true; cfg.visorGlint = PAL.tib3;
        cfg.arm = GRSUIT; cfg.armDk = GRSUIT_DK;
        cfg.hand = GRSUIT_DK;
        cfg.chest = null;
        cfg.weapon = 'nozzle';
        cfg.gunLen = 2;
        cfg.pack = '#5c7a30'; cfg.packHi = '#8aa848'; cfg.packDk = '#3a4e1e';
        cfg.hose = true;
        cfg.jet = [PAL.tib3, PAL.tib2, PAL.tib1];
        break;
      case 'e6': // Engineer: white hardhat, hi-vis vest pixel, toolbox
        cfg.weapon = 'none';
        cfg.toolbox = true;
        cfg.helmet = '#e8e4d6'; cfg.helmetHi = '#fcfaf2'; cfg.helmetDk = '#a8a494';
        cfg.chest = '#f08018'; // hi-vis vest
        break;
      case 'rmbo': // Commando: black outfit, red headband, big rifle
        cfg.uniform = '#46463e'; cfg.uniformHi = '#6a6a5e'; cfg.uniformDk = '#2c2c26';
        cfg.pants = '#34342e'; cfg.pantsDk = '#222220';
        cfg.belt = '#161612';
        cfg.hairTop = '#26211a';
        cfg.helmet = '#cc2c1c'; cfg.helmetHi = '#f05540'; cfg.helmetDk = '#8a1c10';
        cfg.arm = SKIN; cfg.armDk = SKIN_SH; // bare arms
        cfg.chest = gdi ? PAL.gdiLight : PAL.nodRed;
        cfg.gunLen = 5;
        cfg.bigFlash = true;
        break;
    }
    // legs sit one shade darker than the torso so figures ground into the terrain
    cfg.pants = darken(cfg.pants, 0.78);
    cfg.pantsDk = darken(cfg.pantsDk, 0.78);
    return cfg;
  }

  // ---- gait ------------------------------------------------------------------
  // 4-frame walk: contact A / pass / contact B / pass.
  function gaitOf(pose, frame, dx) {
    const g = { bob: 0, Lxo: 0, Rxo: 0, Llift: 0, Rlift: 0 };
    if (pose !== 'walk') return g;
    if (frame === 0) { g.Lxo = dx; g.Rxo = -dx; if (dx) g.Rlift = 1; else g.Llift = 1; }
    else if (frame === 2) { g.Rxo = dx; g.Lxo = -dx; if (dx) g.Llift = 1; else g.Rlift = 1; }
    else { g.bob = -1; if (frame === 1) g.Rlift = 2; else g.Llift = 2; }
    return g;
  }

  // ---- weapon geometry (shared by body pass and glow pass) --------------------
  // pd = perp of facing, flipped so the weapon hangs on the camera-near side.
  function perpOf(f) {
    let pdx = DIR8[(f + 2) & 7][0], pdy = DIR8[(f + 2) & 7][1];
    if (pdy < 0) { pdx = -pdx; pdy = -pdy; }
    return [pdx, pdy];
  }

  function gunGeom(f, pose, cfg, bob) {
    const dx = DIR8[f][0], dy = DIR8[f][1];
    const [pdx, pdy] = perpOf(f);
    if (cfg.weapon === 'tube') {
      // shoulder tube: rear behind the shoulder, tip past the head
      return { x0: 12 + pdx - dx * 2, y0: 11 + bob + pdy - dy * 2, dx, dy, len: 5 };
    }
    if (cfg.weapon === 'nozzle') {
      return { x0: 12 + pdx + dx, y0: 14 + bob + dy + (pdy > 0 ? 1 : 0), dx, dy, len: 2 };
    }
    // rifle held across the chest, extended one px while firing
    const ext = pose === 'fire' ? 1 : 0;
    return { x0: 12 + pdx + dx * ext, y0: 13 + bob + dy * (1 + ext) + pdy, dx, dy, len: cfg.gunLen };
  }

  // ---- figure drawing (body pass: opaque pixels, outlined afterwards) ---------

  function drawBody(ctx, f, pose, frame, cfg) {
    const dx = DIR8[f][0], dy = DIR8[f][1];
    const [pdx, pdy] = perpOf(f);
    const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
    const px = (x, y, c) => R(x, y, 1, 1, c);

    const g = gaitOf(pose, frame, dx);
    const bob = g.bob;
    const geom = gunGeom(f, pose, cfg, bob);

    function drawGun() {
      if (cfg.weapon === 'none' || cfg.weapon === 'throw') return;
      const { x0, y0, len } = geom;
      if (cfg.weapon === 'tube') {
        // chunky 2px-thick launcher tube riding the shoulder
        const tox = dx !== 0 ? 0 : 1, toy = dx !== 0 ? -1 : 0;
        for (let i = 0; i < len; i++) {
          const bx = x0 + dx * i, by = y0 + dy * i;
          px(bx + tox, by + toy, TUBE_HI);
          px(bx, by, i === 0 ? TUBE_DK : TUBE);
        }
        px(x0 + dx * (len - 2), y0 + dy * (len - 2), '#a03028'); // warhead band
        px(x0, y0 + toy, TUBE_DK); // rear opening
        // hand supporting the tube
        px(x0 + dx * 2, y0 + dy * 2 + 1, cfg.hand);
        return;
      }
      if (cfg.weapon === 'nozzle') {
        px(x0, y0, GUN);
        px(x0 + dx, y0 + dy, METAL);
        px(x0, y0 + 1, cfg.hand);
        return;
      }
      // rifle: wood stock + grey barrel with a glint
      px(x0 - dx, y0 - dy + (dy === 0 ? 1 : 0), GUN_WOOD);
      for (let i = 0; i < len; i++) px(x0 + dx * i, y0 + dy * i, i === 1 ? GUN_HI : GUN);
      if (cfg.bigFlash) px(x0 + dx * (len - 1), y0 + dy * (len - 1) + (dy === 0 ? -1 : 0), GUN); // fatter muzzle
      px(x0, y0 + 1, cfg.hand);
    }

    function drawThrowArm() {
      if (pose !== 'fire') return;
      if (frame === 0) {
        // wind-up: arm cocked up and back, grenade in fist
        px(12 - dx * 2, 12 + bob, cfg.arm);
        px(12 - dx * 2 - dx, 11 + bob, cfg.hand);
        px(12 - dx * 3, 10 + bob, GRN);
        px(12 - dx * 3, 10 + bob - 1, GRN_HI);
      } else {
        // release: arm punched out toward the facing, grenade flying
        px(12 + dx * 2, 13 + dy + bob, cfg.arm);
        px(12 + dx * 3, 13 + dy * 2 + bob, cfg.hand);
        px(12 + dx * 3 + dx, 12 + dy * 3 + bob, GRN);
      }
    }

    function drawPack() {
      if (!cfg.pack || dy > 0) return; // hidden when back faces away from camera
      if (dy < 0) {
        // back toward camera: gear sits square on the torso
        if (cfg.packStyle === 'box') {
          R(10, 12 + bob, 4, 3, cfg.pack);
          R(10, 12 + bob, 1, 3, cfg.packHi);
          R(13, 12 + bob, 1, 3, cfg.packDk);
          R(10, 15 + bob, 4, 1, cfg.packDk); // bedroll under the pack
        } else {
          R(11, 12 + bob, 1, 3, cfg.pack); px(11, 12 + bob, cfg.packHi);
          R(13, 12 + bob, 1, 3, cfg.pack); px(13, 12 + bob, cfg.packDk);
          px(12, 13 + bob, cfg.packDk);
          px(11, 11 + bob, cfg.packHi); px(13, 11 + bob, cfg.packDk); // valve caps
        }
      } else {
        // profile: gear peeks out behind the torso
        const bx = 12 - dx * 2;
        R(bx, 12 + bob, 1, cfg.packStyle === 'box' ? 3 : 4, cfg.pack);
        px(bx, 12 + bob, cfg.packHi);
        px(bx, 14 + bob, cfg.packDk);
        px(bx - dx, 13 + bob, cfg.pack);
      }
    }

    function drawToolbox() {
      const bx = 12 + pdx * 2 + dx;
      R(bx - 1, 17 + bob, 3, 2, METAL);
      px(bx + 1, 17 + bob, METAL_SH);
      px(bx, 16 + bob, METAL_DK); // handle
      px(bx, 18 + bob, '#c8503c'); // latch dot
    }

    // hand weapons hang behind the body at away facings
    const gunBehind = dy < 0 && cfg.weapon !== 'tube';
    if (gunBehind) drawGun();

    // -- legs: two 2px columns with a 1px gap, boots on the ground --------------
    const Lx = 10 + g.Lxo, Rx = 13 + g.Rxo;
    const LfootY = 21 - g.Llift + (g.bob && !g.Llift ? g.bob : 0);
    const RfootY = 21 - g.Rlift + (g.bob && !g.Rlift ? g.bob : 0);
    R(Lx, 17 + bob, 2, Math.max(1, LfootY - 17 - bob), cfg.pants);
    R(Rx, 17 + bob, 2, Math.max(1, RfootY - 17 - bob), cfg.pantsDk);
    R(Lx, LfootY, 2, 1, BOOT); px(Lx, LfootY, BOOT_HI);
    R(Rx, RfootY, 2, 1, BOOT);

    // -- torso: 3px core, highlight left / shade right, belt ---------------------
    R(11, 12 + bob, 3, 4, cfg.uniform);
    R(11, 12 + bob, 1, 4, cfg.uniformHi);
    R(13, 12 + bob, 1, 4, cfg.uniformDk);
    R(11, 16 + bob, 3, 1, cfg.belt);
    if (cfg.chest && dy >= 0) px(12, 13 + bob, cfg.chest);
    if (cfg.packStyle === 'box' && cfg.pack && dy > 0) { // backpack straps seen from the front
      px(11, 12 + bob, cfg.packDk); px(13, 12 + bob, cfg.packDk);
    }

    // -- arms / shoulders --------------------------------------------------------
    R(10, 12 + bob, 1, 3, cfg.arm);
    R(14, 12 + bob, 1, 3, cfg.armDk);

    drawPack();
    if (cfg.hose && dy >= 0) { // hose from the tanks around the hip to the nozzle
      px(12 - dx - (dx === 0 ? 1 : 0), 15 + bob, HOSE);
      px(12 + pdx - dx, 16 + bob, HOSE);
    }

    // -- head: dome, helmet band, face/visor, neck --------------------------------
    // 3/4 camera: south-ish facings tip the head down 1px (face + chest read),
    // north-ish facings tip it up 1px and show extra helmet-top/nape instead.
    const hy = 8 + bob + (dy > 0 ? 1 : dy < 0 ? -1 : 0);
    if (cfg.hairTop) {
      R(11, hy, 2, 1, cfg.hairTop);
      R(11, hy + 1, 3, 1, cfg.helmet); px(11, hy + 1, cfg.helmetHi); // headband
    } else {
      R(11, hy, 2, 1, cfg.helmetHi);
      R(11, hy + 1, 3, 1, cfg.helmet); px(13, hy + 1, cfg.helmetDk);
    }
    if (dy > 0) {
      R(11, hy + 2, 2, 1, cfg.face);
      px(13, hy + 2, cfg.visor ? cfg.face : SKIN_SH);
      if (cfg.visor && cfg.visorGlint) px(11, hy + 2, cfg.visorGlint);
      px(12, hy + 3, cfg.visor ? cfg.uniformDk : SKIN_SH); // chin / neck
    } else if (dy === 0) {
      R(11, hy + 2, 3, 1, cfg.helmetDk);
      px(12 + dx, hy + 2, cfg.visor && cfg.visorGlint ? cfg.visorGlint : cfg.face); // profile sliver
      px(12, hy + 3, cfg.uniformDk);
    } else {
      R(11, hy + 2, 3, 1, cfg.helmetDk); // back of the helmet
      px(11, hy + 2, cfg.helmet);
      R(11, hy + 3, 3, 1, cfg.helmetDk); // nape row: more head/shoulders from behind
      px(11, hy + 3, cfg.hairTop ? cfg.hairTop : cfg.helmet);
      px(12, hy + 4, cfg.uniformDk);
    }

    if (!gunBehind) drawGun();
    if (cfg.weapon === 'throw') drawThrowArm();
    if (cfg.toolbox) drawToolbox();
  }

  // ---- glow pass (muzzle flash / jets / backblast, drawn unoutlined) -----------

  function drawGlow(ctx, f, pose, frame, cfg) {
    if (pose !== 'fire') return;
    const px = (x, y, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); };
    const dx = DIR8[f][0], dy = DIR8[f][1];

    if (cfg.weapon === 'throw') {
      if (frame === 1) px(12 + dx * 4, 11 + dy * 3, 'rgba(248,232,80,0.7)'); // wrist snap
      return;
    }
    if (cfg.weapon === 'none') return;

    const g = gunGeom(f, pose, cfg, 0);
    const tx = g.x0 + dx * g.len, ty = g.y0 + dy * g.len;

    if (cfg.jet) {
      const j = cfg.jet;
      if (frame === 0) {
        px(tx, ty, j[0]);
        px(tx + dx, ty + dy, j[1]);
      } else {
        px(tx, ty, j[0]);
        px(tx + dx, ty + dy, j[1]);
        px(tx + dx * 2, ty + dy * 2, j[1]);
        px(tx + dx * 2 - dy, ty + dy * 2 + dx, j[2]);
        px(tx + dx * 2 + dy, ty + dy * 2 - dx, j[2]);
        px(tx + dx * 3, ty + dy * 3, j[2]);
      }
      return;
    }

    // muzzle flash: 2px bright PAL.fire1 star at the actual gun tip
    if (frame === 0) {
      px(tx, ty, PAL.fire1);
      px(tx + dx, ty + dy, PAL.fire1);
      px(tx - dy, ty + dx, PAL.fire2);
      px(tx + dy, ty - dx, PAL.fire2);
      if (cfg.bigFlash) {
        px(tx + dx * 2, ty + dy * 2, PAL.fire2);
        px(tx + dx - dy, ty + dy + dx, PAL.fire2);
        px(tx + dx + dy, ty + dy - dx, PAL.fire2);
      }
      if (cfg.backblast) {
        px(g.x0 - dx, g.y0 - dy, PAL.fire2);
        px(g.x0 - dx * 2, g.y0 - dy * 2, PAL.smoke);
        px(g.x0 - dx * 2 - dy, g.y0 - dy * 2 + dx, '#606058');
      }
    } else {
      px(tx, ty, PAL.fire2);
      if (cfg.backblast) px(g.x0 - dx, g.y0 - dy, PAL.smoke);
    }
  }

  // ---- death frames: 4-step crumple shared across facings ----------------------

  function drawDieBody(ctx, frame, cfg) {
    const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
    const px = (x, y, c) => R(x, y, 1, 1, c);

    if (frame === 0) {
      // hit: arched back, head thrown back, arms flung wide, rifle flying
      R(10, 18, 2, 3, cfg.pants); R(10, 21, 2, 1, BOOT);
      R(13, 18, 2, 3, cfg.pantsDk); R(13, 21, 2, 1, BOOT);
      R(10, 13, 4, 5, cfg.uniform);
      R(10, 13, 1, 5, cfg.uniformHi);
      R(13, 13, 1, 5, cfg.uniformDk);
      R(10, 16, 4, 1, cfg.belt);
      // head tipped back-right
      R(13, 10, 2, 1, cfg.hairTop || cfg.helmetHi);
      R(13, 11, 2, 1, cfg.helmet);
      px(13, 12, cfg.face);
      // arms flung out
      px(8, 13, cfg.arm); px(7, 12, cfg.hand);
      px(16, 14, cfg.armDk); px(17, 13, cfg.hand);
      if (cfg.weapon === 'rifle') { px(18, 11, GUN); px(19, 10, GUN); }
    } else if (frame === 1) {
      // buckling: down on one knee, torso pitched forward
      R(9, 19, 3, 2, cfg.pants);
      R(14, 20, 3, 1, cfg.pantsDk); px(16, 20, BOOT);
      R(9, 21, 2, 1, BOOT);
      R(9, 16, 5, 3, cfg.uniform);
      R(9, 16, 1, 3, cfg.uniformHi);
      R(13, 16, 1, 3, cfg.uniformDk);
      R(8, 13, 2, 1, cfg.hairTop || cfg.helmetHi);
      R(8, 14, 2, 1, cfg.helmet);
      px(8, 15, cfg.face);
      px(7, 17, cfg.arm); px(14, 18, cfg.armDk);
    } else if (frame === 2) {
      // sprawled prone: torso flat, one knee kinked up, arm past the head
      R(8, 19, 5, 1, cfg.uniform);
      R(8, 20, 5, 1, cfg.uniformDk);
      px(10, 19, cfg.uniformHi);
      R(13, 19, 2, 2, cfg.pants);      // hips
      px(15, 18, cfg.pantsDk); px(16, 18, cfg.pantsDk); px(17, 19, BOOT); // bent leg
      R(15, 20, 2, 1, cfg.pantsDk); px(17, 21, BOOT);                     // straight leg
      R(6, 18, 2, 1, cfg.hairTop || cfg.helmet);
      px(6, 19, cfg.face); px(7, 19, cfg.face);
      px(4, 18, cfg.hand); px(5, 18, cfg.arm); // outstretched arm
      px(9, 21, cfg.arm); px(8, 21, cfg.hand); // other arm dropped low
    } else {
      // dark flattened heap + dropped kit
      R(8, 20, 9, 2, HEAP);
      px(9, 20, HEAP_HI); px(12, 20, cfg.uniformDk); px(14, 20, HEAP_HI);
      px(10, 21, cfg.uniformDk); px(15, 21, cfg.pantsDk);
      px(6, 21, cfg.helmet); // dropped helmet / headband
      if (!cfg.hairTop) px(6, 20, cfg.helmetHi);
      if (cfg.weapon === 'rifle') { px(18, 21, GUN); px(19, 21, GUN); }
    }
  }

  // ---- frame composition --------------------------------------------------------

  // Soft 2px-tall cast-shadow ellipse just SOUTH of the feet, nudged 1px east
  // (NW light source → shadow falls SE). Darker core stacked over a lighter rim.
  function shadow(ctx, wide) {
    if (wide) {
      ctx.fillStyle = 'rgba(8,8,4,0.30)';
      ctx.fillRect(7, 22, 12, 1);
      ctx.fillRect(9, 23, 8, 1);
      ctx.fillStyle = 'rgba(8,8,4,0.30)';
      ctx.fillRect(9, 22, 8, 1);
      ctx.fillRect(11, 23, 4, 1);
    } else {
      ctx.fillStyle = 'rgba(8,8,4,0.30)';
      ctx.fillRect(8, 22, 9, 1);
      ctx.fillRect(10, 23, 5, 1);
      ctx.fillStyle = 'rgba(8,8,4,0.30)';
      ctx.fillRect(10, 22, 5, 1);
      ctx.fillRect(11, 23, 3, 1);
    }
  }

  function renderFrame(f, pose, frame, cfg) {
    const c = mkCanvas(24, 24);
    const ctx = c.getContext('2d');
    shadow(ctx, false);
    const body = mkCanvas(24, 24);
    drawBody(body.getContext('2d'), f, pose, frame, cfg);
    ctx.drawImage(outlined(body), 0, 0);
    drawGlow(ctx, f, pose, frame, cfg);
    return c;
  }

  function renderDie(frame, cfg) {
    const c = mkCanvas(24, 24);
    const ctx = c.getContext('2d');
    shadow(ctx, frame >= 2);
    const body = mkCanvas(24, 24);
    drawDieBody(body.getContext('2d'), frame, cfg);
    ctx.drawImage(outlined(body), 0, 0);
    return c;
  }

  function buildSet(cfg) {
    const stand = [], walk = [], fire = [];
    for (let f = 0; f < 8; f++) {
      stand.push(renderFrame(f, 'stand', 0, cfg));
      const w = [];
      for (let k = 0; k < 4; k++) w.push(renderFrame(f, 'walk', k, cfg));
      walk.push(w);
      const fr = [];
      for (let k = 0; k < 2; k++) fr.push(renderFrame(f, 'fire', k, cfg));
      fire.push(fr);
    }
    const die = [];
    for (let k = 0; k < 4; k++) die.push(renderDie(k, cfg));
    return { stand, walk, fire, die };
  }

  // ---- cameos: bust-style character portraits ------------------------------------

  // side used for the shared cameo portrait (matches the faction that fields it)
  const CAMEO_SIDE = { e1: 'gdi', e2: 'gdi', e3: 'gdi', e4: 'nod', e5: 'nod', e6: 'gdi', rmbo: 'gdi' };

  // Portrait palette per side
  function portraitPal(side) {
    const gdi = side === 'gdi';
    return {
      bg: gdi ? '#2a2618' : '#201c22',
      bgGlow: gdi ? '#38321e' : '#2c262e',
      bgGlow2: gdi ? '#443c26' : '#362e38',
      accent: gdi ? PAL.uiGold : PAL.nodRed,
      uni: gdi ? PAL.gdi : PAL.nod,
      uniHi: gdi ? PAL.gdiLight : PAL.nodLight,
      uniDk: gdi ? PAL.gdiDark : PAL.nodDark,
      uniSh: gdi ? PAL.gdiShadow : PAL.nodShadow,
      helm: gdi ? '#7c6c30' : '#4c4c58',
      helmHi: gdi ? '#a4904a' : '#6e6e80',
      helmDk: gdi ? '#544a1e' : '#32323c',
    };
  }

  function bgPanel(ctx, p) {
    ctx.fillStyle = p.bg;
    ctx.fillRect(1, 1, 62, 46);
    // soft radial glow behind the head (stacked rects)
    ctx.fillStyle = p.bgGlow;
    ctx.fillRect(8, 3, 48, 33);
    ctx.fillStyle = p.bgGlow2;
    ctx.fillRect(15, 5, 34, 29);
    // corner vignette dither
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let i = 0; i < 7; i++) {
      ctx.fillRect(1 + i, 1, 1, 7 - i);
      ctx.fillRect(62 - i, 1, 1, 7 - i);
    }
    // faction accent line under the top frame
    ctx.fillStyle = p.accent;
    ctx.fillRect(1, 1, 62, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(1, 2, 62, 1);
  }

  // Bare head: skull + face + eyes + nose + mouth. Headgear drawn by caller on top.
  function drawFace(ctx, o) {
    const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
    const skin = o.skin || SKIN, hi = o.skinHi || SKIN_HI, sh = o.skinSh || SKIN_SH, dk = o.skinDk || SKIN_DK;
    // skull rows
    R(27, 5, 10, 1, skin);
    R(25, 6, 14, 1, skin);
    R(24, 7, 16, 1, skin);
    R(23, 8, 18, 10, skin);
    R(24, 18, 16, 2, skin);
    R(25, 20, 14, 2, skin);
    R(27, 22, 10, 1, skin);
    R(29, 23, 6, 1, skin);
    // side shading (light source top-left)
    R(38, 8, 2, 10, sh); R(40, 8, 1, 10, dk);
    R(37, 18, 2, 2, sh); R(39, 18, 1, 2, dk);
    R(36, 20, 2, 2, sh);
    R(34, 22, 3, 1, sh);
    R(23, 8, 1, 9, hi); R(24, 7, 1, 2, hi);
    // ears
    if (!o.noEars) {
      R(21, 13, 2, 5, skin); R(21, 13, 1, 5, sh);
      R(41, 13, 2, 5, sh); R(42, 13, 1, 5, dk);
    }
    // brow line + eyes
    const browC = o.brow || '#5c3c26';
    R(26, 12, 5, 1, browC); R(33, 12, 5, 1, browC);
    R(26, 13, 5, 1, sh); R(33, 13, 5, 1, sh);
    R(26, 14, 4, 2, '#e0dcc8'); R(33, 14, 4, 2, '#d4d0bc');
    R(27, 14, 2, 2, o.eye || '#2c2418'); R(34, 14, 2, 2, o.eye || '#2c2418');
    // nose
    R(32, 14, 1, 4, sh);
    R(31, 18, 3, 1, sh);
    ctx.fillStyle = dk; ctx.fillRect(30, 18, 1, 1); ctx.fillRect(34, 18, 1, 1);
    // mouth
    R(29, 20, 7, 1, o.mouth || '#6e3c28');
    R(29, 21, 7, 1, sh);
    // cheek highlights
    R(26, 16, 2, 2, hi);
  }

  function drawNeckShoulders(ctx, p, o) {
    const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
    const skin = (o && o.skin) || SKIN, sh = (o && o.skinSh) || SKIN_SH;
    // neck
    R(28, 23, 8, 6, skin);
    R(34, 23, 2, 6, sh);
    R(28, 23, 8, 1, sh); // chin shadow
    // shoulders / chest
    R(20, 29, 24, 1, p.uni);
    R(16, 30, 32, 1, p.uni);
    R(13, 31, 38, 1, p.uni);
    R(11, 32, 42, 6, p.uni);
    // ramp
    R(11, 32, 6, 6, p.uniHi); R(13, 31, 4, 1, p.uniHi);
    R(45, 32, 8, 6, p.uniDk); R(43, 31, 8, 1, p.uniDk); R(40, 30, 8, 1, p.uniDk);
    // collar
    R(26, 29, 12, 2, p.uniSh);
  }

  function drawHelmetDome(ctx, p, opts) {
    const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
    const hm = (opts && opts.c) || p.helm, hmHi = (opts && opts.hi) || p.helmHi, hmDk = (opts && opts.dk) || p.helmDk;
    R(27, 2, 10, 1, hm);
    R(24, 3, 16, 1, hm);
    R(22, 4, 20, 2, hm);
    R(21, 6, 22, 4, hm);
    R(20, 10, 24, 2, hm);
    // ramp
    R(24, 3, 5, 1, hmHi); R(22, 4, 6, 2, hmHi); R(21, 6, 4, 3, hmHi);
    R(38, 4, 4, 2, hmDk); R(39, 6, 4, 4, hmDk); R(40, 10, 4, 2, hmDk);
    // rim + forehead shadow
    R(20, 11, 24, 1, hmDk);
    R(23, 12, 18, 1, 'rgba(0,0,0,0.30)');
  }

  function chinStrap(ctx, c) {
    const px = (x, y) => ctx.fillRect(x, y, 1, 1);
    ctx.fillStyle = c;
    px(23, 14); px(23, 15); px(24, 16); px(24, 17); px(25, 18); px(25, 19); px(26, 20);
  }

  function buildCameo(key) {
    const side = CAMEO_SIDE[key];
    const p = portraitPal(side);
    const name = (typeof DATA !== 'undefined' && DATA.units && DATA.units[key])
      ? DATA.units[key].name : key.toUpperCase();
    const c = mkCanvas(C.CAMEO_W, C.CAMEO_H);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const R = (x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); };

    bgPanel(ctx, p);

    switch (key) {
      case 'e1': { // Minigunner: faction helmet, chin strap, rifle sling
        drawNeckShoulders(ctx, p);
        R(18, 31, 5, 7, '#3a3226'); R(19, 31, 1, 7, '#55483a'); // rifle sling
        drawFace(ctx, {});
        drawHelmetDome(ctx, p, {});
        chinStrap(ctx, '#4a3a20');
        break;
      }
      case 'e2': { // Grenadier: helmet w/ net dots, grenade bandolier
        drawNeckShoulders(ctx, p);
        // bandolier across the chest with grenade nubs
        R(17, 30, 5, 2, '#3a3226'); R(21, 31, 5, 2, '#3a3226');
        R(25, 32, 5, 2, '#3a3226'); R(29, 33, 5, 2, '#3a3226');
        R(33, 34, 5, 2, '#3a3226'); R(37, 35, 5, 2, '#3a3226');
        R(22, 30, 2, 3, GRN); R(22, 30, 1, 1, GRN_HI);
        R(30, 32, 2, 3, GRN); R(30, 32, 1, 1, GRN_HI);
        R(38, 34, 2, 3, GRN); R(38, 34, 1, 1, GRN_HI);
        drawFace(ctx, {});
        drawHelmetDome(ctx, p, {});
        // camo-net dots on the helmet
        ctx.fillStyle = p.helmDk;
        ctx.fillRect(26, 5, 2, 1); ctx.fillRect(31, 7, 2, 1); ctx.fillRect(27, 9, 2, 1);
        ctx.fillRect(35, 5, 2, 1); ctx.fillRect(23, 7, 2, 1); ctx.fillRect(34, 9, 2, 1);
        chinStrap(ctx, '#4a3a20');
        break;
      }
      case 'e3': { // Rocket Soldier: launcher tube over the right shoulder
        // clean thick tube rising diagonally past the head
        for (let i = 0; i <= 13; i++) {
          const x = 42 + i, y = 33 - Math.round(i * 1.7);
          const band = (i === 10 || i === 11);
          R(x, y, 6, 3, band ? '#a03028' : TUBE);
          R(x, y, 6, 1, band ? '#c85040' : TUBE_HI);
          R(x + 4, y + 2, 2, 1, band ? '#701c12' : TUBE_DK);
        }
        R(55, 6, 7, 6, TUBE_DK); R(57, 8, 4, 3, '#141810'); // muzzle opening
        drawNeckShoulders(ctx, p);
        drawFace(ctx, {});
        drawHelmetDome(ctx, p, {});
        chinStrap(ctx, '#4a3a20');
        // shoulder strap pad
        R(41, 30, 9, 4, TUBE_DK); R(41, 30, 9, 1, TUBE);
        break;
      }
      case 'e4': { // Flamethrower: orange hood + gas mask, steel tank shoulder
        // shoulders in orange suit
        drawNeckShoulders(ctx, { uni: OR, uniHi: OR_HI, uniDk: OR_DK, uniSh: OR_SH }, {});
        // tank top peeking over the left shoulder
        R(12, 27, 8, 5, METAL_SH); R(12, 27, 3, 5, METAL); R(18, 27, 2, 5, METAL_DK);
        R(14, 25, 4, 2, METAL_DK);
        // hood: full head wrap in orange
        R(26, 2, 12, 2, OR);
        R(23, 4, 18, 2, OR);
        R(21, 6, 22, 6, OR);
        R(20, 12, 24, 12, OR);
        R(21, 24, 22, 4, OR);
        R(24, 28, 16, 2, OR);
        R(21, 4, 6, 4, OR_HI); R(20, 12, 3, 10, OR_HI);
        R(38, 6, 5, 6, OR_DK); R(40, 12, 4, 14, OR_DK); R(37, 24, 6, 4, OR_DK);
        // mask face plate
        R(25, 12, 14, 12, '#30343a');
        R(25, 12, 2, 12, '#484e56');
        // twin round lenses with glints
        R(26, 13, 5, 5, '#111418'); R(33, 13, 5, 5, '#111418');
        R(27, 14, 2, 2, '#7e8894'); R(34, 14, 2, 2, '#5c666e');
        R(28, 16, 1, 1, '#c8d2da');
        // snout filter
        R(29, 19, 6, 6, '#4a5058'); R(29, 19, 2, 6, '#646c76'); R(33, 19, 2, 6, '#33383e');
        R(30, 25, 4, 2, '#282c32');
        // hose from snout to tank
        R(27, 23, 2, 3, HOSE); R(24, 25, 3, 2, HOSE); R(20, 26, 4, 2, HOSE);
        break;
      }
      case 'e5': { // Chem Warrior: toxic green hazmat hood + wide visor
        drawNeckShoulders(ctx, { uni: GRSUIT, uniHi: GRSUIT_HI, uniDk: GRSUIT_DK, uniSh: GRSUIT_SH }, {});
        // chem tank over the shoulder
        R(44, 27, 8, 6, '#5c7a30'); R(44, 27, 3, 6, '#8aa848'); R(50, 27, 2, 6, '#3a4e1e');
        R(46, 25, 4, 2, '#3a4e1e');
        // hood
        R(26, 2, 12, 2, GRSUIT);
        R(23, 4, 18, 2, GRSUIT);
        R(21, 6, 22, 6, GRSUIT);
        R(20, 12, 24, 12, GRSUIT);
        R(21, 24, 22, 4, GRSUIT);
        R(24, 28, 16, 2, GRSUIT);
        R(21, 4, 6, 4, GRSUIT_HI); R(20, 12, 3, 10, GRSUIT_HI);
        R(38, 6, 5, 6, GRSUIT_DK); R(40, 12, 4, 14, GRSUIT_DK); R(37, 24, 6, 4, GRSUIT_DK);
        // wide single visor with toxic reflection
        R(24, 12, 16, 8, '#0f2a1c');
        R(24, 12, 16, 1, '#164030');
        R(26, 14, 4, 2, PAL.tib2); R(30, 16, 3, 2, PAL.tib1); R(25, 13, 2, 1, PAL.tib3);
        // breather box
        R(29, 22, 6, 5, GRSUIT_DK); R(30, 23, 4, 1, '#0f2a1c'); R(30, 25, 4, 1, '#0f2a1c');
        break;
      }
      case 'e6': { // Engineer: white hardhat, hi-vis vest
        drawNeckShoulders(ctx, p);
        // hi-vis vest panels over the shoulders
        R(11, 32, 14, 6, '#e07818'); R(11, 32, 4, 6, '#f8a038');
        R(39, 32, 14, 6, '#b05c10'); R(48, 32, 5, 6, '#8a4408');
        R(14, 33, 3, 5, '#e8e050'); R(46, 33, 3, 5, '#c8b838'); // reflective stripes
        drawFace(ctx, {});
        // white hardhat with brim
        drawHelmetDome(ctx, p, { c: '#dcd8ca', hi: '#fcfaf2', dk: '#a09c8c' });
        R(18, 10, 28, 2, '#dcd8ca'); R(18, 10, 6, 1, '#fcfaf2'); R(40, 10, 6, 2, '#a09c8c');
        R(18, 12, 28, 1, '#6e6a5e');
        R(30, 3, 4, 8, '#fcfaf2'); // ridge
        break;
      }
      case 'rmbo': { // Commando: red headband, stubble, bandolier
        drawNeckShoulders(ctx, { uni: '#3c3c36', uniHi: '#5a5a52', uniDk: '#262622', uniSh: '#1c1c18' }, {});
        // bandolier with brass rounds
        R(15, 30, 6, 3, '#2c2620'); R(20, 32, 6, 3, '#2c2620'); R(25, 34, 6, 3, '#2c2620');
        R(30, 36, 6, 2, '#2c2620');
        R(17, 31, 1, 2, '#c8a030'); R(22, 33, 1, 2, '#c8a030'); R(27, 35, 1, 2, '#c8a030');
        // dog tags
        R(31, 30, 2, 4, METAL_SH); R(31, 33, 3, 2, METAL);
        drawFace(ctx, { brow: '#241f16', eye: '#1c140c' });
        // stubble dither on the jaw
        ctx.fillStyle = 'rgba(40,30,20,0.55)';
        for (let y = 19; y <= 22; y++) for (let x = 25 + (y & 1); x < 38; x += 2) ctx.fillRect(x, y, 1, 1);
        R(29, 20, 7, 1, '#5c3324'); // redraw mouth over stubble
        // dark hair
        R(26, 2, 12, 2, '#26211a');
        R(23, 4, 18, 2, '#26211a');
        R(22, 6, 20, 3, '#26211a');
        R(24, 4, 5, 2, '#3c352a');
        R(21, 9, 3, 6, '#26211a'); R(40, 9, 3, 6, '#1a1712'); // sideburns
        // red headband with trailing knot
        R(22, 9, 20, 3, '#cc2c1c');
        R(22, 9, 6, 1, '#f05540'); R(38, 10, 4, 2, '#8a1c10');
        R(42, 10, 3, 2, '#cc2c1c'); R(44, 12, 2, 4, '#8a1c10'); // knot tails
        // scar over the left cheek
        R(26, 15, 1, 4, '#8a5038');
        break;
      }
    }

    // gold bottom stripe with the unit name (kept exactly as the sidebar expects)
    ctx.fillStyle = PAL.uiGold;
    ctx.fillRect(1, 38, 62, 9);
    ctx.fillStyle = '#a8842c';
    ctx.fillRect(1, 38, 62, 1);
    ctx.fillStyle = '#1c1608';
    ctx.font = '7px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 32, 43, 60);

    // 1px black frame
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, C.CAMEO_W, 1);
    ctx.fillRect(0, C.CAMEO_H - 1, C.CAMEO_W, 1);
    ctx.fillRect(0, 0, 1, C.CAMEO_H);
    ctx.fillRect(C.CAMEO_W - 1, 0, 1, C.CAMEO_H);
    return c;
  }

  // ---- build everything at load time ------------------------------------------

  for (const key of INF_KEYS) {
    SPRITES.infantry[key] = {
      gdi: buildSet(makeCfg(key, 'gdi')),
      nod: buildSet(makeCfg(key, 'nod')),
    };
    SPRITES.cameo[key] = buildCameo(key);
  }
})();
