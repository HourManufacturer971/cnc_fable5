'use strict';
// main.js — boot, menus, mission setup, fixed-step game loop, win/lose.
// Global: Main.

const Main = (function () {
  let canvas = null;
  let acc = 0, lastT = 0, rafStarted = false;
  let mySide = 'gdi';
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
        document.body.dataset.side = btn.dataset.side;   // retint menu chrome to the faction
        _showMissions(btn.dataset.side);
      });
    });
    $('btnMissionsBack').addEventListener('click', () => {
      $('missions').classList.add('hidden');
      _refreshResumeSave();
      $('menu').classList.remove('hidden');
    });
    // skirmish setup: remember the player's choices (the seed stays per-visit)
    try {
      const s = JSON.parse(localStorage.getItem('hw_sk') || 'null');
      if (s) {
        if (s.c) $('skCredits').value = s.c;
        if (s.cr !== undefined) $('skCrates').value = s.cr ? '1' : '0';
        if (s.sw !== undefined) $('skSupers').value = s.sw ? '1' : '0';
        if (s.p) $('skPlayers').value = s.p;
        if (s.m) $('skMap').value = s.m;
      }
    } catch (e) {}
    for (const id of ['skCredits', 'skCrates', 'skSupers', 'skPlayers', 'skMap']) {
      $(id).addEventListener('change', () => {
        try {
          localStorage.setItem('hw_sk', JSON.stringify({
            c: $('skCredits').value,
            cr: $('skCrates').value === '1',
            sw: $('skSupers').value === '1',
            p: $('skPlayers').value,
            m: $('skMap').value,
          }));
        } catch (e) {}
      });
    }
    _wireMpLobby();
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
        q.get('side') || 'gdi', s => console.log('[mp]', s));
    }
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

  // ---- multiplayer lobby ---------------------------------------------------------------

  function _wireMpLobby() {
    let mpSide = 'gdi';
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
    const sideBtns = { gdi: $('mpSideGdi'), nod: $('mpSideNod') };
    const pickSide = s => {
      mpSide = s;
      sideBtns.gdi.classList.toggle('sel', s === 'gdi');
      sideBtns.nod.classList.toggle('sel', s === 'nod');
    };
    sideBtns.gdi.addEventListener('click', () => pickSide('gdi'));
    sideBtns.nod.addEventListener('click', () => pickSide('nod'));
    pickSide('gdi');

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
        sub.textContent = (d.meta.side === 'nod' ? 'Serpent Order' : 'UDC') +
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

  function _showMissions(side) {
    mySide = side;
    $('menu').classList.add('hidden');
    $('missionsTitle').textContent = 'OPERATIONS — ' + C.SIDE_NAME[side];
    const list = $('missionList');
    list.innerHTML = '';
    const done = MissionProgress.get();

    // skirmish at three difficulties: the knobs the campaign already uses
    // (wave cadence, wave cap, AI war chest) exposed straight to the player
    for (const [tag, diff] of [['EASY', DIFF_PRESETS.EASY], ['NORMAL', null], ['HARD', DIFF_PRESETS.HARD]]) {
      const skirm = document.createElement('button');
      skirm.innerHTML = `<span>SKIRMISH — ${tag}</span><span class="tag">RANDOM BATTLEFIELD</span>`;
      skirm.addEventListener('click', () => {
        $('missions').classList.add('hidden');
        startGame(mySide, { skirmish: diff, sk: _skOptions() });
      });
      list.appendChild(skirm);
    }

    for (const m of MISSIONS) {
      const btn = document.createElement('button');
      const open = MissionProgress.unlocked(m);
      let tag = m.n <= done ? 'COMPLETE' : open ? 'READY' : 'LOCKED';
      // personal best for a completed op: fastest win + highest score
      if (m.n <= done) {
        let rec = null;
        try { rec = JSON.parse(localStorage.getItem('hw_rec_' + m.n) || 'null'); } catch (e) {}
        if (rec && rec.t !== undefined) {
          const mm = String(Math.floor(rec.t / 60)).padStart(2, '0');
          const ss = String(rec.t % 60).padStart(2, '0');
          tag += ` · BEST ${mm}:${ss} · ${rec.s}`;
        }
      }
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
    myMission = opts.mp ? null : (opts.mission || null);
    mySkirmish = opts.mp ? null : (opts.skirmish || null);
    ended = false;
    $('menu').classList.add('hidden');
    $('score').classList.add('hidden');
    $('pause').classList.add('hidden');
    $('missions').classList.add('hidden');
    $('briefing').classList.add('hidden');
    $('mplobby').classList.add('hidden');

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
    const aiCr = (mission && mission.aiCredits) || (mySkirmish && mySkirmish.aiCredits);
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
    MAPGEN.generate(game, game.seed, mission && mission.holdout ? { holdout: true } : undefined);
    Fog.init(game);

    const hp = game.startPos.human, ap = game.startPos.ai;
    const aiSide = enemyOf(side);

    if (opts.mp) {
      // multiplayer: two human MCV starts. The side->position mapping and
      // the spawn ORDER must be canonical — identical on both clients — so
      // both mint the same entity ids: gdi always takes the SW spot (the
      // map's "human" slot), nod the NE one, gdi spawns first.
      _spawnEscort(game, 'gdi', hp, true);
      _spawnEscort(game, 'nod', ap, true);
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
    // mission-specific stage dressing: pre-built enemy works, convoys,
    // checkpoint garrisons… (deterministic — replays rebuild identically)
    if (mission && mission.setup && !opts.mp) {
      mission.setup(game, { hs: hp, as: ap, side, aiSide });
    }

    for (const s of game.sides) Production.computePower(game.players[s]);
    AI.init(game);   // in MP this is a symmetric no-op consumer of game.rng
    Input.init(canvas, game);
    Fog.update(game);
    if (opts.mp) NET.initExplored(game);

    // camera on the LOCAL player's start (in MP that is side-dependent)
    const myPos = opts.mp ? (side === 'gdi' ? hp : ap) : hp;
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
    if (won && game.mission && game.mission.n) MissionProgress.unlockUpTo(game.mission.n);
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
        const key = 'hw_rec_' + g.mission.n;
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
    const mission = meta.mission ? MISSIONS[meta.mission - 1] : null;
    const skirm = meta.skirmish ? DIFF_PRESETS[meta.skirmish] : null;
    startGame(meta.side, { seed: meta.seed, mission, skirmish: skirm, sk: meta.sk || undefined });
  }

  // _checkEnd is exposed for the headless test harness (manual sim rolls)
  return { boot, startGame, startReplay, endGame, desyncEnd, togglePause, showControls, _checkEnd };
})();
