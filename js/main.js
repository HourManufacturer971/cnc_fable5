'use strict';
// main.js — boot, menus, mission setup, fixed-step game loop, win/lose.
// Global: Main.

const Main = (function () {
  let canvas = null;
  let acc = 0, lastT = 0, rafStarted = false;
  let mySide = 'udc';
  let myMission = null;   // current mission definition (null = skirmish)
  let mySkirmish = null;  // skirmish difficulty preset (null = normal)
  let ended = false;

  // skirmish difficulty knobs — module scope so replays can reconstruct them
  const DIFF_PRESETS = {
    EASY: { skirmish: 'EASY', aiCalm: 1.7, aiWaveCap: 6, aiCredits: 3500 },
    HARD: { skirmish: 'HARD', aiCalm: 0.65, aiCredits: 9000, aiElite: true },
  };

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
    // re-derive the effective view for the current pinch zoom (aspect
    // changes VIEW_PW; the zoom scales it down to world units)
    if (typeof Render !== 'undefined' && Render.setViewZoom) Render.setViewZoom(C.VZOOM || 1);
    // CSS box: exact fill when the internal aspect matches the screen's;
    // outside the clamp range, letterbox the leftover axis
    const internal = C.SCREEN_W / C.SCREEN_H;
    let cw, ch;
    if (vw / vh >= internal) { ch = vh; cw = vh * internal; }
    else { cw = vw; ch = vw / internal; }
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    Render.resize();   // after the style set: it measures the new CSS box
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

    // touch devices get the wide sidebar BEFORE the first layout pass, so
    // every derived constant (strips, radar, buttons) picks it up
    if (matchMedia('(pointer: coarse)').matches) applyTouchSidebar();
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
    for (const [slot, side] of [['logoUdc', 'udc'], ['logoSrp', 'srp']]) {
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
        document.body.dataset.side = btn.dataset.side;   // retint menu chrome to the faction
        _showMissions(btn.dataset.side);
      });
    });
    $('btnMissionsBack').addEventListener('click', () => {
      $('missions').classList.add('hidden');
      _refreshResumeSave();
      $('menu').classList.remove('hidden');
    });
    $('btnSkirmish').addEventListener('click', () => _showSkirmish(mySide));
    // skirmish setup: remember the player's choices (the seed stays per-visit)
    try {
      const s = JSON.parse(localStorage.getItem('hw_sk') || 'null');
      if (s) {
        if (s.c) $('skCredits').value = s.c;
        if (s.cr !== undefined) $('skCrates').value = s.cr ? '1' : '0';
        if (s.sw !== undefined) $('skSupers').value = s.sw ? '1' : '0';
        if (s.p) $('skPlayers').value = s.p;
        if (s.m) $('skMap').value = s.m;
        if (s.d) $('skDiff').value = s.d;
      }
    } catch (e) {}
    for (const id of ['skCredits', 'skCrates', 'skSupers', 'skPlayers', 'skMap', 'skDiff']) {
      $(id).addEventListener('change', () => {
        try {
          localStorage.setItem('hw_sk', JSON.stringify({
            c: $('skCredits').value,
            cr: $('skCrates').value === '1',
            sw: $('skSupers').value === '1',
            p: $('skPlayers').value,
            m: $('skMap').value,
            d: $('skDiff').value,
          }));
        } catch (e) {}
      });
    }
    // the skirmish window: its own screen with EVERYTHING — side, difficulty,
    // combatants, map, funds, crates, superweapons, seed
    const skSideSync = () => {
      $('skSideUdc').classList.toggle('sel', skSide === 'udc');
      $('skSideSrp').classList.toggle('sel', skSide === 'srp');
    };
    $('skSideUdc').addEventListener('click', () => { skSide = 'udc'; skSideSync(); });
    $('skSideSrp').addEventListener('click', () => { skSide = 'srp'; skSideSync(); });
    $('btnSkBack').addEventListener('click', () => {
      $('skirmish').classList.add('hidden');
      _showMissions(skFrom);
    });
    $('btnSkLaunch').addEventListener('click', () => {
      const d = $('skDiff').value;
      const preset = d === 'EASY' ? DIFF_PRESETS.EASY : d === 'HARD' ? DIFF_PRESETS.HARD : null;
      $('skirmish').classList.add('hidden');
      startGame(skSide, { skirmish: preset, sk: _skOptions() });
    });
    _wireMpLobby();
    _wireTheater();
    $('btnBriefBack').addEventListener('click', () => {
      _stopTeletype();
      $('briefing').classList.add('hidden');
      $('missions').classList.remove('hidden');
    });
    $('btnCommence').addEventListener('click', () => {
      _stopTeletype();
      startGame(mySide, { mission: pendingMission });
    });

    $('btnResume').addEventListener('click', () => togglePause(false));
    // audio is controlled by the three sliders alone — a slider at 0 IS the
    // mute switch, so the old ON/OFF toggle buttons are gone
    // volume sliders: 50 = the designed level (multiplier value/50), persisted
    for (const [id, key, apply] of [
      ['volSfx', 'hw_vol_sfx', v => AUDIO.setVolume(v)],
      ['volMusic', 'hw_vol_music', v => MUSIC.setVolume(v)],
      ['volVoice', 'hw_vol_voice', v => AUDIO.setVoiceVolume(v)],
    ]) {
      const el = $(id);
      const saved = localStorage.getItem(key);
      if (saved !== null && saved !== '' && !isNaN(+saved)) el.value = +saved;
      apply(el.value / 50);
      el.addEventListener('input', () => {
        apply(el.value / 50);
        localStorage.setItem(key, el.value);
      });
    }
    $('btnControls').addEventListener('click', () => {
      $('pause').classList.add('hidden');
      $('controls').classList.remove('hidden');
    });
    $('btnControlsBack').addEventListener('click', () => {
      $('controls').classList.add('hidden');
      if (game && game.paused) $('pause').classList.remove('hidden');
    });
    $('speedSlider').addEventListener('input', ev => {
      if (game) game.speed = ev.target.value / 100;
    });
    $('btnRestart').addEventListener('click', () => {
      if (NET.active) { AUDIO.play('buzz'); return; }   // can't restart a lockstep match
      togglePause(false);
      startGame(mySide, { mission: myMission, skirmish: mySkirmish });
    });
    $('btnAbort').addEventListener('click', () => {
      NET.close();   // in MP this concedes: the opponent gets the victory
      togglePause(false);
      AUDIO.eva('battleControlTerminated');
      game = null;
      window.game = null;
      _refreshResumeSave();
      $('menu').classList.remove('hidden');
    });
    $('btnAgain').addEventListener('click', () => {
      NET.close();
      $('score').classList.add('hidden');
      const wasMission = !!myMission;
      game = null;
      window.game = null;
      _refreshResumeSave();
      // after a campaign game, return to the operations list (freshly
      // rebuilt, so a win shows the next mission unlocked) — not the
      // faction menu
      if (wasMission) _showMissions(mySide);
      else $('menu').classList.remove('hidden');
    });

    // ---- mid-battle save / resume ------------------------------------------
    // A save is the running replay recording plus the current tick; resuming
    // replays it at fast-forward speed and hands the controls back (main loop
    // drives the catch-up off game._ffTarget).
    $('btnSaveGame').addEventListener('click', () => {
      const data = (typeof REPLAY !== 'undefined' && REPLAY.recording &&
        game && game.status === 'playing') ? REPLAY.exportLive() : null;
      if (!data) { AUDIO.play('buzz'); return; }
      try { localStorage.setItem('hw_save', data); }
      catch (e) { AUDIO.play('buzz'); return; }
      togglePause(false);
      AUDIO.evaText('Battle saved');
    });
    _refreshResumeSave();
    $('btnResumeSave').addEventListener('click', () => {
      let data = null;
      try { data = localStorage.getItem('hw_save'); } catch (e) {}
      if (!data) return;
      try {
        AUDIO.init();
        REPLAY.resumeData(data);
      } catch (e) {
        console.warn(e);
        alert(e.message || 'Could not load that save.');
      }
    });

    // ---- multiplayer rematch -------------------------------------------------
    // the datachannel stays open at the score screen; both players pressing
    // Rematch relaunches the match on a fresh seed with no new code exchange
    $('btnRematch').addEventListener('click', () => {
      if (NET.requestRematch()) {
        $('btnRematch').disabled = true;
        $('btnRematch').textContent = 'Waiting for opponent…';
      } else {
        AUDIO.play('buzz');
      }
    });
    NET.onRematch = ev => {
      const btn = $('btnRematch');
      if (ev === 'gone') {          // opponent left — the offer is dead
        btn.classList.add('hidden');
        btn.disabled = false;
        btn.textContent = 'Rematch';
      } else if (ev === 'remote' && !btn.disabled) {
        btn.textContent = 'Rematch — opponent is ready!';
      }
    };

    // ---- replays: watch the battle you just fought, save it, load one ----
    $('btnWatchReplay').addEventListener('click', () => {
      if (typeof REPLAY === 'undefined' || !REPLAY.hasLast()) return;
      $('score').classList.add('hidden');
      REPLAY.watchLast();
    });
    $('btnSaveReplay').addEventListener('click', () => {
      const data = typeof REPLAY !== 'undefined' && REPLAY.exportLast();
      if (!data) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      a.download = 'harvest-war-replay.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });
    $('btnLoadReplay').addEventListener('click', () => $('replayFile').click());
    $('replayFile').addEventListener('change', ev => {
      const f = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          AUDIO.init();
          REPLAY.watchData(r.result);
        } catch (e) {
          console.warn(e);
          alert(e.message || 'Could not read that replay file.');
        }
      };
      r.readAsText(f);
    });

    // tactile menus: every enabled overlay button answers with a click
    // (capture phase, so it still fires when a handler swaps the panels)
    document.addEventListener('click', ev => {
      const b = ev.target && ev.target.closest ? ev.target.closest('button') : null;
      if (!b || b.disabled || !b.closest('.overlay')) return;
      AUDIO.init();   // any click is a user gesture — safe to unlock audio
      AUDIO.play('click');
    }, true);

    // URL params for testing: ?side=&seed=&nomenu=1&mute=1&mission=N
    // &mpbc=name&mphost=1 — two-tab multiplayer over BroadcastChannel
    const q = new URLSearchParams(location.search);
    if (q.get('mute')) { AUDIO.setEnabled(false); MUSIC.setEnabled(false); }
    if (q.get('mpbc')) {
      AUDIO.init();
      NET.testLocal(q.get('mpbc'), q.get('mphost') === '1',
        q.get('side') || 'udc', s => console.log('[mp]', s));
    }
    if (q.get('nomenu')) {
      AUDIO.init();
      startGame(q.get('side') === 'srp' ? 'srp' : 'udc', {
        seed: q.get('seed') ? +q.get('seed') : undefined,
        mission: q.get('mission')
          ? MISSIONS.arc(q.get('side') === 'srp' ? 'srp' : 'udc')[+q.get('mission') - 1]
          : undefined,
      });
    }

    if (!rafStarted) {
      rafStarted = true;
      requestAnimationFrame(loop);
    }
  }

  // ---- multiplayer lobby ---------------------------------------------------------------

  function _wireMpLobby() {
    let mpSide = 'udc';
    const status = s => { $('mpStatus').textContent = s; };
    const showFlow = which => {
      $('mpChoose').classList.toggle('hidden', which !== 'choose');
      $('mpHostFlow').classList.toggle('hidden', which !== 'host');
      $('mpJoinFlow').classList.toggle('hidden', which !== 'join');
    };
    const copy = (ta) => {
      ta.select();
      const fallback = () => {
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e) {}
        status(ok ? 'Copied to clipboard.' : 'Copy failed — select the code and copy it manually.');
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ta.value)
          .then(() => status('Copied to clipboard.'))
          .catch(fallback);
      } else fallback();
    };
    // async lobby steps: disable the trigger while in flight (double-clicks
    // would race the shared peer connection) and swallow cancellations
    const guard = (btn, fn) => () => {
      if (btn.disabled) return;
      btn.disabled = true;
      Promise.resolve()
        .then(fn)
        .catch(e => { if (e && e.message !== 'Cancelled') status(e.message || 'Something went wrong.'); })
        .then(() => { btn.disabled = false; });
    };

    $('btnMultiplayer').addEventListener('click', () => {
      AUDIO.init();
      $('menu').classList.add('hidden');
      showFlow('choose');
      $('mpOffer').value = ''; $('mpAnswer').value = '';
      $('mpJoinOffer').value = ''; $('mpReply').value = '';
      status('');
      $('mplobby').classList.remove('hidden');
    });
    const sideBtns = { udc: $('mpSideUdc'), srp: $('mpSideSrp') };
    const pickSide = s => {
      mpSide = s;
      sideBtns.udc.classList.toggle('sel', s === 'udc');
      sideBtns.srp.classList.toggle('sel', s === 'srp');
    };
    sideBtns.udc.addEventListener('click', () => pickSide('udc'));
    sideBtns.srp.addEventListener('click', () => pickSide('srp'));
    pickSide('udc');

    $('btnMpHost').addEventListener('click', () => {
      showFlow('host');
      status('Preparing invite code…');
      NET.host(mpSide, status)
        .then(code => { $('mpOffer').value = code; })
        .catch(e => { if (e && e.message !== 'Cancelled') status('Could not start hosting: ' + e.message); });
    });
    $('btnMpCopyOffer').addEventListener('click', () => copy($('mpOffer')));
    $('btnMpConnect').addEventListener('click', guard($('btnMpConnect'), () => {
      const v = $('mpAnswer').value.trim();
      if (!v) { status('Paste the reply code first.'); return; }
      return NET.acceptAnswer(v);
    }));

    $('btnMpJoin').addEventListener('click', () => { showFlow('join'); status(''); });
    $('btnMpMakeReply').addEventListener('click', guard($('btnMpMakeReply'), () => {
      const v = $('mpJoinOffer').value.trim();
      if (!v) { status('Paste the invite code first.'); return; }
      status('Preparing reply code…');
      return NET.join(v, status).then(code => { $('mpReply').value = code; });
    }));
    $('btnMpCopyReply').addEventListener('click', () => copy($('mpReply')));

    $('btnMpBack').addEventListener('click', () => {
      NET.close();
      $('mplobby').classList.add('hidden');
      $('menu').classList.remove('hidden');
    });
  }

  // menu "Resume Saved Battle" button: shown only when a compatible save exists
  function _refreshResumeSave() {
    const btn = $('btnResumeSave');
    if (!btn) return;
    let d = null;
    try { d = JSON.parse(localStorage.getItem('hw_save') || 'null'); } catch (e) {}
    const ok = !!(d && d.meta && Array.isArray(d.log) && typeof d.at === 'number' &&
      (d.meta.p === undefined || d.meta.p === NET.PROTO));
    btn.classList.toggle('hidden', !ok);
    if (ok) {
      const secs = Math.floor(d.at / C.TPS);
      const mm = String(Math.floor(secs / 60)).padStart(2, '0');
      const ss = String(secs % 60).padStart(2, '0');
      const what = d.meta.mission ? 'OP ' + d.meta.mission
        : 'Skirmish — ' + (d.meta.skirmish || 'NORMAL');
      const sub = $('resumeSaveSub');
      if (sub) {
        sub.textContent = (d.meta.side === 'srp' ? 'Serpent Order' : 'UDC') +
          ' · ' + what + ' · ' + mm + ':' + ss;
      }
    }
  }

  // ---- mission select & briefing -----------------------------------------------------

  let pendingMission = null;

  // read the skirmish setup panel (missions ignore it; MP has its own path)
  function _skOptions() {
    const seedRaw = ($('skSeed').value || '').trim();
    return {
      credits: +$('skCredits').value || undefined,
      crates: $('skCrates').value === '1',
      supers: $('skSupers').value === '1',
      players: $('skPlayers').value,          // '1v1'|'1v2'|'1v3'|'w2'|'w3'|'w4'
      big: $('skMap').value === 'big',
      seed: /^\d+$/.test(seedRaw) ? (+seedRaw >>> 0) : undefined,
    };
  }

  // combatants code -> {total sides, spectate}
  const SK_PLAYERS = {
    '1v1': { n: 2, spectate: false }, '1v2': { n: 3, spectate: false },
    '1v3': { n: 4, spectate: false },
    w2: { n: 2, spectate: true }, w3: { n: 3, spectate: true }, w4: { n: 4, spectate: true },
  };

  // the skirmish window remembers which theater opened it (Back returns
  // there) and which side is toggled for the next battle
  let skSide = 'udc', skFrom = 'udc';

  function _showSkirmish(side) {
    skFrom = baseSide(side || mySide || 'udc');
    skSide = skFrom;
    $('skSideUdc').classList.toggle('sel', skSide === 'udc');
    $('skSideSrp').classList.toggle('sel', skSide === 'srp');
    $('menu').classList.add('hidden');
    $('missions').classList.add('hidden');
    $('skirmish').classList.remove('hidden');
  }

  // personal best for a completed op, as a display string ('01:35 · 1234')
  function _recFor(side, n) {
    let rec = null;
    try { rec = JSON.parse(localStorage.getItem('hw_rec_' + side + '_' + n) || 'null'); } catch (e) {}
    if (!rec || rec.t === undefined) return null;
    const mm = String(Math.floor(rec.t / 60)).padStart(2, '0');
    const ss = String(rec.t % 60).padStart(2, '0');
    return mm + ':' + ss + ' · ' + rec.s;
  }

  const THEATER_HINT = 'SELECT AN OPERATION ON THE MAP — SECURED GROUND WEARS YOUR COLORS';

  // the map IS the mission select: territories are the only mission links
  // (a per-op button ledger would just duplicate them and bury the screen)
  function _showMissions(side) {
    mySide = side;
    $('menu').classList.add('hidden');
    $('missionsTitle').textContent = 'THEATER OF WAR — ' + C.SIDE_NAME[side];
    _drawTheater(side, MissionProgress.get(side));
    $('theaterCap').textContent = THEATER_HINT;
    $('missions').classList.remove('hidden');
  }

  // ---- theater of war: the campaign map ------------------------------------------
  // A procedurally drawn ORIGINAL continent; each arc's territories sit on
  // it as a marching front. Secured ground fills with the faction color, the
  // frontline territory pulses ready, everything past it is denied ground.

  let theaterNodes = [];

  function _drawTheater(side, done) {
    const cv = $('theaterMap');
    if (!cv) return;
    const q = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const accent = side === 'srp' ? '#e05038' : '#e0b840';
    const rng = mulberry(0xC0FFEE);
    // --- the sea: deep water with lapping wave dashes -----------------------
    q.fillStyle = '#081019';
    q.fillRect(0, 0, W, H);
    q.strokeStyle = 'rgba(120,160,200,0.05)';
    q.lineWidth = 1;
    for (let y = 6; y < H; y += 9) {
      q.beginPath();
      for (let x = 0; x < W; x += 26) {
        const j = ((x * 13 + y * 7) % 11) - 5;
        q.moveTo(x + j, y + 0.5); q.lineTo(x + j + 12, y + 0.5);
      }
      q.stroke();
    }
    // --- the landmass: a real country, not a blob. Layered coastal lobes
    // give it peninsulas, bays and headlands; then every mission territory
    // of BOTH arcs pushes the coast out far enough to stand on dry land
    // (the first and last ops used to drown in the surf) -------------------
    const ccx = W * 0.5, ccy = H * 0.52;
    const spokes = 44, rad = [];
    const ph1 = rng() * Math.PI * 2, ph2 = rng() * Math.PI * 2, ph3 = rng() * Math.PI * 2;
    for (let i = 0; i < spokes; i++) {
      const a = i / spokes * Math.PI * 2;
      rad.push(0.52
        + 0.16 * Math.sin(a * 2 + ph1)     // two broad lobes: a waist between them
        + 0.12 * Math.sin(a * 3 + ph2)     // headlands
        + 0.07 * Math.sin(a * 5 + ph3)     // coves
        + rng() * 0.08);
    }
    for (let p = 0; p < 2; p++) {
      for (let i = 0; i < spokes; i++) {
        rad[i] = (rad[i] + rad[(i + 1) % spokes] + rad[(i + spokes - 1) % spokes]) / 3;
      }
    }
    for (const m2 of MISSIONS.udc.concat(MISSIONS.srp)) {
      const dx = (m2.terr[0] * W - ccx) / (W * 0.47);
      const dy = (m2.terr[1] * H - ccy) / (H * 0.46);
      const need = Math.min(1.04, Math.hypot(dx, dy) + 0.12);
      const ai2 = Math.atan2(dy, dx);
      const si = Math.round((ai2 < 0 ? ai2 + Math.PI * 2 : ai2) / (Math.PI * 2) * spokes) % spokes;
      for (let k = -2; k <= 2; k++) {
        const j = (si + k + spokes) % spokes;
        rad[j] = Math.max(rad[j], need * (1 - Math.abs(k) * 0.08));
      }
    }
    const blob = new Path2D();
    for (let i = 0; i <= spokes; i++) {
      const a = (i % spokes) / spokes * Math.PI * 2;
      const r = Math.min(rad[i % spokes], 1.04);
      const x = ccx + Math.cos(a) * W * 0.47 * r;
      const y = ccy + Math.sin(a) * H * 0.46 * r;
      if (i) blob.lineTo(x, y); else blob.moveTo(x, y);
    }
    blob.closePath();
    q.strokeStyle = 'rgba(110,150,190,0.10)';   // coastal shelf glow
    q.lineWidth = 7;
    q.stroke(blob);
    const landG = q.createLinearGradient(0, 0, 0, H);
    landG.addColorStop(0, '#161f15');
    landG.addColorStop(1, '#1e2517');
    q.fillStyle = landG;
    q.fill(blob);
    q.strokeStyle = '#4a5340';
    q.lineWidth = 1.5;
    q.stroke(blob);
    // offshore islets give the sea some truth
    for (let tr = 0, isl = 0; tr < 40 && isl < 3; tr++) {
      const x = W * (0.06 + rng() * 0.88), y = H * (0.08 + rng() * 0.84);
      let clear = !q.isPointInPath(blob, x, y);
      for (const [ox2, oy2] of [[16, 0], [-16, 0], [0, 11], [0, -11]]) {
        if (!clear) break;
        if (q.isPointInPath(blob, x + ox2, y + oy2)) clear = false;
      }
      if (!clear) continue;
      q.fillStyle = '#1b2416';
      q.strokeStyle = '#4a5340';
      q.lineWidth = 1;
      q.beginPath();
      q.ellipse(x, y, 6 + rng() * 7, 4 + rng() * 4, rng() * Math.PI, 0, Math.PI * 2);
      q.fill();
      q.stroke();
      isl++;
    }
    // --- interior geography, clipped to the coast ---------------------------
    q.save();
    q.clip(blob);
    for (let k = 0; k < 7; k++) {               // lowland / marsh tints
      const x = W * (0.2 + rng() * 0.6), y = H * (0.2 + rng() * 0.6);
      q.globalAlpha = 0.4;
      q.fillStyle = k & 1 ? '#20291a' : '#141d12';
      q.beginPath();
      q.ellipse(x, y, 14 + rng() * 26, 8 + rng() * 14, rng() * Math.PI, 0, Math.PI * 2);
      q.fill();
    }
    q.globalAlpha = 1;
    q.strokeStyle = 'rgba(90,130,180,0.5)';     // rivers run to the coast
    q.lineWidth = 1.3;
    for (let r = 0; r < 3; r++) {
      let x = W * (0.3 + rng() * 0.4), y = H * (0.3 + rng() * 0.35);
      const dx = x < ccx ? -1 : 1, dy = y < ccy ? -0.4 : 0.7;
      q.beginPath(); q.moveTo(x, y);
      for (let s = 0; s < 26; s++) {
        x += dx * (6 + rng() * 9);
        y += dy * (3 + rng() * 6) + (rng() - 0.5) * 8;
        q.lineTo(x, y);
      }
      q.stroke();
    }
    for (let c = 0; c < 3; c++) {               // mountain chains
      const x0 = W * (0.22 + rng() * 0.5), y0 = H * (0.2 + rng() * 0.45);
      const ang = rng() * Math.PI;
      const peaks = 6 + ((rng() * 6) | 0);
      for (let i = 0; i < peaks; i++) {
        const px = x0 + Math.cos(ang) * i * 11 + (rng() - 0.5) * 8;
        const py = y0 + Math.sin(ang) * i * 5 + (rng() - 0.5) * 6;
        q.fillStyle = '#39422f';
        q.beginPath();
        q.moveTo(px - 4, py + 3); q.lineTo(px, py - 4); q.lineTo(px + 4, py + 3);
        q.closePath(); q.fill();
        q.strokeStyle = 'rgba(200,210,190,0.3)';
        q.lineWidth = 1;
        q.beginPath(); q.moveTo(px, py - 4); q.lineTo(px + 2, py - 1); q.stroke();
      }
    }
    q.fillStyle = 'rgba(46,66,38,0.8)';         // forest stipple
    for (let f = 0; f < 6; f++) {
      const x = W * (0.18 + rng() * 0.64), y = H * (0.2 + rng() * 0.6);
      for (let i = 0; i < 12; i++) {
        q.fillRect(x + (rng() - 0.5) * 30, y + (rng() - 0.5) * 16, 2, 2);
      }
    }
    // towns with original names, threaded by supply roads — a lived-in
    // country, not an empty blob (kept clear of the op markers)
    const NAMES = ['VELMOR', 'KARSA POINT', 'OSTHOLM', 'FERNGATE', 'MARROWICK',
      'SALTMERE', 'CINDER HALT', 'HALVEN', 'GREYFORD', 'THORNVAL'];
    const arcPts = MISSIONS.arc(side).map(m2 => ({ x: m2.terr[0] * W, y: m2.terr[1] * H }));
    const towns = [];
    for (let t = 0; t < NAMES.length && towns.length < 8; t++) {
      for (let a = 0; a < 14; a++) {
        const x = W * (0.12 + rng() * 0.76), y = H * (0.14 + rng() * 0.7);
        if (!q.isPointInPath(blob, x, y)) continue;
        let ok = true;
        for (const n2 of arcPts) if (Math.hypot(x - n2.x, y - n2.y) < 34) { ok = false; break; }
        for (const tw of towns) if (Math.hypot(x - tw.x, y - tw.y) < 46) { ok = false; break; }
        if (ok) { towns.push({ x, y, name: NAMES[t] }); break; }
      }
    }
    q.strokeStyle = 'rgba(150,150,130,0.16)';
    q.lineWidth = 1;
    q.setLineDash([2, 3]);
    for (let i = 1; i < towns.length; i++) {
      let nearest = 0, nd = Infinity;
      for (let j2 = 0; j2 < i; j2++) {
        const d2 = Math.hypot(towns[i].x - towns[j2].x, towns[i].y - towns[j2].y);
        if (d2 < nd) { nd = d2; nearest = j2; }
      }
      q.beginPath();
      q.moveTo(towns[i].x, towns[i].y);
      q.lineTo(towns[nearest].x, towns[nearest].y);
      q.stroke();
    }
    q.setLineDash([]);
    q.textAlign = 'center';
    for (const tw of towns) {
      q.fillStyle = '#8f957c';
      q.fillRect(tw.x - 1.5, tw.y - 1.5, 3, 3);
      q.strokeStyle = 'rgba(143,149,124,0.5)';
      q.lineWidth = 1;
      q.strokeRect(tw.x - 3, tw.y - 3, 6, 6);
      q.font = '7px monospace';
      q.fillStyle = 'rgba(150,156,130,0.7)';
      q.fillText(tw.name, tw.x, tw.y - 6);
    }
    q.restore();
    // survey grid + scanlines
    q.globalAlpha = 0.08;
    q.strokeStyle = '#9fae7a';
    q.lineWidth = 1;
    for (let x = 0; x <= W; x += 60) { q.beginPath(); q.moveTo(x + 0.5, 0); q.lineTo(x + 0.5, H); q.stroke(); }
    for (let y = 0; y <= H; y += 60) { q.beginPath(); q.moveTo(0, y + 0.5); q.lineTo(W, y + 0.5); q.stroke(); }
    q.fillStyle = '#000';
    for (let y = 0; y < H; y += 3) q.fillRect(0, y, W, 1);
    q.globalAlpha = 1;

    const arc = MISSIONS.arc(side);
    const P = m => ({ x: m.terr[0] * W, y: m.terr[1] * H });
    // --- the state of the war: home ground shaded in the faction color, a
    // toothed front line at the frontier between secured and enemy country --
    if (done < arc.length && arc.length > 1) {
      const nxt = P(arc[done]);
      const prv = done > 0 ? P(arc[done - 1]) : null;
      const ax = prv ? nxt.x - prv.x : P(arc[1]).x - P(arc[0]).x;
      const ay = prv ? nxt.y - prv.y : P(arc[1]).y - P(arc[0]).y;
      const al = Math.hypot(ax, ay) || 1;
      const ux = ax / al, uy = ay / al;
      const M = prv
        ? { x: (nxt.x + prv.x) / 2, y: (nxt.y + prv.y) / 2 }
        : { x: nxt.x - ux * 26, y: nxt.y - uy * 26 };
      q.save();
      q.clip(blob);
      q.translate(M.x, M.y);
      q.rotate(Math.atan2(uy, ux));
      q.fillStyle = accent;                      // liberated / faithful ground
      q.globalAlpha = 0.07;
      q.fillRect(-900, -900, 900, 1800);
      q.globalAlpha = 0.05;
      q.strokeStyle = accent;
      q.lineWidth = 1;
      for (let k = -880; k < 0; k += 14) {
        q.beginPath(); q.moveTo(k, -900); q.lineTo(k + 500, 900); q.stroke();
      }
      q.globalAlpha = 0.85;                      // the front itself
      q.strokeStyle = accent;
      q.lineWidth = 2;
      q.setLineDash([8, 5]);
      q.beginPath();
      for (let fy = -420; fy <= 420; fy += 16) {
        const jx = (((fy * 37) | 0) % 7) - 3;
        if (fy === -420) q.moveTo(jx, fy); else q.lineTo(jx, fy);
      }
      q.stroke();
      q.setLineDash([]);
      q.lineWidth = 1;
      for (let ty = -400; ty <= 400; ty += 26) { // teeth point at the enemy
        const jx = (((ty * 37) | 0) % 7) - 3;
        q.beginPath(); q.moveTo(jx, ty); q.lineTo(jx + 6, ty); q.stroke();
      }
      q.globalAlpha = 1;
      q.restore();
    }
    // the marching front: secured legs solid, the next leg dashed
    for (let i = 1; i < arc.length; i++) {
      const a = P(arc[i - 1]), b = P(arc[i]);
      const litUp = arc[i].n <= done + 1;
      q.strokeStyle = litUp ? 'rgba(224,184,64,0.55)' : 'rgba(130,130,120,0.18)';
      q.lineWidth = litUp ? 2 : 1;
      q.setLineDash(arc[i].n === done + 1 ? [5, 4] : arc[i].n <= done ? [] : [2, 5]);
      q.beginPath(); q.moveTo(a.x, a.y); q.lineTo(b.x, b.y); q.stroke();
    }
    q.setLineDash([]);
    theaterNodes = [];
    q.textAlign = 'center';
    for (const m of arc) {
      const p = P(m);
      const state = m.n <= done ? 'done' : m.n === done + 1 ? 'next' : 'locked';
      if (state === 'done') {
        q.fillStyle = accent;
        q.fillRect(p.x - 5, p.y - 5, 10, 10);
        q.strokeStyle = 'rgba(255,255,255,0.5)';
        q.lineWidth = 1;
        q.strokeRect(p.x - 6.5, p.y - 6.5, 13, 13);
      } else if (state === 'next') {
        q.strokeStyle = accent;
        q.lineWidth = 2;
        q.strokeRect(p.x - 7, p.y - 7, 14, 14);
        q.fillStyle = accent;
        q.fillRect(p.x - 3, p.y - 3, 6, 6);
        q.font = 'bold 9px monospace';
        q.fillStyle = '#fff2b0';
        q.fillText('NEXT OP', p.x, p.y - 13);
      } else {
        q.fillStyle = '#2a2a26';
        q.fillRect(p.x - 4, p.y - 4, 8, 8);
        q.strokeStyle = '#494940';
        q.lineWidth = 1;
        q.beginPath();
        q.moveTo(p.x - 4, p.y - 4); q.lineTo(p.x + 4, p.y + 4);
        q.moveTo(p.x + 4, p.y - 4); q.lineTo(p.x - 4, p.y + 4);
        q.stroke();
      }
      q.font = '9px monospace';
      q.fillStyle = state === 'locked' ? '#55554c' : '#c8c0a0';
      const name = state === 'locked' ? '· · ·' : m.title;
      q.fillText(name, Math.max(34, Math.min(W - 34, p.x)), Math.min(H - 4, p.y + 19));
      theaterNodes.push({ x: p.x, y: p.y, m, state });
    }
    q.textAlign = 'left';
  }

  function _wireTheater() {
    const cv = $('theaterMap');
    if (!cv) return;
    const toMap = ev => {
      const r = cv.getBoundingClientRect();
      return { x: (ev.clientX - r.left) * cv.width / r.width,
               y: (ev.clientY - r.top) * cv.height / r.height,
               // the canvas shrinks on phones: grow the hit radius by the
               // same factor so territories stay finger-sized targets
               rad: Math.max(15, 13 * cv.width / Math.max(1, r.width) * 1.4) };
    };
    const hit = ev => {
      const p = toMap(ev);
      for (const nd of theaterNodes) {
        if ((nd.x - p.x) ** 2 + (nd.y - p.y) ** 2 < p.rad * p.rad && nd.state !== 'locked') return nd;
      }
      return null;
    };
    cv.addEventListener('click', ev => {
      const nd = hit(ev);
      if (nd) _showBriefing(nd.m);
    });
    cv.addEventListener('mousemove', ev => {
      const nd = hit(ev);
      cv.style.cursor = nd ? 'pointer' : 'default';
      if (!nd) { $('theaterCap').textContent = THEATER_HINT; return; }
      let t = 'OP ' + nd.m.n + ': ' + nd.m.title +
        ' — ' + (nd.state === 'done' ? 'COMPLETE' : 'READY');
      const rec = _recFor(mySide, nd.m.n);
      if (rec) t += ' · BEST ' + rec;
      $('theaterCap').textContent = t;
    });
  }

  let briefTimer = 0;

  function _stopTeletype() {
    if (briefTimer) { clearInterval(briefTimer); briefTimer = 0; }
  }

  // typed sitrep: the FULL text is in the DOM immediately (the untyped tail
  // sits in visibility-hidden spans), so the reveal is purely visual — tests
  // and screen readers always see the whole report
  function _teletype(el, paragraphs) {
    _stopTeletype();
    el.innerHTML = '';
    const parts = [];
    for (const text of paragraphs) {
      const pe = document.createElement('p');
      const shown = document.createElement('span');
      const hid = document.createElement('span');
      hid.className = 'tt-hid';
      hid.textContent = text;
      pe.appendChild(shown);
      pe.appendChild(hid);
      el.appendChild(pe);
      parts.push({ shown, hid });
    }
    let pi = 0, typed = 0;
    if (parts.length) parts[0].shown.className = 'tt-on';
    briefTimer = setInterval(() => {
      const part = parts[pi];
      if (!part) { _stopTeletype(); return; }
      const t = part.hid.textContent;
      part.shown.textContent += t.slice(0, 3);
      part.hid.textContent = t.slice(3);
      typed += 3;
      if (typed % 60 === 0) { try { AUDIO.play('click'); } catch (e) {} }
      if (!part.hid.textContent.length) {
        part.shown.className = '';
        pi++;
        if (parts[pi]) parts[pi].shown.className = 'tt-on';
        else _stopTeletype();
      }
    }, 16);
    // impatient commanders click the report to print it all at once
    el.onclick = () => {
      _stopTeletype();
      for (const part of parts) {
        part.shown.textContent += part.hid.textContent;
        part.hid.textContent = '';
        part.shown.className = '';
      }
    };
  }

  // intel bullets derived from the mission's own difficulty knobs — the
  // briefing tells you what the fight will feel like, not just what to do
  function _briefIntel(m) {
    const out = [];
    const chest = m.aiCredits !== undefined ? m.aiCredits : 5000;
    out.push(chest >= 9000 ? 'Enemy war chest: HEAVY — layered defenses and armor in numbers'
      : chest >= 5000 ? 'Enemy war chest: MODERATE — a working base with teeth'
        : 'Enemy war chest: LIGHT — a garrison, not an army');
    const calm = m.aiCalm || 1;
    out.push(calm <= 0.6 ? 'Expected pressure: RELENTLESS — the waves will not stop coming'
      : calm <= 1 ? 'Expected pressure: STEADY — probing raids building into offensives'
        : 'Expected pressure: LIGHT — time is on your side; use it');
    if (m.holdout) out.push('Terrain: a walled plateau with three gated passes — the rich crystal lies OUTSIDE');
    if (m.shore) out.push('Terrain: open sea to the south — the landing beach is your lifeline, and the boats come in over it');
    // per-mission tech gates read as supply lines in the field
    if (m.allow) {
      out.push(m.allow.length === 0
        ? 'Field kit: NONE — production is locked; the force you are given is the force you have'
        : 'Field kit: RESTRICTED — early-war tech only; heavy equipment cannot reach this sector');
    }
    const ot = m.objective.type;
    if (ot === 'harvest') out.push('Survey: a BLUE chrysalite lode is charted midfield — double value at the refinery');
    if (ot === 'escort') out.push('Logistics: no base, no production — the convoy is everything you have');
    if (ot === 'capture') out.push('Rules of engagement: the prize must be taken INTACT — engineers, not artillery');
    if (ot === 'killEconomy') out.push('Targets: the harvest chain — refineries and harvesters; nothing else wins this');
    if (ot === 'demolish') out.push('Rules of engagement: kill the marked target and get out — the garrison is not the mission');
    return out;
  }

  // tactical survey: the REAL mission battlefield (same seed, same generator)
  // drawn schematic-style with force and objective markers. Missions are
  // always 64x64 — C flips there for the generation and is restored before
  // any frame could render.
  function _drawBriefMap(m) {
    const cv = $('briefMap'), q = cv.getContext('2d');
    const W0 = C.MAP_W, H0 = C.MAP_H;
    C.MAP_W = C.MAP_H = 64;
    const n = 64 * 64;
    const fake = {
      seed: m.seed, sides: ['udc', 'srp'], humanSide: mySide,
      terrain: new Uint8Array(n), tvar: new Uint8Array(n),
      tib: new Uint16Array(n), tibType: new Uint8Array(n),
      startPos: null, decor: null,
    };
    try {
      MAPGEN.generate(fake, m.seed, { holdout: m.holdout, shore: m.shore });
    } finally {
      C.MAP_W = W0; C.MAP_H = H0;
    }
    const P = 3, MG = 13;
    cv.width = 64 * P + MG * 2;
    cv.height = 64 * P + MG * 2;
    q.fillStyle = '#05070c';
    q.fillRect(0, 0, cv.width, cv.height);
    const TC = ['#233a20', '#4a3d28', '#3f4045', '#123050', '#152a0e', '#1a3a12', '#5a4326'];
    for (let cy = 0; cy < 64; cy++) {
      for (let cx = 0; cx < 64; cx++) {
        const i = cy * 64 + cx;
        q.fillStyle = fake.tib[i] > 0
          ? (fake.tibType[i] === 1 ? '#2f74d0' : '#3fae53')
          : (TC[fake.terrain[i]] || TC[0]);
        q.fillRect(MG + cx * P, MG + cy * P, P, P);
      }
    }
    // survey grid + scanlines
    q.globalAlpha = 0.10;
    q.strokeStyle = '#9fae7a';
    q.lineWidth = 1;
    for (let k = 0; k <= 64; k += 16) {
      q.beginPath(); q.moveTo(MG + k * P + 0.5, MG); q.lineTo(MG + k * P + 0.5, MG + 64 * P); q.stroke();
      q.beginPath(); q.moveTo(MG, MG + k * P + 0.5); q.lineTo(MG + 64 * P, MG + k * P + 0.5); q.stroke();
    }
    q.fillStyle = '#000';
    for (let y = 0; y < cv.height; y += 3) q.fillRect(0, y, cv.width, 1);
    q.globalAlpha = 1;
    const X = c => MG + c * P + P / 2;
    const label = (x, y, s, color) => {
      q.font = 'bold 9px monospace';
      const w = q.measureText(s).width;
      const lx = Math.max(2, Math.min(cv.width - w - 4, x - w / 2));
      const ly = Math.max(9, Math.min(cv.height - 3, y));
      q.fillStyle = 'rgba(0,0,0,0.7)';
      q.fillRect(lx - 2, ly - 8, w + 4, 10);
      q.fillStyle = color;
      q.fillText(s, lx, ly);
    };
    const you = fake.startPos[mySide] || fake.startPos.human;
    const foe = fake.startPos[mySide === 'udc' ? 'srp' : 'udc'] || fake.startPos.ai;
    // markers wear FACTION colors: a Serpent commander is RED on their own
    // survey and the Coalition enemy is gold — never the other way around
    const meRed = baseSide(mySide) === 'srp';
    const YOU = meRed
      ? { fill: '#ff2418', edge: '#ffb4a4', label: '#ff9c88', ring: 'rgba(255,60,40,0.5)' }
      : { fill: '#ffd23c', edge: '#fff2b0', label: '#ffe28a', ring: 'rgba(255,210,60,0.5)' };
    const FOE = meRed
      ? { line: '#ffd23c', label: '#ffe28a' }
      : { line: '#ff4030', label: '#ff6a50' };
    // neutral prizes: supply depots + the village
    q.fillStyle = '#e8e6da';
    if (fake.decor && fake.decor.depots) {
      for (const d of fake.decor.depots) q.fillRect(X(d.cx) - 1, X(d.cy) - 1, 3, 3);
    }
    if (fake.decor && fake.decor.village) {
      const v0 = fake.decor.village.houses[0];
      q.fillRect(X(v0.cx) - 1, X(v0.cy) - 1, 3, 3);
    }
    if (m.objective.type === 'escort') {
      // the beacon is the destination; the road there IS the mission
      q.strokeStyle = 'rgba(224,184,64,0.7)';
      q.lineWidth = 1;
      q.setLineDash([4, 3]);
      q.beginPath(); q.moveTo(X(you.cx), X(you.cy)); q.lineTo(X(foe.cx), X(foe.cy)); q.stroke();
      q.setLineDash([]);
      q.strokeStyle = '#ffe28a';
      q.lineWidth = 2;
      q.strokeRect(X(foe.cx) - 4, X(foe.cy) - 4, 8, 8);
      label(X(foe.cx), X(foe.cy) - 8, 'BEACON', '#ffe28a');
    } else {
      q.strokeStyle = FOE.line;
      q.lineWidth = 2;
      q.beginPath();
      q.moveTo(X(foe.cx) - 6, X(foe.cy)); q.lineTo(X(foe.cx) + 6, X(foe.cy));
      q.moveTo(X(foe.cx), X(foe.cy) - 6); q.lineTo(X(foe.cx), X(foe.cy) + 6);
      q.stroke();
      q.strokeRect(X(foe.cx) - 4, X(foe.cy) - 4, 8, 8);
      label(X(foe.cx), X(foe.cy) - 9, 'ENEMY', FOE.label);
    }
    q.fillStyle = YOU.fill;
    q.fillRect(X(you.cx) - 3, X(you.cy) - 3, 6, 6);
    q.strokeStyle = YOU.edge;
    q.lineWidth = 1;
    q.strokeRect(X(you.cx) - 4.5, X(you.cy) - 4.5, 9, 9);
    label(X(you.cx), X(you.cy) + 14, m.holdout ? 'HOLD HERE' : 'YOUR FORCE', YOU.label);
    if (m.holdout) {
      q.strokeStyle = YOU.ring;
      q.beginPath(); q.arc(X(you.cx), X(you.cy), 11 * P, 0, Math.PI * 2); q.stroke();
    }
    if (m.objective.type === 'harvest') {
      for (let i = 0; i < n; i++) {
        if (fake.tibType[i] === 1 && fake.tib[i] > 0) {
          const cx = i % 64, cy = (i / 64) | 0;
          q.strokeStyle = '#7fb4ff';
          q.lineWidth = 1;
          q.beginPath(); q.arc(X(cx), X(cy), 8, 0, Math.PI * 2); q.stroke();
          label(X(cx), X(cy) - 10, 'BLUE LODE', '#9fc8ff');
          break;
        }
      }
    }
  }

  function _showBriefing(m) {
    pendingMission = m;
    $('missions').classList.add('hidden');
    $('briefTitle').textContent = 'OP ' + m.n + ': ' + m.title;
    const rec = _recFor(mySide, m.n);
    $('briefSector').textContent = 'SECTOR ' + m.seed + ' · ' + (m.sector || 'UNCHARTED') +
      (rec ? ' · PERSONAL BEST ' + rec : '');
    $('briefClass').textContent = mySide === 'udc'
      ? 'UDC TACTICAL NET — EYES ONLY' : 'SERPENT WHISPERS — FOR THE FAITHFUL';
    _teletype($('briefBody'), m.brief);
    $('briefBody').scrollTop = 0;   // the element persists across briefings
    $('briefObjective').textContent = 'OBJECTIVE: ' + m.objText;
    $('briefIntel').innerHTML =
      _briefIntel(m).map(s => `<div>◈ ${s}</div>`).join('');
    _drawBriefMap(m);
    $('briefMapCap').textContent = 'TACTICAL SURVEY · GRID 16 · LIVE FEED';
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
    const scout = side === 'udc' ? 'jeep' : 'bggy';
    const spots = passableNear(4);
    if (spots[0]) addUnit(makeUnit(scout, side, spots[0].cx, spots[0].cy));
    for (let i = 1; i < 4 && spots[i]; i++) {
      addUnit(makeUnit('e1', side, spots[i].cx, spots[i].cy));
    }
  }

  function startGame(side, opts) {
    opts = opts || {};
    mySide = side;
    myMission = opts.mp ? null : (opts.mission || null);
    mySkirmish = opts.mp ? null : (opts.skirmish || null);
    ended = false;
    $('menu').classList.add('hidden');
    $('score').classList.add('hidden');
    $('pause').classList.add('hidden');
    $('missions').classList.add('hidden');
    $('briefing').classList.add('hidden');
    $('mplobby').classList.add('hidden');
    $('skirmish').classList.add('hidden');

    const mission = myMission;
    // skirmish setup options (credits/crates/superweapons/combatants/map size/
    // seed) — sim-relevant, so they ride the replay meta and reconstruct on
    // watch/resume
    const sk = (!opts.mp && !mission && opts.sk) ? opts.sk : null;
    const seed = opts.seed !== undefined ? opts.seed
      : mission ? mission.seed
      : (sk && sk.seed !== undefined) ? sk.seed : undefined;
    // map size is per-game state carried in C: LARGE only via skirmish setup,
    // every other path (missions, MP, menu battles) plays the classic 64
    C.MAP_W = C.MAP_H = (sk && sk.big) ? 88 : 64;
    const pcfg = (sk && SK_PLAYERS[sk.players]) || SK_PLAYERS['1v1'];
    const sides = SIDE_ORDER.slice(0, pcfg.n);
    game = makeGame({ side, seed, sides, spectate: pcfg.spectate });
    // extra combat slots wear recolored faction art — built lazily, once
    if (SPRITES.ensureSideArt) for (const s of sides) SPRITES.ensureSideArt(s);
    // ai.js reads its difficulty knobs off game.mission — a skirmish
    // difficulty preset rides the same channel (it has no objective/n, so
    // the HUD chip and campaign unlock logic ignore it)
    game.mission = mission || mySkirmish || null;
    if (mission) {
      if (mission.credits !== undefined) game.human.credits = mission.credits;
    }
    if (sk) {
      if (sk.credits) for (const s of game.sides) game.players[s].credits = sk.credits;
      if (sk.crates === false) game._noCrates = true;
      if (sk.supers === false) game._noSupers = true;
    }
    // NOTE: !== undefined, not truthiness — garrison missions set aiCredits: 0
    // and mean it (a fixed purse that runs dry, not the 5000 default)
    const aiCr = (mission && mission.aiCredits !== undefined) ? mission.aiCredits
      : (mySkirmish ? mySkirmish.aiCredits : undefined);
    if (aiCr !== undefined && aiCr !== null) {
      for (const s of game.sides) if (game.players[s].isAI) game.players[s].credits = aiCr;
    }
    // battle-intro title card (render-only; each client labels its own view)
    game.introLabel = opts.mp ? 'MULTIPLAYER BATTLE'
      : mission ? 'OP ' + mission.n + ': ' + mission.title
      : game._spectate ? 'BATTLE SIMULATION — ' + game.sides.length + ' ARMIES'
      : 'SKIRMISH — ' + ((mySkirmish && mySkirmish.skirmish) || 'NORMAL');
    window.game = game;
    MUSIC.start(side);   // faction playlist: the Serpent Order has its own score
    MAPGEN.generate(game, game.seed,
      mission ? { holdout: mission.holdout, shore: mission.shore } : undefined);
    Fog.init(game);

    const hp = game.startPos.human, ap = game.startPos.ai;
    const aiSide = enemyOf(side);

    if (opts.mp) {
      // multiplayer: two human MCV starts. The side->position mapping and
      // the spawn ORDER must be canonical — identical on both clients — so
      // both mint the same entity ids: udc always takes the SW spot (the
      // map's "human" slot), srp the NE one, udc spawns first.
      _spawnEscort(game, 'udc', hp, true);
      _spawnEscort(game, 'srp', ap, true);
    } else {
      // human: MCV + escort (missions may bring their own force instead;
      // spectate fields no human force at all)
      if (!game._spectate && (!mission || !mission.noHumanSpawn)) {
        _spawnEscort(game, side, hp, true);
      }
      // every AI combatant: pre-deployed conyard + power plant + escort,
      // spawned in canonical g.sides order (deterministic entity ids)
      for (const s of game.sides) {
        if (s === side && !game._spectate) continue;
        const sp = game.startPos[s] || ap;
        const fact = makeBuilding('fact', s, sp.cx - 1, sp.cy - 1);
        fact.buildProgress = 1;
        addBuilding(fact);
        const nukeB = makeBuilding('nuke', s, sp.cx - 1, sp.cy + 2);
        nukeB.buildProgress = 1;
        addBuilding(nukeB);
        _spawnEscort(game, s, { cx: sp.cx + 2, cy: sp.cy }, false);
      }
    }

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
    // neutral supply depots — capture one (engineer) for a credit trickle
    if (game.decor && game.decor.depots) {
      for (const dp of game.decor.depots) {
        const b = makeBuilding('depo', 'civ', dp.cx, dp.cy);
        b.buildProgress = 1;
        addBuilding(b);
      }
    }
    // river bridges are real structures: shoot out a span to cut the
    // crossing, send an engineer into a bank-side control room to rebuild it
    for (const bi of (game.decor && game.decor.bridges) || []) {
      const deck = makeBuilding('bridge', 'civ', bi.rect.cx, bi.rect.cy);
      deck.w = bi.rect.w; deck.h = bi.rect.h;
      deck.buildProgress = 1;
      addBuilding(deck);
      const hutIds = [];
      for (const hc of bi.huts) {
        const hb = makeBuilding('bhut', 'civ', hc.cx, hc.cy);
        hb.buildProgress = 1;
        addBuilding(hb);
        hutIds.push(hb.id);
      }
      game.bridges.push({ entId: deck.id, rect: bi.rect, water: bi.water, hutIds, down: false });
    }
    // mission-specific stage dressing: pre-built enemy works, convoys,
    // checkpoint garrisons… (deterministic — replays rebuild identically)
    if (mission && mission.setup && !opts.mp) {
      mission.setup(game, { hs: hp, as: ap, side, aiSide });
    }

    for (const s of game.sides) Production.computePower(game.players[s]);
    Render.setViewZoom(1);   // every battle opens at the classic zoom
    AI.init(game);   // in MP this is a symmetric no-op consumer of game.rng
    Input.init(canvas, game);
    Fog.update(game);
    if (opts.mp) NET.initExplored(game);

    // camera on the LOCAL player's start (in MP that is side-dependent)
    const myPos = opts.mp ? (side === 'udc' ? hp : ap) : hp;
    game.camera.x = clamp(cellCenterX(myPos.cx) - C.VIEW_W / 2, 0, C.MAP_W * C.CELL - C.VIEW_W);
    game.camera.y = clamp(cellCenterY(myPos.cy) - C.VIEW_H / 2, 0, C.MAP_H * C.CELL - C.VIEW_H);

    // every single-player battle records itself (a few KB: seed + orders);
    // watching a replay re-enters here and REPLAY then disarms the recorder
    if (!opts.mp && typeof REPLAY !== 'undefined') {
      REPLAY.arm({
        seed: game.seed,
        side,
        mission: mission && mission.n ? mission.n : null,
        skirmish: mySkirmish && mySkirmish.skirmish ? mySkirmish.skirmish : null,
        sk: sk ? { credits: sk.credits, crates: sk.crates, supers: sk.supers,
                   players: sk.players, big: sk.big } : null,
      });
    }
    game.startTime = Date.now();
    // lockstep pace is set by the slower client, so a local slider would be
    // misleading in MP — pin both clients to the same fixed speed instead
    game.speed = opts.mp ? 1.7 : ($('speedSlider').value || 170) / 100;
    $('speedSlider').disabled = !!opts.mp;

    AUDIO.eva('battleControlOnline');
  }

  function loop(t) {
    requestAnimationFrame(loop);
    const dt = Math.min(200, t - lastT);
    lastT = t;
    // resuming a save: burn through the recorded battle in ~30ms slices per
    // frame (render.js shows the progress veil off game._ffTarget). The step
    // body must match the live loop exactly — including the per-tick fog
    // update, which the sim reads (harvester auto-seek) — or the catch-up
    // would diverge from the original battle.
    if (game && !game.paused && game.status === 'playing' && game._ffTarget) {
      const t0 = performance.now();
      const sndWas = AUDIO.enabled;
      if (sndWas) AUDIO.setEnabled(false);   // don't replay the battle's audio
      try {
        while (game.tick < game._ffTarget && performance.now() - t0 < 30) {
          if (typeof REPLAY !== 'undefined' && REPLAY.playing) REPLAY.applyPending();
          game.tick++;
          Input.tick(game);
          NET.inSim = true;
          try {
            for (const s of game.sides) Production.tick(game, game.players[s]);
            Sim.tick(game);
            AI.tick(game);
            if (MISSIONS.tick) MISSIONS.tick(game);
          } finally {
            NET.inSim = false;
          }
          Fog.update(game);
          if (game.tick % 15 === 0 && game.tick > 450) _checkEnd();
          if (!game || game.status !== 'playing') break;
        }
      } finally {
        if (sndWas) AUDIO.setEnabled(true);
      }
      if (game && game.tick >= game._ffTarget) {
        game._ffTarget = 0;   // caught up: REPLAY flips back to recording
        acc = 0;
        AUDIO.evaText('Battle control restored');
      }
      Render.frame(game);
      return;
    }
    if (game && !game.paused && game.status === 'playing') {
      acc += dt;
      // spectator fast-forward: an AI-vs-AI battle (or a replay) runs at up
      // to 16x via game._ffSpeed (Render.cycleSpeed / the SPEED chip / F).
      // Pure pacing — the sim steps the same ticks in the same order, so
      // determinism, recording and saves are untouched. At 4x+ the sound
      // effects mute for the burst (a battle at 16x is just noise).
      const ff = game._ffSpeed || 1;
      const step = 1000 / (C.TPS * (game.speed || 1) * ff);
      let guard = 0;
      const ffMute = ff >= 4 && AUDIO.enabled;
      if (ffMute) AUDIO.setEnabled(false);
      try {
      while (acc >= step && guard < 10) {
        if (NET.active) {
          // lockstep barrier: broadcast our order batch for this tick's
          // horizon (so the peer can always advance), then only step once
          // the peer's batch for the next tick has arrived
          const next = game.tick + 1;
          NET.pump(next);
          if (!NET.ready(next)) break;
        }
        acc -= step;
        guard++;
        // replay playback: the recorded orders for "after tick T" apply here,
        // while game.tick still equals T — the exact point live input landed
        if (typeof REPLAY !== 'undefined' && REPLAY.playing) REPLAY.applyPending();
        game.tick++;
        if (NET.active) NET.applyTick(game.tick);
        Input.tick(game);
        NET.inSim = true;
        try {
          // fixed side order (not human-first): both multiplayer clients
          // must mint entity ids in the same sequence
          for (const s of game.sides) Production.tick(game, game.players[s]);
          Sim.tick(game);
          if (!NET.active) AI.tick(game);
          // mission script: deterministic (tick + sim state + game.rng), so
          // replays re-run the same reinforcements, raids and radio calls
          if (!NET.active && MISSIONS.tick) MISSIONS.tick(game);
        } finally {
          NET.inSim = false;
        }
        Fog.update(game);
        if (NET.active) NET.postTick(game);
        if (game.tick % 15 === 0 && game.tick > 450) _checkEnd();
        if (!game || game.status !== 'playing') break;
      }
      } finally {
        if (ffMute) AUDIO.setEnabled(true);
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
    // multi-AI skirmish: free-for-all, last force standing. Spectate ends
    // when one AI remains (or none); playing, you must outlive them all.
    if (g._spectate || g.sides.length > 2) {
      const living = g.sides.filter(s => alive(g.players[s]));
      if (g._spectate) {
        if (living.length <= 1) {
          g._winnerSide = living[0] || null;
          return endGame(true);
        }
        return;
      }
      if (!living.includes(g.humanSide)) return endGame(false);
      if (living.length === 1) return endGame(true);
      return;
    }
    const humanAlive = alive(g.human), aiAlive = alive(g.ai);
    if (!humanAlive) return endGame(false);
    if (!aiAlive) return endGame(true);    // wiping the enemy wins ANY mission

    // mission objectives beyond annihilation
    const ob = g.mission && g.mission.objective;
    if (!ob) return;
    // 'harvest' wins on the BANK BALANCE — hold the amount in credits at
    // once (spending sets you back), not merely mine it cumulatively
    if (ob.type === 'harvest' && g.human.credits >= ob.amount) return endGame(true);
    if (ob.type === 'survive' && g.tick >= ob.minutes * 60 * C.TPS) return endGame(true);
    if (ob.type === 'killEconomy') {
      // arms once the enemy owns a refinery or harvester; wins when the
      // count returns to zero — no insta-win before the AI has an economy
      const n = _aiEconomyCount(g);
      if (n > 0) g._ecoArmed = true;
      else if (g._ecoArmed) return endGame(true);
    }
    if (ob.type === 'capture') {
      // win the moment the target type flies your colors; if every standing
      // copy of it dies first, the mission is failed — the prize was the point
      const bt = typeof ob.btype === 'object' ? ob.btype[g.humanSide] : ob.btype;
      let standing = false;
      for (const b of g.buildings.values()) {
        if (b.type !== bt) continue;
        if (b.owner === g.humanSide) return endGame(true);
        standing = true;
      }
      if (standing) g._capArmed = true;
      else if (g._capArmed) return endGame(false);
    }
    if (ob.type === 'escort') {
      let esc = null;
      for (const id of g.human.unitIds) {
        const u = g.units.get(id);
        if (u && u.type === ob.unit) { esc = u; break; }
      }
      if (!esc) return endGame(false);   // the convoy is gone
      const d2 = ob.dest === 'ai' ? g.startPos.ai : ob.dest;
      if (dist(esc.x, esc.y, cellCenterX(d2.cx), cellCenterY(d2.cy)) <=
          (ob.radius || 2) * C.CELL) return endGame(true);
    }
    if (ob.type === 'demolish') {
      // arms while the target stands; wins when the LAST standing copy of
      // the type is rubble (capturing it doesn't count — destroy means destroy)
      const bt = typeof ob.btype === 'object' ? ob.btype[g.humanSide] : ob.btype;
      let standing = 0;
      for (const b of g.buildings.values()) {
        if (b.type === bt) standing++;
      }
      if (standing > 0) g._demArmed = true;
      else if (g._demArmed) return endGame(true);
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
    // an MP forfeit can end the game while the pause menu is up — clear it,
    // or it lingers on top of the score screen and then the main menu
    game.paused = false;
    $('pause').classList.add('hidden');
    $('controls').classList.add('hidden');
    game.status = won ? 'won' : 'lost';
    if (won && game.mission && game.mission.n) {
      MissionProgress.unlockUpTo(game.mission.n, baseSide(game.humanSide));
    }
    AUDIO.eva(won ? 'missionAccomplished' : 'missionFailed');
    const watched = typeof REPLAY !== 'undefined' && REPLAY.playing;
    if (typeof REPLAY !== 'undefined') {
      if (REPLAY.playing) REPLAY.stop();
      else REPLAY.finish(won);
    }

    const g = game;
    setTimeout(() => {
      // in MP the link deliberately STAYS open at the score screen — both
      // players can agree to a rematch over it (btnAgain/btnAbort close it).
      // The match is decided identically on both clients by now: the peer is
      // at most DELAY ticks behind.
      if (game !== g) return;   // restarted/aborted before the tally — stale score
      const secs = Math.floor(g.tick / C.TPS);
      const mm = String(Math.floor(secs / 60)).padStart(2, '0');
      const ss = String(secs % 60).padStart(2, '0');
      const score = Math.max(0, g.stats.kills * 100 + g.stats.buildingsKilled * 200 +
        Math.floor(g.stats.harvested / 10) - g.stats.losses * 50);
      // field rating: score tiers, with defeat capping the honors
      const TIERS = [['D', 'CONSCRIPT'], ['C', 'SERGEANT'], ['B', 'FIELD OFFICER'],
        ['A', 'IRON COMMANDER'], ['S', 'LEGENDARY']];
      let tier = score >= 4000 ? 4 : score >= 2500 ? 3 : score >= 1200 ? 2 : score >= 500 ? 1 : 0;
      if (!won) tier = Math.min(tier, 1);
      const rating = TIERS[tier][0] + ' · ' + TIERS[tier][1];
      const rows = [
        ['Mission time', mm + ':' + ss],
        ['Chrysalite harvested', Math.floor(g.stats.harvested)],
        ['Enemy units destroyed', g.stats.kills],
        ['Units lost', g.stats.losses],
        ['Enemy structures destroyed', g.stats.buildingsKilled],
        ['Structures lost', g.stats.buildingsLost],
        ['Score', score],
        ['Field rating', rating],
      ];
      // campaign records: fastest win and highest score per operation
      // (genuine wins only — watching an old replay must not set records)
      if (won && !watched && g.mission && g.mission.n) {
        const key = 'hw_rec_' + baseSide(g.humanSide) + '_' + g.mission.n;
        let rec = null;
        try { rec = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) {}
        const newBest = !rec || rec.t === undefined || secs < rec.t || score > rec.s;
        const best = {
          t: rec && rec.t !== undefined ? Math.min(rec.t, secs) : secs,
          s: rec && rec.s !== undefined ? Math.max(rec.s, score) : score,
        };
        try { localStorage.setItem(key, JSON.stringify(best)); } catch (e) {}
        const bm = String(Math.floor(best.t / 60)).padStart(2, '0');
        const bs = String(best.t % 60).padStart(2, '0');
        rows.push(['Op record' + (newBest ? ' — NEW BEST' : ''), bm + ':' + bs + ' · ' + best.s]);
      }
      const title = $('scoreTitle');
      if (g._spectate) {
        title.textContent = g._winnerSide
          ? C.SIDE_NAME[g._winnerSide] + ' TAKES THE FIELD'
          : 'MUTUAL ANNIHILATION';
        title.style.color = '#e0b840';
      } else {
        title.textContent = won ? 'MISSION ACCOMPLISHED' : 'MISSION FAILED';
        title.style.color = won ? '#e0b840' : '#e05038';
      }
      $('scoreLines').innerHTML = rows.map(r =>
        `<div class="row"><span>${r[0]}</span><span class="val">${r[1]}</span></div>`).join('');
      // replay controls only when there is a finished recording to show
      const canReplay = typeof REPLAY !== 'undefined' && REPLAY.hasLast();
      $('btnWatchReplay').classList.toggle('hidden', !canReplay);
      $('btnSaveReplay').classList.toggle('hidden', !canReplay);
      // rematch only while the MP link is still up
      const btnR = $('btnRematch');
      btnR.classList.toggle('hidden', !NET.active);
      btnR.disabled = false;
      btnR.textContent = NET.rematchOffered ? 'Rematch — opponent is ready!' : 'Rematch';
      $('score').classList.remove('hidden');
    }, 1400);
  }

  function togglePause(force) {
    if (!game) return;
    if (!$('menu').classList.contains('hidden')) return;
    // Esc with the controls sheet open steps back to the pause menu
    if (force === undefined && !$('controls').classList.contains('hidden')) {
      $('controls').classList.add('hidden');
      $('pause').classList.remove('hidden');
      return;
    }
    game.paused = force !== undefined ? force : !game.paused;
    $('pause').classList.toggle('hidden', !game.paused);
    if (game.paused) {
      // saving needs a live recording: single-player, not watching a replay
      $('btnSaveGame').classList.toggle('hidden',
        NET.active || typeof REPLAY === 'undefined' || !REPLAY.recording);
      $('seedLine').textContent = 'Map seed ' + game.seed +
        ' — enter it in Skirmish Setup to refight this battlefield';
    }
    if (!game.paused) $('controls').classList.add('hidden');
    if (NET.active) NET.notifyPause(game.paused);   // peer shows OPPONENT PAUSED
  }

  // pause (if needed) and open the controls reference — wired to F1 in Input
  function showControls() {
    if (!game || game.status !== 'playing') return;
    togglePause(true);
    $('pause').classList.add('hidden');
    $('controls').classList.remove('hidden');
  }

  // desynced lockstep match: no honest winner — show a neutral verdict screen
  function desyncEnd() {
    if (!game || ended) return;
    ended = true;
    game.paused = false;
    $('pause').classList.add('hidden');
    $('controls').classList.add('hidden');
    game.status = 'desync';
    const title = $('scoreTitle');
    title.textContent = 'MATCH VOID — DESYNC';
    title.style.color = '#e0b840';
    $('scoreLines').innerHTML =
      '<div class="row"><span>The two simulations diverged; the result cannot be scored.</span></div>' +
      '<div class="row"><span>Using the same browser on both ends makes this very unlikely.</span></div>';
    $('btnRematch').classList.add('hidden');   // the link is already torn down
    $('score').classList.remove('hidden');
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }

  // reconstruct a recorded battle's setup and boot straight into it; the
  // REPLAY module then feeds the recorded orders at their original ticks
  function startReplay(meta) {
    AUDIO.init();
    const mission = meta.mission ? MISSIONS.arc(meta.side)[meta.mission - 1] : null;
    const skirm = meta.skirmish ? DIFF_PRESETS[meta.skirmish] : null;
    startGame(meta.side, { seed: meta.seed, mission, skirmish: skirm, sk: meta.sk || undefined });
  }

  // _checkEnd is exposed for the headless test harness (manual sim rolls)
  return { boot, startGame, startReplay, endGame, desyncEnd, togglePause, showControls, _checkEnd };
})();
