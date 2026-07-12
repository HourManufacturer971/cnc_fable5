'use strict';
// net.js — peer-to-peer multiplayer: deterministic lockstep over a WebRTC
// data channel. Global: NET. No server anywhere: connection codes are
// exchanged by hand (copy-paste over any chat), the only outside help is a
// public STUN server for NAT discovery. See SPEC.md "Multiplayer".
//
// Model: both clients run the IDENTICAL simulation from the same seed; only
// player ORDERS travel the wire. Every order a player issues is queued with
// an execution tick DELAY ticks in the future and broadcast; a client may
// only advance to tick T once it holds both sides' order batches for T, and
// batches are applied in fixed side order (gdi first) so the sims stay in
// lockstep. Fog, effects, audio and EVA remain per-client and are excluded
// from the desync checksum.
//
// The order functions (orderMove, Production.place, ...) are wrapped at load
// time: with NET inactive they pass straight through (zero single-player
// impact); with NET active, calls from input handlers are serialized into
// commands, while calls from inside the sim step (NET.inSim) or from command
// execution itself (NET.applying) go to the real implementations.

const NET = (function () {
  const PROTO = 1;         // bump when commands/handshake change shape
  const DELAY = 5;         // ticks between issuing and executing an order
  const CK_EVERY = 128;    // checksum exchange cadence (ticks)

  let active = false;      // lockstep engaged (game running)
  let applying = false;    // currently executing scheduled commands
  let inSim = false;       // inside the sim step (orders are sim-internal)
  let side = 'gdi';        // the LOCAL player's side
  let isHost = false;

  let chan = null;         // {send(obj), close()} transport wrapper
  let pc = null;           // RTCPeerConnection (null for the local transport)
  let outQueue = [];       // commands issued this tick, not yet sent
  let localBatches = new Map();   // tick -> [cmds] (our own, kept for apply)
  let remoteBatches = new Map();  // tick -> [cmds] (opponent's)
  let sentUpTo = 0;        // highest tick we have broadcast a batch for
  let lastAdvance = 0;     // performance.now() of the last applied tick
  let ownCk = new Map();   // tick -> checksum (ours)
  let remoteCk = new Map();// tick -> checksum (theirs)
  let desynced = false;
  let remotePaused = false;
  let onStatus = null;     // lobby status callback (string)
  let started = false;     // handshake completed, game launched

  // ---- tiny helpers ---------------------------------------------------------

  function _status(s) { if (onStatus) onStatus(s); }
  function _other(s) { return s === 'gdi' ? 'nod' : 'gdi'; }

  function _enc(obj) {
    return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
  }
  function _dec(str) {
    try {
      return JSON.parse(decodeURIComponent(escape(atob(str.replace(/\s+/g, '')))));
    } catch (e) {
      throw new Error('Unreadable code — copy the whole block exactly.');
    }
  }

  // ---- transport: WebRTC with manual (copy-paste) signaling ------------------

  function _mkPeer() {
    return new RTCPeerConnection({
      iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
    });
  }

  function _gathered(p) {
    // resolve once ICE gathering finishes so the SDP carries every candidate
    if (p.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(res => {
      const t = setTimeout(res, 4000); // some stacks never report 'complete'
      p.addEventListener('icegatheringstatechange', () => {
        if (p.iceGatheringState === 'complete') { clearTimeout(t); res(); }
      });
    });
  }

  function _wireChannel(dc) {
    dc.onopen = () => { _status('Connected.'); _handshake(dc); };
    dc.onclose = () => _peerGone();
    dc.onerror = () => _peerGone();
    dc.onmessage = ev => {
      let m = null;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      _onMessage(m);
    };
    chan = { send: obj => { try { dc.send(JSON.stringify(obj)); } catch (e) {} },
             close: () => { try { dc.close(); } catch (e) {} } };
  }

  // host: build the invite code
  async function host(pickedSide, statusCb) {
    _teardown();               // drop any earlier attempt (re-host, host-after-join)
    onStatus = statusCb || null;
    isHost = true; side = pickedSide === 'nod' ? 'nod' : 'gdi';
    pc = _mkPeer();
    pc.onconnectionstatechange = () => {
      // 'disconnected' is transient (wifi blip, NAT rebind) and often
      // recovers — the lockstep barrier just stalls meanwhile. Only a hard
      // failure (or the channel actually closing) forfeits the match.
      if (pc && pc.connectionState === 'failed') _peerGone();
    };
    _wireChannel(pc.createDataChannel('hw', { ordered: true }));
    const p = pc;                      // this attempt's peer; Back/re-host may swap pc
    const offer = await p.createOffer();
    if (pc !== p) throw new Error('Cancelled');
    await p.setLocalDescription(offer);
    await _gathered(p);
    if (pc !== p) throw new Error('Cancelled');
    _status('Invite code ready — send it to your opponent.');
    return _enc({ v: PROTO, k: 'o', sdp: p.localDescription.sdp });
  }

  // host: paste the guest's reply
  async function acceptAnswer(code) {
    const m = _dec(code);
    if (m.k !== 'a') throw new Error('That is not a reply code.');
    if (!pc) throw new Error('Host a game first, then paste the reply.');
    if (pc.signalingState !== 'have-local-offer') { _status('Connecting…'); return; }
    await pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
    _status('Connecting…');
  }

  // guest: paste the host's invite, produce the reply code
  async function join(code, statusCb) {
    const m = _dec(code);      // validate BEFORE tearing down a prior attempt
    _teardown();
    onStatus = statusCb || null;
    isHost = false;
    if (m.v !== PROTO) throw new Error('Version mismatch — both players need the latest build.');
    if (m.k !== 'o') throw new Error('That is not an invite code.');
    pc = _mkPeer();
    pc.onconnectionstatechange = () => {
      // 'disconnected' is transient (wifi blip, NAT rebind) and often
      // recovers — the lockstep barrier just stalls meanwhile. Only a hard
      // failure (or the channel actually closing) forfeits the match.
      if (pc && pc.connectionState === 'failed') _peerGone();
    };
    pc.ondatachannel = ev => _wireChannel(ev.channel);
    const p = pc;                      // this attempt's peer; Back/re-join may swap pc
    await p.setRemoteDescription({ type: 'offer', sdp: m.sdp });
    if (pc !== p) throw new Error('Cancelled');
    const answer = await p.createAnswer();
    await p.setLocalDescription(answer);
    await _gathered(p);
    if (pc !== p) throw new Error('Cancelled');
    _status('Reply code ready — send it back, then wait…');
    return _enc({ v: PROTO, k: 'a', sdp: p.localDescription.sdp });
  }

  // same-machine transport over BroadcastChannel: lets two tabs play without
  // any network, and gives the automated tests a deterministic wire
  function testLocal(name, asHost, pickedSide, statusCb) {
    onStatus = statusCb || null;
    isHost = !!asHost; if (isHost) side = pickedSide === 'nod' ? 'nod' : 'gdi';
    const bc = new BroadcastChannel('hw_mp_' + name);
    chan = { send: obj => bc.postMessage(obj), close: () => bc.close() };
    bc.onmessage = ev => {
      const m = ev.data;
      if (m && m.hi !== undefined) {
        // both sides announce; the host answers the guest's announce with
        // the handshake, exactly like the data-channel open event
        if (isHost && m.hi === 0) _handshake(null);
        return;
      }
      _onMessage(m);
    };
    setTimeout(() => bc.postMessage({ hi: isHost ? 1 : 0 }), 120);
    _status('Local link open, waiting for the other tab…');
  }

  // ---- handshake & lifecycle -------------------------------------------------

  function _handshake() {
    if (started) return;   // a re-announcing peer must not re-roll the match
    if (isHost) {
      const seed = 1 + ((Math.random() * 1e9) | 0);
      chan.send({ h: { v: PROTO, seed, hostSide: side } });
      _begin(seed);
    }
    // guest waits for {h}
  }

  function _begin(seed) {
    if (started) return;
    started = true;
    _reset();
    active = true;
    lastAdvance = performance.now();
    Main.startGame(side, { seed, mp: true });
  }

  function _reset() {
    outQueue = [];
    localBatches = new Map(); remoteBatches = new Map();
    sentUpTo = 0; desynced = false; remotePaused = false;
    ownCk = new Map(); remoteCk = new Map();
    for (let t = 1; t <= DELAY; t++) {           // both sides idle at first
      localBatches.set(t, []);
      remoteBatches.set(t, []);
    }
    sentUpTo = DELAY;
  }

  function _peerGone() {
    if (!chan && !pc) return;
    const wasActive = active;
    _teardown();
    if (wasActive && game && game.status === 'playing') {
      EV.emit('eva', 'Opponent disconnected — you hold the field');
      Main.endGame(true);
    } else {
      _status('Connection lost.');
    }
  }

  function _teardown() {
    active = false; started = false;
    if (chan) { chan.close(); chan = null; }
    if (pc) { try { pc.close(); } catch (e) {} pc = null; }
  }

  function close() {
    if (chan) chan.send({ bye: 1 });
    _teardown();
  }

  function _onMessage(m) {
    if (!m) return;
    if (m.h) {                                    // host's handshake (guest side)
      if (m.h.v !== PROTO) { _status('Version mismatch — refresh both browsers.'); return; }
      side = _other(m.h.hostSide);
      chan.send({ j: 1 });
      _begin(m.h.seed);
      return;
    }
    if (m.j) { _begin(undefined); return; }       // guest ack — host already knows the seed
    if (m.t !== undefined) { remoteBatches.set(m.t, m.c || []); return; }
    if (m.ck) { remoteCk.set(m.ck.t, m.ck.v); _compareCk(m.ck.t); return; }
    if (m.pz !== undefined) { remotePaused = !!m.pz; return; }
    if (m.ds) { _desync(); return; }
    if (m.bye) { _peerGone(); return; }
  }

  // ---- lockstep core -----------------------------------------------------------

  // broadcast our batch for tick `next + DELAY` (exactly once per tick value).
  // Called every advance attempt, so a stalled peer still receives the
  // batches it needs from us and the convoy can never deadlock.
  function pump(next) {
    const target = next + DELAY;
    if (target <= sentUpTo) return;
    const cmds = outQueue; outQueue = [];
    localBatches.set(target, cmds);
    sentUpTo = target;
    if (chan) chan.send({ t: target, c: cmds });
  }

  function ready(next) {
    return !desynced && localBatches.has(next) && remoteBatches.has(next);
  }

  function stalledMs() {
    return active ? performance.now() - lastAdvance : 0;
  }

  function notifyPause(on) {
    if (chan) chan.send({ pz: on ? 1 : 0 });
  }

  function applyTick(t) {
    lastAdvance = performance.now();
    applying = true;
    try {
      for (const s of ['gdi', 'nod']) {           // fixed order: determinism
        const batch = (s === side ? localBatches : remoteBatches).get(t);
        if (batch) for (const c of batch) {
          // one malformed command must not abort the tick half-applied —
          // that would silently skip Sim.tick for this tick on one client
          try { _exec(c, s); } catch (e) { console.warn('bad mp command', c, e); }
        }
      }
    } finally {
      applying = false;
    }
    localBatches.delete(t); remoteBatches.delete(t);
  }

  // after the sim step: keep the shared per-side explored maps fresh and
  // exchange checksums on cadence
  function postTick(g) {
    if (g.tick % 5 === 0) _updateExplored(g);
    if (g.tick % CK_EVERY === 0 && g.tick > 0) {
      const v = checksum(g);
      ownCk.set(g.tick, v);
      if (chan) chan.send({ ck: { t: g.tick, v } });
      _compareCk(g.tick);
      // keep the maps tiny
      for (const k of ownCk.keys()) if (k < g.tick - CK_EVERY * 4) ownCk.delete(k);
      for (const k of remoteCk.keys()) if (k < g.tick - CK_EVERY * 4) remoteCk.delete(k);
    }
  }

  function _compareCk(t) {
    if (!ownCk.has(t) || !remoteCk.has(t)) return;
    if (ownCk.get(t) !== remoteCk.get(t)) {
      if (chan) chan.send({ ds: 1 });             // let the peer show the same verdict
      _desync();
    }
  }

  function _desync() {
    if (desynced) return;
    desynced = true;
    EV.emit('eva', 'DESYNC DETECTED — MATCH VOID');
    if (game) game.status = 'desync';             // freezes the loop, keeps the frame
    _teardown();
    Main.desyncEnd();                             // neutral verdict screen + exit
  }

  // FNV-1a over the sim state that must match bit-for-bit. Fog, effects,
  // selections, scroll offsets etc. are deliberately excluded — they are
  // per-client by design.
  function checksum(g) {
    let h = 0x811c9dc5 | 0;
    const mix = n => {
      n = n | 0;
      h = Math.imul(h ^ (n & 0xff), 0x01000193);
      h = Math.imul(h ^ ((n >>> 8) & 0xff), 0x01000193);
      h = Math.imul(h ^ ((n >>> 16) & 0xff), 0x01000193);
      h = Math.imul(h ^ ((n >>> 24) & 0xff), 0x01000193);
    };
    mix(g.tick);
    for (const u of g.units.values()) {
      mix(u.id); mix(Math.round(u.x * 16)); mix(Math.round(u.y * 16));
      mix(Math.round(u.hp)); mix(u.tib ? Math.round(u.tib) : 0);
    }
    for (const b of g.buildings.values()) {
      mix(b.id); mix(Math.round(b.hp)); mix(Math.round(b.buildProgress * 64));
    }
    for (const s of ['gdi', 'nod']) {
      const p = g.players[s];
      mix(Math.round(p.credits * 16)); mix(p.super.timer | 0);
    }
    return h | 0;
  }

  // ---- shared per-side explored maps (fog the SIM may read) --------------------
  // _findTibCell filters a human harvester's auto-seek by explored ground. In
  // lockstep that read must not depend on which client is looking, so both
  // clients maintain explored maps for BOTH sides, deterministically.

  function _reveal(arr, cx, cy, r) {
    const rr = (r + 0.5) * (r + 0.5);
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(C.MAP_W - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(C.MAP_H - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= rr) arr[cellIdx(x, y)] = 1;
      }
    }
  }

  function _updateExplored(g) {
    for (const u of g.units.values()) {
      const m = g.mpExplored[u.owner];
      if (m) _reveal(m, worldToCell(u.x), worldToCell(u.y), DATA.units[u.type].sight);
    }
    for (const b of g.buildings.values()) {
      const m = g.mpExplored[b.owner];
      if (!m) continue;
      const d = DATA.buildings[b.type];
      _reveal(m, b.cx + (d.w - 1) / 2, b.cy + (d.h - 1) / 2, d.sight + Math.max(d.w, d.h) / 2);
    }
  }

  function initExplored(g) {
    const n = C.MAP_W * C.MAP_H;
    g.mpExplored = { gdi: new Uint8Array(n), nod: new Uint8Array(n) };
    _updateExplored(g);
  }

  // ---- command layer -------------------------------------------------------------

  // the real implementations, captured at load time
  const R = {
    orderMove, orderAttack, orderHarvest, orderDeploy, orderEnter,
    orderBoard, unloadCargo, stopUnit, orderRally,
    tryStart: Production.tryStart, cancel: Production.cancel,
    toggleHold: Production.toggleHold, place: Production.place,
    placeWallLine: Production.placeWallLine, sell: Production.sell,
    toggleRepair: Production.toggleRepair, launchSuper: Production.launchSuper,
    setPrimary: Production.setPrimary,
  };

  function _passthru() { return !active || inSim || applying; }
  function _q(c) { outQueue.push(c); }

  function _unit(g, id, s) {
    const u = g.units.get(id);
    return u && !u._dead && u.owner === s ? u : null;
  }
  function _bld(g, id, s) {
    const b = g.buildings.get(id);
    return b && !b._dead && b.owner === s ? b : null;
  }

  function _exec(c, s) {
    const g = game;
    if (!g) return;
    const p = g.players[s];
    switch (c.o) {
      case 'mv': { const u = _unit(g, c.id, s); if (u) R.orderMove(u, c.cx, c.cy); break; }
      case 'atk': { const u = _unit(g, c.id, s); const t = getEnt(c.tid); if (u && t && !t._dead) R.orderAttack(u, t); break; }
      case 'hrv': { const u = _unit(g, c.id, s); if (u) R.orderHarvest(u, c.cx, c.cy); break; }
      case 'dep': { const u = _unit(g, c.id, s); if (u) R.orderDeploy(u); break; }
      case 'ent': { const u = _unit(g, c.id, s); const t = getEnt(c.tid); if (u && t && !t._dead) R.orderEnter(u, t); break; }
      case 'brd': { const u = _unit(g, c.id, s); const t = _unit(g, c.tid, s); if (u && t) R.orderBoard(u, t); break; }
      case 'unl': { const u = _unit(g, c.id, s); if (u) R.unloadCargo(u); break; }
      case 'stp': { const u = _unit(g, c.id, s); if (u) R.stopUnit(u); break; }
      case 'rly': { const b = _bld(g, c.bid, s); if (b) R.orderRally(b, c.cx, c.cy); break; }
      case 'str': R.tryStart(p, c.key); break;
      case 'cnl': R.cancel(p, c.key); break;
      case 'hld': R.toggleHold(p, c.key); break;
      case 'plc': R.place(g, p, c.key, c.cx, c.cy); break;
      case 'wal': R.placeWallLine(g, p, c.key, c.cells.map(a => ({ cx: a[0], cy: a[1] }))); break;
      case 'sel': { const b = _bld(g, c.bid, s); if (b) R.sell(g, p, b); break; }
      case 'rep': { const b = _bld(g, c.bid, s); if (b) R.toggleRepair(g, p, b); break; }
      case 'sup': R.launchSuper(g, p, c.cx, c.cy); break;
      case 'pri': { const b = _bld(g, c.bid, s); if (b) R.setPrimary(p, b); break; }
    }
  }

  // ---- wrappers (installed at load; inert while NET is inactive) -----------------

  orderMove = function (u, cx, cy) {
    if (_passthru()) return R.orderMove(u, cx, cy);
    _q({ o: 'mv', id: u.id, cx, cy }); return true;
  };
  orderAttack = function (u, target, keepAnchor) {
    if (_passthru()) return R.orderAttack(u, target, keepAnchor);
    if (!target || target._dead || !DATA.units[u.type].weapon) return false;
    // mirror the real validation so the ack/buzz feedback is honest
    // (e.g. a ground-only gun ordered onto an aircraft must buzz, not ack)
    if (!_canTarget(_pickWeapon(u, target), target)) return false;
    _q({ o: 'atk', id: u.id, tid: target.id }); return true;
  };
  orderHarvest = function (u, cx, cy) {
    if (_passthru()) return R.orderHarvest(u, cx, cy);
    _q({ o: 'hrv', id: u.id, cx, cy });
  };
  orderDeploy = function (u) {
    if (_passthru()) return R.orderDeploy(u);
    _q({ o: 'dep', id: u.id }); return true;
  };
  orderEnter = function (u, target) {
    if (_passthru()) return R.orderEnter(u, target);
    if (!target || target.kind !== 'building') return false;
    _q({ o: 'ent', id: u.id, tid: target.id }); return true;
  };
  orderBoard = function (u, apc) {
    if (_passthru()) return R.orderBoard(u, apc);
    const cd = apc && DATA.units[apc.type];
    if (!cd || !cd.transport || !apc.cargo || apc.cargo.length >= cd.transport) return false;
    _q({ o: 'brd', id: u.id, tid: apc.id }); return true;
  };
  unloadCargo = function (apc) {
    if (_passthru()) return R.unloadCargo(apc);
    if (!apc.cargo || !apc.cargo.length) return false;
    _q({ o: 'unl', id: apc.id }); return true;
  };
  stopUnit = function (u) {
    if (_passthru()) return R.stopUnit(u);
    _q({ o: 'stp', id: u.id });
  };
  orderRally = function (b, cx, cy) {
    if (_passthru()) return R.orderRally(b, cx, cy);
    _q({ o: 'rly', bid: b.id, cx, cy }); return true;
  };

  Production.tryStart = function (p, key) {
    if (_passthru()) return R.tryStart(p, key);
    if (!Production.prereqOk(p, key)) { AUDIO.play('buzz'); return false; }
    _q({ o: 'str', key }); return true;
  };
  Production.cancel = function (p, key) {
    if (_passthru()) return R.cancel(p, key);
    _q({ o: 'cnl', key });
  };
  Production.toggleHold = function (p, key) {
    if (_passthru()) return R.toggleHold(p, key);
    _q({ o: 'hld', key });
  };
  Production.place = function (g, p, key, cx, cy) {
    if (_passthru()) return R.place(g, p, key, cx, cy);
    // local pre-validation (with OUR fog) for immediate UX; the queued
    // command re-validates against shared state on both clients
    if (p.ready.building !== key || !Production.canPlace(g, p, key, cx, cy)) {
      AUDIO.play('buzz'); return false;
    }
    _q({ o: 'plc', key, cx, cy }); return true;
  };
  Production.placeWallLine = function (g, p, key, cells) {
    if (_passthru()) return R.placeWallLine(g, p, key, cells);
    if (!cells.length) return 0;
    _q({ o: 'wal', key, cells: cells.map(c => [c.cx, c.cy]) });
    return cells.length;
  };
  Production.sell = function (g, p, b) {
    if (_passthru()) return R.sell(g, p, b);
    if (!b || b.owner !== p.side || b._dead) return false;
    _q({ o: 'sel', bid: b.id }); return true;
  };
  Production.toggleRepair = function (g, p, b) {
    if (_passthru()) return R.toggleRepair(g, p, b);
    if (!b || b.owner !== p.side || b.buildProgress < 1) return false;
    _q({ o: 'rep', bid: b.id }); return true;
  };
  Production.launchSuper = function (g, p, cx, cy) {
    if (_passthru()) return R.launchSuper(g, p, cx, cy);
    if (!Production.superReady(p)) return false;
    if (!Fog.isExplored(g, cx, cy)) { AUDIO.play('buzz'); return false; }
    _q({ o: 'sup', cx, cy }); return true;
  };
  Production.setPrimary = function (p, b) {
    if (_passthru()) return R.setPrimary(p, b);
    if (!b || b.owner !== p.side) return false;
    const kind = DATA.buildings[b.type] && DATA.buildings[b.type].factory;
    if (!kind) return false;
    _q({ o: 'pri', bid: b.id }); return true;
  };

  return {
    get active() { return active; },
    get applying() { return applying; },
    get inSim() { return inSim; }, set inSim(v) { inSim = !!v; },
    get side() { return side; },
    get isHost() { return isHost; },
    get desynced() { return desynced; },
    get remotePaused() { return remotePaused; },
    DELAY,
    host, acceptAnswer, join, testLocal, close,
    pump, ready, applyTick, postTick, stalledMs, notifyPause, initExplored, checksum,
  };
})();
