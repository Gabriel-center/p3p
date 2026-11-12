// Onde os blocos recebidos ficam: disco do navegador (OPFS) ou memória, se o navegador não tiver OPFS.
const PREFIX = 'rx-';

async function opfsRoot() {
  try { return await navigator.storage.getDirectory(); } catch { return null; }
}

/** Apaga recebimentos com mais de 24 h (sobras de sessões anteriores). */
export async function cleanupOld() {
  const root = await opfsRoot();
  if (!root || !root.entries) return;
  const limit = Date.now() - 24 * 3600 * 1000;
  try {
    for await (const [name] of root.entries()) {
      const ts = Number(name.slice(PREFIX.length).split('-')[0]);
      if (name.startsWith(PREFIX) && ts && ts < limit) { try { await root.removeEntry(name); } catch { /* em uso */ } }
    }
  } catch { /* sem permissão */ }
}

export async function createSink() {
  const root = await opfsRoot();
  if (root) {
    try {
      const name = `${PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const fh = await root.getFileHandle(name, { create: true });
      if (typeof fh.createWritable === 'function') {
        const w = await fh.createWritable();
        return {
          kind: 'disk',
          async write(position, data) { await w.write({ type: 'write', position, data }); },
          async finish(type) { await w.close(); const f = await fh.getFile(); return type ? new Blob([f], { type }) : f; },
          async abort() { try { await w.abort(); } catch { /* ok */ } try { await root.removeEntry(name); } catch { /* ok */ } }
        };
      }
      try { await root.removeEntry(name); } catch { /* ok */ }
    } catch { /* cai para memória */ }
  }
  const parts = [];
  return {
    kind: 'memory',
    async write(_position, data) { parts.push(new Blob([data])); },
    async finish(type) { return new Blob(parts, { type: type || '' }); },
    async abort() { parts.length = 0; }
  };
}
