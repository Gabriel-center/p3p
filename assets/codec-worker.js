// Comprime e descompacta blocos fora da tela principal, para a interface não travar.
let zstd = null;
const zstdReady = (async () => {
  try {
    const m = await import('./vendor/zstd/index.web.js');
    await m.init(new URL('./vendor/zstd/zstd.wasm', import.meta.url).href);
    zstd = m;
    return true;
  } catch (e) {
    return false;
  }
})();

const deflateOk = typeof CompressionStream !== 'undefined' && (() => {
  try { new CompressionStream('deflate-raw'); return true; } catch { return false; }
})();

async function viaStream(buf, Stream, format) {
  const s = new Blob([buf]).stream().pipeThrough(new Stream(format));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

self.onmessage = async ({ data }) => {
  const { id, op } = data;
  try {
    if (op === 'caps') {
      const z = await zstdReady;
      const codecs = [];
      if (z) codecs.push('zstd');
      if (deflateOk) codecs.push('deflate');
      self.postMessage({ id, codecs });
      return;
    }
    const input = new Uint8Array(data.buf);
    const t0 = performance.now();
    let out;
    if (op === 'compress') {
      if (data.codec === 'zstd') { await zstdReady; out = zstd.compress(input, data.level || 3); }
      else out = await viaStream(input, CompressionStream, 'deflate-raw');
    } else if (op === 'decompress') {
      if (data.codec === 'zstd') { await zstdReady; out = zstd.decompress(input); }
      else out = await viaStream(input, DecompressionStream, 'deflate-raw');
    } else {
      throw new Error('operação desconhecida');
    }
    const copy = out.byteOffset === 0 && out.byteLength === out.buffer.byteLength ? out : out.slice();
    // ms = tempo só desta operação, sem a fila: quem envia usa para escolher o nível.
    self.postMessage({ id, buf: copy.buffer, ms: performance.now() - t0 }, [copy.buffer]);
  } catch (e) {
    self.postMessage({ id, error: String(e && e.message || e) });
  }
};
