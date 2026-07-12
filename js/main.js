'use strict';
// main.js — boot, menus, mission setup, fixed-step game loop, win/lose.
// Global: Main.

const Main = (function () {
  let canvas = null;
  let acc = 0, lastT = 0, rafStarted = false;
  let mySide = 'gdi';
  let myMission = null;   // current mission definition (null = skirmish)
  let ended = false;

  function $(id) { return document.getElementById(id); }

  // ---- maximizing the screen on mobile ----------------------------------------------
  // Layered, because no single mechanism works everywhere:
  //  1. Fullscreen API (standard + webkit-prefixed) — best when the browser
  //     honors it, absent entirely on iPhone.
  //  2. The "minimal-ui" scroll shim: mobile Chrome/Safari only collapse the
  //     address bar on a real page scroll, and the game normally swallows
  //     every touch — so when the bar is detected, the #swipeHint overlay
  //     asks for one swipe and lets it through as a genuine scroll.
  //  3. PWA install (manifest + service worker + beforeinstallprompt button)
  //     — launching from the home screen has no browser chrome at all.
  function _fsEl() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
  function _fsSupported() {
    const el = document.documentElement;
    return !!(el.requestFullscreen || el.webkitRequestFullscreen);
  }
  function _requestFullscreen() {
    const el = document.documentElement;
    const p = el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen();
    if (p && p.catch) p.catch(() => {}); // denied/unsupported mid-gesture — fail quietly
  }
  function _exitFullscreen() {
    if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  }
  function _toggleFullscreen() {
    if (_fsEl()) _exitFullscreen();
    else _requestFullscreen();
  }
  function _updateFsButton() {
    const btn = $('btnFullscreen');
    if (btn && _fsSupported()) btn.textContent = 'Fullscreen: ' + (_fsEl() ? 'ON' : 'OFF');
    if (_fsEl()) {
      $('swipeHint').classList.add('hidden'); // fullscreen made the shim moot
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
      }
    }
  }

  // On touch devices, match the internal layout to the device's real aspect
  // so the battlefield uses the full screen width — no letterbox bars. The
  // sidebar keeps its size on the right; the viewport absorbs the rest.
  // Desktop keeps the classic fixed 16:10 canvas sized purely by CSS.
  function _fitScreen() {
    if (!matchMedia('(pointer: coarse)').matches) return;
    const vv = window.visualViewport;
    const vw = vv ? vv.width : window.innerWidth;
    const vh = vv ? vv.height : window.innerHeight;
    if (!vw || !vh) return;
    applyScreenAspect(vw / vh);
    Render.resize();
    // CSS box: exact fill when the internal aspect matches the screen's;
    // outside the clamp range, letterbox the leftover axis
    const internal = C.SCREEN_W / C.SCREEN_H;
    let cw, ch;
    if (vw / vh >= internal) { ch = vh; cw = vh * internal; }
    else { cw = vw; ch = vw / internal; }
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    if (game) {
      game.camera.x = clamp(game.camera.x, 0, C.MAP_W * C.CELL - C.VIEW_W);
      game.camera.y = clamp(game.camera.y, 0, C.MAP_H * C.CELL - C.VIEW_H);
    }
  }

  // the browser bar is visible when the document (sized to the LARGE
  // viewport by the coarse-pointer CSS) overflows the visible viewport
  function _barVisible() {
    const vvh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    return document.documentElement.scrollHeight - vvh > 8;
  }
  let swipeSkipped = false;
  function _showSwipeHint() {
    if (swipeSkipped) return;
    if (!matchMedia('(pointer: coarse)').matches) return;
    if (!_barVisible()) return;
    $('swipeHint').classList.remove('hidden');
  }
  function _hideSwipeHintIfDone() {
    if (!$('swipeHint').classList.contains('hidden') && !_barVisible()) {
      $('swipeHint').classList.add('hidden');
    }
  }
  // try fullscreen (must be inside the user gesture), then fall back to the
  // swipe shim once the request has had a beat to succeed or fail
  function _maximizeScreen() {
    if (_fsEl()) return;
    if (_fsSupported()) _requestFullscreen();
    setTimeout(() => { if (!_fsEl()) _showSwipeHint(); }, 600);
  }

  function boot() {
    canvas = $('screen');
    Render.init(canvas);

    if (_fsSupported() || matchMedia('(pointer: coarse)').matches) {
      const btn = $('btnFullscreen');
      btn.classList.remove('hidden');
      if (!_fsSupported()) btn.textContent = 'Maximize Screen'; // iPhone: shim only
      btn.addEventListener('click', () => {
        if (_fsSupported()) {
          const entering = !_fsEl();
          _toggleFullscreen();
          if (entering) {
            setTimeout(() => {
              if (!_fsEl() && _barVisible()) {
                togglePause(false);
                swipeSkipped = false;
                _showSwipeHint();
              }
            }, 600);
          }
        } else {
          togglePause(false);
          swipeSkipped = false;
          _showSwipeHint();
        }
      });
      document.addEventListener('fullscreenchange', _updateFsButton);
      document.addEventListener('webkitfullscreenchange', _updateFsButton);
    }

    // the collapse fires resize/scroll — dismiss the hint the moment it lands
    $('btnSwipeSkip').addEventListener('click', () => {
      swipeSkipped = true;
      $('swipeHint').classList.add('hidden');
    });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', _hideSwipeHintIfDone);
    window.addEventListener('resize', _hideSwipeHintIfDone);
    window.addEventListener('scroll', _hideSwipeHintIfDone);

    // keep the internal layout matched to the real screen on touch devices —
    // the bar collapsing, rotating, or entering fullscreen all change it
    _fitScreen();
    if (window.visualViewport) window.visualViewport.addEventListener('resize', _fitScreen);
    window.addEventListener('resize', _fitScreen);
    window.addEventListener('orientationchange', _fitScreen);
    document.addEventListener('fullscreenchange', _fitScreen);
    document.addEventListener('webkitfullscreenchange', _fitScreen);

    // PWA install prompt (Android Chrome & friends): stash it, offer a button
    let installEv = null;
    window.addEventListener('beforeinstallprompt', ev => {
      ev.preventDefault();
      installEv = ev;
      $('btnInstall').classList.remove('hidden');
    });
    $('btnInstall').addEventListener('click', () => {
      if (!installEv) return;
      installEv.prompt();
      installEv.userChoice.then(() => { installEv = null; $('btnInstall').classList.add('hidden'); });
    });
    window.addEventListener('appinstalled', () => { $('btnInstall').classList.add('hidden'); });

    if ('serviceWorker' in navigator &&
        (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    // faction logos on the menu
    for (const [slot, side] of [['logoGdi', 'gdi'], ['logoNod', 'nod']]) {
      const el = $(slot);
      if (el && SPRITES.logo[side]) el.appendChild(SPRITES.logo[side]);
    }

    document.querySelectorAll('#menu button[data-side]').forEach(btn => {
      btn.addEventListener('click', () => {
        // touch devices only: maximize right away (fullscreen if the browser
        // honors it, else the swipe-the-bar-away shim). Desktop mouse users
        // get no surprise fullscreen — they have the pause-menu toggle.
        if (matchMedia('(pointer: coarse)').matches) _maximizeScreen();
        AUDIO.init();
        _showMissions(btn.dataset.side);
      });
    });
    $('btnMissionsBack').addEventListener('click', () => {
      $('missions').classList.add('hidden');
      $('menu').classList.remove('hidden');
    });
    $('btnBriefBack').addEventListener('click', () => {
      $('briefing').classList.add('hidden');
      $('missions').classList.remove('hidden');
    });
    $('btnCommence').addEventListener('click', () => {
      startGame(mySide, { mission: pendingMission });
    });

    $('btnResume').addEventListener('click', () => togglePause(false));
    $('btnSound').addEventListener('click', () => {
      AUDIO.setEnabled(!AUDIO.enabled);
      $('btnSound').textContent = 'Sound: ' + (AUDIO.enabled ? 'ON' : 'OFF');
    });
    // soundtrack toggle, persisted across sessions
    if (localStorage.getItem('td_music') === '0') MUSIC.setEnabled(false);
    $('btnMusic').textContent = 'Music: ' + (MUSIC.enabled ? 'ON' : 'OFF');
    $('btnMusic').addEventListener('click', () => {
      MUSIC.setEnabled(!MUSIC.enabled);
      localStorage.setItem('td_music', MUSIC.enabled ? '1' : '0');
      $('btnMusic').textContent = 'Music: ' + (MUSIC.enabled ? 'ON' : 'OFF');
    });
    // the synthesized comms voice (announcer + unit chatter), toggled apart
    // from SFX so players can keep gunfire but silence the talking
    if (localStorage.getItem('hw_voice') === '0') AUDIO.setVoiceEnabled(false);
    $('btnVoice').textContent = 'Voice: ' + (AUDIO.voiceEnabled ? 'ON' : 'OFF');
    $('btnVoice').addEventListener('click', () => {
      AUDIO.setVoiceEnabled(!AUDIO.voiceEnabled);
      localStorage.setItem('hw_voice', AUDIO.voiceEnabled ? '1' : '0');
      $('btnVoice').textContent = 'Voice: ' + (AUDIO.voiceEnabled ? 'ON' : 'OFF');
    });
    $('speedSlider').addEventListener('input', ev => {
      if (game) game.speed = ev.target.value / 100;
    });
    $('btnRestart').addEventListener('click', () => { togglePause(false); startGame(mySide, { mission: myMission }); });
    $('btnAbort').addEventListener('click', () => {
      togglePause(false);
      AUDIO.eva('battleControlTerminated');
      game = null;
      window.game = null;
      $('menu').classList.remove('hidden');
    });
    $('btnAgain').addEventListener('click', () => {
      $('score').classList.add('hidden');
      const wasMission = !!myMission;
      game = null;
      window.game = null;
      // after a campaign game, return to the operations list (freshly
      // rebuilt, so a win shows the next mission unlocked) — not the
      // faction menu
      if (wasMission) _showMissions(mySide);
      else $('menu').classList.remove('hidden');
    });

    // URL params for testing: ?side=&seed=&nomenu=1&mute=1&mission=N
    const q = new URLSearchParams(location.search);
    if (q.get('mute')) { AUDIO.setEnabled(false); MUSIC.setEnabled(false); }
    if (q.get('nomenu')) {
      AUDIO.init();
      startGame(q.get('side') === 'nod' ? 'nod' : 'gdi', {
        seed: q.get('seed') ? +q.get('seed') : undefined,
        mission: q.get('mission') ? MISSIONS[+q.get('mission') - 1] : undefined,
      });
    }

    if (!rafStarted) {
      rafStarted = true;
      requestAnimationFrame(loop);
    }
  }

  // ---- mission select & briefing -----------------------------------------------------

  let pendingMission = null;

  function _showMissions(side) {
    mySide = side;
    $('menu').classList.add('hidden');
    $('missionsTitle').textContent = 'OPERATIONS — ' + C.SIDE_NAME[side];
    const list = $('missionList');
    list.innerHTML = '';
    const done = MissionProgress.get();

    const skirm = document.createElement('button');
    skirm.innerHTML = '<span>SKIRMISH</span><span class="tag">RANDOM BATTLEFIELD</span>';
    skirm.addEventListener('click', () => {
      $('missions').classList.add('hidden');
      startGame(mySide);
    });
    list.appendChild(skirm);

    for (const m of MISSIONS) {
      const btn = document.createElement('button');
      const open = MissionProgress.unlocked(m);
      const tag = m.n <= done ? 'COMPLETE' : open ? 'READY' : 'LOCKED';
      btn.innerHTML = `<span>OP ${m.n}: ${m.title}</span><span class="tag">${tag}</span>`;
      if (m.n <= done) btn.classList.add('done');
      if (!open) btn.disabled = true;
      else btn.addEventListener('click', () => _showBriefing(m));
      list.appendChild(btn);
    }
    $('missions').classList.remove('hidden');
  }

  function _showBriefing(m) {
    pendingMission = m;
    $('missions').classList.add('hidden');
    $('briefTitle').textContent = 'OP ' + m.n + ': ' + m.title;
    $('briefBody').innerHTML = m.brief[mySide].map(p => `<p>${p}</p>`).join('');
    $('briefBody').scrollTop = 0;   // the element persists across briefings
    $('briefObjective').textContent = 'OBJECTIVE: ' + m.objText[mySide];
    $('briefing').classList.remove('hidden');
  }

  function _spawnEscort(g, side, pos, withMcv) {
    const passableNear = (n) => {
      const out = [];
      // start at r=2: r=1 cells sit inside the future conyard footprint
      for (let r = 2; r <= 6 && out.length < n; r++) {
        for (let dy = -r; dy <= r && out.length < n; dy++) {
          for (let dx = -r; dx <= r && out.length < n; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const cx = pos.cx + dx, cy = pos.cy + dy;
            if (inMap(cx, cy) && terrainPassable(g.terrain[cellIdx(cx, cy)]) && !g.occ[cellIdx(cx, cy)]) {
              out.push({ cx, cy });
            }
          }
        }
      }
      return out;
    };
    if (withMcv) addUnit(makeUnit('mcv', side, pos.cx, pos.cy));
    const scout = side === 'gdi' ? 'jeep' : 'bggy';
    const spots = passableNear(4);
    if (spots[0]) addUnit(makeUnit(scout, side, spots[0].cx, spots[0].cy));
    for (let i = 1; i < 4 && spots[i]; i++) {
      addUnit(makeUnit('e1', side, spots[i].cx, spots[i].cy));
    }
  }

  function startGame(side, opts) {
    opts = opts || {};
    mySide = side;
    myMission = opts.mission || null;
    ended = false;
    $('menu').classList.add('hidden');
    $('score').classList.add('hidden');
    $('pause').classList.add('hidden');
    $('missions').classList.add('hidden');
    $('briefing').classList.add('hidden');

    const mission = myMission;
    game = makeGame({ side, seed: opts.seed !== undefined ? opts.seed : (mission ? mission.seed : undefined) });
    game.mission = mission;   // read by ai.js (difficulty) and render.js (objective HUD)
    if (mission) {
      if (mission.credits !== undefined) game.human.credits = mission.credits;
      if (mission.aiCredits !== undefined) game.ai.credits = mission.aiCredits;
    }
    window.game = game;
    MUSIC.start();
    MAPGEN.generate(game, game.seed);
    Fog.init(game);

    const hp = game.startPos.human, ap = game.startPos.ai;

    // human: MCV + escort
    _spawnEscort(game, side, hp, true);

    // AI: pre-deployed conyard + power plant + escort
    const aiSide = enemyOf(side);
    const fact = makeBuilding('fact', aiSide, ap.cx - 1, ap.cy - 1);
    fact.buildProgress = 1;
    addBuilding(fact);
    const nukeB = makeBuilding('nuke', aiSide, ap.cx - 1, ap.cy + 2);
    nukeB.buildProgress = 1;
    addBuilding(nukeB);
    _spawnEscort(game, aiSide, { cx: ap.cx + 2, cy: ap.cy }, false);

    // neutral hamlet with its villagers (from map generation, if it found room)
    if (game.decor && game.decor.village) {
      for (const h of game.decor.village.houses) {
        const b = makeBuilding(h.type, 'civ', h.cx, h.cy);
        b.buildProgress = 1;
        addBuilding(b);
      }
      for (const c of game.decor.village.civs) {
        if (!terrainPassable(game.terrain[cellIdx(c.cx, c.cy)]) || game.occ[cellIdx(c.cx, c.cy)]) continue;
        const u = makeUnit(c.type, 'civ', c.cx, c.cy);
        u.guardAnchor = { x: u.x, y: u.y };  // home spot they wander around
        addUnit(u);
      }
    }

    Production.computePower(game.human);
    Production.computePower(game.ai);
    AI.init(game);
    Input.init(canvas, game);
    Fog.update(game);

    game.camera.x = clamp(cellCenterX(hp.cx) - C.VIEW_W / 2, 0, C.MAP_W * C.CELL - C.VIEW_W);
    game.camera.y = clamp(cellCenterY(hp.cy) - C.VIEW_H / 2, 0, C.MAP_H * C.CELL - C.VIEW_H);
    game.startTime = Date.now();
    game.speed = ($('speedSlider').value || 170) / 100;

    AUDIO.eva('battleControlOnline');
  }

  function loop(t) {
    requestAnimationFrame(loop);
    const dt = Math.min(200, t - lastT);
    lastT = t;
    if (game && !game.paused && game.status === 'playing') {
      acc += dt;
      const step = 1000 / (C.TPS * (game.speed || 1));
      let guard = 0;
      while (acc >= step && guard < 10) {
        acc -= step;
        guard++;
        game.tick++;
        Input.tick(game);
        Production.tick(game, game.human);
        Production.tick(game, game.ai);
        Sim.tick(game);
        AI.tick(game);
        Fog.update(game);
        if (game.tick % 15 === 0 && game.tick > 450) _checkEnd();
        if (!game || game.status !== 'playing') break;
      }
      if (guard >= 10) acc = 0;
    }
    Render.frame(game);
  }

  function _checkEnd() {
    const g = game;
    const alive = p => p.unitIds.length > 0 ||
      p.buildingIds.some(id => {
        const b = g.buildings.get(id);
        return b && !DATA.buildings[b.type].wall; // walls alone don't keep you in the game
      });
    const humanAlive = alive(g.human), aiAlive = alive(g.ai);
    if (!humanAlive) return endGame(false);
    if (!aiAlive) return endGame(true);    // wiping the enemy wins ANY mission

    // mission objectives beyond annihilation
    const ob = g.mission && g.mission.objective;
    if (!ob) return;
    if (ob.type === 'harvest' && g.stats.harvested >= ob.amount) return endGame(true);
    if (ob.type === 'survive' && g.tick >= ob.minutes * 60 * C.TPS) return endGame(true);
    if (ob.type === 'killEconomy') {
      // arms once the enemy owns a refinery or harvester; wins when the
      // count returns to zero — no insta-win before the AI has an economy
      const n = _aiEconomyCount(g);
      if (n > 0) g._ecoArmed = true;
      else if (g._ecoArmed) return endGame(true);
    }
  }

  function _aiEconomyCount(g) {
    let n = 0;
    for (const id of g.ai.buildingIds) {
      const b = g.buildings.get(id);
      if (b && b.type === 'proc') n++;
    }
    for (const id of g.ai.unitIds) {
      const u = g.units.get(id);
      if (u && DATA.units[u.type].harvester) n++;
    }
    return n;
  }

  function endGame(won) {
    if (ended || !game) return;
    ended = true;
    game.status = won ? 'won' : 'lost';
    if (won && game.mission) MissionProgress.unlockUpTo(game.mission.n);
    AUDIO.eva(won ? 'missionAccomplished' : 'missionFailed');

    const g = game;
    setTimeout(() => {
      if (game !== g) return;   // restarted/aborted before the tally — stale score
      const secs = Math.floor(g.tick / C.TPS);
      const mm = String(Math.floor(secs / 60)).padStart(2, '0');
      const ss = String(secs % 60).padStart(2, '0');
      const score = Math.max(0, g.stats.kills * 100 + g.stats.buildingsKilled * 200 +
        Math.floor(g.stats.harvested / 10) - g.stats.losses * 50);
      const rows = [
        ['Mission time', mm + ':' + ss],
        ['Tiberium harvested', Math.floor(g.stats.harvested)],
        ['Enemy units destroyed', g.stats.kills],
        ['Units lost', g.stats.losses],
        ['Enemy structures destroyed', g.stats.buildingsKilled],
        ['Structures lost', g.stats.buildingsLost],
        ['Score', score],
      ];
      const title = $('scoreTitle');
      title.textContent = won ? 'MISSION ACCOMPLISHED' : 'MISSION FAILED';
      title.style.color = won ? '#e0b840' : '#e05038';
      $('scoreLines').innerHTML = rows.map(r =>
        `<div class="row"><span>${r[0]}</span><span class="val">${r[1]}</span></div>`).join('');
      $('score').classList.remove('hidden');
    }, 1400);
  }

  function togglePause(force) {
    if (!game) return;
    if (!$('menu').classList.contains('hidden')) return;
    game.paused = force !== undefined ? force : !game.paused;
    $('pause').classList.toggle('hidden', !game.paused);
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }

  return { boot, startGame, endGame, togglePause };
})();
