importScripts('/scram/scramjet.all.js');

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const sw = new ScramjetServiceWorker();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

/* ProxyWarp's own assets — never redirect these */
const OWN = new Set([
  '/', '/index.html', '/proxy.html', '/about.html',
  '/contact.html', '/donate.html', '/sw.js', '/favicon.svg'
]);
const OWN_PFX = [
  '/p/', '/wisp/', '/scramjet/', '/css/', '/js/', '/legal/',
  '/baremux/', '/epoxy/', '/scram/'
];

self.addEventListener('fetch', async ev => {
  await sw.loadConfig();

  /* Let Scramjet handle its own proxied routes */
  if (sw.route(ev)) {
    ev.respondWith(sw.fetch(ev));
    return;
  }

  const req = ev.request;
  const url = new URL(req.url);

  /* Only care about same-origin requests */
  if (url.origin !== self.location.origin) return;

  const { pathname } = url;

  /* Pass through ProxyWarp's own pages and assets */
  if (OWN.has(pathname) || OWN_PFX.some(p => pathname.startsWith(p))) return;

  /*
   * Escaped proxy request — a proxied page navigated or fetched a path
   * that lacks the /p/ prefix (e.g. YouTube going to /results?q=...).
   * Reconstruct the correct /p/<absolute-url> and redirect.
   */
  ev.respondWith((async () => {
    try {
      let proxiedBase = null;

      /* Primary: the client's current URL tells us which site is being browsed */
      const client = await clients.get(ev.clientId || '');
      if (client) {
        const cp = new URL(client.url).pathname;
        if (cp.startsWith('/p/')) proxiedBase = cp.slice(3);
      }

      /* Fallback: parse the Referer header */
      if (!proxiedBase && req.referrer) {
        const rp = new URL(req.referrer).pathname;
        if (rp.startsWith('/p/')) proxiedBase = rp.slice(3);
      }

      if (proxiedBase) {
        const origin = new URL(proxiedBase).origin;
        const target = new URL(pathname + url.search, origin).href;
        return Response.redirect('/p/' + target, 302);
      }
    } catch (e) { /* fall through */ }

    return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  })());
});
