/* Service worker: app e dados funcionam offline; mapa base fica em cache conforme você navega. */
const V = 'v3';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'manifest.webmanifest', 'vendor/leaflet.js', 'vendor/leaflet.css',
  'icons/icon-192.png', 'icons/apple-touch-icon.png', 'icons/maskable-512.png', 'data/areas.json', 'data/ruas.json'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open('shell-' + V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('shell-') && k !== 'shell-' + V).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
let trimming = false;
async function trim(c) {
  if (trimming) return; trimming = true;
  try { const ks = await c.keys(); if (ks.length > 1500) for (const k of ks.slice(0, ks.length - 1200)) await c.delete(k); }
  finally { trimming = false; }
}
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.origin === location.origin) {
    const isData = u.pathname.includes('/data/');
    e.respondWith(caches.open('shell-' + V).then(async c => {
      const hit = await c.match(e.request, {ignoreSearch: true});
      const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; });
      // dados: usa o cache na hora e atualiza por trás; app: busca a versão nova e cai no cache se estiver offline
      if (isData && hit) { net.catch(() => {}); return hit; }
      return net.catch(() => hit || Response.error());
    }));
    return;
  }
  if (/tile\.openstreetmap\.org$|arcgisonline\.com$/.test(u.hostname)) {
    e.respondWith(caches.open('tiles').then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      try { const r = await fetch(e.request); if (r.ok) { c.put(e.request, r.clone()); trim(c); } return r; }
      catch (err) { return Response.error(); }
    }));
  }
});
