// Histórico local (IndexedDB). Nunca sai deste navegador.
import { KEY } from './config.js';
const DB = `${KEY}-history`;
const MAX_EVENTS = 5000;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB, 1); } catch { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      const ev = db.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
      ev.createIndex('ts', 'ts');
      db.createObjectStore('rooms', { keyPath: 'room' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbp;
}

function tx(db, stores, mode, fn) {
  return new Promise((resolve) => {
    if (!db) { resolve(null); return; }
    let out;
    try {
      const t = db.transaction(stores, mode);
      out = fn(t);
      t.oncomplete = () => resolve(out?.result ?? out ?? null);
      t.onerror = () => resolve(null);
      t.onabort = () => resolve(null);
    } catch { resolve(null); }
  });
}

/** Registra um evento. type: join, leave, path, sent, received, stored, cancelled, failed, visit */
export async function logEvent(e) {
  const db = await open();
  await tx(db, ['events'], 'readwrite', t => t.objectStore('events').add({ ts: Date.now(), ...e }));
  trim();
}

let trimming = false;
async function trim() {
  if (trimming) return;
  trimming = true;
  const db = await open();
  await tx(db, ['events'], 'readwrite', t => {
    const s = t.objectStore('events');
    const c = s.count();
    c.onsuccess = () => {
      let extra = c.result - MAX_EVENTS;
      if (extra <= 0) return;
      s.openCursor().onsuccess = ev => {
        const cur = ev.target.result;
        if (!cur || extra <= 0) return;
        cur.delete(); extra--; cur.continue();
      };
    };
  });
  trimming = false;
}

export async function visitRoom(room, kinds) {
  const db = await open();
  await tx(db, ['rooms'], 'readwrite', t => {
    const s = t.objectStore('rooms');
    const g = s.get(room);
    g.onsuccess = () => {
      const r = g.result || { room, visits: 0 };
      r.visits += 1;
      r.lastVisit = Date.now();
      if (kinds) r.kinds = kinds;
      s.put(r);
    };
  });
}

export async function updateRoomKinds(room, kinds) {
  const db = await open();
  await tx(db, ['rooms'], 'readwrite', t => {
    const s = t.objectStore('rooms');
    const g = s.get(room);
    g.onsuccess = () => { if (g.result) { g.result.kinds = kinds; g.result.lastVisit = Date.now(); s.put(g.result); } };
  });
}

export async function recentRooms(limit = 8) {
  const db = await open();
  const all = await tx(db, ['rooms'], 'readonly', t => t.objectStore('rooms').getAll());
  return (all || []).sort((a, b) => b.lastVisit - a.lastVisit).slice(0, limit);
}

export async function allEvents() {
  const db = await open();
  const all = await tx(db, ['events'], 'readonly', t => t.objectStore('events').getAll());
  return (all || []).sort((a, b) => b.ts - a.ts);
}

export async function clearAll() {
  const db = await open();
  await tx(db, ['events', 'rooms'], 'readwrite', t => { t.objectStore('events').clear(); t.objectStore('rooms').clear(); });
}
