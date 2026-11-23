// Service worker da versão de teste (/p3p/vidro/).
// - Recebe o que for compartilhado de outros apps (Compartilhar → p3p): guarda os arquivos no aparelho
//   e abre a página que pergunta para qual sala mandar.
// - Abre mesmo sem internet: guarda a última versão de cada arquivo do site e usa quando a rede falha.
//   Sempre tenta a rede primeiro, então uma atualização chega na hora.
const CACHE = 'p3p-vidro-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method === 'POST' && url.origin === location.origin && url.searchParams.has('share')) { e.respondWith(receiveShare(req)); return; }
  if (req.method !== 'GET' || url.origin !== location.origin) return;   // servidor da sala e TURN passam direto
  e.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    if (req.mode === 'navigate') { const home = await cache.match(new URL('./', location).href); if (home) return home; }
    throw err;
  }
}

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('p3p-share', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('items', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function receiveShare(req) {
  const form = await req.formData();
  const files = form.getAll('files').filter(f => f && typeof f === 'object' && 'size' in f);
  const text = ['title', 'text', 'url'].map(k => form.get(k)).filter(x => typeof x === 'string' && x.trim()).join('\n');
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const db = await idb();
  await new Promise((res, rej) => {
    const tx = db.transaction('items', 'readwrite');
    tx.objectStore('items').put({ id, files, text, at: Date.now() });
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
  return Response.redirect(new URL(`./?share=${id}`, location).href, 303);
}
