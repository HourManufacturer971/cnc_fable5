'use strict';
// main.js — boot, menus, mission setup, fixed-step game loop, win/lose.
// Global: Main.

const Main = (function () {
  let canvas = null;
  let acc = 0, lastT = 0, rafStarted = false;
  let mySide = 'gdi';
  let ended = false;

  function $(id) { return document.getElementById(id); }

  function boot() {
    canvas = $('screen');
    Render.init(canvas);

    // faction logos on the menu
    for (const [slot, side] of [['logoGdi', 'gdi'], ['logoNod', 'nod']]) {
      const el = $(slot);
      if (el && SPRITES.logo[side]) el.appendChild(SPRITES.logo[side]);
    }

    document.querySelectorAll('#menu button[data-side]').forEach(btn => {
      btn.addEventListener('click', () => {
        AUDIO.init();
        startGame(btn.dataset.side);
      });
    });

    $('btnResume').addEventListener('click', () => togglePause(false));
    $('btnSound').addEventListener('click', () => {
      AUDIO.setEnabled(!AUDIO.enabled);
      $('btnSound').textContent = 'Sound: ' + (AUDIO.enabled ? 'ON' : 'OFF');
    });
    $('speedSlider').addEventListener('input', ev => {
      if (game) game.speed = ev.target.value / 100;
    });
    $('btnRestart').addEventListener('click', () => { togglePause(false); startGame(mySide); });
    $('btnAbort').addEventListener('click', () => {
      togglePause(false);
      AUDIO.eva('battleControlTerminated');
      game = null;
      window.game = null;
      $('menu').classList.remove('hidden');
    });
    $('btnAgain').addEventListener('click', () => {
      $('score').classList.add('hidden');
      game = null;
      window.game = null;
      $('menu').classList.remove('hidden');
    });

    // URL params for testing: ?side=&seed=&nomenu=1&mute=1
    const q = new URLSearchParams(location.search);
    if (q.get('mute')) AUDIO.setEnabled(false);
    if (q.get('nomenu')) {
      AUDIO.init();
      startGame(q.get('side') === 'nod' ? 'nod' : 'gdi',
        { seed: q.get('seed') ? +q.get('seed') : undefined });
    }

    if (!rafStarted) {
      rafStarted = true;
      requestAnimationFrame(loop);
    }
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
    ended = false;
    $('menu').classList.add('hidden');
    $('score').classList.add('hidden');
    $('pause').classList.add('hidden');

    game = makeGame({ side, seed: opts.seed });
    window.game = game;
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

    Production.computePower(game.human);
    Production.computePower(game.ai);
    AI.init(game);
    Input.init(canvas, game);
    Fog.update(game);

    game.camera.x = clamp(cellCenterX(hp.cx) - C.VIEW_W / 2, 0, C.MAP_W * C.CELL - C.VIEW_W);
    game.camera.y = clamp(cellCenterY(hp.cy) - C.VIEW_H / 2, 0, C.MAP_H * C.CELL - C.VIEW_H);
    game.startTime = Date.now();
    game.speed = ($('speedSlider').value || 140) / 100;

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
    if (humanAlive && aiAlive) return;
    endGame(humanAlive && !aiAlive);
  }

  function endGame(won) {
    if (ended || !game) return;
    ended = true;
    game.status = won ? 'won' : 'lost';
    AUDIO.eva(won ? 'missionAccomplished' : 'missionFailed');

    const g = game;
    setTimeout(() => {
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
