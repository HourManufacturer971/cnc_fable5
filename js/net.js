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
// batches are applied in fixed side order (udc first) so the sims stay in
// lockstep. Fog, effects, audio and EVA remain per-client and are excluded
// from the desync checksum.
//
// The order functions (orderMove, Production.place, ...) are wrapped at load
// time: with NET inactive they pass straight through (zero single-player
// impact); with NET active, calls from input handlers are serialized into
// commands, while calls from inside the sim step (NET.inSim) or from command
// execution itself (NET.applying) go to the real implementations.

const NET = (function () {
  const PROTO = 22;         // bump when commands/handshake OR sim rules change shape
  const DELAY = 5;         // ticks between issuing and executing an order
  const CK_EVERY = 128;    // checksum exchange cadence (ticks)

  let active = false;      // lockstep engaged (game running)
  let applying = false;    // currently executing scheduled commands
  let inSim = false;       // inside the sim step (orders are sim-internal)
  let side = 'udc';        // the LOCAL player's side
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
  let localRq = false;     // rematch: we asked
  let remoteRq = false;    // rematch: opponent asked
  let onRematch = null;    // score-screen callback: 'remote' | 'gone'

  // ---- tiny helpers ---------------------------------------------------------

  function _status(s) { if (onStatus) onStatus(s); }
  function _other(s) { return s === 'udc' ? 'srp' : 'udc'; }

  // ---- code packing: keep the copy-paste codes SHORT ------------------------
  // A datachannel-only SDP is ~95% boilerplate. We ship only the fields the
  // peer genuinely needs (ICE credentials, DTLS fingerprint, role, candidates)
  // and rebuild the standard SDP from a template on the other end, then
  // deflate + base64url the JSON. Typical code: ~250 chars instead of ~2000.

  function _packSdp(sdp) {
    const get = re => { const m = sdp.match(re); return m ? m[1] : ''; };
    const cands = [];
    for (const line of sdp.split(/\r?\n/)) {
      const m = line.match(/^a=(candidate:.*)$/);
      if (m) cands.push(m[1]);
    }
    return {
      u: get(/^a=ice-ufrag:(.*)$/m),
      p: get(/^a=ice-pwd:(.*)$/m),
      a: get(/^a=fingerprint:(\S+) /m) || 'sha-256',
      f: get(/^a=fingerprint:\S+ (.*)$/m),
      s: get(/^a=setup:(\w+)$/m),
      m: get(/^a=mid:(.*)$/m) || '0',
      c: cands,
    };
  }
  function _unpackSdp(d) {
    const lines = [
      'v=0',
      'o=- 8144460461903370238 2 IN IP4 127.0.0.1',
      's=-',
      't=0 0',
      'a=group:BUNDLE ' + d.m,
      'a=msid-semantic: WMS',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
      'c=IN IP4 0.0.0.0',
    ];
    for (const c of d.c) lines.push('a=' + c);
    lines.push(
      'a=ice-ufrag:' + d.u,
      'a=ice-pwd:' + d.p,
      'a=ice-options:trickle',
      'a=fingerprint:' + d.a + ' ' + d.f,
      'a=setup:' + d.s,
      'a=mid:' + d.m,
      'a=sctp-port:5000',
      'a=max-message-size:262144');
    return lines.join('\r\n') + '\r\n';
  }

  function _b64u(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function _unb64u(str) {
    const t = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const u = new Uint8Array(t.length);
    for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i);
    return u;
  }
  async function _deflate(str) {
    const st = new Blob([new TextEncoder().encode(str)]).stream()
      .pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(st).arrayBuffer());
  }
  async function _inflate(bytes) {
    const st = new Blob([bytes]).stream()
      .pipeThrough(new DecompressionStream('deflate-raw'));
    return new TextDecoder().decode(await new Response(st).arrayBuffer());
  }

  async function _enc(obj) {
    const json = JSON.stringify(obj);
    if (typeof CompressionStream !== 'undefined') {
      return 'HW2.' + _b64u(await _deflate(json));
    }
    return 'HW1.' + _b64u(new TextEncoder().encode(json)); // rare: no deflate support
  }
  async function _dec(str) {
    const s = String(str).replace(/\s+/g, '');
    if (s.startsWith('HW2.') && typeof DecompressionStream === 'undefined') {
      throw new Error('This browser cannot read the code — both players need a current browser.');
    }
    try {
      if (s.startsWith('HW2.')) return JSON.parse(await _inflate(_unb64u(s.slice(4))));
      if (s.startsWith('HW1.')) return JSON.parse(new TextDecoder().decode(_unb64u(s.slice(4))));
      return JSON.parse(decodeURIComponent(escape(atob(s)))); // legacy long code
    } catch (e) {
      throw new Error('Unreadable code — copy the whole block exactly.');
    }
  }

  // ---- transport: WebRTC with manual (copy-paste) signaling ------------------

  // STUN alone only discovers your public address; it cannot help when BOTH
  // routers refuse an inbound path (symmetric NAT, carrier-grade NAT, a lot of
  // mobile and corporate networks). That case needs a TURN relay, which means
  // credentials, which means it cannot ship in a static file. So it is opt-in:
  //
  //   localStorage.setItem('hw_turn', JSON.stringify(
  //     { urls: 'turn:host:3478', username: 'u', credential: 'p' }))
  //
  // Accepts one object or an array. Absent, the game behaves exactly as before.
  function _turnServers() {
    let raw = null;
    try { raw = localStorage.getItem('hw_turn'); } catch (e) { /* storage denied */ }
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return (Array.isArray(v) ? v : [v]).filter(s => s && s.urls);
    } catch (e) { return []; }
  }

  function _mkPeer() {
    return new RTCPeerConnection({
      iceServers: [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
      ].concat(_turnServers()),
    });
  }

  // Does this description carry a candidate that is any use to a peer on
  // ANOTHER machine? Host candidates are not: Chrome hides them behind mDNS
  // ".local" names that only resolve on the same LAN, and a bare LAN IP is
  // unroutable from outside anyway. Only a server-reflexive (STUN) or relay
  // (TURN) candidate can cross the internet.
  function _routableCands(sdp) {
    let srflx = 0, relay = 0, host = 0;
    for (const line of String(sdp || '').split(/\r?\n/)) {
      const m = line.match(/^a=candidate:.* typ (\w+)/);
      if (!m) continue;
      if (m[1] === 'srflx' || m[1] === 'prflx') srflx++;
      else if (m[1] === 'relay') relay++;
      else host++;
    }
    return { srflx, relay, host, routable: srflx + relay };
  }

  function _gathered(p) {
    // Resolve once ICE gathering finishes so the SDP carries every candidate.
    //
    // The cap used to be a flat 4s, which quietly truncated gathering on any
    // link where STUN answers slowly: the code went out carrying only mDNS
    // host candidates, and every cross-network game then failed with no
    // explanation. Now the wait ends EARLY once something routable has been
    // gathered, and otherwise holds on much longer before giving up.
    if (p.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(res => {
      let done = false;
      const finish = () => { if (!done) { done = true; clearTimeout(hard); clearInterval(poll); res(); } };
      // some stacks never report 'complete' — this is the backstop
      const hard = setTimeout(finish, 12000);
      // ...but do not make everyone wait 12s: the moment a reflexive or relay
      // candidate lands, the code is good enough to send
      const poll = setInterval(() => {
        const d = p.localDescription;
        if (d && _routableCands(d.sdp).routable > 0) finish();
      }, 250);
      p.addEventListener('icegatheringstatechange', () => {
        if (p.iceGatheringState === 'complete') finish();
      });
    });
  }

  // Warn BEFORE the code is sent, rather than after both players have pasted
  // and waited. A code with no routable candidate can only ever connect
  // between two machines on the same network.
  function _codeReach(p, what) {
    const c = _routableCands(p.localDescription && p.localDescription.sdp);
    if (c.routable > 0) return what + ' ready — send it to your opponent.';
    return what + ' ready, but it contains LOCAL addresses only — this will ' +
      'connect on the same network, not over the internet. (No STUN reply: ' +
      'a firewall or the network is blocking it.)';
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

  // 'failed' means ICE tried every candidate pair and none worked. That is
  // almost always NAT: with no TURN relay configured, two peers whose routers
  // both hide them can never meet. Say so, instead of a bare "connection lost"
  // that reads like a bug in the game.
  function _failReason(p) {
    const mine = _routableCands(p.localDescription && p.localDescription.sdp);
    const theirs = _routableCands(p.remoteDescription && p.remoteDescription.sdp);
    if (!mine.routable && !theirs.routable) {
      return 'No route found — both codes carried local addresses only. ' +
        'This pair can only connect on the same network.';
    }
    if (!mine.routable || !theirs.routable) {
      return 'No route found — one side\'s code carried local addresses only ' +
        '(its network blocked STUN). Same network only, or add a TURN relay.';
    }
    return 'No route found — both networks refused a direct connection. ' +
      'This usually needs a TURN relay (see README).';
  }

  // host: build the invite code
  async function host(pickedSide, statusCb) {
    _teardown();               // drop any earlier attempt (re-host, host-after-join)
    onStatus = statusCb || null;
    isHost = true; side = pickedSide === 'srp' ? 'srp' : 'udc';
    pc = _mkPeer();
    pc.onconnectionstatechange = () => {
      // 'disconnected' is transient (wifi blip, NAT rebind) and often
      // recovers — the lockstep barrier just stalls meanwhile. Only a hard
      // failure (or the channel actually closing) forfeits the match.
      if (pc && pc.connectionState === 'failed') _peerGone(_failReason(pc));
    };
    _wireChannel(pc.createDataChannel('hw', { ordered: true }));
    const p = pc;                      // this attempt's peer; Back/re-host may swap pc
    const offer = await p.createOffer();
    if (pc !== p) throw new Error('Cancelled');
    await p.setLocalDescription(offer);
    await _gathered(p);
    if (pc !== p) throw new Error('Cancelled');
    _status(_codeReach(p, 'Invite code'));
    return _enc({ v: PROTO, k: 'o', d: _packSdp(p.localDescription.sdp) });
  }

  // host: paste the guest's reply
  async function acceptAnswer(code) {
    const m = await _dec(code);
    if (m.k !== 'a') throw new Error('That is not a reply code.');
    if (!pc) throw new Error('Host a game first, then paste the reply.');
    if (pc.signalingState !== 'have-local-offer') { _status('Connecting…'); return; }
    await pc.setRemoteDescription({ type: 'answer', sdp: _unpackSdp(m.d) });
    _status('Connecting…');
  }

  // guest: paste the host's invite, produce the reply code
  async function join(code, statusCb) {
    const m = await _dec(code); // validate BEFORE tearing down a prior attempt
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
      if (pc && pc.connectionState === 'failed') _peerGone(_failReason(pc));
    };
    pc.ondatachannel = ev => _wireChannel(ev.channel);
    const p = pc;                      // this attempt's peer; Back/re-join may swap pc
    await p.setRemoteDescription({ type: 'offer', sdp: _unpackSdp(m.d) });
    if (pc !== p) throw new Error('Cancelled');
    const answer = await p.createAnswer();
    await p.setLocalDescription(answer);
    await _gathered(p);
    if (pc !== p) throw new Error('Cancelled');
    _status(_codeReach(p, 'Reply code') + ' Send it back, then wait…');
    return _enc({ v: PROTO, k: 'a', d: _packSdp(p.localDescription.sdp) });
  }

  // same-machine transport over BroadcastChannel: lets two tabs play without
  // any network, and gives the automated tests a deterministic wire
  function testLocal(name, asHost, pickedSide, statusCb) {
    onStatus = statusCb || null;
    isHost = !!asHost; if (isHost) side = pickedSide === 'srp' ? 'srp' : 'udc';
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
    localRq = false; remoteRq = false;
    _reset();
    active = true;
    lastAdvance = performance.now();
    Main.startGame(side, { seed, mp: true });
  }

  // ---- rematch: the datachannel stays open at the score screen ----------------
  // Both players press Rematch -> both flags set on both clients -> the host
  // re-runs the handshake, which rolls a FRESH seed and relaunches the match
  // over the same connection. No new code exchange needed.

  function requestRematch() {
    if (!chan || desynced) return false;
    localRq = true;
    chan.send({ rq: 1 });
    _tryRematch();
    return true;
  }

  function _tryRematch() {
    if (!localRq || !remoteRq) return;
    localRq = false; remoteRq = false;
    started = false;               // allow a fresh handshake on the open channel
    active = false;
    _handshake();                  // host rolls a new seed; guest waits for {h}
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

  function _peerGone(why) {
    if (!chan && !pc) return;
    const wasActive = active;
    _teardown();
    if (wasActive && game && game.status === 'playing') {
      EV.emit('eva', 'Opponent disconnected — you hold the field');
      Main.endGame(true);
    } else {
      _status(why || 'Connection lost.');
      if (onRematch) onRematch('gone');   // score screen: stop offering rematch
    }
  }

  function _teardown() {
    active = false; started = false;
    localRq = false; remoteRq = false;
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
    if (m.rq) { remoteRq = true; if (onRematch) onRematch('remote'); _tryRematch(); return; }
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
      for (const s of ['udc', 'srp']) {           // fixed order: determinism
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
      mix(u.kills || 0);   // veterancy scales damage — sim-relevant
    }
    if (g.crates) for (const c of g.crates) { mix(c.cx); mix(c.cy); mix(c.born); }
    for (const b of g.buildings.values()) {
      mix(b.id); mix(Math.round(b.hp)); mix(Math.round(b.buildProgress * 64));
    }
    for (const s of g.sides) {
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
    g.mpExplored = { udc: new Uint8Array(n), srp: new Uint8Array(n) };
    _updateExplored(g);
  }

  // ---- command layer -------------------------------------------------------------

  // the real implementations, captured at load time
  const R = {
    orderMove, orderAttack, orderAttackMove, orderHarvest, orderDeploy, orderEnter,
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
      case 'amv': { const u = _unit(g, c.id, s); if (u) R.orderAttackMove(u, c.cx, c.cy); break; }
      case 'atk': { const u = _unit(g, c.id, s); const t = getEnt(c.tid); if (u && t && !t._dead) R.orderAttack(u, t); break; }
      case 'hrv': { const u = _unit(g, c.id, s); if (u) R.orderHarvest(u, c.cx, c.cy); break; }
      case 'dep': { const u = _unit(g, c.id, s); if (u) R.orderDeploy(u); break; }
      case 'ent': { const u = _unit(g, c.id, s); const t = getEnt(c.tid); if (u && t && !t._dead) R.orderEnter(u, t); break; }
      case 'brd': { const u = _unit(g, c.id, s); const t = _unit(g, c.tid, s); if (u && t) R.orderBoard(u, t); break; }
      case 'unl': { const u = _unit(g, c.id, s) || _bld(g, c.id, s); if (u) R.unloadCargo(u); break; }
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

  // replay tap: in single-player, _passthru() is where GENUINE player input
  // flows (sim/AI/exec calls carry inSim/applying). The recorder logs the
  // command; while a replay is being WATCHED the order is swallowed instead
  // (look, don't touch). Returns true when the order must be swallowed.
  function _rec(c) {
    if (active || inSim || applying) return false;
    if (typeof REPLAY === 'undefined' || typeof game === 'undefined' || !game) return false;
    if (REPLAY.playing) return true;
    if (game._spectate) return true;   // AI-vs-AI: look, don't touch
    if (REPLAY.recording) REPLAY.logCmd(c);
    return false;
  }

  orderMove = function (u, cx, cy) {
    const c = { o: 'mv', id: u.id, cx, cy };
    if (_passthru()) return _rec(c) ? false : R.orderMove(u, cx, cy);
    _q(c); return true;
  };
  orderAttackMove = function (u, cx, cy) {
    const c = { o: 'amv', id: u.id, cx, cy };
    if (_passthru()) return _rec(c) ? false : R.orderAttackMove(u, cx, cy);
    _q(c); return true;
  };
  orderAttack = function (u, target, keepAnchor) {
    const c = target ? { o: 'atk', id: u.id, tid: target.id } : null;
    if (_passthru()) return c && _rec(c) ? false : R.orderAttack(u, target, keepAnchor);
    if (!target || target._dead || !DATA.units[u.type].weapon) return false;
    // mirror the real validation so the ack/buzz feedback is honest
    // (e.g. a ground-only gun ordered onto an aircraft must buzz, not ack)
    if (!_canTarget(_pickWeapon(u, target), target)) return false;
    _q(c); return true;
  };
  orderHarvest = function (u, cx, cy) {
    const c = { o: 'hrv', id: u.id, cx, cy };
    if (_passthru()) return _rec(c) ? undefined : R.orderHarvest(u, cx, cy);
    _q(c);
  };
  orderDeploy = function (u) {
    const c = { o: 'dep', id: u.id };
    if (_passthru()) return _rec(c) ? false : R.orderDeploy(u);
    _q(c); return true;
  };
  orderEnter = function (u, target) {
    const c = target && target.id !== undefined ? { o: 'ent', id: u.id, tid: target.id } : null;
    if (_passthru()) return c && _rec(c) ? false : R.orderEnter(u, target);
    if (!target || target.kind !== 'building') return false;
    _q(c); return true;
  };
  orderBoard = function (u, apc) {
    const c = apc ? { o: 'brd', id: u.id, tid: apc.id } : null;
    if (_passthru()) return c && _rec(c) ? false : R.orderBoard(u, apc);
    const cd = apc && DATA.units[apc.type];
    if (!cd || !cd.transport || !apc.cargo || apc.cargo.length >= cd.transport) return false;
    _q(c); return true;
  };
  unloadCargo = function (holder) {
    const c = { o: 'unl', id: holder.id };
    if (_passthru()) return _rec(c) ? false : R.unloadCargo(holder);
    const bag = holder.kind === 'building' ? holder.garrison : holder.cargo;
    if (!bag || !bag.length) return false;
    _q(c); return true;
  };
  stopUnit = function (u) {
    const c = { o: 'stp', id: u.id };
    if (_passthru()) return _rec(c) ? undefined : R.stopUnit(u);
    _q(c);
  };
  orderRally = function (b, cx, cy) {
    const c = { o: 'rly', bid: b.id, cx, cy };
    if (_passthru()) return _rec(c) ? false : R.orderRally(b, cx, cy);
    _q(c); return true;
  };

  Production.tryStart = function (p, key) {
    const c = { o: 'str', key };
    if (_passthru()) return _rec(c) ? false : R.tryStart(p, key);
    if (!Production.prereqOk(p, key)) { AUDIO.play('buzz'); return false; }
    _q(c); return true;
  };
  Production.cancel = function (p, key) {
    const c = { o: 'cnl', key };
    if (_passthru()) return _rec(c) ? undefined : R.cancel(p, key);
    _q(c);
  };
  Production.toggleHold = function (p, key) {
    const c = { o: 'hld', key };
    if (_passthru()) return _rec(c) ? undefined : R.toggleHold(p, key);
    _q(c);
  };
  Production.place = function (g, p, key, cx, cy) {
    const c = { o: 'plc', key, cx, cy };
    if (_passthru()) return _rec(c) ? false : R.place(g, p, key, cx, cy);
    // local pre-validation (with OUR fog) for immediate UX; the queued
    // command re-validates against shared state on both clients
    if (p.ready.building !== key || !Production.canPlace(g, p, key, cx, cy)) {
      AUDIO.play('buzz'); return false;
    }
    _q(c); return true;
  };
  Production.placeWallLine = function (g, p, key, cells) {
    const c = { o: 'wal', key, cells: cells.map(w => [w.cx, w.cy]) };
    if (_passthru()) return _rec(c) ? 0 : R.placeWallLine(g, p, key, cells);
    if (!cells.length) return 0;
    _q(c);
    return cells.length;
  };
  Production.sell = function (g, p, b) {
    const c = b ? { o: 'sel', bid: b.id } : null;
    if (_passthru()) return c && _rec(c) ? false : R.sell(g, p, b);
    if (!b || b.owner !== p.side || b._dead) return false;
    _q(c); return true;
  };
  Production.toggleRepair = function (g, p, b) {
    const c = b ? { o: 'rep', bid: b.id } : null;
    if (_passthru()) return c && _rec(c) ? false : R.toggleRepair(g, p, b);
    if (!b || b.owner !== p.side || b.buildProgress < 1) return false;
    _q(c); return true;
  };
  Production.launchSuper = function (g, p, cx, cy) {
    const c = { o: 'sup', cx, cy };
    if (_passthru()) return _rec(c) ? false : R.launchSuper(g, p, cx, cy);
    if (!Production.superReady(p)) return false;
    if (!Fog.isExplored(g, cx, cy)) { AUDIO.play('buzz'); return false; }
    _q(c); return true;
  };
  Production.setPrimary = function (p, b) {
    const c = b ? { o: 'pri', bid: b.id } : null;
    if (_passthru()) return c && _rec(c) ? false : R.setPrimary(p, b);
    if (!b || b.owner !== p.side) return false;
    const kind = DATA.buildings[b.type] && DATA.buildings[b.type].factory;
    if (!kind) return false;
    _q(c); return true;
  };

  // apply one recorded command during replay playback (mirrors the MP path)
  function execReplay(c, s) {
    applying = true;
    try { _exec(c, s); } catch (e) { console.warn('bad replay command', c, e); }
    finally { applying = false; }
  }

  return {
    get active() { return active; },
    get applying() { return applying; },
    get inSim() { return inSim; }, set inSim(v) { inSim = !!v; },
    get side() { return side; },
    get isHost() { return isHost; },
    get desynced() { return desynced; },
    get remotePaused() { return remotePaused; },
    get PROTO() { return PROTO; },
    get rematchOffered() { return remoteRq; },
    set onRematch(f) { onRematch = f; },
    DELAY,
    requestRematch,
    host, acceptAnswer, join, testLocal, close,
    pump, ready, applyTick, postTick, stalledMs, notifyPause, initExplored, checksum,
    execReplay,
  };
})();
