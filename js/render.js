'use strict';
// render.js — draws the whole 640x400 frame: viewport, tab bar, sidebar,
// radar, cursor. Global: Render.

const Render = (function () {
  let cv = null, ctx = null;
  let terrainCache = null;      // full-map prerender
  let terrainCacheSeed = -1;
  let animCells = [];           // water/blossom cells redrawn live
  let minimap = null, minimapTick = -10;
  let creditsShown = 0;
  let shownTick = -1, shakeX = 0, shakeY = 0;

  function init(canvas) {
    cv = canvas;
    ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    minimap = mkCanvas(128, 128);
  }

  // ---- coordinate helpers ------------------------------------------------------

  function worldFromScreen(x, y) {
    if (!game || x < 0 || x >= C.VIEW_W || y < C.TAB_H || y >= C.SCREEN_H) return null;
    return { x: x + game.camera.x, y: y - C.TAB_H + game.camera.y };
  }

  function hitTest(x, y) {
    if (y < C.TAB_H) {
      if (x < 60) return { zone: 'tab-options' };
      return { zone: 'tab' };
    }
    if (x < C.VIEW_W) return { zone: 'viewport' };
    if (x >= C.RADAR_X && y >= C.RADAR_Y && y < C.RADAR_Y + C.RADAR_H) return { zone: 'radar' };
    if (y >= C.BTN_Y && y < C.BTN_Y + C.BTN_H) {
      if (x >= 484 && x < 532) return { zone: 'btn', which: 'repair' };
      if (x >= 536 && x < 584) return { zone: 'btn', which: 'sell' };
      if (x >= 588 && x < 636) return { zone: 'btn', which: 'map' };
      return { zone: 'sidebar' };
    }
    if (game && game.human) {
      const it = Production.items(game.human);
      for (const strip of ['b', 'u']) {
        const sx = strip === 'b' ? C.STRIP_BX : C.STRIP_UX;
        if (x < sx || x >= sx + C.CAMEO_W) continue;
        // scroll arrows
        if (y >= 372 && y < 384) {
          return { zone: 'arrow', strip, dir: x < sx + 32 ? -1 : 1 };
        }
        const list = strip === 'b' ? it.buildings : it.units;
        for (let i = 0; i < C.STRIP_VISIBLE; i++) {
          const iy = C.STRIP_Y + i * C.STRIP_SPACING;
          if (y >= iy && y < iy + C.CAMEO_H) {
            const item = list[game.human.scroll[strip] + i];
            if (item) return { zone: 'icon', strip, key: item.key, state: item.state, super: !!item.super };
          }
        }
      }
    }
    return { zone: 'sidebar' };
  }

  // ---- terrain cache -------------------------------------------------------------

  function _buildTerrainCache(g) {
    terrainCache = mkCanvas(C.MAP_W * C.CELL, C.MAP_H * C.CELL);
    const tc = terrainCache.getContext('2d');
    tc.imageSmoothingEnabled = false;
    animCells = [];
    for (let cy = 0; cy < C.MAP_H; cy++) {
      for (let cx = 0; cx < C.MAP_W; cx++) {
        const i = cellIdx(cx, cy);
        const t = g.terrain[i];
        const variants = SPRITES.terrain[t] || SPRITES.terrain[0];
        if (!variants || !variants.length) continue;
        tc.drawImage(variants[g.tvar[i] % variants.length], cx * C.CELL, cy * C.CELL);
        if (t === 3 || t === 5) animCells.push({ cx, cy, t });
      }
    }
    terrainCacheSeed = g.seed;
  }

  // ---- minimap ---------------------------------------------------------------------

  const TCOLOR = ['#3e5429', '#8f7a4e', '#6e6e66', '#1e4468', '#1e3416', '#c890b8'];

  function _updateMinimap(g) {
    const mc = minimap.getContext('2d');
    mc.fillStyle = '#000';
    mc.fillRect(0, 0, 128, 128);
    for (let cy = 0; cy < C.MAP_H; cy++) {
      for (let cx = 0; cx < C.MAP_W; cx++) {
        const i = cellIdx(cx, cy);
        if (g.shroud[i] !== 1) continue;
        mc.fillStyle = g.tib[i] > 0 ? PAL.tib2 : TCOLOR[g.terrain[i]] || TCOLOR[0];
        mc.fillRect(cx * 2, cy * 2, 2, 2);
      }
    }
    // faction colors: GDI gold, Nod red, creatures sickly green
    const OWNER_COLOR = { gdi: '#ffd23c', nod: '#ff2418', mut: '#4ce03c' };
    for (const b of g.buildings.values()) {
      if (g.shroud[cellIdx(b.cx, b.cy)] !== 1) continue;
      mc.fillStyle = OWNER_COLOR[b.owner] || '#ccc';
      mc.fillRect(b.cx * 2, b.cy * 2, b.w * 2, b.h * 2);
    }
    for (const u of g.units.values()) {
      const cx = worldToCell(u.x), cy = worldToCell(u.y);
      const i = cellIdx(cx, cy);
      if (g.shroud[i] !== 1) continue;
      if (u.owner !== g.humanSide) {
        // enemy blips only where MY forces can currently see, not just explored
        if (!g.visible || g.visible[i] !== 1) continue;
        if (u.cloaked) continue;
      }
      mc.fillStyle = OWNER_COLOR[u.owner] || '#ccc';
      mc.fillRect(cx * 2, cy * 2, 2, 2);
    }
  }

  // ---- entity drawing ----------------------------------------------------------------

  function _healthColor(frac) {
    return frac > 2 / 3 ? PAL.uiGreen : frac > 1 / 3 ? '#d8c020' : PAL.uiRed;
  }

  function _drawHealthBar(x, y, w, frac) {
    ctx.fillStyle = '#000';
    ctx.fillRect(x, y, w, 4);
    ctx.fillStyle = _healthColor(frac);
    ctx.fillRect(x + 1, y + 1, Math.max(1, Math.round((w - 2) * frac)), 2);
  }

  function _drawBrackets(x, y, w, h) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    const s = Math.max(4, Math.min(7, w >> 2));
    ctx.beginPath();
    // four corners
    ctx.moveTo(x + 0.5, y + s); ctx.lineTo(x + 0.5, y + 0.5); ctx.lineTo(x + s, y + 0.5);
    ctx.moveTo(x + w - s, y + 0.5); ctx.lineTo(x + w - 0.5, y + 0.5); ctx.lineTo(x + w - 0.5, y + s);
    ctx.moveTo(x + w - 0.5, y + h - s); ctx.lineTo(x + w - 0.5, y + h - 0.5); ctx.lineTo(x + w - s, y + h - 0.5);
    ctx.moveTo(x + s, y + h - 0.5); ctx.lineTo(x + 0.5, y + h - 0.5); ctx.lineTo(x + 0.5, y + h - s);
    ctx.stroke();
  }

  function _drawBuilding(g, b, ox, oy) {
    const set = SPRITES.buildings[b.type] && SPRITES.buildings[b.type][b.owner];
    if (!set) return;
    // tall structures (towers, obelisk) rise above their footprint: set.yOff
    // pixels of the canvas sit ABOVE the anchor cell
    const x = b.cx * C.CELL - ox, y = b.cy * C.CELL - oy - (set.yOff || 0);
    const damaged = b.hp < b.maxHp * 0.5;
    let frames = damaged && set.damaged ? set.damaged : set.normal;
    if (b.type === 'obli' && b.charging && set.charge) {
      frames = set.charge;
    } else if (b.type === 'sam' && b.targetId && set.open) {
      frames = set.open;
    }
    const frame = frames[((g.tick >> 3) + b.id) % frames.length];

    if (b.buildProgress < 1) {
      // construction: rising bottom-up reveal with scaffold flicker
      const H = frame.height;
      const vis = Math.max(1, Math.round(H * b.buildProgress));
      ctx.drawImage(frame, 0, H - vis, frame.width, vis, x, y + H - vis - 8 + 8, frame.width, vis);
      if (g.tick & 1) {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(x, y + H - vis, frame.width, 2);
      }
      return;
    }
    ctx.drawImage(frame, x, y);
    if (b.type === 'gun' && set.turret) {
      ctx.drawImage(set.turret[b.turretFacing & 15], x, y - 4);
    }
    if (b.repairing && (g.tick >> 3) & 1 && SPRITES.fx.wrench) {
      const wr = SPRITES.fx.wrench[0];
      ctx.drawImage(wr, x + (b.w * C.CELL - wr.width) / 2, y + (b.h * C.CELL - wr.height) / 2);
    }
  }

  function _drawUnit(g, u, ox, oy) {
    const d = DATA.units[u.type];
    const hidden = u.cloaked && u.owner !== g.humanSide;
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
      if (img && img.width) ctx.drawImage(img, Math.round(u.x - 12 - ox), Math.round(u.y - 12 - oy));
      else ctx.drawImage(set.stand[f8], Math.round(u.x - 12 - ox), Math.round(u.y - 12 - oy));
      return;
    }

    const set = SPRITES.units[u.type] && SPRITES.units[u.type][u.owner];
    if (!set) return;
    const air = d.air;
    let x = Math.round(u.x - 12 - ox), y = Math.round(u.y - 12 - oy);

    if (air) {
      // shadow + bob
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(u.x - ox, u.y - oy + 12, 8, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      y -= 8 + Math.round(Math.sin(u.anim / 6) * 2);
    }

    const cloakAlpha = u.cloaked && u.owner === g.humanSide;
    if (cloakAlpha) ctx.globalAlpha = 0.35;
    ctx.drawImage(set.body[u.facing & 15], x, y);
    if (set.turret) ctx.drawImage(set.turret[u.turretFacing & 15], x, y);
    if (set.anim && set.anim.length) {
      const a = set.anim[(u.anim >> 1) % set.anim.length];
      const af = a && a[u.facing & 15];
      const img = af || a;
      if (img && img.width) ctx.drawImage(img, x, y);
    }
    if (cloakAlpha) ctx.globalAlpha = 1;
  }

  // ---- effects ------------------------------------------------------------------------

  function _drawEffect(g, e, ox, oy) {
    switch (e.name) {
      case 'tracer':
        ctx.strokeStyle = '#f8e850';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(e.x1 - ox, e.y1 - oy);
        ctx.lineTo(e.x2 - ox, e.y2 - oy);
        ctx.stroke();
        return;
      case 'laserBeam':
        ctx.strokeStyle = PAL.laser;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(e.x1 - ox, e.y1 - oy);
        ctx.lineTo(e.x2 - ox, e.y2 - oy);
        ctx.stroke();
        return;
      case 'ionBeam': {
        const x = e.x - ox;
        ctx.fillStyle = 'rgba(168,216,248,0.75)';
        ctx.fillRect(x - 4, 0, 8, e.y - oy);
        ctx.fillStyle = '#fff';
        ctx.fillRect(x - 1, 0, 2, e.y - oy);
        return;
      }
      case 'nukeMissile': {
        const fall = (e.ttl - e.tick) * 12;
        ctx.fillStyle = '#ddd';
        ctx.fillRect(e.x - ox - 2, e.y - oy - fall - 12, 4, 12);
        ctx.fillStyle = PAL.nodRed;
        ctx.fillRect(e.x - ox - 2, e.y - oy - fall - 14, 4, 3);
        return;
      }
      case 'infdie': {
        const set = SPRITES.infantry[e.itype] && SPRITES.infantry[e.itype][e.side];
        if (set && set.die) {
          const img = set.die[Math.min(e.frame, set.die.length - 1)];
          ctx.drawImage(img, Math.round(e.x - 12 - ox), Math.round(e.y - 12 - oy));
        }
        return;
      }
      default: {
        const frames = SPRITES.fx[e.name];
        if (!frames || !frames.length) return;
        const img = frames[Math.min(e.frame, frames.length - 1)];
        ctx.drawImage(img, Math.round(e.x - img.width / 2 - ox), Math.round(e.y - img.height / 2 - oy));
      }
    }
  }

  // ---- viewport -----------------------------------------------------------------------

  function _drawViewport(g) {
    if (!terrainCache || terrainCacheSeed !== g.seed) _buildTerrainCache(g);

    // screen shake
    if (g.shake > 0 && g.tick !== shownTick) {
      shakeX = ((Math.random() * 2 - 1) * Math.min(6, g.shake / 3)) | 0;
      shakeY = ((Math.random() * 2 - 1) * Math.min(6, g.shake / 3)) | 0;
      g.shake--;
    } else if (!g.shake) { shakeX = 0; shakeY = 0; }

    const ox = g.camera.x - shakeX, oy = g.camera.y - shakeY - C.TAB_H;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, C.TAB_H, C.VIEW_W, C.VIEW_H);
    ctx.clip();

    // terrain
    ctx.drawImage(terrainCache, -ox, -oy);
    // animated terrain cells (water ripple, blossom pulse)
    for (const a of animCells) {
      const sx = a.cx * C.CELL - ox, sy = a.cy * C.CELL - oy;
      if (sx < -24 || sx > C.VIEW_W || sy < -8 || sy > C.SCREEN_H) continue;
      const variants = SPRITES.terrain[a.t];
      ctx.drawImage(variants[((g.tick >> 3) + a.cx) % variants.length], sx, sy);
    }

    // ground marks (scorch/crater) below everything else
    for (const e of g.effects) {
      if (e.name === 'scorch' || e.name === 'crater') _drawEffect(g, e, ox, oy);
    }

    // tiberium
    const c0x = Math.max(0, worldToCell(ox)), c1x = Math.min(C.MAP_W - 1, worldToCell(ox + C.VIEW_W) + 1);
    const c0y = Math.max(0, worldToCell(oy)), c1y = Math.min(C.MAP_H - 1, worldToCell(oy + C.SCREEN_H) + 1);
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const v = g.tib[cellIdx(cx, cy)];
        if (v <= 0) continue;
        const density = v > 200 ? 2 : v > 100 ? 1 : 0;
        ctx.drawImage(SPRITES.tiberium[density], cx * C.CELL - ox, cy * C.CELL - oy);
      }
    }

    // buildings (sorted by cy)
    const blds = Array.from(g.buildings.values()).sort((a, b) => a.cy - b.cy);
    for (const b of blds) _drawBuilding(g, b, ox, oy);

    // rally flag for selected factory
    for (const id of g.selection) {
      const b = g.buildings.get(id);
      if (b && b.rally && b.owner === g.humanSide) {
        const rx = cellCenterX(b.rally.cx) - ox, ry = cellCenterY(b.rally.cy) - oy;
        ctx.fillStyle = PAL.uiGold;
        ctx.fillRect(rx, ry - 8, 1, 8);
        ctx.fillRect(rx, ry - 8, 5, 3);
      }
    }

    // ground units then air units
    const units = Array.from(g.units.values()).sort((a, b) => a.y - b.y);
    for (const u of units) if (!DATA.units[u.type].air) _drawUnit(g, u, ox, oy);

    // bullets
    for (const b of g.bullets) {
      const bx = b.x - ox, by = b.y - oy - (b.z || 0);
      if (b.w.arc && b.z > 1) { // shadow for lobbed shells
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(b.x - ox - 1, b.y - oy - 1, 2, 2);
      }
      ctx.fillStyle = b.w.warhead === 'ap' ? '#e8e0c0' : '#f8b830';
      ctx.fillRect(bx - 1, by - 1, b.w.homing ? 4 : 3, b.w.homing ? 2 : 3);
      if (b.w.homing && (game.tick & 1)) {
        ctx.fillStyle = 'rgba(160,160,160,0.6)';
        ctx.fillRect(bx - 4, by - 1, 2, 2);
      }
    }

    // effects (non-ground)
    for (const e of g.effects) {
      if (e.name !== 'scorch' && e.name !== 'crater') _drawEffect(g, e, ox, oy);
    }

    // air units on top
    for (const u of units) if (DATA.units[u.type].air) _drawUnit(g, u, ox, oy);

    // shroud
    ctx.fillStyle = '#000';
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        if (g.shroud[cellIdx(cx, cy)] === 1) continue;
        ctx.fillRect(cx * C.CELL - ox, cy * C.CELL - oy, C.CELL, C.CELL);
      }
    }
    // shroud edges on explored cells adjacent to hidden ones
    if (SPRITES.shroudEdge && SPRITES.shroudEdge.length === 8) {
      const NDX = [0, 1, 1, 1, 0, -1, -1, -1], NDY = [-1, -1, 0, 1, 1, 1, 0, -1];
      for (let cy = c0y; cy <= c1y; cy++) {
        for (let cx = c0x; cx <= c1x; cx++) {
          if (g.shroud[cellIdx(cx, cy)] !== 1) continue;
          for (let d = 0; d < 8; d++) {
            const nx = cx + NDX[d], ny = cy + NDY[d];
            if (inMap(nx, ny) && g.shroud[cellIdx(nx, ny)] === 0) {
              ctx.drawImage(SPRITES.shroudEdge[d], cx * C.CELL - ox, cy * C.CELL - oy);
            }
          }
        }
      }
    }

    // selection brackets + health bars
    for (const id of g.selection) {
      const e = getEnt(id);
      if (!e) continue;
      if (e.kind === 'unit') {
        const x = e.x - 12 - ox, y = e.y - 12 - oy - (DATA.units[e.type].air ? 8 : 0);
        _drawBrackets(x, y, 24, 24);
        _drawHealthBar(x, y - 5, 24, e.hp / e.maxHp);
      } else {
        const x = e.cx * C.CELL - ox, y = e.cy * C.CELL - oy;
        _drawBrackets(x, y, e.w * C.CELL, e.h * C.CELL);
        _drawHealthBar(x, y - 5, e.w * C.CELL, e.hp / e.maxHp);
      }
    }
    // group numbers
    ctx.font = '8px monospace';
    ctx.textBaseline = 'top';
    for (const n in g.groups) {
      for (const id of g.groups[n]) {
        if (!g.selection.includes(id)) continue;
        const e = g.units.get(id);
        if (!e) continue;
        ctx.fillStyle = '#fff';
        ctx.fillText(n, e.x - 12 - ox, e.y - 22 - oy);
      }
    }

    // placement overlay
    if (Input.mode === 'place' && Input.modeArg) {
      const w = worldFromScreen(Input.mouse.x, Input.mouse.y);
      if (w) {
        const d = DATA.buildings[Input.modeArg];
        const pcx = worldToCell(w.x) - ((d.w / 2) | 0), pcy = worldToCell(w.y) - ((d.h / 2) | 0);
        const overall = Production.canPlace(g, g.human, Input.modeArg, pcx, pcy);
        for (let yy = 0; yy < d.h; yy++) {
          for (let xx = 0; xx < d.w; xx++) {
            const ok = Production.cellOk(g, g.human, pcx + xx, pcy + yy) && overall;
            ctx.fillStyle = ok ? 'rgba(80,240,80,0.4)' : 'rgba(240,60,40,0.4)';
            ctx.fillRect((pcx + xx) * C.CELL - ox, (pcy + yy) * C.CELL - oy, C.CELL, C.CELL);
            ctx.strokeStyle = ok ? '#8f8' : '#f88';
            ctx.strokeRect((pcx + xx) * C.CELL - ox + 0.5, (pcy + yy) * C.CELL - oy + 0.5, C.CELL - 1, C.CELL - 1);
          }
        }
      }
    }

    // drag rectangle
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
      ctx.fillRect(0, C.TAB_H, C.VIEW_W, C.VIEW_H);
    }

    ctx.restore();
  }

  // ---- tab bar -------------------------------------------------------------------------

  function _bevel(x, y, w, h, lit) {
    ctx.fillStyle = lit ? PAL.uiMetalLight : PAL.uiMetal;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = PAL.uiMetalLight;
    ctx.fillRect(x, y, w, 1);
    ctx.fillRect(x, y, 1, h);
    ctx.fillStyle = PAL.uiMetalDark;
    ctx.fillRect(x, y + h - 1, w, 1);
    ctx.fillRect(x + w - 1, y, 1, h);
  }

  function _drawTabBar(g) {
    ctx.fillStyle = PAL.uiMetalDark;
    ctx.fillRect(0, 0, C.SCREEN_W, C.TAB_H);
    _bevel(0, 0, 60, C.TAB_H);
    ctx.font = '8px monospace';
    ctx.textBaseline = 'top';
    ctx.fillStyle = PAL.uiText;
    ctx.fillText('Options', 8, 4);

    // credits ticker
    const target = Math.floor(g.human.credits);
    if (creditsShown !== target) {
      const diff = target - creditsShown;
      const step = Math.max(1, Math.abs(diff) / 12 | 0);
      creditsShown += clamp(diff, -step, step);
      if (Math.abs(diff) > 2) AUDIO.tickCredits();
    }
    ctx.fillStyle = PAL.uiGold;
    ctx.fillText('$ ' + creditsShown, C.VIEW_W - 90, 4);

    // mission timer
    const secs = Math.floor(g.tick / C.TPS);
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    ctx.fillStyle = PAL.uiText;
    ctx.fillText(mm + ':' + ss, C.SIDEBAR_X + 110, 4);
    ctx.fillText(g.humanSide.toUpperCase(), C.SIDEBAR_X + 8, 4);
  }

  // ---- sidebar --------------------------------------------------------------------------

  function _drawSidebar(g) {
    const p = g.human;
    ctx.fillStyle = PAL.uiMetal;
    ctx.fillRect(C.SIDEBAR_X, C.TAB_H, C.SIDEBAR_W, C.SCREEN_H - C.TAB_H);

    // power bar along the left edge of the sidebar
    const pb = p.power;
    const barTop = C.RADAR_Y + C.RADAR_H, barH = C.SCREEN_H - barTop;
    ctx.fillStyle = PAL.uiMetalDark;
    ctx.fillRect(C.SIDEBAR_X, barTop, 4, barH);
    const scale = Math.max(pb.out, pb.drain, 100) * 1.2;
    const outH = Math.round(pb.out / scale * barH);
    const low = pb.drain > pb.out;
    ctx.fillStyle = low ? PAL.uiRed : (pb.drain > pb.out * 0.8 ? '#d8c020' : PAL.uiGreen);
    ctx.fillRect(C.SIDEBAR_X, barTop + barH - outH, 4, outH);
    const drainY = barTop + barH - Math.round(pb.drain / scale * barH);
    ctx.fillStyle = '#fff';
    ctx.fillRect(C.SIDEBAR_X, drainY, 4, 2);

    // radar
    ctx.fillStyle = '#000';
    ctx.fillRect(C.RADAR_X + 4, C.RADAR_Y, C.RADAR_W - 4, C.RADAR_H);
    if (p.radar) {
      if (g.tick - minimapTick >= 8) { _updateMinimap(g); minimapTick = g.tick; }
      const rx = C.RADAR_X + (C.RADAR_W - 128) / 2, ry = C.RADAR_Y + (C.RADAR_H - 128) / 2;
      ctx.drawImage(minimap, rx, ry);
      // viewport rectangle
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.strokeRect(
        rx + g.camera.x / (C.MAP_W * C.CELL) * 128 + 0.5,
        ry + g.camera.y / (C.MAP_H * C.CELL) * 128 + 0.5,
        C.VIEW_W / (C.MAP_W * C.CELL) * 128,
        C.VIEW_H / (C.MAP_H * C.CELL) * 128);
    } else {
      const logo = SPRITES.logo[g.humanSide];
      if (logo) {
        ctx.drawImage(logo, C.RADAR_X + (C.RADAR_W - logo.width) / 2 + 2, C.RADAR_Y + (C.RADAR_H - logo.height) / 2);
      }
    }

    // buttons
    const btns = [['REPAIR', 484, 'repair'], ['SELL', 536, 'sell'], ['MAP', 588, 'map']];
    ctx.font = '8px monospace';
    for (const [label, bx, which] of btns) {
      const active = Input.mode === which;
      _bevel(bx, C.BTN_Y + 2, 48, C.BTN_H - 4, active);
      ctx.fillStyle = which === 'map' ? '#7a7a70' : (active ? PAL.uiGold : PAL.uiText);
      ctx.fillText(label, bx + 24 - label.length * 2.5, C.BTN_Y + 7);
    }

    // strips
    const it = Production.items(p);
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
          ctx.fillRect(sx, iy, C.CAMEO_W, C.CAMEO_H);
          continue;
        }
        const cameo = SPRITES.cameo[item.super ? item.key + 'Strike' : item.key];
        if (cameo) ctx.drawImage(cameo, sx, iy);
        // state overlays
        if (item.state === 'building' || item.state === 'hold' || item.state === 'charging') {
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(sx, iy, C.CAMEO_W, C.CAMEO_H);
          // clock sweep
          ctx.fillStyle = 'rgba(255,255,255,0.35)';
          ctx.beginPath();
          ctx.moveTo(sx + 32, iy + 24);
          ctx.arc(sx + 32, iy + 24, 40, -Math.PI / 2, -Math.PI / 2 + item.frac * Math.PI * 2);
          ctx.closePath();
          ctx.save();
          ctx.beginPath();
          ctx.rect(sx, iy, C.CAMEO_W, C.CAMEO_H);
          ctx.clip();
          ctx.fill();
          ctx.restore();
          if (item.state === 'hold') {
            ctx.fillStyle = '#f0d020';
            ctx.fillText('ON HOLD', sx + 14, iy + 20);
          } else if (item.state === 'building' && item.eta > 0) {
            // time remaining, dark-boxed so it reads over the clock sweep
            const t = Math.floor(item.eta / 60) + ':' + String(item.eta % 60).padStart(2, '0');
            ctx.fillStyle = 'rgba(0,0,0,0.65)';
            ctx.fillRect(sx + 20, iy + 18, 24, 11);
            ctx.fillStyle = '#fff';
            ctx.fillText(t, sx + 23, iy + 20);
          }
          if (item.state === 'charging') {
            const p2 = g.human.super;
            const s = Math.ceil(p2.timer / C.TPS);
            const t = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
            ctx.fillStyle = '#fff';
            ctx.fillText(t, sx + 22, iy + 20);
          }
        } else if (item.state === 'ready') {
          if ((g.tick >> 3) & 1) {
            ctx.fillStyle = '#fff';
            ctx.fillText('READY', sx + 19, iy + 20);
          }
        }
        // queued-unit count badge
        if (item.count > 1 || (item.count === 1 && item.state === 'idle')) {
          ctx.fillStyle = 'rgba(0,0,0,0.7)';
          ctx.fillRect(sx + C.CAMEO_W - 16, iy + 1, 15, 10);
          ctx.fillStyle = PAL.uiGold;
          ctx.fillText('x' + item.count, sx + C.CAMEO_W - 14, iy + 2);
        }
        // hover highlight
        if (Input.mouse.x >= sx && Input.mouse.x < sx + C.CAMEO_W &&
            Input.mouse.y >= iy && Input.mouse.y < iy + C.CAMEO_H) {
          ctx.strokeStyle = PAL.uiGold;
          ctx.strokeRect(sx + 0.5, iy + 0.5, C.CAMEO_W - 1, C.CAMEO_H - 1);
        }
      }
      // scroll arrows
      const canUp = scroll > 0, canDown = scroll < list.length - C.STRIP_VISIBLE;
      _bevel(sx, 372, 30, 12);
      _bevel(sx + 34, 372, 30, 12);
      ctx.fillStyle = canUp ? PAL.uiText : '#6a6a60';
      ctx.fillText('▲', sx + 11, 374);
      ctx.fillStyle = canDown ? PAL.uiText : '#6a6a60';
      ctx.fillText('▼', sx + 45, 374);
    }

    // low power warning
    if (p.power.drain > p.power.out && (g.tick >> 3) & 1) {
      ctx.fillStyle = PAL.uiRed;
      ctx.fillText('LOW POWER', C.SIDEBAR_X + 48, C.BTN_Y - 10);
    }
  }

  // ---- cursor ---------------------------------------------------------------------------

  function _drawCursor() {
    const kind = Input.cursorKind || 'default';
    const cur = SPRITES.cursor[kind] || SPRITES.cursor.default;
    if (!cur) return;
    ctx.drawImage(cur.c, Math.round(Input.mouse.x - cur.hx), Math.round(Input.mouse.y - cur.hy));
  }

  // ---- frame ----------------------------------------------------------------------------

  function frame(g) {
    if (!ctx) return;
    if (!g) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, C.SCREEN_W, C.SCREEN_H);
      return;
    }
    _drawViewport(g);
    _drawTabBar(g);
    _drawSidebar(g);
    if (Input.mouse.inside && !g.paused) _drawCursor();
    shownTick = g.tick;
  }

  return { init, frame, worldFromScreen, hitTest };
})();
