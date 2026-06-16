importScripts('/scram/scramjet.all.js');

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const sw = new ScramjetServiceWorker();

// Take control immediately on first install — no waiting for old tabs to close
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e  => e.waitUntil(clients.claim()));

self.addEventListener('fetch', async ev => {
  await sw.loadConfig();
  if (sw.route(ev)) {
    ev.respondWith(sw.fetch(ev));
  }
});
