// A versão de teste (/p3p/vidro/) virou o site principal. Este service worker substitui o antigo só para
// se desfazer: apaga o cache, sai do ar e leva as janelas abertas para o endereço principal.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) await caches.delete(k);
  await self.registration.unregister();
  const main = new URL('../', self.registration.scope).href;
  for (const c of await self.clients.matchAll({ type: 'window' })) {
    const u = new URL(c.url);
    c.navigate(main + u.search + u.hash).catch(() => {});
  }
})()));
