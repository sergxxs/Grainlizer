/* GRAINLIZER — granular synthesis AudioWorklet processor.
 * Self-contained (no imports) so it can be loaded with audioWorklet.addModule()
 * and exercised in Node tests via a vm sandbox.
 *
 * Two sample slots (A/B) with a smooth granular crossfade (SLOT MIX): each new
 * grain picks its source probabilistically, so the texture morphs organically.
 * Grains: selectable window (Hann / Tukey / percussive / reverse), linear
 * interpolated reads, fixed output duration in ms, per-grain width panning.
 * Head & selection are NORMALIZED (0..1) and shared between slots.
 */

'use strict';

const DEFAULTS = {
  position: 0.35,   // 0..1 normalized playhead target
  grainSize: 180,   // ms (output duration of one grain)
  density: 16,      // grains per second
  spray: 0.12,      // 0..1 fraction of selection used for random spawn offset
  pitch: 0,         // semitones
  rate: 1,          // playback rate of playhead / grain content
  jitter: 0.2,      // 0..1 randomization of position / rate / gain
  reverse: false,   // grains read backwards
  freeze: false,    // grains spawn from a locked position, playhead stops
  mix: 0.8,         // 0 = dry monitor, 1 = granular
  slotMix: 0,       // 0 = slot A only, 1 = slot B only (granular crossfade)
  width: 0.7,       // 0 = mono grains, 1 = full random stereo spread
  window: 'hann'    // hann | tukey | perc | rev
};

const WINDOWS = ['hann', 'tukey', 'perc', 'rev'];
const MAX_VOICES = 48;
const MIN_GRAIN_MS = 8;
const MAX_GRAIN_MS = 1500;
const FADE_SAMPLES = 48; // fast release when a grain leaves the buffer

function grainWindow(kind, t) {
  // t is normalized grain age 0..1
  switch (kind) {
    case 'tukey': {
      const alpha = 0.5;
      if (t < alpha / 2) return 0.5 * (1 + Math.cos(Math.PI * (2 * t / alpha - 1)));
      if (t > 1 - alpha / 2) return 0.5 * (1 + Math.cos(Math.PI * (2 * t / alpha - 2 / alpha + 1)));
      return 1;
    }
    case 'perc': // fast attack, slow decay
      return Math.pow(1 - t, 1.8);
    case 'rev': // slow attack, fast release
      return Math.pow(t, 1.8);
    default: // hann
      return 0.5 * (1 - Math.cos(2 * Math.PI * t));
  }
}

class Voice {
  constructor() {
    this.active = false;
    this.slot = 0;
    this.pos = 0;
    this.rate = 1;
    this.length = 1;
    this.age = 0;
    this.gl = 0.7;
    this.gr = 0.7;
    this.releasing = false;
    this.fade = 0;
  }
  reset() {
    this.active = false;
    this.releasing = false;
    this.fade = 0;
    this.age = 0;
  }
}

class GranularProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.outRate = sampleRate; // AudioWorklet global

    const emptySlot = () => ({
      buf: [new Float32Array(0), new Float32Array(0)],
      len: 0,
      selA: 0,
      selB: 0
    });
    this.slots = [emptySlot(), emptySlot()];

    this.selStartN = 0;   // normalized selection (shared by both slots)
    this.selEndN = 1;
    this.head = 0;        // normalized playhead
    this.frozenHead = 0;
    this.spawnPhase = 0;

    this.playing = false;

    this.target = Object.assign({}, DEFAULTS);
    this.sm = {
      grainSize: DEFAULTS.grainSize,
      density: DEFAULTS.density,
      spray: DEFAULTS.spray,
      pitch: DEFAULTS.pitch,
      rate: DEFAULTS.rate,
      jitter: DEFAULTS.jitter,
      mix: DEFAULTS.mix,
      slotMix: DEFAULTS.slotMix,
      width: DEFAULTS.width,
      position: DEFAULTS.position
    };

    this.voices = [];
    for (let i = 0; i < MAX_VOICES; i++) this.voices.push(new Voice());
    this.voiceCount = 0;

    this.blockCount = 0;
    this.peak = 0;
    this.dryGate = 0; // smooth mute of the dry monitor (stop / freeze)

    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(m) {
    if (!m || typeof m !== 'object') return;
    switch (m.type) {
      case 'buffer': {
        const slotIdx = m.slot === 1 ? 1 : 0;
        const chans = m.channels || [];
        const len = Math.max(0, m.length | 0);
        const slot = this.slots[slotIdx];
        slot.buf = [
          chans[0] ? chans[0] : new Float32Array(0),
          chans[1] ? chans[1] : (chans[0] ? chans[0] : new Float32Array(0))
        ];
        slot.len = Math.min(len, slot.buf[0].length);
        this.applySelection();
        this.head = 0;
        this.frozenHead = 0;
        break;
      }
      case 'clear': {
        const slotIdx = m.slot === 1 ? 1 : 0;
        const slot = this.slots[slotIdx];
        slot.buf = [new Float32Array(0), new Float32Array(0)];
        slot.len = 0;
        if (this.slots[0].len < 2 && this.slots[1].len < 2) {
          this.allVoicesOff();
          this.playing = false;
        }
        break;
      }
      case 'selection': {
        // normalized fractions (legacy sample-frame values are converted)
        let a = Number(m.start);
        let b = Number(m.end);
        if (!Number.isFinite(a)) a = 0;
        if (!Number.isFinite(b)) b = 1;
        if (!m.normalized && (a > 1.5 || b > 1.5)) {
          const ref = Math.max(1, this.slots[0].len || this.slots[1].len);
          a = a / ref;
          b = b / ref;
        }
        this.setSelectionNorm(a, b);
        break;
      }
      case 'params': {
        const p = m.params || {};
        for (const k of Object.keys(DEFAULTS)) {
          if (p[k] !== undefined) {
            const v = p[k];
            if (typeof DEFAULTS[k] === 'boolean') {
              this.target[k] = !!v;
            } else if (typeof DEFAULTS[k] === 'string') {
              this.target[k] = (typeof v === 'string' && WINDOWS.includes(v)) ? v : DEFAULTS[k];
            } else {
              this.target[k] = Number.isFinite(v) ? v : DEFAULTS[k];
            }
          }
        }
        break;
      }
      case 'seek': {
        const pos = Number(m.position);
        if (Number.isFinite(pos)) {
          this.target.position = pos;
          this.sm.position = pos;
          this.head = Math.max(0, Math.min(1, pos));
          this.frozenHead = this.head;
        }
        break;
      }
      case 'play':
        this.playing = true;
        break;
      case 'stop':
        // stop spawning + stop playhead, let sounding grains finish naturally
        this.playing = false;
        break;
      case 'panic':
        this.allVoicesOff();
        this.playing = false;
        this.dryGate = 0; // instant mute
        break;
      default:
        break;
    }
  }

  setSelectionNorm(a, b) {
    let x = Math.max(0, Math.min(1, a));
    let y = Math.max(0, Math.min(1, b));
    if (y < x) { const t = x; x = y; y = t; }
    if (y - x < 0.002) { x = 0; y = 1; }
    this.selStartN = x;
    this.selEndN = y;
    this.applySelection();
    if (this.head < x || this.head > y) this.head = x;
    if (this.frozenHead < x || this.frozenHead > y) this.frozenHead = x;
  }

  applySelection() {
    for (const slot of this.slots) {
      slot.selA = this.selStartN * slot.len;
      slot.selB = this.selEndN * slot.len;
    }
  }

  allVoicesOff() {
    for (const v of this.voices) v.reset();
    this.voiceCount = 0;
    this.spawnPhase = 0;
  }

  smooth() {
    // one-pole smoothing, ~15 ms time constant for most params (per-sample)
    const k = 1 - Math.exp(-1 / (0.015 * this.outRate));
    const kp = 1 - Math.exp(-1 / (0.004 * this.outRate)); // position responds faster
    const t = this.target, s = this.sm;
    s.grainSize += (t.grainSize - s.grainSize) * k;
    s.density += (t.density - s.density) * k;
    s.spray += (t.spray - s.spray) * k;
    s.pitch += (t.pitch - s.pitch) * k;
    s.rate += (t.rate - s.rate) * k;
    s.jitter += (t.jitter - s.jitter) * k;
    s.mix += (t.mix - s.mix) * k;
    s.slotMix += (t.slotMix - s.slotMix) * k;
    s.width += (t.width - s.width) * k;
    s.position += (t.position - s.position) * kp;
    if (!Number.isFinite(s.grainSize)) s.grainSize = t.grainSize;
    if (!Number.isFinite(s.density)) s.density = t.density;
    if (!Number.isFinite(s.spray)) s.spray = t.spray;
    if (!Number.isFinite(s.pitch)) s.pitch = t.pitch;
    if (!Number.isFinite(s.rate)) s.rate = t.rate;
    if (!Number.isFinite(s.jitter)) s.jitter = t.jitter;
    if (!Number.isFinite(s.mix)) s.mix = t.mix;
    if (!Number.isFinite(s.slotMix)) s.slotMix = t.slotMix;
    if (!Number.isFinite(s.width)) s.width = t.width;
    if (!Number.isFinite(s.position)) s.position = t.position;
    // snap when converged (avoids endless denormal drift, exact zero crossings)
    const snap = 1e-5;
    if (Math.abs(t.grainSize - s.grainSize) < snap) s.grainSize = t.grainSize;
    if (Math.abs(t.density - s.density) < snap) s.density = t.density;
    if (Math.abs(t.spray - s.spray) < snap) s.spray = t.spray;
    if (Math.abs(t.pitch - s.pitch) < snap) s.pitch = t.pitch;
    if (Math.abs(t.rate - s.rate) < snap) s.rate = t.rate;
    if (Math.abs(t.jitter - s.jitter) < snap) s.jitter = t.jitter;
    if (Math.abs(t.mix - s.mix) < snap) s.mix = t.mix;
    if (Math.abs(t.slotMix - s.slotMix) < snap) s.slotMix = t.slotMix;
    if (Math.abs(t.width - s.width) < snap) s.width = t.width;
    if (Math.abs(t.position - s.position) < snap) s.position = t.position;
  }

  pickSlot() {
    const hasA = this.slots[0].len >= 2;
    const hasB = this.slots[1].len >= 2;
    if (!hasA && !hasB) return -1;
    if (!hasA) return 1;
    if (!hasB) return 0;
    return Math.random() < this.sm.slotMix ? 1 : 0;
  }

  spawnGrain() {
    const slotIdx = this.pickSlot();
    if (slotIdx < 0) return; // no buffers at all

    let slot = null;
    let stolen = false;
    if (this.voiceCount >= MAX_VOICES) {
      // steal the oldest (lowest remaining life ratio) — count stays unchanged
      let best = -1, bestScore = Infinity;
      for (let i = 0; i < MAX_VOICES; i++) {
        const v = this.voices[i];
        if (!v.active) continue;
        const score = (v.length - v.age);
        if (score < bestScore) { bestScore = score; best = i; }
      }
      if (best < 0) return;
      slot = this.voices[best];
      slot.reset();
      stolen = true;
    } else {
      for (let i = 0; i < MAX_VOICES; i++) {
        if (!this.voices[i].active) { slot = this.voices[i]; break; }
      }
      if (!slot) return;
      this.voiceCount++;
    }
    if (!stolen && this.voiceCount > MAX_VOICES) this.voiceCount = MAX_VOICES;

    const src = this.slots[slotIdx];
    const selLenN = Math.max(1e-4, this.selEndN - this.selStartN);
    const s = this.sm;
    const jitter = Math.max(0, Math.min(1, s.jitter));

    // spawn anchor: frozen head or live playhead, plus spray + jitter scatter
    const anchor = this.target.freeze ? this.frozenHead : this.head;
    const spraySpan = s.spray * selLenN;
    const jitterSpan = jitter * selLenN * 0.08;
    let posN = anchor
      + (Math.random() - 0.5) * spraySpan
      + (Math.random() - 0.5) * jitterSpan;

    if (posN < this.selStartN) posN = this.selStartN;
    if (posN > this.selEndN - 1e-4) posN = this.selEndN - 1e-4;
    if (!Number.isFinite(posN)) posN = this.selStartN;

    const sizeMs = Math.max(MIN_GRAIN_MS, Math.min(MAX_GRAIN_MS, s.grainSize));
    const length = Math.max(8, (sizeMs / 1000) * this.outRate);

    const pitchFactor = Math.pow(2, s.pitch / 12);
    const jitterRate = 1 + (Math.random() - 0.5) * jitter * 0.12;
    let rate = s.rate * pitchFactor * jitterRate;
    if (!Number.isFinite(rate) || rate === 0) rate = 1;
    if (this.target.reverse) rate = -rate;
    // keep rate sane so grains do not teleport through the buffer
    const selLenSamples = Math.max(1, (this.selEndN - this.selStartN) * src.len);
    const maxRate = selLenSamples / 8;
    if (rate > maxRate) rate = maxRate;
    if (rate < -maxRate) rate = -maxRate;

    // stereo width: 0 = centered mono, 1 = full random spread
    const width = Math.max(0, Math.min(1, s.width));
    const pan = (Math.random() - 0.5) * 2 * width;
    const panC = Math.max(-1, Math.min(1, pan));
    const angle = (panC + 1) * Math.PI / 4;
    const gainVar = 1 + (Math.random() - 0.5) * jitter * 0.3;
    slot.active = true;
    slot.slot = slotIdx;
    slot.pos = posN * src.len;
    slot.rate = rate;
    slot.length = length;
    slot.age = 0;
    slot.gl = Math.cos(angle) * gainVar;
    slot.gr = Math.sin(angle) * gainVar;
    slot.releasing = false;
    slot.fade = 0;
  }

  readAt(x, ch, slotIdx) {
    const src = this.slots[slotIdx];
    const buf = src.buf[ch];
    const n = src.len;
    if (n <= 0) return 0;
    if (n === 1) return buf[0];
    let i = Math.floor(x);
    if (i < 0 || i > n - 2) {
      if (i < 0) return buf[0];
      return buf[n - 1];
    }
    const frac = x - i;
    const a = buf[i];
    const b = buf[i + 1];
    return a + (b - a) * frac;
  }

  process(inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const outL = out[0];
    const outR = out.length > 1 ? out[1] : out[0];
    const N = outL.length;

    const hasA = this.slots[0].len >= 2;
    const hasB = this.slots[1].len >= 2;
    if (!hasA && !hasB) {
      outL.fill(0);
      if (outR !== outL) outR.fill(0);
      return true;
    }

    const s = this.sm;
    const selLenN = Math.max(1e-4, this.selEndN - this.selStartN);
    const refLen = Math.max(8,
      ((hasA ? this.slots[0].len : 0) + (hasB ? this.slots[1].len : 0)) /
      Math.max(1, (hasA ? 1 : 0) + (hasB ? 1 : 0)));
    const rateBase = s.rate;
    const mix = Math.max(0, Math.min(1, s.mix));
    const dryG = Math.cos(mix * Math.PI / 2);
    const granG = Math.sin(mix * Math.PI / 2);
    // dry monitor only while actively playing and not frozen (no DC on freeze)
    const dryTarget = (this.playing && !this.target.freeze) ? 1 : 0;

    let peak = 0;

    for (let i = 0; i < N; i++) {
      this.smooth();
      this.dryGate += (dryTarget - this.dryGate) * 0.004;

      // playhead drift (unless frozen / stopped), normalized
      if (this.playing && !this.target.freeze) {
        this.head += rateBase / refLen;
        if (this.head >= this.selEndN) {
          this.head = this.selStartN + ((this.head - this.selStartN) % selLenN);
        } else if (this.head < this.selStartN) {
          this.head = this.selEndN - ((this.selEndN - this.head) % selLenN);
        }
        if (!Number.isFinite(this.head)) this.head = this.selStartN;
      }
      if (this.target.freeze) {
        this.frozenHead = this.head;
      }

      // grain scheduling: phase accumulator => density grains / second
      if (this.playing) {
        const density = Math.max(0, Math.min(200, s.density));
        this.spawnPhase += density / this.outRate;
        let guard = 0;
        while (this.spawnPhase >= 1 && guard < 8) {
          this.spawnPhase -= 1;
          this.spawnGrain();
          guard++;
        }
        if (this.spawnPhase > 8) this.spawnPhase = 0;
      }

      // dry monitor: crossfaded slots at the playhead (interpolated)
      const posA = this.head * this.slots[0].len;
      const posB = this.head * this.slots[1].len;
      const rawA_L = hasA ? this.readAt(posA, 0, 0) : 0;
      const rawA_R = hasA ? (this.slots[0].buf[1] !== this.slots[0].buf[0] ? this.readAt(posA, 1, 0) : rawA_L) : 0;
      const rawB_L = hasB ? this.readAt(posB, 0, 1) : 0;
      const rawB_R = hasB ? (this.slots[1].buf[1] !== this.slots[1].buf[0] ? this.readAt(posB, 1, 1) : rawB_L) : 0;
      const wB = (hasA && hasB) ? s.slotMix : (hasB ? 1 : 0);
      const wA = 1 - wB;
      const rawL = rawA_L * wA + rawB_L * wB;
      const rawR = rawA_R * wA + rawB_R * wB;
      const dryL = rawL * this.dryGate;
      const dryR = rawR * this.dryGate;

      // granular sum
      let gL = 0, gR = 0;
      for (let vi = 0; vi < MAX_VOICES; vi++) {
        const v = this.voices[vi];
        if (!v.active) continue;

        let w = grainWindow(this.target.window, v.age / v.length);
        if (v.releasing) {
          w *= v.fade / FADE_SAMPLES;
          v.fade--;
          if (v.fade <= 0) { v.reset(); this.voiceCount--; continue; }
        }

        const src = this.slots[v.slot];
        const sl = this.readAt(v.pos, 0, v.slot);
        const sr = src.buf[1] !== src.buf[0] ? this.readAt(v.pos, 1, v.slot) : sl;
        gL += sl * w * v.gl;
        gR += sr * w * v.gr;

        v.pos += v.rate;
        v.age++;

        if (v.age >= v.length) {
          v.reset();
          this.voiceCount--;
          continue;
        }
        // boundary release (avoids truncation clicks)
        if (!v.releasing && (v.pos < src.selA - 1 || v.pos > src.selB + 1 ||
            v.pos < -1 || v.pos > src.len + 1)) {
          v.releasing = true;
          v.fade = FADE_SAMPLES;
        }
      }
      if (this.voiceCount < 0) this.voiceCount = 0;

      let l = dryL * dryG + gL * granG;
      let r = dryR * dryG + gR * granG;
      if (!Number.isFinite(l)) l = 0;
      if (!Number.isFinite(r)) r = 0;
      // hard safety clamp
      if (l > 4) l = 4; else if (l < -4) l = -4;
      if (r > 4) r = 4; else if (r < -4) r = -4;

      outL[i] = l;
      if (outR !== outL) outR[i] = r;

      const al = l < 0 ? -l : l;
      const ar = r < 0 ? -r : r;
      if (al > peak) peak = al;
      if (ar > peak) peak = ar;
    }

    this.peak = peak;
    this.blockCount++;
    if ((this.blockCount & 7) === 0) {
      this.port.postMessage({
        type: 'status',
        head: this.head,
        voiceCount: this.voiceCount,
        playing: this.playing,
        peak: this.peak
      });
    }
    return true;
  }
}

registerProcessor('granular-processor', GranularProcessor);
