'use strict';
// audio.js — the AUDIO global: fully synthesized WebAudio SFX + a synthesized
// comms voice. NOTHING uses the browser's speech synthesis — the tactical
// announcer and unit chatter are built from oscillators + formant filters at
// play time (see voxTransmission), so they sound like an in-universe radio
// computer instead of a screen-reader, and sound identical on every device.
// The literal announcement text is surfaced on the HUD (render.js listens for
// the 'eva' event) so no information rides on the stylized voice alone.
// No samples: every SFX is layered at play time from (a) a 2-8ms noise
// transient, (b) a filtered-noise body with a downward filter sweep, (c) a
// pitch-dropping sine 'thump' sub layer, and (d) an echo-tap send for the big
// booms. Combat sounds are randomly detuned ~±10% per play. Every public
// function is a safe no-op when disabled, before init(), or when WebAudio is
// unavailable. Audio is cosmetic, so Math.random() is fine.

const AUDIO = (function () {
  const MASTER_GAIN = 0.35;
  const MASTER_LP_HZ = 9000;  // gentle master lowpass to take the digital edge off
  const MAX_VOICES = 18;      // cap on simultaneously sounding source nodes
  const TICK_MIN_MS = 30;     // credit-counter tick rate limit
  const ACK_MIN_MS = 900;     // at most one unit acknowledgment per ~second

  let ctx = null;             // AudioContext, created lazily by init()
  let master = null;          // master gain (-> lowpass -> destination)
  let echoIn = null;          // input of the shared echo/delay tap for big booms
  let inited = false;
  let enabled = true;
  let voiceEnabled = true;    // the announcer/chatter voice, toggled separately
  let sfxVol = 1;             // slider multiplier on MASTER_GAIN (0..2)
  let voxVol = 1;             // slider multiplier on the voice bus (0..2)
  let voxBus = null;          // voice gain -> lowpass; bypasses master so the
                              // SFX slider doesn't also scale the announcer
  let activeVoices = 0;
  let noiseBuf = null;        // shared 1s white-noise buffer
  let pinkBuf = null;         // shared 2s pink-ish noise buffer (warmer roars/rumbles)
  let lastTickAt = -1e9;
  let lastAckAt = -1e9;

  // EVA announcer state (synthesized voice, queued so lines don't overlap)
  const evaQueue = [];        // pending EVA line texts
  const EVA_QUEUE_MAX = 5;    // drop new lines when badly backlogged
  let evaBusy = false;        // an EVA line is currently being delivered
  let evaTimer = 0;           // sequencing timeout handle

  function noop() {}
  function nowMs() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  function audioReady() { return enabled && inited && !!ctx && !!master; }

  // random helpers (per-play variation so repeated combat sounds don't grate)
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function vr(v, pct) { // v varied by ±pct (default ±8%)
    const p = pct === undefined ? 0.08 : pct;
    return v * (1 + (Math.random() * 2 - 1) * p);
  }

  // ---- WebAudio primitives ---------------------------------------------------

  function getNoise() {
    if (!noiseBuf) {
      const len = ctx.sampleRate | 0; // 1 second
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }

  // Pink-ish noise (Paul Kellet filter) — softer top end for roars, rumbles, tails.
  function getPink() {
    if (!pinkBuf) {
      const len = (ctx.sampleRate * 2) | 0; // 2 seconds
      pinkBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = pinkBuf.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.0168980;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    }
    return pinkBuf;
  }

  // Schedule a piecewise curve on an AudioParam. pts = [[dtSeconds, value], ...].
  // First point is set, the rest ramp exponentially (floored so expo ramps are legal
  // and envelopes land at ~0.001, never a hard 0 jump mid-buffer).
  function curve(param, t0, pts) {
    param.setValueAtTime(Math.max(0.0001, pts[0][1]), t0 + pts[0][0]);
    for (let i = 1; i < pts.length; i++) {
      param.exponentialRampToValueAtTime(Math.max(0.0001, pts[i][1]), t0 + pts[i][0]);
    }
  }

  // Start a source with voice accounting; stops it after dur (plus a small tail pad).
  function startSrc(src, t0, dur, offset) {
    activeVoices++;
    let done = false;
    const fin = function () { if (!done) { done = true; activeVoices--; } };
    src.onended = fin;
    try {
      if (offset) src.start(t0, offset); else src.start(t0);
      src.stop(t0 + dur + 0.03);
    } catch (e) { fin(); return; }
    // safety net so a missed 'ended' event can never wedge the voice counter
    const waitMs = Math.max(0, (t0 - ctx.currentTime + dur)) * 1000 + 500;
    setTimeout(fin, waitMs);
  }

  // Post-fader send from a voice's gain node into the echo bus (size on big booms).
  function sendEcho(g, amt) {
    if (!echoIn || !g) return;
    const s = ctx.createGain();
    s.gain.value = amt;
    g.connect(s); s.connect(echoIn);
  }

  // Oscillator voice: fPts / vPts are [[dt, hz], ...] / [[dt, gain], ...] curves.
  // opts: {filt: [type, Q, fPts], dest, send}. Returns the gain node (for extra
  // modulation) or null when at the voice cap.
  function tone(t0, dur, type, fPts, vPts, opts) {
    if (activeVoices >= MAX_VOICES) return null;
    const o = ctx.createOscillator();
    o.type = type;
    curve(o.frequency, t0, fPts);
    let head = o;
    if (opts && opts.filt) {
      const f = ctx.createBiquadFilter();
      f.type = opts.filt[0];
      f.Q.value = opts.filt[1] || 1;
      curve(f.frequency, t0, opts.filt[2]);
      o.connect(f); head = f;
    }
    const g = ctx.createGain();
    curve(g.gain, t0, vPts);
    head.connect(g);
    g.connect((opts && opts.dest) || master);
    if (opts && opts.send) sendEcho(g, opts.send);
    startSrc(o, t0, dur);
    return g;
  }

  // Filtered-noise voice. filtType null = raw noise. fPts drives the filter frequency.
  // opts: {pink, send, dest}.
  function noiseHit(t0, dur, filtType, fPts, q, vPts, opts) {
    if (activeVoices >= MAX_VOICES) return null;
    const s = ctx.createBufferSource();
    s.buffer = (opts && opts.pink) ? getPink() : getNoise();
    s.loop = true;
    let head = s;
    if (filtType) {
      const f = ctx.createBiquadFilter();
      f.type = filtType;
      f.Q.value = q || 1;
      curve(f.frequency, t0, fPts);
      s.connect(f); head = f;
    }
    const g = ctx.createGain();
    curve(g.gain, t0, vPts);
    head.connect(g);
    g.connect((opts && opts.dest) || master);
    if (opts && opts.send) sendEcho(g, opts.send);
    startSrc(s, t0, dur, Math.random() * 0.5);
    return g;
  }

  // (a) transient: 2-8ms high-frequency noise snap — the 'attack' of an impact.
  function snap(t0, hz, vol) {
    noiseHit(t0, 0.02, 'highpass', [[0, hz]], 0.7,
      [[0, 0.001], [0.002, vol], [0.02, 0.001]]);
  }

  // (c) sub layer: pitch-dropping sine 'thump' (sine starts at zero-crossing: click-free).
  function thump(t0, f0, f1, dur, vol, send) {
    return tone(t0, dur, 'sine', [[0, f0], [dur * 0.85, f1]],
      [[0, 0.001], [0.006, vol], [dur, 0.001]],
      send ? { send: send } : undefined);
  }

  // ---- SFX library -------------------------------------------------------------
  // Each entry builds a short layered graph at time t (ctx.currentTime).

  const SFX = {
    // soft short UI tick (quiet — UI must never bark)
    click(t) {
      noiseHit(t, 0.03, 'bandpass', [[0, 2300], [0.03, 1300]], 2,
        [[0, 0.001], [0.003, 0.09], [0.03, 0.001]]);
      tone(t, 0.045, 'sine', [[0, 940], [0.045, 700]],
        [[0, 0.001], [0.005, 0.06], [0.045, 0.001]]);
    },

    // error: low dissonant pair, softened with a lowpass'd noise floor
    buzz(t) {
      tone(t, 0.22, 'square', [[0, 108]], [[0, 0.001], [0.012, 0.12], [0.16, 0.09], [0.22, 0.001]],
        { filt: ['lowpass', 1, [[0, 1400]]] });
      tone(t, 0.22, 'square', [[0, 147]], [[0, 0.001], [0.012, 0.09], [0.22, 0.001]],
        { filt: ['lowpass', 1, [[0, 1400]]] });
      noiseHit(t, 0.22, 'lowpass', [[0, 380]], 1,
        [[0, 0.001], [0.02, 0.07], [0.22, 0.001]], { pink: true });
    },

    // one credit-counter tick: tiny filtered-noise click, not a beep
    tick(t) {
      noiseHit(t, 0.018, 'bandpass', [[0, 3100]], 4,
        [[0, 0.001], [0.002, 0.09], [0.018, 0.001]]);
    },

    // heavy placement thunk: snap + sub + body, then ringing metal (high-Q noise pings)
    // gate servo: a short motor whirr into a metal seat-clunk
    gate(t) {
      noiseHit(t, 0.16, 'bandpass', [[0, 420], [0.16, 900]], 6,
        [[0, 0.001], [0.02, 0.10], [0.13, 0.06], [0.16, 0.001]]);
      tone(t, 0.14, 'sawtooth', [[0, 88], [0.14, 132]],
        [[0, 0.001], [0.02, 0.05], [0.14, 0.001]],
        { filt: ['lowpass', 2, [[0, 900]]] });
      snap(t + 0.15, 520, 0.12);
      thump(t + 0.15, 120, 60, 0.10, 0.25);
    },

    place(t) {
      snap(t, 700, 0.2);
      thump(t, 150, 42, 0.2, 0.5);
      noiseHit(t, 0.14, 'lowpass', [[0, 1100], [0.14, 180]], 1,
        [[0, 0.001], [0.005, 0.3], [0.14, 0.001]], { pink: true });
      const pings = [[0.09, 620, 0.32], [0.10, 1130, 0.24], [0.11, 1880, 0.16]];
      for (let i = 0; i < pings.length; i++) {
        noiseHit(t + pings[i][0], 0.13, 'bandpass', [[0, vr(pings[i][1], 0.04)]], 16,
          [[0, 0.001], [0.004, pings[i][2]], [0.13, 0.001]]);
      }
    },

    // breathy rising zip + coin pings (deconstruct / refund)
    sell(t) {
      noiseHit(t, 0.3, 'bandpass', [[0, 300], [0.3, 2600]], 3,
        [[0, 0.001], [0.05, 0.15], [0.26, 0.19], [0.3, 0.001]]);
      tone(t, 0.3, 'triangle', [[0, 200], [0.3, 1400]],
        [[0, 0.001], [0.05, 0.05], [0.3, 0.001]]);
      for (let i = 0; i < 3; i++) {
        const tt = t + 0.3 + i * 0.055 + Math.random() * 0.015;
        tone(tt, 0.07, 'sine', [[0, 1500 + i * 350 + Math.random() * 180]],
          [[0, 0.001], [0.006, 0.11], [0.07, 0.001]]);
      }
    },

    // wrench ratchet: rapid resonant clicks, slightly detuned each play
    repair(t) {
      for (let i = 0; i < 4; i++) {
        noiseHit(t + i * rnd(0.046, 0.056), 0.024, 'bandpass', [[0, vr(2100, 0.1)]], 7,
          [[0, 0.001], [0.003, 0.5], [0.024, 0.001]]);
      }
    },

    // wet low thump (tank squishing infantry)
    crush(t) {
      noiseHit(t, 0.2, 'lowpass', [[0, vr(500)], [0.2, 90]], 1,
        [[0, 0.001], [0.006, 0.36], [0.2, 0.001]], { pink: true });
      thump(t, vr(100), 34, 0.16, 0.34);
      noiseHit(t + 0.02, 0.1, 'bandpass', [[0, vr(900)], [0.1, 400]], 1,
        [[0, 0.001], [0.008, 0.13], [0.1, 0.001]]);
    },
    squish(t) { SFX.crush(t); },

    // 5-6 round burst at a believable cyclic rate: each shot is a wideband
    // 1ms snap + low-mid report + its own little chest knock
    mgun(t) {
      const n = 5 + ((Math.random() * 2) | 0);
      for (let i = 0; i < n; i++) {
        const tt = t + i * rnd(0.066, 0.078);
        // wideband muzzle snap (raw noise, near-instant decay)
        noiseHit(tt, 0.018, null, null, 1,
          [[0, 0.001], [0.001, vr(0.4, 0.15)], [0.018, 0.001]]);
        // low-mid report body — this is what makes it read as a gunshot
        const f = vr(430, 0.12);
        noiseHit(tt, 0.06, 'bandpass', [[0, f], [0.06, f * 0.5]], 0.8,
          [[0, 0.001], [0.002, vr(0.5, 0.12)], [0.06, 0.001]]);
        thump(tt, vr(120), 55, 0.05, 0.2);
      }
    },

    // single shot: snap + low-mid report + knock, slightly bigger than one mg round
    pistol(t) {
      noiseHit(t, 0.02, null, null, 1,
        [[0, 0.001], [0.001, 0.42], [0.02, 0.001]]);
      const f = vr(480, 0.1);
      noiseHit(t, 0.09, 'bandpass', [[0, f], [0.09, f * 0.4]], 0.8,
        [[0, 0.001], [0.002, 0.5], [0.09, 0.001]]);
      thump(t, vr(150), 55, 0.07, 0.24);
    },

    // tank gun: 2ms snap, punchy 60-80Hz sub thump, mid crack, pink rumble tail + echo
    cannon(t) {
      snap(t, 1200, 0.28);
      thump(t, rnd(62, 80), 40, vr(0.3), 0.55, 0.5);
      noiseHit(t, 0.09, 'bandpass', [[0, vr(1000)], [0.09, 340]], 1,
        [[0, 0.001], [0.003, 0.38], [0.09, 0.001]], { send: 0.4 });
      const d = vr(0.55);
      noiseHit(t + 0.02, d, 'lowpass', [[0, 620], [d, 90]], 1,
        [[0, 0.001], [0.02, 0.28], [d, 0.001]], { pink: true });
    },

    // breathy launch: filter sweeps up fast then falls away (doppler-ish), soft kick
    rocket(t) {
      const d = vr(0.55);
      const fpk = vr(1900, 0.12);
      noiseHit(t, d, 'bandpass', [[0, 350], [d * 0.3, fpk], [d, 230]], 1.6,
        [[0, 0.001], [0.05, 0.62], [d * 0.6, 0.44], [d, 0.001]], { pink: true });
      noiseHit(t, d * 0.8, 'highpass', [[0, 2800], [d * 0.8, 900]], 0.8,
        [[0, 0.001], [0.06, 0.12], [d * 0.8, 0.001]]);
      thump(t, vr(120), 55, 0.12, 0.14);
    },

    // pink-noise roar with a slow amplitude wobble + airy hiss on top
    flame(t) {
      const d = vr(0.5);
      const g = noiseHit(t, d, 'lowpass', [[0, 400], [0.1, vr(1000)], [d, 260]], 0.7,
        [[0, 0.001], [0.07, 0.5], [d * 0.7, 0.4], [d, 0.001]], { pink: true });
      if (g) { // wobble LFO summed into the roar's gain
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.setValueAtTime(rnd(5, 8), t);
        const lg = ctx.createGain();
        lg.gain.value = 0.12;
        lfo.connect(lg); lg.connect(g.gain);
        startSrc(lfo, t, d);
      }
      noiseHit(t, d, 'bandpass', [[0, 2400]], 1.5,
        [[0, 0.001], [0.12, 0.09], [d, 0.001]], { pink: true });
    },

    // descending saw kept synthetic, but tamed by a tracking lowpass + noise sizzle
    laser(t) {
      const f0 = vr(1900, 0.08);
      tone(t, 0.28, 'sawtooth', [[0, f0], [0.28, 170]],
        [[0, 0.001], [0.005, 0.24], [0.28, 0.001]],
        { filt: ['lowpass', 2, [[0, f0 * 2.2], [0.28, 320]]] });
      noiseHit(t, 0.26, 'highpass', [[0, 3400], [0.26, 700]], 1,
        [[0, 0.001], [0.004, 0.13], [0.26, 0.001]]);
      thump(t, 300, 90, 0.12, 0.1);
    },

    // rising sine ~1.5s with tremolo + rising static shimmer (obelisk power-up)
    obeliskCharge(t) {
      const g = tone(t, 1.5, 'sine', [[0, 170], [1.4, 880]],
        [[0, 0.02], [1.15, 0.24], [1.5, 0.001]]);
      if (g) { // tremolo LFO summed into the gain param
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.setValueAtTime(7, t);
        lfo.frequency.linearRampToValueAtTime(19, t + 1.5);
        const lg = ctx.createGain();
        lg.gain.value = 0.09;
        lfo.connect(lg); lg.connect(g.gain);
        startSrc(lfo, t, 1.5);
      }
      noiseHit(t, 1.5, 'bandpass', [[0, 500], [1.4, 3300]], 3,
        [[0, 0.001], [0.9, 0.06], [1.5, 0.001]]);
    },

    // small explosion: pure shaped noise + sub thump, no audible oscillator tone
    expS(t) {
      const d = vr(0.4);
      snap(t, 900, 0.3);
      noiseHit(t, d, 'lowpass', [[0, vr(2400)], [d, 130]], 1,
        [[0, 0.001], [0.006, 0.44], [d, 0.001]], { pink: true, send: 0.25 });
      thump(t, vr(110), 36, d * 0.8, 0.4);
    },

    // big explosion: snap, long pink body, deep sub drop, mid debris band + echo tap
    expL(t) {
      const d = vr(0.9);
      snap(t, 700, 0.35);
      noiseHit(t, d, 'lowpass', [[0, vr(2000)], [d, 75]], 1,
        [[0, 0.001], [0.008, 0.54], [d, 0.001]], { pink: true, send: 0.5 });
      thump(t, vr(85), 26, d * 0.85, 0.55, 0.3);
      noiseHit(t + 0.04, d * 0.7, 'bandpass', [[0, vr(750)], [d * 0.7, 190]], 1.4,
        [[0, 0.001], [0.02, 0.2], [d * 0.7, 0.001]]);
    },

    // infantry death: a soft body-drop thud + a very short downward vocal
    // groan + a tiny gear/dogtag rattle. Tasteful, not gory — distinct from
    // both weapon-impact sounds and the wet crush/squish cue.
    infDeath(t) {
      const d = vr(0.22);
      noiseHit(t, d, 'lowpass', [[0, vr(500)], [d, 110]], 1,
        [[0, 0.001], [0.008, 0.22], [d, 0.001]]);
      thump(t, vr(190), 70, 0.16, 0.16);
      // short breathy groan: a brief formant-ish downward tone, not a beep
      tone(t + 0.02, 0.16, 'triangle', [[0, vr(240, 0.15)], [0.16, 120]],
        [[0, 0.001], [0.015, 0.1], [0.16, 0.001]],
        { filt: ['lowpass', 1, [[0, 900]]] });
      noiseHit(t + 0.05, 0.05, 'highpass', [[0, 4200]], 4,
        [[0, 0.001], [0.004, 0.05], [0.05, 0.001]]); // gear rattle
    },

    // vehicle destroyed: expL's boom plus a metallic ping (shrapnel) and a
    // delayed smaller cook-off pop — reads as "wreck," not just "hit."
    vehDeath(t) {
      SFX.expL(t);
      const f = vr(1900, 0.1);
      tone(t + 0.03, 0.3, 'triangle', [[0, f], [0.3, f * 0.4]],
        [[0, 0.001], [0.006, 0.1], [0.3, 0.001]],
        { filt: ['bandpass', 3, [[0, f]]] });
      tone(t + 0.05, 0.22, 'triangle', [[0, f * 1.4], [0.22, f * 0.5]],
        [[0, 0.001], [0.006, 0.06], [0.22, 0.001]],
        { filt: ['bandpass', 3, [[0, f * 1.4]]] });
      const ct = t + rnd(0.16, 0.26); // secondary ammo cook-off
      snap(ct, 1000, 0.22);
      noiseHit(ct, 0.3, 'lowpass', [[0, vr(1600)], [0.3, 100]], 1,
        [[0, 0.001], [0.006, 0.3], [0.3, 0.001]], { pink: true, send: 0.3 });
      thump(ct, vr(90), 32, 0.26, 0.32);
    },

    // 2s air-raid wail: two detuned saws behind a lowpass + faint breath
    nukeSiren(t) {
      const dets = [0, 5];
      for (let i = 0; i < dets.length; i++) {
        const det = dets[i];
        tone(t, 2.1, 'sawtooth',
          [[0, 520 + det], [0.5, 980 + det], [1.0, 560 + det], [1.5, 980 + det], [2.1, 540 + det]],
          [[0, 0.001], [0.15, 0.13], [1.85, 0.11], [2.1, 0.001]],
          { filt: ['lowpass', 1, [[0, 2400]]] });
      }
      noiseHit(t, 2.1, 'lowpass', [[0, 900]], 1,
        [[0, 0.001], [0.3, 0.04], [2.1, 0.001]], { pink: true });
    },

    // huge low boom: crack, big sub drop to 22Hz, pink blast body + long rumble, echo
    nukeBoom(t) {
      snap(t, 500, 0.4);
      thump(t, 68, 22, 1.3, 0.65, 0.6);
      noiseHit(t, 0.3, 'lowpass', [[0, 1300], [0.3, 250]], 1,
        [[0, 0.001], [0.01, 0.5], [0.3, 0.001]], { pink: true, send: 0.6 });
      noiseHit(t, 2.8, 'lowpass', [[0, 420], [2.8, 45]], 1,
        [[0, 0.001], [0.05, 0.42], [1.8, 0.15], [2.8, 0.001]], { pink: true });
    },

    // airy high shimmer ~1s (orbital lance spin-up)
    ionHum(t) {
      tone(t, 1.0, 'sine', [[0, 1244], [1.0, 1350]], [[0, 0.001], [0.3, 0.09], [1.0, 0.001]]);
      tone(t, 1.0, 'sine', [[0, 1866], [1.0, 1780]], [[0, 0.001], [0.3, 0.06], [1.0, 0.001]]);
      noiseHit(t, 1.0, 'highpass', [[0, 3800], [1.0, 6500]], 1,
        [[0, 0.001], [0.45, 0.07], [1.0, 0.001]]);
    },

    // sky-crack + boom (ion strike): bright transient, then sub + pink body with echo
    ionBlast(t) {
      snap(t, 2600, 0.4);
      noiseHit(t, 0.1, 'highpass', [[0, 2200], [0.1, 900]], 1,
        [[0, 0.001], [0.003, 0.38], [0.1, 0.001]], { send: 0.4 });
      thump(t + 0.04, 220, 44, 0.5, 0.5, 0.4);
      noiseHit(t + 0.04, 0.7, 'lowpass', [[0, 1500], [0.7, 100]], 1,
        [[0, 0.001], [0.01, 0.38], [0.7, 0.001]], { pink: true });
    },

    // short crystal crunch (harvester intake)
    harvest(t) {
      noiseHit(t, 0.09, 'bandpass', [[0, vr(3200)], [0.09, 1700]], 3,
        [[0, 0.001], [0.005, 0.32], [0.09, 0.001]]);
      tone(t + 0.02, 0.06, 'triangle', [[0, vr(2100, 0.06)]], [[0, 0.001], [0.006, 0.08], [0.06, 0.001]]);
      tone(t + 0.05, 0.06, 'triangle', [[0, vr(2700, 0.06)]], [[0, 0.001], [0.006, 0.07], [0.06, 0.001]]);
    },

    // two soft ascending blips
    radarOn(t) {
      tone(t, 0.07, 'triangle', [[0, 740]], [[0, 0.001], [0.007, 0.09], [0.07, 0.001]]);
      tone(t + 0.1, 0.09, 'triangle', [[0, 1080]], [[0, 0.001], [0.007, 0.09], [0.09, 0.001]]);
    },

    // two soft descending blips
    radarOff(t) {
      tone(t, 0.07, 'triangle', [[0, 1080]], [[0, 0.001], [0.007, 0.09], [0.07, 0.001]]);
      tone(t + 0.1, 0.09, 'triangle', [[0, 700]], [[0, 0.001], [0.007, 0.09], [0.09, 0.001]]);
    },

    // gentle two-tone ding
    ready(t) {
      tone(t, 0.22, 'sine', [[0, 880]], [[0, 0.001], [0.01, 0.13], [0.22, 0.001]]);
      tone(t + 0.11, 0.3, 'sine', [[0, 1318]], [[0, 0.001], [0.01, 0.13], [0.3, 0.001]]);
    },

    // soft register cha-ching
    cashUp(t) {
      noiseHit(t, 0.03, 'highpass', [[0, 3000]], 1, [[0, 0.001], [0.003, 0.09], [0.03, 0.001]]);
      tone(t + 0.02, 0.12, 'sine', [[0, 1320]], [[0, 0.001], [0.008, 0.11], [0.12, 0.001]]);
      tone(t + 0.08, 0.18, 'sine', [[0, 1760]], [[0, 0.001], [0.008, 0.11], [0.18, 0.001]]);
    },
  };

  // soft 40ms filtered-noise radio tick that precedes every EVA line
  function staticBlip(t) {
    noiseHit(t, 0.04, 'bandpass', [[0, 1700], [0.04, 1100]], 1,
      [[0, 0.001], [0.004, 0.08], [0.04, 0.001]]);
  }

  // ---- synthesized comms voice (EVA announcer + unit chatter) ------------------
  // A glottal buzz (two detuned sawtooths) driven through parallel bandpass
  // "formant" filters that step between vowel shapes per syllable, gated by a
  // per-syllable amplitude envelope and band-limited like a radio. It doesn't
  // pronounce words — it reads as an in-universe comms voice talking, and the
  // real message is shown on the HUD. Fully deterministic across browsers.

  // [F1, F2] formant pairs for a spread of vowels (a, i, u, e, o, schwa)
  const VOWELS = [[730, 1090], [270, 2290], [300, 870], [530, 1840], [570, 840], [500, 1500]];

  // rough syllable count of a phrase → clamped burst count
  function sylCount(text) {
    const m = String(text).toLowerCase().replace(/[^a-z ]/g, '').match(/[aeiouy]+/g);
    const n = m ? m.length : Math.max(2, Math.round(String(text).length / 3));
    return n < 2 ? 2 : n > 8 ? 8 : n;
  }

  // Build one spoken "transmission". base = glottal pitch Hz; formScale sizes
  // the vocal tract (>1 brighter/smaller = EVA computer, <1 gruffer = trooper).
  function voxTransmission(t0, syl, base, formScale, gain, sylDur) {
    if (!ctx || activeVoices >= MAX_VOICES) return;
    const dur = syl * sylDur + 0.05;

    // voiced source: two slightly detuned sawtooths for a buzzy glottal tone
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth';
    // pitch contour: a small step per syllable, trending gently downward so it
    // lands like a spoken statement rather than a flat drone
    const fp = [[0, base]];
    for (let i = 0; i < syl; i++) {
      const frac = syl > 1 ? i / (syl - 1) : 0;
      const p = base * (1 + (Math.random() * 2 - 1) * 0.05 - frac * 0.13);
      fp.push([i * sylDur + 0.02, p]);
      fp.push([i * sylDur + sylDur * 0.9, p * (1 + (Math.random() * 2 - 1) * 0.03)]);
    }
    curve(o1.frequency, t0, fp);
    curve(o2.frequency, t0, fp.map(function (p) { return [p[0], p[1] * 1.007]; }));

    const srcGain = ctx.createGain(); srcGain.gain.value = 0.5;
    o1.connect(srcGain); o2.connect(srcGain);

    // three parallel formants; each steps to a fresh vowel each syllable
    const sum = ctx.createGain(); sum.gain.value = 1;
    const fAmp = [1.0, 0.7, 0.32];
    for (let k = 0; k < 3; k++) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 6 + k * 3;
      const ffp = [];
      for (let i = 0; i < syl; i++) {
        const v = VOWELS[(Math.random() * VOWELS.length) | 0];
        const f = (k < 2 ? v[k] : v[1] * 1.8) * formScale;
        ffp.push([i * sylDur + 0.006, f]);
        ffp.push([i * sylDur + sylDur * 0.85, f]);
      }
      if (!ffp.length) ffp.push([0, 700 * formScale]);
      curve(bp.frequency, t0, ffp);
      const fg = ctx.createGain(); fg.gain.value = fAmp[k];
      srcGain.connect(bp); bp.connect(fg); fg.connect(sum);
    }

    // per-syllable amplitude envelope: attack, hold, dip between syllables
    const env = ctx.createGain();
    const ep = [[0, 0.0001]];
    for (let i = 0; i < syl; i++) {
      const s = i * sylDur;
      ep.push([s + 0.015, gain]);
      ep.push([s + sylDur * 0.68, gain * 0.82]);
      ep.push([s + sylDur * 0.97, gain * 0.14]);
    }
    ep.push([dur, 0.0001]);
    curve(env.gain, t0, ep);
    sum.connect(env);

    // radio band-limit
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass'; bandpass.frequency.value = 1500; bandpass.Q.value = 0.7;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 340;
    env.connect(bandpass); bandpass.connect(hp); hp.connect(voxBus || master);

    startSrc(o1, t0, dur); startSrc(o2, t0, dur);

    // faint consonant transients at some syllable onsets (plosive/fricative feel)
    for (let i = 0; i < syl; i++) {
      if (Math.random() < 0.55) {
        noiseHit(t0 + i * sylDur, 0.028, 'bandpass', [[0, vr(2200)], [0.028, 1400]], 2,
          [[0, 0.001], [0.004, gain * 0.35], [0.028, 0.001]]);
      }
    }
  }

  function pumpEva() {
    if (evaBusy || evaQueue.length === 0) return;
    if (!audioReady() || !voiceEnabled) { evaQueue.length = 0; evaBusy = false; return; }
    evaBusy = true;
    const text = evaQueue.shift();
    const t = ctx.currentTime;
    try {
      staticBlip(t);
      const syl = sylCount(text);
      const sylDur = 0.135;
      voxTransmission(t + 0.09, syl, vr(212, 0.05), 1.14, 0.13, sylDur); // EVA: high, bright
      staticBlip(t + 0.09 + syl * sylDur + 0.02);                        // close squelch
      const ms = (0.09 + syl * sylDur + 0.16) * 1000;
      if (evaTimer) clearTimeout(evaTimer);
      evaTimer = setTimeout(function () { evaBusy = false; pumpEva(); }, ms + 90);
    } catch (e) {
      evaBusy = false;
    }
  }

  // short unit-chatter blip: a 1-2 syllable transmission, gruffer than EVA and
  // pitched by unit class (infantry higher, vehicle crews lower)
  function voxAck(cls) {
    if (!audioReady() || !voiceEnabled) return;
    const t = ctx.currentTime;
    const base = cls === 'inf' ? vr(150, 0.06) : cls === 'air' ? vr(172, 0.06) : vr(122, 0.06);
    const form = cls === 'inf' ? 1.02 : cls === 'air' ? 1.0 : 0.9;
    voxTransmission(t + 0.02, 1 + ((Math.random() * 2) | 0), base, form, 0.1, 0.12);
  }

  // ---- public API ---------------------------------------------------------------

  function init() {
    // must be called from a user gesture so the context is allowed to run
    try {
      if (!ctx && typeof window !== 'undefined') {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) {
          ctx = new AC();
          master = ctx.createGain();
          // gentle master lowpass takes the digital edge off every voice
          const lp = ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = MASTER_LP_HZ;
          lp.Q.value = 0.4;
          master.connect(lp);
          lp.connect(ctx.destination);
          voxBus = ctx.createGain();
          voxBus.connect(lp);
          _applyGains();
          // shared short echo tap: big booms send here for a sense of size
          echoIn = ctx.createGain();
          echoIn.gain.value = 1;
          const dly = ctx.createDelay(0.6);
          dly.delayTime.value = 0.17;
          const damp = ctx.createBiquadFilter();
          damp.type = 'lowpass';
          damp.frequency.value = 1400;
          const fb = ctx.createGain();
          fb.gain.value = 0.3;
          const echoOut = ctx.createGain();
          echoOut.gain.value = 0.55;
          echoIn.connect(dly);
          dly.connect(damp);
          damp.connect(fb); fb.connect(dly);   // feedback loop (decays fast)
          damp.connect(echoOut); echoOut.connect(master);
        }
      }
      if (ctx && ctx.state === 'suspended') {
        const p = ctx.resume();
        if (p && p.catch) p.catch(noop);
      }
    } catch (e) {
      ctx = null; master = null; echoIn = null; voxBus = null;
    }
    inited = true;
  }

  // one place computes every bus level from the enabled flags + sliders
  function _applyGains() {
    if (master) { try { master.gain.value = enabled ? MASTER_GAIN * sfxVol : 0; } catch (e) {} }
    // voice baseline matches MASTER_GAIN so routing around master is loudness-neutral
    if (voxBus) { try { voxBus.gain.value = enabled && voiceEnabled ? MASTER_GAIN * voxVol : 0; } catch (e) {} }
  }

  function _stopVoice() {
    evaQueue.length = 0;
    if (evaTimer) { clearTimeout(evaTimer); evaTimer = 0; }
    evaBusy = false;
  }

  function setEnabled(b) {
    enabled = !!b;
    _applyGains(); // mute/unmute in-flight sounds immediately
    if (!enabled) _stopVoice();
  }

  function setVoiceEnabled(b) {
    voiceEnabled = !!b;
    _applyGains();
    if (!voiceEnabled) _stopVoice();
  }

  // volume sliders: v is a 0..2 multiplier (1 = designed level)
  function setVolume(v) {
    sfxVol = Math.max(0, Math.min(2, +v || 0));
    _applyGains();
  }
  function setVoiceVolume(v) {
    voxVol = Math.max(0, Math.min(2, +v || 0));
    _applyGains();
  }

  function play(name) {
    if (!audioReady()) return;
    const fn = SFX[name];
    if (!fn) return; // unknown name = silent no-op
    if (name === 'tick') {
      const n = nowMs();
      if (n - lastTickAt < TICK_MIN_MS) return;
      lastTickAt = n;
    }
    try {
      if (ctx.state === 'suspended') {
        const p = ctx.resume();
        if (p && p.catch) p.catch(noop);
      }
      fn(ctx.currentTime);
    } catch (e) {}
  }

  function eva(key) {
    // AI-vs-AI spectate: the announcer would narrate a fight that isn't the
    // player's — banner spam for every skirmish between the bots. Quiet her.
    if (typeof game !== 'undefined' && game && game._spectate) return;
    const text = (typeof DATA !== 'undefined' && DATA && DATA.eva) ? DATA.eva[key] : null;
    if (!text) return;
    evaText(text);
  }

  // mission scripting speaks in full sentences, not DATA.eva keys — same
  // banner + voice path, arbitrary text
  function evaText(text) {
    if (!text) return;
    // surface the message on the HUD regardless of audio settings — the words
    // live in the banner, the voice is just flavor
    if (typeof EV !== 'undefined' && EV) EV.emit('eva', String(text));
    if (!enabled || !inited || !voiceEnabled) return;
    if (evaQueue.length >= EVA_QUEUE_MAX) return; // drop when badly backlogged
    evaQueue.push(String(text));
    pumpEva();
  }

  // short PTT radio squelch: the tactile "order received" click-hiss.
  // Reads as comms chatter without leaning on synthetic speech.
  let lastSquelchAt = -1e9;
  function squelch() {
    if (!audioReady()) return;
    const n = nowMs();
    if (n - lastSquelchAt < 220) return;
    lastSquelchAt = n;
    const t = ctx.currentTime;
    noiseHit(t, 0.03, 'bandpass', [[0, 2100], [0.03, 1600]], 2,
      [[0, 0.001], [0.004, 0.16], [0.03, 0.001]]);
    noiseHit(t + 0.045, 0.05, 'bandpass', [[0, vr(1700)], [0.05, 1100]], 1.6,
      [[0, 0.001], [0.006, 0.11], [0.05, 0.001]]);
    tone(t + 0.045, 0.04, 'sine', [[0, vr(1250, 0.06)], [0.04, 1150]],
      [[0, 0.001], [0.008, 0.05], [0.04, 0.001]]);
  }

  function ack(kind, cls) {
    if (!enabled || !inited) return;
    // move/attack orders lead with a radio squelch every time
    if (kind !== 'select') squelch();
    if (!voiceEnabled) return;
    if (evaBusy) return;                    // don't talk over an EVA announcement
    const n = nowMs();
    if (n - lastAckAt < ACK_MIN_MS) return; // throttle: drop extras
    // selection always gets a short chatter blip; move/attack only sometimes,
    // so the squelch (always present) carries the feedback and the voice accents it
    if (kind !== 'select' && Math.random() > 0.45) return;
    lastAckAt = n;
    voxAck(cls);
  }

  function tickCredits() { play('tick'); }

  return {
    get enabled() { return enabled; },
    set enabled(v) { setEnabled(v); },
    get voiceEnabled() { return voiceEnabled; },
    init: init,
    setEnabled: setEnabled,
    setVoiceEnabled: setVoiceEnabled,
    setVolume: setVolume,
    setVoiceVolume: setVoiceVolume,
    play: play,
    eva: eva,
    evaText: evaText,
    ack: ack,
    tickCredits: tickCredits,
  };
})();
