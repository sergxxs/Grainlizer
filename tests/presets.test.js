/* Presets & randomizer tests: completeness, safety bounds, sanitization. */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_PRESETS,
  randomizeParams,
  sanitizeParams,
  defaultParams
} from '../src/state/Presets.js';

function assertCompleteParams(p) {
  assert.ok(Number.isFinite(p.position) && p.position >= 0 && p.position <= 1);
  assert.ok(Number.isFinite(p.grainSize) && p.grainSize >= 8 && p.grainSize <= 1500);
  assert.ok(Number.isFinite(p.density) && p.density > 0 && p.density <= 120);
  assert.ok(Number.isFinite(p.spray) && p.spray >= 0 && p.spray <= 1);
  assert.ok(Number.isFinite(p.pitch) && p.pitch >= -24 && p.pitch <= 24);
  assert.ok(Number.isFinite(p.rate) && p.rate >= 0.1 && p.rate <= 4);
  assert.ok(Number.isFinite(p.jitter) && p.jitter >= 0 && p.jitter <= 1);
  assert.ok(Number.isFinite(p.mix) && p.mix >= 0 && p.mix <= 1);
  assert.ok(Number.isFinite(p.master) && p.master >= 0 && p.master <= 1.2);
  assert.equal(typeof p.reverse, 'boolean');
  assert.equal(typeof p.freeze, 'boolean');

  assert.ok(p.fx.filter.cutoff >= 20 && p.fx.filter.cutoff <= 20000);
  assert.ok(p.fx.filter.q >= 0.1 && p.fx.filter.q <= 20);
  assert.ok(['lowpass', 'highpass'].includes(p.fx.filter.type));
  assert.ok(p.fx.tape.drive >= 0.5 && p.fx.tape.drive <= 3);
  assert.ok(p.fx.tape.tone >= 0 && p.fx.tape.tone <= 1);
  assert.ok(p.fx.tape.wow >= 0 && p.fx.tape.wow <= 1);
  assert.ok(p.fx.delay.time >= 0.01 && p.fx.delay.time <= 1.8);
  assert.ok(p.fx.delay.feedback >= 0 && p.fx.delay.feedback <= 0.85, `feedback ${p.fx.delay.feedback}`);
  assert.ok(p.fx.delay.mix >= 0 && p.fx.delay.mix <= 1);
  assert.ok(p.fx.reverb.size >= 0.05 && p.fx.reverb.size <= 1);
  assert.ok(p.fx.reverb.decay >= 0.05 && p.fx.reverb.decay <= 1);
  assert.ok(p.fx.reverb.mix >= 0 && p.fx.reverb.mix <= 1);
}

test('all 12 built-in presets exist with full safe parameter sets', () => {
  const names = BUILTIN_PRESETS.map((p) => p.name);
  for (const expected of [
    'SOFT MEMORY', 'BROKEN TAPE', 'GLASS CLOUD', 'LOST SIGNAL', 'DEEP SLEEP', 'DREAM FRAGMENT',
    'NEON DUST', 'MAGNETIC GHOST', 'ICE CAVE', 'SLOW EROSION', 'STATIC BLOOM', 'SATELLITE DRIFT'
  ]) {
    assert.ok(names.includes(expected), `missing preset ${expected}`);
  }
  assert.equal(BUILTIN_PRESETS.length, 12);
  for (const preset of BUILTIN_PRESETS) {
    assertCompleteParams(preset.params);
  }
});

test('presets actually differ from each other (real parameter changes)', () => {
  const sigs = BUILTIN_PRESETS.map((p) => JSON.stringify(p.params));
  assert.equal(new Set(sigs).size, BUILTIN_PRESETS.length, 'presets must be distinct');
});

test('sanitizeParams repairs garbage input', () => {
  const broken = {
    position: 'abc',
    grainSize: -999,
    density: Infinity,
    spray: NaN,
    pitch: 500,
    rate: -5,
    jitter: 42,
    mix: 'x',
    master: 99,
    fx: {
      filter: { cutoff: -1, q: 0, type: 'bogus' },
      tape: { drive: 100, tone: -3, wow: 50 },
      delay: { time: 99, feedback: 5, mix: -1 },
      reverb: { size: 0, decay: -1, mix: 2 }
    }
  };
  const p = sanitizeParams(broken);
  assertCompleteParams(p);
  assert.equal(p.fx.delay.feedback, 0.85);
  assert.equal(p.fx.filter.type, 'lowpass');
  assert.equal(p.master, 1.2);
  assert.equal(p.pitch, 24);
  assert.equal(p.rate, 0.1);
});

test('sanitizeParams handles null / non-objects', () => {
  for (const input of [null, undefined, 42, 'x', []]) {
    const p = sanitizeParams(input);
    assertCompleteParams(p);
  }
});

test('sanitizeParams is idempotent on presets', () => {
  for (const preset of BUILTIN_PRESETS) {
    const p = sanitizeParams(preset.params);
    assert.deepEqual(p, sanitizeParams(p));
  }
});

test('randomizeParams produces musical, safe values (seeded)', () => {
  // deterministic LCG
  let seed = 42;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 200; i++) {
    const p = randomizeParams(rand);
    assertCompleteParams(p);
    assert.ok(p.fx.delay.feedback <= 0.85);
    assert.ok(p.master <= 0.85, 'randomize must not push master dangerously high');
  }
});

test('SOFT randomize keeps the character of the base patch', () => {
  let seed = 7;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const base = BUILTIN_PRESETS.find((p) => p.id === 'broken-tape').params;
  for (let i = 0; i < 100; i++) {
    const p = randomizeParams(rand, 'soft', base);
    assertCompleteParams(p);
    // flags preserved — soft never flips reverse/freeze
    assert.equal(p.reverse, base.reverse);
    assert.equal(p.freeze, base.freeze);
    // effects stay enabled as in the base patch
    assert.equal(p.fx.filter.on, base.fx.filter.on);
    assert.equal(p.fx.filter.type, base.fx.filter.type);
    assert.equal(p.fx.tape.on, base.fx.tape.on);
    assert.equal(p.fx.delay.on, base.fx.delay.on);
    assert.equal(p.fx.reverb.on, base.fx.reverb.on);
    // pitch drifts at most ±2 semitones from base
    assert.ok(Math.abs(p.pitch - base.pitch) <= 2, `pitch drift too big: ${p.pitch} vs ${base.pitch}`);
    // grain size stays within a narrow relative band (±30%)
    assert.ok(p.grainSize >= base.grainSize * 0.65 && p.grainSize <= base.grainSize * 1.35,
      `grainSize ${p.grainSize} too far from ${base.grainSize}`);
    // master stays conservative
    assert.ok(p.master >= 0.5 && p.master <= 0.92);
    // delay feedback never runs away
    assert.ok(p.fx.delay.feedback <= 0.85);
  }
});

test('SOFT randomize produces visible but bounded variation', () => {
  let seed = 1234;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const base = defaultParams();
  let changed = 0;
  for (let i = 0; i < 30; i++) {
    const p = randomizeParams(rand, 'soft', base);
    if (p.grainSize !== base.grainSize || p.density !== base.density
      || p.fx.filter.cutoff !== base.fx.filter.cutoff) changed++;
  }
  assert.ok(changed >= 25, 'soft randomize must actually change values');
});

test('SOFT randomize with no base falls back to defaults and stays safe', () => {
  const p = randomizeParams(Math.random, 'soft', null);
  assertCompleteParams(p);
});

test('defaultParams is complete and safe', () => {
  assertCompleteParams(defaultParams());
});
