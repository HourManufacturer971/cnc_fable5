'use strict';
// input.js — mouse/keyboard/touch handling, classic left-click RTS scheme.
// Global: Input.

const Input = (function () {
  const mouse = { x: C.SCREEN_W / 2, y: C.SCREEN_H / 2, down: false, inside: false };
  let cursorKind = 'default';
  let mode = 'normal';   // 'normal'|'place'|'sell'|'repair'|'super'
  let modeArg = null;
  let dragStart = null;
  let dragRect = null;
  let wallDrag = null;   // start cell of a wall drag
  let wallLine = null;   // preview cells while dragging
  let radarDrag = false;
  let rPan = null;       // right-button map pan {cx, cy, camX, camY, moved}
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
      if (tGest || tTwo) mouseMovedInTouch = true; // don't clobber this on touch end
      if (dragStart && mode === 'normal') {
        if (Math.abs(p.x - dragStart.x) > 4 || Math.abs(p.y - dragStart.y) > 4) {
          dragRect = { x1: dragStart.x, y1: dragStart.y, x2: p.x, y2: p.y };
        }
      }
      if (wallDrag) {
        const w = Render.worldFromScreen(p.x, p.y);
        if (w) wallLine = _wallCells(wallDrag, { cx: worldToCell(w.x), cy: worldToCell(w.y) });
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
        if (hit.zone === 'viewport' && mode === 'place' && modeArg &&
            DATA.buildings[modeArg] && DATA.buildings[modeArg].wall) {
          const w = Render.worldFromScreen(p.x, p.y);
          if (w) {
            wallDrag = { cx: worldToCell(w.x), cy: worldToCell(w.y) };
            wallLine = [wallDrag];
          }
        }
        if (hit.zone === 'radar' && Render.radarOn()) { radarDrag = true; _radarJump(); }
      } else if (ev.button === 2) {
        // right-drag grabs the map — windowed browsers make edge scrolling
        // clumsy (the cursor slides out of the window); a released button
        // that never moved is still the classic right-click
        if (game && !game.paused && game.status === 'playing' &&
            Render.hitTest(p.x, p.y).zone === 'viewport') {
          rPan = { cx: ev.clientX, cy: ev.clientY,
                   camX: game.camera.x, camY: game.camera.y, moved: false };
        }
      }
      ev.preventDefault();
    });

    // the pan tracks the button anywhere on the page — releasing or dragging
    // outside the canvas must not strand it
    window.addEventListener('mousemove', ev => {
      if (!rPan || !game) return;
      const r = canvas.getBoundingClientRect();
      const s = C.SCREEN_W / r.width / C.ZOOM;   // client px -> WORLD px
      const dx = ev.clientX - rPan.cx, dy = ev.clientY - rPan.cy;
      if (!rPan.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      rPan.moved = true;
      game.camera.x = clamp(rPan.camX - dx * s, 0, C.MAP_W * C.CELL - C.VIEW_W);
      game.camera.y = clamp(rPan.camY - dy * s, 0, C.MAP_H * C.CELL - C.VIEW_H);
    });
    window.addEventListener('mouseup', ev => {
      if (ev.button !== 2 || !rPan) return;
      if (!rPan.moved) _rightClick();
      rPan = null;
    });

    canvas.addEventListener('mouseup', ev => {
      const p = toInternal(ev);
      mouse.x = p.x; mouse.y = p.y;
      if (ev.button === 0) {
        mouse.down = false;
        radarDrag = false;
        if (!game || game.paused || game.status !== 'playing') {
          dragStart = null; dragRect = null; wallDrag = null; wallLine = null;
          return;
        }
        if (wallDrag) {
          const cells = wallLine || [wallDrag];
          const placed = Production.placeWallLine(game, game.human, modeArg, cells);
          wallDrag = null; wallLine = null;
          // in MP the queued placement consumes ready ~5 ticks from now —
        // exit place mode on the optimistic ack rather than sticking
        if (placed && (!game.human.ready.building || NET.active)) _setMode('normal');
          else if (!placed) AUDIO.play('buzz');
          return;
        }
        if (dragRect) {
          _boxSelect(ev.shiftKey);
          dragStart = null; dragRect = null;
          return;
        }
        dragStart = null;
        _leftClick(p.x, p.y, ev.shiftKey, ev.ctrlKey);
      } else if (ev.button === 2) {
        // with a pan gesture live, the window-level mouseup decides whether
        // this was a drag (swallow) or a genuine right-click
        if (!rPan) _rightClick();
      }
      ev.preventDefault();
    });

    canvas.addEventListener('contextmenu', ev => ev.preventDefault());

    let wheelAcc = 0;
    canvas.addEventListener('wheel', ev => {
      if (!game) return;
      // the wheel event carries its own position — never hit-test coords a
      // finished touch left behind in mouse.x/y
      const p = toInternal(ev);
      mouse.x = p.x; mouse.y = p.y;
      const hit = Render.hitTest(p.x, p.y);
      if (hit.zone === 'icon' || hit.zone === 'arrow' || hit.zone === 'sidebar') {
        // accumulate so touchpads step one icon per deliberate swipe, not per event
        wheelAcc += ev.deltaY;
        if (Math.abs(wheelAcc) >= 140) {
          const strip = p.x < C.STRIP_UX ? 'b' : 'u';
          _scrollStrip(strip, wheelAcc > 0 ? 1 : -1);
          wheelAcc = 0;
        }
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

    // ---- touch controls ---------------------------------------------------------
    // Tap = left-click. One-finger drag pans the map (in place mode it moves
    // the ghost; with a wall selected it draws the line; on the radar it
    // scrubs the camera; on the build strips it scrolls them). Long-press
    // then drag = box multi-select (touch boxes ADD to the selection);
    // long-press an icon = cancel production; long-press a group chip =
    // assign the selection to it. Two-finger tap = right-click (deselect /
    // cancel mode); two-finger drag pans in any mode. The in-canvas cursor
    // and edge scrolling stay off while touching — there is no hover on a
    // phone. Fingers are counted via targetTouches and tracked by
    // identifier: a thumb resting on the letterbox bars around the canvas
    // must never turn taps into two-finger gestures.
    const TAP_SLOP = 10;        // client px of movement that still counts as a tap
    const LONG_PRESS_MS = 400;

    let tGest = null;           // active one-finger gesture
    let tTwo = null;            // active two-finger gesture
    let tLpTimer = 0;
    let preTouch = null;        // mouse state saved while fingers are down
    let mouseMovedInTouch = false;

    function clientToWorld() {
      const r = canvas.getBoundingClientRect();
      return C.SCREEN_W / r.width / C.ZOOM;  // client px -> WORLD px
    }

    function _cancelOneFinger() {
      clearTimeout(tLpTimer);
      const g = tGest;
      tGest = null;
      if (!g) return;
      // release only the state this touch gesture owns — a simultaneous
      // mouse drag on a hybrid device must survive a stray touch
      if (g.boxSelect) { dragStart = null; dragRect = null; }
      if (g.wallDrag) { wallDrag = null; wallLine = null; }
      if (g.radar) radarDrag = false;
    }

    // hybrid devices: once every canvas finger has lifted, put the mouse
    // back where it really is so the cursor and edge scroll come back
    function _restoreMouse(ev) {
      if (ev && ev.targetTouches && ev.targetTouches.length) return;
      if (preTouch && preTouch.inside && !mouseMovedInTouch) {
        mouse.x = preTouch.x; mouse.y = preTouch.y; mouse.inside = true;
      }
      preTouch = null;
    }

    // forgiving tap targets: at phone scale several chrome controls are
    // finger-hostile (the 32px tab bar is ~11 CSS px tall) — snap near-miss
    // taps to their centers. Exact hits on anything interactive pass through.
    function _touchSnap(p) {
      const hit = Render.hitTest(p.x, p.y);
      if (hit.zone !== 'viewport' && hit.zone !== 'sidebar' && hit.zone !== 'tab') return p;
      if (p.y < C.TAB_H + 18) {
        if (p.x < 130) return { x: 60, y: C.TAB_H / 2 };
        if (p.x >= C.GROUP_X && p.x < C.GROUP_X + C.GROUP_N * C.GROUP_SPACING) {
          const i = ((p.x - C.GROUP_X) / C.GROUP_SPACING) | 0;
          return { x: C.GROUP_X + i * C.GROUP_SPACING + C.GROUP_W / 2, y: C.TAB_H / 2 };
        }
      }
      if (p.x >= C.SIDEBAR_X && p.y >= C.BTN_Y - 12 && p.y < C.BTN_Y + C.BTN_H + 12) {
        const b0 = C.SIDEBAR_X + 8;
        if (p.x >= b0 - 8 && p.x < b0 + 100) return { x: b0 + 48, y: C.BTN_Y + C.BTN_H / 2 };
        if (p.x >= b0 + 100 && p.x < b0 + 204) return { x: b0 + 152, y: C.BTN_Y + C.BTN_H / 2 };
      }
      const ay = C.STRIP_Y + C.STRIP_VISIBLE * C.STRIP_SPACING;
      if (p.y >= ay - 10 && p.y < ay + 34) {
        for (const sx of [C.STRIP_BX, C.STRIP_UX]) {
          if (p.x >= sx - 6 && p.x < sx + C.CAMEO_PW + 6) {
            return { x: p.x < sx + C.CAMEO_PW / 2 ? sx + C.CAMEO_PW / 4 : sx + C.CAMEO_PW * 3 / 4, y: ay + 12 };
          }
        }
      }
      return p;
    }

    canvas.addEventListener('touchstart', ev => {
      ev.preventDefault(); // also stops the browser synthesizing mouse events
      if (!audioUnlocked) { audioUnlocked = true; AUDIO.init(); }
      if (!tGest && !tTwo) {
        preTouch = { x: mouse.x, y: mouse.y, inside: mouse.inside };
        mouseMovedInTouch = false;
      }
      mouse.inside = false;
      const tt = ev.targetTouches; // only fingers that began on the canvas
      if (tt.length === 1) {
        const t = tt[0];
        const p = toInternal(t);
        mouse.x = p.x; mouse.y = p.y;   // place ghost + radar scrub track the finger
        const playing = game && !game.paused && game.status === 'playing';
        const hit = playing ? Render.hitTest(p.x, p.y) : { zone: 'none' };
        tGest = {
          id: t.identifier, t0: Date.now(),
          start: p, startClient: { x: t.clientX, y: t.clientY },
          lastClient: { x: t.clientX, y: t.clientY },
          zone: hit.zone, moved: false, consumed: false,
          boxSelect: false, wallDrag: false, radar: false, stripAcc: 0, anchor: null,
        };
        if (!playing) return;
        if (hit.zone === 'viewport' && mode === 'place' && modeArg &&
            DATA.buildings[modeArg] && DATA.buildings[modeArg].wall) {
          const w = Render.worldFromScreen(p.x, p.y);
          if (w) {
            wallDrag = { cx: worldToCell(w.x), cy: worldToCell(w.y) };
            wallLine = [wallDrag];
            tGest.wallDrag = true;
          }
        }
        if (hit.zone === 'radar' && Render.radarOn()) {
          radarDrag = true;
          tGest.radar = true;
          _radarJump();
        }
        clearTimeout(tLpTimer);
        tLpTimer = setTimeout(() => {
          if (!tGest || tGest.moved || tTwo) return;
          if (!game || game.paused || game.status !== 'playing') return;
          const h = Render.hitTest(tGest.start.x, tGest.start.y);
          if (h.zone === 'viewport' && mode === 'normal') {
            tGest.boxSelect = true;
            tGest.anchor = { x: tGest.start.x, y: tGest.start.y };
            dragStart = { x: tGest.start.x, y: tGest.start.y };
            if (navigator.vibrate) navigator.vibrate(20);
          } else if (h.zone === 'icon' && !h.super &&
                     (h.state === 'building' || h.state === 'hold' || h.state === 'ready')) {
            Production.cancel(game.human, h.key);
            // cancelling the ready building while its ghost is up would
            // strand place mode: every later tap would fail silently
            if (mode === 'place' && modeArg === h.key) _setMode('normal');
            tGest.consumed = true;
            if (navigator.vibrate) navigator.vibrate(20);
          } else if (h.zone === 'tab-group') {
            game.groups[h.n] = game.selection.slice(); // empty selection clears
            tGest.consumed = true;
            AUDIO.play('click');
            if (navigator.vibrate) navigator.vibrate(20);
          }
        }, LONG_PRESS_MS);
      } else if (tt.length === 2) {
        // a second canvas finger turns the gesture two-finger. Two-finger
        // TAP (deselect) stays armed only if the first contact was fresh
        // and unmoved — a graze against a long pan must not wipe anything.
        const wasQuickTap = tGest ? (!tGest.moved && Date.now() - tGest.t0 < 350)
          : ev.changedTouches.length >= 2; // orphan finger + new finger: pan only
        _cancelOneFinger();
        const a = tt[0], b = tt[1];
        const mid = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
        tTwo = {
          idA: a.identifier, idB: b.identifier,
          startMid: mid, lastMid: mid, t0: Date.now(), moved: false,
          tapEligible: wasQuickTap,
        };
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', ev => {
      ev.preventDefault();
      const byId = id => {
        for (const t of ev.targetTouches) if (t.identifier === id) return t;
        return null;
      };
      if (tTwo) {
        const a = byId(tTwo.idA), b = byId(tTwo.idB);
        if (!a || !b) return;
        const mid = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
        if (game && !game.paused && game.status === 'playing') {
          const s = clientToWorld();
          game.camera.x = clamp(game.camera.x - (mid.x - tTwo.lastMid.x) * s, 0, C.MAP_W * C.CELL - C.VIEW_W);
          game.camera.y = clamp(game.camera.y - (mid.y - tTwo.lastMid.y) * s, 0, C.MAP_H * C.CELL - C.VIEW_H);
        }
        if (Math.hypot(mid.x - tTwo.startMid.x, mid.y - tTwo.startMid.y) > TAP_SLOP) tTwo.moved = true;
        tTwo.lastMid = mid;
        return;
      }
      if (!tGest) return;
      const t = byId(tGest.id);
      if (!t) return;
      const p = toInternal(t);
      mouse.x = p.x; mouse.y = p.y;
      if (!tGest.moved &&
          Math.hypot(t.clientX - tGest.startClient.x, t.clientY - tGest.startClient.y) > TAP_SLOP) {
        tGest.moved = true;
        if (!tGest.boxSelect) clearTimeout(tLpTimer);
      }
      if (!game || game.paused || game.status !== 'playing') {
        tGest.lastClient = { x: t.clientX, y: t.clientY };
        return;
      }
      if (tGest.boxSelect) {
        // anchor lives on the gesture: a hybrid-device mouse click nulling
        // the shared dragStart mid-gesture must not crash the box drag
        dragRect = { x1: tGest.anchor.x, y1: tGest.anchor.y, x2: p.x, y2: p.y };
      } else if (tGest.wallDrag && wallDrag) {
        const w = Render.worldFromScreen(p.x, p.y);
        if (w) wallLine = _wallCells(wallDrag, { cx: worldToCell(w.x), cy: worldToCell(w.y) });
      } else if (tGest.radar && radarDrag) {
        _radarJump();
      } else if (tGest.zone === 'viewport' && tGest.moved && mode !== 'place') {
        const s = clientToWorld();
        game.camera.x = clamp(game.camera.x - (t.clientX - tGest.lastClient.x) * s, 0, C.MAP_W * C.CELL - C.VIEW_W);
        game.camera.y = clamp(game.camera.y - (t.clientY - tGest.lastClient.y) * s, 0, C.MAP_H * C.CELL - C.VIEW_H);
      } else if (tGest.moved && tGest.start.x >= C.STRIP_BX &&
                 (tGest.zone === 'icon' || tGest.zone === 'arrow' || tGest.zone === 'sidebar')) {
        // swipe scrolls the build strips, one row per icon-height dragged
        const r = canvas.getBoundingClientRect();
        tGest.stripAcc += (tGest.lastClient.y - t.clientY) * (C.SCREEN_H / r.height);
        const strip = tGest.start.x < C.STRIP_UX ? 'b' : 'u';
        while (tGest.stripAcc >= C.STRIP_SPACING) { _scrollStrip(strip, 1); tGest.stripAcc -= C.STRIP_SPACING; }
        while (tGest.stripAcc <= -C.STRIP_SPACING) { _scrollStrip(strip, -1); tGest.stripAcc += C.STRIP_SPACING; }
      }
      tGest.lastClient = { x: t.clientX, y: t.clientY };
    }, { passive: false });

    canvas.addEventListener('touchend', ev => {
      ev.preventDefault();
      const lifted = id => {
        for (const t of ev.changedTouches) if (t.identifier === id) return t;
        return null;
      };
      if (tTwo) {
        if (lifted(tTwo.idA) || lifted(tTwo.idB)) {
          if (tTwo.tapEligible && !tTwo.moved && Date.now() - tTwo.t0 < 350 &&
              game && !game.paused && game.status === 'playing') {
            _rightClick();
          }
          tTwo = null; // a remaining finger is ignored until lifted
          _restoreMouse(ev);
        }
        return;
      }
      if (!tGest) { _restoreMouse(ev); return; }
      const t = lifted(tGest.id);
      if (!t) return; // some other finger lifted, not the gesture's
      clearTimeout(tLpTimer);
      const p = toInternal(t);
      mouse.x = p.x; mouse.y = p.y;
      const g = tGest;
      tGest = null;
      if (g.radar) radarDrag = false;
      if (!game || game.paused || game.status !== 'playing') {
        if (g.boxSelect) { dragStart = null; dragRect = null; }
        if (g.wallDrag) { wallDrag = null; wallLine = null; }
        _restoreMouse(ev);
        return;
      }
      if (g.wallDrag && wallDrag) {
        const cells = wallLine || [wallDrag];
        const placed = Production.placeWallLine(game, game.human, modeArg, cells);
        wallDrag = null; wallLine = null;
        // in MP the queued placement consumes ready ~5 ticks from now —
        // exit place mode on the optimistic ack rather than sticking
        if (placed && (!game.human.ready.building || NET.active)) _setMode('normal');
        else if (!placed) AUDIO.play('buzz');
        _restoreMouse(ev);
        return;
      }
      if (g.boxSelect && dragRect) {
        _boxSelect(true); // touch boxes ADD to the selection (deselect = two-finger tap)
        dragStart = null; dragRect = null;
        _restoreMouse(ev);
        return;
      }
      if (g.boxSelect) { dragStart = null; dragRect = null; } // armed but unused: plain tap
      if (!g.moved && !g.consumed && g.zone !== 'none') {
        const sp = _touchSnap(p);
        _leftClick(sp.x, sp.y, false, false, true);
      }
      _restoreMouse(ev);
    }, { passive: false });

    canvas.addEventListener('touchcancel', ev => {
      _cancelOneFinger();
      tTwo = null;
      _restoreMouse(ev);
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
      if (ev.key === 'F1' || ev.key === '?') {
        if (typeof Main !== 'undefined') Main.showControls();
        ev.preventDefault();   // F1 must not open the browser's help
        return;
      }
      // seat swap works even paused — it's render-only, and observers pause
      // exactly to inspect a frozen moment from every commander's side
      if ((ev.key === 'v' || ev.key === 'V') && game.status === 'playing' &&
          Render.cycleView(ev.shiftKey ? -1 : 1)) {
        AUDIO.play('click');
        return;
      }
      if (game.paused || game.status !== 'playing') return;
      _hotkeys(ev);
    });
    window.addEventListener('keyup', ev => { keys[ev.key] = false; });
    // a modifier released while the window is unfocused never sends keyup —
    // drop everything on blur so Shift/Ctrl can't stick
    window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
  }

  function _setMode(m, arg) {
    mode = m;
    modeArg = arg || null;
    wallDrag = null;
    wallLine = null;
  }

  // wall run: from start toward end. Straight drags give a straight line;
  // angled drags rasterize as an orthogonal STAIRCASE (never diagonal jumps),
  // so every cell shares an edge with the next — the auto-connect sprites
  // join up and units can't slip between corner-touching posts.
  // Gates place one at a time — a drag must not sweep out a $250-a-cell run.
  function _wallCells(a, b) {
    if (modeArg && DATA.buildings[modeArg] && DATA.buildings[modeArg].gate) return [a];
    const cells = [{ cx: a.cx, cy: a.cy }];
    let x = a.cx, y = a.cy;
    let err = 0;
    const dx = Math.abs(b.cx - a.cx), dy = Math.abs(b.cy - a.cy);
    const sx2 = Math.sign(b.cx - a.cx), sy2 = Math.sign(b.cy - a.cy);
    while ((x !== b.cx || y !== b.cy) && cells.length <= 13) {
      // step along whichever axis is furthest behind its ideal line
      if (x !== b.cx && (y === b.cy || err <= 0)) { x += sx2; err += dy; }
      else { y += sy2; err -= dx; }
      cells.push({ cx: x, cy: y });
    }
    return cells;
  }

  function _radarJump() {
    const fx = clamp((mouse.x - C.MM_X) / C.MM_S, 0, 1);
    const fy = clamp((mouse.y - C.MM_Y) / C.MM_S, 0, 1);
    game.camera.x = clamp(fx * C.MAP_W * C.CELL - C.VIEW_W / 2, 0, C.MAP_W * C.CELL - C.VIEW_W);
    game.camera.y = clamp(fy * C.MAP_H * C.CELL - C.VIEW_H / 2, 0, C.MAP_H * C.CELL - C.VIEW_H);
  }

  function _scrollStrip(strip, dir) {
    // the strips show the OBSERVED commander while spectating/replaying, so
    // scroll that player's offsets (cosmetic state, excluded from checksums)
    const p = Render.viewPlayer() || game.human;
    const it = Production.items(p);
    const list = strip === 'b' ? it.buildings : it.units;
    const cur = p.scroll[strip];
    const max = Math.max(0, list.length - C.STRIP_VISIBLE);
    const next = clamp(cur + dir, 0, max);
    if (next !== cur) {
      p.scroll[strip] = next;
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

  function _leftClick(x, y, shift, ctrl, fromTouch) {
    const g = game;
    const hit = Render.hitTest(x, y);

    if (hit.zone === 'tab-options') {
      if (typeof Main !== 'undefined') Main.togglePause();
      return;
    }
    if (hit.zone === 'tab-group') { _recallGroup(hit.n, shift); return; }
    if (hit.zone === 'idle-harv') { _cycleIdleHarv(); return; }
    if (hit.zone === 'view-cycle') {
      if (Render.cycleView(hit.dir)) AUDIO.play('click');
      return;
    }
    if (hit.zone === 'arrow') { _scrollStrip(hit.strip, hit.dir); return; }
    if (hit.zone === 'btn') {
      if (hit.which === 'repair') { _setMode(mode === 'repair' ? 'normal' : 'repair'); AUDIO.play('click'); }
      else if (hit.which === 'sell') { _setMode(mode === 'sell' ? 'normal' : 'sell'); AUDIO.play('click'); }
      return;
    }
    if (hit.zone === 'icon') {
      _iconClick(hit, shift);
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
    if (mode === 'amove') {
      // attack-move: sweep to the clicked spot, engaging everything en route
      const am = _selectedUnits().filter(u => u.owner === g.humanSide);
      if (am.length) {
        const spots = _formationCells(cx, cy, am.length);
        am.forEach((u, i) => {
          const s = spots[Math.min(i, spots.length - 1)];
          orderAttackMove(u, s.cx, s.cy);
        });
        AUDIO.ack('attack', _selClass());
        spawnEffect('atkMark', cellCenterX(cx), cellCenterY(cy), { ttl: 14 });
      } else AUDIO.play('buzz');
      _setMode('normal');
      return;
    }

    // ---- normal mode: classic left-click scheme ----
    const ent = _entAt(w.x, w.y);
    const sel = _selectedUnits();
    const ownSel = sel.filter(u => u.owner === g.humanSide);

    // Ctrl+click: focus fire on ANY unit or building — friend, foe or neutral;
    // Ctrl+click on open GROUND is attack-move (same as the A hotkey)
    if (ctrl && ent && ownSel.length) {
      let acted = false;
      for (const u of ownSel) if (orderAttack(u, ent)) acted = true;
      if (acted) {
        AUDIO.ack('attack', _selClass());
        spawnEffect('atkMark', _entX(ent), _entY(ent), { ttl: 14 });
      } else AUDIO.play('buzz');
      return;
    }
    if (ctrl && !ent && ownSel.some(u =>
        DATA.units[u.type].weapon && !DATA.units[u.type].air)) {
      const spots = _formationCells(cx, cy, ownSel.length);
      ownSel.forEach((u, i) => {
        const s = spots[Math.min(i, spots.length - 1)];
        orderAttackMove(u, s.cx, s.cy);
      });
      AUDIO.ack('attack', _selClass());
      spawnEffect('atkMark', cellCenterX(cx), cellCenterY(cy), { ttl: 14 });
      return;
    }

    if (ent && ent.owner === g.humanSide) {
      // MCV deploy on second click
      if (ent.kind === 'unit' && DATA.units[ent.type].deploysTo &&
          ownSel.length === 1 && ownSel[0].id === ent.id) {
        if (!orderDeploy(ent)) AUDIO.play('buzz');
        return;
      }
      // loaded transport unloads on second click (like the original's
      // deploy-click) — also the touch substitute for the U hotkey
      if (ent.kind === 'unit' && DATA.units[ent.type].transport &&
          ownSel.length === 1 && ownSel[0].id === ent.id &&
          ent.cargo && ent.cargo.length) {
        AUDIO.play(unloadCargo(ent) ? 'click' : 'buzz');
        return;
      }
      // engineer heal own damaged building — checked BEFORE the repair pad
      // so the click does what the 'enter' cursor promised
      if (ent.kind === 'building' && ownSel.some(u => DATA.units[u.type].engineer) && ent.hp < ent.maxHp) {
        for (const u of ownSel) if (DATA.units[u.type].engineer) orderEnter(u, ent);
        AUDIO.ack('move', _selClass());
        return;
      }
      // repair facility: send the selected vehicles to the pad — the sim
      // heals whoever parks on/beside it
      if (ent.kind === 'building' && DATA.buildings[ent.type].repairPad &&
          ent.buildProgress >= 1) {
        const vehs = ownSel.filter(u => {
          const d = DATA.units[u.type];
          return u.kind === 'unit' && !d.infantry && !d.air;
        });
        if (vehs.length) {
          const spots = _formationCells(ent.cx + ((ent.w / 2) | 0), ent.cy + ent.h, vehs.length);
          vehs.forEach((u, i) => {
            const s = spots[Math.min(i, spots.length - 1)];
            orderMove(u, s.cx, s.cy);
          });
          AUDIO.ack('move', _selClass());
          AUDIO.eva('repairing');
          spawnEffect('moveMark', (ent.cx + ent.w / 2) * C.CELL, (ent.cy + ent.h) * C.CELL, { ttl: 14 });
          return;
        }
      }
      // load infantry into a friendly transport
      if (ent.kind === 'unit' && DATA.units[ent.type].transport &&
          ownSel.length && ownSel.every(u => DATA.units[u.type].infantry) &&
          !ownSel.some(u => u.id === ent.id)) {
        let acted = false;
        for (const u of ownSel) if (orderBoard(u, ent)) acted = true;
        if (acted) AUDIO.ack('move', _selClass());
        else AUDIO.play('buzz');
        return;
      }
      // select it
      if (ent.kind === 'unit') {
        const now = Date.now();
        // on touch, tapping a unit inside a multi-selection drops it from the
        // group — the shift-click substitute for pruning a band-box sweep
        const touchToggle = fromTouch && g.selection.length > 1 && g.selection.includes(ent.id);
        if (lastClick.id === ent.id && now - lastClick.t < 350) {
          _selectSameTypeOnScreen(ent.type);
        } else if (shift || touchToggle) {
          const has = g.selection.includes(ent.id);
          _select(has ? g.selection.filter(i => i !== ent.id) : g.selection.concat(ent.id));
        } else {
          _select([ent.id]);
        }
        lastClick = { t: now, id: ent.id };
      } else {
        // reinforcing your own garrison: armed infantry file in
        if (ent.kind === 'building' && DATA.buildings[ent.type].garrison &&
            (ent.garrison || []).length < DATA.buildings[ent.type].garrison) {
          const inf = ownSel.filter(u => {
            const d = DATA.units[u.type];
            return d.infantry && d.weapon && !d.engineer;
          });
          if (inf.length) {
            let acted = false;
            for (const u of inf) if (orderEnter(u, ent)) acted = true;
            if (acted) {
              AUDIO.ack('move', 'inf');
              spawnEffect('moveMark', _entX(ent), _entY(ent), { ttl: 14 });
              return;
            }
          }
        }
        // second click on your already-selected factory makes it primary;
        // on a garrisoned structure it empties it
        const sole = g.selection.length === 1 && g.selection[0] === ent.id;
        if (sole && DATA.buildings[ent.type].factory && Production.setPrimary(g.human, ent)) {
          AUDIO.play('click');
          return;
        }
        if (sole && ent.garrison && ent.garrison.length) {
          AUDIO.play(unloadCargo(ent) ? 'click' : 'buzz');
          return;
        }
        _select([ent.id], true);
        AUDIO.play('click');
      }
      return;
    }

    if (ent && ent.owner !== g.humanSide) {
      // armed infantry occupy a neutral garrisonable structure (plain click;
      // Ctrl+click still force-attacks it)
      if (ent.kind === 'building' && ent.owner === 'civ' &&
          DATA.buildings[ent.type].garrison && ownSel.length) {
        const inf = ownSel.filter(u => {
          const d = DATA.units[u.type];
          return d.infantry && d.weapon && !d.engineer;
        });
        if (inf.length) {
          let acted = false;
          for (const u of inf) if (orderEnter(u, ent)) acted = true;
          if (acted) {
            AUDIO.ack('move', 'inf');
            spawnEffect('moveMark', _entX(ent), _entY(ent), { ttl: 14 });
            return;
          }
        }
      }
      if (ownSel.length) {
        // engineers capture enemy buildings
        let acted = false;
        for (const u of ownSel) {
          const d = DATA.units[u.type];
          if (d.engineer && ent.kind === 'building') { orderEnter(u, ent); acted = true; }
          else if (orderAttack(u, ent)) acted = true;
        }
        if (acted) {
          AUDIO.ack('attack', _selClass());
          spawnEffect('atkMark', _entX(ent), _entY(ent), { ttl: 14 });
        } else AUDIO.play('buzz');
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
        spawnEffect('moveMark', cellCenterX(cx), cellCenterY(cy), { ttl: 14 });
        return;
      }
      if (terrainPassable(g.terrain[cellIdx(cx, cy)]) || ownSel.some(u => DATA.units[u.type].air)) {
        const spots = _formationCells(cx, cy, ownSel.length);
        ownSel.forEach((u, i) => {
          const s = spots[Math.min(i, spots.length - 1)];
          orderMove(u, s.cx, s.cy);
        });
        AUDIO.ack('move', _selClass());
        spawnEffect('moveMark', cellCenterX(cx), cellCenterY(cy), { ttl: 14 });
      } else {
        AUDIO.play('buzz');
      }
      return;
    }

    // building selected: set rally point
    const selB = g.selection.map(id => g.buildings.get(id)).filter(Boolean);
    if (selB.length === 1 && selB[0].owner === g.humanSide && DATA.buildings[selB[0].type].factory) {
      orderRally(selB[0], cx, cy);
      AUDIO.play('click');
      spawnEffect('moveMark', cellCenterX(cx), cellCenterY(cy), { ttl: 14 });
    }
  }

  function _iconClick(hit, shift) {
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
    // Shift+click queues a batch of five (units only) — the event's own
    // modifier, not the keys map, which can go stale across focus loss
    const batch = shift && Production.categoryOf(hit.key) !== 'building' ? 5 : 1;
    for (let i = 0; i < batch; i++) {
      if (!Production.tryStart(p, hit.key)) break;
    }
  }

  // jump through the idle harvesters, one per click: select + center camera
  function _cycleIdleHarv() {
    const g = game;
    const idle = [];
    for (const id of g.human.unitIds) {
      const u = g.units.get(id);
      if (u && !u._dead && DATA.units[u.type].harvester && u.state === 'idle') idle.push(u);
    }
    if (!idle.length) { AUDIO.play('buzz'); return; }
    g._idleHarvIx = ((g._idleHarvIx || 0) + 1) % idle.length;
    const u = idle[g._idleHarvIx];
    _select([u.id], false);
    g.camera.x = clamp(u.x - C.VIEW_W / 2, 0, C.MAP_W * C.CELL - C.VIEW_W);
    g.camera.y = clamp(u.y - C.VIEW_H / 2, 0, C.MAP_H * C.CELL - C.VIEW_H);
    AUDIO.play('click');
  }

  function _rightClick() {
    if (mode !== 'normal') {
      _setMode('normal');
      return;
    }
    game.selection = [];
  }

  function _iconRightClick(shift) {
    const hit = Render.hitTest(mouse.x, mouse.y);
    if (hit.zone === 'icon' && !hit.super &&
        (hit.state === 'building' || hit.state === 'hold' || hit.state === 'ready' ||
         (hit.count || 0) > 0)) {
      // Shift+right-click clears the whole run of that unit (queue max 20 + active)
      const times = shift ? 21 : 1;
      for (let i = 0; i < times; i++) Production.cancel(game.human, hit.key);
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
      } else {
        _recallGroup(n, ev.shiftKey);
      }
      return;
    }
    switch (k.toLowerCase()) {
      case 'a': {
        // attack-move mode: next click sweeps the army to that spot. Air
        // units can't sweep (no auto-acquire in flight) — they need at least
        // one ground gun along or the "attack" promise would be a lie
        const armed = _selectedUnits().some(u =>
          u.owner === g.humanSide && DATA.units[u.type].weapon && !DATA.units[u.type].air);
        if (armed) { _setMode(mode === 'amove' ? 'normal' : 'amove'); AUDIO.play('click'); }
        else AUDIO.play('buzz');
        break;
      }
      case 'e': {
        // select every unit on screen EXCEPT harvesters (the "grab the army"
        // key — engineers, APCs and MCVs ride along; the economy stays home)
        const ids = [];
        for (const u of g.units.values()) {
          if (u.owner !== g.humanSide) continue;
          if (DATA.units[u.type].harvester) continue;
          const sx = (u.x - g.camera.x) * 2, sy = (u.y - g.camera.y) * 2;
          if (sx >= 0 && sx <= C.VIEW_PW && sy >= 0 && sy <= C.VIEW_PH) ids.push(u.id);
        }
        if (ids.length) { _select(ids, false); AUDIO.play('click'); }
        break;
      }
      case ' ': {
        // jump to the newest alert ping (base attacked, harvester in trouble,
        // incoming superweapon)
        const pings = g._pings;
        if (pings && pings.length) {
          const p2 = pings[pings.length - 1];
          g.camera.x = clamp(p2.x - C.VIEW_W / 2, 0, C.MAP_W * C.CELL - C.VIEW_W);
          g.camera.y = clamp(p2.y - C.VIEW_H / 2, 0, C.MAP_H * C.CELL - C.VIEW_H);
        }
        ev.preventDefault();   // space must never "click" a focused menu button
        break;
      }
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
      case 'u': {
        let acted = false;
        for (const u of _selectedUnits()) {
          if (DATA.units[u.type].transport && unloadCargo(u)) acted = true;
        }
        for (const id of g.selection) {
          const b = g.buildings.get(id);
          if (b && b.owner === g.humanSide && b.garrison && b.garrison.length && unloadCargo(b)) acted = true;
        }
        AUDIO.play(acted ? 'click' : 'buzz');
        break;
      }
      case 't': {
        const sel = _selectedUnits();
        if (sel.length) _selectSameTypeOnScreen(sel[0].type);
        break;
      }
      case 'p': {
        const selB = g.selection.map(id => g.buildings.get(id)).filter(Boolean);
        if (selB.length === 1 && selB[0].owner === g.humanSide && Production.setPrimary(g.human, selB[0])) {
          AUDIO.play('click');
        } else {
          AUDIO.play('buzz');
        }
        break;
      }
    }
  }

  function _recallGroup(n, shift) {
    const g = game;
    if (!g.groups[n] || !g.groups[n].length) return;
    const ids = g.groups[n].filter(id => g.units.get(id) || g.buildings.get(id));
    g.groups[n] = ids;
    if (!ids.length) return;
    if (shift) {
      _select([...new Set(g.selection.concat(ids))], true); // add group to selection
    } else {
      _select(ids.slice(), true);
      const now = Date.now();
      if (lastGroupTap.n === n && now - lastGroupTap.t < 400) _centerOnSelection();
      lastGroupTap = { t: now, n };
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
    if (mode === 'amove') return 'attack';
    const ent = _entAt(w.x, w.y);
    if (mode === 'sell') return ent && ent.kind === 'building' && ent.owner === g.humanSide ? 'sell' : 'nosell';
    if (mode === 'repair') {
      return ent && ent.kind === 'building' && ent.owner === g.humanSide && ent.hp < ent.maxHp ? 'repair' : 'norepair';
    }

    const sel = _selectedUnits().filter(u => u.owner === g.humanSide);
    // Ctrl held = focus-fire mode: attack cursor over any entity — and over
    // open ground too, where the click will issue an attack-move sweep
    if (keys['Control'] && ent && sel.some(u => DATA.units[u.type].weapon)) return 'attack';
    if (keys['Control'] && !ent &&
        sel.some(u => DATA.units[u.type].weapon && !DATA.units[u.type].air)) return 'attack';
    if (ent && ent.owner === g.humanSide) {
      if (ent.kind === 'unit' && DATA.units[ent.type].deploysTo && sel.length === 1 && sel[0].id === ent.id) {
        return 'deploy';
      }
      if (ent.kind === 'unit' && DATA.units[ent.type].transport && sel.length === 1 &&
          sel[0].id === ent.id && ent.cargo && ent.cargo.length) {
        return 'deploy';
      }
      if (ent.kind === 'building' && sel.some(u => DATA.units[u.type].engineer) && ent.hp < ent.maxHp) return 'enter';
      if (ent.kind === 'building' && DATA.buildings[ent.type].repairPad && ent.buildProgress >= 1 &&
          sel.some(u => { const d = DATA.units[u.type]; return u.kind === 'unit' && !d.infantry && !d.air; })) {
        return 'repair';
      }
      if (ent.kind === 'unit' && DATA.units[ent.type].transport && sel.length &&
          sel.every(u => DATA.units[u.type].infantry) && !sel.some(u => u.id === ent.id)) return 'enter';
      if (ent.kind === 'building' && DATA.buildings[ent.type].garrison &&
          (ent.garrison || []).length < DATA.buildings[ent.type].garrison &&
          sel.some(u => { const d = DATA.units[u.type]; return d.infantry && d.weapon && !d.engineer; })) {
        return 'enter';
      }
      return 'select';
    }
    if (ent && ent.owner !== g.humanSide) {
      if (!sel.length) return 'select';
      if (ent.kind === 'building' && ent.owner === 'civ' && DATA.buildings[ent.type].garrison &&
          sel.some(u => { const d = DATA.units[u.type]; return d.infantry && d.weapon && !d.engineer; })) {
        return 'enter';
      }
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

  // right-click on sidebar icons cancels production; on a group chip it
  // assigns the selection. Gated on the canvas being the target: the canvas
  // mouseup (which bubbles first) has then refreshed mouse.x/y, so we never
  // act on coordinates a touch gesture left behind.
  document.addEventListener('mouseup', ev => {
    if (ev.button === 2 && ev.target && ev.target.id === 'screen' &&
        game && !game.paused && game.status === 'playing') {
      if (_iconRightClick(ev.shiftKey)) return;
      const hit = Render.hitTest(mouse.x, mouse.y);
      if (hit.zone === 'tab-group') {
        game.groups[hit.n] = game.selection.slice(); // empty selection clears
        AUDIO.play('click');
      }
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
    get wallLine() { return wallDrag ? (wallLine || [wallDrag]) : null; },
  };
})();
