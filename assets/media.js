// Prévias de imagens e vídeos.
// - Miniatura pequena (96 px) que vai junto na oferta: quem recebe já vê a foto desfocada, como no WhatsApp.
// - Prévia maior (720 px) para a conversa, feita a partir do arquivo completo, guardada em cache.
const IMG_EXT = /\.(jpe?g|jfif|png|gif|webp|avif|bmp|svg|ico|heic|heif)$/i;
const VID_EXT = /\.(mp4|m4v|mov|webm|mkv|ogv|3gp)$/i;
const AUD_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|weba)$/i;

/** 'image' | 'video' | 'audio' | 'file' */
export function kindOf(type = '', name = '') {
  if (/^image\//i.test(type) || IMG_EXT.test(name)) return 'image';
  if (/^video\//i.test(type) || VID_EXT.test(name)) return 'video';
  if (/^audio\//i.test(type) || AUD_EXT.test(name)) return 'audio';
  return 'file';
}

/** 0:07, 12:30, 1:02:03 */
export function clock(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

const once = (el, ok, ms) => new Promise((res, rej) => {
  const t = setTimeout(() => { clean(); rej(new Error('timeout')); }, ms);
  const done = () => { clean(); res(); };
  const fail = () => { clean(); rej(new Error('media')); };
  const clean = () => { clearTimeout(t); el.removeEventListener(ok, done); el.removeEventListener('error', fail); };
  el.addEventListener(ok, done);
  el.addEventListener('error', fail);
});

/** Abre a imagem ou o primeiro quadro do vídeo. Devolve algo que dá para desenhar num canvas. */
async function source(blob, kind) {
  if (kind === 'image') {
    try {
      const bmp = await createImageBitmap(blob);
      return { img: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close?.() };
    } catch {
      // SVG e formatos que o createImageBitmap não abre: tenta por um <img>.
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      try { await img.decode(); } catch (e) { URL.revokeObjectURL(url); throw e; }
      const w = img.naturalWidth || 300, h = img.naturalHeight || 300;
      return { img, w, h, close: () => URL.revokeObjectURL(url) };
    }
  }
  if (kind === 'video') {
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.src = url;
    const close = () => { v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); };
    try {
      await once(v, 'loadeddata', 10000);
      const dur = Number.isFinite(v.duration) ? v.duration : 0;
      const at = Math.min(1, dur * 0.1);
      if (at > 0.04) { v.currentTime = at; await once(v, 'seeked', 5000).catch(() => {}); }
      return { img: v, w: v.videoWidth, h: v.videoHeight, dur, close };
    } catch (e) { close(); throw e; }
  }
  throw new Error('sem prévia');
}

let webp = null;
function bestType() {
  if (webp === null) {
    try { const c = document.createElement('canvas'); c.width = c.height = 1; webp = c.toDataURL('image/webp').startsWith('data:image/webp'); } catch { webp = false; }
  }
  return webp ? 'image/webp' : 'image/jpeg';
}

function draw(src, max) {
  const scale = Math.min(1, max / Math.max(src.w, src.h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(src.w * scale));
  c.height = Math.max(1, Math.round(src.h * scale));
  const ctx = c.getContext('2d');
  // JPEG não tem transparência: fundo claro em vez de preto.
  if (bestType() === 'image/jpeg') { ctx.fillStyle = '#e7ebf2'; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.drawImage(src.img, 0, 0, c.width, c.height);
  return c;
}

/**
 * Miniatura para mandar na oferta + dimensões (e duração dos vídeos). null se não for imagem nem vídeo,
 * ou se o navegador não conseguir abrir o arquivo.
 */
export async function makeThumb(blob, type, name) {
  const kind = kindOf(type, name);
  if (kind !== 'image' && kind !== 'video') return null;
  if (kind === 'image' && blob.size > 80 * 1024 * 1024) return null;
  let src;
  try { src = await source(blob, kind); } catch { return null; }
  try {
    const c = draw(src, 96);
    let thumb = c.toDataURL(bestType(), 0.55);
    if (thumb.length > 40000) thumb = c.toDataURL('image/jpeg', 0.4);
    return { thumb, media: { w: src.w, h: src.h, dur: src.dur || 0 } };
  } catch { return null; } finally { src.close(); }
}

// ---------- prévias grandes, em cache ----------
const cache = new WeakMap();    // blob → { url } | { p }
const queue = [];
let running = 0;

function pump() {
  while (running < 2 && queue.length) {
    const job = queue.shift();
    running++;
    job().finally(() => { running--; pump(); });
  }
}

/**
 * Endereço de uma prévia para mostrar na conversa. Se ainda não existe, começa a fazer e devolve null;
 * quando ficar pronta, chama onReady(). Imagens pequenas usam o próprio arquivo; as grandes e os vídeos
 * viram uma imagem de 720 px.
 */
export function previewUrl(blob, type, name, onReady) {
  if (!blob) return null;
  const hit = cache.get(blob);
  if (hit) {
    if (hit.url !== undefined) return hit.url;
    if (onReady) hit.waiters.add(onReady);
    return null;
  }
  const kind = kindOf(type, name);
  if (kind !== 'image' && kind !== 'video') { cache.set(blob, { url: null }); return null; }
  if (kind === 'image' && blob.size < 1.5 * 1024 * 1024 && !/heic|heif/i.test(type + name)) {
    const url = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: type || 'image/*' }));
    cache.set(blob, { url });
    return url;
  }
  const entry = { waiters: new Set(onReady ? [onReady] : []) };
  cache.set(blob, entry);
  queue.push(async () => {
    let url = null;
    try {
      const src = await source(blob, kind);
      try {
        const c = draw(src, 720);
        const out = await new Promise(r => c.toBlob(r, bestType(), 0.82));
        if (out) url = URL.createObjectURL(out);
      } finally { src.close(); }
    } catch { url = null; }
    entry.url = url;
    for (const f of entry.waiters) { try { f(); } catch { /* ok */ } }
    entry.waiters.clear();
  });
  pump();
  return null;
}

/** true quando a prévia já foi feita (com ou sem sucesso). */
export function previewSettled(blob) {
  const hit = blob && cache.get(blob);
  return !!hit && hit.url !== undefined;
}

/** Faz várias miniaturas uma de cada vez, para não abrir 50 fotos ao mesmo tempo. */
export function thumbsInOrder(files) {
  let chain = Promise.resolve();
  return files.map(f => {
    const p = chain.then(() => makeThumb(f, f.type, f.name));
    chain = p.catch(() => null);
    return p.catch(() => null);
  });
}
