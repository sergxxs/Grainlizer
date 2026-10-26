/* AudioEngine resume() regression tests — the iOS 'interrupted' bug:
 * resume() must fire for BOTH 'suspended' and 'interrupted' states and use
 * the silent-buffer kick; play() must fail with a clear error if audio stays
 * blocked instead of playing silently into the void. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from '../src/audio/AudioEngine.js';

function fakeCtx(initialState = 'interrupted') {
  const ctx = {
    state: initialState,
    sampleRate: 48000,
    resumeCalls: 0,
    kicks: 0,
    destination: {},
    addEventListener() {},
    createBuffer: () => ({}),
    createBufferSource() {
      ctx.kicks++;
      return { buffer: null, connect() {}, start() {} };
    },
    async resume() {
      ctx.resumeCalls++;
      ctx.state = 'running';
    }
  };
  return ctx;
}

function engineWithCtx(ctx) {
  const engine = new AudioEngine();
  engine.ctx = ctx;
  engine.ready = true;
  return engine;
}

test("resume() recovers an 'interrupted' AudioContext (iOS bug)", async () => {
  const ctx = fakeCtx('interrupted');
  const engine = engineWithCtx(ctx);
  const state = await engine.resume();
  assert.equal(state, 'running');
  assert.ok(ctx.resumeCalls >= 1, 'resume() must be called for interrupted state');
  assert.ok(ctx.kicks >= 1, 'silent-buffer kick expected');
});

test("resume() recovers a 'suspended' AudioContext", async () => {
  const ctx = fakeCtx('suspended');
  const engine = engineWithCtx(ctx);
  const state = await engine.resume();
  assert.equal(state, 'running');
});

test("resume() is a no-op once running", async () => {
  const ctx = fakeCtx('running');
  const engine = engineWithCtx(ctx);
  const state = await engine.resume();
  assert.equal(state, 'running');
  assert.equal(ctx.resumeCalls, 0);
});

test("resume() retries and reports the stuck state if the browser blocks audio", async () => {
  const ctx = fakeCtx('interrupted');
  ctx.resume = async () => { ctx.resumeCalls++; /* stays interrupted */ };
  const engine = engineWithCtx(ctx);
  const state = await engine.resume();
  assert.equal(state, 'interrupted');
  assert.ok(ctx.resumeCalls >= 2, `expected retries, got ${ctx.resumeCalls}`);
});

test('play() throws a clear error when audio stays blocked (no silent no-op)', async () => {
  const ctx = fakeCtx('interrupted');
  ctx.resume = async () => { /* blocked forever */ };
  const engine = engineWithCtx(ctx);
  engine.buffer = { length: 100, duration: 1, sampleRate: 48000, numberOfChannels: 2 };
  await assert.rejects(() => engine.play(), /заблокировано|blocked/i);
  assert.equal(engine.playing, false);
});

test('play() works after resume succeeds', async () => {
  const ctx = fakeCtx('suspended');
  const engine = engineWithCtx(ctx);
  engine.buffer = { length: 100, duration: 1, sampleRate: 48000, numberOfChannels: 2 };
  let played = false;
  engine.granularNode = { port: { postMessage: (m) => { if (m.type === 'play') played = true; } } };
  await engine.play();
  assert.equal(played, true);
  assert.equal(engine.playing, true);
});

test('play() rejects when no sample is loaded', async () => {
  const engine = engineWithCtx(fakeCtx('running'));
  await assert.rejects(() => engine.play(), /семпл|sample/i);
});

test('recorder.start() refuses to record while audio is blocked', async () => {
  const { Recorder } = await import('../src/audio/Recorder.js');
  const ctx = fakeCtx('interrupted');
  ctx.resume = async () => { /* blocked forever */ };
  const engine = engineWithCtx(ctx);
  engine.buffer = { length: 100 };
  const recorder = new Recorder(engine);
  await assert.rejects(() => recorder.start(), /заблокировано|blocked/i);
  assert.equal(recorder.state, 'error');
  assert.equal(recorder.recording, false);
});

test('recorder.start() rejects clearly when no sample is loaded', async () => {
  const { Recorder } = await import('../src/audio/Recorder.js');
  const engine = engineWithCtx(fakeCtx('running'));
  engine.buffer = null;
  const recorder = new Recorder(engine);
  await assert.rejects(() => recorder.start(), /семпл/i);
});

test('rebuild() replaces a stuck context and restores the sample + params', async () => {
  const ctx = fakeCtx('interrupted');
  ctx.resume = async () => { /* stuck forever */ };
  const engine = engineWithCtx(ctx);
  // sample + state that must survive the rebuild
  const fakeBuffer = {
    length: 1000,
    duration: 2,
    sampleRate: 48000,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(1000).fill(0.25)
  };
  engine.buffer = fakeBuffer;
  engine.meta = { name: 'keep.wav', duration: 2, sampleRate: 48000, channels: 1 };
  engine.params.position = 0.42;

  // stub init()-built pieces (no real Web Audio in Node)
  let closed = false;
  ctx.close = async () => { closed = true; };
  engine.init = async function stubInit() {
    this.ctx = fakeCtx('suspended');
    this.ctx.close = async () => { closed = true; };
    this.ready = true;
    this.effects = { applyParams() {}, connectTo() {}, output: { connect() {} } };
    const posted = [];
    this.granularNode = { port: { postMessage: (m) => posted.push(m) } };
    this.recorderNode = { port: { postMessage() {} } };
    this.recorderSink = { gain: { value: 0 }, connect() {} };
    this._posted = posted;
  };

  const res = await engine.rebuild();
  assert.equal(closed, true, 'old context must be closed');
  assert.equal(res.restored, true);
  assert.equal(engine.ready, true);
  assert.equal(engine.buffer, fakeBuffer);
  assert.ok(Math.abs(engine.params.position - 0.42) < 1e-9, 'position must survive');
  const types = engine._posted.map((m) => m.type);
  assert.ok(types.includes('buffer'), 'sample must be re-sent to the new worklet');
  assert.ok(types.includes('seek'), 'playhead must be restored');
});

test('resume() honors custom attempts/timeout (fast path for unlock)', async () => {
  const ctx = fakeCtx('interrupted');
  ctx.resume = async () => { ctx.resumeCalls++; /* stuck */ };
  const engine = engineWithCtx(ctx);
  const t0 = Date.now();
  const state = await engine.resume({ attempts: 2, timeoutMs: 50 });
  const dt = Date.now() - t0;
  assert.equal(state, 'interrupted');
  assert.ok(ctx.resumeCalls === 2, `expected exactly 2 attempts, got ${ctx.resumeCalls}`);
  assert.ok(dt < 1500, `fast path should not hang, took ${dt}ms`);
});
