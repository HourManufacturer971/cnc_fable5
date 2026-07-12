'use strict';
// music.js — procedural soundtrack. Defines exactly one global: MUSIC.
// Eight original tracks composed for this project, synthesized live with
// WebAudio and sequenced on a lookahead clock: dark, driving electronic /
// industrial in the spirit of mid-90s RTS scores. All note data here is
// original. Mixed low and glued with a compressor so it sits under the SFX.
//
// MUSIC.start()            begin playback (creates the AudioContext lazily —
//                          call from a user-gesture handler)
// MUSIC.stop()             halt playback
// MUSIC.setEnabled(bool)   user toggle; persisted by main.js
// MUSIC.enabled            current toggle state

const MUSIC = (function () {
  let ctx = null, master = null, delaySend = null;
  let enabled = true, running = false;
  let timer = 0, nextTime = 0, step = 0, pos = 0, loops = 0, trackIdx = 0;
  let noiseBuf = null;

  const mf = m => 440 * Math.pow(2, (m - 69) / 12);   // midi -> Hz

  // ---- voices -----------------------------------------------------------------

  function _noise() {
    if (noiseBuf) return noiseBuf;
    const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBuf = b;
    return b;
  }

  function kick(t, acc) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.1);
    g.gain.setValueAtTime(acc ? 1.0 : 0.8, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + 0.18);
  }

  function snare(t) {
    const n = ctx.createBufferSource(); n.buffer = _noise();
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    n.connect(f).connect(g).connect(master);
    n.start(t, Math.random()); n.stop(t + 0.15);
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(210, t);
    o.frequency.exponentialRampToValueAtTime(130, t + 0.06);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.32, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(og).connect(master);
    o.start(t); o.stop(t + 0.1);
  }

  function hat(t, open) {
    const n = ctx.createBufferSource(); n.buffer = _noise();
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(open ? 0.22 : 0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (open ? 0.11 : 0.035));
    n.connect(f).connect(g).connect(master);
    n.start(t, Math.random()); n.stop(t + 0.13);
  }

  function tom(t, hz) {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(hz, t);
    o.frequency.exponentialRampToValueAtTime(hz * 0.55, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + 0.22);
  }

  function bass(t, midi, len) {
    const f0 = mf(midi);
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = f0;
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = f0 / 2;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 5;
    lp.frequency.setValueAtTime(1100, t);
    lp.frequency.exponentialRampToValueAtTime(320, t + Math.max(0.08, len * 0.7));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.34, t + 0.008);
    g.gain.setValueAtTime(0.34, t + len * 0.6);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    const g2 = ctx.createGain(); g2.gain.value = 0.5;
    o1.connect(lp);
    o2.connect(g2).connect(lp);
    lp.connect(g).connect(master);
    o1.start(t); o1.stop(t + len + 0.02);
    o2.start(t); o2.stop(t + len + 0.02);
  }

  function lead(t, midi, len) {
    const f0 = mf(midi);
    for (const det of [-5, 5]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.value = f0; o.detune.value = det;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.075, t + 0.02);
      g.gain.setValueAtTime(0.075, t + len * 0.7);
      g.gain.exponentialRampToValueAtTime(0.001, t + len + 0.05);
      o.connect(lp).connect(g);
      g.connect(master);
      g.connect(delaySend);
      o.start(t); o.stop(t + len + 0.1);
    }
  }

  function pad(t, midis, len) {
    for (const m of midis) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mf(m);
      const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = mf(m) * 1.005;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 850;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.05, t + len * 0.35);
      g.gain.setValueAtTime(0.05, t + len * 0.7);
      g.gain.linearRampToValueAtTime(0.001, t + len);
      o.connect(lp); o2.connect(lp);
      lp.connect(g).connect(master);
      o.start(t); o.stop(t + len + 0.05);
      o2.start(t); o2.stop(t + len + 0.05);
    }
  }

  // ---- tracks (original compositions) ------------------------------------------
  // 16 steps per bar. Drum strings: '.' rest, '1' hit, '2' accent/open.
  // bass/lead: arrays of [step, midi, lenInSteps]. pad: chords per bar.

  // E minor. Relentless low riff, straight backbeat, sparse pentatonic calls.
  const T1 = {
    bpm: 114,
    bars: {
      // drums only — dry machine groove
      a: { k: '1...1...1...1.1.', s: '....1.......1...', h: '1.1.1.1.1.1.1.1.' },
      // main riff enters
      b: {
        k: '1...1...1...1.1.', s: '....1.......1...', h: '1.1.1.1.1.1.1.12',
        bass: [[0, 28, 2], [3, 28, 1], [6, 31, 2], [8, 28, 2], [11, 33, 1], [12, 31, 2], [14, 28, 2]],
      },
      // riff + answer phrase up top
      c: {
        k: '1...1...1...1.1.', s: '....1.......1...', h: '1.1.1.1.1.1.1.12',
        bass: [[0, 28, 2], [3, 28, 1], [6, 31, 2], [8, 28, 2], [11, 33, 1], [12, 31, 2], [14, 28, 2]],
        lead: [[0, 52, 3], [6, 55, 2], [8, 57, 4], [14, 50, 2]],
      },
      // lift: riff walks up to A, second phrase
      d: {
        k: '1...1...1...1.1.', s: '....1.......1...', h: '1.1.1.1.1.1.1.12',
        bass: [[0, 33, 2], [3, 33, 1], [6, 36, 2], [8, 33, 2], [11, 31, 1], [12, 28, 2], [14, 26, 2]],
        lead: [[2, 59, 3], [8, 57, 3], [12, 55, 4]],
      },
      // breakdown — pad and hats, bass drops out
      e: {
        h: '..1...1...1...2.', pad: [[40, 47, 52]],
        bass: [[0, 28, 12]],
      },
      f: { h: '..1...1...1...2.', pad: [[36, 43, 48]], bass: [[0, 24, 12]] },
      // rebuild
      g: {
        k: '1.......1.......', s: '....1.......1..1', h: '1.1.1.1.1.1.1.12',
        bass: [[0, 28, 2], [6, 31, 2], [8, 28, 2], [12, 31, 2], [14, 28, 2]],
      },
    },
    order: ['a', 'b', 'b', 'c', 'd', 'b', 'c', 'd', 'e', 'f', 'g', 'b', 'c', 'c', 'd', 'd'],
  };

  // D minor, slower. Sub pulse, toms, a patient rising arpeggio. Night patrol.
  const T2 = {
    bpm: 96,
    bars: {
      a: {
        k: '1.....1.1.......', h: '..1...1...1...1.',
        bass: [[0, 26, 3], [8, 26, 3]],
      },
      b: {
        k: '1.....1.1.......', s: '....1.......1...', h: '..1...1...1...1.',
        bass: [[0, 26, 3], [8, 26, 2], [12, 29, 2]],
        lead: [[0, 50, 1], [2, 53, 1], [4, 57, 1], [6, 60, 1], [8, 57, 1], [10, 53, 1], [12, 50, 3]],
      },
      c: {
        k: '1.....1.1.......', s: '....1.......1...', h: '..1...1...1...1.',
        toms: [[10, 130], [11, 110], [14, 90]],
        bass: [[0, 24, 3], [8, 24, 2], [12, 26, 2]],
        lead: [[0, 48, 1], [2, 51, 1], [4, 55, 1], [6, 58, 1], [8, 60, 2], [12, 58, 3]],
      },
      d: { pad: [[38, 45, 50]], h: '......1.......1.', bass: [[0, 26, 14]] },
    },
    order: ['a', 'a', 'b', 'b', 'c', 'b', 'c', 'c', 'd', 'a', 'b', 'b', 'c', 'c', 'd', 'd'],
  };

  // A minor, fast. Assault footing: syncopated stabbing riff over relentless
  // 16ths, tom fills into every fourth bar, short furious call-and-answer.
  const T3 = {
    bpm: 128,
    bars: {
      a: { k: '1..1..1...1..1..', h: '1111111111111112', s: '....1.......1...' },
      b: {
        k: '1..1..1...1..1..', h: '1111111111111112', s: '....1.......1...',
        bass: [[0, 33, 1], [3, 33, 1], [6, 36, 1], [8, 33, 1], [10, 40, 1], [12, 38, 2], [14, 36, 1]],
      },
      c: {
        k: '1..1..1...1..1..', h: '1111111111111112', s: '....1.......1...',
        bass: [[0, 33, 1], [3, 33, 1], [6, 36, 1], [8, 33, 1], [10, 40, 1], [12, 38, 2], [14, 36, 1]],
        lead: [[0, 57, 1], [2, 60, 1], [4, 57, 2], [8, 64, 2], [12, 62, 2], [14, 60, 2]],
      },
      d: {
        k: '1..1..1...1..1..', h: '1111111111111112', s: '....1.......1..1',
        toms: [[12, 150], [13, 120], [14, 100], [15, 84]],
        bass: [[0, 31, 1], [3, 31, 1], [6, 35, 1], [8, 31, 1], [10, 38, 1], [12, 36, 2], [14, 33, 1]],
        lead: [[0, 62, 2], [4, 59, 2], [8, 57, 4]],
      },
      e: { h: '..2...2...2...2.', pad: [[33, 40, 45]], bass: [[0, 21, 14]] },
    },
    order: ['a', 'b', 'b', 'c', 'b', 'c', 'd', 'e', 'b', 'c', 'c', 'd'],
  };

  // C minor, slow. Deep-field menace: sub drones, distant toms, a lone cold
  // motif that answers itself a fifth down. The quiet before the push.
  const T4 = {
    bpm: 84,
    bars: {
      a: { k: '1...............', pad: [[36, 43, 48]], bass: [[0, 24, 15]] },
      b: {
        k: '1.........1.....', h: '....1.......1...',
        pad: [[36, 43, 48]],
        bass: [[0, 24, 7], [8, 24, 7]],
        lead: [[4, 60, 2], [8, 58, 2], [12, 55, 4]],
      },
      c: {
        k: '1.........1.....', h: '....1.......1...',
        toms: [[6, 96], [14, 78]],
        pad: [[32, 39, 44]],
        bass: [[0, 20, 7], [8, 20, 7]],
        lead: [[4, 55, 2], [8, 53, 2], [12, 51, 4]],
      },
      d: {
        k: '1.....1...1.....', s: '............1...', h: '..1...1...1...1.',
        bass: [[0, 24, 3], [6, 24, 2], [10, 27, 2], [12, 24, 3]],
        lead: [[0, 63, 3], [6, 62, 3], [12, 60, 4]],
      },
      e: { pad: [[36, 41, 48]], bass: [[0, 29, 15]], h: '......2.......2.' },
    },
    order: ['a', 'b', 'b', 'c', 'a', 'b', 'd', 'd', 'c', 'e'],
  };

  // F minor, mid-tempo. Iron column: halftime stomp, octave-jumping low
  // riff, a brooding two-phrase lead that never quite resolves.
  const T5 = {
    bpm: 122,
    bars: {
      a: { k: '1.......1.....1.', h: '1.1.1.1.1.1.1.1.', s: '........1.......' },
      b: {
        k: '1.......1.....1.', h: '1.1.1.1.1.1.1.1.', s: '........1.......',
        bass: [[0, 29, 2], [4, 41, 1], [6, 29, 2], [10, 41, 1], [12, 32, 2], [14, 31, 2]],
      },
      c: {
        k: '1.......1.....1.', h: '1.1.1.1.1.1.1.12', s: '........1.......',
        bass: [[0, 29, 2], [4, 41, 1], [6, 29, 2], [10, 41, 1], [12, 32, 2], [14, 31, 2]],
        lead: [[0, 53, 4], [6, 56, 2], [8, 55, 4], [14, 51, 2]],
      },
      d: {
        k: '1.......1.....1.', h: '1.1.1.1.1.1.1.12', s: '........1......1',
        toms: [[13, 140], [15, 96]],
        bass: [[0, 34, 2], [4, 46, 1], [6, 34, 2], [10, 32, 1], [12, 29, 2], [14, 27, 2]],
        lead: [[0, 58, 3], [6, 56, 3], [12, 53, 4]],
      },
      e: { h: '..1...1...1...1.', pad: [[29, 36, 41]], bass: [[0, 17, 14]] },
    },
    order: ['a', 'b', 'b', 'c', 'b', 'c', 'd', 'e', 'b', 'c', 'd', 'd'],
  };

  // B minor, fast. Vipers: offbeat kicks under running hats, coiling
  // chromatic bass, short three-note strike cells answered lower.
  const T6 = {
    bpm: 138,
    bars: {
      a: { k: '1...1..1..1.1...', h: '1111111111111111', s: '....1.......1...' },
      b: {
        k: '1...1..1..1.1...', h: '1111111111111111', s: '....1.......1...',
        bass: [[0, 35, 1], [2, 35, 1], [4, 38, 1], [6, 37, 1], [8, 35, 1], [10, 42, 1], [12, 41, 1], [14, 38, 1]],
      },
      c: {
        k: '1...1..1..1.1...', h: '1111111111111112', s: '....1.......1...',
        bass: [[0, 35, 1], [2, 35, 1], [4, 38, 1], [6, 37, 1], [8, 35, 1], [10, 42, 1], [12, 41, 1], [14, 38, 1]],
        lead: [[0, 59, 1], [2, 62, 1], [4, 66, 2], [8, 54, 1], [10, 57, 1], [12, 59, 3]],
      },
      d: {
        k: '1...1..1..1.1...', h: '1111111111111112', s: '....1......11..1',
        toms: [[11, 160], [13, 120], [15, 90]],
        bass: [[0, 33, 1], [2, 33, 1], [4, 40, 1], [6, 38, 1], [8, 33, 1], [10, 45, 1], [12, 42, 1], [14, 40, 1]],
        lead: [[0, 64, 2], [4, 62, 2], [8, 61, 2], [12, 57, 4]],
      },
      e: { h: '..2...2...2...2.', pad: [[35, 42, 47]], bass: [[0, 23, 14]] },
    },
    order: ['a', 'b', 'b', 'c', 'b', 'c', 'c', 'd', 'e', 'b', 'c', 'd'],
  };

  // G minor, very slow. Ashfall: heartbeat kick, long smothered pads and a
  // two-note lament drifting over distant toms. Aftermath music.
  const T7 = {
    bpm: 72,
    bars: {
      a: { k: '1.......1.......', pad: [[31, 38, 43]], bass: [[0, 19, 15]] },
      b: {
        k: '1.......1.......', h: '........1.......',
        pad: [[31, 38, 43]],
        bass: [[0, 19, 7], [8, 19, 7]],
        lead: [[4, 58, 3], [10, 55, 5]],
      },
      c: {
        k: '1.......1.......', h: '........1.......',
        toms: [[7, 88], [15, 72]],
        pad: [[27, 34, 39]],
        bass: [[0, 15, 7], [8, 15, 7]],
        lead: [[4, 53, 3], [10, 51, 5]],
      },
      d: {
        k: '1.......1....1..', s: '............1...',
        pad: [[29, 36, 41]],
        bass: [[0, 17, 7], [8, 17, 5], [14, 19, 2]],
        lead: [[0, 62, 4], [8, 60, 3], [12, 58, 4]],
      },
    },
    order: ['a', 'b', 'b', 'c', 'a', 'b', 'd', 'c', 'b', 'a'],
  };

  // Bb minor, march tempo. Sappers' march: clipped military snare figure,
  // staccato bass on the downbeats, a grim fifth-leaping fanfare gone wrong.
  const T8 = {
    bpm: 118,
    bars: {
      a: { k: '1...1...1...1...', s: '..1..1..1...1.11', h: '1.1.1.1.1.1.1.1.' },
      b: {
        k: '1...1...1...1...', s: '..1..1..1...1.11', h: '1.1.1.1.1.1.1.1.',
        bass: [[0, 34, 1], [4, 34, 1], [8, 41, 1], [10, 39, 1], [12, 37, 1], [14, 34, 1]],
      },
      c: {
        k: '1...1...1...1...', s: '..1..1..1...1.11', h: '1.1.1.1.1.1.1.12',
        bass: [[0, 34, 1], [4, 34, 1], [8, 41, 1], [10, 39, 1], [12, 37, 1], [14, 34, 1]],
        lead: [[0, 58, 2], [4, 65, 2], [8, 63, 2], [12, 61, 2], [14, 58, 2]],
      },
      d: {
        k: '1...1...1...1...', s: '..1..1..1...1111', h: '1.1.1.1.1.1.1.12',
        toms: [[12, 130], [14, 104]],
        bass: [[0, 32, 1], [4, 32, 1], [8, 39, 1], [10, 37, 1], [12, 34, 1], [14, 32, 1]],
        lead: [[0, 56, 3], [6, 61, 2], [8, 60, 4], [14, 53, 2]],
      },
      e: { h: '..1...1...1...2.', pad: [[34, 41, 46]], bass: [[0, 22, 14]] },
      f: { k: '1.......1.......', s: '............1.11', pad: [[32, 39, 44]], bass: [[0, 20, 12]] },
    },
    order: ['a', 'b', 'b', 'c', 'b', 'c', 'd', 'e', 'f', 'b', 'c', 'd', 'd'],
  };

  const TRACKS = [T1, T2, T3, T4, T5, T6, T7, T8];

  // ---- sequencer -----------------------------------------------------------------

  function _scheduleBarStep(tr, barKey, s, t, stepDur) {
    const b = tr.bars[barKey];
    if (!b) return;
    if (b.k && b.k[s] !== '.') kick(t, b.k[s] === '2');
    if (b.s && b.s[s] !== '.') snare(t);
    if (b.h && b.h[s] !== '.') hat(t, b.h[s] === '2');
    if (b.toms) for (const [ts, hz] of b.toms) if (ts === s) tom(t, hz);
    if (b.bass) for (const [bs, m, l] of b.bass) if (bs === s) bass(t, m, l * stepDur);
    if (b.lead) for (const [ls, m, l] of b.lead) if (ls === s) lead(t, m, l * stepDur);
    if (b.pad && s === 0) for (const chord of b.pad) pad(t, chord, 16 * stepDur);
  }

  function _tick() {
    if (!running) return;
    const tr = TRACKS[trackIdx];
    const stepDur = 60 / tr.bpm / 4;
    while (nextTime < ctx.currentTime + 0.28) {
      _scheduleBarStep(tr, tr.order[pos], step, nextTime, stepDur);
      nextTime += stepDur;
      step++;
      if (step >= 16) {
        step = 0;
        pos++;
        if (pos >= tr.order.length) {
          pos = 0;
          loops++;
          if (loops >= 2) {          // rotate tracks with a breather between
            loops = 0;
            trackIdx = (trackIdx + 1) % TRACKS.length;
            nextTime += 2.5;
          }
        }
      }
    }
  }

  // ---- control --------------------------------------------------------------------

  function _ensureCtx() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -22; comp.ratio.value = 3.5;
    comp.attack.value = 0.006; comp.release.value = 0.2;
    master = ctx.createGain();
    master.gain.value = 0.15;
    master.connect(comp).connect(ctx.destination);
    // shared echo for the lead voice
    delaySend = ctx.createGain(); delaySend.gain.value = 0.4;
    const dl = ctx.createDelay(1.0); dl.delayTime.value = 0.29;
    const fb = ctx.createGain(); fb.gain.value = 0.34;
    const damp = ctx.createBiquadFilter(); damp.type = 'lowpass'; damp.frequency.value = 1800;
    delaySend.connect(dl); dl.connect(damp); damp.connect(fb); fb.connect(dl);
    damp.connect(master);
  }

  function start() {
    if (!enabled) return;
    // vary the opener per mission: re-roll on every game start. When the
    // sequencer is already running (music plays through menus), it simply
    // picks up the new track at its next scheduled step.
    step = 0; pos = 0; loops = 0;
    trackIdx = (Math.random() * TRACKS.length) | 0;
    if (running) return;
    _ensureCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    running = true;
    nextTime = ctx.currentTime + 0.1;
    timer = setInterval(_tick, 60);
  }

  function stop() {
    running = false;
    if (timer) { clearInterval(timer); timer = 0; }
  }

  function setEnabled(on) {
    enabled = !!on;
    if (!enabled) stop();
    else if (game && game.status === 'playing') start();
  }

  return {
    start, stop, setEnabled,
    get enabled() { return enabled; },
  };
})();
