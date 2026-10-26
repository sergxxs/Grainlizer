/* GRAINLIZER — granular synthesis AudioWorklet processor.
 * Self-contained (no imports) so it can be loaded with audioWorklet.addModule()
 * and exercised in Node tests via a vm sandbox.
 *
 * Signal: dry "tape monitor" at the playhead + overlapping windowed grains.
 * Grains: Hann window, linear-interpolated reads, fixed output duration in ms,
 * pitch implemented by per-grain resampling (classic granular pitch shift:
 * grain duration stays constant in wall-clock time, grain content is resampled).
 */

'use strict';

const DEFAULTS = {
  position: 0.35,   // 0..1 normalized playhead target
  grainSize: 180,   // ms (output duration of one grain)
  density: 16,      // grains per second
  spray: 0.12,      // 0..1 fraction of selection used for random spawn offset
  pitch: 0,         // semitones
  rate: 1,          // playback rate of playhead / grain content
  jitter: 0.2,      // 0..1 randomization of position / rate / gain / pan
  reverse: false,   // grains read backwards
  freeze: false,    // grains spawn from a locked position, playhead stops
  mix: 0.8          // 0 = dry monitor, 1 = granular
};

const MAX_VOICES = 48;
const MIN_GRAIN_MS = 8;
const MAX_GRAIN_MS = 1500;
const FADE_SAMPLES = 48; // fast release when a grain leaves the buffer

class Voice {
  constructor() {
    this.active = false;
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

    this.buf = [new Float32Array(0), new Float32Array(0)];
    this.bufLen = 0;
    this.selStart = 0;
    this.selEnd = 0;

    this.head = 0;
    this.frozenHead = 0;
    this.spawnPhase = 0;

    this.playing = false;
    this.gainTarget = 0;

    // raw targets from UI
    this.target = Object.assign({}, DEFAULTS);
    // smoothed values used per-sample
    this.sm = {
      grainSize: DEFAULTS.grainSize,
      density: DEFAULTS.density,
      spray: DEFAULTS.spray,
      pitch: DEFAULTS.pitch,
      rate: DEFAULTS.rate,
      jitter: DEFAULTS.jitter,
      mix: DEFAULTS.mix,
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
        const chans = m.channels || [];
        const len = m.length | 0;
        this.buf = [
          chans[0] ? chans[0] : new Float32Array(0),
          chans[1] ? chans[1] : (chans[0] ? chans[0] : new Float32Array(0))
        ];
        this.bufLen = Math.min(len, this.buf[0].length);
        this.selStart = 0;
        this.selEnd = this.bufLen;
        this.head = 0;
        this.frozenHead = 0;
        break;
      }
      case 'clear':
        this.buf = [new Float32Array(0), new Float32Array(0)];
        this.bufLen = 0;
        this.allVoicesOff();
        this.playing = false;
        break;
      case 'selection':
        this.setSelection(m.start, m.end);
        break;
      case 'params': {
        const p = m.params || {};
        for (const k of Object.keys(DEFAULTS)) {
          if (p[k] !== undefined) {
            const v = p[k];
            this.target[k] = (typeof v === 'boolean') ? v : (Number.isFinite(v) ? v : DEFAULTS[k]);
          }
        }
        // position jump is fast, not a slow glide
        break;
      }
      case 'seek': {
        const pos = Number(m.position);
        if (Number.isFinite(pos)) {
          this.target.position = pos;
          this.sm.position = pos;
          this.head = this.normToSample(pos);
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

  setSelection(start, end) {
    if (!this.bufLen) return;
    let a = Math.max(0, Math.min(this.bufLen, Math.floor(Number(start) || 0)));
    let b = Math.max(0, Math.min(this.bufLen, Math.floor(Number(end) || 0)));
    if (b < a) { const t = a; a = b; b = t; }
    if (b - a < 2) { a = 0; b = this.bufLen; }
    this.selStart = a;
    this.selEnd = b;
    // keep head inside the new selection
    if (this.head < a || this.head > b) this.head = a;
    if (this.frozenHead < a || this.frozenHead > b) this.frozenHead = a;
  }

  allVoicesOff() {
    for (const v of this.voices) v.reset();
    this.voiceCount = 0;
    this.spawnPhase = 0;
  }

  normToSample(n) {
    const a = this.selStart;
    const b = this.selEnd > this.selStart + 1 ? this.selEnd : this.bufLen;
    return a + Math.max(0, Math.min(1, n)) * Math.max(0, (b - a));
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
    s.position += (t.position - s.position) * kp;
    if (!Number.isFinite(s.grainSize)) s.grainSize = t.grainSize;
    if (!Number.isFinite(s.density)) s.density = t.density;
    if (!Number.isFinite(s.spray)) s.spray = t.spray;
    if (!Number.isFinite(s.pitch)) s.pitch = t.pitch;
    if (!Number.isFinite(s.rate)) s.rate = t.rate;
    if (!Number.isFinite(s.jitter)) s.jitter = t.jitter;
    if (!Number.isFinite(s.mix)) s.mix = t.mix;
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
    if (Math.abs(t.position - s.position) < snap) s.position = t.position;
  }

  spawnGrain() {
    let slot = null;
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
    } else {
      for (let i = 0; i < MAX_VOICES; i++) {
        if (!this.voices[i].active) { slot = this.voices[i]; break; }
      }
      if (!slot) return;
      this.voiceCount++;
    }

    const selLen = Math.max(1, this.selEnd - this.selStart);
    const s = this.sm;
    const jitter = Math.max(0, Math.min(1, s.jitter));

    // spawn anchor: frozen head or live playhead, plus spray + jitter scatter
    const anchor = this.target.freeze ? this.frozenHead : this.head;
    const spraySpan = s.spray * selLen;
    const jitterSpan = jitter * selLen * 0.08;
    let pos = anchor
      + (Math.random() - 0.5) * spraySpan
      + (Math.random() - 0.5) * jitterSpan;

    // clamp spawn into selection
    if (pos < this.selStart) pos = this.selStart;
    if (pos > this.selEnd - 1) pos = this.selEnd - 1;
    if (!Number.isFinite(pos)) pos = this.selStart;

    const sizeMs = Math.max(MIN_GRAIN_MS, Math.min(MAX_GRAIN_MS, s.grainSize));
    const length = Math.max(8, (sizeMs / 1000) * this.outRate);

    const pitchFactor = Math.pow(2, s.pitch / 12);
    const jitterRate = 1 + (Math.random() - 0.5) * jitter * 0.12;
    let rate = s.rate * pitchFactor * jitterRate;
    if (!Number.isFinite(rate) || rate === 0) rate = 1;
    if (this.target.reverse) rate = -rate;
    // keep rate sane so grains do not teleport through the buffer
    const maxRate = selLen / 8;
    if (rate > maxRate) rate = maxRate;
    if (rate < -maxRate) rate = -maxRate;

    // equal-power pan with jitter width
    const pan = (Math.random() - 0.5) * jitter * 1.4;
    const panC = Math.max(-1, Math.min(1, pan));
    const angle = (panC + 1) * Math.PI / 4;
    const gainVar = 1 + (Math.random() - 0.5) * jitter * 0.3;
    slot.active = true;
    slot.pos = pos;
    slot.rate = rate;
    slot.length = length;
    slot.age = 0;
    slot.gl = Math.cos(angle) * gainVar;
    slot.gr = Math.sin(angle) * gainVar;
    slot.releasing = false;
    slot.fade = 0;
  }

  readAt(x, ch) {
    const buf = this.buf[ch];
    const n = this.bufLen;
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

    if (this.bufLen < 2) {
      outL.fill(0);
      if (outR !== outL) outR.fill(0);
      return true;
    }

    const s = this.sm;
    const selLen = Math.max(1, this.selEnd - this.selStart);
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

      // playhead drift (unless frozen / stopped)
      if (this.playing && !this.target.freeze) {
        this.head += rateBase;
        if (this.head >= this.selEnd) {
          this.head = this.selStart + ((this.head - this.selStart) % selLen);
        } else if (this.head < this.selStart) {
          this.head = this.selEnd - ((this.selEnd - this.head) % selLen);
        }
        if (!Number.isFinite(this.head)) this.head = this.selStart;
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

      // dry monitor: sample at playhead (interpolated), gated by play state
      const rawL = this.readAt(this.head, 0);
      const rawR = this.buf[1] !== this.buf[0] ? this.readAt(this.head, 1) : rawL;
      let dryL = rawL * this.dryGate;
      let dryR = rawR * this.dryGate;

      // granular sum
      let gL = 0, gR = 0;
      for (let vi = 0; vi < MAX_VOICES; vi++) {
        const v = this.voices[vi];
        if (!v.active) continue;

        let w = 0.5 * (1 - Math.cos((2 * Math.PI * v.age) / v.length));
        if (v.releasing) {
          w *= v.fade / FADE_SAMPLES;
          v.fade--;
          if (v.fade <= 0) { v.reset(); this.voiceCount--; continue; }
        }

        const sl = this.readAt(v.pos, 0);
        const sr = this.buf[1] !== this.buf[0] ? this.readAt(v.pos, 1) : sl;
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
        if (!v.releasing && (v.pos < this.selStart - 1 || v.pos > this.selEnd + 1 ||
            v.pos < -1 || v.pos > this.bufLen + 1)) {
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
