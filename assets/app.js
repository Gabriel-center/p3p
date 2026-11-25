// Controlador da interface: início, sala e histórico.
import { WORKER_URL, PAGE_URL, APP, KEY } from './config.js?v=202611251905';
import { t, bytes, count, duration, time, dayLabel, countdown, LANG } from './i18n.js?v=202611251905';
import { getMe, setMyName, randomId, randomRoomName, normalizeRoom, roomFromLocation, isHistoryRoute, load, save } from './device.js?v=202611251905';
import { RoomClient } from './room-client.js?v=202611251905';
import { Mesh } from './mesh.js?v=202611251905';
import { Codec, Transfers, cleanBatch, cleanThumb, cleanMedia } from './transfer.js?v=202611251905';
import { kindOf, clock, previewUrl, thumbsInOrder } from './media.js?v=202611251905';
import { makeZip } from './zip.js?v=202611251905';
import { Viewer } from './viewer.js?v=202611251905';
import { CloudUpload, downloadUrl } from './cloud.js?v=202611251905';
import { cleanupOld } from './storage.js?v=202611251905';
import { SpeedMeter } from './speed.js?v=202611251905';
import * as hist from './history.js?v=202611251905';
import * as vault from './vault.js?v=202611251905';

document.documentElement.lang = LANG === 'pt' ? 'pt-BR' : 'en';

// ---------- utilidades ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const linkify = s => esc(s).replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
const app = document.getElementById('app');
const PW_KEY = room => `${KEY}.pw.${room}`;
const SITE = PAGE_URL.replace(/^https?:\/\//, '');

const svg = (d, extra = '') => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"${extra}>${d}</svg>`;
const ICON = {
  mobile: svg('<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.5h2"/>'),
  tablet: svg('<rect x="4.5" y="3" width="15" height="18" rx="2.2"/><path d="M11 18h2"/>'),
  desktop: svg('<rect x="3.5" y="4.5" width="17" height="11.5" rx="1.6"/><path d="M8.5 20h7M12 16v4"/>'),
  clip: svg('<path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1l8.1-8.1a3.3 3.3 0 0 1 4.7 4.7l-8.1 8.1a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  share: svg('<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="M8.2 10.8l7.6-4.1M8.2 13.2l7.6 4.1"/>'),
  qr: svg('<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2"/>'),
  up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  send: svg('<path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/>'),
  down: svg('<path d="M12 4v12M6.5 10.5L12 16l5.5-5.5M5 20h14"/>'),
  join: svg('<path d="M5 12h12M12 6l6 6-6 6"/>'),
  leave: svg('<path d="M19 12H7M12 6l-6 6 6 6"/>'),
  swap: svg('<path d="M4 8h14l-3-3M20 16H6l3 3"/>'),
  cloud: svg('<path d="M7 18a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.4 1.6A3.8 3.8 0 0 1 17.5 18z"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  copy: svg('<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  lock: svg('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  back: svg('<path d="M15 6l-6 6 6 6"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
  auto: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" stroke="none"/>'),
  history: svg('<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5M12 8v4l3 2"/>'),
  play: svg('<path d="M8 5.2v13.6L19 12z" fill="currentColor" stroke="none"/>'),
  music: svg('<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>'),
  zip: svg('<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3v5h5M10 5h1M10 8h1M10 11h1M9.5 14h2v3h-2z"/>'),
  squeeze: svg('<path d="M4 12h16M12 2.5V9M9 6l3 3 3-3M12 21.5V15M9 18l3-3 3 3"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  warn: svg('<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.2"/>'),
  expand: svg('<path d="M4 9.5V4h5.5M20 9.5V4h-5.5M4 14.5V20h5.5M20 14.5V20h-5.5"/>'),
  stack: svg('<rect x="3.5" y="7.5" width="13" height="13" rx="2"/><path d="M7.5 4h11A2.5 2.5 0 0 1 21 6.5v11"/>')
};
// Visual "vidro" (data-skin="vidro" no index.html): troca ícones, a marca e pequenos trechos de HTML; o resto é assets/vidro.css.
const SKIN = document.documentElement.dataset.skin || '';
const VIDRO = SKIN === 'vidro';
// data-next no index.html: movimento, gestos, app instalável, atalhos e leitor de QR (assets/next.js).
// Tudo isso mora em next.js e só é carregado nessa página.
const NEXT = 'next' in document.documentElement.dataset;
const nextMod = NEXT ? import('./next.js?v=202611251905') : null;
if (VIDRO) Object.assign(ICON, {
  send: svg('<path d="M12 18.5V6M6.5 11.5L12 6l5.5 5.5"/>'),
  clip: svg('<path d="M12 5.5v13M5.5 12h13"/>'),
  share: svg('<path d="M12 3.8v10.7M8.2 7.3L12 3.8l3.8 3.5"/><path d="M8.8 10.2H7.4A1.9 1.9 0 0 0 5.5 12.1v6a1.9 1.9 0 0 0 1.9 1.9h9.2a1.9 1.9 0 0 0 1.9-1.9v-6a1.9 1.9 0 0 0-1.9-1.9h-1.4"/>'),
  back: svg('<path d="M14.5 5.5L8 12l6.5 6.5"/>'),
  gear: svg('<circle cx="6" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none"/>'),
  bubble: svg('<path d="M12 4.5c4.7 0 8.5 3.1 8.5 7s-3.8 7-8.5 7c-1 0-1.9-.1-2.8-.4L5 20l1.2-3.6C4.5 15.1 3.5 13.4 3.5 11.5c0-3.9 3.8-7 8.5-7z"/>'),
  devices: svg('<rect x="2.5" y="5" width="13.5" height="9.5" rx="1.6"/><path d="M1.5 18h11"/><rect x="17" y="8" width="5.5" height="11" rx="1.4"/>'),
  tray: svg('<path d="M3.8 13.5l2.3-6.9A1.6 1.6 0 0 1 7.6 5.5h8.8a1.6 1.6 0 0 1 1.5 1.1l2.3 6.9v4.4a1.6 1.6 0 0 1-1.6 1.6H5.4a1.6 1.6 0 0 1-1.6-1.6z"/><path d="M3.8 13.5h4.5l1.2 2.2h5l1.2-2.2h4.5"/>'),
  bolt: svg('<path d="M13.2 2.8L5.6 13.4h6L10.8 21.2l7.6-10.6h-6z" fill="currentColor" stroke="none"/>'),
  relay: svg('<path d="M4 8.5h13.5M14 5l3.5 3.5L14 12M20 15.5H6.5M10 12l-3.5 3.5L10 19"/>'),
  history: svg('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 8.9"/><path d="M4.5 4.5v4.4h4.4M12 8v4.2l2.8 1.8"/>')
});
// Ícone de app: quadrado de cantos contínuos, azul, com os dois aparelhos ligados em vidro.
const APPICON = `<svg class="appicon" viewBox="0 0 64 64" aria-hidden="true"><defs>
  <linearGradient id="ai-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5BC4FF"/><stop offset="1" stop-color="#0A6CFF"/></linearGradient>
  <linearGradient id="ai-hi" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
  <rect width="64" height="64" rx="14.5" fill="url(#ai-bg)"/><rect x=".6" y=".6" width="62.8" height="62.8" rx="14" fill="none" stroke="url(#ai-hi)" stroke-width="1.2"/>
  <path d="M26 32h12" stroke="#fff" stroke-opacity=".9" stroke-width="3" stroke-linecap="round" stroke-dasharray=".1 5.2"/>
  <circle cx="20" cy="32" r="9.5" fill="#fff"/><circle cx="44.5" cy="32" r="7.6" fill="#fff" fill-opacity=".28" stroke="#fff" stroke-width="3.2"/>
  <ellipse cx="17.6" cy="28.4" rx="4.2" ry="2.4" fill="#BFE6FF" fill-opacity=".9"/></svg>`;
const MARK = VIDRO ? APPICON : `<svg class="mark" viewBox="0 0 30 18" aria-hidden="true"><line class="l" x1="9" y1="9" x2="21" y2="9"/><circle class="a" cx="7" cy="9" r="6"/><circle class="b" cx="23.5" cy="9" r="4.8"/></svg>`;
const pathMark = k => VIDRO ? `<span class="sq ${k}">${ICON[{ direct: 'bolt', relay: 'relay', server: 'cloud' }[k]]}</span>` : `<i class="trace ${k}"></i>`;

const PATH_LABEL = p => ({ direct: t('Direto'), relay: t('Relay'), server: t('Nuvem'), reconnecting: t('Reconectando'), connecting: t('Conectando') })[p] || p;
const PATH_TIP = p => ({ direct: t('Conexão direta entre os aparelhos'), relay: t('Passa pelo TURN da Cloudflare'), server: t('Sem conexão direta: arquivos vão pela nuvem'), reconnecting: t('A conexão caiu e está voltando'), connecting: t('Procurando o melhor caminho') })[p] || '';
const pill = p => p ? `<span class="path ${p}" title="${esc(PATH_TIP(p))}"><i class="trace ${p}"></i>${esc(PATH_LABEL(p))}</span>` : '';
const KIND_LABEL = k => ({ mobile: t('Celular'), tablet: t('Tablet'), desktop: t('Computador') })[k] || t('Computador');
const ext = name => { const m = /\.([a-z0-9]{1,5})$/i.exec(name || ''); return m ? m[1].toUpperCase() : 'ARQ'; };

// Avatares: cor fixa por aparelho, iniciais do nome.
const HUES = ['#2e7dd7', '#0c9a8a', '#c2620b', '#7a55e0', '#c23a6a', '#3d8f2f', '#b0861a', '#4a5fd1'];
function colorFor(id) { let h = 0; for (const c of String(id || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return HUES[h % HUES.length]; }
function initials(name) {
  const w = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] || '?') + (w[1]?.[0] || '')).toUpperCase();
}
function avatar(p, { lg = false, path = null } = {}) {
  return `<span class="av${lg ? ' lg' : ''}${p.away ? ' away' : ''}" style="--c:${colorFor(p.deviceId || p.peerId)}" title="${esc(p.name)}">${esc(initials(p.name))}${path ? `<i class="st ${path}"></i>` : ''}</span>`;
}

// ---------- tema ----------
// Automático (segue o sistema), claro ou escuro. Fica salvo neste aparelho.
const THEMES = ['auto', 'light', 'dark'];
const THEME_ICON = th => ICON[{ auto: 'auto', light: 'sun', dark: 'moon' }[th]];
const THEME_LABEL = th => ({ auto: t('Tema: automático'), light: t('Tema: claro'), dark: t('Tema: escuro') })[th];
function getTheme() { const th = load('p2p.theme'); return THEMES.includes(th) ? th : 'auto'; }
function applyTheme(th) {
  if (th === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = th;
  const dark = th === 'dark' || (th === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  const man = document.querySelector('link[rel="manifest"]');
  if (man) man.href = man.href.replace(/manifest(-dark)?\.webmanifest/, dark ? 'manifest-dark.webmanifest' : 'manifest.webmanifest');
  $$('meta[name="theme-color"]').forEach(m => { m.content = VIDRO ? (dark ? '#000000' : '#f2f2f7') : dark ? '#121b2b' : '#ffffff'; m.removeAttribute('media'); });
  $$('[data-theme-set]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.themeSet === th)));
}
function themeButton() {
  const th = getTheme();
  return `<button class="btn quiet icon" type="button" data-theme-toggle aria-label="${esc(THEME_LABEL(th))}" title="${esc(THEME_LABEL(th))}">${THEME_ICON(th)}</button>`;
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-theme-toggle]');
  if (!b) return;
  const next = THEMES[(THEMES.indexOf(getTheme()) + 1) % THEMES.length];
  setTheme(next);
  toast(THEME_LABEL(next));
});
document.addEventListener('click', e => {
  const b = e.target.closest('[data-theme-set]');
  if (!b) return;
  setTheme(b.dataset.themeSet);
});
function setTheme(th) {
  save('p2p.theme', th === 'auto' ? null : th);
  const run = () => { applyTheme(th); $$('[data-theme-toggle]').forEach(x => { x.outerHTML = themeButton(); }); };
  // O tema troca com uma transição suave da página inteira.
  if (smoothSwap()) document.startViewTransition(run); else run();
}
function smoothSwap() {
  return NEXT && typeof document.startViewTransition === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches;
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme(getTheme()));
applyTheme(getTheme());

let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

async function copy(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast(okMsg); } catch { toast(text); }
    ta.remove();
  }
}

function shareUrl(room) { return `${PAGE_URL}?${room}`; }

function qrSVG(text) {
  if (!window.qrcode) return '';
  const q = window.qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
}

function navigate(url) {
  history.pushState(null, '', url);
  if (smoothSwap()) document.startViewTransition(() => route()); else route();
}

document.addEventListener('click', e => {
  const a = e.target.closest('a[data-nav]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  navigate(a.getAttribute('href'));
});

// Funções do app que o next.js usa.
const nextReady = nextMod?.then(m => {
  m.init({ navigate, toast, copy, ICON, esc, shareUrl, setTheme, getTheme, APPICON, avatar, current: () => current });
  return m;
}).catch(e => { console.warn('next.js', e); return null; });

// ---------- rotas ----------
let current = null;
function route() {
  if (current) { current.destroy(); current = null; }
  // Arquivos compartilhados de outro app (app instalado no celular): escolher a sala.
  if (NEXT && /^\?share(=|&|$)/.test(location.search)) { nextReady.then(m => m?.renderShare(app)); return; }
  const room = roomFromLocation();
  if (room) {
    const canonical = `${location.pathname}?${room}`;
    if (location.search !== `?${room}` || location.hash) history.replaceState(null, '', canonical);
    current = new RoomView(room);
    return;
  }
  if (isHistoryRoute()) { renderHistory(); return; }
  renderHome();
}
window.addEventListener('popstate', route);
window.addEventListener('hashchange', route);

// ---------- início ----------
/** Ilustração do início: três aparelhos ligados por três caminhos, com pacotes passando. */
function heroViz() {
  const W = 400, H = 320;
  const nodes = [
    { x: 70, y: 74, k: 'desktop', label: 'notebook' },
    { x: 330, y: 92, k: 'mobile', label: LANG === 'pt' ? 'celular' : 'phone' },
    { x: 200, y: 262, k: 'tablet', label: 'tablet' }
  ];
  const hub = { x: 300, y: 228 };
  const ic = (k, x, y) => `<g class="glyph" transform="translate(${x - 12} ${y - 14})" color="currentColor">${ICON[k].replace('class="i"', 'width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"')}</g>`;
  const node = n => `<g class="node"><rect x="${n.x - 38}" y="${n.y - 34}" width="76" height="68" rx="16"/>${ic(n.k, n.x, n.y - 6)}<text x="${n.x}" y="${n.y + 24}" text-anchor="middle">${n.label}</text></g>`;
  const [a, b, c] = nodes;
  const d1 = `M${a.x + 38} ${a.y} C ${a.x + 120} ${a.y - 10}, ${b.x - 120} ${b.y + 4}, ${b.x - 38} ${b.y}`;
  const d2 = `M${a.x} ${a.y + 34} C ${a.x + 30} ${a.y + 120}, ${c.x - 110} ${c.y}, ${c.x - 38} ${c.y}`;
  const d3a = `M${b.x} ${b.y + 34} C ${b.x} ${b.y + 70}, ${hub.x + 20} ${hub.y - 50}, ${hub.x + 4} ${hub.y - 18}`;
  const d3b = `M${hub.x - 16} ${hub.y + 8} C ${hub.x - 40} ${hub.y + 26}, ${c.x + 70} ${c.y}, ${c.x + 38} ${c.y}`;
  const pkt = (cls, d, dur, begin = '0s') => `<circle class="pkt ${cls}" opacity="0"><set attributeName="opacity" to="1" begin="${begin}"/><animateMotion dur="${dur}" begin="${begin}" repeatCount="indefinite" path="${d}" keyPoints="0;1" keyTimes="0;1" calcMode="linear"/></circle>`;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  return `<div class="viz" aria-hidden="true"><svg viewBox="0 0 ${W} ${H}">
    <path class="link direct" d="${d1}"/><path class="link relay" d="${d2}"/><path class="link server" d="${d3a}"/><path class="link server" d="${d3b}"/>
    <g class="hub"><circle cx="${hub.x}" cy="${hub.y}" r="20"/><g transform="translate(${hub.x - 11} ${hub.y - 11})" color="currentColor" style="color:var(--server)">${ICON.cloud.replace('class="i"', 'width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"')}</g></g>
    ${still ? '' : pkt('direct', d1, '2.4s') + pkt('direct', d1, '2.4s', '1.2s') + pkt('relay', d2, '3.6s', '.4s') + pkt('server', d3a, '2.2s', '.2s') + pkt('server', d3b, '2.2s', '1.3s')}
    ${nodes.map(node).join('')}
  </svg></div>`;
}

async function renderHome() {
  document.title = APP;
  app.innerHTML = `<section class="view">
    <div class="home gutter">
      <div class="topline">
        <a class="wordmark" href="./" data-nav>${MARK}${esc(APP)}</a>
        <div style="display:flex;gap:4px">${themeButton()}<a class="btn quiet" href="#historico">${ICON.history}${esc(t('Histórico'))}</a></div>
      </div>
      <div class="hero">
        <div>
          ${VIDRO ? `<div class="hero-icon">${APPICON}</div>` : ''}
          <h1>${esc(t('Abra uma sala.'))}</h1>
          <p class="lede">${esc(t('Quem abrir o mesmo endereço entra na mesma sala. Mande mensagens e arquivos entre seus aparelhos, direto de um para o outro sempre que a rede deixar.'))}</p>
          <form id="home-form" autocomplete="off">
            <div class="urlfield">
              <label for="room-input">${esc(SITE)}?</label>
              <input id="room-input" name="room" placeholder="${esc(t('sala'))}01" spellcheck="false" autocapitalize="off" autocorrect="off" maxlength="60" enterkeyhint="go">
              <button class="btn accent big" type="submit">${esc(t('Entrar'))}</button>
            </div>
            <div class="under">
              <button class="btn line sm" type="button" id="random-room">${esc(t('Gerar nome aleatório'))}</button>
              <span>${esc(t('Sem cadastro. Letras, números, - e _.'))}</span>
            </div>
          </form>
        </div>
        ${VIDRO ? '' : heroViz()}
      </div>
      <div class="paths">
        <div><h3 class="direct">${pathMark('direct')}<span style="color:var(--ink)">${esc(t('Direto'))}</span></h3><p>${esc(t('Os arquivos vão de um aparelho para o outro, sem passar por servidor. É o caminho mais rápido.'))}</p></div>
        <div><h3 class="relay">${pathMark('relay')}<span style="color:var(--ink)">${esc(t('Relay'))}</span></h3><p>${esc(t('Quando a rede bloqueia a conexão direta, a Cloudflare repassa os dados sem guardar nada.'))}</p></div>
        <div><h3 class="server">${pathMark('server')}<span style="color:var(--ink)">${esc(t('Nuvem'))}</span></h3><p>${esc(t('Sem nenhum dos dois, o arquivo fica guardado na sala por 48 h para quem baixar depois.'))}</p></div>
      </div>
      <div class="recents">
        <h2 class="sec-title">${esc(t('Salas recentes neste aparelho'))}</h2>
        <ul id="recents"></ul>
      </div>
    </div>
  </section>`;
  const input = $('#room-input');
  $('#home-form').addEventListener('submit', e => {
    e.preventDefault();
    const r = normalizeRoom(input.value);
    if (!r) { input.focus(); return; }
    navigate(`?${r}`);
  });
  $('#random-room').addEventListener('click', () => { input.value = randomRoomName(); input.focus(); });
  if (matchMedia('(pointer: fine)').matches) input.focus({ preventScroll: true });
  const list = $('#recents');
  const rooms = await hist.recentRooms();
  if (!list.isConnected) return;
  list.innerHTML = rooms.length ? rooms.slice(0, 12).map(r => `
    <li><a href="?${esc(r.room)}" data-nav>
      <span class="rname"><span>?</span>${esc(r.room)}</span>
      <span class="rfoot"><span class="tnum">${esc(new Date(r.lastVisit).toLocaleDateString(LANG === 'pt' ? 'pt-BR' : 'en-US', { day: 'numeric', month: 'short' }))} · ${esc(r.visits === 1 ? t('1 visita') : t('{n} visitas', { n: r.visits }))}</span>
      <span class="rdev">${[...new Set(r.kinds || [])].slice(0, 4).map(k => ICON[k] || '').join('')}</span></span>
    </a></li>`).join('') : `<li class="empty">${esc(t('Nenhuma sala ainda. As salas que você abrir aparecem aqui.'))}</li>`;
  nextReady?.then(m => m?.onHome());
}

// ---------- histórico ----------
async function renderHistory() {
  document.title = `${t('Histórico')} · ${APP}`;
  app.innerHTML = `<section class="view"><div class="history gutter">
    <div class="topline"><a class="wordmark" href="./" data-nav>${MARK}${esc(APP)}</a>${themeButton()}</div>
    <div>
      <h1>${esc(t('Histórico'))}</h1>
      <p class="lede">${esc(t('Fica só neste navegador. Guarda quem conectou, por qual caminho e o que foi transferido, nunca o conteúdo.'))}</p>
    </div>
    <div class="filters">
      <select id="h-room" aria-label="${esc(t('Todas as salas'))}"><option value="">${esc(t('Todas as salas'))}</option></select>
      <input id="h-search" type="search" placeholder="${esc(t('Buscar arquivo ou aparelho'))}" aria-label="${esc(t('Buscar arquivo ou aparelho'))}">
      <button class="btn line" type="button" id="h-clear">${esc(t('Limpar histórico'))}</button>
    </div>
    <div id="history-list" style="display:grid;gap:28px"></div>
  </div>
  <dialog id="h-confirm"><h3>${esc(t('Limpar todo o histórico deste aparelho?'))}</h3>
    <form method="dialog" class="dlg-acts" style="margin-top:18px"><button class="btn line" value="no">${esc(t('Cancelar'))}</button><button class="btn danger" value="yes">${esc(t('Limpar'))}</button></form>
  </dialog></section>`;
  const events = (await hist.allEvents()).filter(e => !['join', 'leave', 'path'].includes(e.type) || e.self);
  const rooms = [...new Set(events.map(e => e.room).filter(Boolean))].sort();
  $('#h-room').insertAdjacentHTML('beforeend', rooms.map(r => `<option value="${esc(r)}">?${esc(r)}</option>`).join(''));
  const draw = () => {
    const room = $('#h-room').value;
    const q = $('#h-search').value.trim().toLowerCase();
    const list = events.filter(e => (!room || e.room === room) && (!q || JSON.stringify(e).toLowerCase().includes(q)));
    if (!list.length) { $('#history-list').innerHTML = `<p class="hist-empty">${esc(t('Nada no histórico ainda.'))}</p>`; return; }
    const days = new Map();
    for (const e of list) {
      const k = new Date(e.ts).toDateString();
      if (!days.has(k)) days.set(k, []);
      days.get(k).push(e);
    }
    $('#history-list').innerHTML = [...days.values()].map(items => `<section class="day"><h2>${esc(dayLabel(items[0].ts))}</h2>
      ${items.map(e => { const v = describeEvent(e); return `<div class="ev"><time>${esc(time(e.ts))}</time><span class="evi">${ICON[v.icon] || ''}</span>
        <div style="min-width:0"><a class="room-tag" href="?${esc(e.room)}" data-nav>?${esc(e.room)}</a>${esc(v.text)}${e.size != null ? ` <span class="sz tnum">${esc(bytes(e.size))}</span>` : ''}</div>${pill(e.path)}</div>`; }).join('')}
    </section>`).join('');
  };
  $('#h-room').addEventListener('change', draw);
  $('#h-search').addEventListener('input', draw);
  $('#h-clear').addEventListener('click', () => $('#h-confirm').showModal());
  $('#h-confirm').addEventListener('close', async () => {
    if ($('#h-confirm').returnValue === 'yes') { await hist.clearAll(); renderHistory(); }
  });
  draw();
}

function describeEvent(e) {
  switch (e.type) {
    case 'visit': return { icon: 'join', text: t('Você entrou na sala') };
    case 'join': return { icon: 'join', text: t('{name} entrou ({kind})', { name: e.name, kind: KIND_LABEL(e.kind).toLowerCase() }) };
    case 'leave': return { icon: 'leave', text: e.self ? t('Você saiu da sala') : t('{name} saiu', { name: e.name }) };
    case 'path': return { icon: 'swap', text: t('{name} agora está em {path}', { name: e.name, path: PATH_LABEL(e.path) }) };
    case 'sent': return { icon: 'up', text: `${t('Enviado {name} para {to}', { name: e.file, to: e.to })}${e.ms ? `, ${duration(e.ms)}` : ''}` };
    case 'received': return { icon: 'down', text: `${t('Recebido {name} de {from}', { name: e.file, from: e.from })}${e.ms ? `, ${duration(e.ms)}` : ''}` };
    case 'stored': return { icon: 'cloud', text: t('Guardado na sala: {name}', { name: e.file }) };
    case 'cancelled': return { icon: 'x', text: t('Envio cancelado: {name}', { name: e.file }) };
    case 'failed': return { icon: 'x', text: t('Envio falhou: {name}', { name: e.file }) };
    default: return { icon: 'swap', text: e.type };
  }
}

// ---------- sala ----------
// Quanto tempo sem servidor antes de mostrar algo: um aviso discreto e, depois, a faixa com "Tentar agora".
const NET_HINT_MS = 2500;
const NET_BANNER_MS = 20000;
const GROUP_MS = 5 * 60 * 1000;

class RoomView {
  constructor(room) {
    this.room = room;
    this.me = getMe();
    this.peers = new Map();
    this.files = new Map();
    this.uploads = new Map();        // id local → CloudUpload guardando na sala
    this.cards = new Map();          // id → { el, model }  (cartões de um arquivo só)
    this.models = new Map();         // id → modelo atual (envio, recebimento ou nuvem)
    this.albums = new Map();         // lote → { el, ids, items, ... }  (vários arquivos num cartão)
    this.albumOf = new Map();        // id → lote
    this.dirtyAlbums = new Set();
    this.urls = new WeakMap();       // arquivo local → blob: URL
    this.msgIds = new Set();
    this.delivered = new Set();
    this.dirty = new Set();
    this.unread = 0;
    // Cofre (vault.js): o que passou pela conversa continua aqui depois de recarregar.
    this.stored = new Map();         // fid → cartão guardado (de antes de recarregar, ou que outro aparelho mostrou)
    this.liveFids = new Map();       // fid → envio/recebimento desta sessão (o cartão ao vivo é o que vale)
    this.posts = new Map();          // id → cartão (como no cofre)
    this.localFiles = new Map();     // fid → File enviado nesta sessão (enquanto a cópia no cofre não termina)
    this.localHave = new Map();      // fid → { intact } arquivos que estão neste aparelho
    this.peerHas = new Map();        // fid → Set(peerId) quem na sala tem o arquivo
    this.forgot = new Set();         // ids esquecidos neste aparelho
    this.welcomed = false;
    this.downSince = 0;
    this.tab = 'feed';
    this.target = 'all';
    this.timers = [];
    this.cleanups = [];
    this.limits = { maxRoomBytes: 5 * 1024 ** 3, fileTtlMs: 48 * 3600 * 1000, maxPeers: 8 };

    this.client = new RoomClient({ room, me: this.me });
    this.mesh = new Mesh(this.client, this.me);
    this.codec = new Codec();
    this.transfers = new Transfers(this.mesh, this.codec);
    const pw = load(PW_KEY(room)) || load(PW_KEY(room), 'session');
    if (pw) this.client.password = pw;

    this.render();
    this.vaultReady = this.restore();
    this.viewer = new Viewer({ resolve: id => this.viewItem(id), esc, icons: ICON, t, fancy: NEXT });
    this.wire();
    if (['localhost', '127.0.0.1'].includes(location.hostname)) window.__p2p = this;
    hist.visitRoom(room, [this.me.kind]);
    hist.logEvent({ type: 'visit', room });
    Promise.race([this.codec.capsP, new Promise(r => setTimeout(() => r([]), 1500))]).then(codecs => {
      this.mesh.localCaps = { codecs };
      if (!this.destroyed) this.client.connect();
    });
    this.loadUsage();
    this.timers.push(setInterval(() => this.loadUsage(), 60000));
    this.timers.push(setInterval(() => this.tick(), 1000));
    this.timers.push(setInterval(() => this.live(), 250));
    this.upMeters = new Map();
    this.timers.push(setInterval(() => this.renderShelf(), 60000));
    this.timers.push(setInterval(() => vault.seen(this.room), 10 * 60000));
    nextReady?.then(m => { if (!this.destroyed) m?.onRoom(this); });
  }

  // ----- montagem -----
  render() {
    document.title = `?${this.room} · ${APP}`;
    app.innerHTML = `<section class="view view-room"><div class="room">
      <header class="room-head gutter">
        <a class="home-link" href="./" data-nav aria-label="${esc(t('Início'))}" title="${esc(t('Início'))}">${ICON.back}${MARK}</a>
        <button class="addr" type="button" id="addr" title="${esc(t('Copiar link da sala'))}"><span class="addr-q">?</span><span class="addr-room">${esc(this.room)}</span><span class="lock" hidden title="${esc(t('Com senha. Quem entrar precisa digitar a senha.'))}">${ICON.lock}</span></button>
        <span class="net wait" id="net" hidden><span class="lbl">${esc(t('Conectando'))}</span></span>
        <button class="faces" type="button" id="faces" aria-label="${esc(t('Aparelhos'))}"></button>
        <div class="head-actions">
          <button class="usage-chip" type="button" id="usage-chip" hidden></button>
          <button class="btn line" type="button" id="show-qr">${ICON.share}<span class="lbl">${esc(t('Convidar'))}</span></button>
          ${themeButton()}
          <button class="btn quiet icon" type="button" id="settings" aria-label="${esc(t('Configurações da sala'))}" title="${esc(t('Configurações da sala'))}">${ICON.gear}</button>
          <button class="me-chip" type="button" id="me-chip" title="${esc(t('Mudar meu nome'))}">${avatar(this.me)}<span class="nm" id="me-name-label">${esc(this.me.name)}</span></button>
        </div>
      </header>
      <div class="conn-banner gutter" id="conn-banner" hidden></div>
      <div class="room-tabs gutter" role="tablist">
        <button role="tab" data-tab="feed">${VIDRO ? ICON.bubble : ''}<span class="tl">${esc(t('Conversa'))}</span><span class="dot" id="feed-dot" hidden></span></button>
        <button role="tab" data-tab="devices">${VIDRO ? ICON.devices : ''}<span class="tl">${esc(t('Aparelhos'))}</span><span class="count tnum" id="dev-count">1</span></button>
        <button role="tab" data-tab="files">${VIDRO ? ICON.tray : ''}<span class="tl">${esc(t('Guardados'))}</span><span class="count tnum" id="file-count">0</span></button>
      </div>
      <div class="room-body">
        <aside class="pane pane-devices" data-pane="devices"><div class="pane-inner gutter" id="devices-pane"></div></aside>
        <section class="pane pane-feed" data-pane="feed">
          <div class="feed gutter" id="feed"><div class="feed-empty loading" id="feed-empty"><p>${esc(t('Entrando na sala'))}</p></div></div>
          <form class="composer gutter" id="composer">
            <div class="composer-in">
              <textarea id="msg" rows="1" placeholder="${esc(t('Escreva uma mensagem'))}" aria-label="${esc(t('Mensagem para a sala'))}" enterkeyhint="send"></textarea>
              <div class="row">
                <button class="btn quiet icon sm" type="button" id="attach" aria-label="${esc(t('Anexar arquivo'))}" title="${esc(t('Anexar arquivo'))}">${ICON.clip}</button>
                <input type="file" id="file-input" multiple hidden>
                <label class="target"><span class="sr">${esc(t('Enviar para'))}</span><select id="target"></select></label>
                <span class="hint">${esc(t('Arraste arquivos ou cole com Ctrl+V'))}</span>
                <button class="btn solid send" type="submit" aria-label="${esc(t('Enviar'))}" title="${esc(t('Enviar'))}">${ICON.send}</button>
              </div>
            </div>
          </form>
        </section>
        <aside class="pane pane-files" data-pane="files"><div class="pane-inner gutter">
          <h2 class="sec-title">${esc(t('Guardados na sala'))}<span id="shelf-count"></span></h2>
          <p class="pane-sub">${esc(t('Qualquer um na sala baixa, inclusive quem entrar depois.'))}</p>
          <div class="drop" id="shelf-drop">${ICON.cloud}<span>${esc(t('Solte aqui para guardar na sala'))}</span><button class="btn line sm" type="button" id="shelf-pick">${esc(t('Escolher arquivo'))}</button><input type="file" id="shelf-input" multiple hidden></div>
          <ul class="shelf" id="shelf"></ul>
          <div class="quota" id="shelf-usage"></div>
        </div></aside>
        <div class="gate" id="gate" hidden></div>
      </div>
    </div></section>
    <dialog id="qr-dialog" class="qr-dlg">
      <div class="dlg-head"><div><h3>${esc(t('Convidar para a sala'))}</h3><p>${esc(t('Quem abrir este endereço entra na sala. No celular, aponte a câmera para o código.'))}</p></div><form method="dialog"><button class="btn quiet icon sm" aria-label="${esc(t('Fechar'))}">${ICON.x}</button></form></div>
      <div class="qrbox big" id="qr-box"></div>
      <div class="qr-url">${esc(shareUrl(this.room))}</div>
      <div class="qr-acts">
        <button class="btn solid" type="button" id="copy-link">${ICON.copy}${esc(t('Copiar link'))}</button>
        <button class="btn line" type="button" id="native-share" hidden>${ICON.share}${esc(t('Compartilhar'))}</button>
      </div>
    </dialog>
    <dialog id="name-dialog">
      <h3>${esc(t('Seu nome na sala'))}</h3><p>${esc(t('É como os outros aparelhos veem você.'))}</p>
      <form id="name-form" class="field" autocomplete="off"><label class="sr" for="me-name">${esc(t('Nome'))}</label>
        <div class="field-row"><input id="me-name" maxlength="24" value="${esc(this.me.name)}"><button class="btn solid" type="submit">${esc(t('Salvar'))}</button></div></form>
    </dialog>
    <dialog id="usage-dialog"><div class="dlg-head"><h3>${esc(t('Uso da nuvem'))}</h3><form method="dialog"><button class="btn quiet icon sm" aria-label="${esc(t('Fechar'))}">${ICON.x}</button></form></div><div class="meters" id="meters"></div><p id="usage-note" style="margin:14px 0 0"></p></dialog>
    <dialog id="settings-dialog"><div class="dlg-head"><h3>${esc(t('Configurações da sala'))}</h3><form method="dialog"><button class="btn quiet icon sm" aria-label="${esc(t('Fechar'))}">${ICON.x}</button></form></div>
      <section><h4>${esc(t('Aparência'))}</h4><div class="seg" role="radiogroup" aria-label="${esc(t('Aparência'))}" id="theme-seg">${THEMES.map(th => `<button type="button" role="radio" data-theme-set="${th}">${THEME_ICON(th)}${esc({ auto: t('Automático'), light: t('Claro'), dark: t('Escuro') }[th])}</button>`).join('')}</div></section>
      <section><h4>${esc(t('Senha da sala'))}</h4><p id="pw-status"></p>
        <form id="pw-form" class="field" autocomplete="off"><label class="sr" for="pw-new">${esc(t('Nova senha'))}</label>
          <input id="pw-new" type="password" placeholder="${esc(t('Nova senha'))}" maxlength="128" autocomplete="new-password">
          <div class="dlg-acts"><button class="btn line" type="button" id="pw-remove" hidden>${esc(t('Remover senha'))}</button><button class="btn solid" type="submit" id="pw-save">${esc(t('Definir senha'))}</button></div></form></section>
      <section><h4>${esc(t('Apagar tudo'))}</h4><p>${esc(t('Apaga todas as mensagens e arquivos guardados desta sala. Não dá para desfazer.'))}</p>
        <form id="wipe-form" class="field" autocomplete="off"><label class="sr" for="admin-pw">${esc(t('Senha de admin'))}</label>
          <input id="admin-pw" type="password" placeholder="${esc(t('Senha de admin'))}" maxlength="128" autocomplete="off">
          <p class="err" id="wipe-err" hidden></p>
          <div class="dlg-acts"><button class="btn danger" type="submit">${esc(t('Apagar mensagens e arquivos'))}</button></div></form></section>
    </dialog>`;
    this.selectTab('feed');
    this.renderPeers();
    this.renderShelf();
    this.renderTargets();
  }

  selectTab(tab) {
    this.tab = tab;
    $$('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    $$('[data-pane]').forEach(p => p.classList.toggle('on', p.dataset.pane === tab));
    if (tab === 'feed') { $('#feed-dot').hidden = true; this.scrollFeed(true); }
  }

  tabsVisible() { const el = $('.room-tabs'); return !!el && getComputedStyle(el).display !== 'none'; }

  on(target, type, fn) {
    target.addEventListener(type, fn);
    this.cleanups.push(() => target.removeEventListener(type, fn));
  }

  // ----- eventos -----
  wire() {
    const c = this.client, m = this.mesh, tr = this.transfers;
    $$('[data-tab]').forEach(b => b.addEventListener('click', () => this.selectTab(b.dataset.tab)));
    $('#addr').addEventListener('click', () => copy(shareUrl(this.room), t('Link copiado')));
    $('#copy-link').addEventListener('click', () => copy(shareUrl(this.room), t('Link copiado')));
    $('#show-qr').addEventListener('click', () => this.showQR());
    $('#faces').addEventListener('click', () => { if (this.tabsVisible()) this.selectTab('devices'); });
    if (navigator.share) {
      const ns = $('#native-share');
      ns.hidden = false;
      ns.addEventListener('click', () => navigator.share({ title: `?${this.room}`, url: shareUrl(this.room) }).catch(() => {}));
    }
    $('#usage-chip').addEventListener('click', () => { this.renderMeters(); $('#usage-dialog').showModal(); });
    $('#settings').addEventListener('click', () => this.openSettings());
    $('#me-chip').addEventListener('click', () => { const d = $('#name-dialog'); $('#me-name').value = this.me.name; d.showModal(); $('#me-name').select(); });
    $('#name-form').addEventListener('submit', e => {
      e.preventDefault();
      const n = $('#me-name').value.trim().slice(0, 24);
      $('#name-dialog').close();
      if (!n || n === this.me.name) return;
      this.me.name = n;
      setMyName(n);
      c.send({ t: 'rename', name: n }, { queue: true });
      $('#me-name-label').textContent = n;
      $('#me-chip .av').outerHTML = avatar(this.me);
      this.renderPeers();
      toast(t('Agora você é {name}', { name: n }));
    });
    // Fecha diálogos ao clicar fora.
    $$('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));

    const msg = $('#msg');
    msg.addEventListener('input', () => { msg.style.height = 'auto'; msg.style.height = `${Math.min(180, msg.scrollHeight)}px`; });
    msg.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer: fine)').matches) { e.preventDefault(); $('#composer').requestSubmit(); }
    });
    $('#composer').addEventListener('submit', e => {
      e.preventDefault();
      const text = msg.value.trim();
      if (!text) { msg.focus(); return; }
      this.sendChat(text);
      msg.value = '';
      msg.style.height = '';
      msg.focus();
    });
    $('#attach').addEventListener('click', () => $('#file-input').click());
    $('#file-input').addEventListener('change', e => { this.sendFiles([...e.target.files]); e.target.value = ''; });
    $('#target').addEventListener('change', e => { this.target = e.target.value; });
    $('#shelf-pick').addEventListener('click', () => $('#shelf-input').click());
    $('#shelf-input').addEventListener('change', e => { for (const f of e.target.files) this.storeInRoom(f); e.target.value = ''; });

    // Arrastar e soltar / colar
    let depth = 0, overlay = null;
    const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
    this.on(window, 'dragenter', e => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth++;
      if (!overlay) {
        overlay = document.createElement('div'); overlay.className = 'drag-overlay';
        const n = this.peers.size;
        overlay.innerHTML = `<div><b>${esc(t('Solte para enviar'))}</b><span>${esc(n ? (NEXT ? t('Solte sobre um aparelho para mandar só para ele.') : t('Vai para quem estiver selecionado no campo de envio.')) : t('Ninguém mais na sala: fica guardado por 48 h.'))}</span></div>`;
        document.body.appendChild(overlay);
      }
    });
    this.on(window, 'dragover', e => { if (hasFiles(e)) e.preventDefault(); const d = $('#shelf-drop'); d?.classList.toggle('hot', !!e.target.closest?.('#shelf-drop')); });
    this.on(window, 'dragleave', () => { if (--depth <= 0) { depth = 0; overlay?.remove(); overlay = null; $('#shelf-drop')?.classList.remove('hot'); } });
    this.on(window, 'drop', e => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; overlay?.remove(); overlay = null;
      const files = [...e.dataTransfer.files];
      const toShelf = !!e.target.closest?.('#shelf-drop');
      $('#shelf-drop')?.classList.remove('hot');
      // Soltar sobre um aparelho da lista manda só para ele.
      const row = NEXT ? e.target.closest?.('.device[data-peer]:not([data-self])') : null;
      if (row && this.peers.has(row.dataset.peer)) {
        const prev = this.target;
        this.target = row.dataset.peer;
        this.sendFiles(files);
        this.target = prev;
        toast(t('Mandando só para {name}', { name: this.peers.get(row.dataset.peer).name }));
      } else if (toShelf) files.forEach(f => this.storeInRoom(f)); else this.sendFiles(files);
    });
    this.on(document, 'paste', e => {
      const files = [...(e.clipboardData?.files || [])];
      if (!files.length || e.target.closest?.('dialog, .gate')) return;
      e.preventDefault();
      this.sendFiles(files);
    });
    this.on(window, 'beforeunload', e => {
      const busy = [...this.transfers.out.values(), ...this.transfers.inc.values()].some(x => ['sending', 'receiving', 'waiting', 'interrupted'].includes(x.state))
        || [...this.uploads.values()].some(u => u.state === 'uploading');
      if (busy) { e.preventDefault(); e.returnValue = ''; }
    });
    this.on(document, 'visibilitychange', () => { if (!document.hidden) { this.unread = 0; this.updateTitle(); } });

    // Servidor
    c.addEventListener('state', () => this.renderNet());
    c.addEventListener('auth', e => this.showAuth(e.detail));
    c.addEventListener('welcome', e => this.onWelcome(e.detail));
    // Entradas e saídas não viram mensagem na conversa: aparecem só na lista de aparelhos.
    // O servidor já espera 30 s antes de anunciar uma saída, então quedas rápidas nem aparecem.
    c.addEventListener('peer-join', e => {
      const p = e.detail.peer;
      const known = this.peers.has(p.peerId);
      this.peers.set(p.peerId, p);
      if (!known) hist.logEvent({ type: 'join', room: this.room, name: p.name, kind: p.kind });
      this.peersChanged();
      hist.updateRoomKinds(this.room, [this.me.kind, ...[...this.peers.values()].map(x => x.kind)]);
    });
    c.addEventListener('peer-leave', e => {
      const p = this.peers.get(e.detail.peerId);
      if (!p) return;
      this.peers.delete(p.peerId);
      this.peerGone(p.peerId);
      hist.logEvent({ type: 'leave', room: this.room, name: p.name, kind: p.kind });
      this.peersChanged();
    });
    c.addEventListener('peer-update', e => {
      const p = e.detail.peer;
      if (this.peers.has(p.peerId)) { this.peers.set(p.peerId, p); this.peersChanged(); }
    });
    c.addEventListener('chat', e => this.onChat(e.detail.msg));
    c.addEventListener('chat-ack', e => this.markSent(e.detail.id));
    c.addEventListener('file-added', e => { this.files.set(e.detail.file.id, e.detail.file); this.renderShelf(); this.maybeDelivered(e.detail.file, true); });
    c.addEventListener('file-updated', e => { if (this.files.has(e.detail.file.id)) { this.files.set(e.detail.file.id, e.detail.file); this.renderShelf(); } });
    c.addEventListener('file-removed', e => { this.files.delete(e.detail.fileId); this.renderShelf(); });
    c.addEventListener('room-update', e => {
      this.setProtected(e.detail.protected);
      this.sys(e.detail.protected ? t('Senha definida por {name}', { name: e.detail.by }) : t('Senha removida por {name}', { name: e.detail.by }));
      this.renderSettings();
    });
    c.addEventListener('wiped', e => {
      $$('#feed .msg, #feed .sys').forEach(el => el.remove());
      this.wipeLocal();
      this.files.clear();
      this.renderShelf();
      this.sys(t('{name} apagou tudo nesta sala', { name: e.detail.by }));
      const d = $('#settings-dialog');
      if (d?.open) { d.close(); }
    });
    c.addEventListener('error', e => {
      const code = e.detail.code;
      if (code === 'admin-wrong') { const er = $('#wipe-err'); er.textContent = t('Senha de admin errada.'); er.hidden = false; }
    });
    c.addEventListener('peer', e => this.onAppSignal(e.detail.from, e.detail.data));

    // Conexões diretas
    m.addEventListener('path', e => this.onPath(e.detail));
    m.addEventListener('open', () => this.renderNet());
    m.addEventListener('data', e => { if (e.detail.msg.x === 'chat' && e.detail.msg.msg) this.onChat(e.detail.msg.msg); else this.onVaultMsg(e.detail.peerId, e.detail.msg); });
    m.addEventListener('open', e => this.syncTo(e.detail.peerId));
    m.addEventListener('gone', e => this.peerGone(e.detail.peerId));

    // Transferências
    tr.addEventListener('update', e => this.markDirty(e.detail));
    tr.addEventListener('need-cloud', e => this.moveToCloud(e.detail));
  }

  peersChanged() {
    this.renderPeers();
    this.renderTargets();
    this.updateEmpty();
  }

  // ----- servidor -----
  onWelcome(w) {
    $('#gate').hidden = true;
    if (w.limits) this.limits = { ...this.limits, ...w.limits };
    this.setProtected(w.protected);
    if (!this.welcomed) for (const p of w.peers) hist.logEvent({ type: 'join', room: this.room, name: p.name, kind: p.kind });
    this.peers = new Map(w.peers.map(p => [p.peerId, p]));
    this.welcomed = true;
    this.files = new Map(w.files.map(f => [f.id, f]));
    for (const msg of w.messages) this.onChat(msg, true);
    this.vaultReady.then(() => { if (!this.destroyed) for (const f of w.files) this.maybeDelivered(f); });
    if (this.client.password && this.client.protected) this.rememberPassword(this.client.password, null);
    this.renderPeers(); this.renderTargets(); this.renderShelf(); this.renderNet();
    this.updateEmpty();
    hist.updateRoomKinds(this.room, [this.me.kind, ...w.peers.map(p => p.kind)]);
    this.scrollFeed(true);
  }

  setProtected(p) {
    this.protected = !!p;
    const l = $('.lock');
    if (l) l.hidden = !p;
  }

  /** Estado da ligação com o servidor: nada quando está tudo bem, um aviso discreto numa queda curta, faixa numa queda longa. */
  renderNet() {
    const net = $('#net'), b = $('#conn-banner');
    if (!net || !b) return;
    const s = this.client.state;
    const down = s === 'reconnecting' || (s === 'connecting' && this.welcomed);
    if (down && !this.downSince) this.downSince = Date.now();
    if (!down) this.downSince = 0;
    const away = this.downSince ? Date.now() - this.downSince : 0;
    if (!this.welcomed && s !== 'open') {
      net.hidden = false; net.className = 'net wait'; net.querySelector('.lbl').textContent = t('Conectando');
    } else if (down && away >= NET_HINT_MS) {
      net.hidden = false; net.className = 'net wait'; net.querySelector('.lbl').textContent = t('Reconectando');
      net.title = t('Sem conexão com o servidor. Tentando de novo em {s} s.', { s: Math.max(0, Math.ceil((this.client.retryAt - Date.now()) / 1000)) });
    } else {
      net.hidden = !this.welcomed; net.className = 'net ok'; net.title = t('Conectado');
    }
    if (down && away >= NET_BANNER_MS) {
      const anyDirect = [...this.peers.keys()].some(id => this.mesh.isOpen(id));
      const secs = Math.max(0, Math.ceil((this.client.retryAt - Date.now()) / 1000));
      b.innerHTML = `<span>${esc(anyDirect ? t('Sem conexão com o servidor. Mensagens vão direto para quem estiver conectado.') : t('Sem conexão com o servidor. Tentando de novo em {s} s.', { s: secs }))}</span><button class="btn line sm" type="button" id="retry-now">${esc(t('Tentar agora'))}</button>`;
      $('#retry-now').addEventListener('click', () => this.client.nudge());
      b.hidden = false;
    } else {
      b.hidden = true;
    }
    if (s === 'full') this.showGate('full');
    if (s === 'locked') this.showAuth({ reason: 'locked' });
  }
  renderBanner() { this.renderNet(); }

  showGate(kind) {
    const g = $('#gate');
    if (kind === 'full') {
      g.innerHTML = `<div class="gate-card"><span class="gi">${ICON.desktop}</span><h2>${esc(t('Sala cheia'))}</h2><p>${esc(t('Esta sala já tem {n} aparelhos, o máximo permitido. Tente de novo quando alguém sair.', { n: this.limits.maxPeers }))}</p>
        <div class="dlg-acts" style="justify-content:flex-start"><button class="btn solid" type="button" id="gate-retry">${esc(t('Tentar agora'))}</button><a class="btn line" href="./" data-nav>${esc(t('Voltar ao início'))}</a></div></div>`;
      $('#gate-retry').addEventListener('click', () => { this.client.state = 'reconnecting'; this.client.nudge(); g.hidden = true; });
    }
    g.hidden = false;
  }

  showAuth(info) {
    const g = $('#gate');
    const msg = info.reason === 'wrong' ? t('Senha errada. Restam {n} tentativas.', { n: info.left ?? '' })
      : info.reason === 'locked' ? t('Muitas tentativas. Espere um minuto e recarregue a página.') : '';
    g.innerHTML = `<form class="gate-card" id="auth-form" autocomplete="on">
      <span class="gi">${ICON.lock}</span>
      <h2>${esc(t('Esta sala tem senha'))}</h2>
      <p class="mono">?${esc(this.room)}</p>
      <label class="sr" for="auth-pw">${esc(t('Senha'))}</label>
      <input type="password" id="auth-pw" placeholder="${esc(t('Senha'))}" autocomplete="current-password" maxlength="128" ${info.reason === 'locked' ? 'disabled' : ''}>
      <label class="check"><input type="checkbox" id="auth-remember" checked> ${esc(t('Lembrar neste aparelho'))}</label>
      <p class="err" ${msg ? '' : 'hidden'}>${esc(msg)}</p>
      <div class="dlg-acts" style="justify-content:flex-start"><button class="btn solid" type="submit" ${info.reason === 'locked' ? 'disabled' : ''}>${esc(t('Entrar'))}</button><a class="btn line" href="./" data-nav>${esc(t('Voltar ao início'))}</a></div>
    </form>`;
    g.hidden = false;
    const input = $('#auth-pw');
    input?.focus();
    $('#auth-form').addEventListener('submit', e => {
      e.preventDefault();
      const pw = input.value;
      if (!pw) return;
      this.pendingRemember = $('#auth-remember').checked;
      this.client.auth(pw);
      this.rememberPassword(pw, this.pendingRemember);
    });
  }

  rememberPassword(pw, remember) {
    if (remember === null) return;
    save(PW_KEY(this.room), remember ? pw : null);
    save(PW_KEY(this.room), remember ? null : pw, 'session');
  }

  // ----- aparelhos -----
  tabLabels() {
    const all = [{ ...this.me, joined: 0, self: true }, ...this.peers.values()];
    const byDev = new Map();
    for (const p of all) { if (!byDev.has(p.deviceId)) byDev.set(p.deviceId, []); byDev.get(p.deviceId).push(p); }
    const labels = new Map();
    for (const list of byDev.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => (a.self ? -1 : b.self ? 1 : a.joined - b.joined));
      list.forEach((p, i) => labels.set(p.peerId, i + 1));
    }
    return labels;
  }

  peerPath(p) {
    if (p.away) return null;
    const path = this.mesh.path(p.peerId);
    return ['direct', 'relay', 'server'].includes(path) ? path : null;
  }

  renderPeers() {
    const pane = $('#devices-pane');
    if (!pane) return;
    const peers = [...this.peers.values()];
    const tabs = this.tabLabels();
    $('#dev-count').textContent = String(peers.length + 1);
    // Rostos no cabeçalho (celular e telas médias).
    const faces = $('#faces');
    if (faces) {
      faces.hidden = !peers.length;
      faces.innerHTML = peers.slice(0, 4).map(p => avatar(p, { path: this.peerPath(p) })).join('') + (peers.length > 4 ? `<span class="more">+${peers.length - 4}</span>` : '');
      faces.title = peers.map(p => p.name).join(', ');
    }
    const row = (p, self) => {
      const tab = tabs.get(p.peerId);
      const detail = self ? t('Este aparelho') : p.away ? t('Sem sinal agora') : KIND_LABEL(p.kind);
      const right = self ? '<span></span>' : p.away ? `<span class="path connecting"><i class="trace connecting"></i>${esc(t('Ausente'))}</span>` : pill(this.mesh.path(p.peerId));
      return `<li class="device${p.away ? ' away' : ''}" data-peer="${esc(p.peerId)}"${self ? ' data-self' : ''}>${avatar(p, { lg: true })}<div style="min-width:0"><div class="nm">${esc(p.name)}${self ? `<em>${esc(t('você'))}</em>` : ''}${tab && !self ? `<em>${esc(t('aba {n}', { n: tab }))}</em>` : ''}</div><div class="dt">${ICON[p.kind] || ICON.desktop}${esc(detail)}</div></div>${right}</li>`;
    };
    pane.innerHTML = `<h2 class="sec-title">${esc(t('Na sala'))}<span class="tnum">${peers.length + 1} ${esc(peers.length ? t('aparelhos') : t('aparelho'))}</span></h2>
      <div class="map">${this.mapSVG(peers)}</div>
      <div class="legend"><span><i class="trace direct"></i><span class="lbl">${esc(t('Direto'))}</span></span><span><i class="trace relay"></i><span class="lbl">${esc(t('Relay'))}</span></span><span><i class="trace server"></i><span class="lbl">${esc(t('Nuvem'))}</span></span></div>
      <ul class="devices">${row(this.me, true)}${peers.map(p => row(p, false)).join('')}</ul>
      <div class="invite">
        <button class="qr-tile" type="button" id="side-qr" title="${esc(t('Ampliar QR code'))}" aria-label="${esc(t('Ampliar QR code'))}">${this.qr()}<span class="zoom">${ICON.expand}</span></button>
        <div class="inv-text"><b>${esc(peers.length ? t('Chamar mais aparelhos') : t('Só você por aqui'))}</b><span>${esc(t('Aponte a câmera do celular para o código ou abra o mesmo endereço em outro aparelho.'))}</span>
          <div class="acts"><button class="btn line sm" type="button" id="side-qr-big">${ICON.qr}${esc(t('Ampliar'))}</button><button class="btn quiet sm" type="button" id="side-copy">${ICON.copy}${esc(t('Copiar link'))}</button></div></div>
      </div>`;
    $('#side-qr')?.addEventListener('click', () => this.showQR());
    $('#side-qr-big')?.addEventListener('click', () => this.showQR());
    $('#side-copy')?.addEventListener('click', () => copy(shareUrl(this.room), t('Link copiado')));
  }

  mapSVG(peers) {
    const W = 280, H = 180, cx = W / 2, cy = H / 2, n = peers.length;
    const stroke = { direct: 'var(--direct)', relay: 'var(--relay)', server: 'var(--server)', reconnecting: 'var(--relay)', connecting: 'var(--faint)' };
    const dash = { direct: '', relay: '7 5', server: '0.1 5.5', reconnecting: '2 6', connecting: '2 6' };
    const width = { server: 3 };
    const pos = peers.map((p, i) => {
      const a = n === 1 ? 0 : -Math.PI / 2 + (i + 0.5) * (2 * Math.PI / n);
      const path = p.away ? 'connecting' : this.mesh.path(p.peerId);
      return { p, x: cx + Math.cos(a) * 104, y: cy + Math.sin(a) * 60, path };
    });
    const lines = pos.map(({ x, y, path }) => `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${stroke[path] || stroke.connecting}" stroke-width="${width[path] || 2}" stroke-linecap="round" stroke-dasharray="${dash[path] ?? ''}"/>`).join('');
    const node = (p, x, y, r, ring, self) => {
      const c = colorFor(p.deviceId || p.peerId);
      return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})" opacity="${p.away ? 0.5 : 1}"><title>${esc(p.name)}</title>
        <circle r="${r + 4}" fill="var(--raised)"/><circle r="${r}" fill="${self ? c : `color-mix(in srgb, ${c} 20%, var(--surface))`}" stroke="${ring}" stroke-width="1.5"/>
        <text text-anchor="middle" dy="0.35em" font-size="${r * 0.72}" font-weight="700" font-family="var(--font-ui)" fill="${self ? '#fff' : `color-mix(in srgb, ${c} 82%, var(--ink))`}">${esc(initials(p.name))}</text></g>`;
    };
    const nodes = pos.map(({ p, x, y, path }) => node(p, x, y, 15, stroke[path] || stroke.connecting, false)).join('');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('Na sala'))}: ${n + 1}">${lines}${nodes}${node(this.me, cx, cy, 19, 'transparent', true)}</svg>`;
  }

  renderTargets() {
    const sel = $('#target');
    if (!sel) return;
    const peers = [...this.peers.values()];
    const tabs = this.tabLabels();
    if (this.target !== 'all' && !this.peers.has(this.target)) this.target = 'all';
    sel.innerHTML = `<option value="all">${esc(peers.length ? t('Para todos ({n})', { n: peers.length }) : t('Guardar na sala'))}</option>` +
      peers.map(p => `<option value="${esc(p.peerId)}">${esc(t('Só para {name}', { name: p.name + (tabs.get(p.peerId) ? ` (${t('aba {n}', { n: tabs.get(p.peerId) })})` : '') }))}</option>`).join('');
    sel.value = this.target;
  }

  onPath({ peerId, path }) {
    const p = this.peers.get(peerId);
    this.renderPeers();
    this.renderNet();
    if (!p) return;
    // A troca de caminho fica no histórico e na lista de aparelhos, não na conversa.
    if (['direct', 'relay', 'server'].includes(path) && p.loggedPath !== path) {
      p.loggedPath = path;
      hist.logEvent({ type: 'path', room: this.room, name: p.name, path });
    }
    if (path === 'server') {
      for (const tr of this.transfers.out.values()) {
        if (tr.peerId === peerId && ['queued', 'waiting'].includes(tr.state) && !tr.cloudRequested) { tr.cloudRequested = true; this.moveToCloud(tr); }
      }
    }
    for (const tr of [...this.transfers.out.values(), ...this.transfers.inc.values()]) if (tr.peerId === peerId) this.markDirty(tr);
  }

  // ----- conversa -----
  /** Estado vazio da conversa: carregando, sozinho (com QR para convidar) ou pronto. */
  updateEmpty() {
    const feed = $('#feed');
    if (!feed) return;
    const hasContent = !!feed.querySelector('.msg, .xfer, .sys');
    let el = $('#feed-empty');
    if (hasContent) { el?.remove(); return; }
    const state = !this.welcomed ? 'loading' : this.peers.size ? 'ready' : 'alone';
    const sig = `${state}|${[...this.peers.values()].map(p => p.name).join(',')}`;
    if (el && el.dataset.sig === sig) return;
    if (!el) { el = document.createElement('div'); el.id = 'feed-empty'; feed.prepend(el); }
    el.dataset.state = state;
    el.dataset.sig = sig;
    el.className = `feed-empty${state === 'loading' ? ' loading' : ''}`;
    if (state === 'loading') el.innerHTML = `<p>${esc(t('Entrando na sala'))}</p>`;
    else {
      const names = [...this.peers.values()].map(p => p.name);
      const title = state === 'alone' ? t('A sala está pronta') : names.length === 1 ? t('Conectado com {name}', { name: names[0] }) : t('{n} aparelhos conectados', { n: names.length + 1 });
      const text = state === 'alone'
        ? t('Abra o mesmo endereço em outro aparelho, ou aponte a câmera do celular para o código. Arquivos enviados agora ficam guardados por 48 h.')
        : t('Escreva uma mensagem ou arraste arquivos para cá. Para chamar mais aparelhos, use o código.');
      el.innerHTML = `<button class="qrmini" type="button" data-empty="qr" title="${esc(t('Ampliar QR code'))}" aria-label="${esc(t('Ampliar QR code'))}">${this.qr()}</button><h2>${esc(title)}</h2>
        <p>${esc(text)}</p>
        <div class="acts"><button class="btn solid sm" type="button" data-empty="copy">${ICON.copy}${esc(t('Copiar link'))}</button><button class="btn line sm" type="button" data-empty="qr">${ICON.expand}${esc(t('Ampliar código'))}</button></div>`;
      el.querySelector('[data-empty="copy"]').addEventListener('click', () => copy(shareUrl(this.room), t('Link copiado')));
      el.querySelectorAll('[data-empty="qr"]').forEach(b => b.addEventListener('click', () => this.showQR()));
    }
  }

  sys(text) {
    const feed = $('#feed');
    if (!feed) return;
    const d = document.createElement('div');
    d.className = 'sys';
    d.innerHTML = `<span>${esc(text)}</span><time>${esc(time(Date.now()))}</time>`;
    this.append(d);
  }

  append(el) {
    const feed = $('#feed');
    const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 120;
    // Histórico (mensagens do servidor e cartões do cofre) chega fora de ordem: entra no lugar pelo horário.
    const ts = Number(el.dataset.ts) || 0;
    let before = null;
    if (ts) for (const c of feed.children) { if ((Number(c.dataset.ts) || 0) > ts) { before = c; break; } }
    feed.insertBefore(el, before);
    $('#feed-empty')?.remove();
    if (atBottom) this.scrollFeed();
  }

  scrollFeed() {
    const feed = $('#feed');
    if (!feed) return;
    requestAnimationFrame(() => { feed.scrollTop = feed.scrollHeight; });
  }

  sendChat(text) {
    const id = randomId(12);
    const msg = { id, ts: Date.now(), fromPeer: this.me.peerId, fromDevice: this.me.deviceId, fromName: this.me.name, fromKind: this.me.kind, text };
    this.renderMsg(msg, true);
    this.scrollFeed();
    const viaServer = this.client.send({ t: 'chat', id, text }, { queue: true });
    if (!viaServer) {
      for (const p of this.peers.keys()) this.mesh.send(p, JSON.stringify({ x: 'chat', msg }));
    }
  }

  onChat(msg, fromHistory) {
    if (this.forgot.has(msg.id)) return;
    if (this.msgIds.has(msg.id)) { this.markSent(msg.id); return; }
    this.renderMsg(msg, false);
    if (!fromHistory && msg.fromDevice !== this.me.deviceId) this.notify();
  }

  renderMsg(msg, pending) {
    this.msgIds.add(msg.id);
    const mine = msg.fromDevice === this.me.deviceId || msg.fromPeer === this.me.peerId;
    const from = msg.fromPeer || msg.fromDevice;
    const last = $('#feed')?.lastElementChild;
    const cont = last?.classList.contains('msg') && last.dataset.from === from && msg.ts - Number(last.dataset.ts) < GROUP_MS;
    const d = document.createElement('div');
    d.className = `msg${mine ? ' mine' : ''}${pending ? ' pending' : ''}${cont ? ' cont' : ''}`;
    d.dataset.id = msg.id;
    d.dataset.from = from;
    d.dataset.ts = String(msg.ts);
    d.innerHTML = `<div class="who">${mine ? '' : `<b>${esc(msg.fromName)}</b>`}<time>${esc(time(msg.ts))}</time></div>
      <div class="row"><div class="body" title="${esc(time(msg.ts))}">${linkify(msg.text)}</div><button class="copy" type="button" aria-label="${esc(t('Copiar'))}" title="${esc(t('Copiar'))}">${ICON.copy}</button><button class="copy forget" type="button" aria-label="${esc(t('Remover deste aparelho'))}" title="${esc(t('Remover deste aparelho'))}">${ICON.trash}</button></div>`;
    d.querySelector('.copy').addEventListener('click', () => copy(msg.text, t('Copiado')));
    d.querySelector('.forget').addEventListener('click', () => this.forgetEl(d));
    this.append(d);
  }

  markSent(id) {
    const el = $(`#feed .msg[data-id="${CSS.escape(id)}"]`);
    el?.classList.remove('pending');
  }

  notify() {
    if (this.tab !== 'feed') $('#feed-dot').hidden = false;
    if (document.hidden) { this.unread++; this.updateTitle(); }
  }
  updateTitle() { document.title = `${this.unread ? `(${this.unread}) ` : ''}?${this.room} · ${APP}`; }

  // ----- arquivos -----
  sendFiles(files) {
    if (!files.length) return;
    const others = [...this.peers.values()];
    if (!others.length) {
      files.forEach(f => this.storeInRoom(f));
      toast(t('Ninguém mais na sala. O arquivo foi guardado na sala por 48 h.'));
      if (this.tabsVisible()) this.selectTab('files');
      return;
    }
    const targets = this.target === 'all' ? others : others.filter(p => p.peerId === this.target);
    // Miniaturas (uma de cada vez) para quem recebe ver a prévia antes do arquivo chegar.
    const metas = thumbsInOrder(files);
    // Cada arquivo ganha um id que vale em todos os aparelhos: é por ele que alguém pede o arquivo depois.
    const fids = files.map(() => randomId(10));
    // Vários arquivos juntos viram um lote: um cartão só, em grade, como um álbum do WhatsApp.
    let batch = null, batchP = null;
    if (files.length > 1) {
      batch = { id: randomId(8), n: files.length, fids: fids.slice(0, 300), items: files.slice(0, 300).map(f => ({ name: f.name, size: f.size, type: f.type || '' })) };
      batchP = Promise.all(metas.slice(0, 4)).then(ms => ({ ...batch, items: batch.items.map((x, i) => (ms[i] ? { ...x, thumb: ms[i].thumb, media: ms[i].media } : x)) }));
    }
    const priv = this.target !== 'all';
    const post = { id: batch ? batch.id : fids[0], room: this.room, ts: Date.now(), from: { peerId: this.me.peerId, deviceId: this.me.deviceId, name: this.me.name }, to: priv ? targets.map(p => p.deviceId).filter(Boolean) : null };
    const ref = { id: post.id, ts: post.ts, priv };
    files.forEach((f, i) => {
      const b = batch ? { ...batch, i } : null;
      const meta = Promise.all([metas[i], batchP]).then(([m, bp]) => ({ thumb: m?.thumb || null, media: m?.media || null, batch: bp ? { ...bp, i } : null }));
      const cloudPeers = targets.filter(p => p.away || (this.mesh.path(p.peerId) === 'server' && !this.mesh.isOpen(p.peerId)));
      for (const p of targets) {
        if (cloudPeers.includes(p)) continue;
        this.transfers.send(f, p.peerId, { peerName: p.name, batch: b, meta, fid: fids[i], post: ref });
      }
      if (cloudPeers.length) this.cloudDeliver(f, cloudPeers, null, b, meta, fids[i]);
    });
    this.keepSent(post, files, fids, metas);
    if (this.tab !== 'feed' && this.tabsVisible()) this.selectTab('feed');
  }

  /** Envia pela nuvem para aparelhos sem conexão direta. */
  cloudDeliver(file, peers, fromOutgoing, batch = null, metaP = null, fid = fromOutgoing?.fid || null) {
    const up = new CloudUpload(this.client, file, { to: peers.length === 1 ? peers[0].peerId : null, byName: this.me.name, byPeer: this.me.peerId });
    const cardId = fromOutgoing ? fromOutgoing.id : `c-${randomId(6)}`;
    const model = {
      kind: 'cloud-out', id: cardId, up, peers, name: file.name, size: file.size, tr: fromOutgoing, fid,
      batch: batch || fromOutgoing?.batch || null, thumb: fromOutgoing?.thumb || null, media: fromOutgoing?.media || null
    };
    this.cardModels = this.cardModels || new Map();
    this.cardModels.set(cardId, model);
    metaP?.then(x => { if (!x) return; model.thumb = x.thumb; model.media = x.media; if (x.batch) model.batch = x.batch; this.markDirty(model); });
    up.addEventListener('update', () => this.markDirty(model));
    this.markDirty(model);
    up.start().then(f => {
      if (!f) return;
      // Aviso para quem recebe, com a miniatura e o lote. O servidor aceita mensagens de até 64 KB.
      const b = model.batch;
      const data = {
        ch: 'app', kind: 'cloud-delivery', fileId: f.id, tid: fromOutgoing?.id || null, fid, post: fromOutgoing?.post || null, name: f.name, size: f.size, type: file.type || '',
        wire: up.wireDone, enc: up.gzip ? 'gzip' : null, thumb: model.thumb, media: model.media,
        batch: b ? { id: b.id, i: b.i, n: b.n, items: b.items ? b.items.slice(0, 100) : null, fids: b.fids ? b.fids.slice(0, 100) : null } : null
      };
      if (JSON.stringify(data).length > 50000 && data.batch?.items) data.batch.items = data.batch.items.map(x => ({ name: x.name, size: x.size, type: x.type }));
      if (JSON.stringify(data).length > 50000 && data.batch) data.batch.items = null;
      if (JSON.stringify(data).length > 50000) data.thumb = null;
      for (const p of peers) {
        this.client.send({ t: 'peer', to: p.peerId, data }, { queue: true });
        hist.logEvent({ type: 'sent', room: this.room, file: f.name, size: f.size, to: p.name, path: 'server', ms: up.finishedAt - up.startedAt });
      }
    }).catch(e => this.cloudError(e));
    return up;
  }

  moveToCloud(tr) {
    const p = this.peers.get(tr.peerId);
    if (!p || ['done', 'cancelled', 'failed', 'cloud'].includes(tr.state)) return;
    tr.toCloud();
    this.cloudDeliver(tr.file, [p], tr);
  }

  storeInRoom(file) {
    const up = new CloudUpload(this.client, file, { byName: this.me.name, byPeer: this.me.peerId });
    const id = randomId(6);
    this.uploads.set(id, up);
    let lastState = '';
    up.addEventListener('update', () => { if (up.state !== lastState) { lastState = up.state; this.renderShelf(); } });
    this.renderShelf();
    up.start().then(f => {
      this.uploads.delete(id);
      if (f) { this.files.set(f.id, f); hist.logEvent({ type: 'stored', room: this.room, file: f.name, size: f.size, path: 'server' }); toast(t('Guardado na sala: {name}', { name: f.name })); }
      this.renderShelf();
    }).catch(e => { this.uploads.delete(id); this.renderShelf(); this.cloudError(e); });
  }

  cloudError(e) {
    const code = e?.code;
    if (code === 'file-too-large') toast(t('Arquivo grande demais. O limite na nuvem é {max}.', { max: bytes(e.info?.max || 0) }));
    else if (code === 'room-full') toast(t('A nuvem desta sala está cheia ({max}).', { max: bytes(e.info?.max || 0) }));
    else if (code === 'cloud-full') toast(t('A nuvem está cheia. Espere arquivos expirarem.'));
    else toast(t('Falhou: {why}', { why: code || e?.message || '?' }));
  }

  onAppSignal(from, data) {
    if (!data || data.ch !== 'app') return;
    if (data.kind === 'cloud-delivery') {
      const f = this.files.get(data.fileId) || {
        id: data.fileId, name: String(data.name || 'arquivo').slice(0, 200), size: Number(data.size) || 0, type: String(data.type || '').slice(0, 120),
        storedSize: Number(data.wire) || null, encoding: data.enc === 'gzip' ? 'gzip' : null
      };
      const tid = typeof data.tid === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(data.tid) ? data.tid : null;
      this.showDelivered(f, from, tid, data);
    }
  }

  maybeDelivered(file, live) {
    if (!file.to || file.to !== this.me.peerId) return;
    // Ao vivo, o aviso de quem enviou (com lote e miniatura) chega logo depois: espera um pouco por ele.
    if (live) setTimeout(() => { if (!this.destroyed) this.showDelivered(file, file.byPeer, null); }, 2500);
    else this.showDelivered(file, file.byPeer, null);
  }

  showDelivered(file, from, tid, extra = {}) {
    if (this.delivered.has(file.id)) {
      // Já apareceu sem os detalhes: completa com o lote e a miniatura.
      const m = this.models.get(this.deliveredAs?.get(file.id));
      if (m && (!m.batch || !m.thumb)) {
        m.batch ||= cleanBatch(extra.batch);
        m.thumb ||= cleanThumb(extra.thumb);
        m.media ||= cleanMedia(extra.media);
        this.markDirty(m);
      }
      return;
    }
    this.delivered.add(file.id);
    const sender = this.peers.get(from)?.name || file.byName || '';
    // Se começou direto e passou para a nuvem, herda o lote e a miniatura do recebimento direto.
    const prev = tid ? this.transfers.inc.get(tid) : null;
    const fid = /^[A-Za-z0-9_-]{1,32}$/.test(String(extra.fid || '')) ? String(extra.fid) : null;
    // Já está na conversa como cartão guardado: o arquivo da nuvem passa a ser mais um jeito de baixá-lo.
    const st = fid ? this.stored.get(fid) : this.storedByCloud(file.id);
    if (st) { st.cloudFile = file; this.markDirty(st); return; }
    const model = {
      kind: 'cloud-in', id: tid || `d-${file.id}`, file, from: sender, fromPeer: from || file.byPeer || '', fid,
      batch: cleanBatch(extra.batch) || prev?.batch || null, thumb: cleanThumb(extra.thumb) || prev?.thumb || null,
      media: cleanMedia(extra.media) || prev?.media || null, wire: Number(extra.wire) || null
    };
    this.cardModels = this.cardModels || new Map();
    this.cardModels.set(model.id, model);
    this.models.set(model.id, model);
    (this.deliveredAs ||= new Map()).set(file.id, model.id);
    this.markDirty(model);
    this.notify();
    if (fid) this.keepCloudPost(model, extra);
    hist.logEvent({ type: 'received', room: this.room, file: file.name, size: file.size, from: sender, path: 'server' });
  }

  renderShelf() {
    const ul = $('#shelf');
    if (!ul) return;
    const now = Date.now();
    const files = [...this.files.values()].sort((a, b) => b.created - a.created);
    $('#file-count').textContent = String(files.length);
    const uploading = [...this.uploads.entries()].map(([id, u]) => {
      const meter = this.upMeters.get(id);
      return `<li class="server"><div class="top"><span class="ftype">${esc(ext(u.name))}</span><div style="min-width:0"><div class="fname">${esc(u.name)}</div><div class="fmeta"><span class="tnum">${esc(bytes(u.size))}</span><span>${esc(t('Enviando para a nuvem'))}</span></div></div>
        <div class="acts"><button class="btn quiet icon sm" type="button" data-up-cancel="${esc(id)}" aria-label="${esc(t('Cancelar'))}" title="${esc(t('Cancelar'))}">${ICON.x}</button></div></div>
        <div class="live" data-up="${esc(id)}">${this.liveHTML(meter, u.liveStats(), u.size)}</div><div class="comp-slot"></div></li>`;
    }).join('');
    const ttl = this.limits.fileTtlMs || 48 * 3600000;
    const rows = files.map(f => {
      const left = Math.max(0, f.expiresAt - now);
      const h = Math.floor(left / 3600000);
      const low = left < 6 * 3600000;
      return `<li data-id="${esc(f.id)}">
        <div class="top"><span class="ftype">${esc(ext(f.name))}</span><div style="min-width:0"><div class="fname" title="${esc(f.name)}">${esc(f.name)}</div><div class="fmeta"><span class="tnum">${esc(bytes(f.size))}</span><span>${esc(t('por {name}', { name: f.byPeer === this.me.peerId ? t('você') : f.byName }))}</span></div></div>
        <div class="acts"><a class="btn line icon sm" href="${esc(downloadUrl(this.client, f.id))}" aria-label="${esc(t('Baixar {name}', { name: f.name }))}" title="${esc(t('Baixar'))}">${ICON.down}</a><button class="btn quiet icon sm" type="button" data-del="${esc(f.id)}" aria-label="${esc(t('Apagar {name}', { name: f.name }))}" title="${esc(t('Apagar'))}">${ICON.trash}</button></div></div>
        <div class="comp-slot">${this.compHTML({ comp: { raw: f.size, wire: f.storedSize || f.size, codec: f.encoding || 'none', final: true } })}</div>
        <div class="ttl${low ? ' low' : ''}"><div class="tbar"><i style="width:${Math.min(100, left / ttl * 100).toFixed(0)}%"></i></div><span>${esc(h >= 1 ? t('some em {h} h', { h }) : t('some em menos de 1 h'))}</span></div>
      </li>`;
    }).join('');
    ul.innerHTML = uploading + rows;
    if (!files.length && !uploading) ul.innerHTML = `<li class="shelf-empty" style="background:none;border:0;padding:0">${esc(t('Nada guardado ainda.'))}</li>`;
    const used = files.reduce((s, f) => s + f.size, 0);
    $('#shelf-count').textContent = files.length ? String(files.length) : '';
    $('#shelf-usage').innerHTML = `<div class="qbar"><i style="width:${Math.min(100, used / (this.limits.maxRoomBytes || 1) * 100).toFixed(1)}%"></i></div><span>${esc(t('Usando {used} de {max} desta sala.', { used: bytes(used), max: bytes(this.limits.maxRoomBytes) }))} ${esc(t('Cada download renova o prazo de 48 h.'))}</span>`;
    $$('[data-up-cancel]', ul).forEach(b => b.addEventListener('click', () => {
      const u = this.uploads.get(b.dataset.upCancel);
      if (u) { u.abort(); this.uploads.delete(b.dataset.upCancel); this.renderShelf(); }
    }));
    $$('[data-del]', ul).forEach(b => b.addEventListener('click', () => {
      if (b.dataset.armed) { this.client.send({ t: 'delete-file', fileId: b.dataset.del }); return; }
      b.dataset.armed = '1';
      b.classList.add('danger');
      b.classList.remove('quiet');
      b.title = t('Toque de novo para apagar');
      setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.classList.remove('danger'); b.classList.add('quiet'); b.title = t('Apagar'); } }, 3000);
    }));
  }

  // ----- cartões de transferência -----
  markDirty(model) {
    this.dirty.add(model);
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = null;
      const list = [...this.dirty];
      this.dirty.clear();
      for (const m of list) this.renderCard(m);
      for (const key of this.dirtyAlbums) { const a = this.albums.get(key); if (a) this.renderAlbum(a); }
      this.dirtyAlbums.clear();
      this.updateWakeLock();
    });
  }
  /** Algo mudou fora do fluxo das transferências (uma prévia ficou pronta, por exemplo). */
  touch(m) { if (m) this.markDirty(m); }

  renderCard(m) {
    // Arquivo pedido por outro aparelho para um cartão antigo: não vira cartão aqui.
    if (m.serve) return;
    // Chegando para um cartão guardado (alguém pediu o arquivo): o progresso aparece no próprio cartão.
    if (m.dir === 'in' && m.fid && this.stored.has(m.fid) && !this.liveFids.has(m.fid)) {
      const st = this.stored.get(m.fid);
      st.tr = m;
      st.wanted = null;
      if (m.state === 'done' && !m.kept) { m.kept = true; st.blob = m.blob; this.keepReceived(m, true); }
      this.renderCard(st);
      return;
    }
    if (m.fid && m.kind !== 'stored' && !this.liveFids.has(m.fid)) this.liveFids.set(m.fid, m);
    if (m.dir === 'in' && m.state === 'done' && m.fid && !m.kept) { m.kept = true; this.keepReceived(m, false); }
    const id = m.id;
    const current = this.cardModels?.get(id) || m;
    this.models.set(id, current);
    // Arquivo de um lote: vai para o cartão do lote.
    const key = this.albumOf.get(id) || this.albumKey(current);
    if (key) {
      // Virou parte de um lote depois de já ter aparecido sozinho: sai o cartão avulso.
      const solo = this.cards.get(id);
      if (solo) { solo.el.remove(); this.cards.delete(id); }
      this.addToAlbum(key, current);
      this.logTerminal(current);
      return;
    }
    let entry = this.cards.get(id);
    if (!entry) {
      if (m.dir === 'in' && m.state === 'receiving' && !m.notified) { m.notified = true; this.notify(); }
      const el = document.createElement('article');
      el.dataset.card = id;
      el.dataset.ts = String(m.ts || Date.now());
      el.addEventListener('click', e => { if (e.target.closest('a[download]')) this.used(this.cards.get(id)?.model); this.onCardAction(e, id); });
      entry = { el };
      this.cards.set(id, entry);
      this.append(el);
    }
    // Um cartão que virou "nuvem" passa a mostrar o upload ligado a ele.
    const model = current;
    entry.model = model;
    const it = this.itemInfo(model);
    const path = this.cardPath(model);
    const sig = [model.kind || model.dir, model.state, model.up?.state, path, this.peers.get(model.peerId)?.name, !!it.preview, !!it.thumb, it.intact, it.media?.w, it.state, it.available, model.tr?.state].join('|');
    if (entry.sig !== sig) {
      entry.sig = sig;
      const media = it.kind === 'image' || it.kind === 'video';
      entry.el.className = `xfer ${path}${this.isMine(model) ? ' mine' : ''}${media ? ' has-media' : ''}`;
      entry.el.innerHTML = this.mediaHTML(it) + this.cardHTML(model) + `<div class="comp-slot">${this.compHTML(it)}</div>`;
    }
    this.logTerminal(model);
  }

  isMine(m) { return m.kind === 'stored' ? m.mine : m.dir === 'out' || m.kind === 'cloud-out'; }
  cardPath(m) {
    if (m.kind === 'stored') return m.tr ? this.cardPath(m.tr) : '';
    if (m.kind === 'cloud-out' || m.kind === 'cloud-in') return 'server';
    if (m.finalPath) return m.finalPath;
    const p = this.mesh.path(m.peerId);
    const path = ['direct', 'relay', 'server'].includes(p) ? p : (p === 'reconnecting' ? 'reconnecting' : 'connecting');
    // Envio terminado guarda o caminho que usou: uma reconexão depois não muda o cartão.
    if (['done', 'cancelled', 'failed', 'cloud'].includes(m.state) && ['direct', 'relay', 'server'].includes(path)) m.finalPath = path;
    return path;
  }

  cardHTML(m) {
    const peerName = id => this.peers.get(id)?.name || m.peerName || '';
    const top = (name, size, who, path) => `<div class="xfer-top"><span class="ftype">${esc(ext(name))}</span>
      <div style="min-width:0"><div class="fname" title="${esc(name)}">${esc(name)}</div><div class="fmeta"><span>${who}</span><span class="tnum">${esc(bytes(size))}</span></div></div>${pill(path)}</div>`;
    const btn = (act, label, cls = 'line') => `<button class="btn ${cls} sm" type="button" data-act="${act}">${esc(label)}</button>`;
    const done = text => `<div class="ok-note done">${ICON.check}<span>${esc(text)}</span></div>`;
    const forget = btn('forget', t('Remover deste aparelho'), 'quiet');

    if (m.kind === 'stored') return this.storedCardHTML(m, top, btn, forget);

    if (m.kind === 'cloud-in') {
      return top(m.file.name, m.file.size, `${t('De {name}', { name: `<b>${esc(m.from)}</b>` })}`, 'server') +
        `<div class="ok-note">${esc(t('Recebido pela nuvem. Fica disponível por 48 h.'))}</div><div class="acts"><a class="btn solid sm" href="${esc(downloadUrl(this.client, m.file.id))}">${ICON.down}${esc(t('Baixar'))}</a></div>`;
    }
    if (m.kind === 'cloud-out') {
      const up = m.up;
      const who = m.peers.length === 1 ? t('Para {name}', { name: `<b>${esc(m.peers[0].name)}</b>` }) : t('Para a sala');
      let body = '';
      if (up.state === 'done') body = done(t('Enviado pela nuvem. {name} baixa quando quiser.', { name: m.peers.map(p => p.name).join(', ') }));
      else if (up.state === 'failed') body = `<div class="notice">${esc(t('Falhou: {why}', { why: up.error?.code || up.error?.message || '?' }))}</div>`;
      else if (up.state === 'cancelled') body = `<div class="ok-note">${esc(t('Cancelado'))}</div>`;
      else body = `<div class="ok-note">${esc(m.tr ? t('Sem conexão direta. Continuando pela nuvem.') : t('Enviando para a nuvem'))}</div><div class="live">${this.liveHTML(this.cards.get(m.id)?.meter, up.liveStats(), up.size)}</div><div class="acts">${btn('cloud-cancel', t('Cancelar'), 'quiet')}</div>`;
      return top(m.name, m.size, who, 'server') + body;
    }

    const out = m.dir === 'out';
    const who = out ? t('Para {name}', { name: `<b>${esc(peerName(m.peerId))}</b>` }) : t('De {name}', { name: `<b>${esc(peerName(m.peerId))}</b>` });
    const path = this.cardPath(m);
    const total = m.size;
    const progress = () => `<div class="live">${this.liveHTML(this.cards.get(m.id)?.meter, m.liveStats(), total, m)}</div>`;
    let body = '';
    switch (m.state) {
      case 'queued': case 'preparing':
        body = `<div class="ok-note">${esc(m.state === 'queued' ? t('Esperando {name} aceitar', { name: peerName(m.peerId) }) : t('Preparando'))}</div><div class="acts">${btn('cancel', t('Cancelar'), 'quiet')}</div>`; break;
      case 'waiting':
        body = `${m.acked ? progress() : ''}<div class="ok-note">${esc(t('Esperando {name} aceitar', { name: peerName(m.peerId) }))}</div><div class="acts">${btn('cancel', t('Cancelar'), 'quiet')}</div>`; break;
      case 'sending': case 'receiving':
        body = `${progress()}<div class="acts">${out ? btn('pause', t('Pausar')) : ''}${btn('cancel', t('Cancelar'), 'quiet')}</div>`; break;
      case 'paused':
        body = `${progress()}<div class="acts">${btn('unpause', t('Continuar'))}${btn('cancel', t('Cancelar'), 'quiet')}</div>`; break;
      case 'interrupted':
        body = `${progress()}<div class="notice">${esc(t('A conexão caiu. O envio continua do bloco {n} assim que a rede voltar.', { n: m.acked + 1 }))}</div><div class="acts">${btn('retry', t('Tentar agora'))}${btn('to-cloud', t('Mandar pela nuvem'), 'quiet')}${btn('cancel', t('Cancelar'), 'quiet')}</div>`; break;
      case 'stalled':
        body = `${progress()}<div class="notice">${esc(t('O envio foi interrompido do outro lado. Peça para enviar de novo.'))}</div><div class="acts">${btn('cancel', t('Cancelar'), 'quiet')}</div>`; break;
      case 'done': {
        const ms = (m.finishedAt || Date.now()) - (out ? (m.startedAt || m.createdAt) : m.startedAt);
        const avg = ms > 0 ? `${bytes(m.size / (ms / 1000))}/s` : '';
        const meter = this.cards.get(m.id)?.meter;
        const graph = meter && meter.lastBin >= 0 ? `<div class="speedgraph">${meter.svg()}</div>` : '';
        const summary = `${out ? t('Enviado em {t}', { t: duration(ms) }) : t('Recebido em {t}', { t: duration(ms) })}${avg ? ` · ${t('média de {s}', { s: avg })}` : ''}`;
        body = out
          ? `${graph}<div class="bline">${done(summary)}</div>${m.fid ? `<div class="acts">${forget}</div>` : ''}`
          : `${graph}<div class="bline">${done(summary)}</div><div class="acts"><a class="btn solid sm" href="${esc(m.url)}" download="${esc(m.name)}">${ICON.down}${esc(t('Salvar arquivo'))}</a>${btn('store', t('Guardar na sala'), 'quiet')}${m.fid ? forget : ''}</div>`;
        break;
      }
      case 'cloud':
        body = `<div class="ok-note">${esc(t('Sem conexão direta. Continuando pela nuvem.'))}</div>`; break;
      case 'cancelled':
        body = `<div class="ok-note">${esc(t('Cancelado'))}</div>`; break;
      case 'failed':
        body = `<div class="notice">${esc(t('Falhou: {why}', { why: m.error || '?' }))}</div>`; break;
      default:
    }
    return top(m.name, m.size, who, path) + body;
  }

  // ----- prévias, lotes e visualizador -----
  objUrl(blob) {
    let u = this.urls.get(blob);
    if (!u) { u = URL.createObjectURL(blob); this.urls.set(blob, u); }
    return u;
  }

  /** O que a interface precisa saber de um arquivo, venha de onde vier: envio direto, recebimento ou nuvem. */
  itemInfo(m) {
    if (m.kind === 'stored') return this.storedInfo(m);
    const k = m.kind;
    const file = k === 'cloud-in' ? m.file : null;
    const name = file ? file.name : m.name;
    const size = file ? file.size : m.size;
    const type = file ? (file.type || '') : k === 'cloud-out' ? (m.up.file.type || '') : (m.type || '');
    const kind = kindOf(type, name);
    let state;
    if (k === 'cloud-in') state = 'done';
    else if (k === 'cloud-out') state = ['preparing', 'uploading'].includes(m.up.state) ? 'active' : m.up.state;
    else state = ['sending', 'receiving', 'preparing'].includes(m.state) ? 'active' : m.state;
    // Da nuvem: só fica local depois de baixado aqui (para o zip, por exemplo).
    const blob = m.dir === 'out' ? m.file : k === 'cloud-out' ? m.up.file : (m.dir === 'in' && m.state === 'done') ? m.blob : k === 'cloud-in' ? m.localBlob || null : null;
    const remote = k === 'cloud-in' ? downloadUrl(this.client, file.id) : null;
    const full = blob ? (m.dir === 'in' ? m.url : this.objUrl(blob)) : remote ? `${remote}&inline=1` : null;
    const preview = blob ? previewUrl(blob, type, name, () => this.touch(m)) : null;
    let progress = 0;
    if (state === 'done') progress = 1;
    else { const src = k === 'cloud-out' ? m.up : m; if (src.liveStats && size) progress = Math.min(1, src.liveStats().raw / size); }
    let comp = null;
    if (m.dir === 'out') comp = { raw: m.raw, wire: m.wire, codec: m.codec, level: m.usedLevel, already: m.alreadyCompressed };
    else if (m.dir === 'in') comp = { raw: m.done, wire: m.wireDone, codec: m.codec };
    else if (k === 'cloud-out') {
      const fin = m.up.state === 'done';
      comp = { raw: fin ? m.up.size : m.up.producedRaw, wire: fin ? m.up.wireDone : m.up.producedWire, codec: m.up.gzip ? 'gzip' : 'none' };
    } else if (k === 'cloud-in') {
      const f = this.files.get(file.id) || file;
      const stored = f.storedSize || m.wire;
      if (stored) comp = { raw: f.size, wire: stored, codec: f.encoding || 'none' };
    }
    if (comp) comp.final = state === 'done';
    return {
      id: m.id, m, name, size, type, kind, state, mine: this.isMine(m), blob, remote, full, preview,
      thumb: m.thumb || null, media: m.media || null, progress, comp, intact: !!m.intact, label: ext(name),
      download: m.dir === 'in' ? m.url : remote, from: m.from || (m.dir === 'in' ? this.peers.get(m.peerId)?.name || m.peerName : '')
    };
  }

  /** Linha "Comprimido 62% · 10 MB → 3,8 MB", sempre presente quando já passou algum byte. */
  compHTML(it) {
    const c = it?.comp;
    if (!c || !(c.raw > 0)) return '';
    const pct = Math.max(0, Math.round((1 - c.wire / c.raw) * 100));
    const how = c.codec === 'none'
      ? (c.already ? t('Sem compressão (já é compactado)') : t('Sem compressão'))
      : t('Comprimido {p}%', { p: pct });
    const algo = c.codec === 'zstd' ? `zstd${c.level ? ` ${c.level}` : ''}` : ['none', 'mixed'].includes(c.codec) ? '' : c.codec;
    return `<div class="comp" title="${esc(t('Tamanho original → tamanho que passou pela rede'))}"><span class="ci">${ICON.squeeze}</span>`
      + `<span class="cv tnum"><b>${esc(how)}</b><span>${esc(bytes(c.raw))} → ${esc(bytes(c.wire))}${c.final ? '' : ` ${esc(t('até agora'))}`}</span>${algo ? `<em>${esc(algo)}</em>` : ''}</span>`
      + `${it.intact ? `<span class="ok" title="${esc(t('Cada bloco foi conferido com SHA-256 depois de descompactado.'))}">${ICON.check}${esc(t('Idêntico ao original'))}</span>` : ''}</div>`;
  }
  setComp(el, it) {
    const slot = el.querySelector('.comp-slot');
    if (!slot) return;
    const html = this.compHTML(it);
    if (slot._h !== html) { slot.innerHTML = html; slot._h = html; }
  }

  stateText(x) {
    const pct = Math.round((x.progress || 0) * 100);
    switch (x.state) {
      case 'done': return x.intact ? t('Conferido') : x.mine ? t('Enviado') : t('Pronto');
      case 'active': return `${x.mine ? t('Enviando') : t('Recebendo')} ${pct}%`;
      case 'queued': case 'waiting': return t('Na fila');
      case 'paused': return t('Pausado');
      case 'interrupted': return t('A conexão caiu');
      case 'stalled': return t('Parado');
      case 'cloud': return t('Indo pela nuvem');
      case 'cancelled': return t('Cancelado');
      case 'failed': return t('Falhou');
      case 'missing': return x.available ? t('Toque para baixar') : t('Não está neste aparelho');
      default: return '';
    }
  }

  ringHTML(x) {
    const pct = Math.round((x.progress || 0) * 100);
    const wait = ['queued', 'waiting'].includes(x.state);
    const hold = ['paused', 'interrupted', 'cloud'].includes(x.state);
    return `<span class="ring${wait ? ' wait' : ''}${hold ? ' hold' : ''}" data-ring="${esc(x.id)}"><svg viewBox="0 0 40 40" aria-hidden="true"><circle class="bg" cx="20" cy="20" r="17"/><circle class="fg" cx="20" cy="20" r="17" pathLength="100" stroke-dasharray="${pct} 100"/></svg><b class="tnum">${wait ? ICON.clock : `${pct}%`}</b></span>`;
  }
  overlayHTML(x, more = 0) {
    if (more) return `<span class="more tnum">+${more}</span>`;
    const dur = x.kind === 'video' && x.media?.dur ? `<span class="dur tnum">${ICON.play}${clock(x.media.dur)}</span>` : '';
    if (['failed', 'cancelled', 'stalled'].includes(x.state)) return `<span class="ring bad">${ICON.warn}</span>${dur}`;
    if (x.state !== 'done' && !['missing', 'loading'].includes(x.state)) return this.ringHTML(x) + dur;
    if (x.state === 'done' && x.kind === 'video') return `<span class="playbtn">${ICON.play}</span>${dur}`;
    if (x.kind === 'image' && x.remote && !x.preview) return `<span class="ring idle">${ICON.down}</span>`;
    if (x.state === 'missing') return x.kind === 'image' || x.kind === 'video' ? `<span class="ring idle${x.available ? '' : ' off'}">${ICON.down}</span>${dur}` : '';
    if (x.state === 'loading') return dur;
    return dur;
  }
  updateRings(root, items) {
    const rings = root.querySelectorAll('[data-ring]');
    if (!rings.length) return;
    const by = new Map(items.map(x => [x.id, x]));
    for (const r of rings) {
      const x = by.get(r.dataset.ring);
      if (!x) continue;
      const pct = Math.round((x.progress || 0) * 100);
      r.querySelector('.fg')?.setAttribute('stroke-dasharray', `${pct} 100`);
      if (!r.classList.contains('wait')) { const b = r.querySelector('b'); if (b) b.textContent = `${pct}%`; }
    }
  }

  /** Foto ou vídeo no topo do cartão, no tamanho certo, com a prévia desfocada até o arquivo chegar. */
  mediaHTML(it) {
    if (it.kind !== 'image' && it.kind !== 'video') return '';
    const src = it.preview || it.thumb;
    const r = it.media?.w && it.media?.h ? it.media.w / it.media.h : it.kind === 'video' ? 16 / 9 : 4 / 3;
    const ar = Math.max(0.6, Math.min(1.9, r));
    return `<button class="media${it.preview ? '' : ' blurred'}" type="button" data-act="view" data-id="${esc(it.id)}" style="aspect-ratio:${ar.toFixed(3)}" aria-label="${esc(t('Abrir {name}', { name: it.name }))}">${src ? `<img src="${esc(src)}" alt="" decoding="async">` : `<span class="ph">${esc(it.label)}</span>`}${this.overlayHTML(it)}</button>`;
  }

  // Lote: um cartão só, com até 4 quadrados e "+N" no último, a lista completa e "Baixar tudo (.zip)".
  albumKey(m) {
    if (m.kind === 'stored') return m.batch && m.batch.n > 1 ? `s:${m.postId}` : null;
    const b = m.batch;
    if (!b || !(b.n > 1)) return null;
    const who = m.kind === 'cloud-out' ? m.peers.map(p => p.peerId).sort().join(',') : m.kind === 'cloud-in' ? m.fromPeer : m.peerId;
    return `${this.isMine(m) ? 'o' : 'i'}:${b.id}:${who || ''}`;
  }

  addToAlbum(key, m) {
    let a = this.albums.get(key);
    const b = m.batch;
    if (!a) {
      const el = document.createElement('article');
      el.dataset.album = key;
      el.dataset.ts = String(m.ts || Date.now());
      a = { key, el, ids: [], n: b?.n || 2, items: null, mine: this.isMine(m), stored: m.kind === 'stored', peerId: m.peerId || m.fromPeer || m.peers?.[0]?.peerId || '', sig: '', open: false };
      el.addEventListener('click', e => {
        const dl = e.target.closest('a[download]');
        if (dl) { const row = dl.closest('li')?.querySelector('[data-id]'); const x = row && this.albumItems(a).find(y => y.id === row.dataset.id); this.used(x?.m); }
        this.onAlbumAction(e, key);
      });
      el.addEventListener('toggle', e => { if (e.target.matches?.('details')) a.open = e.target.open; }, true);
      this.albums.set(key, a);
      this.append(el);
      if (!a.mine) this.notify();
    }
    this.albumOf.set(m.id, key);
    if (b) {
      a.ids[b.i] = m.id;
      a.n = Math.max(a.n, b.n);
      const thumbs = list => (list || []).filter(x => x.thumb).length;
      if (b.items && (!a.items || thumbs(b.items) >= thumbs(a.items))) a.items = b.items;
    }
    a.names ||= new Set();
    const name = a.stored ? (a.mine ? '' : m.from) : a.mine ? (m.peers ? m.peers.map(p => p.name).join(', ') : this.peers.get(m.peerId)?.name || m.peerName) : (m.from || this.peers.get(m.peerId)?.name || '');
    if (name) a.names.add(name);
    // Quem recebe cancelou o lote: o que chegar depois também é cancelado.
    if (a.cancelled && m.dir === 'in' && m.state === 'receiving') m.cancel();
    this.dirtyAlbums.add(key);
  }

  albumItems(a) {
    const out = [];
    const real = [];
    for (let i = 0; i < a.n; i++) {
      const id = a.ids[i];
      const m = id && (this.cardModels?.get(id) || this.models.get(id));
      if (m) { const x = this.itemInfo(m); out.push(x); real.push(x); continue; }
      const x = a.items?.[i] || {};
      out.push({
        id: `ph:${a.key}:${i}`, placeholder: true, name: x.name || '…', size: x.size || 0, type: x.type || '', kind: kindOf(x.type, x.name),
        state: 'queued', mine: a.mine, thumb: x.thumb || null, media: x.media || null, preview: null, progress: 0, comp: null, intact: false,
        label: x.name ? ext(x.name) : '…'
      });
    }
    // Quem envia cancelou (ou tudo já terminou sem estes): os que nunca chegaram também contam como cancelados.
    const over = real.length && real.every(x => ['done', 'failed', 'cancelled'].includes(x.state)) && real.some(x => x.state === 'cancelled');
    if (a.cancelled || over) for (const x of out) if (x.placeholder) x.state = 'cancelled';
    return out;
  }

  albumStats(items) {
    let net = 0, raw = 0;
    for (const x of items) {
      if (!x.m) continue;
      const src = x.m.kind === 'cloud-out' ? x.m.up : x.m.kind === 'stored' ? x.m.tr : x.m;
      if (src?.liveStats) { const s = src.liveStats(); net += s.net; raw += s.raw; } else if (x.state === 'done') raw += x.size;
    }
    return { net, raw };
  }

  albumComp(items) {
    const cs = items.filter(x => x.comp && x.comp.raw > 0);
    if (!cs.length) return { comp: null };
    const codecs = new Set(cs.map(x => x.comp.codec));
    return {
      comp: {
        raw: cs.reduce((s, x) => s + x.comp.raw, 0), wire: cs.reduce((s, x) => s + x.comp.wire, 0),
        codec: codecs.size === 1 ? [...codecs][0] : 'mixed', final: items.every(x => x.state === 'done'), already: cs.every(x => x.comp.already)
      },
      intact: items.every(x => x.state === 'done' && x.intact)
    };
  }

  tileHTML(x, more) {
    const media = x.kind === 'image' || x.kind === 'video';
    const src = media ? (x.preview || x.thumb) : null;
    const inner = src
      ? `<img src="${esc(src)}" alt=""${x.preview ? '' : ' class="blur"'} decoding="async">`
      : `<span class="tfile"><span class="ext">${x.kind === 'audio' ? ICON.music : esc(x.label)}</span><span class="tn">${esc(x.name)}</span><span class="ts tnum">${esc(bytes(x.size))}</span></span>`;
    return `<button class="tile${media && src ? '' : ' doc'}${x.state === 'missing' ? ' missing' : ''}" type="button" data-act="view" data-id="${esc(x.id)}" aria-label="${esc(t('Abrir {name}', { name: x.name }))}">${inner}${this.overlayHTML(x, more)}</button>`;
  }

  rowHTML(x) {
    const pic = (x.kind === 'image' || x.kind === 'video') && (x.preview || x.thumb);
    const mini = pic ? `<img src="${esc(x.preview || x.thumb)}" alt=""${x.preview ? '' : ' class="blur"'}>` : `<span>${x.kind === 'audio' ? ICON.music : esc(x.label)}</span>`;
    const c = x.comp && x.comp.raw > 0 ? (x.comp.codec === 'none' ? t('sem compressão') : t('comprimido {p}%', { p: Math.max(0, Math.round((1 - x.comp.wire / x.comp.raw) * 100)) })) : '';
    const dl = !x.mine && x.state === 'done' && x.download
      ? `<a class="btn quiet icon sm" href="${esc(x.download)}" download="${esc(x.name)}" title="${esc(t('Baixar'))}" aria-label="${esc(t('Baixar {name}', { name: x.name }))}">${ICON.down}</a>` : '';
    return `<li><button class="mini" type="button" data-act="view" data-id="${esc(x.id)}" aria-label="${esc(t('Abrir {name}', { name: x.name }))}">${mini}</button>
      <div class="rt"><div class="fname" title="${esc(x.name)}">${esc(x.name)}</div><div class="fmeta tnum"><span>${esc(bytes(x.size))}</span><span data-rowst="${esc(x.id)}"${x.intact ? ' class="okc"' : ''}>${esc(this.stateText(x))}</span>${c ? `<span>${esc(c)}</span>` : ''}</div></div>${dl}</li>`;
  }

  renderAlbum(a) {
    const items = this.albumItems(a);
    const real = items.filter(x => !x.placeholder);
    const active = items.some(x => !['done', 'failed', 'cancelled', 'missing', 'loading'].includes(x.state));
    a.active = active;
    const cur = real.find(x => x.state === 'active') || real.find(x => x.state !== 'done') || real[real.length - 1];
    const path = cur ? this.cardPath(cur.m) : 'connecting';
    const sig = [items.map(x => [x.id, x.state, !!x.preview, !!x.thumb, x.intact, x.available].join(':')).join(','), path, a.zipping, [...(a.names || [])].join()].join('|');
    if (sig === a.sig) return;
    a.sig = sig;
    const n = a.n;
    const total = items.reduce((s, x) => s + (x.size || 0), 0);
    const doneN = items.filter(x => x.state === 'done').length;
    const names = [...(a.names || [])].join(', ');
    const who = a.stored && a.mine ? esc(t('Enviado por você')) : a.mine ? t('Para {name}', { name: `<b>${esc(names)}</b>` }) : t('De {name}', { name: `<b>${esc(names)}</b>` });
    let live = '';
    if (active) live = `<div class="live">${this.liveHTML(a.meter, this.albumStats(items), total)}</div>`;
    else if (a.meter && a.meter.lastBin >= 0 && a.meter.peak > 0) live = `<div class="speedgraph">${a.meter.svg()}</div>`;
    const btn = (act, label, cls = 'line', icon = '') => `<button class="btn ${cls} sm" type="button" data-act="${act}"${act === 'zip' && a.zipping ? ' disabled' : ''}>${icon}<span class="lbl">${esc(label)}</span></button>`;
    let acts = '';
    if (active) {
      const outs = real.filter(x => x.m.dir === 'out');
      if (outs.some(x => x.m.state === 'sending')) acts += btn('pause', t('Pausar'));
      if (outs.some(x => x.m.state === 'paused')) acts += btn('unpause', t('Continuar'));
      if (outs.some(x => x.m.state === 'interrupted')) acts += btn('retry', t('Tentar agora')) + btn('to-cloud', t('Mandar pela nuvem'), 'quiet');
      acts += btn('cancel-all', t('Cancelar tudo'), 'quiet');
    } else {
      const missing = items.filter(x => x.state === 'missing' && x.available).length;
      if (missing) acts += btn('fetch-all', t('Baixar os {n} que faltam', { n: missing }), 'solid', ICON.down);
      if ((!a.mine || a.stored) && doneN) {
        acts += btn('zip', a.zipText || t('Baixar tudo (.zip)'), missing ? 'line' : 'solid', ICON.zip);
        acts += btn('each', t('Baixar separados'), 'line', ICON.down);
      }
      if (a.stored || items.some(x => x.m?.fid)) acts += btn('forget', t('Remover deste aparelho'), 'quiet');
    }
    const status = active ? t('{d} de {n} prontos', { d: doneN, n })
      : a.stored ? (doneN === n ? t('Todos neste aparelho') : t('{d} de {n} neste aparelho', { d: doneN, n }))
        : doneN === n ? (a.mine ? t('Todos enviados') : t('Todos recebidos')) : t('{d} de {n} chegaram', { d: doneN, n });
    a.el.className = `xfer album has-media ${path}${a.mine ? ' mine' : ''}`;
    a.el.innerHTML = `<div class="album-grid n${Math.min(n, 4)}">${items.slice(0, 4).map((x, i) => this.tileHTML(x, i === 3 && n > 4 ? n - 4 : 0)).join('')}</div>
      <div class="xfer-top"><span class="ftype">${ICON.stack}</span><div style="min-width:0"><div class="fname">${esc(t('{n} arquivos', { n }))} · <span class="tnum">${esc(bytes(total))}</span></div><div class="fmeta"><span>${who}</span><span data-album-status>${esc(status)}</span></div></div>${pill(path)}</div>
      ${live}
      <div class="comp-slot">${this.compHTML(this.albumComp(items))}</div>
      ${acts ? `<div class="acts">${acts}</div>` : ''}
      <details class="files-list"${a.open ? ' open' : ''}><summary>${esc(t('Ver os {n} arquivos', { n }))}</summary><ul>${items.map(x => this.rowHTML(x)).join('')}</ul></details>`;
  }

  liveAlbum(a) {
    const items = this.albumItems(a);
    const total = items.reduce((s, x) => s + (x.size || 0), 0);
    const st = this.albumStats(items);
    a.meter ||= new SpeedMeter();
    a.meter.sample(st.net, total ? st.raw / total : 0);
    const box = a.el.querySelector('.live');
    if (box) box.innerHTML = this.liveHTML(a.meter, st, total);
    this.updateRings(a.el, items);
    const by = new Map(items.map(x => [x.id, x]));
    for (const s of a.el.querySelectorAll('[data-rowst]')) { const x = by.get(s.dataset.rowst); if (x) s.textContent = this.stateText(x); }
    this.setComp(a.el, this.albumComp(items));
  }

  onAlbumAction(e, key) {
    const b = e.target.closest('[data-act]');
    const a = this.albums.get(key);
    if (!b || !a) return;
    const act = b.dataset.act;
    if (act === 'view') {
      const items = this.albumItems(a);
      const x = items.find(y => y.id === b.dataset.id);
      // Não está neste aparelho: tocar baixa de quem tem (como no WhatsApp).
      if (x?.state === 'missing') { this.requestFile(x.m.fid); return; }
      const ids = items.filter(y => y.state !== 'missing').map(y => y.id);
      this.used(x?.m);
      this.viewer.openWith(ids, Math.max(0, ids.indexOf(b.dataset.id)), b);
      return;
    }
    if (act === 'zip') { this.albumItems(a).forEach(x => this.used(x.m)); this.zipAlbum(a); return; }
    if (act === 'each') { this.albumItems(a).forEach(x => this.used(x.m)); this.downloadEach(a); return; }
    if (act === 'fetch-all') { this.albumItems(a).filter(x => x.state === 'missing').forEach(x => this.requestFile(x.m.fid, { quiet: true })); return; }
    if (act === 'forget') { this.forgetEl(a.el); return; }
    const models = a.ids.filter(Boolean).map(id => this.cardModels?.get(id) || this.models.get(id)).filter(Boolean);
    if (act === 'cancel-all') {
      if (!a.mine) a.cancelled = true;
      // Do último para o primeiro: assim a fila não começa o próximo enquanto cancela.
      for (const m of [...models].reverse()) {
        if (m.kind === 'stored') { m.wanted = null; if (m.tr && !['done', 'failed', 'cancelled'].includes(m.tr.state)) m.tr.cancel(); m.tr = null; }
        else if (m.kind === 'cloud-out') { if (['preparing', 'uploading'].includes(m.up.state)) { m.up.abort(); if (m.tr) m.tr.state = 'cancelled'; } }
        else if (m.cancel && !['done', 'failed', 'cancelled'].includes(m.state)) m.cancel();
      }
    } else if (act === 'pause') models.filter(m => m.state === 'sending').forEach(m => m.pause());
    else if (act === 'unpause') models.filter(m => m.state === 'paused').forEach(m => m.unpause());
    else if (act === 'retry') { new Set(models.filter(m => m.state === 'interrupted').map(m => m.peerId)).forEach(p => this.mesh.links.get(p)?.recreate('manual')); this.client.nudge(); }
    else if (act === 'to-cloud') models.filter(m => m.state === 'interrupted').forEach(m => this.moveToCloud(m));
    models.forEach(m => this.markDirty(m));
    this.dirtyAlbums.add(key);
  }

  /** Junta os arquivos do lote num .zip, aqui mesmo no navegador, e baixa. */
  async zipAlbum(a) {
    if (a.zipping) return;
    const items = this.albumItems(a).filter(x => x.state === 'done' && (x.blob || x.remote));
    if (!items.length) return;
    a.zipping = true;
    const label = text => { a.zipText = text; const l = a.el.querySelector('[data-act="zip"] .lbl'); if (l) l.textContent = text; };
    a.el.querySelector('[data-act="zip"]')?.setAttribute('disabled', '');
    try {
      const entries = [];
      for (const x of items) {
        let blob = x.blob;
        if (!blob) {
          label(t('Baixando {name}', { name: x.name }));
          const r = await fetch(x.remote);
          if (!r.ok) throw new Error(`http ${r.status}`);
          blob = await r.blob();
          if (x.m) x.m.localBlob = blob;
        }
        entries.push({ name: x.name, blob });
      }
      const zip = await makeZip(entries, { onProgress: (d, total) => label(t('Compactando {p}%', { p: total ? Math.floor(d / total * 100) : 100 })) });
      if (window.__p2p === this) this.lastZip = zip;   // só nos testes locais
      this.save(zip, `${this.room}-${items.length}-${t('arquivos')}.zip`);
      toast(t('Zip pronto: {n} arquivos, {size}', { n: items.length, size: bytes(zip.size) }));
    } catch (e) {
      toast(t('Falhou: {why}', { why: e.message || '?' }));
    } finally {
      a.zipping = false;
      a.zipText = null;
      a.sig = '';
      this.renderAlbum(a);
    }
  }

  save(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = name;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  async downloadEach(a) {
    const items = this.albumItems(a).filter(x => x.state === 'done' && (x.download || x.blob));
    for (const x of items) {
      const link = document.createElement('a');
      link.href = x.download || this.objUrl(x.blob); link.download = x.name;
      document.body.appendChild(link); link.click(); link.remove();
      await new Promise(r => setTimeout(r, 400));
    }
  }

  /** Como o visualizador mostra um item agora (arquivo inteiro, prévia desfocada ou progresso). */
  viewItem(id) {
    let x;
    if (id.startsWith('ph:')) {
      const k = id.slice(3, id.lastIndexOf(':'));
      const a = this.albums.get(k);
      x = a && this.albumItems(a)[Number(id.slice(id.lastIndexOf(':') + 1))];
    } else {
      const m = this.cardModels?.get(id) || this.models.get(id);
      x = m && this.itemInfo(m);
    }
    if (!x) return null;
    const ready = x.state === 'done' || (x.mine && !!x.blob);
    const who = x.mine ? t('Você') : x.from || '';
    return {
      id, name: x.name, kind: x.kind, label: x.label,
      src: ready ? x.full : null, poster: x.preview || x.thumb, blur: !x.preview,
      status: ready ? '' : this.stateText(x),
      href: !x.mine && x.state === 'done' ? x.download || null : null, download: x.name,
      meta: [who, bytes(x.size)].filter(Boolean).join(' · ')
    };
  }

  /** Bloco de velocidade: gráfico + velocidade atual + quanto falta. */
  liveHTML(meter, stats, size, tr) {
    const graph = meter ? meter.svg() : new SpeedMeter().svg();
    const speed = meter ? meter.speed : 0;
    const pct = size ? Math.min(100, stats.raw / size * 100) : 0;
    const rawSpeed = stats.net > 0 ? speed * (stats.raw / stats.net) : speed;
    const left = rawSpeed > 1 ? duration((size - stats.raw) / rawSpeed * 1000) : '';
    const blocks = tr && tr.blocks ? ` · ${esc(t('bloco {n} de {total}', { n: Math.min(tr.blocks, (tr.dir === 'out' ? tr.acked : tr.written) + 1), total: tr.blocks }))}` : '';
    return `<div class="speedgraph">${graph}</div>
      <div class="bline"><span><span class="big tnum">${pct < 10 ? pct.toFixed(1) : Math.floor(pct)}%</span> <span class="tnum">${esc(t('{done} de {total}', { done: bytes(stats.raw), total: bytes(size) }))}${blocks}</span></span><span class="tnum"><b>${esc(bytes(speed))}/s</b>${left ? ` · ${esc(t('faltam {t}', { t: left }))}` : ''}</span></div>`;
  }

  live() {
    for (const [, entry] of this.cards) {
      const m = entry.model;
      if (!m) continue;
      let src = null, size = 0, tr = null;
      if (m.kind === 'cloud-out') { if (m.up.state === 'uploading') { src = m.up; size = m.up.size; } }
      else if (m.dir && ['sending', 'receiving', 'interrupted', 'paused', 'stalled', 'waiting'].includes(m.state)) { src = m; size = m.size; tr = m; }
      else if (m.kind === 'stored' && m.tr && ['receiving', 'stalled'].includes(m.tr.state)) { src = m.tr; size = m.size; tr = m.tr; }
      if (!src) continue;
      const stats = src.liveStats();
      entry.meter ||= new SpeedMeter();
      entry.meter.sample(stats.net, size ? stats.raw / size : 0);
      const box = entry.el.querySelector('.live');
      if (box) box.innerHTML = this.liveHTML(entry.meter, stats, size, tr);
      const it = this.itemInfo(m);
      this.updateRings(entry.el, [it]);
      this.setComp(entry.el, it);
    }
    for (const a of this.albums.values()) if (a.active) this.liveAlbum(a);
    this.viewer?.refresh();
    for (const [id, up] of this.uploads) {
      if (up.state !== 'uploading') continue;
      let meter = this.upMeters.get(id);
      if (!meter) { meter = new SpeedMeter(); this.upMeters.set(id, meter); }
      const stats = up.liveStats();
      meter.sample(stats.net, up.size ? stats.raw / up.size : 0);
      const box = document.querySelector(`[data-up="${CSS.escape(id)}"]`);
      if (box) box.innerHTML = this.liveHTML(meter, stats, up.size);
      const row = box?.closest('li');
      if (row) this.setComp(row, { comp: { raw: up.producedRaw, wire: up.producedWire, codec: up.gzip ? 'gzip' : 'none' } });
    }
  }

  onCardAction(e, id) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const m = this.cards.get(id)?.model;
    if (!m) return;
    const act = b.dataset.act;
    if (act === 'view' && m.kind === 'stored' && !this.storedInfo(m).blob && !m.tr) { this.requestFile(m.fid); return; }
    if (act === 'view') { this.used(m); this.viewer.openWith([id], 0, b); return; }
    if (act === 'fetch') { this.requestFile(m.fid); return; }
    if (act === 'forget') { this.forgetEl(this.cards.get(id).el); return; }
    if (act === 'cancel' && m.kind === 'stored') { m.wanted = null; m.tr?.cancel(); m.tr = null; this.markDirty(m); return; }
    if (act === 'cancel') m.cancel?.();
    else if (act === 'pause') m.pause?.();
    else if (act === 'unpause') m.unpause?.();
    else if (act === 'retry') { this.mesh.links.get(m.peerId)?.recreate('manual'); this.client.nudge(); }
    else if (act === 'to-cloud') this.moveToCloud(m);
    else if (act === 'store' && (m.blob || m.kind === 'stored')) { const it = this.itemInfo(m); if (it.blob) { this.used(m); this.storeInRoom(new File([it.blob], it.name, { type: it.type })); } }
    else if (act === 'cloud-cancel') { m.up.abort(); if (m.tr) m.tr.state = 'cancelled'; }
    this.markDirty(m);
  }

  logTerminal(m) {
    if (m.logged) return;
    const name = this.peers.get(m.peerId)?.name || m.peerName || '';
    const path = this.cardPath(m);
    if (m.dir === 'out' && m.state === 'done') { m.logged = true; hist.logEvent({ type: 'sent', room: this.room, file: m.name, size: m.size, to: name, path, ms: m.finishedAt - (m.startedAt || m.createdAt) }); }
    if (m.dir === 'in' && m.state === 'done') { m.logged = true; hist.logEvent({ type: 'received', room: this.room, file: m.name, size: m.size, from: name, path, ms: m.finishedAt - m.startedAt }); this.notify(); }
    if ((m.dir === 'out' || m.dir === 'in') && m.state === 'cancelled') { m.logged = true; hist.logEvent({ type: 'cancelled', room: this.room, file: m.name, size: m.size, path }); }
    if ((m.dir === 'out' || m.dir === 'in') && m.state === 'failed') { m.logged = true; hist.logEvent({ type: 'failed', room: this.room, file: m.name, size: m.size, path }); }
  }

  async updateWakeLock() {
    const busy = [...this.transfers.out.values(), ...this.transfers.inc.values()].some(x => ['sending', 'receiving'].includes(x.state));
    try {
      if (busy && !this.wakeLock && navigator.wakeLock && document.visibilityState === 'visible') this.wakeLock = await navigator.wakeLock.request('screen');
      if (!busy && this.wakeLock) { await this.wakeLock.release(); this.wakeLock = null; }
    } catch { this.wakeLock = null; }
  }

  // ----- cofre: a conversa continua neste aparelho depois de recarregar -----
  async restore() {
    await vault.seen(this.room);
    const [forgot, have, posts] = await Promise.all([vault.forgotten(this.room), vault.haves(this.room), vault.posts(this.room)]);
    if (this.destroyed) return;
    forgot.forEach(id => this.forgot.add(id));
    have.forEach((v, k) => this.localHave.set(k, v));
    $$('#feed .msg').forEach(el => { if (this.forgot.has(el.dataset.id)) el.remove(); });
    for (const p of posts) this.showPost(p);
    this.updateEmpty();
  }

  /** Mostra um cartão do cofre: com o arquivo, se está aqui; sem ele, com o botão para pedir a quem tem. */
  showPost(post) {
    if (!post || this.forgot.has(post.id)) return;
    this.posts.set(post.id, post);
    const mine = post.from.deviceId === this.me.deviceId;
    const n = post.items.length;
    post.items.forEach((x, i) => {
      if (!x?.fid) return;
      const old = this.stored.get(x.fid);
      if (old) {
        if (!old.thumb && x.thumb) { old.thumb = x.thumb; old.media ||= x.media; this.markDirty(old); }
        if (x.cloud) old.cloud = x.cloud;
        return;
      }
      if (this.liveFids.has(x.fid)) return;
      const m = {
        kind: 'stored', id: `s-${x.fid}`, fid: x.fid, postId: post.id, ts: post.ts, name: x.name, size: x.size, type: x.type,
        thumb: x.thumb, media: x.media, cloud: x.cloud || null, cloudFile: null, mine, from: post.from.name, fromPeer: post.from.peerId,
        batch: n > 1 ? { id: post.id, i, n, items: post.items } : null, blob: null, tr: null, wanted: null, loading: this.localHave.has(x.fid)
      };
      this.stored.set(x.fid, m);
      if (m.loading) {
        vault.fileOf(x.fid).then(b => {
          m.loading = false;
          if (b) m.blob = b; else this.localHave.delete(x.fid);
          this.markDirty(m);
        });
      }
      this.markDirty(m);
    });
  }

  storedInfo(m) {
    const tr = m.tr && !['cancelled', 'failed'].includes(m.tr.state) ? m.tr : null;
    const blob = m.blob || (tr?.state === 'done' ? tr.blob : null);
    let state;
    if (blob) state = 'done';
    else if (tr) state = tr.state === 'stalled' ? 'stalled' : 'active';
    else if (m.wanted) state = 'waiting';
    else if (m.loading) state = 'loading';
    else state = 'missing';
    const full = blob ? this.objUrl(blob) : null;
    return {
      id: m.id, m, name: m.name, size: m.size, type: m.type, kind: kindOf(m.type, m.name), state, mine: m.mine, blob, remote: null, full,
      preview: blob ? previewUrl(blob, m.type, m.name, () => this.touch(m)) : null, thumb: m.thumb || null, media: m.media || null,
      progress: blob ? 1 : tr && m.size ? Math.min(1, tr.liveStats().raw / m.size) : 0,
      comp: tr ? { raw: tr.done, wire: tr.wireDone, codec: tr.codec, final: state === 'done' } : null,
      intact: tr ? tr.intact : !!this.localHave.get(m.fid)?.intact, label: ext(m.name), download: full, from: m.from, available: this.canFetch(m)
    };
  }

  canFetch(m) {
    return [...(this.peerHas.get(m.fid) || [])].some(p => this.peers.has(p)) || !!(m.cloudFile || (m.cloud && this.files.has(m.cloud)));
  }

  storedCardHTML(m, top, btn, forget) {
    const it = this.storedInfo(m);
    const who = m.mine ? esc(t('Enviado por você')) : t('De {name}', { name: `<b>${esc(m.from)}</b>` });
    let body = '';
    if (it.state === 'done') {
      body = `<div class="acts"><a class="btn solid sm" href="${esc(it.full)}" download="${esc(m.name)}">${ICON.down}${esc(t('Salvar arquivo'))}</a>${btn('store', t('Guardar na sala'), 'quiet')}${forget}</div>`;
    } else if (it.state === 'active' || it.state === 'stalled') {
      body = `<div class="live">${this.liveHTML(this.cards.get(m.id)?.meter, m.tr.liveStats(), m.size, m.tr)}</div><div class="acts">${btn('cancel', t('Cancelar'), 'quiet')}</div>`;
    } else if (it.state === 'waiting') {
      const text = m.wanted === 'cloud' ? t('Baixando da nuvem') : t('Pedindo a {name}', { name: this.peers.get(m.wanted)?.name || '' });
      body = `<div class="ok-note">${esc(text)}</div>${m.wanted === 'cloud' ? '' : `<div class="acts">${btn('cancel', t('Cancelar'), 'quiet')}</div>`}`;
    } else if (it.state === 'missing') {
      body = it.available
        ? `<div class="acts">${btn('fetch', t('Baixar'), 'solid')}${forget}</div>`
        : `<div class="ok-note">${esc(t('Não está neste aparelho, e nenhum aparelho com ele está na sala agora.'))}</div><div class="acts">${forget}</div>`;
    }
    return top(m.name, m.size, who, this.cardPath(m)) + body;
  }

  storedByCloud(fileId) {
    for (const m of this.stored.values()) if (m.cloud === fileId) return m;
    return null;
  }

  /** Abrir, salvar, compactar ou mandar para outro aparelho renova o prazo do arquivo neste aparelho. */
  used(m) {
    const fid = m?.fid || m?.tr?.fid;
    if (fid && this.localHave.has(fid)) vault.touchFile(fid);
  }

  /** Guarda o que foi enviado: o cartão e uma cópia de cada arquivo, para continuar aqui e outros pedirem depois. */
  async keepSent(post, files, fids, metas) {
    files.forEach((f, i) => this.localFiles.set(fids[i], f));
    const ms = await Promise.all(metas.map(p => Promise.resolve(p).catch(() => null)));
    const saved = await vault.putPost({
      ...post,
      items: files.map((f, i) => ({ fid: fids[i], name: f.name, size: f.size, type: f.type || '', thumb: i < 12 ? ms[i]?.thumb || null : null, media: ms[i]?.media || null }))
    });
    if (saved) this.posts.set(saved.id, saved);
    for (let i = 0; i < files.length; i++) {
      if (this.destroyed || this.forgot.has(post.id)) return;
      const f = files[i];
      if (await vault.keepFile(fids[i], this.room, f, { name: f.name, type: f.type, size: f.size, intact: true })) {
        this.localHave.set(fids[i], { intact: true });
        this.announce('have', [fids[i]]);
      }
    }
  }

  /** Guarda o que chegou direto: o cartão (com o lote inteiro) e o arquivo, que já está no disco do navegador. */
  async keepReceived(m, requested) {
    const peer = this.peers.get(m.peerId);
    const b = m.batch && m.batch.n > 1 ? m.batch : null;
    const pid = m.post?.id || (b ? b.id : m.fid);
    if (this.forgot.has(pid)) return;
    if (!requested) {
      const one = { fid: m.fid, name: m.name, size: m.size, type: m.type, thumb: m.thumb, media: m.media };
      const items = b ? Array.from({ length: b.n }, (_, i) => ({ ...(b.items?.[i] || { name: '…' }), fid: b.fids?.[i] || null })) : [one];
      if (b) items[b.i] = { ...items[b.i], ...one, thumb: items[b.i].thumb || m.thumb };
      const saved = await vault.putPost({
        id: pid, room: this.room, ts: m.post?.ts || m.startedAt,
        from: { peerId: m.peerId, deviceId: peer?.deviceId || '', name: peer?.name || m.peerName || '' },
        to: m.post?.priv ? [this.me.deviceId, peer?.deviceId].filter(Boolean) : null, items
      });
      if (saved) this.posts.set(saved.id, saved);
    }
    const ok = await vault.keepFile(m.fid, this.room, m.disk ? { disk: m.disk } : m.blob, { name: m.name, type: m.type, size: m.size, intact: m.intact });
    if (ok) { this.localHave.set(m.fid, { intact: m.intact }); this.announce('have', [m.fid]); }
  }

  /** Chegou pela nuvem da sala: o cartão fica no cofre apontando para lá (o arquivo só vem quando baixar). */
  async keepCloudPost(model, extra) {
    const b = cleanBatch(extra.batch);
    const pp = extra.post && /^[A-Za-z0-9_-]{1,32}$/.test(String(extra.post.id || '')) ? extra.post : null;
    const multi = b && b.n > 1 ? b : null;
    const pid = pp?.id || (multi ? multi.id : model.fid);
    if (this.forgot.has(pid)) return;
    const f = model.file;
    const one = { fid: model.fid, cloud: f.id, name: f.name, size: f.size, type: f.type, thumb: model.thumb, media: model.media };
    const items = multi ? Array.from({ length: multi.n }, (_, i) => ({ ...(multi.items?.[i] || { name: '…' }), fid: multi.fids?.[i] || null })) : [one];
    if (multi) items[multi.i] = { ...items[multi.i], ...one };
    const peer = this.peers.get(model.fromPeer);
    const saved = await vault.putPost({
      id: pid, room: this.room, ts: +pp?.ts || Date.now(), from: { peerId: model.fromPeer, deviceId: peer?.deviceId || '', name: model.from },
      to: pp?.priv ? [this.me.deviceId, peer?.deviceId].filter(Boolean) : null, items
    });
    if (saved) this.posts.set(saved.id, saved);
  }

  /** Pede o arquivo de um cartão a um aparelho da sala que tem (de preferência com conexão direta). */
  requestFile(fid, { quiet = false } = {}) {
    const m = this.stored.get(fid);
    if (!m || m.blob || m.wanted || (m.tr && !['cancelled', 'failed'].includes(m.tr.state))) return;
    m.tr = null;
    const rank = p => ({ direct: 0, relay: 1 })[this.mesh.path(p)] ?? 2;
    const cands = [...(this.peerHas.get(fid) || [])].filter(p => this.peers.has(p) && this.mesh.isOpen(p)).sort((a, b) => rank(a) - rank(b));
    if (!cands.length) {
      const cf = m.cloudFile || (m.cloud && this.files.get(m.cloud));
      if (cf) { this.fetchFromCloud(m, cf); return; }
      if (!quiet) toast(t('Nenhum aparelho com este arquivo está na sala agora.'));
      this.markDirty(m);
      return;
    }
    const pid = cands[0];
    m.wanted = pid;
    this.mesh.send(pid, JSON.stringify({ x: 'want', fid }));
    this.markDirty(m);
    setTimeout(() => {
      if (m.wanted !== pid || m.tr) return;
      m.wanted = null;
      this.markDirty(m);
      if (!quiet) toast(t('{name} não respondeu. Tente de novo.', { name: this.peers.get(pid)?.name || '' }));
    }, 20000);
  }

  async fetchFromCloud(m, f) {
    m.wanted = 'cloud';
    this.markDirty(m);
    try {
      const r = await fetch(downloadUrl(this.client, f.id));
      if (!r.ok) throw new Error(`http ${r.status}`);
      const blob = new Blob([await r.blob()], { type: m.type || '' });
      m.blob = blob;
      if (await vault.keepFile(m.fid, this.room, blob, { name: m.name, type: m.type, size: m.size })) {
        this.localHave.set(m.fid, { intact: false });
        this.announce('have', [m.fid]);
      }
    } catch (e) {
      toast(t('Falhou: {why}', { why: e.message || '?' }));
    }
    m.wanted = null;
    this.markDirty(m);
  }

  /** Mensagens do cofre pelo canal direto: cartões, quem tem o quê e pedidos de arquivo. */
  onVaultMsg(pid, msg) {
    if (!msg || typeof msg.x !== 'string') return;
    const okId = f => /^[A-Za-z0-9_-]{1,32}$/.test(String(f || ''));
    switch (msg.x) {
      case 'posts': if (Array.isArray(msg.posts)) this.takePosts(pid, msg.posts); return;
      case 'have': case 'drop': {
        const fids = Array.isArray(msg.fids) ? msg.fids.filter(okId).slice(0, 5000) : [];
        for (const f of fids) {
          let set = this.peerHas.get(f);
          if (msg.x === 'have') { if (!set) this.peerHas.set(f, set = new Set()); set.add(pid); } else set?.delete(pid);
          const m = this.stored.get(f);
          if (m) this.markDirty(m);
        }
        return;
      }
      case 'want': if (okId(msg.fid)) this.serve(pid, String(msg.fid)); return;
      case 'nofile': {
        if (!okId(msg.fid)) return;
        const f = String(msg.fid);
        this.peerHas.get(f)?.delete(pid);
        const m = this.stored.get(f);
        if (m && m.wanted === pid) { m.wanted = null; this.requestFile(f); }
        return;
      }
      default:
    }
  }

  async takePosts(pid, list) {
    await this.vaultReady;
    for (const raw of list.slice(0, 500)) {
      if (this.destroyed) return;
      const p = vault.cleanPost({ ...raw, room: this.room });
      if (!p || this.forgot.has(p.id)) continue;
      // Cartão mandado só para alguns aparelhos: fica só com eles.
      if (p.to && !p.to.includes(this.me.deviceId)) continue;
      // "Enviado por você" só vale para o que este aparelho já conhece.
      if (p.from.deviceId === this.me.deviceId && !this.posts.has(p.id)) continue;
      const saved = await vault.putPost(p);
      if (saved && !this.destroyed) this.showPost(saved);
    }
    this.updateEmpty();
  }

  /** Quem pode ver o cartão deste arquivo: todos, ou só os aparelhos para quem foi mandado. */
  shareable(fid, deviceId) {
    for (const p of this.posts.values()) {
      if (!p.items.some(x => x?.fid === fid)) continue;
      if (this.forgot.has(p.id)) return false;
      return !p.to || p.to.includes(deviceId) || p.from.deviceId === deviceId;
    }
    return false;
  }

  /** Conexão direta abriu: conta os cartões e os arquivos que este aparelho tem (quem entrou depois vê a conversa toda). */
  async syncTo(pid) {
    await this.vaultReady;
    if (this.destroyed || !this.mesh.isOpen(pid)) return;
    const dev = this.peers.get(pid)?.deviceId;
    const list = [...this.posts.values()].filter(p => !this.forgot.has(p.id) && (!p.to || p.to.includes(dev) || p.from.deviceId === dev));
    let chunk = [], size = 0;
    const flush = () => { if (chunk.length) this.mesh.send(pid, JSON.stringify({ x: 'posts', posts: chunk })); chunk = []; size = 0; };
    for (const p of list) {
      const n = JSON.stringify(p).length;
      if (n > 180000) continue;
      if (size + n > 180000) flush();
      chunk.push(p);
      size += n;
    }
    flush();
    const fids = [...new Set([...this.localHave.keys(), ...this.localFiles.keys()])].filter(f => this.shareable(f, dev));
    if (fids.length) this.mesh.send(pid, JSON.stringify({ x: 'have', fids }));
  }

  announce(kind, fids) {
    if (!fids.length) return;
    for (const [pid, p] of this.peers) {
      if (!this.mesh.isOpen(pid)) continue;
      const list = kind === 'drop' ? fids : fids.filter(f => this.shareable(f, p.deviceId));
      if (list.length) this.mesh.send(pid, JSON.stringify({ x: kind, fids: list }));
    }
  }

  peerGone(pid) {
    for (const [f, set] of this.peerHas) {
      if (!set.delete(pid)) continue;
      const m = this.stored.get(f);
      if (m) this.markDirty(m);
    }
    for (const m of this.stored.values()) if (m.wanted === pid) { m.wanted = null; this.markDirty(m); }
  }

  /** Outro aparelho pediu um arquivo de um cartão: manda direto, sem criar cartão novo aqui. */
  async serve(pid, fid) {
    const peer = this.peers.get(pid);
    const post = [...this.posts.values()].find(p => p.items.some(x => x?.fid === fid));
    const item = post?.items.find(x => x?.fid === fid);
    const busy = [...this.transfers.out.values()].some(x => x.serve && x.fid === fid && x.peerId === pid && !['done', 'failed', 'cancelled'].includes(x.state));
    if (busy) return;
    const ok = post && peer && this.shareable(fid, peer.deviceId);
    let blob = ok ? this.localFiles.get(fid) || null : null;
    if (ok && !blob) blob = await vault.fileOf(fid, { touch: true });
    else if (blob) vault.touchFile(fid);
    if (!blob || this.destroyed) { this.mesh.send(pid, JSON.stringify({ x: 'nofile', fid })); return; }
    const file = new File([blob], item.name, { type: item.type || blob.type || '' });
    this.transfers.send(file, pid, {
      peerName: peer.name, fid, serve: true, post: { id: post.id, ts: post.ts, priv: !!post.to },
      meta: Promise.resolve({ thumb: item.thumb || null, media: item.media || null, batch: null })
    });
  }

  /** Esquecer neste aparelho: some da conversa, os arquivos são apagados daqui e não voltam por outros aparelhos. */
  async forgetEl(el) {
    if (!el) return;
    let ids = [], fids = [];
    const busy = () => toast(t('Espere terminar ou cancele antes de remover.'));
    if (el.matches('.msg')) ids = [el.dataset.id];
    else if (el.dataset.card) {
      const id = el.dataset.card;
      const m = this.cards.get(id)?.model;
      if (!m) return;
      if (['active', 'waiting', 'queued'].includes(this.itemInfo(m).state)) { busy(); return; }
      const fid = m.fid || null;
      ids = [m.kind === 'stored' ? m.postId : m.post?.id || (m.batch?.n > 1 ? m.batch.id : fid)].filter(Boolean);
      fids = [fid].filter(Boolean);
      this.cards.delete(id);
    } else if (el.dataset.album) {
      const a = this.albums.get(el.dataset.album);
      if (!a) return;
      const items = this.albumItems(a);
      if (items.some(x => ['active', 'waiting'].includes(x.state) && !x.placeholder)) { busy(); return; }
      const ms = items.map(x => x.m).filter(Boolean);
      const first = ms[0];
      const pid = first?.kind === 'stored' ? first.postId : first?.post?.id || first?.batch?.id;
      ids = [pid].filter(Boolean);
      fids = ms.map(m => m.fid).filter(Boolean);
      const post = this.posts.get(pid);
      if (post) fids.push(...post.items.map(x => x?.fid).filter(Boolean));
      this.albums.delete(a.key);
      ms.forEach(m => this.albumOf.delete(m.id));
    } else return;
    fids = [...new Set(fids)];
    ids.forEach(id => { this.forgot.add(id); this.posts.delete(id); });
    fids.forEach(f => { this.stored.delete(f); this.localFiles.delete(f); this.localHave.delete(f); });
    el.remove();
    this.updateEmpty();
    await vault.forget(this.room, ids, fids);
    this.announce('drop', fids);
    toast(t('Removido deste aparelho'));
  }

  /** "Apagar tudo" da sala: some também tudo o que este aparelho guardava dela. */
  wipeLocal() {
    vault.forgetRoom(this.room);
    for (const m of this.stored.values()) { this.cards.get(m.id)?.el.remove(); this.cards.delete(m.id); }
    for (const [k, a] of this.albums) if (a.stored) { a.el.remove(); this.albums.delete(k); }
    this.announce('drop', [...this.localHave.keys()]);
    this.stored.clear(); this.posts.clear(); this.localHave.clear(); this.localFiles.clear(); this.forgot.clear();
  }

  // ----- QR, uso, configurações -----
  showQR() {
    const box = $('#qr-box');
    if (!box.firstChild) box.innerHTML = this.qr();
    $('#qr-dialog').showModal();
  }
  qr() { return (this.qrCache ||= qrSVG(shareUrl(this.room))); }

  async loadUsage() {
    try {
      const r = await fetch(`${WORKER_URL}/api/usage`, { cache: 'no-store' });
      if (!r.ok) return;
      this.usage = await r.json();
      this.usageFetchedAt = Date.now();
      this.renderUsageChip();
      if ($('#usage-dialog')?.open) this.renderMeters();
    } catch { /* sem servidor: tenta de novo em 1 min */ }
  }

  topMeter() {
    if (!this.usage) return null;
    const ms = this.usage.meters.filter(m => m.limit);
    const top = [...ms].sort((a, b) => b.pct - a.pct || (b.resetAt ? 1 : 0) - (a.resetAt ? 1 : 0))[0];
    if (!top) return null;
    // Sempre mostra quando é o próximo reset, mesmo que o mais usado seja o espaço (que não reseta).
    const resetAt = top.resetAt || Math.min(...ms.filter(m => m.resetAt).map(m => m.resetAt));
    return { ...top, resetAt: Number.isFinite(resetAt) ? resetAt : null };
  }

  renderUsageChip() {
    const chip = $('#usage-chip');
    const m = this.topMeter();
    if (!chip || !m) return;
    const pct = m.pct * 100;
    const SHORT = { storage: t('Nuvem'), r2ClassA: t('Gravações'), r2ClassB: t('Leituras'), workers: t('Servidor'), durableObjects: t('Salas'), turn: t('Relay') };
    chip.hidden = false;
    chip.className = `usage-chip${pct >= 90 ? ' high' : pct >= 60 ? ' mid' : ''}`;
    chip.title = `${m.label}: ${Math.round(pct)}% · ${m.resetAt ? t('reset em {t}', { t: countdown(m.resetAt - Date.now()) }) : t('sem reset')}`;
    chip.innerHTML = `<span class="gauge"><i style="width:${Math.min(100, Math.max(2, pct)).toFixed(0)}%"></i></span><span class="lbl">${esc(SHORT[m.id] || m.label)}</span> <b class="tnum">${pct < 1 && pct > 0 ? '<1' : Math.round(pct)}%</b>`;
  }

  renderMeters() {
    const box = $('#meters');
    if (!box || !this.usage) return;
    const fmt = (m, v) => m.unit === 'bytes' ? bytes(v) : count(v);
    box.innerHTML = this.usage.meters.map(m => {
      const pct = m.pct * 100;
      return `<div class="meter${pct >= 90 ? ' high' : pct >= 60 ? ' mid' : ''}">
        <div class="top"><b>${esc(m.label)}</b><span class="tnum">${pct < 1 && pct > 0 ? '<1' : Math.round(pct)}%</span></div>
        <div class="mbar"><i style="width:${Math.min(100, pct).toFixed(1)}%"></i></div>
        <div class="sub"><span class="tnum">${esc(fmt(m, m.used))} / ${esc(fmt(m, m.limit))}</span><span class="tnum" data-reset="${m.resetAt || ''}">${esc(m.resetAt ? t('reset em {t}', { t: countdown(m.resetAt - Date.now()) }) : t('Libera conforme os arquivos expiram.'))}</span></div>
      </div>`;
    }).join('');
    $('#usage-note').textContent = this.usage.analytics ? '' : t('Estimativa local. Configure o token de analytics para números exatos.');
  }

  tick() {
    $$('#meters [data-reset]').forEach(s => { const r = Number(s.dataset.reset); if (r) s.textContent = t('reset em {t}', { t: countdown(r - Date.now()) }); });
    if (this.downSince || this.client.state !== 'open') this.renderNet();
  }

  openSettings() {
    this.renderSettings();
    applyTheme(getTheme());
    $('#wipe-err').hidden = true;
    $('#admin-pw').value = '';
    $('#pw-new').value = '';
    const d = $('#settings-dialog');
    if (!this.settingsWired) {
      this.settingsWired = true;
      $('#pw-form').addEventListener('submit', e => {
        e.preventDefault();
        const pw = $('#pw-new').value;
        if (!pw) { $('#pw-new').focus(); return; }
        this.client.send({ t: 'set-password', password: pw });
        this.client.password = pw;
        save(PW_KEY(this.room), null);
        save(PW_KEY(this.room), pw, 'session');
        $('#pw-new').value = '';
      });
      $('#pw-remove').addEventListener('click', () => {
        this.client.send({ t: 'set-password', password: '' });
        this.client.password = null;
        save(PW_KEY(this.room), null);
        save(PW_KEY(this.room), null, 'session');
      });
      $('#wipe-form').addEventListener('submit', e => {
        e.preventDefault();
        $('#wipe-err').hidden = true;
        const pw = $('#admin-pw').value;
        if (!pw) { $('#admin-pw').focus(); return; }
        this.client.send({ t: 'wipe', adminPassword: pw });
      });
    }
    d.showModal();
  }

  renderSettings() {
    const st = $('#pw-status');
    if (!st) return;
    st.textContent = this.protected ? t('Com senha. Quem entrar precisa digitar a senha.') : t('Sem senha. Qualquer um com o link entra.');
    $('#pw-save').textContent = this.protected ? t('Trocar senha') : t('Definir senha');
    $('#pw-remove').hidden = !this.protected;
  }

  destroy() {
    this.destroyed = true;
    hist.logEvent({ type: 'leave', room: this.room, name: this.me.name, self: true });
    this.timers.forEach(clearInterval);
    this.cleanups.forEach(f => f());
    clearInterval(this.transfers.tick);
    this.mesh.close();
    this.client.close();
    try { this.codec.w?.terminate(); } catch { /* ok */ }
    this.viewer.destroy();
    this.wakeLock?.release?.().catch(() => {});
    nextReady?.then(m => m?.offRoom(this));
  }
}

// Limpeza do cofre e das sobras de recebimentos: na abertura e de hora em hora.
const sweep = () => vault.sweep().then(keep => cleanupOld(keep)).catch(() => {});
sweep();
setInterval(sweep, 3600 * 1000);
if (['localhost', '127.0.0.1'].includes(location.hostname)) window.__vault = vault;
route();
