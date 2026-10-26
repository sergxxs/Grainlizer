/* GRAINLIZER — effects chain.
 * Source → Filter → Tape → Delay → Reverb → Master → soft clip + limiter
 *   → [device output + recorder tap]
 * All parameter changes are ramped with setTargetAtTime to avoid clicks.
 */

'use strict';

const TAU = 2 * Math.PI;

export class EffectsChain {
  constructor(ctx) {
    this.ctx = ctx;

    this.input = ctx.createGain();
    this.output = ctx.createGain();

    // ---- FILTER (LP/HP switchable, resonance via Q) ----
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 8000;
    this.filter.Q.value = 0.7;
    this.filterDry = ctx.createGain();
    this.filterWet = ctx.createGain();
    this.filterDry.gain.value = 0;
    this.filterWet.gain.value = 1;

    // ---- TAPE (drive → tanh shaper → tone LP → wow/flutter modulated delay) ----
    this.tapePre = ctx.createGain();
    this.tapeShaper = ctx.createWaveShaper();
    this.tapeShaper.oversample = '2x';
    this.tapeTone = ctx.createBiquadFilter();
    this.tapeTone.type = 'lowpass';
    this.tapeTone.frequency.value = 12000;
    this.tapeWow = ctx.createDelay(0.05);
    this.tapeWow.delayTime.value = 0.004;
    this.wowLfo = ctx.createOscillator();
    this.wowLfo.type = 'sine';
    this.wowLfo.frequency.value = 0.45;
    this.wowLfoGain = ctx.createGain();
    this.wowLfoGain.gain.value = 0;
    this.wowLfo.connect(this.wowLfoGain).connect(this.tapeWow.delayTime);
    this.wowLfo.start();
    this.tapeDry = ctx.createGain();
    this.tapeWet = ctx.createGain();
    this.tapeDry.gain.value = 0;
    this.tapeWet.gain.value = 1;

    // ---- DELAY (time / feedback<=0.85 / mix) ----
    this.delayNode = ctx.createDelay(2.0);
    this.delayNode.delayTime.value = 0.42;
    this.delayFb = ctx.createGain();
    this.delayFb.gain.value = 0.45;
    this.delayTone = ctx.createBiquadFilter(); // keeps feedback loop from getting harsh
    this.delayTone.type = 'lowpass';
    this.delayTone.frequency.value = 6500;
    this.delayNode.connect(this.delayTone).connect(this.delayFb).connect(this.delayNode);
    this.delayDry = ctx.createGain();
    this.delayWet = ctx.createGain();
    this.delayDry.gain.value = 1;
    this.delayWet.gain.value = 0;

    // ---- REVERB (algorithmic convolution: generated stereo noise IR) ----
    this.convolver = ctx.createConvolver();
    this.reverbPre = ctx.createGain();
    this.reverbDry = ctx.createGain();
    this.reverbWet = ctx.createGain();
    this.reverbDry.gain.value = 1;
    this.reverbWet.gain.value = 0;
    this.irSize = -1;
    this.irDecay = -1;
    this._irTimer = 0;
    this.generateImpulse(0.6, 0.55); // initial IR

    // ---- MASTER (volume → soft clip → limiter) ----
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.8;
    this.softClip = ctx.createWaveShaper();
    this.softClip.oversample = '2x';
    this.setSoftClipCurve(0.9);
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.15;

    // graph wiring
    this.input.connect(this.filter);
    this.input.connect(this.filterDry);
    this.filter.connect(this.filterWet);

    this.filterWet.connect(this.tapePre);
    this.filterDry.connect(this.tapeDry);
    this.tapePre.connect(this.tapeShaper).connect(this.tapeTone).connect(this.tapeWow).connect(this.tapeWet);

    this.tapeWet.connect(this.delayNode);
    this.tapeWet.connect(this.delayDry);
    this.tapeDry.connect(this.delayDry);
    this.delayNode.connect(this.delayWet);

    this.delayDry.connect(this.reverbPre);
    this.delayWet.connect(this.reverbPre);
    this.reverbPre.connect(this.convolver).connect(this.reverbWet);
    this.reverbPre.connect(this.reverbDry);

    this.reverbDry.connect(this.masterGain);
    this.reverbWet.connect(this.masterGain);

    this.masterGain.connect(this.softClip).connect(this.limiter).connect(this.output);

    this.setTapeDrive(1.2);
  }

  setSoftClipCurve(amount) {
    const n = 2048;
    const curve = new Float32Array(n);
    const k = Math.max(0.1, amount) * 6;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    this.softClip.curve = curve;
  }

  setTapeDrive(drive) {
    const d = Math.max(0, Math.min(4, drive));
    if (Math.abs(d - (this._tapeDrive ?? -1)) < 0.001) return;
    this._tapeDrive = d;
    const n = 2048;
    const curve = new Float32Array(n);
    const k = 1 + d * 2.5;
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = (Math.tanh(k * x) / norm) * 0.92;
    }
    this.tapeShaper.curve = curve;
  }

  /** Procedural stereo impulse response: noise * exp decay + early reflections. */
  generateImpulse(size01, decay01) {
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const size = Math.max(0.05, Math.min(1, size01));
    const decay = Math.max(0.05, Math.min(1, decay01));
    const seconds = 0.35 + size * 7.5;          // 0.35 s .. ~7.85 s
    const len = Math.floor(sr * seconds);
    const ir = ctx.createBuffer(2, len, sr);

    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      const decayRate = (2.2 + (1 - decay) * 7) / seconds;
      // diffuse noise tail
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const env = Math.pow(1 - t, 0.5) * Math.exp(-decayRate * t * 6);
        data[i] = (Math.random() * 2 - 1) * env;
      }
      // sparse early reflections for a sense of room size
      const reflections = Math.floor(6 + size * 18);
      for (let r = 0; r < reflections; r++) {
        const idx = Math.floor((0.002 + Math.random() * 0.12 * (0.3 + size)) * sr) + ch * 17;
        if (idx < len) {
          const g = (1 - r / reflections) * 0.55 * (0.5 + decay * 0.5);
          data[idx] += (Math.random() < 0.5 ? -g : g);
        }
      }
      // normalize
      let peak = 0;
      for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(data[i]));
      if (peak > 0) {
        const s = 0.82 / peak;
        for (let i = 0; i < len; i++) data[i] *= s;
      }
    }
    this.convolver.normalize = false;
    this.convolver.buffer = ir;
  }

  /** Debounced IR regeneration while knobs are dragged. */
  requestImpulse(size01, decay01) {
    this.irSize = size01;
    this.irDecay = decay01;
    if (this._irTimer) clearTimeout(this._irTimer);
    this._irTimer = setTimeout(() => {
      this._irTimer = 0;
      try { this.generateImpulse(this.irSize, this.irDecay); } catch (_) { /* keep old IR */ }
    }, 250);
  }

  ramp(param, value, time = 0.02) {
    const now = this.ctx.currentTime;
    param.setTargetAtTime(value, now, time);
  }

  applyParams(p) {
    const fx = p.fx;
    if (!fx) return;

    // FILTER
    const fOn = fx.filter.on && !p.fxBypass;
    this.filter.type = fx.filter.type === 'highpass' ? 'highpass' : 'lowpass';
    this.ramp(this.filter.frequency, Math.max(20, Math.min(20000, fx.filter.cutoff)), 0.02);
    this.ramp(this.filter.Q, Math.max(0.0001, Math.min(25, fx.filter.q)), 0.02);
    this.ramp(this.filterWet.gain, fOn ? 1 : 0);
    this.ramp(this.filterDry.gain, fOn ? 0 : 1);

    // TAPE
    const tOn = fx.tape.on && !p.fxBypass;
    this.ramp(this.tapePre.gain, 1 + Math.max(0, Math.min(2, fx.tape.drive - 1)) * 0.8);
    this.setTapeDrive(fx.tape.drive);
    const toneHz = 400 * Math.pow(40, Math.max(0, Math.min(1, fx.tape.tone)));
    this.ramp(this.tapeTone.frequency, toneHz, 0.05);
    const wowDepth = Math.max(0, Math.min(1, fx.tape.wow)) * 0.0022;
    this.ramp(this.wowLfoGain.gain, wowDepth, 0.08);
    this.ramp(this.tapeDry.gain, tOn ? 0 : 1);
    this.ramp(this.tapeWet.gain, tOn ? 1 : 0);

    // DELAY
    const dOn = fx.delay.on && !p.fxBypass;
    this.ramp(this.delayNode.delayTime, Math.max(0.01, Math.min(1.8, fx.delay.time)), 0.05);
    this.ramp(this.delayFb.gain, Math.max(0, Math.min(0.85, fx.delay.feedback)));
    const dMix = Math.max(0, Math.min(1, fx.delay.mix));
    this.ramp(this.delayWet.gain, dOn ? dMix : 0);
    this.ramp(this.delayDry.gain, dOn ? 1 - dMix * 0.6 : 1);

    // REVERB
    const rOn = fx.reverb.on && !p.fxBypass;
    const rMix = Math.max(0, Math.min(1, fx.reverb.mix));
    this.ramp(this.reverbWet.gain, rOn ? rMix : 0);
    this.ramp(this.reverbDry.gain, rOn ? 1 - rMix * 0.5 : 1);
    if (rOn) this.requestImpulse(fx.reverb.size, fx.reverb.decay);

    // MASTER
    const master = Number.isFinite(p.master) ? p.master : 0.8;
    this.ramp(this.masterGain.gain, Math.max(0, Math.min(1.2, master)), 0.03);
  }

  connectTo(node) {
    this.output.connect(node);
  }

  get tailEstimate() {
    // rough worst-case reverb + delay tail in seconds
    return 0.35 + (this.irSize > 0 ? this.irSize : 0.6) * 7.5;
  }
}

/** Standalone helper used by tests to build a fake parameter tree. */
export function defaultFxParams() {
  return {
    filter: { on: true, type: 'lowpass', cutoff: 8000, q: 0.7 },
    tape: { on: true, drive: 1.2, tone: 0.6, wow: 0.15 },
    delay: { on: true, time: 0.42, feedback: 0.45, mix: 0.25 },
    reverb: { on: true, size: 0.6, decay: 0.55, mix: 0.4 }
  };
}
