'use strict';
// replay.js — record and watch single-player battles. Global: REPLAY.
//
// The sim is deterministic lockstep: a whole battle IS its seed, its setup,
// and the player's orders with the tick each one executed at. Recording taps
// the net.js wrapper layer (the same command encoding multiplayer uses) and
// costs a few kilobytes; playback re-runs startGame with the recorded setup
// and feeds the commands through NET.execReplay at the exact tick
// boundaries. The AI, economy, and combat re-simulate identically.
//
// Multiplayer games are not recorded (v1) — the order stream there belongs
// to two clients and the setup path differs.

const REPLAY = (function () {
  const VER = 1;

  let recording = false;
  let playing = false;
  let meta = null;      // { v, seed, side, mission, skirmish }
  let log = [];         // [{ t, c }] — command c executed after tick t
  let cursor = 0;
  let last = null;      // most recent finished recording { meta, log }

  // ---- recording -------------------------------------------------------------

  // armed by Main.startGame for every single-player game
  function arm(m) {
    recording = true;
    playing = false;
    meta = Object.assign({ v: VER }, m);
    log = [];
    cursor = 0;
  }

  function logCmd(c) {
    if (!recording) return;
    log.push({ t: typeof game !== 'undefined' && game ? game.tick : 0, c });
  }

  // the battle ended: freeze the recording as "last"
  function finish(won) {
    if (!recording) return;
    recording = false;
    last = {
      meta: Object.assign({}, meta, {
        endTick: typeof game !== 'undefined' && game ? game.tick : 0,
        won: !!won,
      }),
      log: log.slice(),
    };
  }

  function hasLast() { return !!(last && last.meta); }
  function exportLast() { return last ? JSON.stringify(last) : null; }

  // ---- playback --------------------------------------------------------------

  function watchLast() {
    if (last) _start(last);
  }

  function watchData(json) {
    const d = JSON.parse(json);
    if (!d || !d.meta || d.meta.v !== VER || !Array.isArray(d.log)) {
      throw new Error('Not a Harvest War replay file.');
    }
    _start(d);
  }

  function _start(d) {
    const keep = last;             // startGame re-arms the recorder; keep "last"
    Main.startReplay(d.meta);
    recording = false;
    last = keep;
    meta = d.meta;
    log = d.log;
    cursor = 0;
    playing = true;
  }

  // called by the main loop at the top of every tick iteration, BEFORE the
  // tick counter advances: state is exactly "after tick T", which is where
  // the original order executed (input lands between frames)
  function applyPending() {
    if (!playing || typeof game === 'undefined' || !game) return;
    while (cursor < log.length && log[cursor].t <= game.tick) {
      NET.execReplay(log[cursor].c, meta.side);
      cursor++;
    }
  }

  function stop() { playing = false; }

  return {
    arm, logCmd, finish, hasLast, exportLast,
    watchLast, watchData, applyPending, stop,
    get recording() { return recording; },
    get playing() { return playing; },
  };
})();
