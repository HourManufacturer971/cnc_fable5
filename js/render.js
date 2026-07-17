'use strict';
// render.js — draws the whole 1280x800 frame: viewport, tab bar, sidebar,
// radar, cursor. Global: Render.
//
// HI-RES MODE: the simulation runs in world px (24/cell) but the display maps
// world -> screen at C.ZOOM (48 screen px per cell). Sprites flagged `_hires`
// (from the pre-rendered pipeline) draw at native size; everything else is
// authored at 24px/cell and drawn scaled 2x with nearest-neighbour sampling.

const Render = (function () {
  const Z = C.ZOOM;
  let cv = null, ctx = null;
  let terrainCache = null;      // full-map prerender at screen scale
  let terrainCacheSeed = -1;
  let animCells = [];           // water/blossom cells redrawn live
  let minimap = null, minimapTick = -10;
  let creditsShown = 0;
  let shownTick = -1, shakeX = 0, shakeY = 0;
  let evaMsg = null;            // {text, born} — HUD announcement banner
  let evaWired = false;
  let vignette = null, vigW = 0, vigH = 0;   // cached radial vignette gradient
  let grainPat = null;                        // cached film-grain pattern
  // replay spectator vision: draw the whole battle unfogged. Render-only —
  // g.shroud still evolves exactly as it did live (the sim reads it), we
  // just stop hiding things behind it while a replay plays.
  let seeAll = false;
  // endgame reveal: once every enemy building is rubble, their surviving
  // units show everywhere — no shroud-crawl for the last stragglers.
  // Recomputed per frame; SP only (in MP g.ai is the remote human).
  let revealAll = false;

  function _computeRevealAll(g) {
    if (!g.ai || (typeof NET !== 'undefined' && NET.active)) return false;
    for (const id of g.ai.buildingIds) {
      const b = g.buildings.get(id);
      if (b && !DATA.buildings[b.type].wall) return false;
    }
    return true;
  }

  // classic shroud rule for units: anything on EXPLORED ground shows (the
  // black shroud hides the rest). The endgame reveal and the replay
  // spectator bypass even that.
  function _unitSeen(g, u) {
    if (seeAll || u.owner === g.humanSide) return true;
    if (revealAll && u.owner === g.ai.side) return true;
    const cx = worldToCell(u.x), cy = worldToCell(u.y);
    return inMap(cx, cy) && g.shroud[cellIdx(cx, cy)] === 1;
  }

  // render-local gate state memory for the servo sound
  const _gateWas = new Map();
  function _maybeGateSnd(g, x, y) {
    const m = 4 * C.CELL;
    if (x >= g.camera.x - m && x <= g.camera.x + C.VIEW_W + m &&
        y >= g.camera.y - m && y <= g.camera.y + C.VIEW_H + m) AUDIO.play('gate');
  }

  // one-time newcomer nudge toward the controls reference (localStorage-gated)
  let f1Tip = null;
  function _drawF1Tip(g) {
    if (typeof NET !== 'undefined' && NET.active) return;
    if (typeof REPLAY !== 'undefined' && REPLAY.playing) return;
    if (g.status !== 'playing') return;
    if (f1Tip === null) {
      try { f1Tip = localStorage.getItem('hw_tip_f1') ? 0 : 1; } catch (e) { f1Tip = 0; }
    }
    if (!f1Tip) return;
    if (g.tick >= 320) {
      f1Tip = 0;
      try { localStorage.setItem('hw_tip_f1', '1'); } catch (e) { /* memory only */ }
      return;
    }
    if (g.tick < 90) return;
    const s = fineTip ? 'New here?  F1 opens the controls reference'
      : 'New here?  The controls reference lives in the Options menu';
    ctx.font = '14px monospace';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(s).width;
    const bx = C.VIEW_PW / 2 - tw / 2 - 10, by = C.TAB_H + 44;
    const a = g.tick < 105 ? (g.tick - 90) / 15 : g.tick > 300 ? (320 - g.tick) / 20 : 1;
    ctx.globalAlpha = Math.max(0, Math.min(1, a));
    ctx.fillStyle = 'rgba(8,14,10,0.75)';
    ctx.fillRect(bx, by, tw + 20, 24);
    ctx.strokeStyle = 'rgba(224,184,64,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, tw + 19, 23);
    ctx.fillStyle = '#c8c0a0';
    ctx.fillText(s, bx + 10, by + 13);
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'alphabetic';
  }

  function _nowMs() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  function init(canvas) {
    cv = canvas;
    ctx = canvas.getContext('2d');
    resize();
    // the canvas CSS box tracks the window, so the backing store must too
    if (typeof window !== 'undefined') window.addEventListener('resize', resize);
    minimap = mkCanvas(C.MM_S, C.MM_S);
    // show every EVA announcement as readable text (the synthesized voice is
    // flavor; the words live here). Wire once — EV is a session singleton.
    if (!evaWired && typeof EV !== 'undefined' && EV) {
      evaWired = true;
      EV.on('eva', function (text) { evaMsg = { text: String(text), born: _nowMs() }; });
    }
  }

  // Match the canvas backing store to the device pixels its CSS box actually
  // covers (capped at 2x logical). Text and HUD hairlines then rasterize at
  // native resolution instead of being resampled by the browser — resampling
  // at non-integer window scales is what made HUD text fuzzy. Sprites still
  // blit nearest-neighbour through the logical->device transform, keeping
  // their hard pixel-art edges. Every draw call stays in logical C.SCREEN
  // coordinates; the transform is baked here (and re-baked after any bitmap
  // resize, which resets all 2d context state).
  let dscale = 1;
  function resize() {
    if (!cv) return;
    let s = 1;
    if (cv.getBoundingClientRect) {
      const rect = cv.getBoundingClientRect();
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      if (rect.width > 0) s = rect.width * dpr / C.SCREEN_W;
    }
    if (!isFinite(s) || s <= 0) s = 1;
    s = Math.min(s, 2);
    const bw = Math.max(1, Math.round(C.SCREEN_W * s));
    const bh = Math.max(1, Math.round(C.SCREEN_H * s));
    if (cv.width !== bw) cv.width = bw;
    if (cv.height !== bh) cv.height = bh;
    dscale = bw / C.SCREEN_W;
    ctx.setTransform(dscale, 0, 0, dscale, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  // scale factor for a sprite canvas (pre-rendered assets are already hi-res;
  // a few units carry a _scaleBoost to visibly outsize their footprint)
  function sca(img) { return img._hires ? 1 : Z * (img._scaleBoost || 1); }

  // draw a sprite at SCREEN coords (top-left)
  function drawSpr(img, sx, sy) {
    const s = sca(img);
    ctx.drawImage(img, sx, sy, img.width * s, img.height * s);
  }

  // ---- coordinate helpers ------------------------------------------------------

  function worldFromScreen(x, y) {
    if (!game || x < 0 || x >= C.VIEW_PW || y < C.TAB_H || y >= C.SCREEN_H) return null;
    return { x: x / Z + game.camera.x, y: (y - C.TAB_H) / Z + game.camera.y };
  }

  function hitTest(x, y) {
    if (y < C.TAB_H) {
      if (x < 120) return { zone: 'tab-options' };
      if (game && x >= C.GROUP_X && x < C.GROUP_X + C.GROUP_N * C.GROUP_SPACING) {
        const i = ((x - C.GROUP_X) / C.GROUP_SPACING) | 0;
        if (x - (C.GROUP_X + i * C.GROUP_SPACING) < C.GROUP_W) return { zone: 'tab-group', n: i + 1 };
      }
      if (game && _idleHarvCount(game) > 0 &&
          x >= C.VIEW_PW - 360 && x < C.VIEW_PW - 236) return { zone: 'idle-harv' };
      return { zone: 'tab' };
    }
    if (x < C.VIEW_PW) return { zone: 'viewport' };
    if (x >= C.RADAR_X && y >= C.RADAR_Y && y < C.RADAR_Y + C.RADAR_H) return { zone: 'radar' };
    if (y >= C.BTN_Y && y < C.BTN_Y + C.BTN_H) {
      const b0 = C.SIDEBAR_X + 8;
      if (x >= b0 && x < b0 + 96) return { zone: 'btn', which: 'repair' };
      if (x >= b0 + 104 && x < b0 + 200) return { zone: 'btn', which: 'sell' };
      if (x >= b0 + 208 && x < b0 + 304) return { zone: 'btn', which: 'map' };
      return { zone: 'sidebar' };
    }
    if (game && game.human) {
      const it = Production.items(game.human);
      for (const strip of ['b', 'u']) {
        const sx = strip === 'b' ? C.STRIP_BX : C.STRIP_UX;
        if (x < sx || x >= sx + C.CAMEO_PW) continue;
        // scroll arrows below the 4 visible icons
        const ay = C.STRIP_Y + C.STRIP_VISIBLE * C.STRIP_SPACING;
        if (y >= ay && y < ay + 24) {
          return { zone: 'arrow', strip, dir: x < sx + C.CAMEO_PW / 2 ? -1 : 1 };
        }
        const list = strip === 'b' ? it.buildings : it.units;
        for (let i = 0; i < C.STRIP_VISIBLE; i++) {
          const iy = C.STRIP_Y + i * C.STRIP_SPACING;
          if (y >= iy && y < iy + C.CAMEO_PH) {
            const item = list[game.human.scroll[strip] + i];
            if (item) return { zone: 'icon', strip, key: item.key, state: item.state, super: !!item.super, count: item.count || 0 };
          }
        }
      }
    }
    return { zone: 'sidebar' };
  }

  // ---- terrain cache -------------------------------------------------------------

  function _buildTerrainCache(g) {
    if (typeof TERRAINPAINT !== 'undefined') {
      // continuous painter: seamless noise-blended ground + transparent
      // overlay frames for the animated bits (blossom pods, water glints)
      const res = TERRAINPAINT.build(g);
      terrainCache = res.canvas;
      animCells = res.anim;
      terrainCacheSeed = g.seed;
      _buildMinimapBase();
      return;
    }
    // fallback: classic per-cell tile blits
    const cs = C.CELL * Z;
    terrainCache = mkCanvas(C.MAP_W * cs, C.MAP_H * cs);
    const tc = terrainCache.getContext('2d');
    tc.imageSmoothingEnabled = false;
    animCells = [];
    for (let cy = 0; cy < C.MAP_H; cy++) {
      for (let cx = 0; cx < C.MAP_W; cx++) {
        const i = cellIdx(cx, cy);
        const t = g.terrain[i];
        const variants = SPRITES.terrain[t] || SPRITES.terrain[0];
        if (!variants || !variants.length) continue;
        const img = variants[g.tvar[i] % variants.length];
        tc.drawImage(img, cx * cs, cy * cs, cs, cs);
        if (t === 3 || t === 5) animCells.push({ cx, cy, frames: variants, phase: cx });
      }
    }
    terrainCacheSeed = g.seed;
    _buildMinimapBase();
  }

  // ---- minimap ---------------------------------------------------------------------
  // Three layers, refreshed at different rates so the picture is faithful AND
  // the blips are live:
  //   minimapBase   — the painted terrain downscaled once per map: the radar
  //                   shows the actual world, not flat proxy colors
  //   minimap       — base + shroud + tiberium, refreshed every 8 ticks
  //                   (fog and fields change slowly)
  //   entity blips  — drawn straight to the frame EVERY frame from live
  //                   world coordinates, so movement is real-time and smooth

  const OWNER_COLOR = { gdi: '#ffd23c', nod: '#ff2418', mut: '#4ce03c', civ: '#e8e6da' };
  const MMC = C.MM_S / C.MAP_W;   // minimap px per cell
  let minimapBase = null;

  function _buildMinimapBase() {
    minimapBase = mkCanvas(C.MM_S, C.MM_S);
    const mc = minimapBase.getContext('2d');
    mc.imageSmoothingEnabled = true;
    mc.imageSmoothingQuality = 'high';
    mc.drawImage(terrainCache, 0, 0, C.MM_S, C.MM_S);
  }

  function _updateMinimap(g) {
    const mc = minimap.getContext('2d');
    if (minimapBase) mc.drawImage(minimapBase, 0, 0);
    else { mc.fillStyle = '#000'; mc.fillRect(0, 0, C.MM_S, C.MM_S); }
    for (let cy = 0; cy < C.MAP_H; cy++) {
      for (let cx = 0; cx < C.MAP_W; cx++) {
        const i = cellIdx(cx, cy);
        if ((seeAll || g.shroud[i] === 1) && g.tib[i] > 0) {
          mc.fillStyle = (g.tibType && g.tibType[i] === 1) ? '#3c8ce0' : PAL.tib2;
          mc.fillRect(cx * MMC, cy * MMC, MMC, MMC);
        }
      }
    }
    if (!seeAll) {
      const vis = g.visible;
      // explored terrain outside anyone's current sight goes grey — the map
      // remembers the ground, not what's happening on it
      mc.fillStyle = 'rgba(28,30,26,0.55)';
      for (let cy = 0; cy < C.MAP_H; cy++) {
        for (let cx = 0; cx < C.MAP_W; cx++) {
          const i = cellIdx(cx, cy);
          if (g.shroud[i] === 1 && (!vis || vis[i] !== 1)) mc.fillRect(cx * MMC, cy * MMC, MMC, MMC);
        }
      }
      // rim the live-sight region: the ring inside which enemy blips appear
      if (vis) {
        mc.fillStyle = 'rgba(150,200,140,0.5)';
        for (let cy = 0; cy < C.MAP_H; cy++) {
          for (let cx = 0; cx < C.MAP_W; cx++) {
            if (vis[cellIdx(cx, cy)] !== 1) continue;
            if ((cx > 0 && vis[cellIdx(cx - 1, cy)] !== 1) ||
                (cx < C.MAP_W - 1 && vis[cellIdx(cx + 1, cy)] !== 1) ||
                (cy > 0 && vis[cellIdx(cx, cy - 1)] !== 1) ||
                (cy < C.MAP_H - 1 && vis[cellIdx(cx, cy + 1)] !== 1)) {
              mc.fillRect(cx * MMC, cy * MMC, MMC, MMC);
            }
          }
        }
      }
      mc.fillStyle = '#000';
      for (let cy = 0; cy < C.MAP_H; cy++) {
        for (let cx = 0; cx < C.MAP_W; cx++) {
          if (g.shroud[cellIdx(cx, cy)] !== 1) mc.fillRect(cx * MMC, cy * MMC, MMC, MMC);
        }
      }
    }
  }

  // endgame assist: when the enemy is down to a few structures and fields no
  // combat units, the radar gives up their positions so the finale isn't a
  // hunt through black shroud
  function _huntCount(g) {
    if (!g.ai) return 0;
    // never against a human opponent: in MP g.ai is the remote player and
    // revealing their last hidden buildings through shroud would be a fog cheat
    if (typeof NET !== 'undefined' && NET.active) return 0;
    let bld = 0;
    for (const b of g.buildings.values()) {
      if (b.owner === g.ai.side && !DATA.buildings[b.type].wall) {
        if (++bld > 3) return 0;
      }
    }
    // victory needs every unit dead too (harvesters, MCVs, engineers…), so
    // stragglers count as targets — otherwise the chip vanishes with the
    // last building while an unarmed unit hides the win in the shroud
    let stragglers = 0;
    for (const u of g.units.values()) {
      if (u.owner !== g.ai.side) continue;
      const d = DATA.units[u.type];
      if (d.weapon && !d.harvester) return 0;   // still fields an army: no assist
      stragglers++;
    }
    return bld + stragglers;
  }

  // live blips, drawn every frame directly onto the composed frame
  function _drawRadarBlips(g) {
    const hunt = _huntCount(g) > 0;
    for (const b of g.buildings.values()) {
      if (!seeAll && !hunt && g.shroud[cellIdx(b.cx, b.cy)] !== 1) continue;
      if (!seeAll && hunt && b.owner !== g.ai.side && g.shroud[cellIdx(b.cx, b.cy)] !== 1) continue;
      ctx.fillStyle = OWNER_COLOR[b.owner] || '#ccc';
      ctx.fillRect(C.MM_X + b.cx * MMC, C.MM_Y + b.cy * MMC, b.w * MMC, b.h * MMC);
    }
    // crates blink white where explored
    if (g.crates && ((g.tick >> 3) & 1)) {
      ctx.fillStyle = '#fff';
      for (const c of g.crates) {
        if (seeAll || g.shroud[cellIdx(c.cx, c.cy)] === 1) ctx.fillRect(C.MM_X + c.cx * MMC, C.MM_Y + c.cy * MMC, MMC, MMC);
      }
    }
    // escort beacon on the radar: a blinking gold marker at the goal
    const obE = g.mission && g.mission.objective;
    if (obE && obE.type === 'escort' && g.status === 'playing' && ((g.tick >> 3) & 1)) {
      const d = obE.dest === 'ai' ? g.startPos.ai : obE.dest;
      ctx.fillStyle = '#ffe28a';
      ctx.fillRect(C.MM_X + d.cx * MMC - 1, C.MM_Y + d.cy * MMC - 1, MMC + 2, MMC + 2);
    }

    // alert pings: expanding rings for ~6s (Space jumps to the newest)
    if (g._pings) {
      for (const p2 of g._pings) {
        const age = g.tick - p2.tick;
        if (age > 90 || age < 0) continue;
        const mx = C.MM_X + (p2.x / C.CELL) * MMC, my = C.MM_Y + (p2.y / C.CELL) * MMC;
        ctx.strokeStyle = p2.kind === 'strike' ? '#ff4030' : p2.kind === 'harv' ? '#ffd23c' : '#ff8040';
        ctx.globalAlpha = 1 - age / 90;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(mx, my, 3 + ((age % 30) / 30) * 9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    for (const u of g.units.values()) {
      const cx = worldToCell(u.x), cy = worldToCell(u.y);
      const i = cellIdx(cx, cy);
      const revealed = seeAll || ((hunt || revealAll) && u.owner === g.ai.side);
      if (!revealed) {
        if (g.shroud[i] !== 1) continue;
        if (u.owner !== g.humanSide) {
          // enemy blips only where MY forces can currently see, not just explored
          if (!g.visible || g.visible[i] !== 1) continue;
          if (u.cloaked) continue;
        }
      }
      // sub-cell world position: blips glide instead of stepping cell to cell
      const mx = C.MM_X + (u.x / C.CELL) * MMC, my = C.MM_Y + (u.y / C.CELL) * MMC;
      ctx.fillStyle = OWNER_COLOR[u.owner] || '#ccc';
      ctx.fillRect(Math.round(mx - MMC / 2), Math.round(my - MMC / 2), MMC, MMC);
    }
  }

  // ---- entity drawing -----------------------------------------------------------------

  // tiny stateless hash in [0,1) for per-frame glitter effects
  function _gl(a, b, c) {
    let h = (a * 374761393 + b * 668265263 + c * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function _healthColor(frac) {
    return frac > 2 / 3 ? PAL.uiGreen : frac > 1 / 3 ? '#d8c020' : PAL.uiRed;
  }

  function _drawHealthBar(x, y, w, frac) {
    ctx.fillStyle = '#000';
    ctx.fillRect(x, y, w, 8);
    ctx.fillStyle = _healthColor(frac);
    ctx.fillRect(x + 2, y + 2, Math.max(2, Math.round((w - 4) * frac)), 4);
  }

  // idle own harvesters — a stalled economy the player should know about
  function _idleHarvCount(g) {
    let n = 0;
    for (const id of g.human.unitIds) {
      const u = g.units.get(id);
      if (u && !u._dead && DATA.units[u.type].harvester && u.state === 'idle') n++;
    }
    return n;
  }

  // wrench blink over a vehicle the repair pad is healing
  function _drawWrench(g, u, X, Y) {
    if (u._fixT === undefined || g.tick - u._fixT >= 4 || ((g.tick >> 2) & 1)) return;
    const x = Math.round(X(u.x)) - 14, y = Math.round(Y(u.y)) - 18;
    ctx.strokeStyle = '#f8d848';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x - 3, y + 3); ctx.lineTo(x + 4, y - 4); ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x - 4, y + 4, 3, -0.6, 2.2); ctx.stroke();
    ctx.beginPath(); ctx.arc(x + 5, y - 5, 3, 2.5, 5.3); ctx.stroke();
  }

  // veterancy chevrons beside the unit (gold at elite)
  function _drawRank(u, X, Y) {
    const lvl = typeof vetLevel !== 'undefined' ? vetLevel(u) : 0;
    if (!lvl) return;
    const x = Math.round(X(u.x)) + 12, y0 = Math.round(Y(u.y)) - 16;
    ctx.strokeStyle = lvl >= 2 ? '#ffd23c' : '#d8d0a8';
    ctx.lineWidth = 2;
    for (let i = 0; i < lvl; i++) {
      const yy = y0 + i * 5;
      ctx.beginPath();
      ctx.moveTo(x - 4, yy + 4); ctx.lineTo(x, yy); ctx.lineTo(x + 4, yy + 4);
      ctx.stroke();
    }
  }

  // brief white-out on freshly hit entities: re-draw the sprite additively
  // twice, which pushes it toward white without needing ctx.filter support
  function _hitFlash(draw) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.7;
    draw(); draw();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function _drawBrackets(x, y, w, h) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    const s = Math.max(8, Math.min(14, w >> 2));
    ctx.beginPath();
    ctx.moveTo(x + 1, y + s); ctx.lineTo(x + 1, y + 1); ctx.lineTo(x + s, y + 1);
    ctx.moveTo(x + w - s, y + 1); ctx.lineTo(x + w - 1, y + 1); ctx.lineTo(x + w - 1, y + s);
    ctx.moveTo(x + w - 1, y + h - s); ctx.lineTo(x + w - 1, y + h - 1); ctx.lineTo(x + w - s, y + h - 1);
    ctx.moveTo(x + s, y + h - 1); ctx.lineTo(x + 1, y + h - 1); ctx.lineTo(x + 1, y + h - s);
    ctx.stroke();
  }

  function _drawBuilding(g, b, X, Y) {
    const set = SPRITES.buildings[b.type] && SPRITES.buildings[b.type][b.owner];
    if (!set) return;
    // tall structures rise above their footprint: yOff is in WORLD px
    const x = X(b.cx * C.CELL);
    const y = Y(b.cy * C.CELL) - (set.yOff || 0) * Z;
    const damaged = b.hp < b.maxHp * 0.5;
    let frames = damaged && set.damaged ? set.damaged : set.normal;
    if (b.type === 'obli' && b.charging && set.charge) {
      frames = set.charge;
    } else if (b.type === 'sam' && b.targetId && set.open) {
      frames = set.open;
    }
    let frame;
    if (set.gateFrames) {
      // orientation is baked into the instance footprint at placement;
      // open when the owner's ground units approach (cosmetic — the real
      // passability lives in isPassable)
      const vert = b.h > 1;
      let open = false;
      if (b.buildProgress >= 1) {
        const gx2 = (b.cx + b.w / 2) * C.CELL, gy2 = (b.cy + b.h / 2) * C.CELL;
        for (const u2 of g.units.values()) {
          if (u2.owner !== b.owner || DATA.units[u2.type].air) continue;
          if (dist(u2.x, u2.y, gx2, gy2) <= C.CELL * 1.5) { open = true; break; }
        }
      }
      // servo clank when a visible gate changes state (cosmetic, render-local)
      if (b.buildProgress >= 1 && _gateWas.get(b.id) !== open) {
        if (_gateWas.has(b.id) && g.shroud[cellIdx(b.cx, b.cy)] === 1) {
          _maybeGateSnd(g, (b.cx + b.w / 2) * C.CELL, (b.cy + b.h / 2) * C.CELL);
        }
        _gateWas.set(b.id, open);
      }
      frame = frames[(vert ? 2 : 0) + (open ? 1 : 0)];
    } else if (set.wallMask) {
      // walls auto-connect: frame index = neighbor bitmask (1=N 2=E 4=S 8=W)
      let m = 0;
      const isWall = (cx, cy) => {
        const o = occAt(cx, cy);
        if (o <= 0) return false;
        const e = getEnt(o);
        return e && e.kind === 'building' &&
          (e.type === b.type || DATA.buildings[e.type].gate);
      };
      if (isWall(b.cx, b.cy - 1)) m |= 1;
      if (isWall(b.cx + 1, b.cy)) m |= 2;
      if (isWall(b.cx, b.cy + 1)) m |= 4;
      if (isWall(b.cx - 1, b.cy)) m |= 8;
      frame = frames[m % frames.length];
      // diagonal-only neighbors (no shared orthogonal wall to route through)
      // get a corner stub UNDER the frame, so odd angles still join up
      if (SPRITES.wallStub) {
        const stubs = [];
        if (isWall(b.cx + 1, b.cy - 1) && !(m & 3)) stubs.push(0);   // NE
        if (isWall(b.cx + 1, b.cy + 1) && !(m & 6)) stubs.push(1);   // SE
        if (isWall(b.cx - 1, b.cy + 1) && !(m & 12)) stubs.push(2);  // SW
        if (isWall(b.cx - 1, b.cy - 1) && !(m & 9)) stubs.push(3);   // NW
        for (const d of stubs) drawSpr(SPRITES.wallStub[d], x, y);
      }
    } else {
      frame = frames[((g.tick >> 3) + b.id) % frames.length];
    }
    const s = sca(frame);
    const DW = frame.width * s, DH = frame.height * s;

    if (b.buildProgress < 1) {
      // construction: rising bottom-up reveal with scaffold flicker
      const vis = Math.max(1, Math.round(DH * b.buildProgress));
      const srcVis = Math.max(1, Math.round(frame.height * b.buildProgress));
      ctx.drawImage(frame, 0, frame.height - srcVis, frame.width, srcVis,
        x, y + DH - vis, DW, vis);
      if (g.tick & 1) {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(x, y + DH - vis, DW, 4);
      }
      return;
    }
    drawSpr(frame, x, y);
    if (b.type === 'gun' && set.turret) {
      drawSpr(set.turret[b.turretFacing & 15], x, y - 8);
    }
    // silos wear a live sight-glass: the owner's stored credits as a rising
    // crystal column on each drum (render-only, reads p.credits/p.storage)
    if (b.type === 'silo') {
      const p2 = g.players[b.owner];
      const frac = p2 && p2.storage > 0 ? Math.min(1, p2.credits / p2.storage) : 0;
      for (const gx2 of [x + DW * 0.25, x + DW * 0.73]) {
        const gy0 = y + DH * 0.38, gh2 = DH * 0.30;
        ctx.fillStyle = 'rgba(8,10,6,0.85)';
        ctx.fillRect(Math.round(gx2) - 2, gy0 - 1, 5, gh2 + 2);
        const fh2 = Math.round(gh2 * frac);
        if (fh2 > 0) {
          ctx.fillStyle = '#35c93a';
          ctx.fillRect(Math.round(gx2) - 1, gy0 + gh2 - fh2, 3, fh2);
          ctx.fillStyle = '#b8ffb0';
          ctx.fillRect(Math.round(gx2) - 1, gy0 + gh2 - fh2, 3, 1);
        }
      }
    }
    if (b._hitT !== undefined && g.tick - b._hitT < 2) {
      _hitFlash(() => {
        drawSpr(frame, x, y);
        if (b.type === 'gun' && set.turret) drawSpr(set.turret[b.turretFacing & 15], x, y - 8);
      });
    }
    if (b.repairing && (g.tick >> 3) & 1 && SPRITES.fx.wrench) {
      const wr = SPRITES.fx.wrench[0];
      drawSpr(wr, x + (b.w * C.CELL * Z - wr.width * sca(wr)) / 2,
        Y(b.cy * C.CELL) + (b.h * C.CELL * Z - wr.height * sca(wr)) / 2);
    }
    // PRIMARY tag: the factory new units will come out of (own side only);
    // worn at the building's BASE so it reads as a stencil on the apron
    if (b.owner === g.humanSide && g.human && g.human.primary) {
      const kind = DATA.buildings[b.type].factory;
      if (kind && g.human.primary[kind] === b.id) {
        ctx.font = 'bold 11px monospace';
        const tag = 'PRIMARY';
        const tw2 = ctx.measureText(tag).width;
        const tx2 = x + (DW - tw2) / 2;
        const ty2 = Y(b.cy * C.CELL) + b.h * C.CELL * Z - 15;
        ctx.fillStyle = 'rgba(8,10,6,0.75)';
        ctx.fillRect(tx2 - 4, ty2 - 2, tw2 + 8, 14);
        ctx.fillStyle = PAL.uiGold;
        ctx.textBaseline = 'top';
        ctx.fillText(tag, tx2, ty2);
        ctx.textBaseline = 'alphabetic';
      }
    }
    // garrison marker: one dot per occupant in the holder's color, so an
    // occupied building reads as hostile/friendly at a glance
    if (b.garrison && b.garrison.length) {
      const gx = X(b.cx * C.CELL) + 4, gy = Y(b.cy * C.CELL) + 3;
      for (let i = 0; i < b.garrison.length; i++) {
        ctx.fillStyle = '#101008';
        ctx.fillRect(gx + i * 9 - 1, gy - 1, 8, 8);
        ctx.fillStyle = OWNER_COLOR[b.owner] || '#fff';
        ctx.fillRect(gx + i * 9, gy, 6, 6);
      }
    }
  }

  function _drawUnit(g, u, X, Y) {
    const d = DATA.units[u.type];
    // the replay spectator sees cloaked units as the owner would (shimmer)
    const hidden = u.cloaked && u.owner !== g.humanSide && !seeAll;
    if (hidden) return;

    if (d.infantry) {
      const set = SPRITES.infantry[u.type] && SPRITES.infantry[u.type][u.owner];
      if (!set) return;
      const f8 = (u.facing >> 1) & 7;
      let img;
      if (u.state === 'attack' && u._firing) {
        img = set.fire[f8][(g.tick >> 2) % set.fire[f8].length];
      } else if (u.path && u.pathi < u.path.length) {
        img = set.walk[f8][(u.anim >> 1) % set.walk[f8].length];
      } else {
        img = set.stand[f8][0] || set.stand[f8];
      }
      if (!img || !img.width) img = set.stand[f8];
      const ix = Math.round(X(u.x) - img.width * sca(img) / 2);
      const iy = Math.round(Y(u.y) - img.height * sca(img) / 2);
      if (!u.cloaked) {   // soft contact shadow grounds the sprite
        ctx.fillStyle = 'rgba(10,12,8,0.20)';
        ctx.beginPath();
        ctx.ellipse(X(u.x) + 1, Y(u.y) + 8, 6, 2.4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      drawSpr(img, ix, iy);
      if (u._hitT !== undefined && g.tick - u._hitT < 2) _hitFlash(() => drawSpr(img, ix, iy));
      _drawRank(u, X, Y);
      _drawWrench(g, u, X, Y);
      return;
    }

    const set = SPRITES.units[u.type] && SPRITES.units[u.type][u.owner];
    if (!set) return;
    const air = d.air;
    const body = set.body[u.facing & 15];
    const s = sca(body);
    let x = Math.round(X(u.x) - body.width * s / 2);
    let y = Math.round(Y(u.y) - body.height * s / 2);

    if (air) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(X(u.x), Y(u.y) + 24, 16, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      y -= 16 + Math.round(Math.sin(u.anim / 6) * 4);
    } else if (!u.cloaked) {
      // ground vehicles get a soft contact shadow, offset to the SE like
      // the buildings' cast shadows
      const rx = body.width * s * 0.34;
      ctx.fillStyle = 'rgba(10,12,8,0.22)';
      ctx.beginPath();
      ctx.ellipse(X(u.x) + 2, Y(u.y) + body.height * s * 0.26, rx, rx * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const cloakAlpha = u.cloaked && (u.owner === g.humanSide || seeAll);
    if (cloakAlpha) ctx.globalAlpha = 0.35;
    drawSpr(body, x, y);
    if (set.turret) drawSpr(set.turret[u.turretFacing & 15], x, y);
    if (set.anim && set.anim.length) {
      const a = set.anim[(u.anim >> 1) % set.anim.length];
      const af = a && a[u.facing & 15];
      const img = af || a;
      if (img && img.width) drawSpr(img, x, y);
    }
    if (cloakAlpha) ctx.globalAlpha = 1;
    if (u._hitT !== undefined && g.tick - u._hitT < 2) {
      _hitFlash(() => {
        drawSpr(body, x, y);
        if (set.turret) drawSpr(set.turret[u.turretFacing & 15], x, y);
      });
    }
    _drawRank(u, X, Y);
    _drawWrench(g, u, X, Y);
  }

  // ---- effects ---------------------------------------------------------------------------

  function _drawEffect(g, e, X, Y) {
    switch (e.name) {
      case 'tracer':
        ctx.strokeStyle = '#f8e850';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(X(e.x1), Y(e.y1));
        ctx.lineTo(X(e.x2), Y(e.y2));
        ctx.stroke();
        return;
      case 'laserBeam': {
        ctx.beginPath();
        ctx.moveTo(X(e.x1), Y(e.y1));
        ctx.lineTo(X(e.x2), Y(e.y2));
        ctx.strokeStyle = 'rgba(160,24,16,0.55)';
        ctx.lineWidth = 10;
        ctx.stroke();
        ctx.strokeStyle = PAL.laser;
        ctx.lineWidth = 5;
        ctx.stroke();
        ctx.strokeStyle = '#ffd8c8';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#fff0e0';
        ctx.fillRect(X(e.x2) - 4, Y(e.y2) - 4, 8, 8);
        return;
      }
      case 'ionBeam': {
        const x = X(e.x);
        ctx.fillStyle = 'rgba(168,216,248,0.75)';
        ctx.fillRect(x - 8, 0, 16, Y(e.y));
        ctx.fillStyle = '#fff';
        ctx.fillRect(x - 2, 0, 4, Y(e.y));
        return;
      }
      case 'nukeMissile': {
        const fall = (e.ttl - e.tick) * 12;
        ctx.fillStyle = '#ddd';
        ctx.fillRect(X(e.x) - 4, Y(e.y - fall) - 24, 8, 24);
        ctx.fillStyle = PAL.nodRed;
        ctx.fillRect(X(e.x) - 4, Y(e.y - fall) - 28, 8, 6);
        return;
      }
      case 'infdie': {
        const set = SPRITES.infantry[e.itype] && SPRITES.infantry[e.itype][e.side];
        if (set && set.die) {
          const img = set.die[Math.min(e.frame, set.die.length - 1)];
          drawSpr(img, Math.round(X(e.x) - img.width * sca(img) / 2),
            Math.round(Y(e.y) - img.height * sca(img) / 2));
        }
        return;
      }
      case 'rubble': {
        // a collapsed building's footprint: charred bed, broken slabs, wall
        // stubs, embers that die as the ruin cools; fades out near expiry
        const csz = C.CELL * Z;
        const sw = (e.w || 2) * csz, sh = (e.h || 2) * csz;
        const x = X(e.x) - sw / 2, y = Y(e.y) - sh / 2;
        const life = e.ttl ? e.tick / e.ttl : 0;
        ctx.globalAlpha = life > 0.75 ? (1 - life) / 0.25 : 1;
        // charred bed as jittered row strips — an eroded stain with a ragged
        // silhouette, not the building's perfect rectangle
        ctx.fillStyle = 'rgba(14,12,9,0.5)';
        const ROWS = 3 + (e.h || 2) * 2;
        const rh = (sh - 6) / ROWS;
        for (let r = 0; r < ROWS; r++) {
          // end rows pinch harder so the corners round off
          const pinch = (r === 0 || r === ROWS - 1) ? 7 : 0;
          const li = pinch + _gl(e.x | 0, r, 51) * 13 - 3;
          const ri = pinch + _gl(e.y | 0, r, 52) * 13 - 3;
          ctx.fillRect(x + 3 + li, y + 3 + r * rh, Math.max(6, sw - 6 - li - ri), rh + 1.5);
        }
        // outlying soot daubs blur the edge into the ground
        for (let i = 0; i < 5; i++) {
          const along = _gl(e.x | 0, i, 53), side = _gl(e.y | 0, i, 54);
          const dsz = 5 + side * 7;
          const horiz = i & 1;
          ctx.fillStyle = 'rgba(14,12,9,0.30)';
          if (horiz) {
            ctx.fillRect(x + 4 + along * (sw - 12),
              (side > 0.5 ? y - dsz * 0.4 : y + sh - dsz * 0.6), dsz, dsz * 0.6);
          } else {
            ctx.fillRect((side > 0.5 ? x - dsz * 0.4 : x + sw - dsz * 0.6),
              y + 4 + along * (sh - 12), dsz * 0.6, dsz);
          }
        }
        for (let i = 0; i < 3 + (e.w || 2) * 2; i++) {           // broken slabs
          const hx = _gl(e.x | 0, e.y | 0, i * 3 + 1);
          const hy = _gl(e.y | 0, e.x | 0, i * 3 + 2);
          const hs2 = 8 + ((_gl(e.x | 0, i, 7) * 12) | 0);
          const sx2 = x + 4 + hx * (sw - hs2 - 8), sy2 = y + 5 + hy * (sh - hs2 - 9);
          ctx.fillStyle = i & 1 ? '#3f3b33' : '#4c473d';
          ctx.fillRect(sx2, sy2, hs2, hs2 * 0.6);
          ctx.fillStyle = 'rgba(255,255,255,0.10)';
          ctx.fillRect(sx2, sy2, hs2, 2);
        }
        for (let i = 0; i < 2; i++) {                            // wall stubs
          const hx = _gl(e.x | 0, e.y | 0, 40 + i);
          const sx2 = x + 5 + hx * (sw - 16);
          ctx.fillStyle = '#555044';
          ctx.fillRect(sx2, y + 4 + i * (sh - 18), 10, 10);
          ctx.fillStyle = '#6a655a';
          ctx.fillRect(sx2, y + 4 + i * (sh - 18), 10, 2);
        }
        if (e.tick < 260) {                                      // cooling embers
          for (let i = 0; i < 4; i++) {
            const em = _gl(e.x | 0, i * 11, g.tick >> 2);
            if (em > 0.55) continue;
            ctx.fillStyle = 'rgba(255,120,40,' + (0.55 * (1 - e.tick / 260)).toFixed(2) + ')';
            ctx.fillRect(x + 6 + em * (sw - 12), y + 6 + _gl(i, e.y | 0, 5) * (sh - 12), 2, 2);
          }
        }
        ctx.globalAlpha = 1;
        return;
      }
      case 'wreck': {
        // a burnt-out vehicle husk cooling where it died
        const life = e.ttl ? e.tick / e.ttl : 0;
        const x = X(e.x), y = Y(e.y);
        ctx.globalAlpha = life > 0.7 ? (1 - life) / 0.3 : 1;
        ctx.fillStyle = 'rgba(12,10,8,0.45)';                    // soot ring
        ctx.beginPath();
        ctx.ellipse(x, y + 4, e.big ? 26 : 18, e.big ? 12 : 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#26221c';                               // hull
        ctx.beginPath();
        ctx.ellipse(x, y, e.big ? 18 : 13, e.big ? 9 : 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#3a342a';                               // collapsed cabin
        ctx.fillRect(x - (e.big ? 8 : 6), y - (e.big ? 7 : 5), e.big ? 16 : 12, e.big ? 6 : 5);
        ctx.fillStyle = '#171310';
        ctx.fillRect(x - 3, y - 2, 7, 4);
        if (e.tick < 180) {
          const em = _gl(e.x | 0, e.y | 0, g.tick >> 2);
          if (em < 0.5) {
            ctx.fillStyle = 'rgba(255,120,40,' + (0.5 * (1 - e.tick / 180)).toFixed(2) + ')';
            ctx.fillRect(x - 2 + ((em * 9) | 0), y - 1, 2, 2);
          }
        }
        ctx.globalAlpha = 1;
        return;
      }
      case 'moveMark': case 'atkMark': {
        // order confirmation: a ring collapsing onto the destination
        const f = e.tick / (e.ttl || 14);
        const col = e.name === 'moveMark' ? '#50e050' : '#f04030';
        const x = X(e.x), y = Y(e.y);
        ctx.globalAlpha = 0.9 - f * 0.55;
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 4 + (1 - f) * 16, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = col;
        ctx.fillRect(x - 2, y - 2, 4, 4);
        ctx.globalAlpha = 1;
        return;
      }
      case 'cash': {
        // floating credit readout, drifts up and fades (red when negative —
        // a harvester load lost against full silos)
        const f = e.tick / (e.ttl || 24);
        ctx.globalAlpha = f < 0.65 ? 1 : 1 - (f - 0.65) / 0.35;
        ctx.font = 'bold 16px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const s = (e.amount >= 0 ? '+' : '') + e.amount;
        ctx.fillStyle = '#101008';
        ctx.fillText(s, X(e.x) + 1, Y(e.y) + 1);
        ctx.fillStyle = e.amount >= 0 ? PAL.uiGold : PAL.uiRed;
        ctx.fillText(s, X(e.x), Y(e.y));
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.globalAlpha = 1;
        return;
      }
      case 'promote': {
        // rising gold chevron burst on a freshly promoted unit
        const f = e.tick / (e.ttl || 20);
        ctx.globalAlpha = 1 - f * 0.8;
        ctx.strokeStyle = PAL.uiGold;
        ctx.lineWidth = 2;
        const x = X(e.x), y = Y(e.y);
        for (let i = 0; i < 2; i++) {
          const yy = y + i * 7;
          ctx.beginPath();
          ctx.moveTo(x - 7, yy + 5); ctx.lineTo(x, yy); ctx.lineTo(x + 7, yy + 5);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        return;
      }
      case 'dust': {
        // drifting tan puff behind vehicles on dirt
        const f = e.tick / (e.ttl || 14);
        ctx.globalAlpha = 0.26 * (1 - f);
        ctx.fillStyle = '#b39d72';
        ctx.beginPath();
        ctx.arc(X(e.x), Y(e.y), 3 + f * 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        return;
      }
      default: {
        if (e.name === 'expL') _bigBoomExtras(e, X, Y);
        const frames = SPRITES.fx[e.name];
        if (!frames || !frames.length) return;
        const img = frames[Math.min(e.frame, frames.length - 1)];
        drawSpr(img, Math.round(X(e.x) - img.width * sca(img) / 2),
          Math.round(Y(e.y) - img.height * sca(img) / 2));
      }
    }
  }

  // big explosions get a shockwave ring and a handful of debris arcs on top
  // of the sprite frames (deterministic off position+tick, no rng)
  function _bigBoomExtras(e, X, Y) {
    const t = e.tick;
    const x = X(e.x), y = Y(e.y);
    if (t < 8) {
      ctx.globalAlpha = 0.5 * (1 - t / 8);
      ctx.strokeStyle = '#ffe8c0';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 8 + t * 7, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (t < 14) {
      const seed = ((e.x * 7 + e.y * 13) | 0) % 97;
      for (let i = 0; i < 6; i++) {
        const h = Math.sin(seed + i * 37.7) * 0.5 + 0.5;
        const a = (i / 6) * Math.PI * 2 + h * 1.2;
        const sp = 2.6 + h * 2.2;
        const dx = Math.sin(a) * sp * t;
        const dy = -Math.cos(a) * sp * t * 0.6 + 0.22 * t * t;   // gravity droop
        ctx.globalAlpha = 1 - t / 14;
        ctx.fillStyle = i % 2 ? '#2a2620' : '#e8a040';
        ctx.fillRect(x + dx - 1, y + dy - 1, 3, 3);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---- atmosphere: a cinematic grade + vignette over the battlefield --------------------------
  // Render-only, per-frame, no sim reads: a couple of GPU-blended full-viewport
  // fills (cheap — no getImageData). Called INSIDE the viewport clip so the HUD
  // and selection UI stay crisp and untinted.

  function _buildVignette(w, h) {
    const c = mkCanvas(w, h);
    const q = c.getContext('2d');
    // elliptical falloff from a bright-ish center to cool-dark corners
    const cx = w / 2, cy = h / 2, r = Math.sqrt(cx * cx + cy * cy);
    const g = q.createRadialGradient(cx, cy, r * 0.34, cx, cy, r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.66, 'rgba(6,10,18,0.16)');
    g.addColorStop(1, 'rgba(3,6,13,0.60)');
    q.fillStyle = g;
    q.fillRect(0, 0, w, h);
    // bake faint film grain INTO the vignette so the whole atmosphere is one
    // cheap source-over blit (no per-frame blend-mode pattern fill)
    if (!grainPat) grainPat = _buildGrain();
    q.globalAlpha = 0.05;
    q.fillStyle = grainPat;
    q.fillRect(0, 0, w, h);
    q.globalAlpha = 1;
    vignette = c; vigW = w; vigH = h;
  }

  function _drawGrade() {
    const w = C.VIEW_PW, h = C.VIEW_PH, y0 = C.TAB_H;
    // two full-viewport blends fuse the procedural sprites into one lit scene:
    // deepen+warm the shadows (multiply), then warm the highlights (screen).
    // Kept to TWO passes — full-screen blend fills are the frame's dominant
    // cost, so the cool-shadow whisper and grain are baked into the vignette
    // blit instead of adding more passes here.
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgba(154,128,92,0.16)';     // dusty warm shadow tint
    ctx.fillRect(0, y0, w, h);
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = 'rgba(118,94,42,0.11)';      // warm glow in the brights
    ctx.fillRect(0, y0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }

  function _buildGrain() {
    const s = 128, c = mkCanvas(s, s), q = c.getContext('2d');
    const img = q.createImageData(s, s);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    q.putImageData(img, 0, 0);
    return ctx.createPattern(c, 'repeat');
  }

  function _drawVignette() {
    const w = C.VIEW_PW, h = C.VIEW_PH;
    if (!vignette || vigW !== w || vigH !== h) _buildVignette(w, h);
    ctx.drawImage(vignette, 0, C.TAB_H);
  }

  // ---- additive emissive bloom -----------------------------------------------------------------
  // A soft luminous haze over bright things (tiberium, fire, beams, blasts).
  // Cached radial stamps composited with 'lighter' — no getImageData, no sim
  // reads. Gated by shroud so nothing glows through the fog.

  const _glowCache = {};
  function _glow(r, gg, b) {
    const key = r + ',' + gg + ',' + b;
    if (_glowCache[key]) return _glowCache[key];
    const s = 64, c = mkCanvas(s, s), q = c.getContext('2d');
    const grd = q.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, `rgba(${r},${gg},${b},0.85)`);
    grd.addColorStop(0.4, `rgba(${r},${gg},${b},0.32)`);
    grd.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    q.fillStyle = grd;
    q.fillRect(0, 0, s, s);
    return (_glowCache[key] = c);
  }

  // effect name -> {glow stamp, base radius px, alpha} for the bloom pass
  function _effectGlow(name) {
    switch (name) {
      case 'flame': return [_glow(255, 140, 50), 34, 0.5];
      case 'laserBeam': return null;                 // handled as a line below
      case 'ionBeam': return null;                   // handled as a column below
      case 'expS': return [_glow(255, 150, 60), 40, 0.55];
      case 'expL': return [_glow(255, 150, 60), 78, 0.6];
      case 'nukeCloud': return [_glow(255, 170, 90), 120, 0.5];
      case 'muzzle': return [_glow(255, 220, 150), 22, 0.5];
      case 'ionBlast': return [_glow(170, 215, 255), 70, 0.7];
      default: return null;
    }
  }

  function _drawGlow(g, X, Y, c0x, c1x, c0y, c1y, cs) {
    ctx.globalCompositeOperation = 'lighter';

    // tiberium field haze — low per-cell alpha, additive overlap builds the
    // soft luminous mass. Only medium+ cells stamp (the sparse fringe barely
    // glowed and dominated the stamp count), and the stamp is generously
    // sized so it still reads as a continuous field.
    const green = _glow(96, 240, 128);
    const blueG = _glow(96, 150, 255);
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const i = cellIdx(cx, cy);
        const v = g.tib[i];
        if (v <= 90 || (!seeAll && g.shroud[i] !== 1)) continue;
        const sz = cs * (v > 200 ? 1.9 : 1.5);
        ctx.globalAlpha = v > 200 ? 0.17 : 0.12;
        ctx.drawImage(g.tibType && g.tibType[i] === 1 ? blueG : green,
          X(cellCenterX(cx)) - sz / 2, Y(cellCenterY(cy)) - sz / 2, sz, sz);
      }
    }
    ctx.globalAlpha = 1;

    // emissive effects
    for (const e of g.effects) {
      if (e.name === 'laserBeam') {
        // gate on the beam SOURCE (the firing obelisk): a beam from a fogged
        // shooter must not re-light itself over the shroud and leak position
        const scx = worldToCell(e.x1), scy = worldToCell(e.y1);
        if (!seeAll && inMap(scx, scy) && g.shroud[cellIdx(scx, scy)] !== 1) continue;
        ctx.strokeStyle = 'rgba(240,60,50,0.5)';
        ctx.lineWidth = 16;
        ctx.beginPath();
        ctx.moveTo(X(e.x1), Y(e.y1)); ctx.lineTo(X(e.x2), Y(e.y2));
        ctx.stroke();
        continue;
      }
      if (e.name === 'ionBeam') {
        const icx = worldToCell(e.x), icy = worldToCell(e.y);
        if (!seeAll && inMap(icx, icy) && g.shroud[cellIdx(icx, icy)] !== 1) continue;
        // trace the beam column from the top of the viewport down to the
        // impact (a wide soft additive stroke matching _drawEffect's column)
        ctx.strokeStyle = 'rgba(170,215,255,0.4)';
        ctx.lineWidth = 26;
        ctx.beginPath();
        ctx.moveTo(X(e.x), C.TAB_H); ctx.lineTo(X(e.x), Y(e.y));
        ctx.stroke();
        continue;
      }
      const gd = _effectGlow(e.name);
      if (!gd) continue;
      const cx = worldToCell(e.x), cy = worldToCell(e.y);
      if (!seeAll && inMap(cx, cy) && g.shroud[cellIdx(cx, cy)] !== 1) continue;
      // fade explosion/flame glow over the effect's life
      let a = gd[2];
      if (e.ttl) a *= Math.max(0.15, 1 - e.tick / e.ttl);
      ctx.globalAlpha = a;
      const s = gd[1] * 2;
      ctx.drawImage(gd[0], X(e.x) - s / 2, Y(e.y) - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    // charging obelisks / beam spires pulse a red glow before firing
    for (const b of g.buildings.values()) {
      if (!b.charging || b._dead) continue;
      if (!seeAll && g.shroud[cellIdx(b.cx, b.cy)] !== 1) continue;
      ctx.globalAlpha = 0.4 + 0.3 * Math.sin(g.tick * 0.5);
      const s = 70;
      ctx.drawImage(_glow(240, 60, 50), X(_entX(b)) - s / 2, Y(_entY(b)) - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---- viewport ------------------------------------------------------------------------------

  function _drawViewport(g) {
    if (!terrainCache || terrainCacheSeed !== g.seed) _buildTerrainCache(g);

    if (g.shake > 0 && g.tick !== shownTick) {
      shakeX = ((Math.random() * 2 - 1) * Math.min(6, g.shake / 3)) | 0;
      shakeY = ((Math.random() * 2 - 1) * Math.min(6, g.shake / 3)) | 0;
      g.shake--;
    } else if (!g.shake) { shakeX = 0; shakeY = 0; }

    // integer draw origin: the camera can sit at fractional world coords
    // (wheel pan, minimap drag) and per-cell fills at subpixel positions
    // antialias into hairline seams — a visible grid inside the shroud
    const ox = Math.round(g.camera.x - shakeX), oy = Math.round(g.camera.y - shakeY);
    const X = w => (w - ox) * Z;
    const Y = w => (w - oy) * Z + C.TAB_H;
    const cs = C.CELL * Z;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, C.TAB_H, C.VIEW_PW, C.VIEW_PH);
    ctx.clip();

    // terrain (cache is at screen scale)
    ctx.drawImage(terrainCache, -ox * Z, C.TAB_H - oy * Z);
    for (const a of animCells) {
      const sx = X(a.cx * C.CELL), sy = Y(a.cy * C.CELL);
      if (sx < -cs || sx > C.VIEW_PW || sy < -cs || sy > C.SCREEN_H) continue;
      const f = a.frames[((g.tick >> (a.rate || 3)) + a.phase) % a.frames.length];
      ctx.drawImage(f, sx, sy, f.width * Z, f.height * Z);
    }

    // ground marks below everything else
    for (const e of g.effects) {
      if (e.name === 'scorch' || e.name === 'crater' ||
          e.name === 'rubble' || e.name === 'wreck') _drawEffect(g, e, X, Y);
    }

    // tiberium
    const c0x = Math.max(0, worldToCell(ox)), c1x = Math.min(C.MAP_W - 1, worldToCell(ox + C.VIEW_W) + 1);
    const c0y = Math.max(0, worldToCell(oy)), c1y = Math.min(C.MAP_H - 1, worldToCell(oy + C.VIEW_H) + 1);
    // one extra cell on the min side: the draw jitter below can push a
    // sprite up to 4 world px into view from beyond the exact window
    const t0x = Math.max(0, c0x - 1), t0y = Math.max(0, c0y - 1);
    for (let cy = t0y; cy <= c1y; cy++) {
      for (let cx = t0x; cx <= c1x; cx++) {
        const i2 = cellIdx(cx, cy);
        const v = g.tib[i2];
        if (v <= 0) continue;
        const density = v > 200 ? 2 : v > 100 ? 1 : 0;
        const blue = g.tibType && g.tibType[i2] === 1 && SPRITES.tiberiumBlue;
        const tv = blue ? SPRITES.tiberiumBlue[density] : SPRITES.tiberium[density];
        const timg = Array.isArray(tv) ? tv[(cx * 7 + cy * 13) % tv.length] : tv;
        // per-cell jitter breaks the crystal clusters off the cell grid
        const tj = (cx * 0x9e37 ^ cy * 0x85eb) & 63;
        ctx.drawImage(timg, X(cx * C.CELL + (tj & 7) - 3), Y(cy * C.CELL + (tj >> 3) - 4), cs, cs);
      }
    }

    // water depth + animated shoreline foam: deep water darkens, shallow
    // (shore) water brightens turquoise, and a foam rim shimmers on every
    // land-facing edge. Render-only, cheap (water is a small cell fraction).
    {
      const t = g.tick;
      for (let cy = c0y; cy <= c1y; cy++) {
        for (let cx = c0x; cx <= c1x; cx++) {
          const i = cellIdx(cx, cy);
          if (g.terrain[i] !== 3 || (!seeAll && g.shroud[i] !== 1)) continue;
          const landN = cy > 0 && g.terrain[cellIdx(cx, cy - 1)] !== 3;
          const landS = cy < C.MAP_H - 1 && g.terrain[cellIdx(cx, cy + 1)] !== 3;
          const landW = cx > 0 && g.terrain[cellIdx(cx - 1, cy)] !== 3;
          const landE = cx < C.MAP_W - 1 && g.terrain[cellIdx(cx + 1, cy)] !== 3;
          const x = X(cx * C.CELL), y = Y(cy * C.CELL);
          // depth from the 8-neighbourhood water count, so it grades from
          // shore to channel instead of a hard deep/shallow rectangle
          let wn = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = cx + dx, ny = cy + dy;
            if (inMap(nx, ny) && g.terrain[cellIdx(nx, ny)] === 3) wn++;
          }
          if (!(landN || landS || landW || landE)) {
            ctx.fillStyle = 'rgba(6,20,42,' + (0.03 + wn * 0.010).toFixed(3) + ')';  // deepens with enclosure
            ctx.fillRect(x, y, cs, cs);
            continue;
          }
          ctx.fillStyle = 'rgba(96,168,188,0.15)';   // shallow turquoise
          ctx.fillRect(x, y, cs, cs);
          // soft foam: low alpha and a thin rim, so small ponds don't read
          // as boxes traced in white
          const fa = (0.20 + 0.12 * Math.sin(t * 0.22 + (cx * 1.3 + cy * 0.7))).toFixed(3);
          ctx.fillStyle = 'rgba(198,230,238,' + fa + ')';
          const fw = 2;
          if (landN) ctx.fillRect(x, y, cs, fw);
          if (landS) ctx.fillRect(x, y + cs - fw, cs, fw);
          if (landW) ctx.fillRect(x, y, fw, cs);
          if (landE) ctx.fillRect(x + cs - fw, y, fw, cs);
        }
      }
    }

    // living ground: brief sun glints on open water, sparkles on crystal.
    // Purely per-frame cosmetics off a phase-quantized hash — no state, no rng.
    {
      const ph = g.tick >> 2;
      for (let cy = c0y; cy <= c1y; cy++) {
        for (let cx = c0x; cx <= c1x; cx++) {
          const i = cellIdx(cx, cy);
          const water = g.terrain[i] === 3;
          if (!water && g.tib[i] <= 0) continue;
          const r = _gl(cx, cy, ph);
          if (water) {
            if (r > 0.09) continue;
            const p = _gl(cx + 97, cy + 31, ph);
            const px = X(cx * C.CELL + 3 + p * 15), py = Y(cy * C.CELL + 4 + (r * 160) % 15);
            ctx.globalAlpha = 0.35;
            ctx.fillStyle = '#d4ecff';
            ctx.fillRect(px, py, 6, 2);
            ctx.globalAlpha = 1;
          } else {
            if (r > 0.06) continue;
            const p = _gl(cx + 53, cy + 71, ph);
            const px = X(cx * C.CELL + 4 + p * 14), py = Y(cy * C.CELL + 4 + (r * 220) % 14);
            ctx.globalAlpha = 0.6;
            ctx.fillStyle = '#eaffea';
            ctx.fillRect(px - 1, py, 5, 2);
            ctx.fillRect(px + 1, py - 2, 2, 6);
            ctx.globalAlpha = 1;
          }
        }
      }
    }

    // goodie crates (under everything that moves)
    if (g.crates) {
      for (const c of g.crates) {
        if (!seeAll && g.shroud[cellIdx(c.cx, c.cy)] !== 1) continue;
        const x = X(c.cx * C.CELL), y = Y(c.cy * C.CELL);
        ctx.fillStyle = '#101008'; ctx.fillRect(x + 9, y + 11, 32, 26);
        ctx.fillStyle = '#8a6a3c'; ctx.fillRect(x + 11, y + 13, 28, 22);
        ctx.fillStyle = '#6a4f2a'; ctx.fillRect(x + 11, y + 22, 28, 3);
        ctx.fillStyle = (g.tick >> 3) & 1 ? '#ffd23c' : '#c8a84c';
        ctx.fillRect(x + 23, y + 13, 4, 22);
      }
    }

    // buildings and ground units in ONE painter's pass, sorted by baseline —
    // a unit passing behind a tall tower must be occluded by it, a unit in
    // front must cover its foot (interleaving is what makes the world read
    // as having depth instead of "units always on top")
    const units = Array.from(g.units.values()).sort((a, b) => a.y - b.y);
    const ground = [];
    for (const b of g.buildings.values()) ground.push(b);
    for (const u of units) if (!DATA.units[u.type].air && _unitSeen(g, u)) ground.push(u);
    const baseY = e => e.kind === 'building'
      ? (e.cy + e.h) * C.CELL           // footprint bottom edge
      : e.y + C.CELL * 0.5;             // feet, half a cell below center
    ground.sort((a, b) => baseY(a) - baseY(b));
    for (const e of ground) {
      if (e.kind === 'building') _drawBuilding(g, e, X, Y);
      else _drawUnit(g, e, X, Y);
    }

    // rally flag for selected factory
    for (const id of g.selection) {
      const b = g.buildings.get(id);
      if (b && b.rally && b.owner === g.humanSide) {
        const rx = X(cellCenterX(b.rally.cx)), ry = Y(cellCenterY(b.rally.cy));
        ctx.fillStyle = PAL.uiGold;
        ctx.fillRect(rx, ry - 16, 2, 16);
        ctx.fillRect(rx, ry - 16, 10, 6);
      }
    }

    // bullets
    for (const b of g.bullets) {
      const bx = X(b.x), by = Y(b.y) - (b.z || 0) * Z;
      if (b.w.arc && b.z > 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(X(b.x) - 2, Y(b.y) - 2, 4, 4);
      }
      ctx.fillStyle = b.w.warhead === 'ap' ? '#e8e0c0' : '#f8b830';
      ctx.fillRect(bx - 2, by - 2, b.w.homing ? 8 : 6, b.w.homing ? 4 : 6);
      if (b.w.homing && (game.tick & 1)) {
        ctx.fillStyle = 'rgba(160,160,160,0.6)';
        ctx.fillRect(bx - 8, by - 2, 4, 4);
      }
    }

    // effects (non-ground)
    for (const e of g.effects) {
      if (e.name !== 'scorch' && e.name !== 'crater' &&
          e.name !== 'rubble' && e.name !== 'wreck') _drawEffect(g, e, X, Y);
    }

    // incoming superweapon: pulsing reticle at the aim point (3s of warning
    // the siren gives you a location for)
    if (g._strikes) {
      for (const s of g._strikes) {
        if (!Fog.isExplored(g, s.cx, s.cy)) continue;
        const x = X(cellCenterX(s.cx)), y = Y(cellCenterY(s.cy));
        ctx.strokeStyle = ((g.tick >> 2) & 1) ? '#ff4030' : '#a02418';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 18 + (s.t % 10), 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - 26, y); ctx.lineTo(x + 26, y);
        ctx.moveTo(x, y - 26); ctx.lineTo(x, y + 26);
        ctx.stroke();
      }
    }

    // air units on top
    for (const u of units) if (DATA.units[u.type].air && _unitSeen(g, u)) _drawUnit(g, u, X, Y);

    // shroud (skipped entirely for the replay spectator). Cells merge into
    // horizontal RUNS drawn with a half-pixel bleed: on fractional
    // device-pixel scales, abutting per-cell rects antialias into hairline
    // seams — a faint grid glowing inside the black
    if (!seeAll) {
    ctx.fillStyle = '#000';
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        if (g.shroud[cellIdx(cx, cy)] === 1) continue;
        let cx2 = cx;
        while (cx2 + 1 <= c1x && g.shroud[cellIdx(cx2 + 1, cy)] !== 1) cx2++;
        ctx.fillRect(X(cx * C.CELL) - 0.5, Y(cy * C.CELL) - 0.5,
          (cx2 - cx + 1) * cs + 1, cs + 1);
        cx = cx2;
      }
    }
    if (SPRITES.shroudEdge && SPRITES.shroudEdge.length === 8) {
      const NDX = [0, 1, 1, 1, 0, -1, -1, -1], NDY = [-1, -1, 0, 1, 1, 1, 0, -1];
      for (let cy = c0y; cy <= c1y; cy++) {
        for (let cx = c0x; cx <= c1x; cx++) {
          if (g.shroud[cellIdx(cx, cy)] !== 1) continue;
          for (let d = 0; d < 8; d++) {
            const nx = cx + NDX[d], ny = cy + NDY[d];
            if (inMap(nx, ny) && g.shroud[cellIdx(nx, ny)] === 0) {
              ctx.drawImage(SPRITES.shroudEdge[d], X(cx * C.CELL), Y(cy * C.CELL), cs, cs);
            }
          }
        }
      }
    }
    }

    // escort beacon: pulsing gold rings at the delivery point, drawn over
    // the shroud — mission intel outranks the fog
    const obEsc = g.mission && g.mission.objective;
    if (obEsc && obEsc.type === 'escort' && g.status === 'playing') {
      const d = obEsc.dest === 'ai' ? g.startPos.ai : obEsc.dest;
      const bx = X(cellCenterX(d.cx)), by = Y(cellCenterY(d.cy));
      const ph = (g.tick % 30) / 30;
      ctx.strokeStyle = 'rgba(224,184,64,' + (0.85 - ph * 0.6).toFixed(2) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(bx, by, 8 + ph * 26, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(224,184,64,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(bx, by, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#141208';
      ctx.fillRect(bx - 1, by - 18, 3, 16);
      ctx.fillStyle = (g.tick >> 3) & 1 ? '#ffe28a' : '#c8a030';
      ctx.fillRect(bx + 2, by - 18, 8, 6);
    }

    // atmosphere: grade the scene, bloom the emissives on top, then vignette
    _drawGrade();
    _drawGlow(g, X, Y, c0x, c1x, c0y, c1y, cs);
    _drawVignette();

    // selection brackets + health bars
    for (const id of g.selection) {
      const e = getEnt(id);
      if (!e) continue;
      if (e.kind === 'unit') {
        const ud = DATA.units[e.type];
        const air = ud.air;
        const x = X(e.x) - cs / 2, y = Y(e.y) - cs / 2 - (air ? 16 : 0);
        _drawBrackets(x, y, cs, cs);
        _drawHealthBar(x, y - 10, cs, e.hp / e.maxHp);
        // transport cargo pips: filled = a passenger aboard
        if (ud.transport && e.cargo) {
          const pw = 6, gap = 2, n = ud.transport;
          let px = x + cs / 2 - (n * pw + (n - 1) * gap) / 2;
          for (let i = 0; i < n; i++) {
            ctx.fillStyle = i < e.cargo.length ? PAL.uiGold : 'rgba(255,255,255,0.25)';
            ctx.fillRect(px, y - 20, pw, 5);
            px += pw + gap;
          }
        }
        // aircraft ammo pips: filled = a shot left before the rearm run
        if (ud.air && ud.ammo) {
          const n = ud.ammo;
          const pw = Math.max(2, Math.min(6, Math.floor((cs - (n - 1)) / n)));
          let px = x + cs / 2 - (n * pw + (n - 1)) / 2;
          for (let i = 0; i < n; i++) {
            ctx.fillStyle = i < e.ammo ? '#f8b830' : 'rgba(255,255,255,0.25)';
            ctx.fillRect(px, y - 20, pw, 5);
            px += pw + 1;
          }
        }
        // harvester cargo pips: how much crystal is in the hopper
        if (ud.harvester) {
          const n = 5, pw = 6, gap = 2;
          const filled = Math.round((e.tib / C.HARV_CAP) * n);
          let px = x + cs / 2 - (n * pw + (n - 1) * gap) / 2;
          for (let i = 0; i < n; i++) {
            ctx.fillStyle = i < filled ? '#4ce03c' : 'rgba(255,255,255,0.25)';
            ctx.fillRect(px, y - 20, pw, 5);
            px += pw + gap;
          }
        }
      } else {
        const x = X(e.cx * C.CELL), y = Y(e.cy * C.CELL);
        _drawBrackets(x, y, e.w * cs, e.h * cs);
        _drawHealthBar(x, y - 10, e.w * cs, e.hp / e.maxHp);
      }
    }
    // group numbers
    ctx.font = '14px monospace';
    ctx.textBaseline = 'top';
    for (const n in g.groups) {
      for (const id of g.groups[n]) {
        if (!g.selection.includes(id)) continue;
        const e = g.units.get(id);
        if (!e) continue;
        ctx.fillStyle = '#fff';
        ctx.fillText(n, X(e.x) - cs / 2, Y(e.y) - cs / 2 - 22);
      }
    }

    // hover: whatever is under the cursor shows its health without a click
    if (fineTip && Input.mouse.inside && !g.paused && Input.mode === 'normal' &&
        Input.mouse.y >= C.TAB_H && Input.mouse.x < C.VIEW_PW) {
      const w = worldFromScreen(Input.mouse.x, Input.mouse.y);
      if (w) {
        let hov = null, best = 18 * 18;
        for (const u of g.units.values()) {
          if (!_unitSeen(g, u)) continue;
          const dx = u.x - w.x, dy = u.y - w.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < best) { best = d2; hov = u; }
        }
        if (!hov) {
          const o = occAt(worldToCell(w.x), worldToCell(w.y));
          if (o) {
            const e2 = getEnt(o);
            if (e2 && e2.kind === 'building' &&
                (seeAll || g.shroud[cellIdx(e2.cx, e2.cy)] === 1)) hov = e2;
          }
        }
        if (hov && !g.selection.includes(hov.id)) {
          if (hov.kind === 'unit') {
            const air = DATA.units[hov.type].air;
            _drawHealthBar(X(hov.x) - cs / 2, Y(hov.y) - cs / 2 - 10 - (air ? 16 : 0),
              cs, hov.hp / hov.maxHp);
          } else {
            _drawHealthBar(X(hov.cx * C.CELL), Y(hov.cy * C.CELL) - 10,
              hov.w * cs, hov.hp / hov.maxHp);
          }
        }
      }
    }

    // sell mode: quote the refund at the cursor before the deed is done
    if (Input.mode === 'sell' && fineTip && Input.mouse.inside && Input.mouse.x < C.VIEW_PW) {
      const w = worldFromScreen(Input.mouse.x, Input.mouse.y);
      if (w) {
        const o = occAt(worldToCell(w.x), worldToCell(w.y));
        const b2 = o ? getEnt(o) : null;
        if (b2 && b2.kind === 'building' && b2.owner === g.humanSide && b2.buildProgress >= 1) {
          const refund = Math.floor(DATA.buildings[b2.type].cost * C.SELL_REFUND * (b2.hp / b2.maxHp));
          const tag = '+$' + refund;
          ctx.font = 'bold 14px monospace';
          const tw2 = ctx.measureText(tag).width;
          ctx.fillStyle = 'rgba(8,10,6,0.8)';
          ctx.fillRect(Input.mouse.x + 14, Input.mouse.y - 8, tw2 + 10, 20);
          ctx.fillStyle = '#8fe08f';
          ctx.textBaseline = 'middle';
          ctx.fillText(tag, Input.mouse.x + 19, Input.mouse.y + 2);
          ctx.textBaseline = 'alphabetic';
        }
      }
    }

    // placement overlay
    const placingGate = Input.mode === 'place' && Input.modeArg &&
      DATA.buildings[Input.modeArg] && DATA.buildings[Input.modeArg].gate;
    if (placingGate) {
      // gate ghost: the full 3-cell span, oriented by the wall run under
      // the cursor, valid as a whole (own wall segments underneath are ok)
      const w = worldFromScreen(Input.mouse.x, Input.mouse.y);
      if (w) {
        const ccx = worldToCell(w.x), ccy = worldToCell(w.y);
        const fp = Production.gateFootprint(g, ccx, ccy);
        const ok = Production.canPlaceGate(g, g.human, ccx, ccy);
        for (let k = 0; k < 3; k++) {
          const x2 = fp.cx + (fp.w === 3 ? k : 0), y2 = fp.cy + (fp.h === 3 ? k : 0);
          ctx.fillStyle = ok ? 'rgba(80,240,80,0.4)' : 'rgba(240,60,40,0.4)';
          ctx.fillRect(X(x2 * C.CELL), Y(y2 * C.CELL), cs, cs);
          ctx.strokeStyle = ok ? '#8f8' : '#f88';
          ctx.lineWidth = 1;
          ctx.strokeRect(X(x2 * C.CELL) + 0.5, Y(y2 * C.CELL) + 0.5, cs - 1, cs - 1);
        }
      }
    } else if (Input.mode === 'place' && Input.modeArg && Input.wallLine && Input.wallLine.length) {
      // RA2-style wall drag: preview the whole segment line
      for (const cell of Input.wallLine) {
        const ok = Production.cellOk(g, g.human, cell.cx, cell.cy);
        ctx.fillStyle = ok ? 'rgba(80,240,80,0.4)' : 'rgba(240,60,40,0.4)';
        ctx.fillRect(X(cell.cx * C.CELL), Y(cell.cy * C.CELL), cs, cs);
        ctx.strokeStyle = ok ? '#8f8' : '#f88';
        ctx.lineWidth = 1;
        ctx.strokeRect(X(cell.cx * C.CELL) + 0.5, Y(cell.cy * C.CELL) + 0.5, cs - 1, cs - 1);
      }
    } else if (Input.mode === 'place' && Input.modeArg) {
      const w = worldFromScreen(Input.mouse.x, Input.mouse.y);
      if (w) {
        const d = DATA.buildings[Input.modeArg];
        const pcx = worldToCell(w.x) - ((d.w / 2) | 0), pcy = worldToCell(w.y) - ((d.h / 2) | 0);
        const overall = Production.canPlace(g, g.human, Input.modeArg, pcx, pcy);
        for (let yy = 0; yy < d.h; yy++) {
          for (let xx = 0; xx < d.w; xx++) {
            const ok = Production.cellOk(g, g.human, pcx + xx, pcy + yy) && overall;
            ctx.fillStyle = ok ? 'rgba(80,240,80,0.4)' : 'rgba(240,60,40,0.4)';
            ctx.fillRect(X((pcx + xx) * C.CELL), Y((pcy + yy) * C.CELL), cs, cs);
            ctx.strokeStyle = ok ? '#8f8' : '#f88';
            ctx.lineWidth = 1;
            ctx.strokeRect(X((pcx + xx) * C.CELL) + 0.5, Y((pcy + yy) * C.CELL) + 0.5, cs - 1, cs - 1);
          }
        }
      }
    }

    // drag rectangle (already in screen coords)
    if (Input.dragRect) {
      const r = Input.dragRect;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.min(r.x1, r.x2) + 0.5, Math.min(r.y1, r.y2) + 0.5,
        Math.abs(r.x2 - r.x1), Math.abs(r.y2 - r.y1));
    }

    // superweapon flash
    if (g.flash > 0) {
      if (g.tick !== shownTick) g.flash--;
      ctx.fillStyle = `rgba(255,255,255,${g.flash / 14})`;
      ctx.fillRect(0, C.TAB_H, C.VIEW_PW, C.VIEW_PH);
    }

    ctx.restore();
  }

  // ---- tab bar ------------------------------------------------------------------------------

  function _bevel(x, y, w, h, lit) {
    // brushed-metal body: vertical gradient (lit from above) + chunky edges
    const bg = ctx.createLinearGradient(x, y, x, y + h);
    if (lit) { bg.addColorStop(0, '#82826f'); bg.addColorStop(1, '#55554a'); }
    else { bg.addColorStop(0, '#5e5e53'); bg.addColorStop(0.5, PAL.uiMetal); bg.addColorStop(1, '#3a3a33'); }
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = lit ? '#9a9a88' : PAL.uiMetalLight;
    ctx.fillRect(x, y, w, 2);
    ctx.fillRect(x, y, 2, h);
    ctx.fillStyle = PAL.uiMetalDark;
    ctx.fillRect(x, y + h - 2, w, 2);
    ctx.fillRect(x + w - 2, y, 2, h);
  }

  function _drawTabBar(g) {
    // lit metal bar with a warm gold baseline separating HUD from viewport
    const tg = ctx.createLinearGradient(0, 0, 0, C.TAB_H);
    tg.addColorStop(0, '#3c3c34');
    tg.addColorStop(0.5, PAL.uiMetalDark);
    tg.addColorStop(1, '#1c1c18');
    ctx.fillStyle = tg;
    ctx.fillRect(0, 0, C.SCREEN_W, C.TAB_H);
    ctx.fillStyle = 'rgba(224,184,64,0.35)';
    ctx.fillRect(0, C.TAB_H - 1, C.VIEW_PW, 1);
    _bevel(0, 0, 120, C.TAB_H);
    ctx.font = '16px monospace';
    ctx.textBaseline = 'top';
    ctx.fillStyle = PAL.uiText;
    ctx.fillText('Options', 16, 8);

    // control-group chips: click/tap recalls (twice centers), right-click or
    // long-press assigns the current selection — the touch path to groups
    for (let i = 1; i <= C.GROUP_N; i++) {
      const x = C.GROUP_X + (i - 1) * C.GROUP_SPACING;
      const ids = g.groups[i];
      const live = ids ? ids.filter(id => g.units.get(id) || g.buildings.get(id)).length : 0;
      _bevel(x, 3, C.GROUP_W, C.TAB_H - 6, false);
      ctx.fillStyle = live ? PAL.uiGold : '#6a6a60';
      ctx.fillText(String(i), x + 10, 8);
      if (live) {
        ctx.font = '12px monospace';
        ctx.fillStyle = PAL.uiText;
        ctx.fillText('x' + live, x + 26, 11);
        ctx.font = '16px monospace';
      }
    }

    // credits ticker
    const target = Math.floor(g.human.credits);
    if (creditsShown !== target) {
      const diff = target - creditsShown;
      const step = Math.max(1, Math.abs(diff) / 12 | 0);
      creditsShown += clamp(diff, -step, step);
      if (Math.abs(diff) > 2) AUDIO.tickCredits();
    }
    // storage cap shown beside the balance; red when the silos are full —
    // that's when harvester loads start evaporating
    // idle harvester alert: only shows when the economy has actually stalled
    // (harvesters idle only once every reachable field is gone or blocked);
    // click it to jump to the next idle one
    const idleHarv = _idleHarvCount(g);
    if (idleHarv > 0 && ((g.tick >> 4) & 1) === 0) {
      ctx.fillStyle = '#d8c020';
      ctx.fillText('IDLE HARV: ' + idleHarv, C.VIEW_PW - 356, 8);
    }

    const full = g.human.storage > 0 && g.human.credits >= g.human.storage - 1;
    ctx.fillStyle = full ? PAL.uiRed : PAL.uiGold;
    ctx.fillText('$ ' + creditsShown, C.VIEW_PW - 220, 8);
    if (g.human.storage > 0) {   // "/0" before the first refinery is just noise
      ctx.fillStyle = full ? PAL.uiRed : '#8a836e';
      ctx.fillText('/' + Math.floor(g.human.storage), C.VIEW_PW - 220 + ctx.measureText('$ ' + creditsShown).width + 6, 8);
    }

    // mission timer + side
    const secs = Math.floor(g.tick / C.TPS);
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    ctx.fillStyle = PAL.uiText;
    ctx.fillText(mm + ':' + ss, C.SIDEBAR_X + 220, 8);
    ctx.fillText(C.SIDE_NAME[g.humanSide] || g.humanSide.toUpperCase(), C.SIDEBAR_X + 16, 8);
  }

  // ---- sidebar -------------------------------------------------------------------------------

  function _drawSidebar(g) {
    const p = g.human;
    ctx.fillStyle = PAL.uiMetal;
    ctx.fillRect(C.SIDEBAR_X, C.TAB_H, C.SIDEBAR_W, C.SCREEN_H - C.TAB_H);
    // lit seam where the sidebar meets the battlefield (a warm gold hairline
    // over a bright/dark bevel) — frames the viewport
    ctx.fillStyle = 'rgba(224,184,64,0.30)';
    ctx.fillRect(C.SIDEBAR_X, C.TAB_H, 1, C.SCREEN_H - C.TAB_H);
    ctx.fillStyle = PAL.uiMetalLight;
    ctx.fillRect(C.SIDEBAR_X + 1, C.TAB_H, 2, C.SCREEN_H - C.TAB_H);
    ctx.fillStyle = PAL.uiMetalDark;
    ctx.fillRect(C.SIDEBAR_X + 3, C.TAB_H, 1, C.SCREEN_H - C.TAB_H);

    // power bar along the sidebar's left edge
    const pb = p.power;
    const barTop = C.RADAR_Y + C.RADAR_H, barH = C.SCREEN_H - barTop;
    ctx.fillStyle = PAL.uiMetalDark;
    ctx.fillRect(C.SIDEBAR_X, barTop, 8, barH);
    const scale = Math.max(pb.out, pb.drain, 100) * 1.2;
    const outH = Math.round(pb.out / scale * barH);
    const low = pb.drain > pb.out;
    ctx.fillStyle = low ? PAL.uiRed : (pb.drain > pb.out * 0.8 ? '#d8c020' : PAL.uiGreen);
    ctx.fillRect(C.SIDEBAR_X, barTop + barH - outH, 8, outH);
    const drainY = barTop + barH - Math.round(pb.drain / scale * barH);
    ctx.fillStyle = '#fff';
    ctx.fillRect(C.SIDEBAR_X, drainY, 8, 4);

    // radar — recessed bezel with a gold inner hairline
    const rx = C.RADAR_X + 8, rw = C.RADAR_W - 8;
    _bevel(rx - 3, C.RADAR_Y - 3, rw + 6, C.RADAR_H + 6, false);
    ctx.fillStyle = '#000';
    ctx.fillRect(rx, C.RADAR_Y, rw, C.RADAR_H);
    ctx.strokeStyle = 'rgba(224,184,64,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(rx + 0.5, C.RADAR_Y + 0.5, rw - 1, C.RADAR_H - 1);
    if (p.radar) {
      if (g.tick - minimapTick >= 8 || minimapTick > g.tick) { _updateMinimap(g); minimapTick = g.tick; }
      ctx.drawImage(minimap, C.MM_X, C.MM_Y);
      _drawRadarBlips(g);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.strokeRect(
        C.MM_X + g.camera.x / (C.MAP_W * C.CELL) * C.MM_S + 0.5,
        C.MM_Y + g.camera.y / (C.MAP_H * C.CELL) * C.MM_S + 0.5,
        C.VIEW_W / (C.MAP_W * C.CELL) * C.MM_S,
        C.VIEW_H / (C.MAP_H * C.CELL) * C.MM_S);
    } else {
      const logo = SPRITES.logo[g.humanSide];
      if (logo) {
        const lw = logo.width * 2, lh = logo.height * 2;
        ctx.drawImage(logo, C.RADAR_X + (C.RADAR_W - lw) / 2 + 4,
          C.RADAR_Y + (C.RADAR_H - lh) / 2, lw, lh);
      }
    }

    // buttons
    const btns = [['REPAIR', C.SIDEBAR_X + 8, 'repair'], ['SELL', C.SIDEBAR_X + 112, 'sell'], ['MAP', C.SIDEBAR_X + 216, 'map']];
    ctx.font = '16px monospace';
    for (const [label, bx, which] of btns) {
      const active = Input.mode === which;
      _bevel(bx, C.BTN_Y + 4, 96, C.BTN_H - 8, active);
      ctx.fillStyle = which === 'map' ? '#7a7a70' : (active ? PAL.uiGold : PAL.uiText);
      ctx.fillText(label, bx + 48 - label.length * 5, C.BTN_Y + 14);
    }

    // strips
    const it = Production.items(p);
    ctx.font = '14px monospace';
    for (const strip of ['b', 'u']) {
      const sx = strip === 'b' ? C.STRIP_BX : C.STRIP_UX;
      const list = strip === 'b' ? it.buildings : it.units;
      const scroll = clamp(p.scroll[strip], 0, Math.max(0, list.length - C.STRIP_VISIBLE));
      p.scroll[strip] = scroll;
      for (let i = 0; i < C.STRIP_VISIBLE; i++) {
        const iy = C.STRIP_Y + i * C.STRIP_SPACING;
        const item = list[scroll + i];
        if (!item) {
          ctx.fillStyle = PAL.uiMetalDark;
          ctx.fillRect(sx, iy, C.CAMEO_PW, C.CAMEO_PH);
          continue;
        }
        const cameo = SPRITES.cameo[item.super ? item.key + 'Strike' : item.key];
        if (cameo) ctx.drawImage(cameo, sx, iy, C.CAMEO_PW, C.CAMEO_PH);
        if (item.state === 'building' || item.state === 'hold' || item.state === 'charging') {
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(sx, iy, C.CAMEO_PW, C.CAMEO_PH);
          // clock sweep
          ctx.fillStyle = 'rgba(255,255,255,0.35)';
          ctx.beginPath();
          ctx.moveTo(sx + C.CAMEO_PW / 2, iy + C.CAMEO_PH / 2);
          ctx.arc(sx + C.CAMEO_PW / 2, iy + C.CAMEO_PH / 2, 80,
            -Math.PI / 2, -Math.PI / 2 + item.frac * Math.PI * 2);
          ctx.closePath();
          ctx.save();
          ctx.beginPath();
          ctx.rect(sx, iy, C.CAMEO_PW, C.CAMEO_PH);
          ctx.clip();
          ctx.fill();
          ctx.restore();
          if (item.state === 'hold') {
            ctx.fillStyle = '#f0d020';
            ctx.fillText('ON HOLD', sx + 33, iy + 42);
          } else if (item.state === 'building' && item.eta > 0) {
            const t = Math.floor(item.eta / 60) + ':' + String(item.eta % 60).padStart(2, '0');
            ctx.fillStyle = 'rgba(0,0,0,0.65)';
            ctx.fillRect(sx + 40, iy + 38, 48, 20);
            ctx.fillStyle = '#fff';
            ctx.fillText(t, sx + 46, iy + 41);
          }
          if (item.state === 'charging') {
            const p2 = g.human.super;
            const s = Math.ceil(p2.timer / C.TPS);
            const t = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
            ctx.fillStyle = '#fff';
            ctx.fillText(t, sx + 44, iy + 41);
          }
        } else if (item.state === 'ready') {
          // unmissable: pulsing gold frame + brightening wash + big READY tag
          const pulse = (g.tick >> 2) & 1;
          ctx.fillStyle = pulse ? 'rgba(255,235,150,0.28)' : 'rgba(255,215,90,0.12)';
          ctx.fillRect(sx, iy, C.CAMEO_PW, C.CAMEO_PH);
          ctx.strokeStyle = pulse ? '#ffe789' : PAL.uiGold;
          ctx.lineWidth = 3;
          ctx.strokeRect(sx + 1.5, iy + 1.5, C.CAMEO_PW - 3, C.CAMEO_PH - 3);
          ctx.fillStyle = 'rgba(0,0,0,0.72)';
          ctx.fillRect(sx + 20, iy + 34, C.CAMEO_PW - 40, 26);
          ctx.font = 'bold 17px monospace';
          ctx.fillStyle = pulse ? '#fff' : '#ffe789';
          ctx.fillText('READY', sx + 37, iy + 39);
          ctx.font = '14px monospace';
        }
        // queued-unit count badge
        if (item.count > 1 || (item.count === 1 && item.state === 'idle')) {
          ctx.fillStyle = 'rgba(0,0,0,0.7)';
          ctx.fillRect(sx + C.CAMEO_PW - 34, iy + 2, 32, 20);
          ctx.fillStyle = PAL.uiGold;
          ctx.fillText('x' + item.count, sx + C.CAMEO_PW - 30, iy + 5);
        }
        // cost badge, top-left, always on top so it reads in every state
        if (!item.super) {
          const cd = DATA.buildings[item.key] || DATA.units[item.key];
          if (cd) {
            const label = '$' + cd.cost;
            const w = ctx.measureText(label).width + 8;
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fillRect(sx + 2, iy + 2, w, 17);
            ctx.fillStyle = PAL.uiGold;
            ctx.fillText(label, sx + 6, iy + 5);
          }
        }
        // hover highlight
        if (Input.mouse.x >= sx && Input.mouse.x < sx + C.CAMEO_PW &&
            Input.mouse.y >= iy && Input.mouse.y < iy + C.CAMEO_PH) {
          ctx.strokeStyle = PAL.uiGold;
          ctx.lineWidth = 1;
          ctx.strokeRect(sx + 0.5, iy + 0.5, C.CAMEO_PW - 1, C.CAMEO_PH - 1);
        }
      }
      // scroll arrows
      const ay = C.STRIP_Y + C.STRIP_VISIBLE * C.STRIP_SPACING;
      const canUp = scroll > 0, canDown = scroll < list.length - C.STRIP_VISIBLE;
      _bevel(sx, ay, 60, 24);
      _bevel(sx + 68, ay, 60, 24);
      ctx.fillStyle = canUp ? PAL.uiText : '#6a6a60';
      ctx.fillText('▲', sx + 23, ay + 5);
      ctx.fillStyle = canDown ? PAL.uiText : '#6a6a60';
      ctx.fillText('▼', sx + 91, ay + 5);
    }

    // low power warning
    if (p.power.drain > p.power.out && (g.tick >> 3) & 1) {
      ctx.fillStyle = PAL.uiRed;
      ctx.font = '16px monospace';
      ctx.fillText('LOW POWER', C.SIDEBAR_X + 96, C.BTN_Y - 22);
    }
  }

  // ---- EVA announcement banner ----------------------------------------------------------------

  function _drawEvaBanner() {
    if (!evaMsg) return;
    const LIFE = 3.9;
    const age = (_nowMs() - evaMsg.born) / 1000;
    if (age > LIFE) { evaMsg = null; return; }
    let a = 1;
    if (age < 0.16) a = age / 0.16;
    else if (age > LIFE - 0.7) a = (LIFE - age) / 0.7;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, a));
    ctx.font = 'bold 20px monospace';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(evaMsg.text).width;
    const cx = C.VIEW_PW / 2;
    const bh = 34, by = C.TAB_H + 12, bw = tw + 40, bx = Math.round(cx - bw / 2);
    ctx.fillStyle = 'rgba(8,14,10,0.74)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = PAL.uiGold; ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    // small blinking transmit dot at the left
    if ((((_nowMs() / 260) | 0) & 1) === 0) {
      ctx.fillStyle = PAL.uiGreen || '#40c040';
      ctx.fillRect(bx + 10, by + bh / 2 - 3, 6, 6);
    }
    ctx.fillStyle = PAL.uiGold;
    ctx.fillText(evaMsg.text, Math.round(cx - tw / 2 + 8), by + bh / 2 + 1);
    ctx.restore();
  }

  // ---- mission objective HUD line --------------------------------------------------------------

  function _objStatus(g) {
    // endgame assist beats everything: show how many targets are left once
    // the enemy is broken (skirmish and campaign alike)
    const hunt = _huntCount(g);
    if (hunt && g.status === 'playing') return 'TARGETS REMAINING: ' + hunt;
    const m = g.mission;
    if (!m || !m.objective) return null;   // skirmish: no objective chrome
    const ob = m.objective;
    if (ob.type === 'harvest') {
      return 'TREASURY ' + Math.min(ob.amount, Math.floor(g.human.credits)) + ' / ' + ob.amount;
    }
    if (ob.type === 'survive') {
      const left = Math.max(0, ob.minutes * 60 * C.TPS - g.tick);
      const s = Math.ceil(left / C.TPS);
      return 'HOLD OUT ' + String((s / 60) | 0).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    }
    if (ob.type === 'killEconomy') {
      let n = 0;
      for (const id of g.ai.buildingIds) {
        const b = g.buildings.get(id);
        if (b && b.type === 'proc') n++;
      }
      for (const id of g.ai.unitIds) {
        const u = g.units.get(id);
        if (u && DATA.units[u.type].harvester) n++;
      }
      return n > 0 ? 'ECONOMY TARGETS LEFT: ' + n : 'FIND THE ENEMY ECONOMY';
    }
    if (ob.type === 'capture') {
      const bt = typeof ob.btype === 'object' ? ob.btype[g.humanSide] : ob.btype;
      return 'CAPTURE THE ' + DATA.buildings[bt].name.toUpperCase() + ' — INTACT';
    }
    if (ob.type === 'escort') {
      const d = ob.dest === 'ai' ? g.startPos.ai : ob.dest;
      let esc = null;
      for (const id of g.human.unitIds) {
        const u = g.units.get(id);
        if (u && u.type === ob.unit) { esc = u; break; }
      }
      if (esc) {
        const cells = Math.round(dist(esc.x, esc.y, cellCenterX(d.cx), cellCenterY(d.cy)) / C.CELL);
        return 'DELIVER THE TRANSPORT — ' + cells + ' CELLS TO THE BEACON';
      }
      return 'DELIVER THE TRANSPORT TO THE BEACON';
    }
    return 'DESTROY ALL ENEMY FORCES';
  }

  function _drawObjective(g) {
    const s = _objStatus(g);
    if (!s) return;
    ctx.font = 'bold 16px monospace';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(s).width;
    const bx = 8, by = C.TAB_H + 8, bh = 26;
    ctx.fillStyle = 'rgba(8,14,10,0.6)';
    ctx.fillRect(bx, by, tw + 16, bh);
    ctx.strokeStyle = 'rgba(224,184,64,0.5)'; ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, tw + 15, bh - 1);
    ctx.fillStyle = PAL.uiGold;
    ctx.fillText(s, bx + 8, by + bh / 2 + 1);
    ctx.textBaseline = 'alphabetic';
  }

  // watching a recorded battle: an unmissable badge so nobody mistakes it
  // for a live game they've lost control of
  function _drawReplayBadge(g) {
    if (typeof REPLAY === 'undefined' || !REPLAY.playing) return;
    if (g._ffTarget) return;   // resuming a save, not spectating
    ctx.font = 'bold 14px monospace';
    ctx.textBaseline = 'middle';
    const s = '▶ REPLAY';
    const bw = ctx.measureText(s).width + 22;
    const bx = C.VIEW_PW / 2 - bw / 2, by = C.TAB_H + 8;
    ctx.fillStyle = 'rgba(20,10,8,0.8)';
    ctx.fillRect(bx, by, bw, 24);
    ctx.strokeStyle = ((g.tick >> 4) & 1) ? '#e05038' : '#8a2c20';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, 23);
    ctx.fillStyle = '#f0c8b8';
    ctx.fillText(s, bx + 11, by + 13);
    ctx.textBaseline = 'alphabetic';
  }

  // ---- multiplayer stall notice ----------------------------------------------------------------

  function _drawNetStall(g) {
    if (typeof NET === 'undefined' || !NET.active || g.status !== 'playing') return;
    if (g.paused) return;                       // our own pause isn't their fault
    if (!NET.remotePaused && NET.stalledMs() < 600) return;
    const s = NET.remotePaused ? 'OPPONENT PAUSED' : 'WAITING FOR OPPONENT…';
    ctx.font = 'bold 20px monospace';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(s).width;
    const cx = C.VIEW_PW / 2, by = C.TAB_H + 60, bh = 34, bw = tw + 40;
    const bx = Math.round(cx - bw / 2);
    ctx.fillStyle = 'rgba(20,8,8,0.78)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = PAL.uiRed; ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    ctx.fillStyle = '#e8c8b8';
    ctx.fillText(s, bx + 20, by + bh / 2 + 1);
    ctx.textBaseline = 'alphabetic';
  }

  // ---- cursor ---------------------------------------------------------------------------------

  function _drawCursor() {
    const kind = Input.cursorKind || 'default';
    const cur = SPRITES.cursor[kind] || SPRITES.cursor.default;
    if (!cur) return;
    ctx.drawImage(cur.c,
      Math.round(Input.mouse.x - cur.hx * Z),
      Math.round(Input.mouse.y - cur.hy * Z),
      cur.c.width * Z, cur.c.height * Z);
  }

  // ---- living menu backdrop --------------------------------------------------------------------
  // A slow war-room scene behind the menus (drawn when no game exists): dawn
  // gradient, drifting tactical grid, additive embers, vignette + scanlines.
  // Render-only, no sim — time from performance.now, particles from Math.random.

  let menuGrad = null, menuGW = 0, menuGH = 0, menuVig = null, menuHoriz = null;
  let menuScan = null;
  let embers = null, menuLastT = 0;

  function _menuBackdrop() {
    const w = C.SCREEN_W, h = C.SCREEN_H;
    const t = _nowMs() / 1000;
    let dt = t - menuLastT; menuLastT = t;
    if (dt < 0 || dt > 0.1) dt = 0.016;

    if (!menuGrad || menuGW !== w || menuGH !== h) {
      const gg = ctx.createLinearGradient(0, 0, 0, h);
      gg.addColorStop(0, '#0a0f1e');       // deep indigo sky
      gg.addColorStop(0.5, '#221b22');
      gg.addColorStop(0.6, '#2c2118');     // warm horizon
      gg.addColorStop(0.63, '#16130e');
      gg.addColorStop(1, '#090a08');       // dark ground
      menuGrad = gg; menuGW = w; menuGH = h;
      // cached vignette
      const vc = mkCanvas(w, h), vq = vc.getContext('2d');
      const vr = vq.createRadialGradient(w / 2, h / 2, h * 0.28, w / 2, h / 2, Math.sqrt(w * w + h * h) / 2);
      vr.addColorStop(0, 'rgba(0,0,0,0)');
      vr.addColorStop(1, 'rgba(0,0,0,0.7)');
      vq.fillStyle = vr; vq.fillRect(0, 0, w, h);
      menuVig = vc;
      // cached 2px scanline tile
      const sc = mkCanvas(4, 4), sq = sc.getContext('2d');
      sq.fillStyle = 'rgba(0,0,0,0.10)'; sq.fillRect(0, 2, 4, 1);
      menuScan = ctx.createPattern(sc, 'repeat');
      // cached warm horizon glow
      const hb = ctx.createRadialGradient(w / 2, h * 0.6, 0, w / 2, h * 0.6, w * 0.55);
      hb.addColorStop(0, 'rgba(190,116,44,0.20)');
      hb.addColorStop(1, 'rgba(190,116,44,0)');
      menuHoriz = hb;
    }
    ctx.fillStyle = menuGrad;
    ctx.fillRect(0, 0, w, h);

    // warm horizon glow
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = menuHoriz;
    ctx.fillRect(0, h * 0.35, w, h * 0.45);
    ctx.globalCompositeOperation = 'source-over';

    // drifting tactical grid
    const cell = 58, ox = (t * 6) % cell, oy = (t * 4) % cell;
    ctx.strokeStyle = 'rgba(224,184,64,0.055)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = -cell + ox; x <= w; x += cell) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h); }
    for (let y = -cell + oy; y <= h; y += cell) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5); }
    ctx.stroke();

    // drifting embers
    if (!embers) {
      embers = [];
      for (let i = 0; i < 46; i++) embers.push({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 8, vy: -(6 + Math.random() * 16),
        r: Math.random() < 0.28 ? 2 : 1, tw: Math.random() * Math.PI * 2,
      });
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const e of embers) {
      e.x += e.vx * dt; e.y += e.vy * dt;
      if (e.y < -4) { e.y = h + 4; e.x = Math.random() * w; }
      if (e.x < -4) e.x = w + 4; else if (e.x > w + 4) e.x = -4;
      const a = 0.34 + 0.34 * Math.sin(t * 3 + e.tw);
      ctx.fillStyle = 'rgba(255,190,92,' + a.toFixed(3) + ')';
      ctx.fillRect(e.x | 0, e.y | 0, e.r, e.r);
    }
    ctx.globalCompositeOperation = 'source-over';

    // scanlines + vignette
    if (menuScan) { ctx.fillStyle = menuScan; ctx.fillRect(0, 0, w, h); }
    if (menuVig) ctx.drawImage(menuVig, 0, 0);
  }

  // ---- sidebar tooltip ------------------------------------------------------------------------

  // hover is a fine-pointer concept; on touch the finger covers the tooltip anyway
  const fineTip = typeof matchMedia !== 'undefined' && matchMedia('(pointer: fine)').matches;

  function _wrapTip(text, maxW) {
    const words = text.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; }
      else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function _drawIconTooltip(g) {
    if (!fineTip || !Input.mouse.inside || g.paused) return;
    const hit = hitTest(Input.mouse.x, Input.mouse.y);
    if (hit.zone !== 'icon') return;
    const d = DATA.units[hit.key] || DATA.buildings[hit.key];
    if (!d) return;
    const bd = DATA.buildings[hit.key];
    const name = hit.super ? (d.superweapon === 'ion' ? 'Orbital Lance' : 'Nuclear Missile') : d.name;
    const blurb = (DATA.blurb && DATA.blurb[hit.super ? hit.key + 'Strike' : hit.key]) || '';
    ctx.font = '13px monospace';
    const lines = blurb ? _wrapTip(blurb, 262) : [];
    const power = (!hit.super && bd) ? (bd.power || -(bd.drain || 0)) : 0;
    const w = 292;
    const h = 30 + lines.length * 17 + (power ? 19 : 0) + 9;
    const x = C.SIDEBAR_X - w - 10;
    const y = clamp(Input.mouse.y - 16, C.TAB_H + 8, C.SCREEN_H - h - 8);
    ctx.fillStyle = 'rgba(14,14,10,0.93)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(224,184,64,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.textBaseline = 'top';
    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = PAL.uiGold;
    ctx.fillText(name, x + 10, y + 8);
    if (!hit.super && d.cost) {
      const tag = '$' + d.cost;
      ctx.fillStyle = PAL.uiText;
      ctx.fillText(tag, x + w - 10 - ctx.measureText(tag).width, y + 8);
    }
    ctx.font = '13px monospace';
    ctx.fillStyle = '#b8b09a';
    let ty = y + 29;
    for (const ln of lines) { ctx.fillText(ln, x + 10, ty); ty += 17; }
    if (power) {
      ctx.fillStyle = power > 0 ? PAL.uiGreen : '#d88860';
      ctx.fillText(power > 0 ? 'Power +' + power : 'Power drain ' + (-power), x + 10, ty + 2);
    }
    ctx.textBaseline = 'alphabetic';
  }

  // ---- battle intro & verdict overlays ----------------------------------------------------------

  // opening beat: fade up from black, mission title card over the viewport.
  // Pure render (keyed off g.tick) — deterministic across MP peers and replays.
  function _drawIntro(g) {
    if (g.status !== 'playing') return;
    if (g._ffTarget) return;   // the resume veil owns the screen
    const t = g.tick;
    if (t < 26) {
      ctx.fillStyle = 'rgba(0,0,0,' + (0.92 * (1 - t / 26)).toFixed(3) + ')';
      ctx.fillRect(0, 0, C.SCREEN_W, C.SCREEN_H);
    }
    if (g.introLabel && t < 58) {
      const a = t < 8 ? t / 8 : t > 46 ? Math.max(0, (58 - t) / 12) : 1;
      const cx2 = C.VIEW_PW / 2, cy2 = C.TAB_H + (C.SCREEN_H - C.TAB_H) * 0.18;
      ctx.fillStyle = 'rgba(0,0,0,' + (0.44 * a).toFixed(3) + ')';
      ctx.fillRect(0, cy2 - 36, C.VIEW_PW, 72);
      ctx.fillStyle = 'rgba(224,184,64,' + (0.75 * a).toFixed(3) + ')';
      ctx.fillRect(cx2 - 260, cy2 - 36, 520, 2);
      ctx.fillRect(cx2 - 260, cy2 + 34, 520, 2);
      ctx.font = 'bold 30px monospace';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(232,206,120,' + a.toFixed(3) + ')';
      ctx.fillText(g.introLabel, cx2 - ctx.measureText(g.introLabel).width / 2, cy2 + 2);
      ctx.textBaseline = 'alphabetic';
    }
  }

  // closing beat: the battlefield takes on the verdict's color while the
  // score panel spins up (render-local ramp; the sim is already over)
  let verdictT = 0;
  function _drawVerdict(g) {
    if (g.status !== 'won' && g.status !== 'lost') { verdictT = 0; return; }
    verdictT = Math.min(verdictT + 1, 48);
    const a = verdictT / 48;
    ctx.fillStyle = g.status === 'won'
      ? 'rgba(224,184,64,' + (0.09 * a).toFixed(3) + ')'
      : 'rgba(150,26,16,' + (0.14 * a).toFixed(3) + ')';
    ctx.fillRect(0, 0, C.SCREEN_W, C.SCREEN_H);
    ctx.fillStyle = 'rgba(0,0,0,' + ((g.status === 'won' ? 0.16 : 0.30) * a).toFixed(3) + ')';
    ctx.fillRect(0, 0, C.SCREEN_W, C.SCREEN_H);
  }

  // save-resume catch-up: a full veil with a progress bar while the main loop
  // burns through the recorded battle (game._ffTarget = tick to reach)
  function _drawResume(g) {
    if (!g._ffTarget) return;
    const pct = Math.min(100, Math.floor(100 * g.tick / g._ffTarget));
    ctx.fillStyle = 'rgba(4,8,6,0.88)';
    ctx.fillRect(0, 0, C.SCREEN_W, C.SCREEN_H);
    const cx2 = C.SCREEN_W / 2, cy2 = C.SCREEN_H / 2;
    ctx.font = 'bold 26px monospace';
    ctx.fillStyle = '#e0b840';
    const t1 = 'RESUMING OPERATION';
    ctx.fillText(t1, cx2 - ctx.measureText(t1).width / 2, cy2 - 30);
    const bw = 380, bh = 14;
    ctx.strokeStyle = '#7a6420';
    ctx.lineWidth = 2;
    ctx.strokeRect(cx2 - bw / 2, cy2 - 7, bw, bh);
    ctx.fillStyle = '#b89430';
    ctx.fillRect(cx2 - bw / 2 + 2, cy2 - 5, (bw - 4) * pct / 100, bh - 4);
    ctx.font = '15px monospace';
    ctx.fillStyle = '#98c8a0';
    const t2 = 'replaying your battle — ' + pct + '%';
    ctx.fillText(t2, cx2 - ctx.measureText(t2).width / 2, cy2 + 34);
  }

  // ---- frame ----------------------------------------------------------------------------------

  function frame(g) {
    if (!ctx) return;
    if (!g) {
      _menuBackdrop();
      return;
    }
    seeAll = typeof REPLAY !== 'undefined' && REPLAY.playing;
    revealAll = _computeRevealAll(g);
    _drawViewport(g);
    _drawTabBar(g);
    _drawSidebar(g);
    _drawObjective(g);
    _drawNetStall(g);
    _drawReplayBadge(g);
    _drawEvaBanner();
    _drawF1Tip(g);
    _drawIconTooltip(g);
    _drawVerdict(g);
    _drawIntro(g);
    _drawResume(g);
    if (Input.mouse.inside && !g.paused && !g._ffTarget) _drawCursor();
    shownTick = g.tick;
  }

  return { init, frame, resize, worldFromScreen, hitTest };
})();
