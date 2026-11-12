// Controlador da interface: início, sala e histórico.
import { WORKER_URL, PAGE_URL, APP, KEY } from './config.js?v=202611121948';
import { t, bytes, count, duration, time, dayLabel, countdown, LANG } from './i18n.js?v=202611121948';
import { getMe, setMyName, randomId, randomRoomName, normalizeRoom, roomFromLocation, isHistoryRoute, load, save } from './device.js?v=202611121948';
import { RoomClient } from './room-client.js?v=202611121948';
import { Mesh } from './mesh.js?v=202611121948';
import { Codec, Transfers } from './transfer.js?v=202611121948';
import { CloudUpload, downloadUrl } from './cloud.js?v=202611121948';
import { cleanupOld } from './storage.js?v=202611121948';
import { SpeedMeter } from './speed.js?v=202611121948';
import * as hist from './history.js?v=202611121948';

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
  history: svg('<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5M12 8v4l3 2"/>')
};
const MARK = `<svg class="mark" viewBox="0 0 30 18" aria-hidden="true"><line class="l" x1="9" y1="9" x2="21" y2="9"/><circle class="a" cx="7" cy="9" r="6"/><circle class="b" cx="23.5" cy="9" r="4.8"/></svg>`;

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
  $$('meta[name="theme-color"]').forEach(m => { m.content = dark ? '#121b2b' : '#ffffff'; m.removeAttribute('media'); });
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
  applyTheme(th);
  $$('[data-theme-toggle]').forEach(x => { x.outerHTML = themeButton(); });
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
  route();
}

document.addEventListener('click', e => {
  const a = e.target.closest('a[data-nav]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  navigate(a.getAttribute('href'));
});

// ---------- rotas ----------
let current = null;
function route() {
  if (current) { current.destroy(); current = null; }
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
        ${heroViz()}
      </div>
      <div class="paths">
        <div><h3 class="direct"><i class="trace direct"></i><span style="color:var(--ink)">${esc(t('Direto'))}</span></h3><p>${esc(t('Os arquivos vão de um aparelho para o outro, sem passar por servidor. É o caminho mais rápido.'))}</p></div>
        <div><h3 class="relay"><i class="trace relay"></i><span style="color:var(--ink)">${esc(t('Relay'))}</span></h3><p>${esc(t('Quando a rede bloqueia a conexão direta, a Cloudflare repassa os dados sem guardar nada.'))}</p></div>
        <div><h3 class="server"><i class="trace server"></i><span style="color:var(--ink)">${esc(t('Nuvem'))}</span></h3><p>${esc(t('Sem nenhum dos dois, o arquivo fica guardado na sala por 48 h para quem baixar depois.'))}</p></div>
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
    this.cards = new Map();          // id → { el, model }
    this.msgIds = new Set();
    this.delivered = new Set();
    this.dirty = new Set();
    this.unread = 0;
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
        <button role="tab" data-tab="feed">${esc(t('Conversa'))}<span class="dot" id="feed-dot" hidden></span></button>
        <button role="tab" data-tab="devices">${esc(t('Aparelhos'))}<span class="count tnum" id="dev-count">1</span></button>
        <button role="tab" data-tab="files">${esc(t('Guardados'))}<span class="count tnum" id="file-count">0</span></button>
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
    <dialog id="qr-dialog">
      <div class="dlg-head"><div><h3>${esc(t('Convidar para a sala'))}</h3><p>${esc(t('Quem abrir este endereço entra na sala.'))}</p></div><form method="dialog"><button class="btn quiet icon sm" aria-label="${esc(t('Fechar'))}">${ICON.x}</button></form></div>
      <div class="share-grid"><div class="qrbox" id="qr-box"></div>
        <div class="share-side"><div class="qr-url">${esc(shareUrl(this.room))}</div>
          <button class="btn solid" type="button" id="copy-link">${ICON.copy}${esc(t('Copiar link'))}</button>
          <button class="btn line" type="button" id="native-share" hidden>${ICON.share}${esc(t('Compartilhar'))}</button>
          <p style="margin:0;font-size:13px">${esc(t('No celular, aponte a câmera para o código.'))}</p></div></div>
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
        overlay.innerHTML = `<div><b>${esc(t('Solte para enviar'))}</b><span>${esc(n ? t('Vai para quem estiver selecionado no campo de envio.') : t('Ninguém mais na sala: fica guardado por 48 h.'))}</span></div>`;
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
      if (toShelf) files.forEach(f => this.storeInRoom(f)); else this.sendFiles(files);
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
      hist.logEvent({ type: 'leave', room: this.room, name: p.name, kind: p.kind });
      this.peersChanged();
    });
    c.addEventListener('peer-update', e => {
      const p = e.detail.peer;
      if (this.peers.has(p.peerId)) { this.peers.set(p.peerId, p); this.peersChanged(); }
    });
    c.addEventListener('chat', e => this.onChat(e.detail.msg));
    c.addEventListener('chat-ack', e => this.markSent(e.detail.id));
    c.addEventListener('file-added', e => { this.files.set(e.detail.file.id, e.detail.file); this.renderShelf(); this.maybeDelivered(e.detail.file); });
    c.addEventListener('file-updated', e => { if (this.files.has(e.detail.file.id)) { this.files.set(e.detail.file.id, e.detail.file); this.renderShelf(); } });
    c.addEventListener('file-removed', e => { this.files.delete(e.detail.fileId); this.renderShelf(); });
    c.addEventListener('room-update', e => {
      this.setProtected(e.detail.protected);
      this.sys(e.detail.protected ? t('Senha definida por {name}', { name: e.detail.by }) : t('Senha removida por {name}', { name: e.detail.by }));
      this.renderSettings();
    });
    c.addEventListener('wiped', e => {
      $$('#feed .msg, #feed .sys').forEach(el => el.remove());
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
    m.addEventListener('data', e => { if (e.detail.msg.x === 'chat' && e.detail.msg.msg) this.onChat(e.detail.msg.msg); });

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
    for (const f of w.files) this.maybeDelivered(f);
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
      return `<li class="device${p.away ? ' away' : ''}">${avatar(p, { lg: true })}<div style="min-width:0"><div class="nm">${esc(p.name)}${self ? `<em>${esc(t('você'))}</em>` : ''}${tab && !self ? `<em>${esc(t('aba {n}', { n: tab }))}</em>` : ''}</div><div class="dt">${ICON[p.kind] || ICON.desktop}${esc(detail)}</div></div>${right}</li>`;
    };
    pane.innerHTML = `<h2 class="sec-title">${esc(t('Na sala'))}<span class="tnum">${peers.length + 1} ${esc(peers.length ? t('aparelhos') : t('aparelho'))}</span></h2>
      <div class="map">${this.mapSVG(peers)}</div>
      <div class="legend"><span><i class="trace direct"></i><span class="lbl">${esc(t('Direto'))}</span></span><span><i class="trace relay"></i><span class="lbl">${esc(t('Relay'))}</span></span><span><i class="trace server"></i><span class="lbl">${esc(t('Nuvem'))}</span></span></div>
      <ul class="devices">${row(this.me, true)}${peers.map(p => row(p, false)).join('')}</ul>
      ${peers.length ? '' : `<div class="invite"><b>${esc(t('Só você por aqui'))}</b>${esc(t('Abra o mesmo endereço em outro aparelho para conectar.'))}<div class="acts"><button class="btn line sm" type="button" id="alone-qr">${ICON.qr}${esc(t('Mostrar QR code'))}</button><button class="btn quiet sm" type="button" id="alone-copy">${ICON.copy}${esc(t('Copiar link'))}</button></div></div>`}`;
    $('#alone-qr')?.addEventListener('click', () => this.showQR());
    $('#alone-copy')?.addEventListener('click', () => copy(shareUrl(this.room), t('Link copiado')));
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
    if (el && el.dataset.state === state) return;
    if (!el) { el = document.createElement('div'); el.id = 'feed-empty'; feed.prepend(el); }
    el.dataset.state = state;
    el.className = `feed-empty${state === 'loading' ? ' loading' : ''}`;
    if (state === 'loading') el.innerHTML = `<p>${esc(t('Entrando na sala'))}</p>`;
    else if (state === 'alone') {
      el.innerHTML = `<div class="qrmini">${qrSVG(shareUrl(this.room))}</div><h2>${esc(t('A sala está pronta'))}</h2>
        <p>${esc(t('Abra o mesmo endereço em outro aparelho, ou aponte a câmera do celular para o código. Arquivos enviados agora ficam guardados por 48 h.'))}</p>
        <div class="acts"><button class="btn solid sm" type="button" data-empty="copy">${ICON.copy}${esc(t('Copiar link'))}</button></div>`;
      el.querySelector('[data-empty="copy"]').addEventListener('click', () => copy(shareUrl(this.room), t('Link copiado')));
    } else {
      const names = [...this.peers.values()].map(p => p.name);
      el.innerHTML = `<h2>${esc(names.length === 1 ? t('Conectado com {name}', { name: names[0] }) : t('{n} aparelhos conectados', { n: names.length + 1 }))}</h2>
        <p>${esc(t('Escreva uma mensagem ou arraste arquivos para cá. Eles vão direto para os outros aparelhos sempre que a rede deixar.'))}</p>`;
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
    feed.appendChild(el);
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
      <div class="row"><div class="body" title="${esc(time(msg.ts))}">${linkify(msg.text)}</div><button class="copy" type="button" aria-label="${esc(t('Copiar'))}" title="${esc(t('Copiar'))}">${ICON.copy}</button></div>`;
    d.querySelector('.copy').addEventListener('click', () => copy(msg.text, t('Copiado')));
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
    for (const f of files) {
      const cloudPeers = targets.filter(p => p.away || (this.mesh.path(p.peerId) === 'server' && !this.mesh.isOpen(p.peerId)));
      for (const p of targets) {
        if (cloudPeers.includes(p)) continue;
        this.transfers.send(f, p.peerId, { peerName: p.name });
      }
      if (cloudPeers.length) this.cloudDeliver(f, cloudPeers);
    }
    if (this.tab !== 'feed' && this.tabsVisible()) this.selectTab('feed');
  }

  /** Envia pela nuvem para aparelhos sem conexão direta. */
  cloudDeliver(file, peers, fromOutgoing) {
    const up = new CloudUpload(this.client, file, { to: peers.length === 1 ? peers[0].peerId : null, byName: this.me.name, byPeer: this.me.peerId });
    const cardId = fromOutgoing ? fromOutgoing.id : `c-${randomId(6)}`;
    const model = { kind: 'cloud-out', id: cardId, up, peers, name: file.name, size: file.size, tr: fromOutgoing };
    this.cardModels = this.cardModels || new Map();
    this.cardModels.set(cardId, model);
    up.addEventListener('update', () => this.markDirty(model));
    this.markDirty(model);
    up.start().then(f => {
      if (!f) return;
      for (const p of peers) {
        this.client.send({ t: 'peer', to: p.peerId, data: { ch: 'app', kind: 'cloud-delivery', fileId: f.id, tid: fromOutgoing?.id || null, name: f.name, size: f.size } }, { queue: true });
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
      const f = this.files.get(data.fileId) || { id: data.fileId, name: data.name, size: data.size };
      this.showDelivered(f, from, data.tid);
    }
  }

  maybeDelivered(file) {
    if (file.to && file.to === this.me.peerId) this.showDelivered(file, file.byPeer, null);
  }

  showDelivered(file, from, tid) {
    if (this.delivered.has(file.id)) return;
    this.delivered.add(file.id);
    const sender = this.peers.get(from)?.name || file.byName || '';
    const model = { kind: 'cloud-in', id: tid || `d-${file.id}`, file, from: sender };
    this.cardModels = this.cardModels || new Map();
    this.cardModels.set(model.id, model);
    this.markDirty(model);
    this.notify();
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
        <div class="live" data-up="${esc(id)}">${this.liveHTML(meter, u.liveStats(), u.size)}</div></li>`;
    }).join('');
    const ttl = this.limits.fileTtlMs || 48 * 3600000;
    const rows = files.map(f => {
      const left = Math.max(0, f.expiresAt - now);
      const h = Math.floor(left / 3600000);
      const low = left < 6 * 3600000;
      return `<li data-id="${esc(f.id)}">
        <div class="top"><span class="ftype">${esc(ext(f.name))}</span><div style="min-width:0"><div class="fname" title="${esc(f.name)}">${esc(f.name)}</div><div class="fmeta"><span class="tnum">${esc(bytes(f.size))}</span><span>${esc(t('por {name}', { name: f.byPeer === this.me.peerId ? t('você') : f.byName }))}</span></div></div>
        <div class="acts"><a class="btn line icon sm" href="${esc(downloadUrl(this.client, f.id))}" aria-label="${esc(t('Baixar {name}', { name: f.name }))}" title="${esc(t('Baixar'))}">${ICON.down}</a><button class="btn quiet icon sm" type="button" data-del="${esc(f.id)}" aria-label="${esc(t('Apagar {name}', { name: f.name }))}" title="${esc(t('Apagar'))}">${ICON.trash}</button></div></div>
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
      this.updateWakeLock();
    });
  }

  renderCard(m) {
    const id = m.id;
    let entry = this.cards.get(id);
    if (!entry) {
      if (m.dir === 'in' && m.state === 'receiving' && !m.notified) { m.notified = true; this.notify(); }
      const el = document.createElement('article');
      el.dataset.card = id;
      el.addEventListener('click', e => this.onCardAction(e, id));
      entry = { el };
      this.cards.set(id, entry);
      this.append(el);
    }
    // Um cartão que virou "nuvem" passa a mostrar o upload ligado a ele.
    const model = this.cardModels?.get(id) || m;
    entry.model = model;
    const path = this.cardPath(model);
    const sig = [model.kind || model.dir, model.state, model.up?.state, path, this.peers.get(model.peerId)?.name].join('|');
    if (entry.sig !== sig) {
      entry.sig = sig;
      entry.el.className = `xfer ${path}${this.isMine(model) ? ' mine' : ''}`;
      entry.el.innerHTML = this.cardHTML(model);
    }
    this.logTerminal(model);
  }

  isMine(m) { return m.dir === 'out' || m.kind === 'cloud-out'; }
  cardPath(m) {
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
    const doneBytes = m.done;
    const note = () => {
      if (out) {
        if (m.codec !== 'none' && m.raw) return t('Comprimido {p}%', { p: Math.max(0, Math.round((1 - m.ratio) * 100)) });
        return m.alreadyCompressed ? t('Sem compressão, já compactado') : t('Sem compressão');
      }
      if (m.codec !== 'none' && m.wire && doneBytes) return t('Comprimido {p}%', { p: Math.max(0, Math.round((1 - m.wire / doneBytes) * 100)) });
      return t('Sem compressão');
    };
    const progress = () => `<div class="live">${this.liveHTML(this.cards.get(m.id)?.meter, m.liveStats(), total, m)}</div>`;
    let body = '';
    switch (m.state) {
      case 'queued': case 'preparing':
        body = `<div class="ok-note">${esc(m.state === 'queued' ? t('Esperando {name} aceitar', { name: peerName(m.peerId) }) : t('Preparando'))}</div><div class="acts">${btn('cancel', t('Cancelar'), 'quiet')}</div>`; break;
      case 'waiting':
        body = `${m.acked ? progress() : ''}<div class="ok-note">${esc(t('Esperando {name} aceitar', { name: peerName(m.peerId) }))}</div><div class="acts">${btn('cancel', t('Cancelar'), 'quiet')}</div>`; break;
      case 'sending': case 'receiving':
        body = `${progress()}<div class="acts">${out ? btn('pause', t('Pausar')) : ''}${btn('cancel', t('Cancelar'), 'quiet')}<span class="bline" style="margin-left:auto;align-self:center"><span>${esc(note())}</span></span></div>`; break;
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
          ? `${graph}<div class="bline">${done(summary)}<span>${esc(note())}</span></div>`
          : `${graph}<div class="bline">${done(summary)}<span>${esc(note())}</span></div><div class="acts"><a class="btn solid sm" href="${esc(m.url)}" download="${esc(m.name)}">${ICON.down}${esc(t('Salvar arquivo'))}</a>${btn('store', t('Guardar na sala'), 'quiet')}</div>`;
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
      if (!src) continue;
      const stats = src.liveStats();
      entry.meter ||= new SpeedMeter();
      entry.meter.sample(stats.net, size ? stats.raw / size : 0);
      const box = entry.el.querySelector('.live');
      if (box) box.innerHTML = this.liveHTML(entry.meter, stats, size, tr);
    }
    for (const [id, up] of this.uploads) {
      if (up.state !== 'uploading') continue;
      let meter = this.upMeters.get(id);
      if (!meter) { meter = new SpeedMeter(); this.upMeters.set(id, meter); }
      const stats = up.liveStats();
      meter.sample(stats.net, up.size ? stats.raw / up.size : 0);
      const box = document.querySelector(`[data-up="${CSS.escape(id)}"]`);
      if (box) box.innerHTML = this.liveHTML(meter, stats, up.size);
    }
  }

  onCardAction(e, id) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const m = this.cards.get(id)?.model;
    if (!m) return;
    const act = b.dataset.act;
    if (act === 'cancel') m.cancel?.();
    else if (act === 'pause') m.pause?.();
    else if (act === 'unpause') m.unpause?.();
    else if (act === 'retry') { this.mesh.links.get(m.peerId)?.recreate('manual'); this.client.nudge(); }
    else if (act === 'to-cloud') this.moveToCloud(m);
    else if (act === 'store' && m.blob) this.storeInRoom(new File([m.blob], m.name, { type: m.type }));
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

  // ----- QR, uso, configurações -----
  showQR() {
    const box = $('#qr-box');
    if (!box.firstChild) box.innerHTML = qrSVG(shareUrl(this.room));
    $('#qr-dialog').showModal();
  }

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
    this.wakeLock?.release?.().catch(() => {});
  }
}

cleanupOld();
route();
