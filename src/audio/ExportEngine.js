/* GRAINLIZER — WAV export.
 * Encodes in a module Worker when available (falls back to main-thread encode
 * in slices). Produces a real RIFF/WAVE Blob and triggers a browser download.
 */

'use strict';

import { encodeWav } from './WavEncoder.js';

export class ExportEngine {
  constructor() {
    this.worker = null;
    this._workerFailed = false;
    this.lastBlob = null;
    this.lastName = null;
    this.onState = null; // (state, detail) => {}
  }

  _getWorker() {
    if (this._workerFailed) return null;
    if (this.worker) return this.worker;
    try {
      this.worker = new Worker('src/audio/wav-worker.js', { type: 'module' });
      this.worker.onerror = () => {
        this._workerFailed = true;
        this.worker = null;
      };
      return this.worker;
    } catch (_) {
      this._workerFailed = true;
      return null;
    }
  }

  /**
   * @param {{chunks: Array, sampleRate: number, numChannels: number, durationSec: number}} result
   * @param {16|32} bitDepth
   * @returns {Blob} audio/wav
   */
  async encode(result, bitDepth = 16) {
    if (!result || !result.chunks || result.chunks.length === 0) {
      throw new Error('Nothing to export — record something first');
    }
    if (this.onState) this.onState('encoding');

    const payload = {
      type: 'encode',
      chunks: result.chunks,
      sampleRate: result.sampleRate,
      bitDepth: bitDepth === 32 ? 32 : 16,
      numChannels: result.numChannels === 1 ? 1 : 2
    };

    const worker = this._getWorker();
    let blob;
    if (worker) {
      try {
        blob = await new Promise((resolve, reject) => {
          let settled = false;
          const onMsg = (e) => {
            const m = e.data;
            if (!m) return;
            if (m.type === 'encoded' && !settled) {
              settled = true;
              clearTimeout(timer);
              worker.removeEventListener('message', onMsg);
              resolve(m.blob);
            } else if (m.type === 'error' && !settled) {
              settled = true;
              clearTimeout(timer);
              worker.removeEventListener('message', onMsg);
              reject(new Error(m.message));
            }
          };
          worker.addEventListener('message', onMsg);
          // if the module worker fails to boot (old browsers), fall back instead of hanging
          const timer = setTimeout(() => {
            if (!settled) {
              settled = true;
              worker.removeEventListener('message', onMsg);
              reject(new Error('worker-timeout'));
            }
          }, 4000);
          // structured clone (no transfer): the main thread keeps its copy so the
          // result can be re-exported later in 16-bit or 32-bit float
          worker.postMessage(payload);
        });
      } catch (err) {
        if (String(err && err.message).includes('worker-timeout') || err) {
          if (this.onState) this.onState('fallback');
          const buffer = await this._encodeYielding(payload);
          blob = new Blob([buffer], { type: 'audio/wav' });
          this._workerFailed = true;
          if (this.worker) { this.worker.terminate(); this.worker = null; }
        }
      }
    } else {
      // main-thread fallback
      const buffer = await this._encodeYielding(payload);
      blob = new Blob([buffer], { type: 'audio/wav' });
    }

    this.lastBlob = blob;
    this.lastBitDepth = payload.bitDepth;
    if (this.onState) this.onState('ready');
    return blob;
  }

  async _encodeYielding(payload) {
    // encode through the same encoder; yield between chunk batches so the
    // UI keeps painting on long files
    return new Promise((resolve, reject) => {
      const run = () => {
        try {
          resolve(encodeWav(payload.chunks, payload));
        } catch (err) {
          reject(err);
        }
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
      else setTimeout(run, 0);
    });
  }

  /** Re-export uses a cached Blob when the format matches (no re-encode). */
  async exportResult(result, bitDepth = 16) {
    const depth = bitDepth === 32 ? 32 : 16;
    if (this.lastBlob && this.lastBitDepth === depth) {
      return this.download(this.lastBlob, this.lastName || this.makeName());
    }
    const blob = await this.encode(result, depth);
    return this.download(blob);
  }

  makeName() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `grainlizer-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.wav`;
  }

  download(blob, name) {
    const fileName = name || this.makeName();
    this.lastName = fileName;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 4000);
    return fileName;
  }

  release() {
    this.lastBlob = null;
    this.lastName = null;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
