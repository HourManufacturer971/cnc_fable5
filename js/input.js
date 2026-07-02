'use strict';
// input.js — mouse/keyboard handling, classic C&C left-click scheme.
// Global: Input.

const Input = (function () {
  const mouse = { x: C.SCREEN_W / 2, y: C.SCREEN_H / 2, down: false, inside: false };
  let cursorKind = 'default';
  let mode = 'normal';   // 'normal'|'place'|'sell'|'repair'|'super'
  let modeArg = null;
  let dragStart = null;
  let dragRect = null;
  let radarDrag = false;
  let lastClick = { t: 0, id: 0 };
  let lastGroupTap = { t: 0, n: -1 };
  const keys = {};
  let inited = false;
  let audioUnlocked = false;

  function init(canvas, g) {
    if (inited) return;
    inited = true;

    function toInternal(ev) {
      const r = canvas.getBoundingClientRect();
      return {
        x: (ev.clientX - r.left) / r.width * C.SCREEN_W,
        y: (ev.clientY - r.top) / r.height * C.SCREEN_H,
      };
    }

    canvas.addEventListener('mousemove', ev => {
      const p = toInternal(ev);
      mouse.x = p.x; mouse.y = p.y;
      mouse.inside = true;
      if (dragStart && mode === 'normal') {
        if (Math.abs(p.x - dragStart.x) > 4 || Math.abs(p.y - dragStart.y) > 4) {
          dragRect = { x1: dragStart.x, y1: dragStart.y, x2: p.x, y2: p.y };
        }
      }
      if (radarDrag) _radarJump();
    });
    canvas.addEventListener('mouseleave', () => { mouse.inside = false; });
    canvas.addEventListener('mouseenter', ev => {
      // browsers synthesize enter events when an overlay disappears under a
      // static pointer — take the real coordinates so edge-scroll never keys
      // off a stale position
      const p = toInternal(ev);
      mouse.x = p.x; mouse.y = p.y;
      mouse.inside = true;
    });

    canvas.addEventListener('mousedown', ev => {
      if (!audioUnlocked) { audioUnlocked = true; AUDIO.init(); }
      const p = toInternal(ev);
      mouse.x = p.x; mouse.y = p.y;
      if (ev.button === 0) {
        mouse.down = true;
        if (!game || game.paused || game.status !== 'playing') return;
        const hit = Render.hitTest(p.x, p.y);
        if (hit.zone === 'viewport' && mode === 'normal') dragStart = { x: p.x, y: p.y };
        if (hit.zone === 'radar' && game.human.radar) { radarDrag = true; _radarJump(); }
      }
      ev.preventDefault();
    });

    canvas.addEventListener('mouseup', ev => {
      const p = toInternal(ev);
      mouse.x = p.x; mouse.y = p.y;
      if (ev.button === 0) {
        mouse.down = false;
        radarDrag = false;
        if (!game || game.paused || game.status !== 'playing') { dragStart = null; dragRect = null; return; }
        if (dragRect) {
          _boxSelect(ev.shiftKey);
          dragStart = null; dragRect = null;
          return;
        }
        dragStart = null;
        _leftClick(p.x, p.y, ev.shiftKey, ev.ctrlKey);
      } else if (ev.button === 2) {
        _rightClick();
      }
      ev.preventDefault();
    });

    canvas.addEventListener('contextmenu', ev => ev.preventDefault());

    canvas.addEventListener('wheel', ev => {
      if (!game) return;
      const hit = Render.hitTest(mouse.x, mouse.y);
      if (hit.zone === 'icon' || hit.zone === 'arrow' || hit.zone === 'sidebar') {
        const strip = mouse.x < C.STRIP_UX ? 'b' : 'u';
        _scrollStrip(strip, ev.deltaY > 0 ? 1 : -1);
        ev.preventDefault();
        return;
      }
      // two-finger touchpad scroll (or mouse wheel) pans the map
      if (hit.zone === 'viewport' && !game.paused) {
        const r = canvas.getBoundingClientRect();
        const scale = C.SCREEN_W / r.width / C.ZOOM; // client px -> WORLD px
        game.camera.x = clamp(game.camera.x + ev.deltaX * scale, 0, C.MAP_W * C.CELL - C.VIEW_W);
        game.camera.y = clamp(game.camera.y + ev.deltaY * scale, 0, C.MAP_H * C.CELL - C.VIEW_H);
        ev.preventDefault();
      }
    }, { passive: false });

    window.addEventListener('keydown', ev => {
      keys[ev.key] = true;
      if (!game) return;
      if (ev.key === 'Escape') {
        if (mode !== 'normal') { _setMode('normal'); }
        else if (typeof Main !== 'undefined') Main.togglePause();
        ev.preventDefault();
        return;
      }
      if (game.paused || game.status !== 'playing') return;
      _hotkeys(ev);
    });
    window.addEventListener('keyup', ev => { keys[ev.key] = false; });
  }

  function _setMode(m, arg) {
    mode = m;
    modeArg = arg || null;
  }

  function _radarJump() {
    const fx = clamp((mouse.x - C.MM_X) / C.MM_S, 0, 1);
    const fy = clamp((mouse.y - C.MM_Y) / C.MM_S, 0, 1);
    game.camera.x = clamp(fx * C.MAP_W * C.CELL - C.VIEW_W / 2, 0, C.MAP_W * C.CELL - C.VIEW_W);
    game.camera.y = clamp(fy * C.MAP_H * C.CELL - C.VIEW_H / 2, 0, C.MAP_H * C.CELL - C.VIEW_H);
  }

  function _scrollStrip(strip, dir) {
    const it = Production.items(game.human);
    const list = strip === 'b' ? it.buildings : it.units;
    const cur = game.human.scroll[strip];
    const max = Math.max(0, list.length - C.STRIP_VISIBLE);
    const next = clamp(cur + dir, 0, max);
    if (next !== cur) {
      game.human.scroll[strip] = next;
      AUDIO.play('click');
    }
  }

  // ---- entity picking -----------------------------------------------------------

  function _entAt(wx, wy) {
    const g = game;
    // air units first (drawn on top), then ground units by proximity, then buildings
    let best = null, bestD = 14;
    for (const u of g.units.values()) {
      if (u.cloaked && u.owner !== g.humanSide) continue;
      const d = dist(wx, wy, u.x, u.y);
      const r = DATA.units[u.type].air ? 16 : 13;
      if (d <= r && (best === null || d < bestD)) { best = u; bestD = d; }
    }
    if (best) return best;
    const cx = worldToCell(wx), cy = worldToCell(wy);
    const o = occAt(cx, cy);
    if (o > 0) {
      const e = getEnt(o);
      if (e) return e;
    }
    return null;
  }

  function _selectedUnits() {
    return game.selection.map(id => game.units.get(id)).filter(Boolean);
  }

  // voice class of the current selection's lead unit
  function _selClass(ids) {
    for (const id of ids || game.selection) {
      const u = game.units.get(id);
      if (u && u.owner === game.humanSide) {
        const d = DATA.units[u.type];
        return d.air ? 'air' : d.infantry ? 'inf' : 'veh';
      }
    }
    return 'veh';
  }

  function _select(ids, silent) {
    game.selection = ids;
    if (!silent && ids.some(id => {
      const u = game.units.get(id);
      return u && u.owner === game.humanSide;
    })) AUDIO.ack('select', _selClass(ids));
  }

  function _boxSelect(shift) {
    const g = game;
    const r = dragRect;
    const Z = C.ZOOM;
    const wx1 = Math.min(r.x1, r.x2) / Z + g.camera.x, wx2 = Math.max(r.x1, r.x2) / Z + g.camera.x;
    const wy1 = (Math.min(r.y1, r.y2) - C.TAB_H) / Z + g.camera.y, wy2 = (Math.max(r.y1, r.y2) - C.TAB_H) / Z + g.camera.y;
    const ids = [];
    for (const u of g.units.values()) {
      if (u.owner !== g.humanSide) continue;
      if (u.x >= wx1 && u.x <= wx2 && u.y >= wy1 && u.y <= wy2) ids.push(u.id);
    }
    if (!ids.length) return;
    _select(shift ? [...new Set(g.selection.concat(ids))] : ids);
  }

  function _selectSameTypeOnScreen(type) {
    const g = game;
    const ids = [];
    for (const u of g.units.values()) {
      if (u.owner !== g.humanSide || u.type !== type) continue;
      const sx = u.x - g.camera.x, sy = u.y - g.camera.y;
      if (sx >= 0 && sx <= C.VIEW_W && sy >= 0 && sy <= C.VIEW_H) ids.push(u.id);
    }
    if (ids.length) _select(ids);
  }

  // spread group move destinations in a spiral so units don't all fight for one cell
  function _formationCells(cx, cy, n) {
    const out = [{ cx, cy }];
    let r = 1;
    while (out.length < n && r < 8) {
      for (let dy = -r; dy <= r && out.length < n; dy++) {
        for (let dx = -r; dx <= r && out.length < n; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = cx + dx, y = cy + dy;
          if (inMap(x, y) && terrainPassable(game.terrain[cellIdx(x, y)])) out.push({ cx: x, cy: y });
        }
      }
      r++;
    }
    return out;
  }

  // ---- click handling --------------------------------------------------------------

  function _leftClick(x, y, shift, ctrl) {
    const g = game;
    const hit = Render.hitTest(x, y);

    if (hit.zone === 'tab-options') {
      if (typeof Main !== 'undefined') Main.togglePause();
      return;
    }
    if (hit.zone === 'arrow') { _scrollStrip(hit.strip, hit.dir); return; }
    if (hit.zone === 'btn') {
      if (hit.which === 'repair') { _setMode(mode === 'repair' ? 'normal' : 'repair'); AUDIO.play('click'); }
      else if (hit.which === 'sell') { _setMode(mode === 'sell' ? 'normal' : 'sell'); AUDIO.play('click'); }
      return;
    }
    if (hit.zone === 'icon') {
      _iconClick(hit);
      return;
    }
    if (hit.zone === 'radar') return; // handled by drag
    if (hit.zone !== 'viewport') return;

    const w = Render.worldFromScreen(x, y);
    if (!w) return;
    const cx = worldToCell(w.x), cy = worldToCell(w.y);

    if (mode === 'place') {
      const d = DATA.buildings[modeArg];
      const px = cx - ((d.w / 2) | 0), py = cy - ((d.h / 2) | 0);
      if (Production.place(g, g.human, modeArg, px, py)) _setMode('normal');
      return;
    }
    if (mode === 'sell') {
      const e = _entAt(w.x, w.y);
      if (e && e.kind === 'building' && e.owner === g.humanSide) Production.sell(g, g.human, e);
      return;
    }
    if (mode === 'repair') {
      const e = _entAt(w.x, w.y);
      if (e && e.kind === 'building' && e.owner === g.humanSide) Production.toggleRepair(g, g.human, e);
      return;
    }
    if (mode === 'super') {
      if (Production.launchSuper(g, g.human, cx, cy)) _setMode('normal');
      return;
    }

    // ---- normal mode: classic C&C left-click ----
    const ent = _entAt(w.x, w.y);
    const sel = _selectedUnits();
    const ownSel = sel.filter(u => u.owner === g.humanSide);

    if (ent && ent.owner === g.humanSide) {
      // MCV deploy on second click
      if (ent.kind === 'unit' && DATA.units[ent.type].deploysTo &&
          ownSel.length === 1 && ownSel[0].id === ent.id) {
        if (!orderDeploy(ent)) AUDIO.play('buzz');
        return;
      }
      // engineer heal own damaged building
      if (ent.kind === 'building' && ownSel.some(u => DATA.units[u.type].engineer) && ent.hp < ent.maxHp) {
        for (const u of ownSel) if (DATA.units[u.type].engineer) orderEnter(u, ent);
        AUDIO.ack('move', _selClass());
        return;
      }
      // select it
      if (ent.kind === 'unit') {
        const now = Date.now();
        if (lastClick.id === ent.id && now - lastClick.t < 350) {
          _selectSameTypeOnScreen(ent.type);
        } else if (shift) {
          const has = g.selection.includes(ent.id);
          _select(has ? g.selection.filter(i => i !== ent.id) : g.selection.concat(ent.id));
        } else {
          _select([ent.id]);
        }
        lastClick = { t: now, id: ent.id };
      } else {
        _select([ent.id], true);
        AUDIO.play('click');
      }
      return;
    }

    if (ent && ent.owner !== g.humanSide) {
      if (ownSel.length) {
        // engineers capture enemy buildings
        let acted = false;
        for (const u of ownSel) {
          const d = DATA.units[u.type];
          if (d.engineer && ent.kind === 'building') { orderEnter(u, ent); acted = true; }
          else if (orderAttack(u, ent)) acted = true;
        }
        if (acted) AUDIO.ack('attack', _selClass());
        else AUDIO.play('buzz');
      } else {
        _select([ent.id], true); // inspect enemy
      }
      return;
    }

    // clicked open ground
    if (ownSel.length) {
      if (!Fog.isExplored(g, cx, cy) && g.shroud[cellIdx(cx, cy)] === 0) {
        // moving into shroud is allowed in TD
      }
      const harvs = ownSel.filter(u => DATA.units[u.type].harvester);
      if (harvs.length && g.tib[cellIdx(cx, cy)] > 0) {
        for (const h of harvs) orderHarvest(h, cx, cy);
        for (const u of ownSel) if (!DATA.units[u.type].harvester) orderMove(u, cx, cy);
        AUDIO.ack('move', _selClass());
        return;
      }
      if (terrainPassable(g.terrain[cellIdx(cx, cy)]) || ownSel.some(u => DATA.units[u.type].air)) {
        const spots = _formationCells(cx, cy, ownSel.length);
        ownSel.forEach((u, i) => {
          const s = spots[Math.min(i, spots.length - 1)];
          orderMove(u, s.cx, s.cy);
        });
        AUDIO.ack('move', _selClass());
      } else {
        AUDIO.play('buzz');
      }
      return;
    }

    // building selected: set rally point
    const selB = g.selection.map(id => g.buildings.get(id)).filter(Boolean);
    if (selB.length === 1 && selB[0].owner === g.humanSide && DATA.buildings[selB[0].type].factory) {
      selB[0].rally = { cx, cy };
      AUDIO.play('click');
    }
  }

  function _iconClick(hit) {
    const g = game;
    const p = g.human;
    if (hit.super) {
      if (Production.superReady(p)) { _setMode('super', hit.key); AUDIO.play('click'); }
      else AUDIO.play('buzz');
      return;
    }
    if (hit.state === 'ready') {
      _setMode('place', hit.key);
      AUDIO.play('click');
      return;
    }
    // units always queue on click; buildings keep the classic hold toggle
    if (Production.categoryOf(hit.key) === 'building' &&
        (hit.state === 'building' || hit.state === 'hold')) {
      Production.toggleHold(p, hit.key);
      return;
    }
    Production.tryStart(p, hit.key);
  }

  function _rightClick() {
    if (mode !== 'normal') {
      _setMode('normal');
      return;
    }
    game.selection = [];
  }

  function _iconRightClick() {
    const hit = Render.hitTest(mouse.x, mouse.y);
    if (hit.zone === 'icon' && !hit.super &&
        (hit.state === 'building' || hit.state === 'hold' || hit.state === 'ready')) {
      Production.cancel(game.human, hit.key);
      return true;
    }
    return false;
  }

  // ---- keyboard ---------------------------------------------------------------------

  function _hotkeys(ev) {
    const g = game;
    const k = ev.key;
    // use ev.code for digits so Shift/Alt combos still read as 1..9
    const dm = /^(?:Digit|Numpad)([1-9])$/.exec(ev.code || '');
    if (dm) {
      const n = +dm[1];
      // Ctrl+digit OR Alt+digit assigns (browsers reserve Ctrl+1..8 for tabs,
      // so Alt is the reliable one; we still take Ctrl when the page gets it)
      if (ev.ctrlKey || ev.altKey) {
        if (g.selection.length) {
          g.groups[n] = g.selection.slice();
          AUDIO.play('click');
        }
        ev.preventDefault();
      } else if (g.groups[n] && g.groups[n].length) {
        const ids = g.groups[n].filter(id => g.units.get(id) || g.buildings.get(id));
        g.groups[n] = ids;
        if (!ids.length) return;
        if (ev.shiftKey) {
          _select([...new Set(g.selection.concat(ids))], true); // add group to selection
        } else {
          _select(ids.slice(), true);
          const now = Date.now();
          if (lastGroupTap.n === n && now - lastGroupTap.t < 400) _centerOnSelection();
          lastGroupTap = { t: now, n };
        }
      }
      return;
    }
    switch (k.toLowerCase()) {
      case 'h': {
        for (const id of g.human.buildingIds) {
          const b = g.buildings.get(id);
          if (b && b.type === 'fact') {
            g.camera.x = clamp((b.cx + b.w / 2) * C.CELL - C.VIEW_W / 2, 0, C.MAP_W * C.CELL - C.VIEW_W);
            g.camera.y = clamp((b.cy + b.h / 2) * C.CELL - C.VIEW_H / 2, 0, C.MAP_H * C.CELL - C.VIEW_H);
            g.selection = [b.id];
            break;
          }
        }
        break;
      }
      case 's':
        for (const u of _selectedUnits()) stopUnit(u);
        break;
      case 'g':
        for (const u of _selectedUnits()) stopUnit(u);
        break;
      case 'd':
        for (const u of _selectedUnits()) {
          if (DATA.units[u.type].deploysTo) { if (!orderDeploy(u)) AUDIO.play('buzz'); }
        }
        break;
      case 't': {
        const sel = _selectedUnits();
        if (sel.length) _selectSameTypeOnScreen(sel[0].type);
        break;
      }
    }
  }

  function _centerOnSelection() {
    const g = game;
    const sel = _selectedUnits();
    if (!sel.length) return;
    let x = 0, y = 0;
    for (const u of sel) { x += u.x; y += u.y; }
    g.camera.x = clamp(x / sel.length - C.VIEW_W / 2, 0, C.MAP_W * C.CELL - C.VIEW_W);
    g.camera.y = clamp(y / sel.length - C.VIEW_H / 2, 0, C.MAP_H * C.CELL - C.VIEW_H);
  }

  // ---- per-tick: edge/key scrolling + cursor ------------------------------------------

  function tickFn(g) {
    if (!g || g.paused || g.status !== 'playing') { cursorKind = 'default'; return; }

    // keyboard scroll
    let sx = 0, sy = 0;
    if (keys.ArrowLeft) sx -= 1;
    if (keys.ArrowRight) sx += 1;
    if (keys.ArrowUp) sy -= 1;
    if (keys.ArrowDown) sy += 1;

    // edge scroll
    let edge = -1;
    if (mouse.inside) {
      const e = C.EDGE_SCROLL;
      const l = mouse.x < e, r = mouse.x > C.SCREEN_W - e;
      const t = mouse.y < e, b = mouse.y > C.SCREEN_H - e;
      if (l) sx -= 1;
      if (r) sx += 1;
      if (t) sy -= 1;
      if (b) sy += 1;
      if (t && r) edge = 1; else if (r && b) edge = 3; else if (b && l) edge = 5; else if (l && t) edge = 7;
      else if (t) edge = 0; else if (r) edge = 2; else if (b) edge = 4; else if (l) edge = 6;
    }
    if (sx || sy) {
      const maxX = C.MAP_W * C.CELL - C.VIEW_W, maxY = C.MAP_H * C.CELL - C.VIEW_H;
      const nx = clamp(g.camera.x + sx * C.SCROLL_SPEED, 0, maxX);
      const ny = clamp(g.camera.y + sy * C.SCROLL_SPEED, 0, maxY);
      const stuck = nx === g.camera.x && ny === g.camera.y;
      g.camera.x = nx; g.camera.y = ny;
      if (edge >= 0) { cursorKind = (stuck ? 'noscroll' : 'scroll') + edge; return; }
    }

    cursorKind = _computeCursor(g);
  }

  function _computeCursor(g) {
    const hit = Render.hitTest(mouse.x, mouse.y);
    if (hit.zone !== 'viewport') return 'default';
    const w = Render.worldFromScreen(mouse.x, mouse.y);
    if (!w) return 'default';
    const cx = worldToCell(w.x), cy = worldToCell(w.y);

    if (mode === 'place') return 'default';
    if (mode === 'super') return 'super';
    const ent = _entAt(w.x, w.y);
    if (mode === 'sell') return ent && ent.kind === 'building' && ent.owner === g.humanSide ? 'sell' : 'nosell';
    if (mode === 'repair') {
      return ent && ent.kind === 'building' && ent.owner === g.humanSide && ent.hp < ent.maxHp ? 'repair' : 'norepair';
    }

    const sel = _selectedUnits().filter(u => u.owner === g.humanSide);
    if (ent && ent.owner === g.humanSide) {
      if (ent.kind === 'unit' && DATA.units[ent.type].deploysTo && sel.length === 1 && sel[0].id === ent.id) {
        return 'deploy';
      }
      if (ent.kind === 'building' && sel.some(u => DATA.units[u.type].engineer) && ent.hp < ent.maxHp) return 'enter';
      return 'select';
    }
    if (ent && ent.owner !== g.humanSide) {
      if (!sel.length) return 'select';
      if (sel.some(u => DATA.units[u.type].engineer) && ent.kind === 'building') return 'capture';
      if (sel.some(u => DATA.units[u.type].weapon)) return 'attack';
      return 'nomove';
    }
    if (sel.length) {
      if (g.tib[cellIdx(cx, cy)] > 0 && sel.some(u => DATA.units[u.type].harvester)) return 'harvest';
      if (terrainPassable(g.terrain[cellIdx(cx, cy)]) || sel.every(u => DATA.units[u.type].air)) return 'move';
      return 'nomove';
    }
    return 'default';
  }

  // right-click on sidebar icons cancels production — wire via mouseup path
  document.addEventListener('mouseup', ev => {
    if (ev.button === 2 && game && !game.paused && game.status === 'playing') {
      _iconRightClick();
    }
  });

  return {
    init,
    tick: tickFn,
    mouse,
    get cursorKind() { return cursorKind; },
    get mode() { return mode; },
    get modeArg() { return modeArg; },
    get dragRect() { return dragRect; },
  };
})();
