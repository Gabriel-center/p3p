// Vidro líquido: o que passa por baixo de um controle flutuante entorta perto da borda, como uma lente.
// Como funciona: para cada tamanho de controle, um mapa de deslocamento (imagem pequena, calculada uma
// vez e guardada) diz, pixel a pixel, de onde vem a luz. A borda tem o perfil de um "squircle" convexo;
// a inclinação da superfície e a lei de Snell (vidro, n = 1,5) dão quanto a luz desvia. Perto da borda
// ela vem de mais para dentro, então o fundo aparece comprimido e curvado no aro do vidro.
// O mapa entra num filtro SVG (feDisplacementMap) usado pelo backdrop-filter do controle.
// Só Chrome, Edge e Android aplicam filtro SVG no backdrop-filter; no Safari e no Firefox o controle fica
// com o vidro feito só com CSS (desfoque, saturação e luz na borda). Nada roda por quadro: o mapa só é
// refeito quando o tamanho do controle muda.
const N = 1.5;
let root = null, seq = 0;
const cache = new Map();      // "w×h×r" → id do filtro
const watched = new WeakMap();

export const refracts = (() => {
  try {
    const chromium = !!navigator.userAgentData?.brands?.some(b => /Chromium/i.test(b.brand));
    return chromium && CSS.supports('backdrop-filter', 'url(#a)');
  } catch { return false; }
})();

function defs() {
  if (root?.isConnected) return root;
  root = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  root.setAttribute('width', '0'); root.setAttribute('height', '0'); root.setAttribute('aria-hidden', 'true');
  root.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  document.body.appendChild(root);
  return root;
}

// Altura da superfície ao longo da borda: 0 na beirada, 1 onde o vidro fica plano.
const surface = x => Math.pow(1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 4), 0.25);

/** Quanto a luz desvia (0–1) em cada ponto da borda, de fora (0) para dentro (1). */
function profile(samples = 128) {
  const out = new Float32Array(samples + 1);
  let max = 0;
  for (let i = 0; i <= samples; i++) {
    const x = i / samples, e = 1 / samples;
    const slope = (surface(Math.min(1, x + e)) - surface(Math.max(0, x - e))) / (2 * e);
    const a1 = Math.atan(slope);                       // ângulo de incidência (normal da superfície)
    const a2 = Math.asin(Math.sin(a1) / N);            // ângulo dentro do vidro
    out[i] = Math.tan(a1 - a2);
    if (out[i] > max) max = out[i];
  }
  for (let i = 0; i <= samples; i++) out[i] /= max || 1;
  return out;
}
const PROFILE = profile();

function displacementMap(w, h, r, bezel, maxPx) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const hw = w / 2, hh = h / 2;
  const scale = maxPx * 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - hw, py = y + 0.5 - hh;
      const qx = Math.abs(px) - (hw - r), qy = Math.abs(py) - (hh - r);
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
      const outside = Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
      const inside = -outside;                           // distância até a borda, para dentro
      const i = (y * w + x) * 4;
      let dx = 0, dy = 0;
      if (inside > 0 && inside < bezel) {
        let nx, ny;                                      // normal para fora
        if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; nx = qx / l; ny = qy / l; }
        else if (qx > qy) { nx = 1; ny = 0; } else { nx = 0; ny = 1; }
        nx *= Math.sign(px) || 1; ny *= Math.sign(py) || 1;
        const m = PROFILE[Math.round((inside / bezel) * (PROFILE.length - 1))] * maxPx;
        dx = -nx * m; dy = -ny * m;                      // a luz vem de mais para dentro
      }
      d[i] = 128 + Math.round((dx / scale) * 255);
      d[i + 1] = 128 + Math.round((dy / scale) * 255);
      d[i + 2] = 128;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { url: c.toDataURL('image/png'), scale };
}

function filterFor(w, h, r) {
  const key = `${w}x${h}x${r}`;
  if (cache.has(key)) return cache.get(key);
  const bezel = Math.max(6, Math.min(r, Math.min(w, h) / 2) * 0.72);
  const maxPx = Math.min(16, bezel * 0.7);
  const { url, scale } = displacementMap(w, h, Math.min(r, w / 2, h / 2), bezel, maxPx);
  const id = `lg${++seq}`;
  const NS = 'http://www.w3.org/2000/svg';
  const f = document.createElementNS(NS, 'filter');
  f.setAttribute('id', id);
  f.setAttribute('x', '0'); f.setAttribute('y', '0'); f.setAttribute('width', String(w)); f.setAttribute('height', String(h));
  f.setAttribute('filterUnits', 'userSpaceOnUse');
  f.setAttribute('color-interpolation-filters', 'sRGB');
  const im = document.createElementNS(NS, 'feImage');
  im.setAttribute('href', url);
  im.setAttribute('x', '0'); im.setAttribute('y', '0'); im.setAttribute('width', String(w)); im.setAttribute('height', String(h));
  im.setAttribute('preserveAspectRatio', 'none');
  im.setAttribute('result', 'map');
  const dm = document.createElementNS(NS, 'feDisplacementMap');
  dm.setAttribute('in', 'SourceGraphic'); dm.setAttribute('in2', 'map');
  dm.setAttribute('scale', String(scale));
  dm.setAttribute('xChannelSelector', 'R'); dm.setAttribute('yChannelSelector', 'G');
  f.append(im, dm);
  defs().appendChild(f);
  cache.set(key, id);
  return id;
}

function apply(el) {
  const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
  if (w < 8 || h < 8 || w > 900 || h > 300) { el.style.removeProperty('--lg'); return; }
  const cs = getComputedStyle(el);
  const r = Math.round(Math.min(parseFloat(cs.borderTopLeftRadius) || 0, w / 2, h / 2));
  el.style.setProperty('--lg', `url(#${filterFor(w, h, r)})`);
}

const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(list => { for (const e of list) apply(e.target); }) : null;

/** Põe o vidro líquido num elemento (e mantém quando ele muda de tamanho). */
export function glass(el) {
  if (!el) return;
  el.classList.add('lg');
  if (!refracts || watched.has(el)) return;
  watched.set(el, true);
  apply(el);
  ro?.observe(el);
}
