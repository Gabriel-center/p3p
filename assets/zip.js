// Junta vários arquivos num .zip, no próprio navegador, sem mandar nada para servidor.
// Arquivos que já são compactados (fotos, vídeos, zip...) entram como estão; os outros são comprimidos com
// deflate quando isso diminui o tamanho. Suporta ZIP64 (arquivos e zips acima de 4 GB).
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(crc, u8) {
  let c = ~crc >>> 0;
  for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

const MAX32 = 0xffffffff;
const SKIP = /\.(jpe?g|png|gif|webp|avif|heic|heif|mp4|m4v|mov|mkv|webm|mp3|m4a|aac|ogg|opus|flac|zip|gz|tgz|7z|rar|xz|bz2|zst|br|jar|apk|ipa|dmg|docx|xlsx|pptx|odt|ods|epub|pdf|woff2?)$/i;
const SKIP_TYPE = /^(image\/(?!svg|bmp)|video\/|audio\/(?!wav|x-wav)|application\/(zip|gzip|x-7z|x-rar|x-xz|zstd|pdf))/i;

/** Nome seguro dentro do zip: sem pastas, sem caracteres proibidos no Windows, sem repetir. */
function safeNames(entries) {
  const seen = new Set();
  return entries.map(e => {
    let n = String(e.name || 'arquivo').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^[.\s]+/, '').slice(0, 200) || 'arquivo';
    const m = /^(.*?)(\.[^.]{1,10})?$/.exec(n);
    let k = 2;
    while (seen.has(n.toLowerCase())) n = `${m[1]} (${k++})${m[2] || ''}`;
    seen.add(n.toLowerCase());
    return n;
  });
}

function dosTime(d) {
  const y = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

class Bytes {
  constructor(n) { this.b = new Uint8Array(n); this.v = new DataView(this.b.buffer); this.o = 0; }
  u16(x) { this.v.setUint16(this.o, x, true); this.o += 2; return this; }
  u32(x) { this.v.setUint32(this.o, x >>> 0, true); this.o += 4; return this; }
  u64(x) { this.v.setUint32(this.o, x % 0x100000000, true); this.v.setUint32(this.o + 4, Math.floor(x / 0x100000000), true); this.o += 8; return this; }
  raw(u8) { this.b.set(u8, this.o); this.o += u8.length; return this; }
}

/** Lê o arquivo uma vez: calcula o CRC e, se valer a pena, comprime ao mesmo tempo. */
async function encode(blob, tryDeflate, onBytes) {
  let crc = 0;
  let cs = null, writer = null, out = null;
  if (tryDeflate) {
    cs = new CompressionStream('deflate-raw');
    writer = cs.writable.getWriter();
    out = new Response(cs.readable).blob();
  }
  const reader = blob.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    crc = crc32(crc, value);
    onBytes(value.byteLength);
    if (writer) await writer.write(value);
  }
  if (!writer) return { crc, data: blob, method: 0 };
  await writer.close();
  const comp = await out;
  return comp.size < blob.size ? { crc, data: comp, method: 8 } : { crc, data: blob, method: 0 };
}

/**
 * entries: [{ name, blob, date? }]. onProgress(bytesLidos, total). Devolve um Blob do zip.
 * force64: só para testes, grava tudo em ZIP64.
 */
export async function makeZip(entries, { onProgress, force64 = false } = {}) {
  const names = safeNames(entries);
  const enc = new TextEncoder();
  const total = entries.reduce((s, e) => s + e.blob.size, 0);
  let read = 0;
  const parts = [];
  const central = [];
  let offset = 0;
  const deflateOk = typeof CompressionStream !== 'undefined';
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const name = enc.encode(names[i]);
    const worth = deflateOk && e.blob.size > 512 && !SKIP.test(names[i]) && !SKIP_TYPE.test(e.blob.type || '');
    const r = await encode(e.blob, worth, n => { read += n; onProgress?.(read, total); });
    const usize = e.blob.size, csize = r.data.size;
    const big = force64 || usize >= MAX32 || csize >= MAX32;
    const farOffset = force64 || offset >= MAX32;
    const { time, date } = dosTime(e.date || new Date());
    // Cabeçalho local
    const lx = big ? 20 : 0;
    const local = new Bytes(30 + name.length + lx)
      .u32(0x04034b50).u16(big ? 45 : 20).u16(0x0800).u16(r.method).u16(time).u16(date)
      .u32(r.crc).u32(big ? MAX32 : csize).u32(big ? MAX32 : usize).u16(name.length).u16(lx).raw(name);
    if (big) local.u16(0x0001).u16(16).u64(usize).u64(csize);
    parts.push(local.b, r.data);
    // Registro central
    const cx = (big ? 16 : 0) + (farOffset ? 8 : 0);
    const c = new Bytes(46 + name.length + (cx ? cx + 4 : 0))
      .u32(0x02014b50).u16(big || farOffset ? 45 : 20).u16(big || farOffset ? 45 : 20).u16(0x0800).u16(r.method).u16(time).u16(date)
      .u32(r.crc).u32(big ? MAX32 : csize).u32(big ? MAX32 : usize).u16(name.length).u16(cx ? cx + 4 : 0).u16(0)
      .u16(0).u16(0).u32(0).u32(farOffset ? MAX32 : offset).raw(name);
    if (cx) { c.u16(0x0001).u16(cx); if (big) c.u64(usize).u64(csize); if (farOffset) c.u64(offset); }
    central.push(c.b);
    offset += local.b.length + csize;
  }
  const cdStart = offset;
  const cdSize = central.reduce((s, b) => s + b.length, 0);
  const z64 = force64 || entries.length >= 0xffff || cdStart >= MAX32 || cdSize >= MAX32;
  const tail = [];
  if (z64) {
    const rec = new Bytes(56).u32(0x06064b50).u64(44).u16(45).u16(45).u32(0).u32(0)
      .u64(entries.length).u64(entries.length).u64(cdSize).u64(cdStart);
    const loc = new Bytes(20).u32(0x07064b50).u32(0).u64(cdStart + cdSize).u32(1);
    tail.push(rec.b, loc.b);
  }
  const end = new Bytes(22).u32(0x06054b50).u16(0).u16(0)
    .u16(z64 ? 0xffff : entries.length).u16(z64 ? 0xffff : entries.length)
    .u32(z64 ? MAX32 : cdSize).u32(z64 ? MAX32 : cdStart).u16(0);
  return new Blob([...parts, ...central, ...tail, end.b], { type: 'application/zip' });
}
