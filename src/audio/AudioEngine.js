/* GRAINLIZER — AudioEngine.
 * Owns the AudioContext, sample buffer, granular worklet, effects chain and
 * the internal master recorder tap. All signal processing is local.
 */

'use strict';

import { EffectsChain, defaultFxParams } from './EffectsChain.js';

const TAU = 2 * Math.PI;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.granularNode = null;
    this.recorderNode = null;
    this.effects = null;
    this.buffer = null;          // decoded AudioBuffer (context rate)
    this.meta = null;            // { name, duration, sampleRate, channels }
    this.selection = { start: 0, end: 0 };
    this.playing = false;
    this.ready = false;
    this.recordingActive = false;
    this.params = {
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
      fx: defaultFxParams()
    };
    this.onStatus = null;        // (status) => {}
    this.onSampleLoaded = null;  // (meta) => {}
    this._recorderChunks = [];
    this._recorderDone = null;
  }

  async init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('Web Audio API is not available in this browser');
    this.ctx = new AC({ latencyHint: 'interactive' });

    await this.ctx.audioWorklet.addModule('src/audio/granular-worklet.js');
    await this.ctx.audioWorklet.addModule('src/audio/recorder-worklet.js');

    this.granularNode = new AudioWorkletNode(this.ctx, 'granular-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit'
    });
    this.granularNode.port.onmessage = (e) => {
      if (e.data && e.data.type === 'status' && this.onStatus) this.onStatus(e.data);
    };

    this.effects = new EffectsChain(this.ctx);
    this.granularNode.connect(this.effects.input);

    // master tap: one node feeds both the device output and the recorder,
    // so what is recorded is exactly what is heard (no doubled signal).
    this.recorderNode = new AudioWorkletNode(this.ctx, 'recorder-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit'
    });
    this.recorderNode.port.onmessage = (e) => {
      const m = e.data;
      if (!m) return;
      if (m.type === 'chunk') {
        this._recorderChunks.push({ l: m.l, r: m.r });
      } else if (m.type === 'done') {
        const done = this._recorderDone;
        this._recorderDone = null;
        if (done) done({ totalFrames: m.totalFrames, chunks: this._recorderChunks });
      }
    };

    // Master tap: the same post-effects signal feeds the recorder and the
    // device output. The recorder branch must reach the destination through a
    // zero-gain sink — otherwise the graph would never pull the worklet and
    // nothing would be captured.
    this.recorderSink = this.ctx.createGain();
    this.recorderSink.gain.value = 0;
    this.effects.connectTo(this.recorderNode);
    this.recorderNode.connect(this.recorderSink);
    this.recorderSink.connect(this.ctx.destination);
    this.effects.connectTo(this.ctx.destination);

    this.pushParams();
    this.ready = true;
  }

  async resume() {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch (_) { /* handled by caller */ }
    }
  }

  get state() {
    return this.ctx ? this.ctx.state : 'closed';
  }

  /* ---------------- sample handling ---------------- */

  async loadFile(file) {
    if (!file) return null;
    await this.init();
    const arrayBuffer = await file.arrayBuffer();
    let audioBuffer;
    try {
      audioBuffer = await this.ctx.decodeAudioData(arrayBuffer.slice(0));
    } catch (err) {
      throw new Error(`Cannot decode "${file.name}". Supported: formats the browser can decode (WAV, MP3, AAC/M4A, OGG…).`);
    }
    this.setBuffer(audioBuffer, {
      name: file.name,
      duration: audioBuffer.duration,
      sampleRate: audioBuffer.sampleRate,
      channels: audioBuffer.numberOfChannels
    });
    return this.meta;
  }

  /** Programmatic original demo sample (additive pad + noise texture). */
  async createDemoSample() {
    await this.init();
    const sr = this.ctx.sampleRate;
    const seconds = 7.5;
    const len = Math.floor(sr * seconds);
    const buf = this.ctx.createBuffer(2, len, sr);
    // Original generated content: slow glassy drone with beating partials.
    const partials = [
      { f: 110, a: 0.30 }, { f: 164.81, a: 0.22 }, { f: 220, a: 0.18 },
      { f: 277.18, a: 0.12 }, { f: 329.63, a: 0.10 }, { f: 440, a: 0.08 },
      { f: 554.37, a: 0.06 }, { f: 659.25, a: 0.05 }, { f: 880, a: 0.035 }
    ];
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      const detune = ch === 0 ? 1.0 : 1.0018;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const env = Math.min(1, t / 1.2) * Math.min(1, (seconds - t) / 1.5);
        let s = 0;
        for (let p = 0; p < partials.length; p++) {
          const ph = TAU * partials[p].f * detune * t + p * 1.7 + ch * 0.35;
          const trem = 0.75 + 0.25 * Math.sin(TAU * (0.07 + p * 0.013) * t);
          s += Math.sin(ph) * partials[p].a * trem;
        }
        // soft noise shimmer
        const noise = (Math.random() * 2 - 1) * 0.028 * (0.6 + 0.4 * Math.sin(TAU * 0.11 * t + ch));
        s = s * env + noise * env;
        // slow stereo movement
        const pan = 0.5 + 0.5 * Math.sin(TAU * 0.05 * t + (ch ? Math.PI : 0));
        data[i] = s * (0.55 + 0.45 * pan) * 0.55;
      }
    }
    this.setBuffer(buf, {
      name: 'DEMO — GRAINLIZER PAD (generated)',
      duration: buf.duration,
      sampleRate: buf.sampleRate,
      channels: buf.numberOfChannels
    });
    return this.meta;
  }

  setBuffer(audioBuffer, meta) {
    this.stop(true);
    this.buffer = audioBuffer;
    this.meta = meta;
    const frames = audioBuffer.length;
    this.selection = { start: 0, end: frames };

    // copy channel data once and transfer to the worklet (no duplicates kept)
    const ch0 = new Float32Array(audioBuffer.getChannelData(0));
    const sameBuffer = audioBuffer.numberOfChannels === 1;
    const ch1 = sameBuffer ? ch0 : new Float32Array(audioBuffer.getChannelData(1));

    const transfer = sameBuffer ? [ch0.buffer] : [ch0.buffer, ch1.buffer];
    this.granularNode.port.postMessage({
      type: 'buffer',
      length: frames,
      channels: [ch0, ch1]
    }, transfer);

    this.granularNode.port.postMessage({ type: 'selection', start: 0, end: frames });
    this.params.position = 0.35;
    this.pushParams();
    if (this.onSampleLoaded) this.onSampleLoaded(this.meta);
  }

  clearSample() {
    this.stop(true);
    this.buffer = null;
    this.meta = null;
    this.selection = { start: 0, end: 0 };
    if (this.granularNode) this.granularNode.port.postMessage({ type: 'clear' });
    if (this.onSampleLoaded) this.onSampleLoaded(null);
  }

  setSelection(startFrac, endFrac) {
    if (!this.buffer) return;
    const frames = this.buffer.length;
    let a = Math.floor(Math.max(0, Math.min(1, startFrac)) * frames);
    let b = Math.floor(Math.max(0, Math.min(1, endFrac)) * frames);
    if (b - a < 32) { a = 0; b = frames; }
    this.selection = { start: a, end: b };
    this.granularNode.port.postMessage({ type: 'selection', start: a, end: b });
    // keep the position knob meaningful inside the selection
    this.seek(this.params.position);
  }

  seek(positionFrac) {
    const pos = Math.max(0, Math.min(1, positionFrac));
    this.params.position = pos;
    if (this.granularNode) this.granularNode.port.postMessage({ type: 'seek', position: pos });
  }

  /* ---------------- params ---------------- */

  setParam(key, value) {
    this.params[key] = value;
    if (key === 'position') {
      this.seek(value);
      return;
    }
    this.pushParams();
  }

  setFxParam(section, key, value) {
    if (!this.params.fx[section]) return;
    this.params.fx[section][key] = value;
    this.pushParams();
  }

  pushParams() {
    if (!this.granularNode) return;
    const p = this.params;
    this.granularNode.port.postMessage({
      type: 'params',
      params: {
        position: p.position,
        grainSize: p.grainSize,
        density: p.density,
        spray: p.spray,
        pitch: p.pitch,
        rate: p.rate,
        jitter: p.jitter,
        reverse: !!p.reverse,
        freeze: !!p.freeze,
        mix: p.mix
      }
    });
    if (this.effects) this.effects.applyParams(p);
  }

  /* ---------------- transport ---------------- */

  async play() {
    if (!this.buffer) throw new Error('Load a sample first');
    await this.resume();
    this.granularNode.port.postMessage({ type: 'play' });
    this.playing = true;
  }

  /** stop: new grains stop, sounding grains decay naturally. */
  stop(panic = false) {
    if (!this.granularNode) return;
    this.granularNode.port.postMessage({ type: panic ? 'panic' : 'stop' });
    this.playing = false;
  }

  /* ---------------- recording tap ---------------- */

  startRecording() {
    this._recorderChunks = [];
    this.recorderNode.port.postMessage({ type: 'start' });
    this.recordingActive = true;
  }

  stopRecording() {
    return new Promise((resolve, reject) => {
      if (!this.recordingActive) {
        reject(new Error('Not recording'));
        return;
      }
      this._recorderDone = (result) => {
        this.recordingActive = false;
        resolve(result);
      };
      this.recorderNode.port.postMessage({ type: 'stop' });
      // safety timeout: if the worklet never answers, fail predictably
      setTimeout(() => {
        if (this._recorderDone) {
          const done = this._recorderDone;
          this._recorderDone = null;
          this.recordingActive = false;
          done({ totalFrames: -1, chunks: this._recorderChunks });
        }
      }, 3000);
    });
  }

  discardRecording() {
    this._recorderChunks = [];
    if (this.recorderNode) this.recorderNode.port.postMessage({ type: 'reset' });
    this.recordingActive = false;
  }
}
