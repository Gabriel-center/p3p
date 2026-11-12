// Transferência direta em blocos (1 MB, ou 8 MB em arquivos grandes e comprimíveis), com compressão por bloco e retomada.
// O nível do zstd se ajusta sozinho: sobe quando a rede é o gargalo e o processador tem folga, desce quando a compressão
// começa a segurar o envio.
// Formato de cada pedaço binário (16 bytes de cabeçalho + dados):
//   [0] 0xB1  [1] flags (1 = comprimido)  [2..3] pedaço  [4..7] nº da transferência
//   [8..11] bloco  [12..13] total de pedaços do bloco  [14..15] reservado
import { BLOCK_SIZE, FRAME_SIZE, CLOUD_SWITCH_MS } from './config.js?v=202611122007';
import { createSink } from './storage.js?v=202611122007';
import { randomId } from './device.js?v=202611122007';

const HIGH_WATER = 8 * 1024 * 1024;
const PREFETCH = 3;
const STALL_MS = 60000;
// Blocos grandes dão ao zstd uma janela maior: em arquivos com partes repetidas (backups, bancos, imagens de disco)
// a economia chega a triplicar. Só valem com nível 9 ou mais, que é quando a janela do zstd passa a cobrir o bloco.
const BIG_BLOCK = 8 * 1024 * 1024;
const BIG_MIN_SIZE = 24 * 1024 * 1024;
const LEVELS = [3, 6, 9, 12, 15, 19];
// Quantas vezes mais lento fica cada passo para o próximo nível (medido no zstd do site).
const SLOWER = { 3: 3, 6: 2, 9: 2, 12: 2.5, 15: 3 };
const BUSY_BYTES = 2 * 1024 * 1024;
const SKIP_TYPES = /^(image\/(jpeg|png|gif|webp|avif|heic|heif)|video\/|audio\/(mpeg|mp4|aac|ogg|opus|webm|flac)|application\/(zip|gzip|x-7z|x-rar|x-xz|x-bzip|zstd|x-zstd|vnd\.rar|java-archive|x-apple-diskimage))/i;
const SKIP_EXT = /\.(jpe?g|png|gif|webp|avif|heic|mp4|mov|mkv|webm|mp3|m4a|aac|ogg|opus|flac|zip|gz|tgz|7z|rar|xz|bz2|zst|br|jar|apk|ipa|dmg|docx|xlsx|pptx|odt|ods|epub)$/i;

// ---------- compressão (processo separado) ----------
export class Codec {
  constructor() {
    this.seq = 0;
    this.pending = new Map();
    try {
      this.w = new Worker(new URL('./codec-worker.js', import.meta.url), { type: 'module' });
      this.w.onmessage = ({ data }) => {
        const p = this.pending.get(data.id);
        if (!p) return;
        this.pending.delete(data.id);
        if (data.error) p.rej(new Error(data.error)); else p.res(data);
      };
      this.w.onerror = () => { for (const p of this.pending.values()) p.rej(new Error('codec')); this.pending.clear(); this.w = null; };
    } catch { this.w = null; }
    this.capsP = this.call('caps').then(d => d.codecs).catch(() => []);
  }
  call(op, extra = {}, transfer = []) {
    if (!this.w) return Promise.reject(new Error('sem codec'));
    const id = ++this.seq;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.w.postMessage({ id, op, ...extra }, transfer);
    });
  }
  async compress(u8, codec, level) {
    const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    const d = await this.call('compress', { buf, codec, level }, [buf]);
    const out = new Uint8Array(d.buf);
    out.ms = d.ms || 0;
    return out;
  }
  async decompress(u8, codec) {
    const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    const d = await this.call('decompress', { buf, codec }, [buf]);
    return new Uint8Array(d.buf);
  }
}

function header(flags, frame, num, block, frames) {
  const h = new DataView(new ArrayBuffer(16));
  h.setUint8(0, 0xb1); h.setUint8(1, flags); h.setUint16(2, frame); h.setUint32(4, num); h.setUint32(8, block); h.setUint16(12, frames);
  return h.buffer;
}

function concat(parts) {
  const n = parts.reduce((s, p) => s + p.byteLength, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(new Uint8Array(p), o); o += p.byteLength; }
  return out;
}

function waitLow(dc) {
  return new Promise(res => {
    const done = () => { dc.removeEventListener('bufferedamountlow', done); clearTimeout(t); res(); };
    const t = setTimeout(done, 1000);
    dc.addEventListener('bufferedamountlow', done);
  });
}

export function likelyCompressed(file) {
  return SKIP_TYPES.test(file.type || '') || SKIP_EXT.test(file.name || '');
}

// ---------- gerente ----------
export class Transfers extends EventTarget {
  constructor(mesh, codec) {
    super();
    this.mesh = mesh;
    this.codec = codec;
    this.out = new Map();     // id → Outgoing
    this.inc = new Map();     // id → Incoming
    this.incByNum = new Map();
    this.nextNum = (crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff) || 1;
    mesh.addEventListener('data', e => this.onMsg(e.detail.peerId, e.detail.msg));
    mesh.addEventListener('binary', e => this.onBin(e.detail.peerId, e.detail.buf));
    mesh.addEventListener('open', e => this.onOpen(e.detail.peerId));
    mesh.addEventListener('close', e => this.onClose(e.detail.peerId));
    mesh.addEventListener('gone', e => this.onGone(e.detail.peerId));
    this.tick = setInterval(() => this.watch(), 5000);
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  changed(t) { this.emit('update', t); }

  /** Põe um arquivo na fila para um aparelho. */
  send(file, peerId, info = {}) {
    const t = new Outgoing(this, file, peerId, info);
    this.out.set(t.id, t);
    this.changed(t);
    this.kick(peerId);
    return t;
  }

  kick(peerId) {
    const active = [...this.out.values()].some(t => t.peerId === peerId && ['preparing', 'waiting', 'sending'].includes(t.state));
    if (active) return;
    const next = [...this.out.values()].find(t => t.peerId === peerId && t.state === 'queued');
    if (next) next.start();
  }

  onMsg(peerId, m) {
    if (!m || typeof m.id !== 'string') return;
    const o = this.out.get(m.id);
    const i = this.inc.get(m.id);
    switch (m.x) {
      case 'offer': {
        if (i) { this.mesh.send(peerId, JSON.stringify({ x: 'accept', id: m.id, from: i.written })); return; }
        const inc = new Incoming(this, peerId, m);
        this.inc.set(inc.id, inc);
        this.incByNum.set(inc.num, inc);
        inc.init();
        return;
      }
      case 'accept': if (o && o.peerId === peerId) o.onAccept(Number(m.from) || 0); return;
      case 'ack': if (o && o.peerId === peerId) o.onAck(Number(m.upto) || 0); return;
      case 'done': if (o && o.peerId === peerId) o.onDone(); return;
      case 'resume': {
        if (!i) { this.mesh.send(peerId, JSON.stringify({ x: 'unknown', id: m.id })); return; }
        if (i.state === 'done') { this.mesh.send(peerId, JSON.stringify({ x: 'done', id: m.id })); return; }
        i.partial = null;
        if (i.state === 'stalled') i.state = 'receiving';
        this.mesh.send(peerId, JSON.stringify({ x: 'accept', id: m.id, from: i.written }));
        this.changed(i);
        return;
      }
      case 'unknown': if (o && o.peerId === peerId) o.restart(); return;
      case 'cancel': {
        if (o && o.peerId === peerId) o.remoteCancel();
        if (i && i.peerId === peerId) i.remoteCancel();
        return;
      }
      case 'cloud': if (i && i.peerId === peerId) i.movedToCloud(); return;
      default:
    }
  }

  onBin(peerId, buf) {
    if (!(buf instanceof ArrayBuffer) || buf.byteLength < 16) return;
    const v = new DataView(buf);
    if (v.getUint8(0) !== 0xb1) return;
    const h = { flags: v.getUint8(1), frame: v.getUint16(2), num: v.getUint32(4), block: v.getUint32(8), frames: v.getUint16(12) };
    const inc = this.incByNum.get(h.num);
    if (!inc || inc.peerId !== peerId) return;
    inc.onFrame(h, buf.slice(16));
  }

  onOpen(peerId) {
    for (const t of this.out.values()) {
      if (t.peerId !== peerId) continue;
      if (t.state === 'interrupted') t.resume();
      else if (t.state === 'waiting') t.sendOffer();
    }
    this.kick(peerId);
  }

  onClose(peerId) {
    for (const t of this.out.values()) if (t.peerId === peerId && ['sending', 'waiting'].includes(t.state)) t.interrupt();
  }

  onGone(peerId) {
    for (const t of this.out.values()) if (t.peerId === peerId && ['queued', 'preparing', 'waiting', 'sending', 'interrupted'].includes(t.state)) t.fail('gone');
    for (const t of this.inc.values()) if (t.peerId === peerId && t.state === 'receiving') { t.state = 'stalled'; this.changed(t); }
  }

  watch() {
    const now = Date.now();
    for (const t of this.out.values()) {
      if (t.state === 'interrupted' && now - t.interruptedAt > CLOUD_SWITCH_MS && !t.cloudRequested) {
        t.cloudRequested = true;
        this.emit('need-cloud', t);
      }
      if (t.state === 'queued' && this.mesh.path(t.peerId) === 'server' && !t.cloudRequested) {
        t.cloudRequested = true;
        this.emit('need-cloud', t);
      }
    }
    for (const t of this.inc.values()) {
      if (t.state === 'receiving' && now - t.lastFrame > STALL_MS) { t.state = 'stalled'; this.changed(t); }
    }
  }
}

// ---------- envio ----------
export class Outgoing {
  constructor(mgr, file, peerId, info) {
    this.mgr = mgr;
    this.dir = 'out';
    this.id = randomId(9);
    this.num = mgr.nextNum = (mgr.nextNum + 1) >>> 0 || 1;
    this.file = file;
    this.name = file.name || 'arquivo';
    this.size = file.size;
    this.type = file.type || '';
    this.peerId = peerId;
    this.peerName = info.peerName || '';
    this.blockSize = BLOCK_SIZE;
    this.blocks = Math.ceil(file.size / BLOCK_SIZE);
    this.state = 'queued';
    this.next = 0;
    this.acked = 0;
    this.raw = 0;
    this.wire = 0;
    this.codec = 'none';
    this.level = 3;
    this.cache = new Map();
    this.run = 0;
    this.createdAt = Date.now();
    this.speed = 0;
    this.lastAckAt = 0;
    this.lastAckBytes = 0;
    this.wireQueued = 0;      // bytes entregues ao canal (cumulativo)
    this.sentMap = [];        // blocos enviados: posição no arquivo e no fluxo da rede
    this.dc = null;
    this.cpu = {};            // nível → bytes do arquivo comprimidos por segundo
    this.levelAt = 0;
    this.idleChecks = 0;
  }

  get done() { return Math.min(this.size, this.acked * this.blockSize); }
  get ratio() { return this.raw ? this.wire / this.raw : 1; }

  /** Bytes que já saíram pela rede e a posição correspondente no arquivo. */
  liveStats() {
    const buffered = this.state === 'sending' && this.dc && this.dc.readyState === 'open' ? this.dc.bufferedAmount : 0;
    const net = Math.max(0, this.wireQueued - buffered);
    let raw = this.done;
    while (this.sentMap.length > 1 && this.sentMap[0].wireEnd <= net) this.sentMap.shift();
    for (const e of this.sentMap) {
      if (net <= e.wireEnd) {
        const f = e.wireEnd > e.wireStart ? (net - e.wireStart) / (e.wireEnd - e.wireStart) : 1;
        raw = Math.max(raw, e.rawStart + Math.max(0, Math.min(1, f)) * (e.rawEnd - e.rawStart));
        break;
      }
      raw = Math.max(raw, e.rawEnd);
    }
    return { net, raw: Math.min(this.size, raw) };
  }

  async start() {
    this.state = 'preparing';
    this.mgr.changed(this);
    const local = await this.mgr.codec.capsP;
    const remote = this.mgr.mesh.remoteCaps(this.peerId)?.codecs || [];
    const common = ['zstd', 'deflate'].find(c => local.includes(c) && remote.includes(c));
    this.level = this.mgr.mesh.path(this.peerId) === 'relay' ? 6 : 3;
    this.blockSize = BLOCK_SIZE;
    if (common && !likelyCompressed(this.file) && this.size > 4096) {
      try { await this.probe(common); } catch { this.codec = 'none'; }
    }
    this.blocks = Math.ceil(this.size / this.blockSize);
    this.compressionSkipped = this.codec === 'none';
    this.alreadyCompressed = likelyCompressed(this.file);
    this.sendOffer();
  }

  /**
   * Decide se vale comprimir e com que tamanho de bloco, testando amostras do arquivo:
   * - o primeiro 1 MB no nível atual (se encolher 8% ou mais, comprime);
   * - em arquivos grandes, 8 MB do meio nos níveis 3 e 9. Se o 9 com bloco grande render bem mais,
   *   o arquivo tem repetições longas (backup, banco, imagem de disco) e vale usar blocos de 8 MB.
   */
  async probe(codec) {
    const cx = this.mgr.codec;
    const first = new Uint8Array(await this.file.slice(0, Math.min(this.size, BLOCK_SIZE)).arrayBuffer());
    const c = await cx.compress(first, codec, this.level);
    if (c.ms) this.cpu[this.level] = first.byteLength / (c.ms / 1000);
    const firstOk = c.byteLength < first.byteLength * 0.92;
    if (codec === 'zstd' && this.size >= BIG_MIN_SIZE) {
      const at = Math.floor((this.size - BIG_BLOCK) / 2 / BLOCK_SIZE) * BLOCK_SIZE;
      const sample = new Uint8Array(await this.file.slice(at, at + BIG_BLOCK).arrayBuffer());
      // Nível 3 enxerga ~2 MB para trás; nível 9 com bloco de 8 MB enxerga o bloco inteiro.
      const small = await cx.compress(sample.slice(), codec, 3);
      const big = await cx.compress(sample, codec, 9);
      if (small.ms) this.cpu[3] = sample.byteLength / (small.ms / 1000);
      if (big.ms) this.cpu[9] = sample.byteLength / (big.ms / 1000);
      const smallRatio = small.byteLength / sample.byteLength;
      const bigRatio = big.byteLength / sample.byteLength;
      if (bigRatio < 0.92 && bigRatio < smallRatio * 0.75) {
        this.codec = codec;
        this.blockSize = BIG_BLOCK;
        this.level = 9;
        return;
      }
      if (smallRatio < 0.92 || firstOk) { this.codec = codec; return; }
      return;
    }
    if (firstOk) {
      this.codec = codec;
      this.cache.set(0, Promise.resolve({ data: c, compressed: true, rawLen: first.byteLength, level: this.level }));
    }
  }

  sendOffer() {
    this.state = 'waiting';
    this.mgr.changed(this);
    this.mgr.mesh.send(this.peerId, JSON.stringify({
      x: 'offer', id: this.id, num: this.num, name: this.name, size: this.size, type: this.type,
      blocks: this.blocks, blockSize: this.blockSize, codec: this.codec
    }));
  }

  onAccept(from) {
    if (['done', 'cancelled', 'failed', 'cloud'].includes(this.state)) return;
    this.next = from;
    this.acked = Math.max(this.acked, from);
    if (!this.startedAt) this.startedAt = Date.now();
    this.state = 'sending';
    this.lastAckAt = Date.now();
    this.lastAckBytes = this.done;
    this.mgr.changed(this);
    if (this.blocks === 0) return;
    this.pump();
  }

  prepare(b) {
    if (this.cache.has(b)) return this.cache.get(b);
    const p = (async () => {
      const start = b * this.blockSize;
      const raw = new Uint8Array(await this.file.slice(start, Math.min(this.size, start + this.blockSize)).arrayBuffer());
      if (this.codec !== 'none') {
        const level = this.level;
        try {
          const c = await this.mgr.codec.compress(raw, this.codec, level);
          if (c.ms > 0) {
            const rate = raw.byteLength / (c.ms / 1000);
            this.cpu[level] = this.cpu[level] ? this.cpu[level] * 0.6 + rate * 0.4 : rate;
          }
          if (c.byteLength < raw.byteLength * 0.97) return { data: c, compressed: true, rawLen: raw.byteLength, level };
        } catch { /* manda sem compressão */ }
      }
      return { data: raw, compressed: false, rawLen: raw.byteLength };
    })();
    this.cache.set(b, p);
    return p;
  }

  async pump() {
    const myRun = ++this.run;
    while (this.next < this.blocks && this.state === 'sending' && myRun === this.run) {
      const dc = this.mgr.mesh.channel(this.peerId);
      if (!dc || dc.readyState !== 'open') { this.interrupt(); return; }
      this.dc = dc;
      if (dc.bufferedAmount > HIGH_WATER) { await waitLow(dc); continue; }
      const b = this.next;
      for (let k = 1; k <= PREFETCH && b + k < this.blocks; k++) this.prepare(b + k);
      let payload;
      try { payload = await this.prepare(b); } catch (e) { this.fail(e.message); return; }
      if (myRun !== this.run || this.state !== 'sending') return;
      if (dc.readyState !== 'open') { this.interrupt(); return; }
      const data = payload.data;
      // Fila no canal no momento em que o próximo bloco ficou pronto: se ainda tem coisa, a rede é o gargalo.
      const queued = dc.bufferedAmount;
      const frames = Math.max(1, Math.ceil(data.byteLength / FRAME_SIZE));
      const flags = payload.compressed ? 1 : 0;
      try {
        for (let f = 0; f < frames; f++) {
          const part = data.subarray(f * FRAME_SIZE, Math.min(data.byteLength, (f + 1) * FRAME_SIZE));
          const msg = new Uint8Array(16 + part.byteLength);
          msg.set(new Uint8Array(header(flags, f, this.num, b, frames)), 0);
          msg.set(part, 16);
          dc.send(msg.buffer);
        }
      } catch { this.interrupt(); return; }
      this.cache.delete(b);
      this.sentMap.push({ rawStart: b * this.blockSize, rawEnd: b * this.blockSize + payload.rawLen, wireStart: this.wireQueued, wireEnd: this.wireQueued + data.byteLength });
      this.wireQueued += data.byteLength;
      this.raw += payload.rawLen;
      this.wire += data.byteLength;
      if (payload.level) this.usedLevel = payload.level;
      this.next = b + 1;
      this.tune(dc, queued);
    }
  }

  /** Mede a rede a cada segundo e ajusta o nível de compressão. */
  tune(dc, queued) {
    if (this.codec !== 'zstd') return;
    const now = performance.now();
    const drained = this.wireQueued - dc.bufferedAmount;
    if (!this.tuneAt) { this.tuneAt = now; this.tuneDrained = drained; return; }
    const dt = (now - this.tuneAt) / 1000;
    if (dt < 1) return;
    const rate = (drained - this.tuneDrained) / dt;
    // Com fila no canal, a rede é o gargalo e a medida é a velocidade real dela.
    const busy = queued > BUSY_BYTES;
    if (busy) this.netRate = this.netRate ? this.netRate * 0.6 + rate * 0.4 : rate;
    this.tuneAt = now;
    this.tuneDrained = drained;
    const i = LEVELS.indexOf(this.level);
    const cpu = this.cpu[this.level];
    if (busy) {
      this.idleChecks = 0;
      const next = LEVELS[i + 1];
      // Bytes do arquivo por segundo que a rede consegue levar com a compressão atual.
      const need = this.netRate / Math.max(0.03, this.ratio);
      if (next && cpu && cpu / SLOWER[this.level] > need * 1.6 && now - this.levelAt > 1500) { this.level = next; this.levelAt = now; }
    } else if (i > 0 && ++this.idleChecks >= 2) {
      // Canal vazio duas vezes seguidas: a compressão está segurando o envio.
      this.idleChecks = 0;
      this.level = LEVELS[i - 1];
      this.levelAt = now;
    }
  }

  onAck(upto) {
    if (upto <= this.acked) return;
    this.acked = upto;
    const now = Date.now(), bytes = this.done;
    const dt = (now - this.lastAckAt) / 1000;
    if (dt > 0.25) {
      const inst = (bytes - this.lastAckBytes) / dt;
      this.speed = this.speed ? this.speed * 0.7 + inst * 0.3 : inst;
      this.lastAckAt = now;
      this.lastAckBytes = bytes;
    }
    this.mgr.changed(this);
  }

  onDone() {
    if (this.state === 'done') return;
    this.acked = this.blocks;
    this.state = 'done';
    this.finishedAt = Date.now();
    this.cache.clear();
    this.mgr.changed(this);
    this.mgr.kick(this.peerId);
  }

  interrupt() {
    if (!['sending', 'waiting'].includes(this.state)) return;
    // O que ficou no buffer do canal antigo nunca saiu: desconta.
    this.wireQueued = Math.max(0, this.wireQueued - (this.dc ? this.dc.bufferedAmount : 0));
    this.sentMap = [];
    this.dc = null;
    this.run++;
    this.state = 'interrupted';
    this.interruptedAt = Date.now();
    this.next = this.acked;
    this.cache.clear();
    this.mgr.changed(this);
  }

  resume() {
    if (this.state !== 'interrupted') return;
    this.state = 'waiting';
    this.mgr.changed(this);
    this.mgr.mesh.send(this.peerId, JSON.stringify({ x: 'resume', id: this.id }));
  }

  /** O outro lado perdeu a transferência (recarregou a página): recomeça. */
  restart() {
    this.acked = 0;
    this.next = 0;
    this.raw = 0;
    this.wire = 0;
    this.cache.clear();
    this.sendOffer();
  }

  pause() {
    if (this.state !== 'sending') return;
    this.run++;
    this.state = 'paused';
    this.mgr.changed(this);
  }
  unpause() {
    if (this.state !== 'paused') return;
    this.state = 'interrupted';
    this.interruptedAt = Date.now();
    this.resume();
  }

  cancel() {
    if (['done', 'cancelled'].includes(this.state)) return;
    this.run++;
    this.state = 'cancelled';
    this.cache.clear();
    this.mgr.mesh.send(this.peerId, JSON.stringify({ x: 'cancel', id: this.id }));
    this.mgr.changed(this);
    this.mgr.kick(this.peerId);
  }
  remoteCancel() {
    if (['done', 'cancelled'].includes(this.state)) return;
    this.run++;
    this.state = 'cancelled';
    this.cancelledByRemote = true;
    this.mgr.changed(this);
    this.mgr.kick(this.peerId);
  }

  /** Passa a transferência para a nuvem (o app faz o upload). */
  toCloud() {
    this.run++;
    this.state = 'cloud';
    this.cache.clear();
    this.mgr.mesh.send(this.peerId, JSON.stringify({ x: 'cloud', id: this.id }));
    this.mgr.changed(this);
    this.mgr.kick(this.peerId);
  }

  fail(why) {
    this.run++;
    this.state = 'failed';
    this.error = why;
    this.mgr.changed(this);
    this.mgr.kick(this.peerId);
  }
}

// ---------- recebimento ----------
class Incoming {
  constructor(mgr, peerId, m) {
    this.mgr = mgr;
    this.dir = 'in';
    this.peerId = peerId;
    this.id = m.id;
    this.num = Number(m.num) >>> 0;
    this.name = String(m.name || 'arquivo').slice(0, 200);
    this.size = Math.max(0, Number(m.size) || 0);
    this.type = String(m.type || '').slice(0, 120);
    this.blocks = Math.max(0, Number(m.blocks) || 0);
    this.blockSize = Math.min(16 * 1024 * 1024, Number(m.blockSize) || BLOCK_SIZE);
    this.codec = ['zstd', 'deflate'].includes(m.codec) ? m.codec : 'none';
    this.written = 0;
    this.wire = 0;
    this.partial = null;
    this.chain = Promise.resolve();
    this.state = 'receiving';
    this.startedAt = Date.now();
    this.lastFrame = Date.now();
    this.speed = 0;
    this.lastTick = Date.now();
    this.lastBytes = 0;
    this.wireDone = 0;       // bytes de rede dos blocos já gravados
    this.blockWire = 0;      // bytes de rede do bloco em andamento
  }

  get done() { return Math.min(this.size, this.written * this.blockSize); }

  liveStats() {
    const ratio = this.codec === 'none' || !this.wireDone ? 1 : this.done / this.wireDone;
    return { net: this.wire, raw: Math.min(this.size, this.done + this.blockWire * ratio) };
  }

  async init() {
    this.sink = await createSink();
    this.mgr.changed(this);
    if (this.blocks === 0) { await this.finish(); return; }
    this.mgr.mesh.send(this.peerId, JSON.stringify({ x: 'accept', id: this.id, from: 0 }));
  }

  onFrame(h, payload) {
    this.lastFrame = Date.now();
    this.chain = this.chain.then(() => this.handle(h, payload)).catch(e => this.fail(e.message));
  }

  async handle(h, payload) {
    if (this.state !== 'receiving' && this.state !== 'stalled') return;
    if (this.state === 'stalled') this.state = 'receiving';
    if (h.block !== this.written) return;
    if (h.frame === 0) { this.partial = { block: h.block, frames: h.frames, parts: [] }; this.blockWire = 0; }
    else if (!this.partial || this.partial.block !== h.block || this.partial.parts.length !== h.frame) { this.partial = null; return; }
    this.partial.parts.push(payload);
    this.wire += payload.byteLength;
    this.blockWire += payload.byteLength;
    if (this.partial.parts.length < h.frames) return;
    let data = concat(this.partial.parts);
    this.partial = null;
    if (h.flags & 1) data = await this.mgr.codec.decompress(data, this.codec);
    await this.sink.write(h.block * this.blockSize, data);
    this.written++;
    const now = Date.now();
    if (now - this.lastTick > 400) {
      const inst = (this.done - this.lastBytes) / ((now - this.lastTick) / 1000);
      this.speed = this.speed ? this.speed * 0.7 + inst * 0.3 : inst;
      this.lastTick = now;
      this.lastBytes = this.done;
      this.mgr.changed(this);
    }
    this.wireDone += this.blockWire;
    this.blockWire = 0;
    // Confirma cada bloco: quem envia vê o progresso real e sabe de onde retomar.
    this.mgr.mesh.send(this.peerId, JSON.stringify({ x: 'ack', id: this.id, upto: this.written }));
    if (this.written === this.blocks) await this.finish();
  }

  async finish() {
    const blob = await this.sink.finish(this.type);
    this.blob = blob;
    this.url = URL.createObjectURL(blob);
    this.state = 'done';
    this.finishedAt = Date.now();
    this.mgr.mesh.send(this.peerId, JSON.stringify({ x: 'done', id: this.id }));
    this.mgr.changed(this);
  }

  cancel() {
    if (['done', 'cancelled'].includes(this.state)) return;
    this.state = 'cancelled';
    this.sink?.abort();
    this.mgr.mesh.send(this.peerId, JSON.stringify({ x: 'cancel', id: this.id }));
    this.mgr.changed(this);
  }
  remoteCancel() {
    if (['done', 'cancelled'].includes(this.state)) return;
    this.state = 'cancelled';
    this.cancelledByRemote = true;
    this.sink?.abort();
    this.mgr.changed(this);
  }
  movedToCloud() {
    if (this.state === 'done') return;
    this.state = 'cloud';
    this.sink?.abort();
    this.mgr.changed(this);
  }
  fail(why) {
    this.state = 'failed';
    this.error = why;
    this.sink?.abort();
    this.mgr.changed(this);
  }
}
