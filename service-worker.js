/* GRAINLIZER — service worker (root scope: covers the whole app).
 * Precaches the app shell so the instrument opens offline (after first visit).
 * Cache-first for same-origin assets, network fallback, versioned cache name.
 */

'use strict';

const CACHE_NAME = 'grainlizer-v1';

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

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
        }
        return res;
      }).catch(() => {
        if (req.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('', { status: 504, statusText: 'offline' });
      });
    })
  );
});
