/* GRAINLIZER — master recorder tap (AudioWorklet).
 * Receives the post-master stereo signal and streams PCM blocks to the main
 * thread through a flush queue. No microphone, no MediaRecorder: this taps the
 * internal master bus so the recording is exactly what the user hears.
 */

'use strict';

const FLUSH_FRAMES = 4096;

class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.totalFrames = 0;
    this.writeIdx = 0;
    this.pendingL = new Float32Array(FLUSH_FRAMES);
    this.pendingR = new Float32Array(FLUSH_FRAMES);
    this.flushedChunks = 0;

    this.port.onmessage = (e) => {
      const m = e.data;
      if (!m || typeof m !== 'object') return;
      if (m.type === 'start') {
        this.recording = true;
        this.totalFrames = 0;
        this.writeIdx = 0;
        this.flushedChunks = 0;
      } else if (m.type === 'stop') {
        this.flush();
        this.recording = false;
        this.port.postMessage({ type: 'done', totalFrames: this.totalFrames });
      } else if (m.type === 'reset') {
        this.recording = false;
        this.totalFrames = 0;
        this.writeIdx = 0;
      }
    };
  }

  flush() {
    if (this.writeIdx <= 0) return;
    const n = this.writeIdx;
    const l = this.pendingL.slice(0, n);
    const r = this.pendingR.slice(0, n);
    this.writeIdx = 0;
    this.flushedChunks++;
    this.port.postMessage({ type: 'chunk', l, r, frames: n }, [l.buffer, r.buffer]);
  }

  process(inputs, outputs) {
    // pass audio through untouched (this node sits in a parallel tap branch)
    const input = inputs[0];
    if (this.recording && input && input.length > 0 && input[0] && input[0].length > 0) {
      const inL = input[0];
      const inR = input.length > 1 && input[1] ? input[1] : input[0];
      const n = inL.length;
      let i = 0;
      while (i < n) {
        const space = FLUSH_FRAMES - this.writeIdx;
        const take = Math.min(space, n - i);
        this.pendingL.set(inL.subarray(i, i + take), this.writeIdx);
        this.pendingR.set(inR.subarray(i, i + take), this.writeIdx);
        this.writeIdx += take;
        this.totalFrames += take;
        i += take;
        if (this.writeIdx >= FLUSH_FRAMES) this.flush();
      }
    }
    return true;
  }
}

registerProcessor('recorder-processor', RecorderProcessor);
