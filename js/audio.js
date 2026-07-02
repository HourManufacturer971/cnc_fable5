'use strict';
// audio.js — the AUDIO global: fully synthesized WebAudio SFX + speech-synthesis EVA.
// Everything is built at play time from oscillators and looping noise buffers — no samples.
// Every public function is a safe no-op when disabled, before init(), or when
// WebAudio / speechSynthesis are unavailable. Audio is cosmetic, so Math.random() is fine.

const AUDIO = (function () {
  const MASTER_GAIN = 0.35;
  const MAX_VOICES = 12;      // cap on simultaneously sounding source nodes
  const TICK_MIN_MS = 30;     // credit-counter tick rate limit
  const ACK_MIN_MS = 1000;    // at most one voice acknowledgment per second

  let ctx = null;             // AudioContext, created lazily by init()
  let master = null;          // master gain
  let inited = false;
  let enabled = true;
  let activeVoices = 0;
  let noiseBuf = null;        // shared 1s white-noise buffer
  let lastTickAt = -1e9;
  let lastAckAt = -1e9;

  // EVA / speech state
  let evaVoice = null;        // preferred English female voice
  let ackVoice = null;        // distinct voice for unit acks when available
  const evaQueue = [];        // pending EVA line texts
  const EVA_QUEUE_MAX = 5;    // drop new lines when badly backlogged
  let evaBusy = false;        // an EVA line is being delivered (blip -> speech -> end)
  let evaTimer = 0;           // fallback timeout handle
  let evaUtter = null;        // live refs so Chrome can't GC utterances before 'end'
  let ackUtter = null;

  function noop() {}
  function nowMs() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  function hasSpeech() {
    return typeof window !== 'undefined' &&
           'speechSynthesis' in window &&
           typeof window.SpeechSynthesisUtterance === 'function';
  }

  function audioReady() { return enabled && inited && !!ctx && !!master; }

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

  // Schedule a piecewise curve on an AudioParam. pts = [[dtSeconds, value], ...].
  // First point is set, the rest ramp exponentially (floored so expo ramps are legal).
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

  // Oscillator voice: fPts / vPts are [[dt, hz], ...] / [[dt, gain], ...] curves.
  // Returns the gain node (for extra modulation) or null when at the voice cap.
  function tone(t0, dur, type, fPts, vPts) {
    if (activeVoices >= MAX_VOICES) return null;
    const o = ctx.createOscillator();
    o.type = type;
    curve(o.frequency, t0, fPts);
    const g = ctx.createGain();
    curve(g.gain, t0, vPts);
    o.connect(g); g.connect(master);
    startSrc(o, t0, dur);
    return g;
  }

  // Filtered-noise voice. filtType null = raw noise. fPts drives the filter frequency.
  function noiseHit(t0, dur, filtType, fPts, q, vPts) {
    if (activeVoices >= MAX_VOICES) return null;
    const s = ctx.createBufferSource();
    s.buffer = getNoise();
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
    head.connect(g); g.connect(master);
    startSrc(s, t0, dur, Math.random() * 0.5);
    return g;
  }

  // ---- SFX library -------------------------------------------------------------
  // Each entry builds a short graph with sharp envelopes at time t (ctx.currentTime).

  const SFX = {
    // short UI blip
    click(t) {
      tone(t, 0.05, 'square', [[0, 1150], [0.05, 750]], [[0, 0.001], [0.004, 0.22], [0.05, 0.001]]);
    },

    // error: low dissonant square pair
    buzz(t) {
      tone(t, 0.22, 'square', [[0, 110]], [[0, 0.001], [0.01, 0.18], [0.16, 0.14], [0.22, 0.001]]);
      tone(t, 0.22, 'square', [[0, 149]], [[0, 0.001], [0.01, 0.13], [0.22, 0.001]]);
    },

    // one credit-counter tick: very short high click
    tick(t) {
      tone(t, 0.022, 'square', [[0, 2450]], [[0, 0.13], [0.022, 0.001]]);
    },

    // heavy metallic thunk + clank
    place(t) {
      tone(t, 0.18, 'sine', [[0, 145], [0.15, 44]], [[0, 0.5], [0.18, 0.001]]);
      noiseHit(t, 0.1, 'lowpass', [[0, 900], [0.1, 200]], 1, [[0, 0.32], [0.1, 0.001]]);
      // inharmonic clank a beat later
      tone(t + 0.1, 0.12, 'square', [[0, 623]], [[0, 0.11], [0.12, 0.001]]);
      tone(t + 0.1, 0.14, 'square', [[0, 941]], [[0, 0.09], [0.14, 0.001]]);
      tone(t + 0.1, 0.1, 'triangle', [[0, 1560]], [[0, 0.11], [0.1, 0.001]]);
    },

    // reverse-ish rising zip + coin pings
    sell(t) {
      tone(t, 0.3, 'sawtooth', [[0, 180], [0.3, 1500]], [[0, 0.03], [0.24, 0.2], [0.3, 0.001]]);
      for (let i = 0; i < 4; i++) {
        const tt = t + 0.28 + i * 0.05 + Math.random() * 0.02;
        tone(tt, 0.06, 'sine', [[0, 1800 + Math.random() * 900]], [[0, 0.16], [0.06, 0.001]]);
      }
    },

    // short ratchet: rapid filtered clicks
    repair(t) {
      for (let i = 0; i < 4; i++) {
        noiseHit(t + i * 0.05, 0.022, 'bandpass', [[0, 2200]], 6, [[0, 0.24], [0.022, 0.001]]);
      }
    },

    // wet low thump (tank squishing infantry)
    crush(t) {
      noiseHit(t, 0.2, 'lowpass', [[0, 500], [0.2, 90]], 1, [[0, 0.38], [0.2, 0.001]]);
      tone(t, 0.16, 'sine', [[0, 100], [0.14, 34]], [[0, 0.34], [0.16, 0.001]]);
      noiseHit(t + 0.02, 0.1, 'bandpass', [[0, 900], [0.1, 400]], 1, [[0, 0.14], [0.1, 0.001]]);
    },
    squish(t) { SFX.crush(t); },

    // 3-4 rapid noise-burst shots
    mgun(t) {
      for (let i = 0; i < 4; i++) {
        const tt = t + i * 0.055;
        noiseHit(tt, 0.045, 'bandpass', [[0, 1500], [0.045, 600]], 1.2, [[0, 0.28], [0.045, 0.001]]);
      }
      tone(t, 0.05, 'square', [[0, 210], [0.05, 90]], [[0, 0.1], [0.05, 0.001]]);
    },

    // single crack
    pistol(t) {
      noiseHit(t, 0.07, 'highpass', [[0, 900]], 1, [[0, 0.33], [0.07, 0.001]]);
      tone(t, 0.06, 'square', [[0, 250], [0.06, 80]], [[0, 0.14], [0.06, 0.001]]);
    },

    // deep boom with noise tail
    cannon(t) {
      tone(t, 0.35, 'sine', [[0, 160], [0.3, 40]], [[0, 0.5], [0.35, 0.001]]);
      noiseHit(t, 0.45, 'lowpass', [[0, 1400], [0.45, 120]], 1, [[0, 0.38], [0.45, 0.001]]);
    },

    // whoosh: filtered noise sweep up then down
    rocket(t) {
      noiseHit(t, 0.5, 'bandpass', [[0, 300], [0.2, 1900], [0.5, 350]], 2,
        [[0, 0.001], [0.05, 0.3], [0.35, 0.24], [0.5, 0.001]]);
      tone(t, 0.35, 'sawtooth', [[0, 140], [0.35, 60]], [[0, 0.001], [0.05, 0.06], [0.35, 0.001]]);
    },

    // breathy noise roar ~0.4s
    flame(t) {
      noiseHit(t, 0.42, 'lowpass', [[0, 500], [0.15, 1000], [0.42, 300]], 0.8,
        [[0, 0.02], [0.08, 0.3], [0.3, 0.23], [0.42, 0.001]]);
      noiseHit(t, 0.4, 'bandpass', [[0, 2600]], 2, [[0, 0.001], [0.1, 0.07], [0.4, 0.001]]);
    },

    // descending zap saw
    laser(t) {
      tone(t, 0.28, 'sawtooth', [[0, 1900], [0.28, 180]], [[0, 0.001], [0.006, 0.26], [0.28, 0.001]]);
      tone(t, 0.2, 'square', [[0, 950], [0.2, 120]], [[0, 0.11], [0.2, 0.001]]);
    },

    // rising sine ~1.5s with tremolo (obelisk power-up)
    obeliskCharge(t) {
      const g = tone(t, 1.5, 'sine', [[0, 170], [1.4, 880]],
        [[0, 0.02], [1.15, 0.28], [1.5, 0.001]]);
      if (g) {
        // tremolo LFO summed into the gain param
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.setValueAtTime(7, t);
        lfo.frequency.linearRampToValueAtTime(19, t + 1.5);
        const lg = ctx.createGain();
        lg.gain.value = 0.11;
        lfo.connect(lg); lg.connect(g.gain);
        startSrc(lfo, t, 1.5);
      }
    },

    // short explosion: noise burst + low sine drop
    expS(t) {
      noiseHit(t, 0.35, 'lowpass', [[0, 2200], [0.35, 150]], 1, [[0, 0.42], [0.35, 0.001]]);
      tone(t, 0.3, 'sine', [[0, 130], [0.28, 35]], [[0, 0.42], [0.3, 0.001]]);
    },

    // bigger, longer explosion
    expL(t) {
      noiseHit(t, 0.8, 'lowpass', [[0, 2000], [0.8, 90]], 1, [[0, 0.52], [0.8, 0.001]]);
      tone(t, 0.7, 'sine', [[0, 110], [0.6, 28]], [[0, 0.52], [0.7, 0.001]]);
      noiseHit(t + 0.05, 0.5, 'bandpass', [[0, 900], [0.5, 250]], 1.5, [[0, 0.22], [0.5, 0.001]]);
    },

    // 2s wailing siren (two detuned saws sweeping up/down)
    nukeSiren(t) {
      for (const det of [0, 4]) {
        tone(t, 2.1, 'sawtooth',
          [[0, 520 + det], [0.5, 980 + det], [1.0, 560 + det], [1.5, 980 + det], [2.1, 540 + det]],
          [[0, 0.001], [0.15, 0.15], [1.85, 0.13], [2.1, 0.001]]);
      }
    },

    // huge low boom + long rumble
    nukeBoom(t) {
      tone(t, 1.4, 'sine', [[0, 70], [1.2, 24]], [[0, 0.65], [1.4, 0.001]]);
      noiseHit(t, 0.25, 'lowpass', [[0, 1200], [0.25, 300]], 1, [[0, 0.48], [0.25, 0.001]]);
      noiseHit(t, 2.6, 'lowpass', [[0, 400], [2.6, 50]], 1,
        [[0, 0.4], [1.7, 0.16], [2.6, 0.001]]);
    },

    // airy high shimmer ~1s (ion cannon spin-up)
    ionHum(t) {
      tone(t, 1.0, 'sine', [[0, 1244], [1.0, 1310]], [[0, 0.001], [0.3, 0.11], [1.0, 0.001]]);
      tone(t, 1.0, 'sine', [[0, 1866], [1.0, 1800]], [[0, 0.001], [0.3, 0.07], [1.0, 0.001]]);
      noiseHit(t, 1.0, 'highpass', [[0, 4200]], 1, [[0, 0.001], [0.4, 0.05], [1.0, 0.001]]);
    },

    // bright crack + boom (ion strike)
    ionBlast(t) {
      noiseHit(t, 0.08, 'highpass', [[0, 2500]], 1, [[0, 0.42], [0.08, 0.001]]);
      tone(t + 0.05, 0.5, 'sine', [[0, 240], [0.45, 50]], [[0, 0.48], [0.5, 0.001]]);
      noiseHit(t + 0.05, 0.6, 'lowpass', [[0, 1500], [0.6, 120]], 1, [[0, 0.38], [0.6, 0.001]]);
    },

    // short crystal crunch
    harvest(t) {
      noiseHit(t, 0.09, 'bandpass', [[0, 3200], [0.09, 1700]], 3, [[0, 0.2], [0.09, 0.001]]);
      tone(t + 0.02, 0.06, 'triangle', [[0, 2100]], [[0, 0.09], [0.06, 0.001]]);
      tone(t + 0.05, 0.06, 'triangle', [[0, 2700]], [[0, 0.07], [0.06, 0.001]]);
    },

    // two ascending beeps
    radarOn(t) {
      tone(t, 0.09, 'square', [[0, 740]], [[0, 0.001], [0.006, 0.14], [0.09, 0.001]]);
      tone(t + 0.12, 0.1, 'square', [[0, 1080]], [[0, 0.001], [0.006, 0.14], [0.1, 0.001]]);
    },

    // two descending beeps
    radarOff(t) {
      tone(t, 0.09, 'square', [[0, 1080]], [[0, 0.001], [0.006, 0.14], [0.09, 0.001]]);
      tone(t + 0.12, 0.1, 'square', [[0, 700]], [[0, 0.001], [0.006, 0.14], [0.1, 0.001]]);
    },

    // pleasant two-tone ding
    ready(t) {
      tone(t, 0.25, 'sine', [[0, 880]], [[0, 0.001], [0.008, 0.22], [0.25, 0.001]]);
      tone(t + 0.12, 0.35, 'sine', [[0, 1318]], [[0, 0.001], [0.008, 0.22], [0.35, 0.001]]);
    },

    // soft register cha-ching
    cashUp(t) {
      noiseHit(t, 0.03, 'highpass', [[0, 3000]], 1, [[0, 0.11], [0.03, 0.001]]);
      tone(t + 0.02, 0.12, 'sine', [[0, 1320]], [[0, 0.001], [0.008, 0.14], [0.12, 0.001]]);
      tone(t + 0.08, 0.18, 'sine', [[0, 1760]], [[0, 0.001], [0.008, 0.14], [0.18, 0.001]]);
    },
  };

  // radio-static blip that precedes every EVA line (60ms noise burst)
  function staticBlip(t) {
    noiseHit(t, 0.06, 'bandpass', [[0, 1800], [0.06, 1200]], 0.8,
      [[0, 0.22], [0.04, 0.13], [0.06, 0.001]]);
  }

  // ---- speech (EVA + acks) ----------------------------------------------------

  function pickVoices() {
    try {
      const vs = window.speechSynthesis.getVoices();
      if (!vs || !vs.length) return;
      const en = vs.filter(function (v) { return /^en/i.test(v.lang || ''); });
      const pool = en.length ? en : vs;
      const femaleRe = /female|woman|zira|hazel|susan|samantha|karen|moira|tessa|fiona|serena|victoria|allison|ava|joanna|salli|kendra|kimberly|amy|emma|aria|jenny|libby|sonia|michelle|natasha|catherine|nicky|kathy/i;
      evaVoice = pool.find(function (v) { return femaleRe.test(v.name || ''); }) ||
                 pool.find(function (v) { return v.default; }) || pool[0] || null;
      const maleRe = /\bmale\b|\bman\b|david|mark|daniel|alex|fred|george|guy|ryan|thomas|james|matthew|russell|brian|aaron|arthur/i;
      ackVoice = pool.find(function (v) {
        return maleRe.test(v.name || '') && !femaleRe.test(v.name || '');
      }) || evaVoice;
    } catch (e) { /* voices stay null; utterances use the browser default */ }
  }

  function evaDone() {
    if (evaTimer) { clearTimeout(evaTimer); evaTimer = 0; }
    evaUtter = null;
    evaBusy = false;
    pumpEva();
  }

  function speakEva(text) {
    if (!enabled || !hasSpeech()) { evaQueue.length = 0; evaBusy = false; return; }
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05; u.pitch = 0.8; u.volume = 0.9;
      if (evaVoice) u.voice = evaVoice;
      let finished = false;
      const done = function () {
        if (finished) return;
        finished = true;
        evaDone();
      };
      u.onend = done;
      u.onerror = done;
      evaUtter = u;
      // timeout fallback in case 'end' never fires; re-arm while still speaking
      let retries = 0;
      const fallback = function () {
        let stillSpeaking = false;
        try { stillSpeaking = window.speechSynthesis.speaking; } catch (e) {}
        if (stillSpeaking && retries < 4) {
          retries++;
          evaTimer = setTimeout(fallback, 1000);
          return;
        }
        done();
      };
      evaTimer = setTimeout(fallback, 1500 + text.length * 90);
      try { window.speechSynthesis.resume(); } catch (e) {}
      window.speechSynthesis.speak(u);
    } catch (e) {
      evaDone(); // keep the queue draining even if speak() blows up
    }
  }

  function pumpEva() {
    if (evaBusy || evaQueue.length === 0) return;
    evaBusy = true;
    const text = evaQueue.shift();
    if (audioReady()) {
      try { staticBlip(ctx.currentTime); } catch (e) {}
    }
    setTimeout(function () { speakEva(text); }, 100); // let the blip lead in
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
          master.gain.value = enabled ? MASTER_GAIN : 0;
          master.connect(ctx.destination);
        }
      }
      if (ctx && ctx.state === 'suspended') {
        const p = ctx.resume();
        if (p && p.catch) p.catch(noop);
      }
    } catch (e) {
      ctx = null; master = null;
    }
    if (hasSpeech()) {
      try {
        pickVoices(); // often empty until voiceschanged fires
        if (typeof window.speechSynthesis.addEventListener === 'function') {
          window.speechSynthesis.addEventListener('voiceschanged', pickVoices);
        } else {
          window.speechSynthesis.onvoiceschanged = pickVoices;
        }
      } catch (e) {}
    }
    inited = true;
  }

  function setEnabled(b) {
    enabled = !!b;
    if (master) { // mute/unmute in-flight sounds immediately
      try { master.gain.value = enabled ? MASTER_GAIN : 0; } catch (e) {}
    }
    if (!enabled) {
      evaQueue.length = 0;
      if (evaTimer) { clearTimeout(evaTimer); evaTimer = 0; }
      evaBusy = false;
      evaUtter = null; ackUtter = null;
      if (hasSpeech()) {
        try { window.speechSynthesis.cancel(); } catch (e) {}
      }
    }
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
    if (!enabled || !inited || !hasSpeech()) return;
    const text = (typeof DATA !== 'undefined' && DATA && DATA.eva) ? DATA.eva[key] : null;
    if (!text) return;
    if (evaQueue.length >= EVA_QUEUE_MAX) return; // drop when badly backlogged
    evaQueue.push(text);
    pumpEva();
  }

  function ack(kind) {
    if (!enabled || !inited || !hasSpeech()) return;
    const lines = (typeof DATA !== 'undefined' && DATA && DATA.acks) ? DATA.acks[kind] : null;
    if (!lines || !lines.length) return;
    const n = nowMs();
    if (n - lastAckAt < ACK_MIN_MS) return; // throttle: drop extras
    if (evaBusy) return;                    // EVA mid-line: skip, never queue acks
    lastAckAt = n;
    try {
      const u = new SpeechSynthesisUtterance(lines[(Math.random() * lines.length) | 0]);
      u.pitch = 0.5; u.rate = 1.15; u.volume = 0.8;
      if (ackVoice) u.voice = ackVoice;
      u.onend = function () { if (ackUtter === u) ackUtter = null; };
      u.onerror = u.onend;
      ackUtter = u;
      try { window.speechSynthesis.resume(); } catch (e) {}
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  function tickCredits() { play('tick'); }

  return {
    get enabled() { return enabled; },
    set enabled(v) { setEnabled(v); },
    init: init,
    setEnabled: setEnabled,
    play: play,
    eva: eva,
    ack: ack,
    tickCredits: tickCredits,
  };
})();
