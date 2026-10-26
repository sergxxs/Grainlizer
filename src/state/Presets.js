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
    slotMix: 0,
    width: 0.7,
    window: 'hann',
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
  },

  // ── 20 unusual patches ──────────────────────────────────────────────
  {
    id: 'rust-garden',
    name: 'RUST GARDEN',
    desc: 'ржавый сад, растущий шум',
    params: P({
      grainSize: 340, density: 12, spray: 0.3, pitch: -5, rate: 0.7,
      jitter: 0.35, width: 0.8, window: 'perc', mix: 0.9, master: 0.75,
      fx: {
        filter: { on: true, type: 'lowpass', cutoff: 2200, q: 2.2 },
        tape: { on: true, drive: 2.2, tone: 0.35, wow: 0.35 },
        delay: { on: true, time: 0.44, feedback: 0.55, mix: 0.32 },
        reverb: { on: true, size: 0.6, decay: 0.55, mix: 0.42 }
      }
    })
  },
  {
    id: 'velvet-static',
    name: 'VELVET STATIC',
    desc: 'бархатный статик из облаков',
    params: P({
      grainSize: 95, density: 55, spray: 0.65, pitch: 3, rate: 1.2,
      jitter: 0.7, width: 1, window: 'tukey', mix: 0.95, master: 0.68,
      fx: {
        filter: { on: true, type: 'lowpass', cutoff: 7500, q: 0.5 },
        tape: { on: true, drive: 1.15, tone: 0.75, wow: 0.12 },
        delay: { on: true, time: 0.19, feedback: 0.4, mix: 0.28 },
        reverb: { on: true, size: 0.75, decay: 0.65, mix: 0.55 }
      }
    })
  },
  {
    id: 'cathedral-dust',
    name: 'CATHEDRAL DUST',
    desc: 'пыль собора, светлый купол',
    params: P({
      grainSize: 120, density: 30, spray: 0.45, pitch: 7, rate: 1,
      jitter: 0.3, width: 0.9, window: 'hann', mix: 0.92, master: 0.72,
      fx: {
        filter: { on: true, type: 'highpass', cutoff: 350, q: 0.5 },
        tape: { on: true, drive: 1.1, tone: 0.9, wow: 0.08 },
        delay: { on: true, time: 0.72, feedback: 0.5, mix: 0.33 },
        reverb: { on: true, size: 0.98, decay: 0.9, mix: 0.62 }
      }
    })
  },
  {
    id: 'tape-worm',
    name: 'TAPE WORM',
    desc: 'плёнка уходит в пике',
    params: P({
      grainSize: 190, density: 15, spray: 0.22, pitch: -2, rate: 0.88,
      jitter: 0.6, width: 0.5, window: 'tukey', mix: 0.88, master: 0.74,
      fx: {
        filter: { on: true, type: 'lowpass', cutoff: 3200, q: 1.4 },
        tape: { on: true, drive: 2.6, tone: 0.28, wow: 0.9 },
        delay: { on: true, time: 0.38, feedback: 0.6, mix: 0.3 },
        reverb: { on: true, size: 0.5, decay: 0.5, mix: 0.36 }
      }
    })
  },
  {
    id: 'underwater-organ',
    name: 'UNDERWATER ORGAN',
    desc: 'подводный орган',
    params: P({
      grainSize: 480, density: 10, spray: 0.12, pitch: -12, rate: 0.6,
      jitter: 0.15, width: 0.6, window: 'hann', freeze: true, mix: 0.95, master: 0.8,
      fx: {
        filter: { on: true, type: 'lowpass', cutoff: 900, q: 1.8 },
        tape: { on: true, drive: 1.6, tone: 0.22, wow: 0.4 },
        delay: { on: true, time: 0.68, feedback: 0.52, mix: 0.3 },
        reverb: { on: true, size: 0.88, decay: 0.8, mix: 0.55 }
      }
    })
  },
  {
    id: 'chrome-insects',
    name: 'CHROME INSECTS',
    desc: 'хромовые насекомые',
    params: P({
      grainSize: 28, density: 70, spray: 0.75, pitch: 12, rate: 1.5,
      jitter: 0.85, width: 1, window: 'perc', mix: 0.95, master: 0.65,
      fx: {
        filter: { on: true, type: 'highpass', cutoff: 500, q: 1.2 },
        tape: { on: true, drive: 1.3, tone: 0.85, wow: 0.2 },
        delay: { on: true, time: 0.16, feedback: 0.45, mix: 0.35 },
        reverb: { on: true, size: 0.55, decay: 0.45, mix: 0.4 }
      }
    })
  },
  {
    id: 'sleepwalker',
    name: 'SLEEPWALKER',
    desc: 'лунатик во тьме',
    params: P({
      grainSize: 700, density: 6, spray: 0.18, pitch: -7, rate: 0.5,
      jitter: 0.12, width: 0.55, window: 'hann', mix: 0.96, master: 0.82,
      fx: {
        filter: { on: true, type: 'lowpass', cutoff: 1400, q: 1.5 },
        tape: { on: true, drive: 1.4, tone: 0.25, wow: 0.22 },
        delay: { on: true, time: 0.85, feedback: 0.55, mix: 0.28 },
        reverb: { on: true, size: 0.9, decay: 0.85, mix: 0.5 }
      }
    })
  },
  {
    id: 'burned-letter',
    name: 'BURNED LETTER',
    desc: 'сожжённое письмо',
    params: P({
      grainSize: 160, density: 20, spray: 0.4, pitch: -3, rate: 0.9,
      jitter: 0.5, width: 0.65, window: 'rev', reverse: true, mix: 0.9, master: 0.72,
      fx: {
        filter: { on: true, type: 'lowpass', cutoff: 2600, q: 2.8 },
        tape: { on: true, drive: 2.4, tone: 0.4, wow: 0.45 },
        delay: { on: true, time: 0.34, feedback: 0.5, mix: 0.32 },
        reverb: { on: true, size: 0.65, decay: 0.6, mix: 0.45 }
      }
    })
  },
  {
    id: 'aurora-drift',
    name: 'AURORA DRIFT',
    desc: 'дрейф полярного сияния',
    params: P({
      grainSize: 110, density: 40, spray: 0.6, pitch: 5, rate: 1.1,
      jitter: 0.4, width: 1, window: 'tukey', mix: 0.93, master: 0.72,
      fx: {
        filter: { on: true, type: 'highpass', cutoff: 250, q: 0.6 },
        tape: { on: true, drive: 1.05, tone: 0.88, wow: 0.15 },
        delay: { on: true, time: 0.58, feedback: 0.55, mix: 0.36 },
        reverb: { on: true, size: 0.92, decay: 0.82, mix: 0.58 }
      }
    })
  },
  {
    id: 'phantom-choir',
    name: 'PHANTOM CHOIR',
    desc: 'фантомный хор',
    params: P({
      grainSize: 300, density: 22, spray: 0.25, pitch: 12, rate: 0.85,
      jitter: 0.28, width: 0.95, window: 'hann', mix: 0.94, master: 0.72,
      fx: {
        filter: { on: true, type: 'lowpass', cutoff: 5500, q: 1.1 },
        tape: { on: true, drive: 1.2, tone: 0.7, wow: 0.25 },
        delay: { on: true, time: 0.47, feedback: 0.58, mix: 0.34 },
        reverb: { on: true, size: 0.85, decay: 0.78, mix: 0.56 }
      }
    })
  },
  {
    id: 'gravel-rain',
    name: 'GRAVEL RAIN',
    desc: 'дождь из гравия',
    params: P({
      grainSize: 45, density: 65, spray: 0.8, pitch: 2, rate: 1.35,
      jitter: 0.9, width: 1, window: 'perc', mix: 0.95, master: 0.66,
      fx: {
        filter: { on: true, type: 'highpass', cutoff: 200, q: 0.8 },
        tape: { on: true, drive: 1.5, tone: 0.6, wow: 0.3 },
        delay: { on: true, time: 0.21, feedback: 0.35, mix: 0.3 },
        reverb: { on: true, size: 0.6, decay: 0.5, mix: 0.42 }
      }
    })
  },
  {
    id: 'tidal-glass',
    name: 'TIDAL GLASS',
    desc: 'стеклянный прилив',
    params: P({
      grainSize: 240, density: 16, spray: 0.35, pitch: 7, rate: 0.8,
      jitter: 0.3, width: 0.85, window: 'tukey', mix: 0.92, master: 0.75,
      fx: {
        filter: { on: true, type: 'highpass', cutoff: 180, q: 0.5 },
        tape: { on: true, drive: 1.1, tone: 0.8, wow: 0.28 },
        delay: { on: true, time: 0.64, feedback: 0.62, mix: 0.38 },
        reverb: { on: true, size: 0.95, decay: 0.92, mix: 0.6 }
      }
    })
  },
  {
    id: 'broken-carousel',
    name: 'BROKEN CAROUSEL',
    desc: 'сломанные карусель',
    params: P({
      grainSize: 130, density: 24, spray: 0.5, pitch: -5, rate: 1.15,
      jitter: 0.65, width: 0.9, window: 'rev', reverse: true, mix: 0.9, master: 0.72,
      fx: {
        filter: { on: true, type: 'lowpass', cutoff: 3800, q: 1.9 },
        tape: { on: true, drive: 2, tone: 0.5, wow: 0.75 },
        delay: { on: true, time: 0.43, feedback: 0.58, mix: 0.36 },
        reverb: { on: true, size: 0.7, decay: 0.62, mix: 0.46 }
      }
    })
  },
  {
    id: 'vhs-sunset',
    name: 'VHS SUNSET',
    desc: 'закат на кассете',
    params: P({
      grainSize: 380, density: 14, spray: 0.2, pitch: -2, rate: 0.75,
      jitter: 0.35, width: 0.6, window: 'hann', mix: 0.9, master: 0.78,
      fx: {
        filter: { on: true, type: 'lowpass', cutoff: 1800, q: 0.9 },
        tape: { on: true, drive: 1.9, tone: 0.3, wow: 0.55 },
        delay: { on: true, time: 0.5, feedback: 0.42, mix: 0.25 },
        reverb: { on: true, size: 0.72, decay: 0.65, mix: 0.48 }
      }
    })
  },
  {
    id: 'nerve-spark',
    name: 'NERVE SPARK',
    desc: 'искры нерва',
    params: P({
      grainSize: 22, density: 85, spray: 0.55, pitch: 12, rate: 1.6,
      jitter: 0.95, width: 1, window: 'rev', mix: 0.95, master: 0.62,
      fx: {
        filter: { on: true, type: 'highpass', cutoff: 400, q: 1.5 },
        tape: { on: true, drive: 1.7, tone: 0.9, wow: 0.4 },
        delay: { on: true, time: 0.14, feedback: 0.5, mix: 0.38 },
        reverb: { on: true, size: 0.45, decay: 0.4, mix: 0.35 }
      }
    })
  },
  {
    id: 'hollow-planet',
    name: 'HOLLOW PLANET',
    desc: 'полая планета',
    params: P({
      grainSize: 820, density: 5, spray: 0.1, pitch: -12, rate: 0.45,
      jitter: 0.1, width: 0.75, window: 'hann', freeze: true, mix: 0.97, master: 0.82,
      fx: {
        filter: { on: true, type: 'lowpass', cutoff: 700, q: 2.2 },
        tape: { on: true, drive: 1.8, tone: 0.2, wow: 0.18 },
        delay: { on: true, time: 1.1, feedback: 0.6, mix: 0.3 },
        reverb: { on: true, size: 0.92, decay: 0.88, mix: 0.55 }
      }
    })
  },
  {
    id: 'cloud-atlas',
    name: 'CLOUD ATLAS',
    desc: 'атлас облаков',
    params: P({
      grainSize: 200, density: 18, spray: 0.95, pitch: 3, rate: 1,
      jitter: 0.45, width: 1, window: 'tukey', mix: 0.92, master: 0.74,
      fx: {
        filter: { on: true, type: 'lowpass', cutoff: 6800, q: 0.5 },
        tape: { on: true, drive: 1.1, tone: 0.72, wow: 0.2 },
        delay: { on: true, time: 0.56, feedback: 0.48, mix: 0.32 },
        reverb: { on: true, size: 0.82, decay: 0.72, mix: 0.54 }
      }
    })
  },
  {
    id: 'signal-1987',
    name: 'SIGNAL FROM 1987',
    desc: 'сигнал из 1987-го',
    params: P({
      grainSize: 150, density: 20, spray: 0.3, pitch: -5, rate: 0.92,
      jitter: 0.55, width: 0.5, window: 'perc', mix: 0.88, master: 0.74,
      fx: {
        filter: { on: true, type: 'lowpass', cutoff: 2400, q: 1.6 },
        tape: { on: true, drive: 2.8, tone: 0.32, wow: 0.85 },
        delay: { on: true, time: 0.31, feedback: 0.52, mix: 0.34 },
        reverb: { on: true, size: 0.55, decay: 0.52, mix: 0.38 }
      }
    })
  },
  {
    id: 'melting-clock',
    name: 'MELTING CLOCK',
    desc: 'тающие часы',
    params: P({
      grainSize: 950, density: 8, spray: 0.25, pitch: -12, rate: 0.35,
      jitter: 0.2, width: 0.7, window: 'rev', mix: 0.95, master: 0.8,
      fx: {
        filter: { on: true, type: 'lowpass', cutoff: 1100, q: 1.3 },
        tape: { on: true, drive: 1.35, tone: 0.35, wow: 0.6 },
        delay: { on: true, time: 0.9, feedback: 0.55, mix: 0.28 },
        reverb: { on: true, size: 0.85, decay: 0.8, mix: 0.52 }
      }
    })
  },
  {
    id: 'star-chamber',
    name: 'STAR CHAMBER',
    desc: 'звёздная палата',
    params: P({
      grainSize: 75, density: 44, spray: 0.5, pitch: 7, rate: 1.05,
      jitter: 0.5, width: 1, window: 'hann', mix: 0.93, master: 0.72,
      fx: {
        filter: { on: true, type: 'highpass', cutoff: 150, q: 0.6 },
        tape: { on: true, drive: 1.15, tone: 0.82, wow: 0.18 },
        delay: { on: true, time: 0.49, feedback: 0.56, mix: 0.35 },
        reverb: { on: true, size: 0.9, decay: 0.85, mix: 0.58 }
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
  p.width = Math.round(varyAdd(p.width, 0.1, 0.1, 1) * 100) / 100;
  // window shape preserved — soft keeps the character

  p.fx.filter.cutoff = Math.round(vary(p.fx.filter.cutoff, 0.25, 200, 18000));
  // audibility guard: never sweep a highpass into the inaudible zone
  if (p.fx.filter.type === 'highpass') {
    p.fx.filter.cutoff = Math.round(clamp(p.fx.filter.cutoff, 60, 1200));
  }
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

  p.grainSize = Math.round(pick(60, 620));
  p.density = Math.round(pick(8, 46) * 10) / 10;
  p.spray = Math.round(pick(0.04, 0.7) * 100) / 100;
  // pitch biased to musical intervals
  const intervals = [-12, -7, -5, -3, 0, 0, 2, 3, 5, 7, 12];
  p.pitch = intervals[Math.floor(rand() * intervals.length)];
  p.rate = Math.round(pick(0.55, 1.6) * 100) / 100;
  p.jitter = Math.round(pick(0.05, 0.8) * 100) / 100;
  p.mix = Math.round(pick(0.75, 1) * 100) / 100;
  p.reverse = rand() < 0.18;
  p.freeze = rand() < 0.15;
  p.master = Math.round(pick(0.65, 0.82) * 100) / 100;
  p.width = Math.round(pick(0.25, 1) * 100) / 100;
  const windows = ['hann', 'hann', 'tukey', 'perc', 'rev'];
  p.window = windows[Math.floor(rand() * windows.length)];

  p.fx.filter.on = rand() < 0.85;
  p.fx.filter.type = rand() < 0.7 ? 'lowpass' : 'highpass';
  // AUDIBILITY GUARD: a highpass above ~1.2 kHz silences the texture —
  // this was the "sound disappears on randomize" bug. Keep both curves musical.
  p.fx.filter.cutoff = p.fx.filter.type === 'highpass'
    ? Math.round(pick(80, 800))
    : Math.round(pick(800, 14000));
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
  p.slotMix = clamp(p.slotMix, 0, 1, 0);
  p.width = clamp(p.width, 0, 1, 0.7);
  p.window = ['hann', 'tukey', 'perc', 'rev'].includes(p.window) ? p.window : 'hann';
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
