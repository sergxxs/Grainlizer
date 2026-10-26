/* Recorder worklet tests: chunk queue, flush-on-stop, content fidelity. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWorklet, makeInput, makeOutput } from './helpers/worklet-loader.mjs';

const SR = 48000;

function feed(proc, blocks, { frames = 128, fillL = 0, fillR = 0, ramp = false } = {}) {
  for (let b = 0; b < blocks; b++) {
    const input = makeInput(2, frames);
    for (let i = 0; i < frames; i++) {
      input[0][0][i] = ramp ? (b * frames + i) / 100000 : fillL;
      input[0][1][i] = ramp ? -((b * frames + i) / 100000) : fillR;
    }
    proc.process([input[0]], makeOutput(2, frames));
  }
}

test('recorder captures exactly the fed frames', () => {
  const { ProcessorClass, posted } = loadWorklet('src/audio/recorder-worklet.js', { sampleRate: SR });
  const proc = new ProcessorClass();
  proc.port.onmessage({ data: { type: 'start' } });

  feed(proc, 40, { fillL: 0.5, fillR: -0.25 }); // 40 * 128 = 5120 frames
  proc.port.onmessage({ data: { type: 'stop' } });

  const chunks = posted.filter((m) => m.type === 'chunk');
  const done = posted.find((m) => m.type === 'done');
  assert.ok(done, 'done message expected after stop');
  let total = 0;
  for (const c of chunks) {
    assert.equal(c.l.length, c.frames);
    assert.equal(c.r.length, c.frames);
    total += c.frames;
  }
  assert.equal(total, 5120);
  assert.equal(done.totalFrames, 5120);
});

test('stop flushes the trailing partial block (no lost samples)', () => {
  const { ProcessorClass, posted } = loadWorklet('src/audio/recorder-worklet.js', { sampleRate: SR });
  const proc = new ProcessorClass();
  proc.port.onmessage({ data: { type: 'start' } });

  // not a multiple of FLUSH_FRAMES (4096): 10*128 + 64 -> 1344 frames
  feed(proc, 10);
  const input = makeInput(2, 64);
  input[0][0].fill(0.25);
  input[0][1].fill(0.75);
  proc.process([input[0]], makeOutput(2, 64));

  proc.port.onmessage({ data: { type: 'stop' } });
  const chunks = posted.filter((m) => m.type === 'chunk');
  const done = posted.find((m) => m.type === 'done');
  let total = 0;
  for (const c of chunks) total += c.frames;
  assert.equal(total, 1344, 'trailing partial block must be flushed');
  assert.equal(done.totalFrames, 1344);

  // last chunk must contain the final 64 frames
  const last = chunks[chunks.length - 1];
  assert.equal(last.l[last.l.length - 1], 0.25);
  assert.equal(last.r[last.r.length - 1], 0.75);
});

test('capture content matches input samples exactly', () => {
  const { ProcessorClass, posted } = loadWorklet('src/audio/recorder-worklet.js', { sampleRate: SR });
  const proc = new ProcessorClass();
  proc.port.onmessage({ data: { type: 'start' } });
  feed(proc, 35, { ramp: true }); // crosses 4096-frame flush boundary
  proc.port.onmessage({ data: { type: 'stop' } });

  const chunks = posted.filter((m) => m.type === 'chunk');
  let idx = 0;
  for (const c of chunks) {
    for (let i = 0; i < c.frames; i++) {
      const expected = idx / 100000;
      assert.ok(Math.abs(c.l[i] - expected) < 1e-6, `L mismatch at ${idx}`);
      assert.ok(Math.abs(c.r[i] + expected) < 1e-6, `R mismatch at ${idx}`);
      idx++;
    }
  }
  assert.equal(idx, 35 * 128);
});

test('nothing is captured while not recording', () => {
  const { ProcessorClass, posted } = loadWorklet('src/audio/recorder-worklet.js', { sampleRate: SR });
  const proc = new ProcessorClass();
  feed(proc, 50, { fillL: 0.9 });
  proc.port.onmessage({ data: { type: 'stop' } });
  const chunks = posted.filter((m) => m.type === 'chunk');
  assert.equal(chunks.length, 0);
});

test('reset clears capture state; second take starts clean', () => {
  const { ProcessorClass, posted } = loadWorklet('src/audio/recorder-worklet.js', { sampleRate: SR });
  const proc = new ProcessorClass();
  proc.port.onmessage({ data: { type: 'start' } });
  feed(proc, 20, { fillL: 0.5 });
  proc.port.onmessage({ data: { type: 'stop' } });

  proc.port.onmessage({ data: { type: 'reset' } });
  proc.port.onmessage({ data: { type: 'start' } });
  feed(proc, 10, { fillL: -0.5 });
  proc.port.onmessage({ data: { type: 'stop' } });

  const chunks = posted.filter((m) => m.type === 'chunk');
  const dones = posted.filter((m) => m.type === 'done');
  assert.equal(dones.length, 2);
  assert.equal(dones[1].totalFrames, 10 * 128, 'second take must restart the frame counter');
  // first frame of second take
  let take2Start = 0;
  for (const c of chunks) take2Start += c.frames;
  const lastChunk = chunks[chunks.length - 1];
  assert.equal(lastChunk.l[0], -0.5);
});

test('mono-style input (single channel array) is duplicated safely', () => {
  const { ProcessorClass, posted } = loadWorklet('src/audio/recorder-worklet.js', { sampleRate: SR });
  const proc = new ProcessorClass();
  proc.port.onmessage({ data: { type: 'start' } });
  // simulate input with only one channel present
  for (let b = 0; b < 20; b++) {
    const mono = new Float32Array(128).fill(0.3);
    proc.process([[mono]], makeOutput(2, 128));
  }
  proc.port.onmessage({ data: { type: 'stop' } });
  const chunks = posted.filter((m) => m.type === 'chunk');
  assert.ok(chunks.length > 0);
  for (const c of chunks) {
    for (let i = 0; i < c.frames; i++) {
      assert.ok(Number.isFinite(c.l[i]) && Number.isFinite(c.r[i]));
    }
  }
});
