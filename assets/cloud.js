// Envio para a nuvem (R2) em partes de 8 MB, com gzip quando compensa e novas tentativas por parte.
import { likelyCompressed } from './transfer.js';

const PARALLEL = 3;
const MAX_TRIES = 8;

const gzipOk = typeof CompressionStream !== 'undefined';

async function worthGzip(file) {
  if (!gzipOk || file.size < 4096 || likelyCompressed(file)) return false;
  try {
    const sample = file.slice(0, Math.min(file.size, 256 * 1024));
    const out = await new Response(sample.stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    return out.byteLength < sample.size * 0.9;
  } catch { return false; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
function onlineAgain() {
  if (navigator.onLine !== false) return Promise.resolve();
  return new Promise(r => window.addEventListener('online', r, { once: true }));
}

export class CloudUpload extends EventTarget {
  constructor(room, file, { to = null, byName = '', byPeer = '' } = {}) {
    super();
    this.room = room;
    this.file = file;
    this.to = to;
    this.byName = byName;
    this.byPeer = byPeer;
    this.name = file.name || 'arquivo';
    this.size = file.size;
    this.sent = 0;        // bytes do arquivo original já processados
    this.state = 'preparing';
    this.aborted = false;
    this.speed = 0;
    this.wireDone = 0;            // bytes de partes já aceitas pelo servidor
    this.inflight = new Map();    // parte → bytes enviados até agora
    this.producedRaw = 0;         // bytes do arquivo já transformados em partes
    this.producedWire = 0;        // bytes dessas partes (comprimidas ou não)
    this.xhrs = new Set();
  }

  /** Bytes que já saíram pela rede e a posição estimada no arquivo. */
  liveStats() {
    let net = this.wireDone;
    for (const v of this.inflight.values()) net += v;
    if (this.state === 'done') return { net, raw: this.size };
    const ratio = this.gzip && this.producedWire ? this.producedRaw / this.producedWire : 1;
    return { net, raw: Math.min(this.size, net * ratio) };
  }
  emit() { this.dispatchEvent(new Event('update')); }

  async api(method, path, body) {
    const r = await fetch(this.room.api(path), {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Room-Token': this.room.token || '' },
      body: body ? JSON.stringify(body) : undefined
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error?.code || `http ${r.status}`); e.code = j.error?.code; e.info = j.error; throw e; }
    return j;
  }

  async start() {
    try {
      this.gzip = await worthGzip(this.file);
      const c = await this.api('POST', '/uploads', {
        name: this.name, type: this.file.type || 'application/octet-stream', size: this.size,
        encoding: this.gzip ? 'gzip' : null, byName: this.byName, byPeer: this.byPeer, to: this.to
      });
      this.fileId = c.fileId;
      this.uploadId = c.uploadId;
      this.partSize = c.partSize;
      this.state = 'uploading';
      this.startedAt = Date.now();
      this.emit();
      const parts = await this.uploadParts();
      if (this.aborted) return;
      const done = await this.api('POST', `/uploads/${this.fileId}/complete`, { uploadId: this.uploadId, parts });
      this.result = done.file;
      this.state = 'done';
      this.finishedAt = Date.now();
      this.emit();
      return done.file;
    } catch (e) {
      if (this.aborted) return;
      this.state = 'failed';
      this.error = e;
      this.emit();
      if (this.fileId && this.uploadId) this.api('DELETE', `/uploads/${this.fileId}?uploadId=${encodeURIComponent(this.uploadId)}`).catch(() => {});
      throw e;
    }
  }

  /** Gera as partes em ordem: fatias do arquivo, ou o fluxo gzip cortado em pedaços de 8 MB. */
  async *partsSource() {
    const ps = this.partSize;
    if (!this.gzip) {
      for (let off = 0, n = 1; off < this.size || n === 1; off += ps, n++) {
        const end = Math.min(this.size, off + ps);
        yield { n, body: this.file.slice(off, end), rawEnd: end };
        if (end >= this.size) break;
      }
      return;
    }
    let consumed = 0;
    const counter = new TransformStream({ transform: (chunk, ctl) => { consumed += chunk.byteLength; ctl.enqueue(chunk); } });
    const reader = this.file.stream().pipeThrough(counter).pipeThrough(new CompressionStream('gzip')).getReader();
    let buf = [], len = 0, n = 1;
    for (;;) {
      const { done, value } = await reader.read();
      if (value) { buf.push(value); len += value.byteLength; }
      while (len >= ps || (done && len > 0)) {
        const take = Math.min(ps, len);
        const out = new Uint8Array(take);
        let o = 0;
        while (o < take) {
          const head = buf[0];
          const k = Math.min(head.byteLength, take - o);
          out.set(head.subarray(0, k), o);
          o += k;
          if (k === head.byteLength) buf.shift(); else buf[0] = head.subarray(k);
        }
        len -= take;
        yield { n: n++, body: out, rawEnd: consumed };
      }
      if (done) break;
    }
  }

  async uploadParts() {
    const results = [];
    const running = new Set();
    let failure = null;
    for await (const part of this.partsSource()) {
      if (this.aborted || failure) break;
      this.producedRaw = part.rawEnd;
      this.producedWire += part.body.size ?? part.body.byteLength;
      const p = this.putPart(part).then(r => { results.push(r); this.sent = Math.max(this.sent, part.rawEnd); this.tickSpeed(); this.emit(); })
        .catch(e => { failure = e; })
        .finally(() => running.delete(p));
      running.add(p);
      if (running.size >= PARALLEL) await Promise.race(running);
    }
    await Promise.all(running);
    if (failure) throw failure;
    return results.sort((a, b) => a.partNumber - b.partNumber);
  }

  tickSpeed() {
    const dt = (Date.now() - this.startedAt) / 1000;
    if (dt > 0) this.speed = this.sent / dt;
  }

  async putPart({ n, body }) {
    const url = this.room.api(`/uploads/${this.fileId}/parts/${n}?uploadId=${encodeURIComponent(this.uploadId)}`);
    const len = body.size ?? body.byteLength;
    let wait = 1000;
    for (let tryN = 1; ; tryN++) {
      if (this.aborted) throw new Error('aborted');
      await onlineAgain();
      try {
        const r = await this.xhrPut(url, body, n);
        if (r.status >= 200 && r.status < 300) {
          this.wireDone += len;
          return { partNumber: r.json.partNumber, etag: r.json.etag };
        }
        if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) throw Object.assign(new Error(r.json.error?.code || `http ${r.status}`), { fatal: true });
      } catch (e) {
        if (e.fatal || tryN >= MAX_TRIES || this.aborted) throw e;
      }
      await sleep(wait);
      wait = Math.min(30000, wait * 2);
    }
  }

  /** XMLHttpRequest em vez de fetch: só ele informa o progresso do upload. */
  xhrPut(url, body, n) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      this.xhrs.add(x);
      const done = () => { this.xhrs.delete(x); this.inflight.delete(n); };
      x.open('PUT', url);
      x.upload.onprogress = e => this.inflight.set(n, e.loaded);
      x.onload = () => {
        done();
        let json = {};
        try { json = JSON.parse(x.responseText || '{}'); } catch { /* resposta vazia */ }
        resolve({ status: x.status, json });
      };
      x.onerror = () => { done(); reject(new Error('network')); };
      x.onabort = () => { done(); reject(new Error('aborted')); };
      x.ontimeout = () => { done(); reject(new Error('timeout')); };
      x.send(body);
    });
  }

  abort() {
    this.aborted = true;
    for (const x of this.xhrs) { try { x.abort(); } catch { /* ok */ } }
    this.state = 'cancelled';
    this.emit();
    if (this.fileId && this.uploadId) this.api('DELETE', `/uploads/${this.fileId}?uploadId=${encodeURIComponent(this.uploadId)}`).catch(() => {});
  }
}

export function downloadUrl(room, fileId) {
  return room.api(`/files/${fileId}?t=${encodeURIComponent(room.token || '')}`);
}
