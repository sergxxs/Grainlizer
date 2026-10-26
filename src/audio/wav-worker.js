/* GRAINLIZER — WAV encoding worker.
 * Runs off the main thread after STOP so encoding long recordings does not
 * freeze the UI. Receives PCM chunks (transferred), returns an encoded Blob.
 */

'use strict';

import { encodeWav } from './WavEncoder.js';

self.onmessage = (e) => {
  const m = e.data;
  if (!m || m.type !== 'encode') return;
  try {
    const chunks = m.chunks || [];
    const buffer = encodeWav(chunks, {
      sampleRate: m.sampleRate,
      bitDepth: m.bitDepth,
      numChannels: m.numChannels
    });
    const blob = new Blob([buffer], { type: 'audio/wav' });
    self.postMessage({ type: 'encoded', blob, bytes: buffer.byteLength });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message ? err.message : err) });
  }
};
