// Identidade deste aparelho: id fixo, nome editável e tipo (celular, tablet, computador).
import { LANG } from './i18n.js?v=202611121948';

export function randomId(bytes = 12) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  let s = '';
  for (const b of a) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function store(kind) {
  try { return kind === 'session' ? sessionStorage : localStorage; } catch { return null; }
}
export function load(key, kind = 'local') {
  try { return store(kind)?.getItem(key) ?? null; } catch { return null; }
}
export function save(key, value, kind = 'local') {
  try {
    if (value === null || value === undefined) store(kind)?.removeItem(key);
    else store(kind)?.setItem(key, value);
  } catch { /* armazenamento bloqueado: segue sem lembrar */ }
}

const PT_ANIMALS = [['Lontra', 'f'], ['Garça', 'f'], ['Tatu', 'm'], ['Coruja', 'f'], ['Capivara', 'f'], ['Arara', 'f'],
  ['Jabuti', 'm'], ['Tucano', 'm'], ['Raposa', 'f'], ['Lobo', 'm'], ['Onça', 'f'], ['Quati', 'm'], ['Sabiá', 'm'], ['Boto', 'm'], ['Mico', 'm'], ['Ema', 'f']];
const PT_COLORS = { m: ['Azul', 'Cinza', 'Laranja', 'Verde', 'Dourado', 'Roxo', 'Branco', 'Ocre', 'Vermelho'],
  f: ['Azul', 'Cinza', 'Laranja', 'Verde', 'Dourada', 'Roxa', 'Branca', 'Ocre', 'Vermelha'] };
const EN_ANIMALS = ['Otter', 'Heron', 'Armadillo', 'Owl', 'Capybara', 'Macaw', 'Tortoise', 'Toucan', 'Fox', 'Wolf', 'Jaguar', 'Coati', 'Thrush', 'Dolphin', 'Marmoset', 'Rhea'];
const EN_COLORS = ['Blue', 'Grey', 'Orange', 'Green', 'Golden', 'Purple', 'White', 'Ochre', 'Red'];
const pick = a => a[Math.floor(Math.random() * a.length)];

export function randomName() {
  if (LANG === 'pt') {
    const [animal, g] = pick(PT_ANIMALS);
    return `${animal} ${pick(PT_COLORS[g])}`;
  }
  return `${pick(EN_COLORS)} ${pick(EN_ANIMALS)}`;
}

export function randomRoomName() {
  const words = LANG === 'pt'
    ? ['lontra', 'garca', 'tatu', 'coruja', 'capivara', 'arara', 'jabuti', 'tucano', 'raposa', 'quati', 'sabia', 'boto']
    : ['otter', 'heron', 'owl', 'capybara', 'macaw', 'toucan', 'fox', 'coati', 'thrush', 'dolphin'];
  const colors = LANG === 'pt' ? ['azul', 'cinza', 'laranja', 'verde', 'ocre', 'lilas', 'rubi'] : ['blue', 'grey', 'orange', 'green', 'ochre', 'lilac', 'ruby'];
  const n = crypto.getRandomValues(new Uint16Array(1))[0] % 9000 + 1000;
  return `${pick(words)}-${pick(colors)}-${n}`;
}

export function detectKind() {
  const ua = navigator.userAgent || '';
  const touch = navigator.maxTouchPoints > 1;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch)) return 'tablet';
  if (/Android/.test(ua) && !/Mobile/.test(ua)) return 'tablet';
  if (/Tablet|PlayBook|Silk/.test(ua)) return 'tablet';
  if (navigator.userAgentData?.mobile) return 'mobile';
  if (/iPhone|iPod|Android|Mobile|IEMobile|Opera Mini/.test(ua)) return 'mobile';
  return 'desktop';
}

export function getMe() {
  let deviceId = load('p2p.device');
  if (!deviceId || deviceId.length < 8) { deviceId = randomId(); save('p2p.device', deviceId); }
  // Um id por aba: recarregar a aba mantém o mesmo participante.
  let peerId = load('p2p.peer', 'session');
  if (!peerId || peerId.length < 8) { peerId = randomId(); save('p2p.peer', peerId, 'session'); }
  let name = load('p2p.name');
  if (!name) { name = randomName(); save('p2p.name', name); }
  return { deviceId, peerId, name, kind: detectKind() };
}

export function setMyName(name) {
  save('p2p.name', name);
}

/** "?Sala 01" → "sala-01". Devolve '' se não sobrar nada válido. */
export function normalizeRoom(raw) {
  let s = String(raw || '');
  try { s = decodeURIComponent(s.replace(/\+/g, ' ')); } catch { /* mantém como veio */ }
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[\s.]+/g, '-').replace(/[^a-z0-9_-]/g, '').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

const RESERVED_HASH = new Set(['historico', 'history', 'inicio', 'home']);

/** Lê a sala do endereço: ?sala01, ?sala=sala01, ?room=sala01 ou #sala01. */
export function roomFromLocation(loc = location) {
  const q = loc.search.slice(1);
  if (q) {
    for (const part of q.split('&')) {
      if (!part) continue;
      const i = part.indexOf('=');
      if (i === -1) { const r = normalizeRoom(part); if (r) return r; continue; }
      const k = part.slice(0, i).toLowerCase();
      if (['sala', 'room', 'r'].includes(k)) { const r = normalizeRoom(part.slice(i + 1)); if (r) return r; }
    }
  }
  const h = loc.hash.slice(1);
  if (h && !RESERVED_HASH.has(h.toLowerCase())) return normalizeRoom(h);
  return '';
}

export function isHistoryRoute(loc = location) {
  return ['historico', 'history'].includes(loc.hash.slice(1).toLowerCase()) && !roomFromLocation(loc);
}
