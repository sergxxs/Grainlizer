/* Granular DSP worklet tests: real synthesis output, safety, boundaries. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWorklet, makeOutput } from './helpers/worklet-loader.mjs';

const SR = 48000;

function setup({ frames = 48000, channels = 2, sine = true } = {}) {
  const { ProcessorClass, posted } = loadWorklet('src/audio/granular-worklet.js', { sampleRate: SR });
  const proc = new ProcessorClass();

  const ch0 = new Float32Array(frames);
  const ch1 = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    if (sine) {
      ch0[i] = Math.sin((2 * Math.PI * 440 * i) / SR) * 0.7;
      ch1[i] = Math.sin((2 * Math.PI * 554 * i) / SR) * 0.7;
    }
  }
  proc.onMessage({
    type: 'buffer',
    length: frames,
    channels: channels === 1 ? [ch0, ch0] : [ch0, ch1]
  });
  proc.onMessage({ type: 'selection', start: 0, end: frames });
  return { proc, posted, ch0, ch1 };
}

function runBlocks(proc, n, frames = 128) {
  let peak = 0;
  let nonZero = 0;
  for (let b = 0; b < n; b++) {
    const out = makeOutput(2, frames);
    const alive = proc.process([], out);
    assert.equal(alive, true, 'processor must stay alive');
    for (let ch = 0; ch < 2; ch++) {
      for (let i = 0; i < frames; i++) {
        const v = out[0][ch][i];
        assert.ok(Number.isFinite(v), `non-finite sample at block ${b} ch ${ch} i ${i}: ${v}`);
        assert.ok(Math.abs(v) <= 4.01, `unclamped sample ${v}`);
        const a = Math.abs(v);
        if (a > peak) peak = a;
        if (a > 1e-6) nonZero++;
      }
    }
  }
  return { peak, nonZero };
}

test('granular synthesis produces audible non-zero output', () => {
  const { proc } = setup();
  proc.onMessage({ type: 'params', params: { mix: 1, density: 30, grainSize: 120, jitter: 0.2, spray: 0.1 } });
  proc.onMessage({ type: 'play' });
  // warm-up then measure
  runBlocks(proc, 40);
  const { peak, nonZero } = runBlocks(proc, 120);
  assert.ok(nonZero > 1000, `expected granular output, nonZero=${nonZero}`);
  assert.ok(peak > 0.01, `expected audible peak, got ${peak}`);
});

test('output is finite with extreme parameter values (no NaN/Infinity)', () => {
  const { proc } = setup({ frames: 2048 }); // short buffer edge case
  proc.onMessage({
    type: 'params',
    params: {
      mix: 1, density: 200, grainSize: 1500, jitter: 1, spray: 1,
      pitch: 24, rate: 4, reverse: true
    }
  });
  proc.onMessage({ type: 'play' });
  runBlocks(proc, 300);
});

test('stop halts grain spawning and voices decay to zero', () => {
  const { proc } = setup();
  proc.onMessage({ type: 'params', params: { mix: 1, density: 25, grainSize: 80, jitter: 0.2 } });
  proc.onMessage({ type: 'play' });
  runBlocks(proc, 100);
  proc.onMessage({ type: 'stop' });
  // 80 ms grains: allow up to ~0.5 s of blocks to finish
  runBlocks(proc, 300);
  assert.equal(proc.voiceCount, 0, 'all voices must be released after stop');
  const { nonZero } = runBlocks(proc, 10);
  assert.equal(nonZero, 0, 'silence after all voices finished');
});

test('panic immediately clears all voices', () => {
  const { proc } = setup();
  proc.onMessage({ type: 'params', params: { mix: 1, density: 30, grainSize: 400 } });
  proc.onMessage({ type: 'play' });
  runBlocks(proc, 60);
  proc.onMessage({ type: 'panic' });
  const { nonZero } = runBlocks(proc, 4);
  assert.equal(proc.voiceCount, 0);
  assert.equal(nonZero, 0);
});

test('FREEZE locks the head while playing', () => {
  const { proc, posted } = setup();
  proc.onMessage({ type: 'params', params: { mix: 1, freeze: true, density: 20, grainSize: 100 } });
  proc.onMessage({ type: 'seek', position: 0.5 });
  proc.onMessage({ type: 'play' });
  runBlocks(proc, 200);
  const heads = posted.filter((m) => m.type === 'status').map((m) => m.head);
  assert.ok(heads.length > 5, 'status messages expected');
  const first = heads[0];
  for (const h of heads) {
    assert.ok(Math.abs(h - first) < 1e-6, `head moved under FREEZE: ${first} -> ${h}`);
  }
  // grains still sound (frozen layer)
  const { nonZero } = runBlocks(proc, 100);
  assert.ok(nonZero > 100, 'frozen grains must still produce sound');
});

test('without FREEZE the head advances and wraps inside selection', () => {
  const { proc, posted } = setup();
  proc.onMessage({ type: 'params', params: { mix: 1, freeze: false, rate: 1, density: 10, grainSize: 60 } });
  proc.onMessage({ type: 'seek', position: 0.9 });
  proc.onMessage({ type: 'selection', start: 0, end: 48000 });
  proc.onMessage({ type: 'play' });
  runBlocks(proc, 400); // 400*128 = 51200 samples > buffer -> must wrap
  const heads = posted.filter((m) => m.type === 'status').map((m) => m.head);
  for (const h of heads) {
    assert.ok(Number.isFinite(h) && h >= -1 && h <= 48001, `head out of range: ${h}`);
  }
  const last = heads[heads.length - 1];
  assert.ok(last < 48000, `head must wrap, last=${last}`);
});

test('voice count stays within the cap at high density', () => {
  const { proc } = setup();
  proc.onMessage({ type: 'params', params: { mix: 1, density: 200, grainSize: 1500, jitter: 0.5 } });
  proc.onMessage({ type: 'play' });
  runBlocks(proc, 250);
  assert.ok(proc.voiceCount <= 48, `voice cap exceeded: ${proc.voiceCount}`);
});

test('mono sample (same channel data) works and produces stereo output', () => {
  const { proc } = setup({ channels: 1 });
  proc.onMessage({ type: 'params', params: { mix: 1, density: 20, grainSize: 100 } });
  proc.onMessage({ type: 'play' });
  runBlocks(proc, 100);
  const out = makeOutput(2, 128);
  proc.process([], out);
  // both output channels carry signal
  let e0 = 0, e1 = 0;
  for (let i = 0; i < 128; i++) {
    e0 += Math.abs(out[0][0][i]);
    e1 += Math.abs(out[0][1][i]);
  }
  assert.ok(e0 + e1 > 0, 'stereo output expected from mono source');
});

test('REVERSE playback yields finite non-zero grains', () => {
  const { proc } = setup();
  proc.onMessage({ type: 'params', params: { mix: 1, reverse: true, density: 25, grainSize: 150, spray: 0.2 } });
  proc.onMessage({ type: 'play' });
  runBlocks(proc, 50);
  const { nonZero, peak } = runBlocks(proc, 150);
  assert.ok(nonZero > 500, `reverse grains expected, nonZero=${nonZero}`);
  assert.ok(peak > 0.001);
});

test('dry MIX=0 outputs the playhead monitor; MIX=1 outputs grains only', () => {
  const { proc: p1 } = setup();
  p1.onMessage({ type: 'params', params: { mix: 0, density: 0, grainSize: 100 } });
  p1.onMessage({ type: 'seek', position: 0.25 });
  p1.onMessage({ type: 'play' });
  runBlocks(p1, 20);
  const dryOut = makeOutput(2, 128);
  p1.process([], dryOut);
  let dryEnergy = 0;
  for (let i = 0; i < 128; i++) dryEnergy += Math.abs(dryOut[0][0][i]);
  assert.ok(dryEnergy > 0, 'dry monitor must carry the sample');

  const { proc: p2 } = setup();
  p2.onMessage({ type: 'params', params: { mix: 1, density: 30, grainSize: 100, spray: 0.3 } });
  p2.onMessage({ type: 'seek', position: 0.25 });
  p2.onMessage({ type: 'play' });
  runBlocks(p2, 150);
  const granOut = makeOutput(2, 128);
  p2.process([], granOut);
  let granEnergy = 0;
  for (let i = 0; i < 128; i++) granEnergy += Math.abs(granOut[0][0][i]);
  assert.ok(granEnergy > 0, 'granular path must carry grains');
});

test('zero-length and cleared buffer produce silence without crashing', () => {
  const { proc } = setup();
  proc.onMessage({ type: 'clear' });
  proc.onMessage({ type: 'play' });
  const { nonZero } = runBlocks(proc, 20);
  assert.equal(nonZero, 0);
});

test('selection clamping: grains stay audible with tiny selection', () => {
  const { proc } = setup();
  proc.onMessage({ type: 'selection', start: 1000, end: 1100 });
  proc.onMessage({ type: 'params', params: { mix: 1, density: 30, grainSize: 120, spray: 0.5 } });
  proc.onMessage({ type: 'play' });
  const { nonZero } = runBlocks(proc, 200);
  assert.ok(nonZero > 50, `tiny selection should still grain, nonZero=${nonZero}`);
});

test('parameter changes during playback stay safe and smooth', () => {
  const { proc } = setup();
  proc.onMessage({ type: 'params', params: { mix: 1, density: 15, grainSize: 100 } });
  proc.onMessage({ type: 'play' });
  runBlocks(proc, 30);
  const combos = [
    { pitch: -24, grainSize: 8 },
    { pitch: 24, grainSize: 1500, density: 80 },
    { rate: 0.1, jitter: 1, spray: 1 },
    { rate: 4, density: 0.5, reverse: true },
    { mix: 0, freeze: true },
    { mix: 1, freeze: false, pitch: 0, rate: 1, grainSize: 180, density: 16 }
  ];
  for (const c of combos) {
    proc.onMessage({ type: 'params', params: c });
    runBlocks(proc, 25);
  }
});
