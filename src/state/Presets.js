/* GRAINLIZER — built-in presets, randomizer, user preset helpers. */

'use strict';

/** Full parameter snapshot factory (deep clone of defaults). */
export function defaultParams() {
  return {
    position: 0.35,
    grainSize: 180,
    density: 16,
    spray: 0.12,
    pitch: 0,
    rate: 1,
    jitter: 0.2,
    reverse: false,
    freeze: false,
    mix: 0.8,
    master: 0.8,
    fxBypass: false,
    fx: {
      filter: { on: true, type: 'lowpass', cutoff: 8000, q: 0.7 },
      tape: { on: true, drive: 1.2, tone: 0.6, wow: 0.15 },
      delay: { on: true, time: 0.42, feedback: 0.45, mix: 0.25 },
      reverb: { on: true, size: 0.6, decay: 0.55, mix: 0.4 }
    }
  };
}

function P(over) {
  const base = defaultParams();
  return mergeParams(base, over);
}

function mergeParams(base, over) {
  if (!over) return base;
  for (const k of Object.keys(over)) {
    if (k === 'fx' && over.fx) {
      for (const s of Object.keys(over.fx)) {
        Object.assign(base.fx[s], over.fx[s]);
      }
    } else {
      base[k] = over[k];
    }
  }
  return base;
}

export const BUILTIN_PRESETS = [
  {
    id: 'soft-memory',
    name: 'SOFT MEMORY',
    desc: 'мягкий атмосферный слой',
    params: P({
      grainSize: 320, density: 14, spray: 0.18, pitch: -2, rate: 0.85,
      jitter: 0.15, mix: 0.82, master: 0.78,
      fx: {
        filter: { on: true, type: 'lowpass', cutoff: 5200, q: 0.6 },
        tape: { on: true, drive: 1.15, tone: 0.55, wow: 0.12 },
        delay: { on: true, time: 0.48, feedback: 0.42, mix: 0.28 },
        reverb: { on: true, size: 0.62, decay: 0.6, mix: 0.45 }
      }
    })
  },
  {
    id: 'broken-tape',
    name: 'BROKEN TAPE',
    desc: 'приглушённый нестабильный звук',
    params: P({
      grainSize: 140, density: 22, spray: 0.22, pitch: -1, rate: 0.92,
      jitter: 0.55, mix: 0.85, master: 0.72,
      fx: {
        filter: { on: true, type: 'lowpass', cutoff: 3400, q: 1.2 },
        tape: { on: true, drive: 2.1, tone: 0.38, wow: 0.55 },
        delay: { on: true, time: 0.33, feedback: 0.38, mix: 0.22 },
        reverb: { on: true, size: 0.45, decay: 0.5, mix: 0.3 }
      }
    })
  },
  {
    id: 'glass-cloud',
    name: 'GLASS CLOUD',
    desc: 'воздушные гранулы, длинный хвост',
    params: P({
      grainSize: 95, density: 32, spray: 0.35, pitch: 7, rate: 1.05,
      jitter: 0.3, mix: 0.9, master: 0.75,
      fx: {
        filter: { on: true, type: 'highpass', cutoff: 420, q: 0.7 },
        tape: { on: true, drive: 1.05, tone: 0.78, wow: 0.08 },
        delay: { on: true, time: 0.55, feedback: 0.52, mix: 0.32 },
        reverb: { on: true, size: 0.88, decay: 0.75, mix: 0.55 }
      }
    })
  },
  {
    id: 'lost-signal',
    name: 'LOST SIGNAL',
    desc: 'рассеянные гранулы, случайное движение',
    params: P({
      grainSize: 70, density: 42, spray: 0.85, pitch: 3, rate: 1.25,
      jitter: 0.85, mix: 0.92, master: 0.7,
      fx: {
        filter: { on: true, type: 'lowpass', cutoff: 7000, q: 0.9 },
        tape: { on: true, drive: 1.35, tone: 0.5, wow: 0.35 },
        delay: { on: true, time: 0.29, feedback: 0.55, mix: 0.38 },
        reverb: { on: true, size: 0.72, decay: 0.62, mix: 0.5 }
      }
    })
  },
  {
    id: 'deep-sleep',
    name: 'DEEP SLEEP',
    desc: 'медленный тёмный дрон',
    params: P({
      grainSize: 520, density: 9, spray: 0.1, pitch: -12, rate: 0.6,
      jitter: 0.12, mix: 0.95, master: 0.8, freeze: true,
      fx: {
        filter: { on: true, type: 'lowpass', cutoff: 1600, q: 1.4 },
        tape: { on: true, drive: 1.6, tone: 0.3, wow: 0.18 },
        delay: { on: true, time: 0.62, feedback: 0.48, mix: 0.25 },
        reverb: { on: true, size: 0.8, decay: 0.7, mix: 0.52 }
      }
    })
  },
  {
    id: 'dream-fragment',
    name: 'DREAM FRAGMENT',
    desc: 'мерцающий растянутый семпл',
    params: P({
      grainSize: 260, density: 18, spray: 0.28, pitch: 5, rate: 0.75,
      jitter: 0.4, reverse: true, mix: 0.88, master: 0.76,
      fx: {
        filter: { on: true, type: 'lowpass', cutoff: 9000, q: 0.8 },
        tape: { on: true, drive: 1.25, tone: 0.65, wow: 0.25 },
        delay: { on: true, time: 0.41, feedback: 0.58, mix: 0.35 },
        reverb: { on: true, size: 0.75, decay: 0.68, mix: 0.48 }
      }
    })
  },
  {
    id: 'neon-dust',
    name: 'NEON DUST',
    desc: 'яркая искристая пыль',
    params: P({
      grainSize: 55, density: 48, spray: 0.55, pitch: 12, rate: 1.15,
      jitter: 0.45, mix: 0.92, master: 0.72,
      fx: {
        filter: { on: true, type: 'highpass', cutoff: 900, q: 0.9 },
        tape: { on: true, drive: 1.1, tone: 0.85, wow: 0.06 },
        delay: { on: true, time: 0.22, feedback: 0.5, mix: 0.3 },
        reverb: { on: true, size: 0.7, decay: 0.6, mix: 0.5 }
      }
    })
  },
  {
    id: 'magnetic-ghost',
    name: 'MAGNETIC GHOST',
    desc: 'плёночное призрачное эхо',
    params: P({
      grainSize: 210, density: 11, spray: 0.2, pitch: -5, rate: 0.8,
      jitter: 0.5, mix: 0.87, master: 0.75,
      fx: {
        filter: { on: true, type: 'lowpass', cutoff: 2800, q: 1.1 },
        tape: { on: true, drive: 2.3, tone: 0.32, wow: 0.72 },
        delay: { on: true, time: 0.52, feedback: 0.55, mix: 0.34 },
        reverb: { on: true, size: 0.55, decay: 0.58, mix: 0.4 }
      }
    })
  },
  {
    id: 'ice-cave',
    name: 'ICE CAVE',
    desc: 'ледяная пещера, стеклянный хвост',
    params: P({
      grainSize: 85, density: 36, spray: 0.4, pitch: 7, rate: 1.1,
      jitter: 0.25, mix: 0.9, master: 0.72,
      fx: {
        filter: { on: true, type: 'highpass', cutoff: 650, q: 0.6 },
        tape: { on: true, drive: 1.05, tone: 0.9, wow: 0.1 },
        delay: { on: true, time: 0.66, feedback: 0.48, mix: 0.3 },
        reverb: { on: true, size: 0.95, decay: 0.85, mix: 0.6 }
      }
    })
  },
  {
    id: 'slow-erosion',
    name: 'SLOW EROSION',
    desc: 'медленное размытие времени',
    params: P({
      grainSize: 620, density: 7, spray: 0.15, pitch: -3, rate: 0.55,
      jitter: 0.18, mix: 0.93, master: 0.8,
      fx: {
        filter: { on: true, type: 'lowpass', cutoff: 1200, q: 1.6 },
        tape: { on: true, drive: 1.5, tone: 0.28, wow: 0.3 },
        delay: { on: true, time: 0.78, feedback: 0.5, mix: 0.26 },
        reverb: { on: true, size: 0.85, decay: 0.78, mix: 0.5 }
      }
    })
  },
  {
    id: 'static-bloom',
    name: 'STATIC BLOOM',
    desc: 'расцветающий статический шум',
    params: P({
      grainSize: 130, density: 28, spray: 0.6, pitch: 2, rate: 1.3,
      jitter: 0.75, mix: 0.9, master: 0.7,
      fx: {
        filter: { on: true, type: 'lowpass', cutoff: 6200, q: 1.8 },
        tape: { on: true, drive: 1.9, tone: 0.55, wow: 0.4 },
        delay: { on: true, time: 0.36, feedback: 0.62, mix: 0.42 },
        reverb: { on: true, size: 0.68, decay: 0.6, mix: 0.46 }
      }
    })
  },
  {
    id: 'satellite-drift',
    name: 'SATELLITE DRIFT',
    desc: 'дрейф сигнала со спутника',
    params: P({
      grainSize: 175, density: 13, spray: 0.9, pitch: -7, rate: 0.9,
      jitter: 0.6, mix: 0.9, master: 0.74,
      fx: {
        filter: { on: true, type: 'lowpass', cutoff: 4500, q: 0.7 },
        tape: { on: true, drive: 1.3, tone: 0.45, wow: 0.5 },
        delay: { on: true, time: 0.95, feedback: 0.58, mix: 0.4 },
        reverb: { on: true, size: 0.8, decay: 0.7, mix: 0.52 }
      }
    })
  }
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Musical randomizer: interesting but safe (no runaway gain/feedback). */
export function randomizeParams(rand = Math.random, mode = 'hard', baseParams = null) {
  return mode === 'soft'
    ? softRandomize(rand, baseParams)
    : hardRandomize(rand);
}

/**
 * SOFT randomize: gentle variations AROUND the current settings.
 * Keeps the character — no reverse/freeze flips, no effect on/off switching,
 * small musical pitch drift only. Ideal for live tweaking.
 */
function softRandomize(rand, baseParams) {
  const p = sanitizeParams(baseParams);
  const vary = (v, spread, min, max) =>
    clamp(v * (1 + (rand() * 2 - 1) * spread), min, max);
  const varyAdd = (v, delta, min, max) =>
    clamp(v + (rand() * 2 - 1) * delta, min, max);

  p.grainSize = Math.round(vary(p.grainSize, 0.22, 15, 1200));
  p.density = Math.round(vary(p.density, 0.25, 1, 60) * 10) / 10;
  p.spray = Math.round(varyAdd(p.spray, 0.07, 0, 1) * 100) / 100;

  // pitch: small musical drift, never more than ±2 st from current
  const drifts = [-2, -1, -1, 0, 0, 0, 1, 1, 2];
  p.pitch = clamp(
    p.pitch + drifts[Math.floor(rand() * drifts.length)],
    Math.max(-12, p.pitch - 2),
    Math.min(12, p.pitch + 2)
  );

  p.rate = Math.round(vary(p.rate, 0.08, 0.4, 2.2) * 100) / 100;
  p.jitter = Math.round(varyAdd(p.jitter, 0.08, 0, 0.8) * 100) / 100;
  p.mix = Math.round(varyAdd(p.mix, 0.05, 0.6, 1) * 100) / 100;
  p.master = Math.round(varyAdd(p.master, 0.05, 0.55, 0.9) * 100) / 100;

  p.fx.filter.cutoff = Math.round(vary(p.fx.filter.cutoff, 0.25, 200, 18000));
  p.fx.filter.q = Math.round(varyAdd(p.fx.filter.q, 0.3, 0.1, 8) * 10) / 10;
  p.fx.tape.drive = Math.round(varyAdd(p.fx.tape.drive, 0.15, 0.7, 2.4) * 100) / 100;
  p.fx.tape.tone = Math.round(varyAdd(p.fx.tape.tone, 0.07, 0.15, 0.95) * 100) / 100;
  p.fx.tape.wow = Math.round(varyAdd(p.fx.tape.wow, 0.06, 0, 0.6) * 100) / 100;
  p.fx.delay.time = Math.round(vary(p.fx.delay.time, 0.15, 0.08, 1.4) * 100) / 100;
  p.fx.delay.feedback = Math.round(varyAdd(p.fx.delay.feedback, 0.07, 0, 0.75) * 100) / 100;
  p.fx.delay.mix = Math.round(varyAdd(p.fx.delay.mix, 0.06, 0, 0.5) * 100) / 100;
  p.fx.reverb.size = Math.round(varyAdd(p.fx.reverb.size, 0.07, 0.15, 0.95) * 100) / 100;
  p.fx.reverb.decay = Math.round(varyAdd(p.fx.reverb.decay, 0.07, 0.15, 0.9) * 100) / 100;
  p.fx.reverb.mix = Math.round(varyAdd(p.fx.reverb.mix, 0.06, 0.15, 0.65) * 100) / 100;

  return sanitizeParams(p);
}

/** HARD randomize: bold jumps across the whole musical space. */
function hardRandomize(rand) {
  const p = defaultParams();
  const pick = (a, b) => a + rand() * (b - a);

  p.grainSize = Math.round(pick(40, 620));
  p.density = Math.round(pick(5, 46) * 10) / 10;
  p.spray = Math.round(pick(0.04, 0.7) * 100) / 100;
  // pitch biased to musical intervals
  const intervals = [-12, -7, -5, -3, 0, 0, 2, 3, 5, 7, 12];
  p.pitch = intervals[Math.floor(rand() * intervals.length)];
  p.rate = Math.round(pick(0.55, 1.6) * 100) / 100;
  p.jitter = Math.round(pick(0.05, 0.8) * 100) / 100;
  p.mix = Math.round(pick(0.7, 1) * 100) / 100;
  p.reverse = rand() < 0.18;
  p.freeze = rand() < 0.15;
  p.master = Math.round(pick(0.62, 0.82) * 100) / 100;

  p.fx.filter.on = rand() < 0.85;
  p.fx.filter.type = rand() < 0.7 ? 'lowpass' : 'highpass';
  p.fx.filter.cutoff = Math.round(pick(600, 12000));
  p.fx.filter.q = Math.round(pick(0.4, 2.2) * 10) / 10;

  p.fx.tape.on = rand() < 0.8;
  p.fx.tape.drive = Math.round(pick(1, 2.2) * 100) / 100;
  p.fx.tape.tone = Math.round(pick(0.3, 0.8) * 100) / 100;
  p.fx.tape.wow = Math.round(pick(0, 0.5) * 100) / 100;

  p.fx.delay.on = rand() < 0.75;
  p.fx.delay.time = Math.round(pick(0.18, 0.75) * 100) / 100;
  p.fx.delay.feedback = Math.round(pick(0.2, 0.6) * 100) / 100; // <= 0.85 hard cap
  p.fx.delay.mix = Math.round(pick(0.12, 0.42) * 100) / 100;

  p.fx.reverb.on = true;
  p.fx.reverb.size = Math.round(pick(0.35, 0.9) * 100) / 100;
  p.fx.reverb.decay = Math.round(pick(0.4, 0.8) * 100) / 100;
  p.fx.reverb.mix = Math.round(pick(0.25, 0.58) * 100) / 100;

  return sanitizeParams(p);
}

/** Clamp everything to safe ranges; repair broken/partial trees. */
export function sanitizeParams(raw) {
  const p = defaultParams();
  if (!raw || typeof raw !== 'object') return p;
  mergeParams(p, raw);

  const clamp = (v, a, b, dflt) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.max(a, Math.min(b, n));
  };

  p.position = clamp(p.position, 0, 1, 0.35);
  p.grainSize = clamp(p.grainSize, 8, 1500, 180);
  p.density = clamp(p.density, 0.2, 120, 16);
  p.spray = clamp(p.spray, 0, 1, 0.12);
  p.pitch = clamp(p.pitch, -24, 24, 0);
  p.rate = clamp(p.rate, 0.1, 4, 1);
  p.jitter = clamp(p.jitter, 0, 1, 0.2);
  p.mix = clamp(p.mix, 0, 1, 0.8);
  p.master = clamp(p.master, 0, 1.2, 0.8);
  p.reverse = !!p.reverse;
  p.freeze = !!p.freeze;
  p.fxBypass = !!p.fxBypass;

  p.fx.filter.on = p.fx.filter.on !== false;
  p.fx.filter.type = p.fx.filter.type === 'highpass' ? 'highpass' : 'lowpass';
  p.fx.filter.cutoff = clamp(p.fx.filter.cutoff, 20, 20000, 8000);
  p.fx.filter.q = clamp(p.fx.filter.q, 0.1, 20, 0.7);

  p.fx.tape.on = !!p.fx.tape.on;
  p.fx.tape.drive = clamp(p.fx.tape.drive, 0.5, 3, 1.2);
  p.fx.tape.tone = clamp(p.fx.tape.tone, 0, 1, 0.6);
  p.fx.tape.wow = clamp(p.fx.tape.wow, 0, 1, 0.15);

  p.fx.delay.on = !!p.fx.delay.on;
  p.fx.delay.time = clamp(p.fx.delay.time, 0.01, 1.8, 0.42);
  p.fx.delay.feedback = clamp(p.fx.delay.feedback, 0, 0.85, 0.45);
  p.fx.delay.mix = clamp(p.fx.delay.mix, 0, 1, 0.25);

  p.fx.reverb.on = p.fx.reverb.on !== false;
  p.fx.reverb.size = clamp(p.fx.reverb.size, 0.05, 1, 0.6);
  p.fx.reverb.decay = clamp(p.fx.reverb.decay, 0.05, 1, 0.55);
  p.fx.reverb.mix = clamp(p.fx.reverb.mix, 0, 1, 0.4);

  return p;
}
