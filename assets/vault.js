// Cofre deste aparelho: o que passou pela conversa de cada sala, para continuar lá depois de recarregar.
//
// posts  → um cartão de arquivo(s) da conversa: quem mandou, quando, nomes, tamanhos e miniaturas.
// files  → o arquivo em si, guardado no disco do navegador (OPFS) ou, onde não há OPFS, no IndexedDB.
// forgot → o que a pessoa mandou esquecer neste aparelho (não volta nem se outro aparelho mandar de novo).
// rooms  → quando este aparelho esteve na sala pela última vez.
//
// Nada daqui vai para o servidor. Limpeza: o arquivo sai depois de IDLE_MS sem ninguém abrir, salvar ou
// pedir; a sala inteira (cartões, arquivos e esquecidos) sai depois de IDLE_MS sem este aparelho entrar,
// como o servidor faz com as mensagens da sala.
import { KEY } from './config.js?v=202611251905';

export const IDLE_MS = 48 * 3600 * 1000;
const DB = `${KEY}-vault`;
const PREFIX = 'vf-';
const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise(resolve => {
    let req;
    try { req = indexedDB.open(DB, 1); } catch { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('posts', { keyPath: 'id' }).createIndex('room', 'room');
      db.createObjectStore('files', { keyPath: 'fid' }).createIndex('room', 'room');
      db.createObjectStore('forgot', { keyPath: 'key' }).createIndex('room', 'room');
      db.createObjectStore('rooms', { keyPath: 'room' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbp;
}

/** Roda fn numa transação e devolve o que ela pôs em out.v quando a transação termina. */
async function run(stores, mode, fn) {
  const db = await open();
  if (!db) return null;
  return new Promise(resolve => {
    const out = { v: null };
    try {
      const t = db.transaction(stores, mode);
      fn(t, out);
      t.oncomplete = () => resolve(out.v);
      t.onerror = () => resolve(null);
      t.onabort = () => resolve(null);
    } catch { resolve(null); }
  });
}
const all = (store, room) => run([store], 'readonly', (t, out) => {
  const r = t.objectStore(store).index('room').getAll(room);
  r.onsuccess = () => { out.v = r.result || []; };
});
const one = (store, key) => run([store], 'readonly', (t, out) => {
  const r = t.objectStore(store).get(key);
  r.onsuccess = () => { out.v = r.result || null; };
});

async function opfs() {
  try { return await navigator.storage.getDirectory(); } catch { return null; }
}
async function removeDisk(name) {
  if (!name) return;
  const root = await opfs();
  try { await root?.removeEntry(name); } catch { /* já saiu */ }
}

// ---------- sala ----------
export async function seen(room) {
  await run(['rooms'], 'readwrite', t => t.objectStore('rooms').put({ room, lastSeen: Date.now() }));
}

// ---------- cartões ----------
export async function posts(room) {
  return ((await all('posts', room)) || []).sort((a, b) => a.ts - b.ts);
}
export const getPost = id => one('posts', id);

/** Guarda um cartão. Se já existe, completa: fica com a lista que tiver mais miniaturas e ids. */
export async function putPost(post) {
  const p = cleanPost(post);
  if (!p) return null;
  return run(['posts'], 'readwrite', (t, out) => {
    const s = t.objectStore('posts');
    const g = s.get(p.id);
    g.onsuccess = () => {
      const old = g.result;
      const merged = old ? mergePost(old, p) : p;
      s.put(merged);
      out.v = merged;
    };
  });
}

function mergePost(a, b) {
  const items = (a.items.length >= b.items.length ? a.items : b.items).map((x, i) => {
    const y = (a.items.length >= b.items.length ? b.items : a.items)[i] || {};
    return { ...y, ...x, fid: x.fid || y.fid || null, cloud: x.cloud || y.cloud || null, thumb: x.thumb || y.thumb || null, media: x.media || y.media || null };
  });
  return { ...a, items, to: a.to ?? b.to ?? null };
}

/** Só o que um cartão pode ter: vem de outros aparelhos, então tudo é conferido. */
export function cleanPost(p) {
  if (!p || typeof p !== 'object' || !ID_RE.test(String(p.id || '')) || typeof p.room !== 'string') return null;
  const thumb = s => (typeof s === 'string' && s.length < 48000 && /^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/.test(s) ? s : null);
  const num = (x, max) => (Number.isFinite(+x) && +x > 0 ? Math.min(max, +x) : 0);
  const items = (Array.isArray(p.items) ? p.items : []).slice(0, 300).map(x => ({
    fid: ID_RE.test(String(x?.fid || '')) ? String(x.fid) : null,
    cloud: ID_RE.test(String(x?.cloud || '')) ? String(x.cloud) : null,   // também foi pela nuvem da sala (id lá)
    name: String(x?.name || 'arquivo').slice(0, 200), size: Math.max(0, +x?.size || 0), type: String(x?.type || '').slice(0, 120),
    thumb: thumb(x?.thumb), media: x?.media && typeof x.media === 'object' ? { w: num(x.media.w, 1e5), h: num(x.media.h, 1e5), dur: num(x.media.dur, 1e7) } : null
  }));
  if (!items.length) return null;
  const f = p.from || {};
  return {
    id: String(p.id), room: String(p.room).slice(0, 64), ts: Math.min(Date.now() + 60000, Math.max(0, +p.ts || Date.now())),
    from: { peerId: String(f.peerId || '').slice(0, 32), deviceId: String(f.deviceId || '').slice(0, 32), name: String(f.name || '').slice(0, 32) },
    to: Array.isArray(p.to) ? p.to.filter(x => ID_RE.test(String(x))).slice(0, 16) : null,
    items
  };
}

// ---------- arquivos ----------
/**
 * Guarda o arquivo deste cartão neste aparelho.
 * src: { disk: nome no OPFS } (o recebimento já gravou lá) ou um Blob/File (copiado para o OPFS ou, sem ele, para o IndexedDB).
 */
export async function keepFile(fid, room, src, info = {}) {
  if (!ID_RE.test(String(fid || ''))) return false;
  const now = Date.now();
  const rec = { fid, room, name: info.name || '', type: info.type || '', size: info.size || 0, intact: !!info.intact, kept: now, lastAccess: now, disk: null, blob: null };
  if (src?.disk) rec.disk = src.disk;
  else if (src instanceof Blob) {
    const root = await opfs();
    let done = false;
    if (root) {
      try {
        const fh = await root.getFileHandle(`${PREFIX}${fid}`, { create: true });
        if (typeof fh.createWritable === 'function') {
          const w = await fh.createWritable();
          await src.stream().pipeTo(w);
          rec.disk = `${PREFIX}${fid}`;
          done = true;
        }
      } catch { /* cai para o IndexedDB */ }
    }
    if (!done) rec.blob = src;
  } else return false;
  const old = await one('files', fid);
  if (old?.disk && old.disk !== rec.disk) await removeDisk(old.disk);
  return !!(await run(['files'], 'readwrite', (t, out) => { t.objectStore('files').put(rec); out.v = true; }));
}

/** O arquivo, se está neste aparelho. touch: conta como acesso (abrir, salvar, mandar para outro aparelho). */
export async function fileOf(fid, { touch = false } = {}) {
  const rec = await one('files', fid);
  if (!rec) return null;
  let blob = rec.blob || null;
  if (!blob && rec.disk) {
    try {
      const root = await opfs();
      const f = await (await root.getFileHandle(rec.disk)).getFile();
      blob = rec.type ? new Blob([f], { type: rec.type }) : f;
    } catch { blob = null; }
  }
  if (!blob) { await dropFiles([fid]); return null; }
  if (touch) await touchFile(fid);
  return blob;
}

let touched = new Map();
/** Renova o prazo do arquivo (no máximo uma gravação por minuto para o mesmo arquivo). */
export async function touchFile(fid) {
  const now = Date.now();
  if (now - (touched.get(fid) || 0) < 60000) return;
  touched.set(fid, now);
  await run(['files'], 'readwrite', t => {
    const s = t.objectStore('files');
    const g = s.get(fid);
    g.onsuccess = () => { if (g.result) s.put({ ...g.result, lastAccess: now }); };
  });
}

/** Arquivos desta sala que estão neste aparelho: id → { intact }. */
export async function haves(room) {
  return new Map(((await all('files', room)) || []).map(r => [r.fid, { intact: !!r.intact }]));
}

export async function dropFiles(fids) {
  const recs = [];
  await run(['files'], 'readwrite', t => {
    const s = t.objectStore('files');
    for (const fid of fids) {
      const g = s.get(fid);
      g.onsuccess = () => { if (g.result) { recs.push(g.result); s.delete(fid); } };
    }
  });
  for (const r of recs) await removeDisk(r.disk);
}

// ---------- esquecer ----------
export async function forgotten(room) {
  return new Set(((await all('forgot', room)) || []).map(r => r.id));
}

/** Esquece mensagens ou cartões neste aparelho: apaga os arquivos e não deixa voltarem. */
export async function forget(room, ids, fids = []) {
  const now = Date.now();
  const more = [];
  await run(['forgot', 'posts'], 'readwrite', t => {
    const f = t.objectStore('forgot'), p = t.objectStore('posts');
    for (const id of ids) {
      f.put({ key: `${room}/${id}`, room, id, ts: now });
      const g = p.get(id);
      g.onsuccess = () => { if (g.result) { for (const x of g.result.items) if (x.fid) more.push(x.fid); p.delete(id); } };
    }
  });
  await dropFiles([...new Set([...fids, ...more])]);
}

/** Apaga tudo desta sala neste aparelho (sala apagada por alguém ou parada há mais de IDLE_MS). */
export async function forgetRoom(room, { keepForgot = false } = {}) {
  const files = (await all('files', room)) || [];
  await run(['posts', 'files', 'forgot', 'rooms'], 'readwrite', t => {
    const del = (store, keys) => keys.forEach(k => t.objectStore(store).delete(k));
    const idx = (store, fn) => { const r = t.objectStore(store).index('room').getAllKeys(room); r.onsuccess = () => fn(r.result || []); };
    idx('posts', keys => del('posts', keys));
    idx('files', keys => del('files', keys));
    if (!keepForgot) { idx('forgot', keys => del('forgot', keys)); t.objectStore('rooms').delete(room); }
  });
  for (const r of files) await removeDisk(r.disk);
}

// ---------- limpeza ----------
/** Tira arquivos sem acesso e salas sem visita há mais de IDLE_MS. Devolve os nomes no disco que continuam em uso. */
export async function sweep(now = Date.now()) {
  const rooms = (await run(['rooms'], 'readonly', (t, out) => { const r = t.objectStore('rooms').getAll(); r.onsuccess = () => { out.v = r.result || []; }; })) || [];
  for (const r of rooms) if (r.lastSeen + IDLE_MS <= now) await forgetRoom(r.room);
  const files = (await run(['files'], 'readonly', (t, out) => { const r = t.objectStore('files').getAll(); r.onsuccess = () => { out.v = r.result || []; }; })) || [];
  const old = files.filter(f => f.lastAccess + IDLE_MS <= now).map(f => f.fid);
  if (old.length) await dropFiles(old);
  const keep = new Set(files.filter(f => f.lastAccess + IDLE_MS > now && f.disk).map(f => f.disk));
  // Sobras: arquivos do cofre no disco que nenhum registro aponta mais.
  const root = await opfs();
  if (root?.entries) {
    try {
      for await (const [name] of root.entries()) if (name.startsWith(PREFIX) && !keep.has(name)) await removeDisk(name);
    } catch { /* sem permissão */ }
  }
  return keep;
}

/** Só para os testes locais: envelhece os registros. */
export async function debugAge(ms) {
  await run(['files', 'rooms'], 'readwrite', t => {
    for (const store of ['files', 'rooms']) {
      const s = t.objectStore(store);
      const r = s.getAll();
      r.onsuccess = () => (r.result || []).forEach(x => s.put({ ...x, ...(x.lastAccess ? { lastAccess: x.lastAccess - ms } : {}), ...(x.lastSeen ? { lastSeen: x.lastSeen - ms } : {}) }));
    }
  });
  touched = new Map();
}
