/* Static integrity checks: every element id used by JS exists in index.html,
 * every referenced asset exists on disk, worklets parse as ES modules. */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test("every $('id') reference in main.js exists in index.html", () => {
  const html = read('index.html');
  const js = read('src/main.js');
  const ids = new Set();
  for (const m of html.matchAll(/id="([^"]+)"/g)) ids.add(m[1]);
  const used = new Set();
  for (const m of js.matchAll(/\$\('([^']+)'\)/g)) used.add(m[1]);
  const missing = [...used].filter((id) => !ids.has(id));
  assert.deepEqual(missing, [], `missing ids: ${missing.join(', ')}`);
});

test('every element id used by RecorderUI/Controls/Waveform constructors exists', () => {
  const html = read('index.html');
  const ids = new Set();
  for (const m of html.matchAll(/id="([^"]+)"/g)) ids.add(m[1]);
  const required = [
    'btnRec', 'btnStop', 'btnExport', 'recLed', 'recStatus', 'timer',
    'tailTimer', 'tailSelect', 'formatSelect', 'waveform', 'meterL', 'meterR'
  ];
  const missing = required.filter((id) => !ids.has(id));
  assert.deepEqual(missing, [], `missing ids: ${missing.join(', ')}`);
});

test('index.html asset references resolve to existing files', () => {
  const html = read('index.html');
  const refs = [];
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const url = m[1];
    if (url.startsWith('http') || url.startsWith('#') || url.startsWith('data:')) continue;
    refs.push(url);
  }
  const missing = refs.filter((r) => !fs.existsSync(path.join(ROOT, r)));
  assert.deepEqual(missing, [], `missing assets: ${missing.join(', ')}`);
});

test('manifest.webmanifest is valid JSON with icons on disk', () => {
  const raw = read('public/manifest.webmanifest');
  const manifest = JSON.parse(raw);
  assert.equal(manifest.name.includes('GRAINLIZER'), true);
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.length >= 2);
  for (const icon of manifest.icons) {
    const p = path.join(ROOT, 'public', icon.src);
    assert.ok(fs.existsSync(p), `icon missing: ${icon.src}`);
  }
});

test('service worker precache list matches real files', () => {
  const sw = read('service-worker.js');
  const assetsBlock = sw.match(/const ASSETS = \[([\s\S]*?)\];/);
  assert.ok(assetsBlock, 'ASSETS list must exist');
  const assets = [...assetsBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(assets.length > 10);
  const missing = assets.filter((a) => {
    const rel = a.replace(/^\.\//, '');
    return !fs.existsSync(path.join(ROOT, rel));
  });
  assert.deepEqual(missing, [], `SW caches missing files: ${missing.join(', ')}`);
});

test('all module sources parse as valid ESM', async () => {
  const { spawnSync } = await import('node:child_process');
  const files = [
    'src/main.js',
    'src/audio/AudioEngine.js',
    'src/audio/EffectsChain.js',
    'src/audio/Recorder.js',
    'src/audio/ExportEngine.js',
    'src/audio/WavEncoder.js',
    'src/audio/wav-worker.js',
    'src/audio/granular-worklet.js',
    'src/audio/recorder-worklet.js',
    'src/ui/Waveform.js',
    'src/ui/Controls.js',
    'src/ui/RecorderUI.js',
    'src/state/Presets.js',
    'src/state/Storage.js',
    'scripts/gen-icons.mjs'
  ];
  for (const f of files) {
    const res = spawnSync(process.execPath, ['--check', path.join(ROOT, f)], { encoding: 'utf8' });
    assert.equal(res.status, 0, `syntax error in ${f}: ${res.stderr}`);
  }
});

test('pure modules evaluate and export their API', async () => {
  const wav = await import('../src/audio/WavEncoder.js');
  assert.equal(typeof wav.encodeWav, 'function');
  assert.equal(typeof wav.parseWavHeader, 'function');
  const presets = await import('../src/state/Presets.js');
  assert.equal(presets.BUILTIN_PRESETS.length, 12);
  const fx = await import('../src/audio/EffectsChain.js');
  assert.equal(typeof fx.EffectsChain, 'function');
});

test('worklet files register their processors (vm check)', async () => {
  const { loadWorklet } = await import('./helpers/worklet-loader.mjs');
  const g = loadWorklet('src/audio/granular-worklet.js');
  assert.ok(g.ProcessorClass);
  const r = loadWorklet('src/audio/recorder-worklet.js');
  assert.ok(r.ProcessorClass);
});

test('PNG icons are valid PNG files with correct dimensions', () => {
  const check = (file, size) => {
    const buf = fs.readFileSync(path.join(ROOT, 'public', 'icons', file));
    assert.equal(buf.readUInt32BE(0), 0x89504e47, 'PNG signature');
    assert.equal(buf.readUInt32BE(16), size, 'width');
    assert.equal(buf.readUInt32BE(20), size, 'height');
  };
  check('icon-192.png', 192);
  check('icon-512.png', 512);
  check('apple-touch-icon.png', 180);
});
