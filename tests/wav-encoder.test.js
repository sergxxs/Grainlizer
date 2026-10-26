/* WAV encoder tests: real RIFF/WAVE headers, formats, clamping, duration. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, parseWavHeader } from '../src/audio/WavEncoder.js';

function sineChunks(frames, { sampleRate = 48000, freq = 440, amp = 0.5, chunkSize = 1000 } = {}) {
  const chunks = [];
  let idx = 0;
  while (idx < frames) {
    const n = Math.min(chunkSize, frames - idx);
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = (idx + i) / sampleRate;
      l[i] = Math.sin(2 * Math.PI * freq * t) * amp;
      r[i] = Math.sin(2 * Math.PI * freq * t + 0.5) * amp;
    }
    chunks.push({ l, r });
    idx += n;
  }
  return chunks;
}

test('16-bit stereo WAV: valid header and chunk sizes', () => {
  const sampleRate = 48000;
  const frames = 24000;
  const buf = encodeWav(sineChunks(frames, { sampleRate }), { sampleRate, bitDepth: 16, numChannels: 2 });
  const h = parseWavHeader(buf);

  assert.equal(h.fmt.format, 1);
  assert.equal(h.fmt.numChannels, 2);
  assert.equal(h.fmt.sampleRate, sampleRate);
  assert.equal(h.fmt.bitDepth, 16);
  assert.equal(h.fmt.blockAlign, 4);
  assert.equal(h.fmt.byteRate, sampleRate * 4);
  assert.equal(h.data.size, frames * 4);
  assert.equal(buf.byteLength, 44 + frames * 4);
  assert.equal(h.riffSize, buf.byteLength - 8);
  assert.ok(Math.abs(h.duration - 0.5) < 1e-9, `duration ${h.duration}`);
});

test('16-bit stereo WAV: data values convert correctly', () => {
  const chunks = [
    { l: new Float32Array([0, 1, -1, 0.5, -0.5]), r: new Float32Array([1, -1, 0, -0.5, 0.5]) }
  ];
  const buf = encodeWav(chunks, { sampleRate: 44100, bitDepth: 16, numChannels: 2 });
  const view = new DataView(buf);
  const h = parseWavHeader(buf);
  const off = h.data.offset;

  // interleaved L R
  assert.equal(view.getInt16(off + 0, true), 0);        // L0 = 0
  assert.equal(view.getInt16(off + 2, true), 32767);    // R0 = 1.0
  assert.equal(view.getInt16(off + 4, true), 32767);    // L1 = 1.0
  assert.equal(view.getInt16(off + 6, true), -32768);   // R1 = -1.0
  assert.equal(view.getInt16(off + 8, true), -32768);   // L2 = -1.0
  assert.equal(view.getInt16(off + 10, true), 0);       // R2 = 0
  assert.equal(view.getInt16(off + 12, true), Math.round(0.5 * 0x7FFF));
  // negative side of the standard asymmetric int16 mapping: s * 0x8000
  assert.equal(view.getInt16(off + 14, true), Math.round(-0.5 * 0x8000));
});

test('16-bit conversion clamps out-of-range and sanitizes NaN/Infinity', () => {
  const chunks = [
    { l: new Float32Array([2, -2, NaN, Infinity, -Infinity]), r: new Float32Array([0, 0, 0, 0, 0]) }
  ];
  const buf = encodeWav(chunks, { sampleRate: 48000, bitDepth: 16, numChannels: 2 });
  const view = new DataView(buf);
  const h = parseWavHeader(buf);
  const off = h.data.offset;
  assert.equal(view.getInt16(off + 0, true), 32767);
  assert.equal(view.getInt16(off + 4, true), -32768);
  assert.equal(view.getInt16(off + 8, true), 0);   // NaN -> 0
  assert.equal(view.getInt16(off + 12, true), 0);  // Infinity sanitized before clamp
  assert.equal(view.getInt16(off + 16, true), 0);
});

test('32-bit float WAV: format tag 3, fact chunk, raw float data', () => {
  const chunks = [
    { l: new Float32Array([0.25, -0.75]), r: new Float32Array([-0.5, 0.5]) }
  ];
  const buf = encodeWav(chunks, { sampleRate: 96000, bitDepth: 32, numChannels: 2 });
  const h = parseWavHeader(buf);
  assert.equal(h.fmt.format, 3);
  assert.equal(h.fmt.bitDepth, 32);
  assert.equal(h.fmt.sampleRate, 96000);
  assert.equal(h.fmt.blockAlign, 8);
  assert.equal(h.data.size, 2 * 8);
  const view = new DataView(buf);
  assert.equal(view.getFloat32(h.data.offset, true), 0.25);
  assert.equal(view.getFloat32(h.data.offset + 4, true), -0.5);
  assert.equal(view.getFloat32(h.data.offset + 8, true), -0.75);
  assert.equal(view.getFloat32(h.data.offset + 12, true), 0.5);
});

test('mono WAV: numChannels=1, blockAlign correct', () => {
  const chunks = [{ l: new Float32Array(100).fill(0.1) }];
  const buf = encodeWav(chunks, { sampleRate: 22050, bitDepth: 16, numChannels: 1 });
  const h = parseWavHeader(buf);
  assert.equal(h.fmt.numChannels, 1);
  assert.equal(h.fmt.blockAlign, 2);
  assert.equal(h.data.size, 200);
  assert.ok(Math.abs(h.duration - 100 / 22050) < 1e-9);
});

test('multi-chunk duration and riff size stay consistent', () => {
  const chunks = sineChunks(48000 + 123, { sampleRate: 48000, chunkSize: 4096 });
  const buf = encodeWav(chunks, { sampleRate: 48000, bitDepth: 16, numChannels: 2 });
  const h = parseWavHeader(buf);
  assert.equal(h.data.size, (48000 + 123) * 4);
  assert.equal(buf.byteLength, 44 + h.data.size);
  assert.equal(h.riffSize, buf.byteLength - 8);
});

test('non-zero audible data present for a sine input', () => {
  const chunks = sineChunks(4800, { amp: 0.8 });
  const buf = encodeWav(chunks, { sampleRate: 48000, bitDepth: 16, numChannels: 2 });
  const view = new DataView(buf);
  const h = parseWavHeader(buf);
  let nonZero = 0;
  for (let i = 0; i < h.data.size; i += 2) {
    if (view.getInt16(h.data.offset + i, true) !== 0) nonZero++;
  }
  assert.ok(nonZero > 1000, `expected non-zero samples, got ${nonZero}`);
});

test('empty chunks produce a valid header with zero data', () => {
  const buf = encodeWav([], { sampleRate: 48000, bitDepth: 16, numChannels: 2 });
  const h = parseWavHeader(buf);
  assert.equal(h.data.size, 0);
  assert.equal(h.duration, 0);
});
