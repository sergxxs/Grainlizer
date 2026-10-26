/* GRAINLIZER — recording controller.
 * Orchestrates REC → (live capture of master bus) → STOP → effect tail capture
 * → finalize. Memory use is estimated and capped; the recorder tap streams
 * small chunks so no single huge allocation is required up front.
 */

'use strict';

export const MAX_RECORD_MINUTES = 20;
export const WARN_RECORD_MINUTES = 5;

export class Recorder {
  constructor(engine) {
    this.engine = engine;
    this.state = 'idle';        // idle | recording | tail | finalizing | ready | error
    this.startedAt = 0;
    this.tailSeconds = 2;
    this.result = null;         // { chunks, totalFrames, sampleRate, numChannels, durationSec }
    this.error = null;
    this.onChange = null;       // (state) => {}
    this.onTick = null;         // ({ elapsed, tailRemaining, maxedOut }) => {}
    this._tickTimer = 0;
    this._tailTimer = 0;
    this._tailDeadline = 0;
  }

  get recording() {
    return this.state === 'recording' || this.state === 'tail';
  }

  memoryEstimateMB(seconds) {
    const sr = this.engine.ctx ? this.engine.ctx.sampleRate : 48000;
    // float32 stereo capture + wav copy headroom
    return (seconds * sr * 2 * 4 * 1.6) / (1024 * 1024);
  }

  async start() {
    if (this.recording) return;
    if (!this.engine.ready || !this.engine.buffer) {
      this.error = 'Нет семпла — загрузите файл или DEMO';
      this._setState('error');
      throw new Error(this.error);
    }
    // the audio graph must actually run, otherwise nothing is captured
    const state = await this.engine.resume();
    if (state !== 'running') {
      this.error = 'Аудио заблокировано браузером — нажмите на экран и повторите';
      this._setState('error');
      throw new Error(this.error);
    }
    this.error = null;
    this.result = null;
    this.engine.startRecording();
    this.startedAt = performance.now();
    this._setState('recording');
    this._startTicks();
  }

  /**
   * STOP: no new grains, keep capturing while reverb/delay tails ring out,
   * then finalize the chunk list. Does NOT cut the tail short.
   */
  stop() {
    if (this.state === 'recording') {
      this.engine.stop(false); // grains stop, effects keep ringing
      this._beginTail();
    } else if (this.state === 'tail') {
      // second press on STOP during tail: finalize immediately (still flushes)
      this._finalize();
    }
  }

  _beginTail() {
    this._setState('tail');
    this._tailDeadline = performance.now() + this.tailSeconds * 1000;
    if (this.tailSeconds <= 0) {
      this._finalize();
      return;
    }
    const tick = () => {
      if (this.state !== 'tail') return;
      const remaining = (this._tailDeadline - performance.now()) / 1000;
      if (remaining <= 0) {
        this._finalize();
      } else {
        this._tailTimer = setTimeout(tick, 50);
      }
    };
    tick();
  }

  async _finalize() {
    if (this._tailTimer) { clearTimeout(this._tailTimer); this._tailTimer = 0; }
    if (this._tickTimer) { clearInterval(this._tickTimer); this._tickTimer = 0; }
    this._setState('finalizing');
    try {
      const res = await this.engine.stopRecording();
      const sr = this.engine.ctx.sampleRate;
      let frames = 0;
      for (const c of res.chunks) frames += c.l.length;
      const durationSec = frames / sr;
      if (frames === 0) {
        this.result = null;
        this.error = this.engine.running
          ? 'Запись пустая — сигнал не был захвачен.'
          : 'Запись пустая: аудиодвижок был остановлен (экран заблокирован?). Нажмите на экран и повторите.';
        this._setState('error');
        return;
      }
      this.result = {
        chunks: res.chunks,
        totalFrames: frames,
        sampleRate: sr,
        numChannels: 2,
        durationSec
      };
      this._setState('ready');
    } catch (err) {
      this.error = String(err && err.message ? err.message : err);
      this._setState('error');
    }
  }

  discard() {
    if (this._tailTimer) { clearTimeout(this._tailTimer); this._tailTimer = 0; }
    if (this._tickTimer) { clearInterval(this._tickTimer); this._tickTimer = 0; }
    this.engine.discardRecording();
    this.result = null;
    this.error = null;
    this._setState('idle');
  }

  _startTicks() {
    if (this._tickTimer) clearInterval(this._tickTimer);
    this._tickTimer = setInterval(() => {
      if (!this.recording) return;
      const elapsed = (performance.now() - this.startedAt) / 1000;
      const tailRemaining = this.state === 'tail'
        ? Math.max(0, (this._tailDeadline - performance.now()) / 1000)
        : this.tailSeconds;
      const maxedOut = elapsed >= MAX_RECORD_MINUTES * 60;
      if (this.onTick) this.onTick({ elapsed, tailRemaining, maxedOut });
      if (maxedOut && this.state === 'recording') {
        // hard cap: finalize instead of exhausting memory
        this.stop();
      }
    }, 50);
  }

  _setState(s) {
    this.state = s;
    if (this.onChange) this.onChange(s);
  }
}
