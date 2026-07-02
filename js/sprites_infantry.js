'use strict';
// sprites_infantry.js — procedurally drawn infantry sprites + cameos.
// Fills SPRITES.infantry[key][side] for e1,e2,e3,e4,e5,e6,rmbo (both sides) with
// { stand:[8], walk:[8][4], fire:[8][2], die:[4] } 24x24 canvases, and
// SPRITES.cameo[key] 64x48 portrait icons. Original pixel art, C&C-95 style.
// Facing index 0 = N, 1 = NE, ... clockwise (unit facing16 >> 1).

(function () {
  // Defensive boot guards: needs DOM canvases and the core registry.
  if (typeof document === 'undefined') return;
  if (typeof SPRITES === 'undefined' || typeof PAL === 'undefined' ||
      typeof C === 'undefined' || typeof mkCanvas === 'undefined') return;

  // 8-facing unit direction vectors, index 0 = N (up), clockwise.
  const DIR8 = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

  const SKIN = '#d8a878';
  const BOOT = '#1a1a12';
  const GUNC = '#26261e';
  const TUBEC = '#3c4438';
  const GRENADE = '#33402a';

  const INF_KEYS = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'rmbo'];

  // ---- per type+side figure configuration -----------------------------------

  function makeCfg(type, side) {
    const gdi = side === 'gdi';
    const cfg = {
      type,
      uniform: gdi ? PAL.gdi : PAL.nod,
      uniformDark: gdi ? PAL.gdiDark : PAL.nodDark,
      pants: gdi ? PAL.gdiDark : PAL.nodShadow,
      belt: gdi ? PAL.gdiShadow : PAL.nodShadow,
      helmet: gdi ? '#6e5c26' : '#42424e',
      face: SKIN,
      arm: gdi ? PAL.gdiDark : PAL.nodDark,
      chest: gdi ? PAL.gdiLight : PAL.nodRed, // 1px chest strap/emblem accent
      weapon: 'rifle',    // 'rifle' | 'tube' | 'nozzle' | 'throw' | 'none'
      gunLen: 3,
      pack: null,         // backpack / tank colors
      packLight: null,
      toolbox: false,
      jet: null,          // 3 flame-jet colors used in fire pose
      backblast: false,   // rocket launcher smoke puff behind tube
    };
    switch (type) {
      case 'e2': // Grenadier: backpack hump, throws in fire frames
        cfg.weapon = 'throw';
        cfg.pack = gdi ? '#7a6636' : '#4c4c56';
        cfg.packLight = gdi ? '#9c8650' : '#6a6a74';
        break;
      case 'e3': // Rocket Soldier: tube on the shoulder
        cfg.weapon = 'tube';
        cfg.gunLen = 4;
        cfg.backblast = true;
        break;
      case 'e4': // Flamethrower: orange back tanks (both sides) + nozzle
        cfg.weapon = 'nozzle';
        cfg.gunLen = 2;
        cfg.pack = '#d87018';
        cfg.packLight = '#f8a038';
        cfg.jet = [PAL.fire1, PAL.fire2, PAL.fire3];
        break;
      case 'e5': // Chem Warrior: bright green suit, sprayer, green jet
        cfg.uniform = '#38b83c';
        cfg.uniformDark = '#1f7c26';
        cfg.pants = '#1f7c26';
        cfg.belt = '#146018';
        cfg.helmet = '#2a9c30';
        cfg.face = '#14301c'; // dark visor
        cfg.arm = '#2a9c30';
        cfg.chest = null;
        cfg.weapon = 'nozzle';
        cfg.gunLen = 2;
        cfg.pack = '#d87018';
        cfg.packLight = '#f8a038';
        cfg.jet = [PAL.tib3, PAL.tib2, PAL.tib1];
        break;
      case 'e6': // Engineer: white hardhat, no weapon, toolbox
        cfg.weapon = 'none';
        cfg.toolbox = true;
        cfg.helmet = '#ece8dc';
        break;
      case 'rmbo': // Commando: dark uniform, skin arms, red headband
        cfg.uniform = gdi ? '#4a4634' : '#3a3a40';
        cfg.uniformDark = gdi ? '#332f20' : '#26262c';
        cfg.pants = cfg.uniformDark;
        cfg.belt = '#1c1c14';
        cfg.helmet = '#d02c1c'; // headband
        cfg.arm = SKIN;
        cfg.chest = null;
        break;
    }
    return cfg;
  }

  // ---- figure drawing --------------------------------------------------------

  function drawPack(ctx, f, cfg, bob) {
    const bdx = DIR8[(f + 4) & 7][0];
    const x = 11 + bdx;
    ctx.fillStyle = cfg.pack;
    ctx.fillRect(x, 13 + bob, 2, 3);
    ctx.fillStyle = cfg.packLight;
    ctx.fillRect(x, 13 + bob, 1, 1);
  }

  function drawToolbox(ctx, f, bob) {
    const dx = DIR8[f][0];
    const pdx = DIR8[(f + 2) & 7][0];
    const bx = 12 + dx * 2 + pdx; // carried at the hand side
    ctx.fillStyle = '#b8bcc4';
    ctx.fillRect(bx - 1, 16 + bob, 3, 2);
    ctx.fillStyle = '#2a2a30';
    ctx.fillRect(bx, 15 + bob, 1, 1); // handle
  }

  function drawWeapon(ctx, f, pose, frame, cfg, bob) {
    if (cfg.weapon === 'none') return;
    const dx = DIR8[f][0], dy = DIR8[f][1];
    const pdx = DIR8[(f + 2) & 7][0], pdy = DIR8[(f + 2) & 7][1];
    const px = (x, y, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); };

    if (cfg.weapon === 'throw') {
      // Grenadier keeps hands free; throwing pose only in fire frames.
      if (pose !== 'fire') return;
      if (frame === 0) {
        // wind-up: arm raised back, grenade in hand
        const bdx = DIR8[(f + 4) & 7][0];
        px(12 + bdx, 12 + bob, cfg.arm);
        px(12 + bdx * 2, 11 + bob, GRENADE);
      } else {
        // release: arm extended, grenade flying out, tiny hand flash
        px(12 + dx * 2, 13 + bob, cfg.arm);
        px(12 + dx * 3, 12 + dy * 2 + bob, GRENADE);
        px(12 + dx * 2, 12 + dy + bob, PAL.fire1);
      }
      return;
    }

    // weapon stick along the facing dir, offset to the figure's right side
    let sx, sy;
    const len = cfg.gunLen;
    if (cfg.weapon === 'tube') { // shoulder height
      sx = 12 + dx + pdx;
      sy = 12 + dy + pdy + bob;
    } else {                     // hip/chest height
      sx = 12 + dx * 2 + pdx;
      sy = 15 + dy + pdy + bob;
    }
    const col = cfg.weapon === 'tube' ? TUBEC : GUNC;
    for (let i = 0; i < len; i++) px(sx + dx * i, sy + dy * i, col);
    if (cfg.weapon === 'tube') px(sx + dx * (len - 1), sy + dy * (len - 1), '#5a6450');

    if (pose === 'fire') {
      const tx = sx + dx * len, ty = sy + dy * len;
      if (cfg.jet) {
        // flame / chem spray jet
        const j = cfg.jet;
        if (frame === 0) {
          px(tx, ty, j[0]);
          px(tx + dx, ty + dy, j[1]);
        } else {
          px(tx, ty, j[1]);
          px(tx + dx, ty + dy, j[2]);
          px(tx + dx * 2, ty + dy * 2, j[2]);
        }
      } else {
        // 1px muzzle flash at the gun tip
        px(tx, ty, frame === 0 ? PAL.fire1 : PAL.fire2);
        if (cfg.backblast && frame === 0) px(sx - dx, sy - dy, PAL.smoke);
      }
    }
  }

  // pose: 'stand' | 'walk' | 'fire'
  function drawFigure(ctx, f, pose, frame, cfg) {
    const dx = DIR8[f][0], dy = DIR8[f][1];
    const bob = (pose === 'walk' && (frame & 1)) ? 1 : 0;
    const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };

    // ground shadow ellipse
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.fillRect(9, 21, 6, 1);
    ctx.fillRect(10, 22, 4, 1);

    // hand weapons sit behind the body when the figure faces away from camera
    const weaponBehind = dy < 0 && cfg.weapon !== 'tube';
    if (weaponBehind) drawWeapon(ctx, f, pose, frame, cfg, bob);

    // back gear is hidden behind the torso when facing the camera
    const packVisible = cfg.pack && dy <= 0;
    if (cfg.pack && !packVisible) drawPack(ctx, f, cfg, bob);

    // legs: rows 18..21, alternate lift in walk frames
    const step = pose === 'walk' ? [1, 0, -1, 0][frame] : 0;
    const liftL = step > 0 ? 1 : 0, liftR = step < 0 ? 1 : 0;
    const lx = 10 + (liftL ? dx : 0), rx = 12 + (liftR ? dx : 0);
    R(lx, 18, 2, 3 - liftL, cfg.pants);
    R(lx, 21 - liftL, 2, 1, BOOT);
    R(rx, 18, 2, 3 - liftR, cfg.pants);
    R(rx, 21 - liftR, 2, 1, BOOT);

    // torso with right-side shade and belt
    R(10, 13 + bob, 4, 5, cfg.uniform);
    R(13, 13 + bob, 1, 5, cfg.uniformDark);
    R(10, 16 + bob, 4, 1, cfg.belt);
    if (cfg.chest && dy >= 0) R(11, 14 + bob, 1, 1, cfg.chest);

    if (packVisible) drawPack(ctx, f, cfg, bob);

    // arms
    R(9, 14 + bob, 1, 2, cfg.arm);
    R(14, 14 + bob, 1, 2, cfg.arm);

    // 2px head: helmet row + face row (back of helmet when facing away)
    R(11, 11 + bob, 2, 1, cfg.helmet);
    R(11, 12 + bob, 2, 1, dy >= 0 ? cfg.face : cfg.helmet);

    if (!weaponBehind) drawWeapon(ctx, f, pose, frame, cfg, bob);
    if (cfg.toolbox) drawToolbox(ctx, f, bob);
  }

  // die frames shared across facings: tip over and flatten into a dark heap
  function drawDie(ctx, frame, cfg) {
    const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    if (frame < 2) { ctx.fillRect(9, 21, 6, 1); ctx.fillRect(10, 22, 4, 1); }
    else ctx.fillRect(7, 21, 10, 2);

    if (frame === 0) {
      // knees buckle, torso tips back, arms flail
      R(10, 19, 4, 2, cfg.pants);
      R(10, 21, 4, 1, BOOT);
      R(10, 16, 4, 3, cfg.uniform);
      R(11, 14, 4, 2, cfg.uniform);
      R(14, 14, 1, 2, cfg.uniformDark);
      R(13, 12, 2, 1, cfg.helmet);
      R(13, 13, 2, 1, cfg.face);
      R(9, 16, 1, 1, cfg.arm);
      R(16, 15, 1, 1, cfg.arm);
    } else if (frame === 1) {
      // falling sideways, half down
      R(13, 19, 3, 2, cfg.pants);
      R(16, 20, 2, 1, BOOT);
      R(9, 17, 5, 3, cfg.uniform);
      R(9, 19, 5, 1, cfg.uniformDark);
      R(7, 17, 2, 1, cfg.helmet);
      R(7, 18, 2, 1, cfg.face);
      R(11, 15, 1, 1, cfg.arm);
    } else if (frame === 2) {
      // prone, stretched out flat
      R(8, 19, 9, 1, cfg.uniform);
      R(8, 20, 9, 1, cfg.uniformDark);
      R(6, 19, 2, 1, cfg.helmet);
      R(6, 20, 2, 1, cfg.face);
      R(16, 20, 2, 1, BOOT);
      R(17, 19, 1, 1, cfg.pants);
    } else {
      // dark flattened heap
      R(8, 20, 9, 2, '#26241a');
      R(9, 20, 2, 1, cfg.uniformDark);
      R(13, 20, 2, 1, cfg.uniformDark);
      R(7, 21, 1, 1, cfg.helmet);
    }
  }

  // ---- sprite set + cameo builders --------------------------------------------

  function renderFrame(f, pose, frame, cfg) {
    const c = mkCanvas(24, 24);
    drawFigure(c.getContext('2d'), f, pose, frame, cfg);
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
    for (let k = 0; k < 4; k++) {
      const c = mkCanvas(24, 24);
      drawDie(c.getContext('2d'), k, cfg);
      die.push(c);
    }
    return { stand, walk, fire, die };
  }

  // side used for the shared cameo portrait (matches the faction that fields it)
  const CAMEO_SIDE = { e1: 'gdi', e2: 'gdi', e3: 'gdi', e4: 'nod', e5: 'nod', e6: 'gdi', rmbo: 'gdi' };

  function buildCameo(key) {
    const cfg = makeCfg(key, CAMEO_SIDE[key]);
    const name = (typeof DATA !== 'undefined' && DATA.units && DATA.units[key])
      ? DATA.units[key].name : key.toUpperCase();
    const c = mkCanvas(C.CAMEO_W, C.CAMEO_H);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    // dark slate background, inner panel with faint scanlines
    ctx.fillStyle = PAL.cameoBg;
    ctx.fillRect(0, 0, C.CAMEO_W, C.CAMEO_H);
    ctx.fillStyle = '#2c2c26';
    ctx.fillRect(6, 3, 52, 34);
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    for (let y = 3; y < 37; y += 4) ctx.fillRect(6, y, 52, 2);

    // figure (east-facing stand pose) at 3x nearest-neighbour
    const t = mkCanvas(24, 24);
    drawFigure(t.getContext('2d'), 2, 'stand', 0, cfg);
    ctx.drawImage(t, 6, 10, 12, 12, 14, 1, 36, 36);

    // gold bottom stripe with the unit name
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
