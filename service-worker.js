/* GRAINLIZER — service worker (root scope: covers the whole app).
 * NETWORK-FIRST for code (updates propagate immediately), cache fallback for
 * offline. Versioned cache; old caches and legacy registrations are removed.
 */

'use strict';

const CACHE_NAME = 'grainlizer-v2';

const ASSETS = [
  './index.html',
  './styles.css',
  './src/main.js',
  './src/audio/AudioEngine.js',
  './src/audio/EffectsChain.js',
  './src/audio/Recorder.js',
  './src/audio/ExportEngine.js',
  './src/audio/WavEncoder.js',
  './src/audio/wav-worker.js',
  './src/audio/granular-worklet.js',
  './src/audio/recorder-worklet.js',
  './src/ui/Waveform.js',
  './src/ui/Controls.js',
  './src/ui/RecorderUI.js',
  './src/state/Presets.js',
  './src/state/Storage.js',
  './public/manifest.webmanifest',
  './public/icons/icon-192.png',
  './public/icons/icon-512.png',
  './public/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.allSettled(ASSETS.map((u) => cache.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // NETWORK-FIRST: fresh code always wins when online — critical for fixes.
  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.status === 200 && fresh.type === 'basic') {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch (_) {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      return new Response('', { status: 504, statusText: 'offline' });
    }
  })());
});
