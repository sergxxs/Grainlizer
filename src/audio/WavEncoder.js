/* GRAINLIZER — real PCM WAV encoder (RIFF/WAVE).
 * Supports 16-bit PCM (format 1) and 32-bit IEEE float (format 3).
 * Input: list of per-chunk planar channel pairs { l, r } (mono allowed via { l }).
 */

'use strict';

/**
 * @param {Array<{l: Float32Array, r?: Float32Array}>} chunks
 * @param {{sampleRate: number, bitDepth?: 16|32, numChannels?: 1|2}} opts
 * @returns {ArrayBuffer} valid RIFF/WAVE file bytes
 */
export function encodeWav(chunks, opts) {
  const sampleRate = Math.max(1, Math.floor(opts.sampleRate || 48000));
  const bitDepth = opts.bitDepth === 32 ? 32 : 16;
  const numChannels = opts.numChannels === 1 ? 1 : 2;

  let totalFrames = 0;
  for (const c of chunks) {
    if (!c || !c.l) continue;
    totalFrames += c.l.length;
  }

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataBytes = totalFrames * blockAlign;
  const isFloat = bitDepth === 32;

  // RIFF layout:
  //  "RIFF" size "WAVE"
  //  "fmt " 16 <fmt body>
  //  ["fact" 4 <sample count>]   (required-ish for non-PCM)
  //  "data" size <samples>
  const factBytes = isFloat ? 12 : 0;
  const headerBytes = 12 + 24 + factBytes + 8;
  const totalBytes = headerBytes + dataBytes;

  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);
  let off = 0;

  writeStr(view, off, 'RIFF'); off += 4;
  view.setUint32(off, totalBytes - 8, true); off += 4;
  writeStr(view, off, 'WAVE'); off += 4;

  writeStr(view, off, 'fmt '); off += 4;
  view.setUint32(off, 16, true); off += 4;
  view.setUint16(off, isFloat ? 3 : 1, true); off += 2;      // format tag
  view.setUint16(off, numChannels, true); off += 2;
  view.setUint32(off, sampleRate, true); off += 4;
  view.setUint32(off, sampleRate * blockAlign, true); off += 4;
  view.setUint16(off, blockAlign, true); off += 2;
  view.setUint16(off, bitDepth, true); off += 2;

  if (isFloat) {
    writeStr(view, off, 'fact'); off += 4;
    view.setUint32(off, 4, true); off += 4;
    view.setUint32(off, totalFrames, true); off += 4;
  }

  writeStr(view, off, 'data'); off += 4;
  view.setUint32(off, dataBytes, true); off += 4;

  // write interleaved samples chunk-by-chunk (no giant intermediate copy)
  for (const c of chunks) {
    if (!c || !c.l) continue;
    const n = c.l.length;
    const r = c.r || c.l;
    for (let i = 0; i < n; i++) {
      const sl = sanitize(c.l[i]);
      const sr = numChannels > 1 ? sanitize(r[i]) : 0;
      if (bitDepth === 16) {
        view.setInt16(off, toInt16(sl), true); off += 2;
        if (numChannels > 1) { view.setInt16(off, toInt16(sr), true); off += 2; }
      } else {
        view.setFloat32(off, sl, true); off += 4;
        if (numChannels > 1) { view.setFloat32(off, sr, true); off += 4; }
      }
    }
  }

  return buffer;
}

function sanitize(x) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return 0;
  return x;
}

function toInt16(x) {
  const s = x > 1 ? 1 : (x < -1 ? -1 : x);
  const v = s < 0 ? s * 0x8000 : s * 0x7FFF;
  return Math.round(v);
}

function writeStr(view, off, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
}

/** Parse a WAV header back (used by tests and diagnostics). */
export function parseWavHeader(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const tag = (o) => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
  if (arrayBuffer.byteLength < 44) throw new Error('too short');
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
  const riffSize = view.getUint32(4, true);
  let off = 12;
  let fmt = null;
  let data = null;
  while (off + 8 <= view.byteLength) {
    const id = tag(off);
    const size = view.getUint32(off + 4, true);
    if (id === 'fmt ') {
      fmt = {
        format: view.getUint16(off + 8, true),
        numChannels: view.getUint16(off + 10, true),
        sampleRate: view.getUint32(off + 12, true),
        byteRate: view.getUint32(off + 16, true),
        blockAlign: view.getUint16(off + 20, true),
        bitDepth: view.getUint16(off + 22, true)
      };
    } else if (id === 'data') {
      data = { offset: off + 8, size };
    }
    off += 8 + size + (size & 1);
  }
  if (!fmt) throw new Error('missing fmt chunk');
  if (!data) throw new Error('missing data chunk');
  const duration = data.size / (fmt.sampleRate * fmt.blockAlign || 1);
  return { riffSize, fmt, data, duration };
}
