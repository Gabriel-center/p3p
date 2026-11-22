// Confere que a compressão não perde nada.
// 1. Ida e volta de cada compressor usado pelo site (zstd em todos os níveis, deflate, gzip da nuvem),
//    com blocos de 1 MB e 8 MB, em vários tipos de dado. Compara o SHA-256 do resultado com o do original.
// 2. O caminho inteiro de uma transferência direta (transfer.js: oferta, blocos, compressão, conferência,
//    gravação), ligando um aparelho ao outro em memória.
// 3. Dados corrompidos no meio do caminho: o bloco errado é descartado e pedido de novo.
// Uso: node test/lossless.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';

globalThis.location = { hostname: 'localhost', pathname: '/', origin: 'http://localhost' };
globalThis.window = {};
const root = new URL('..', import.meta.url).pathname;
const zstd = await import('../assets/vendor/zstd/index.web.js');
await zstd.init(readFileSync(join(root, 'assets/vendor/zstd/zstd.wasm')));
const { Transfers, Outgoing } = await import('../assets/transfer.js');

const MB = 1024 * 1024;
const sha = b => createHash('sha256').update(b).digest('hex');
const viaStream = async (u8, Stream, fmt) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new Stream(fmt))).arrayBuffer());

// ---------- dados de teste ----------
function corpora() {
  const lines = [];
  for (let i = 0; i < 120000; i++) lines.push(`${i}\tsensor-${i % 97}\t${(Math.sin(i) * 1000).toFixed(3)}\tok\n`);
  const tsv = Buffer.from(lines.join(''));
  const json = Buffer.from(JSON.stringify(Array.from({ length: 30000 }, (_, i) => ({ id: i, nome: `item ${i}`, ativo: i % 3 === 0, tags: ['a', 'b', String(i % 11)] }))));
  const chunk = randomBytes(3 * MB);
  const backup = Buffer.concat([chunk, randomBytes(MB), chunk, chunk, randomBytes(512 * 1024), chunk]);   // repetições longas
  const allBytes = Buffer.alloc(256 * 300); for (let i = 0; i < allBytes.length; i++) allBytes[i] = i & 255;
  const sparse = Buffer.alloc(5 * MB); for (let i = 0; i < 2000; i++) sparse[(i * 7919) % sparse.length] = i & 255;
  const own = readdirSync(join(root, 'assets'), { recursive: true })
    .map(f => join(root, 'assets', f)).filter(f => statSync(f).isFile());
  const real = Buffer.concat(own.map(f => readFileSync(f)));    // o próprio site: js, css, wasm, woff2
  return {
    'vazio': Buffer.alloc(0), '1 byte': Buffer.from([7]), 'aleatório 1 MB - 1': randomBytes(MB - 1), 'aleatório 1 MB + 1': randomBytes(MB + 1),
    'aleatório 3 MB': randomBytes(3 * MB), 'zeros 9 MB': Buffer.alloc(9 * MB), 'tsv': tsv, 'json': json, 'backup': backup,
    'todos os bytes': allBytes, 'esparso': sparse, 'arquivos do site': real
  };
}

let checks = 0;
function same(a, b, what) { assert.equal(a.length, b.length, `${what}: tamanho`); assert.equal(sha(a), sha(b), `${what}: conteúdo`); checks++; }
function blocks(buf, size) { const out = []; for (let o = 0; o < buf.length; o += size) out.push(buf.subarray(o, o + size)); if (!out.length) out.push(buf); return out; }

// ---------- 1. compressores ----------
const data = corpora();
const t0 = Date.now();
let rawTotal = 0, zTotal = 0;
for (const [name, buf] of Object.entries(data)) {
  for (const bs of [MB, 8 * MB]) {
    for (const level of [3, 6, 9, 12, 15, 19]) {
      if (level >= 15 && buf.length > 6 * MB && bs === 8 * MB) continue;   // os níveis lentos já passam no bloco de 1 MB
      const parts = [];
      for (const b of blocks(buf, bs)) {
        const c = zstd.compress(new Uint8Array(b), level);
        if (level === 3 && bs === MB) { rawTotal += b.length; zTotal += c.length; }
        parts.push(Buffer.from(zstd.decompress(c)));
      }
      same(Buffer.concat(parts), buf, `zstd ${level} / blocos de ${bs / MB} MB / ${name}`);
    }
    const parts = [];
    for (const b of blocks(buf, bs)) parts.push(Buffer.from(await viaStream(await viaStream(b, CompressionStream, 'deflate-raw'), DecompressionStream, 'deflate-raw')));
    same(Buffer.concat(parts), buf, `deflate / blocos de ${bs / MB} MB / ${name}`);
  }
  // Nuvem: gzip no navegador, o navegador de quem baixa descompacta (Content-Encoding: gzip).
  const gz = await viaStream(buf, CompressionStream, 'gzip');
  same(gunzipSync(gz), buf, `gzip da nuvem / ${name}`);
}
console.log(`✔ compressores: ${checks} idas e voltas idênticas ao original (${((Date.now() - t0) / 1000).toFixed(1)} s; zstd 3 reduziu ${(rawTotal / MB).toFixed(0)} MB para ${(zTotal / MB).toFixed(0)} MB)`);

// ---------- 2. transferência completa em memória ----------
class FakeMesh extends EventTarget {
  constructor(name, codecs) {
    super();
    this.name = name;
    this.codecs = codecs;
    this.tamper = null;
    this.dc = { readyState: 'open', bufferedAmount: 0, send: d => this.deliver(d), addEventListener() {}, removeEventListener() {} };
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  path() { return 'direct'; }
  remoteCaps() { return { codecs: this.other.codecs }; }
  channel() { return this.dc; }
  isOpen() { return true; }
  send(_peer, d) { this.deliver(d); return true; }
  deliver(d) {
    if (typeof d !== 'string' && this.tamper) d = this.tamper(d) || d;
    setImmediate(() => {
      if (typeof d === 'string') this.other.emit('data', { peerId: this.name, msg: JSON.parse(d) });
      else this.other.emit('binary', { peerId: this.name, buf: d });
    });
  }
}
function codecFor(list) {
  return {
    capsP: Promise.resolve(list),
    async compress(u8, c, level) {
      const t = performance.now();
      const out = c === 'zstd' ? zstd.compress(u8, level) : await viaStream(u8, CompressionStream, 'deflate-raw');
      const r = out.slice(); r.ms = performance.now() - t; return r;
    },
    async decompress(u8, c) { return c === 'zstd' ? zstd.decompress(u8) : viaStream(u8, DecompressionStream, 'deflate-raw'); }
  };
}
function link(codecs) {
  const A = new FakeMesh('A', codecs), B = new FakeMesh('B', codecs);
  A.other = B; B.other = A;
  return { A, B, ta: new Transfers(A, codecFor(codecs)), tb: new Transfers(B, codecFor(codecs)) };
}
async function until(fn, ms = 120000) {
  const end = Date.now() + ms;
  while (!fn()) { if (Date.now() > end) throw new Error('tempo esgotado'); await new Promise(r => setTimeout(r, 20)); }
}
async function transfer(buf, name, codecs, tamper) {
  const { A, ta, tb } = link(codecs);
  A.tamper = tamper || null;
  const out = ta.send(new File([buf], name, { type: 'application/octet-stream' }), 'B', { peerName: 'B' });
  await until(() => ['done', 'failed', 'cancelled'].includes(out.state));
  const inc = [...tb.inc.values()][0];
  await until(() => !inc || ['done', 'failed', 'cancelled'].includes(inc.state));
  clearInterval(ta.tick); clearInterval(tb.tick);
  return { out, inc };
}

const t1 = Date.now();
const cases = [];
for (const codecs of [['zstd', 'deflate'], ['deflate'], []]) {
  for (const name of ['tsv', 'json', 'aleatório 1 MB + 1', 'vazio', '1 byte', 'esparso']) cases.push([name, data[name], codecs]);
}
// Arquivo grande e repetitivo: o site escolhe blocos de 8 MB e nível 9.
const big = Buffer.concat(Array.from({ length: 10 }, () => data.backup.subarray(0, 3 * MB)));
cases.push(['backup 30 MB', big, ['zstd', 'deflate']]);
for (const [name, buf, codecs] of cases) {
  const { out, inc } = await transfer(buf, `${name}.bin`, codecs);
  const what = `${name} via ${out.codec}${out.blockSize > MB ? ' (blocos de 8 MB)' : ''}`;
  assert.equal(out.state, 'done', `${what}: envio ${out.state} ${out.error || ''}`);
  assert.equal(inc.state, 'done', `${what}: recebimento ${inc.state} ${inc.error || ''}`);
  same(Buffer.from(await inc.blob.arrayBuffer()), buf, what);
  assert.ok(inc.intact && out.intact, `${what}: conferência por bloco (${inc.verified}/${inc.blocks})`);
  if (name === 'backup 30 MB') assert.equal(out.blockSize, 8 * MB, 'backup deveria usar blocos de 8 MB');
  if (name === 'tsv' && codecs.length) assert.ok(out.wire < out.raw * 0.6, `${what}: deveria comprimir`);
}
console.log(`✔ transferências completas: ${cases.length} arquivos chegaram idênticos e conferidos bloco a bloco (${((Date.now() - t1) / 1000).toFixed(1)} s)`);

// ---------- 3. corrupção no caminho ----------
const flip = (when) => {
  let n = 0;
  return buf => {
    const v = new DataView(buf);
    if (v.getUint32(8) === 1 && v.getUint16(2) === 0 && when(n++)) {
      const copy = buf.slice(0); new Uint8Array(copy)[40] ^= 0xff; return copy;
    }
  };
};
for (const codecs of [['zstd'], []]) {
  const { out, inc } = await transfer(data.tsv, 'tsv', codecs, flip(n => n === 0));
  assert.equal(inc.state, 'done', `corrompido uma vez (${codecs[0] || 'sem compressão'}): ${inc.state} ${inc.error || ''}`);
  assert.equal(inc.bad, 1, 'deveria ter descartado 1 bloco');
  same(Buffer.from(await inc.blob.arrayBuffer()), data.tsv, `bloco corrompido pedido de novo (${codecs[0] || 'sem compressão'})`);
  assert.ok(out.intact && inc.intact);
  const bad = await transfer(data.tsv, 'tsv', codecs, flip(() => true));
  assert.equal(bad.inc.state, 'failed', 'corrupção permanente deveria falhar');
  assert.equal(bad.out.state, 'failed', 'quem envia deveria saber que falhou');
  assert.equal(bad.out.error, 'checksum');
}
console.log('✔ corrupção: bloco alterado é descartado e reenviado; se continuar errado, o envio falha em vez de gravar dado errado');
console.log(`\nTudo certo: ${checks} comparações de SHA-256, nenhuma diferença.`);
process.exit(0);
