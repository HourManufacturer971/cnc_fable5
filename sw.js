'use strict';
// sw.js — minimal service worker: makes the game installable as a PWA (which
// is what unlocks true fullscreen with no browser bar on phones) and, as a
// side effect, playable offline. Strategy is network-first with cache
// fallback so an online player always gets the latest deploy — the cache
// only answers when the network can't.

const CACHE = 'hw-v3';
const CORE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/core.js',
  'js/data.js',
  'js/sprites_terrain.js',
  'js/terrain_paint.js',
  'js/sprites_units.js',
  'js/sprites_infantry.js',
  'js/sprites_buildings.js',
  'js/audio.js',
  'js/music.js',
  'js/missions.js',
  'js/map.js',
  'js/path.js',
  'js/fog.js',
  'js/sim.js',
  'js/production.js',
  'js/ai.js',
  'js/input.js',
  'js/render.js',
  'js/net.js',
  'js/main.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', ev => {
  ev.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', ev => {
  if (ev.request.method !== 'GET' || !ev.request.url.startsWith(self.location.origin)) return;
  ev.respondWith(
    // cache:'no-cache' bypasses the HTTP cache's max-age (GitHub Pages sets
    // 10 minutes) in favor of a conditional request — an online player gets
    // the freshest deploy on every load, at the cost of cheap 304s
    fetch(ev.request, { cache: 'no-cache' }).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(ev.request, copy));
      }
      return res;
    }).catch(() => caches.match(ev.request, { ignoreSearch: true }))
  );
});
