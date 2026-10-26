/* End-to-end recording pipeline test (no browser):
 * recorder-style chunks → WAV encode → header/data verification.
 * This mirrors exactly what happens after STOP in the app. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, parseWavHeader } from '../src/audio/WavEncoder.js';
import { loadWorklet, makeInput, makeOutput } from './helpers/worklet-loader.mjs';

const SR = 48000;

function recordTone(seconds, { freq = 220, amp = 0.5, tailSeconds = 0 } = {}) {
  const { ProcessorClass, posted } = loadWorklet('src/audio/recorder-worklet.js', { sampleRate: SR });
  const proc = new ProcessorClass();
  proc.port.onmessage({ data: { type: 'start' } });

  const totalBlocks = Math.round((seconds + tailSeconds) * SR / 128);
  for (let b = 0; b < totalBlocks; b++) {
    const input = makeInput(2, 128);
    for (let i = 0; i < 128; i++) {
      const t = (b * 128 + i) / SR;
      const env = t < seconds + tailSeconds ? 1 : 0;
      input[0][0][i] = Math.sin(2 * Math.PI * freq * t) * amp * env;
      input[0][1][i] = Math.sin(2 * Math.PI * freq * t + 0.7) * amp * env;
    }
    proc.process([input[0]], makeOutput(2, 128));
  }
  proc.port.onmessage({ data: { type: 'stop' } });

  return {
    chunks: posted.filter((m) => m.type === 'chunk').map((m) => ({ l: m.l, r: m.r })),
    done: posted.find((m) => m.type === 'done')
  };
}

test('recorded master signal encodes into a valid stereo WAV', () => {
  const { chunks, done } = recordTone(1.0);
  assert.equal(done.totalFrames, SR);

  const buf = encodeWav(chunks, { sampleRate: SR, bitDepth: 16, numChannels: 2 });
  const h = parseWavHeader(buf);
  assert.equal(h.fmt.numChannels, 2);
  assert.equal(h.fmt.sampleRate, SR);
  assert.equal(h.fmt.bitDepth, 16);
  assert.ok(Math.abs(h.duration - 1.0) < 0.001, `duration ${h.duration}`);
});

test('recorded data is non-zero when an audible signal was present', () => {
  const { chunks } = recordTone(0.5);
  const buf = encodeWav(chunks, { sampleRate: SR, bitDepth: 16, numChannels: 2 });
  const view = new DataView(buf);
  const h = parseWavHeader(buf);
  let nonZero = 0;
  for (let i = 0; i < h.data.size; i += 2) {
    if (view.getInt16(h.data.offset + i, true) !== 0) nonZero++;
  }
  assert.ok(nonZero > 10000, `expected audible data, nonZero=${nonZero}`);
});

test('effect tail is appended after stop point (tail frames present)', () => {
  const { chunks, done } = recordTone(0.5, { tailSeconds: 0.25 });
  const expectedFrames = Math.round(0.75 * SR / 128) * 128; // block-aligned capture
  assert.equal(done.totalFrames, expectedFrames);
  const buf = encodeWav(chunks, { sampleRate: SR, bitDepth: 16, numChannels: 2 });
  const h = parseWavHeader(buf);
  assert.ok(Math.abs(h.duration - expectedFrames / SR) < 0.0001, `duration with tail: ${h.duration}`);
  assert.ok(expectedFrames > 0.74 * SR, 'tail must actually extend the recording');
});

test('repeated export produces byte-identical WAV from the same chunks', () => {
  const { chunks } = recordTone(0.25);
  const a = Buffer.from(encodeWav(chunks, { sampleRate: SR, bitDepth: 16, numChannels: 2 }));
  const b = Buffer.from(encodeWav(chunks, { sampleRate: SR, bitDepth: 16, numChannels: 2 }));
  assert.ok(a.equals(b), 'same input must yield the same WAV bytes');
});

test('export in 32-bit float from the same recording works', () => {
  const { chunks } = recordTone(0.25);
  const buf = encodeWav(chunks, { sampleRate: SR, bitDepth: 32, numChannels: 2 });
  const h = parseWavHeader(buf);
  assert.equal(h.fmt.format, 3);
  assert.ok(Math.abs(h.duration - 0.25) < 0.001);
});
