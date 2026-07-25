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
  let meta = null;      // { v, seed, side, mission, skirmish, sk }
  let log = [];         // [{ t, c }] — command c executed after tick t
  let cursor = 0;
  let last = null;      // most recent finished recording { meta, log }
  let resumeAt = -1;    // save/resume: tick where playback hands back control

  // ---- recording -------------------------------------------------------------

  // armed by Main.startGame for every single-player game
  function arm(m) {
    recording = true;
    playing = false;
    // the sim PROTO rides in the meta from the start: a replay from another
    // game version would silently re-simulate a different battle
    meta = Object.assign({ v: VER, p: NET.PROTO }, m);
    log = [];
    cursor = 0;
    resumeAt = -1;
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

  // ---- mid-battle save -------------------------------------------------------
  // A save IS a replay cut short: the setup plus every order so far, and the
  // tick the player left off at. Resuming replays the log at fast-forward
  // speed up to that tick, then flips back to live recording — so a resumed
  // game can itself be saved or replayed again.

  function exportLive() {
    if (!recording || !meta) return null;
    return JSON.stringify({
      meta: Object.assign({}, meta, { p: NET.PROTO }),
      log: log.slice(),
      at: typeof game !== 'undefined' && game ? game.tick : 0,
    });
  }

  function resumeData(json) {
    const d = JSON.parse(json);
    if (!d || !d.meta || d.meta.v !== VER || !Array.isArray(d.log) ||
        typeof d.at !== 'number') {
      throw new Error('Not a Command and Conker save.');
    }
    if (d.meta.p !== undefined && d.meta.p !== NET.PROTO) {
      throw new Error('Save is from an older game version.');
    }
    Main.startReplay(d.meta);
    recording = false;
    meta = d.meta;
    log = d.log;
    cursor = 0;
    playing = true;
    resumeAt = d.at;
    game._ffTarget = d.at;
  }

  // ---- playback --------------------------------------------------------------

  function watchLast() {
    if (last) _start(last);
  }

  function watchData(json) {
    const d = JSON.parse(json);
    if (!d || !d.meta || d.meta.v !== VER || !Array.isArray(d.log)) {
      throw new Error('Not a Command and Conker replay file.');
    }
    if (d.meta.p !== NET.PROTO) {
      throw new Error('Replay is from an older game version.');
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
    // resuming a save: once caught up, hand the controls back to the player
    // and keep recording onto the same log so the game stays saveable
    if (resumeAt >= 0 && game.tick >= resumeAt) {
      playing = false;
      recording = true;
      resumeAt = -1;
    }
  }

  function stop() { playing = false; resumeAt = -1; }

  // kill a live recording WITHOUT freezing it as "last" — an aborted battle
  // isn't worth watching, and the menu's attract war must never append its
  // bot orders to a stale log
  function disarm() { recording = false; log = []; }

  return {
    arm, logCmd, finish, hasLast, exportLast, exportLive, resumeData,
    watchLast, watchData, applyPending, stop, disarm,
    get recording() { return recording; },
    get playing() { return playing; },
  };
})();
