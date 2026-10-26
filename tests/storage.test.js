/* Storage tests: settings/presets round-trip, corruption, quota failures. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultParams } from '../src/state/Presets.js';

function makeLocalStorageMock({ failSet = false } = {}) {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      if (failSet) {
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      }
      map.set(k, String(v));
    },
    removeItem: (k) => { map.delete(k); }
  };
}

async function freshStorage(localStorageImpl) {
  globalThis.localStorage = localStorageImpl;
  globalThis.indexedDB = undefined;
  // bust module cache so Storage sees the new globals
  const mod = await import(`../src/state/Storage.js?cb=${Math.random()}`);
  return mod.Storage;
}

test('settings round-trip through localStorage', async () => {
  const ls = makeLocalStorageMock();
  const Storage = await freshStorage(ls);

  const params = defaultParams();
  params.grainSize = 333;
  params.mix = 0.42;
  const ok = Storage.saveSettings({
    params,
    recorder: { tailSeconds: 5, bitDepth: 32 },
    ui: { lastPreset: 'glass-cloud' }
  });
  assert.equal(ok, true);

  const loaded = Storage.loadSettings();
  assert.equal(loaded.params.grainSize, 333);
  assert.ok(Math.abs(loaded.params.mix - 0.42) < 1e-9);
  assert.equal(loaded.recorder.tailSeconds, 5);
  assert.equal(loaded.recorder.bitDepth, 32);
  assert.equal(loaded.ui.lastPreset, 'glass-cloud');
});

test('corrupted localStorage JSON is discarded safely', async () => {
  const ls = makeLocalStorageMock();
  ls.map.set('grainlizer:v1', '{not valid json!!!');
  const Storage = await freshStorage(ls);
  const settings = Storage.loadSettings(); // must not throw
  assert.ok(settings.params);
  assert.equal(settings.recorder.tailSeconds, 2);
});

test('corrupted param trees are sanitized on load', async () => {
  const ls = makeLocalStorageMock();
  ls.map.set('grainlizer:v1', JSON.stringify({
    params: { grainSize: 'nope', fx: { delay: { feedback: 99 } } }
  }));
  const Storage = await freshStorage(ls);
  const s = Storage.loadSettings();
  assert.ok(Number.isFinite(s.params.grainSize));
  assert.ok(s.params.fx.delay.feedback <= 0.85);
});

test('quota failure on save returns false without throwing', async () => {
  const ls = makeLocalStorageMock({ failSet: true });
  const Storage = await freshStorage(ls);
  const ok = Storage.saveSettings({ params: defaultParams(), recorder: {}, ui: {} });
  assert.equal(ok, false);
  const preset = Storage.saveUserPreset({ name: 'X', params: defaultParams() });
  assert.equal(preset, null);
});

test('user presets: save, list, delete, bounded list size', async () => {
  const ls = makeLocalStorageMock();
  const Storage = await freshStorage(ls);

  for (let i = 0; i < 30; i++) {
    Storage.saveUserPreset({ id: `u${i}`, name: `P${i}`, params: defaultParams() });
  }
  const list = Storage.loadUserPresets();
  assert.ok(list.length <= 24, `list must be bounded, got ${list.length}`);
  assert.ok(list.every((p) => p.name && p.params));

  Storage.deleteUserPreset(list[0].id);
  const after = Storage.loadUserPresets();
  assert.equal(after.length, list.length - 1);
});

test('user presets with garbage entries are filtered', async () => {
  const ls = makeLocalStorageMock();
  ls.map.set('grainlizer:v1', JSON.stringify({
    userPresets: [
      null,
      { name: 'ok', params: defaultParams() },
      { name: 42, params: null },
      { params: defaultParams() }
    ]
  }));
  const Storage = await freshStorage(ls);
  const list = Storage.loadUserPresets();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'ok');
});

test('IndexedDB-dependent calls degrade gracefully when unavailable', async () => {
  const Storage = await freshStorage(makeLocalStorageMock());
  const res = await Storage.saveSample({ name: 'x' }, [new Float32Array(4)]);
  assert.equal(res.ok, false);
  assert.ok(res.reason);
  const loaded = await Storage.loadSample();
  assert.equal(loaded, null);
  const projects = await Storage.listProjects();
  assert.deepEqual(projects, []);
});

test('clearAll removes settings without throwing', async () => {
  const ls = makeLocalStorageMock();
  const Storage = await freshStorage(ls);
  Storage.saveSettings({ params: defaultParams(), recorder: {}, ui: {} });
  await Storage.clearAll();
  assert.equal(ls.map.has('grainlizer:v1'), false);
});
