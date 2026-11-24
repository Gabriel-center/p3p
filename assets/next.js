// Versão de teste (vidro/index.html, data-next): o que vai além do visual.
// - Movimento: barra de abas com a marca que desliza (e dá para arrastar o dedo por ela), mensagens e
//   cartões entrando com mola, painéis trocando com transição, brilho do vidro seguindo o dedo/mouse.
// - Gestos: deslizar a conversa para a esquerda mostra os horários, toque longo (ou botão direito) numa
//   mensagem abre um menu, folhas fecham arrastando para baixo.
// - Computador: ⌘K / Ctrl+K abre a busca de comandos, "/" vai para o campo de mensagem, arrastar
//   arquivos sobre um aparelho manda só para ele, anel de progresso no avatar de quem está recebendo.
// - App: instalar na tela inicial, receber arquivos pelo "Compartilhar" do celular, ler o QR com a câmera.
import { t, bytes } from './i18n.js?v=202611240439';
import { normalizeRoom, roomFromLocation } from './device.js?v=202611240439';
import * as hist from './history.js?v=202611240439';
import { spring, reduced, tick } from './motion.js?v=202611240439';
import { glass, refracts } from './glass.js?v=202611240439';

let api = null;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = IS_MAC ? '⌘' : 'Ctrl';
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let installEvt = null;

// ---------- início ----------
export function init(a) {
  api = a;
  // Vidro líquido com refração onde o navegador deixa (Chrome, Edge, Android).
  document.documentElement.classList.toggle('lg-on', refracts);

  // App instalável
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; refreshInstall(); });
  addEventListener('appinstalled', () => { installEvt = null; refreshInstall(); api.toast(t('Instalado. Abra pelo ícone na tela inicial.')); });

  sheetDrag();
  keyboard();
  dialogMotion();
  segmented();
}

/** Folhas e janelas também saem com animação (entrar já é com CSS): Esc, "Fechar", botões do formulário. */
function dialogMotion() {
  const proto = HTMLDialogElement.prototype;
  const close = proto.close;
  proto.close = function (value) {
    if (!this.open || this.dataset.leaving || this.classList.contains('viewer') || this.classList.contains('scanner') || reduced()) return close.call(this, value);
    this.dataset.leaving = '1';
    const sheet = matchMedia('(max-width: 640px)').matches && !this.classList.contains('palette');
    const from = getComputedStyle(this).transform;
    const a = this.animate(sheet
      ? [{ transform: from === 'none' ? 'none' : from }, { transform: 'translateY(105%)' }]
      : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }], { duration: sheet ? 260 : 170, easing: sheet ? 'cubic-bezier(.4,0,1,1)' : 'ease-in', fill: 'forwards' });
    try { this.animate([{ opacity: 1 }, { opacity: 0 }], { duration: sheet ? 260 : 170, pseudoElement: '::backdrop', fill: 'forwards' }); } catch { /* sem animação no fundo */ }
    a.finished.catch(() => {}).then(() => { delete this.dataset.leaving; close.call(this, value); this.getAnimations().forEach(x => x.cancel()); this.style.transform = ''; });
  };
  // Esc e <form method="dialog"> fecham por dentro do navegador, sem passar por close(): desvia para ela.
  addEventListener('cancel', e => { const d = e.target; if (d instanceof HTMLDialogElement && !d.classList.contains('viewer')) { e.preventDefault(); d.close(); } }, true);
  addEventListener('submit', e => {
    const f = e.target;
    if (f.method !== 'dialog') return;
    const d = f.closest('dialog');
    if (!d) return;
    e.preventDefault();
    d.close(e.submitter?.value ?? '');
  }, true);
}

/** Controle segmentado (Aparência): a seleção desliza de um botão para o outro. */
function segmented() {
  addEventListener('click', e => {
    const b = e.target.closest('.seg [role="radio"]');
    if (!b) return;
    const seg = b.closest('.seg');
    const old = seg.querySelector('[aria-checked="true"]');
    let thumb = seg.querySelector(':scope > .thumb');
    if (!thumb) { thumb = document.createElement('span'); thumb.className = 'thumb'; seg.prepend(thumb); }
    const place = el => { thumb.style.width = `${el.offsetWidth}px`; thumb.style.transform = `translateX(${el.offsetLeft - 3}px)`; };
    if (old && !seg.classList.contains('has-thumb')) { thumb.style.transition = 'none'; place(old); thumb.offsetWidth; thumb.style.transition = ''; }
    seg.classList.add('has-thumb');
    requestAnimationFrame(() => place(b));   // o tema pode trocar só no quadro seguinte (transição de página): vai direto ao tocado
    tick(6);
  });
}

function canInstall() { return !standalone() && (installEvt || isIOS()); }
function refreshInstall() { $$('[data-install]').forEach(b => { b.hidden = !canInstall(); }); }
async function install() {
  if (installEvt) { installEvt.prompt(); const r = await installEvt.userChoice.catch(() => null); if (r?.outcome === 'accepted') installEvt = null; refreshInstall(); return; }
  // iPhone e iPad: não há botão de instalar; explica o caminho pelo Compartilhar.
  const d = sheet('install-sheet', `<h3>${t('Instalar na tela inicial')}</h3>
    <ol class="steps">
      <li><span class="sq-ico">${api.ICON.share}</span>${t('Toque em Compartilhar, na barra do Safari.')}</li>
      <li><span class="sq-ico">${api.ICON.clip}</span>${t('Escolha "Adicionar à Tela de Início".')}</li>
      <li><span class="sq-ico app">${api.APPICON}</span>${t('Abra pelo ícone: fica em tela cheia, como um app.')}</li>
    </ol>
    <form method="dialog"><button class="btn solid big wide">${t('Entendi')}</button></form>`);
  d.showModal();
}

/** Diálogo simples, criado uma vez. */
function sheet(id, html) {
  let d = document.getElementById(id);
  if (!d) { d = document.createElement('dialog'); d.id = id; document.body.appendChild(d); d.addEventListener('click', e => { if (e.target === d) d.close(); }); }
  d.innerHTML = html;
  return d;
}

export function onHome() {
  glass($('.home .topline > div'));
  glass($('.home .urlfield'));
  const tl = $('.home .topline > div');
  if (tl && !tl.querySelector('[data-install]')) {
    tl.insertAdjacentHTML('afterbegin', `<button class="btn quiet" type="button" data-install hidden>${api.ICON.down}<span class="lbl">${t('Instalar')}</span></button>`);
    tl.querySelector('[data-install]').addEventListener('click', install);
    refreshInstall();
  }
  const under = $('.home .under');
  if (under && !under.querySelector('[data-scan]')) {
    under.insertAdjacentHTML('afterbegin', `<button class="btn line sm scan-btn" type="button" data-scan>${api.ICON.qr}${t('Ler QR code')}</button>`);
    under.querySelector('[data-scan]').addEventListener('click', openScanner);
  }
  // Atalho do ícone do app (segurar o ícone → Ler QR code).
  if (new URLSearchParams(location.search).get('acao') === 'ler') { history.replaceState(null, '', './'); openScanner(); }
  // Entrada dos elementos do início, uma vez.
  if (!reduced()) {
    $$('.home .hero h1, .home .hero .lede, .home .hero form, .home .paths, .home .recents').forEach((el, i) =>
      el.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { ...spring(700, 0.05), delay: 80 + i * 60, fill: 'backwards' }));
  }
}

// ---------- sala ----------
const rooms = new WeakMap();

export function onRoom(v) {
  const st = { timers: [], offs: [] };
  rooms.set(v, st);
  const on = (el, type, fn, opt) => { el.addEventListener(type, fn, opt); st.offs.push(() => el.removeEventListener(type, fn, opt)); };

  for (const el of [$('.room-tabs'), $('.home-link'), $('.head-actions'), $('#attach'), $('#msg')]) glass(el);
  tabLens(v, st, on);
  enterAnimations(v, st);
  revealTimes(v, on);
  messageMenu(v, on);
  deviceDrop(v, on);
  st.timers.push(setInterval(() => avatarRings(v), 300));
  deliverShare(v);
  // Atalho para o leitor e para a busca nos comandos do cabeçalho.
  const acts = $('.head-actions');
  if (acts && !acts.querySelector('[data-palette]') && matchMedia('(pointer: fine)').matches) {
    acts.insertAdjacentHTML('afterbegin', `<button class="btn quiet icon kbd-btn" type="button" data-palette title="${t('Buscar comandos')} (${MOD}K)" aria-label="${t('Buscar comandos')}">${SEARCH}</button>`);
    acts.querySelector('[data-palette]').addEventListener('click', openPalette);
  }
}

export function offRoom(v) {
  const st = rooms.get(v);
  if (!st) return;
  st.timers.forEach(clearInterval);
  st.offs.forEach(f => f());
  st.obs?.disconnect();
  rooms.delete(v);
}

const SEARCH = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20"/></svg>';

/** Marca da aba selecionada que desliza com mola; dá para arrastar o dedo pela barra e soltar na aba. */
function tabLens(v, st, on) {
  const bar = $('.room-tabs');
  if (!bar) return;
  const lens = document.createElement('span');
  lens.className = 'lens';
  bar.prepend(lens);
  const place = (btn, instant) => {
    if (!btn || !bar.offsetWidth) return;
    lens.style.transition = instant ? 'none' : '';
    lens.style.width = `${btn.offsetWidth}px`;
    lens.style.transform = `translateX(${btn.offsetLeft}px)`;
  };
  const sel = () => bar.querySelector('[aria-selected="true"]');
  requestAnimationFrame(() => place(sel(), true));
  const orig = v.selectTab.bind(v);
  v.selectTab = tab => {
    const changed = tab !== v.tab;
    orig(tab);
    place(sel());
    if (changed) { tick(6); const p = $(`[data-pane="${tab}"]`); if (p && !reduced() && v.tabsVisible()) p.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], spring(300, 0)); }
  };
  on(window, 'resize', () => place(sel(), true));
  // Arrastar pela barra: a marca acompanha o dedo e cresce um pouco, como uma lente.
  let drag = null;
  on(bar, 'pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    drag = { x: e.clientX, moved: false };
    bar.classList.add('pressing');
  });
  on(bar, 'pointermove', e => {
    if (!drag) return;
    if (Math.abs(e.clientX - drag.x) > 6) drag.moved = true;
    if (!drag.moved) return;
    const r = bar.getBoundingClientRect();
    const w = lens.offsetWidth;
    const x = Math.max(4, Math.min(r.width - w - 4, e.clientX - r.left - w / 2));
    lens.style.transition = 'none';
    lens.style.transform = `translateX(${x}px)`;
  });
  const end = e => {
    if (!drag) return;
    bar.classList.remove('pressing');
    const moved = drag.moved;
    drag = null;
    lens.style.transition = '';
    if (!moved) return;
    const btn = document.elementFromPoint(e.clientX, bar.getBoundingClientRect().top + bar.offsetHeight / 2)?.closest('[data-tab]');
    if (btn) v.selectTab(btn.dataset.tab); else place(sel());
  };
  on(bar, 'pointerup', end);
  on(bar, 'pointercancel', end);
}

/** O que chega depois que a sala abriu entra com mola: minhas mensagens sobem do campo, as dos outros surgem do lado. */
function enterAnimations(v, st) {
  const feed = $('#feed');
  if (!feed) return;
  const t0 = Date.now();
  st.obs = new MutationObserver(list => {
    if (!v.welcomed || Date.now() - t0 < 1200 || reduced()) return;
    for (const r of list) for (const n of r.addedNodes) {
      if (!(n instanceof HTMLElement) || !n.matches('.msg, .xfer, .sys')) continue;
      const mine = n.classList.contains('mine');
      // A minha sobe do campo de mensagem; a dos outros surge pequena do lado de onde vem.
      const from = n.matches('.sys') ? 'translateY(6px)' : mine ? 'translate(0, 46px) scale(.86)' : 'scale(.82)';
      n.style.transformOrigin = mine ? '100% 100%' : '0% 100%';
      n.animate([{ opacity: 0, transform: from }, { opacity: 1, transform: 'none' }], spring(mine ? 380 : 340, 0.16));
    }
  });
  st.obs.observe(feed, { childList: true });
}

/** Deslizar a conversa para a esquerda mostra a hora de cada mensagem, como no app de mensagens. */
function revealTimes(v, on) {
  const feed = $('#feed');
  if (!feed) return;
  let g = null;
  const MAX = 64;
  on(feed, 'pointerdown', e => {
    if (e.pointerType === 'mouse' || e.target.closest('button, a, input, textarea, .media, .tile')) return;
    g = { x: e.clientX, y: e.clientY, on: false };
  });
  on(feed, 'pointermove', e => {
    if (!g) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (!g.on) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { g = null; return; }
      if (dx > -10) return;
      g.on = true;
      $$('.msg', feed).forEach(m => { if (!m.dataset.t) m.dataset.t = m.querySelector('.who time')?.textContent || ''; });
      feed.classList.add('revealing');
    }
    feed.style.setProperty('--rv', String(Math.min(MAX, Math.max(0, -dx * 0.8))));
  });
  const end = () => {
    if (!g) return;
    const was = g.on;
    g = null;
    if (!was) return;
    feed.classList.remove('revealing');
    feed.style.setProperty('--rv', '0');
  };
  on(feed, 'pointerup', end);
  on(feed, 'pointercancel', end);
}

/** Toque longo (ou botão direito) numa mensagem: ela sobe, o fundo desfoca e aparece um menu. */
function messageMenu(v, on) {
  const feed = $('#feed');
  if (!feed) return;
  let timer = null, start = null;
  on(feed, 'pointerdown', e => {
    const body = e.target.closest('.msg .body');
    if (!body || e.pointerType === 'mouse') return;
    start = { x: e.clientX, y: e.clientY };
    body.classList.add('pressing');
    timer = setTimeout(() => { body.classList.remove('pressing'); timer = null; openMenu(body); }, 430);
  });
  const cancel = e => {
    if (!timer) return;
    if (e.type === 'pointermove' && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 8) return;
    clearTimeout(timer); timer = null;
    $$('.msg .body.pressing', feed).forEach(b => b.classList.remove('pressing'));
  };
  on(feed, 'pointermove', cancel);
  on(feed, 'pointerup', cancel);
  on(feed, 'pointercancel', cancel);
  on(feed, 'contextmenu', e => {
    const body = e.target.closest('.msg .body');
    if (!body || getSelection()?.toString()) return;
    e.preventDefault();
    openMenu(body);
  });
}

function openMenu(body) {
  tick(12);
  const msg = body.closest('.msg');
  const text = body.innerText;
  const links = [...body.querySelectorAll('a[href]')].map(a => a.href);
  const r = msg.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.className = 'ctx';
  const clone = msg.cloneNode(true);
  clone.classList.remove('cont');
  clone.classList.add('lifted');
  clone.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;margin:0`;
  const items = [
    { label: t('Copiar'), icon: api.ICON.copy, run: () => api.copy(text, t('Copiado')) },
    ...links.slice(0, 1).flatMap(u => [
      { label: t('Abrir link'), icon: api.ICON.link, run: () => open(u, '_blank', 'noopener') },
      { label: t('Copiar link'), icon: api.ICON.link, run: () => api.copy(u, t('Link copiado')) }
    ])
  ];
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = items.map((it, i) => `<button type="button" role="menuitem" data-i="${i}"><span>${api.esc(it.label)}</span>${it.icon}</button>`).join('');
  layer.append(clone, menu);
  document.body.appendChild(layer);
  // Menu abaixo da mensagem (ou acima, se não couber), alinhado ao lado dela.
  const mh = menu.offsetHeight, mw = menu.offsetWidth;
  const below = r.bottom + 10 + mh < innerHeight - 20;
  const top = below ? r.bottom + 10 : Math.max(12, r.top - mh - 10);
  const mine = msg.classList.contains('mine');
  const bubble = body.getBoundingClientRect();
  const left = Math.max(12, Math.min(innerWidth - mw - 12, mine ? bubble.right - mw : bubble.left));
  menu.style.cssText = `top:${top}px;left:${left}px;transform-origin:${mine ? 'right' : 'left'} ${below ? 'top' : 'bottom'}`;
  if (!reduced()) {
    clone.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.035)' }], { ...spring(360, 0.2), fill: 'forwards' });
    menu.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'none' }], spring(420, 0.12));
    layer.animate([{ backgroundColor: 'transparent', backdropFilter: 'blur(0px)' }, {}], { duration: 220, easing: 'ease-out' });
  }
  const close = () => {
    if (!layer.isConnected) return;
    const a = layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-in' });
    a.finished.then(() => layer.remove(), () => layer.remove());
  };
  // O "clique" de soltar o dedo depois do toque longo não pode fechar o menu: só vale depois disso.
  let armed = false;
  const opened = performance.now();
  addEventListener('pointerup', () => setTimeout(() => { armed = true; }, 120), { once: true, capture: true });
  setTimeout(() => { armed = true; }, 700);
  layer.addEventListener('click', e => {
    if (!armed && performance.now() - opened < 700) return;
    const b = e.target.closest('[data-i]');
    if (b) items[Number(b.dataset.i)].run();
    close();
  });
  layer.addEventListener('contextmenu', e => { e.preventDefault(); close(); });
  addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); removeEventListener('keydown', esc); } });
  menu.querySelector('button')?.focus({ preventScroll: true });
}

/** Arrastar arquivos sobre um aparelho da lista: ele acende e recebe só ele (o envio está no app.js). */
function deviceDrop(v, on) {
  const hot = row => $$('.device.drop-hot').forEach(r => { if (r !== row) r.classList.remove('drop-hot'); });
  on(window, 'dragover', e => {
    const row = e.target.closest?.('.device[data-peer]:not([data-self])');
    hot(row);
    row?.classList.add('drop-hot');
  });
  on(window, 'drop', () => hot(null));
  on(window, 'dragleave', e => { if (!e.relatedTarget) hot(null); });
}

/** Anel em volta do avatar de quem está mandando ou recebendo arquivos agora. */
function avatarRings(v) {
  const acc = new Map();
  const add = (peer, done, size) => { const a = acc.get(peer) || { d: 0, s: 0 }; a.d += done; a.s += size; acc.set(peer, a); };
  for (const x of v.transfers.out.values()) if (['sending', 'waiting', 'preparing', 'paused', 'interrupted'].includes(x.state)) add(x.peerId, x.liveStats().raw, x.size);
  for (const x of v.transfers.inc.values()) if (['receiving', 'stalled'].includes(x.state)) add(x.peerId, x.liveStats().raw, x.size);
  for (const row of $$('.device[data-peer]')) {
    const av = row.querySelector('.av');
    const a = acc.get(row.dataset.peer);
    if (!av) continue;
    av.classList.toggle('busy', !!a);
    if (a) av.style.setProperty('--p', String(a.s ? Math.min(1, a.d / a.s) : 0));
  }
}

// ---------- folhas que fecham arrastando (celular) ----------
function sheetDrag() {
  let g = null;
  addEventListener('pointerdown', e => {
    const d = e.target.closest?.('dialog[open]:not(.viewer):not(.palette):not(.scanner)');
    if (!d || !matchMedia('(max-width: 640px)').matches || e.target.closest('input, textarea, select')) return;
    const r = d.getBoundingClientRect();
    if (d.scrollTop > 0 && e.clientY - r.top > 56) return;
    g = { d, y: e.clientY, t: performance.now(), dy: 0, on: false };
  }, { passive: true });
  addEventListener('pointermove', e => {
    if (!g) return;
    const dy = e.clientY - g.y;
    if (!g.on) { if (dy < 8) { if (dy < -6) g = null; return; } g.on = true; g.d.classList.add('dragging'); }
    g.dy = Math.max(0, dy);
    g.d.style.transform = `translateY(${g.dy}px)`;
  }, { passive: true });
  const end = () => {
    if (!g) return;
    const { d, dy, on: was, t: t0 } = g;
    g = null;
    if (!was) return;
    d.classList.remove('dragging');
    const v = dy / Math.max(1, performance.now() - t0);
    if (dy > 110 || v > 0.6) {
      d.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(110%)' }], { duration: 220, easing: 'ease-in' }).finished.then(() => { d.close(); d.style.transform = ''; });
      tick(6);
    } else {
      d.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], spring(420, 0.18));
      d.style.transform = '';
    }
  };
  addEventListener('pointerup', end);
  addEventListener('pointercancel', end);
}

// ---------- teclado e busca de comandos ----------
function keyboard() {
  addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
    const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
    if (typing || e.metaKey || e.ctrlKey || e.altKey || $('dialog[open]')) return;
    if (e.key === '/') { const m = $('#msg'); if (m) { e.preventDefault(); m.focus(); } }
  });
}

function commands(q) {
  const I = api.ICON;
  const v = api.current();
  const list = [];
  const room = normalizeRoom(q);
  if (room && (!v || room !== v.room)) list.push({ label: t('Entrar na sala ?{room}', { room }), icon: I.join, run: () => api.navigate(`./?${room}`), always: true });
  if (v) {
    list.push(
      { label: t('Convidar para a sala'), hint: t('QR code e link'), icon: I.share, run: () => v.showQR() },
      { label: t('Copiar link da sala'), icon: I.copy, run: () => api.copy(api.shareUrl(v.room), t('Link copiado')) },
      { label: t('Mandar arquivos'), hint: t('para quem estiver selecionado'), icon: I.clip, run: () => $('#file-input')?.click() },
      ...[...v.peers.values()].map(p => ({ label: t('Mandar arquivos só para {name}', { name: p.name }), icon: I[p.kind] || I.desktop, run: () => pickFor(v, p.peerId) })),
      { label: t('Guardar arquivo na sala'), hint: t('fica 48 h para quem entrar depois'), icon: I.cloud, run: () => $('#shelf-input')?.click() },
      { label: t('Escrever mensagem'), keys: '/', icon: I.bubble || I.send, run: () => $('#msg')?.focus() },
      { label: t('Mudar meu nome'), icon: I.mobile, run: () => $('#me-chip')?.click() },
      { label: t('Configurações da sala'), hint: t('senha, aparência, apagar tudo'), icon: I.gear, run: () => v.openSettings() },
      { label: t('Sair da sala'), icon: I.leave, run: () => api.navigate('./') }
    );
  }
  list.push(
    { label: t('Ler QR code para entrar'), icon: I.qr, run: openScanner },
    { label: t('Aparência: automática'), icon: I.auto, run: () => api.setTheme('auto') },
    { label: t('Aparência: clara'), icon: I.sun, run: () => api.setTheme('light') },
    { label: t('Aparência: escura'), icon: I.moon, run: () => api.setTheme('dark') },
    { label: t('Histórico deste aparelho'), icon: I.history, run: () => { location.hash = '#historico'; } }
  );
  if (canInstall()) list.push({ label: t('Instalar na tela inicial'), icon: I.down, run: install });
  const words = String(q || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter(Boolean);
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return list.filter(c => c.always || words.every(w => norm(`${c.label} ${c.hint || ''}`).includes(w)));
}

function pickFor(v, peerId) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.multiple = true;
  inp.addEventListener('change', () => { const prev = v.target; v.target = peerId; v.sendFiles([...inp.files]); v.target = prev; });
  inp.click();
}

function openPalette() {
  let d = $('#palette');
  if (d?.open) { d.close(); return; }
  if (!d) {
    d = document.createElement('dialog');
    d.id = 'palette';
    d.className = 'palette';
    d.innerHTML = `<div class="pal-in">${SEARCH}<input type="text" placeholder="${t('Buscar comandos ou digitar uma sala')}" aria-label="${t('Buscar comandos')}" spellcheck="false" autocomplete="off"><kbd>esc</kbd></div>
      <ul role="listbox"></ul>
      <div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> ${t('escolher')}</span><span><kbd>↵</kbd> ${t('abrir')}</span><span><kbd>${MOD}</kbd><kbd>K</kbd> ${t('abre e fecha')}</span><span><kbd>/</kbd> ${t('escrever')}</span></div>`;
    document.body.appendChild(d);
    d.addEventListener('click', e => { if (e.target === d) d.close(); });
  }
  const input = $('input', d), ul = $('ul', d);
  let items = [], sel = 0;
  const draw = () => {
    items = commands(input.value);
    sel = Math.min(sel, Math.max(0, items.length - 1));
    ul.innerHTML = items.length ? items.map((c, i) => `<li role="option" data-i="${i}" aria-selected="${i === sel}">${c.icon || ''}<span class="pl">${api.esc(c.label)}${c.hint ? `<small>${api.esc(c.hint)}</small>` : ''}</span>${c.keys ? `<kbd>${c.keys}</kbd>` : ''}</li>`).join('')
      : `<li class="none">${t('Nada encontrado')}</li>`;
    ul.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  };
  const run = i => { const c = items[i]; if (!c) return; d.close(); setTimeout(() => c.run(), 60); };
  input.oninput = () => { sel = 0; draw(); };
  input.onkeydown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % Math.max(1, items.length); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + items.length) % Math.max(1, items.length); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
  };
  ul.onclick = e => { const li = e.target.closest('[data-i]'); if (li) run(Number(li.dataset.i)); };
  ul.onpointermove = e => { const li = e.target.closest('[data-i]'); if (li && Number(li.dataset.i) !== sel) { sel = Number(li.dataset.i); $$('[aria-selected]', ul).forEach(x => x.setAttribute('aria-selected', String(Number(x.dataset.i) === sel))); } };
  input.value = '';
  sel = 0;
  draw();
  d.showModal();
  input.focus();
}

// ---------- leitor de QR ----------
let jsqrP = null;
function loadJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  jsqrP ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = new URL('vendor/jsqr/jsQR.min.js', import.meta.url).href;
    s.onload = () => res(window.jsQR);
    s.onerror = rej;
    document.head.appendChild(s);
  });
  return jsqrP;
}

/** Sala que um código lido leva: endereço do site (?sala) ou só o nome da sala. */
export function roomFromCode(text) {
  const s = String(text || '').trim();
  try { const u = new URL(s); return roomFromLocation(u); } catch { /* não é endereço */ }
  return /^[\w-]{1,48}$/.test(s) ? normalizeRoom(s) : '';
}

export async function openScanner() {
  const d = sheet('scanner', `<div class="sc-stage"><video playsinline muted></video><div class="sc-frame"><i></i><i></i><i></i><i></i></div></div>
    <div class="sc-bar"><button class="btn vw-btn sc-x" type="button" aria-label="${t('Fechar')}">${api.ICON.x}</button></div>
    <p class="sc-hint">${t('Aponte para o QR code de uma sala')}</p>`);
  d.className = 'scanner';
  const video = $('video', d), hint = $('.sc-hint', d);
  let stream = null, alive = true, timer = 0;
  const stop = () => { alive = false; clearTimeout(timer); stream?.getTracks().forEach(tr => tr.stop()); };
  d.addEventListener('close', stop, { once: true });
  $('.sc-x', d).onclick = () => d.close();
  d.showModal();
  if (!navigator.mediaDevices?.getUserMedia) { hint.textContent = t('Este navegador não deixa usar a câmera aqui.'); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
  } catch {
    hint.textContent = t('Sem acesso à câmera. Libere a câmera para este site e tente de novo.');
    return;
  }
  if (!alive) { stream.getTracks().forEach(tr => tr.stop()); return; }
  video.srcObject = stream;
  await video.play().catch(() => {});
  let detect;
  try {
    if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats()).includes('qr_code')) {
      const bd = new BarcodeDetector({ formats: ['qr_code'] });
      detect = async () => (await bd.detect(video))[0]?.rawValue || '';
    }
  } catch { /* usa o jsQR */ }
  if (!detect) {
    const jsQR = await loadJsQR().catch(() => null);
    if (!jsQR) { hint.textContent = t('Não deu para carregar o leitor de QR.'); return; }
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d', { willReadFrequently: true });
    detect = async () => {
      const w = video.videoWidth, h = video.videoHeight;
      if (!w) return '';
      const s = Math.min(1, 720 / Math.max(w, h));
      c.width = Math.round(w * s); c.height = Math.round(h * s);
      ctx.drawImage(video, 0, 0, c.width, c.height);
      return jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: 'dontInvert' })?.data || '';
    };
  }
  let lastBad = '';
  const loop = async () => {
    if (!alive) return;
    let text = '';
    try { text = await detect(); } catch { /* quadro ruim */ }
    const room = text && roomFromCode(text);
    if (room) {
      tick(20);
      d.classList.add('found');
      hint.textContent = t('Entrando em ?{room}', { room });
      stop();
      setTimeout(() => { d.close(); api.navigate(`./?${room}`); }, 450);
      return;
    }
    if (text && text !== lastBad) { lastBad = text; hint.textContent = t('Esse código não é de uma sala.'); }
    timer = setTimeout(loop, 120);
  };
  loop();
}

// ---------- compartilhar de outro app (app instalado) ----------
const DB = 'p3p-share';
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('items', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(id) { const db = await idb(); return new Promise(res => { const q = db.transaction('items').objectStore('items').get(id); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); }
async function idbDel(id) { const db = await idb(); return new Promise(res => { const tx = db.transaction('items', 'readwrite'); tx.objectStore('items').delete(id); tx.oncomplete = res; tx.onerror = res; }); }

export async function renderShare(app) {
  const id = new URLSearchParams(location.search).get('share') || '';
  const item = id ? await idbGet(id).catch(() => null) : null;
  const files = item?.files || [];
  const text = item?.text || '';
  const total = files.reduce((s, f) => s + f.size, 0);
  const thumbs = files.filter(f => /^image\//.test(f.type)).slice(0, 5).map(f => URL.createObjectURL(f));
  document.title = t('Mandar para uma sala');
  app.innerHTML = `<section class="view"><div class="home gutter share-page">
    <div class="topline"><a class="wordmark" href="./" data-nav>${api.APPICON}p3p</a></div>
    ${item ? `<div class="share-head">
      ${thumbs.length ? `<div class="share-stack">${thumbs.map((u, i) => `<img src="${u}" alt="" style="--i:${i}">`).join('')}</div>` : `<div class="hero-icon">${api.APPICON}</div>`}
      <h1>${t('Mandar para qual sala?')}</h1>
      <p class="lede">${files.length ? `${files.length === 1 ? api.esc(files[0].name) : t('{n} arquivos', { n: files.length })} · ${bytes(total)}` : api.esc(text.slice(0, 140))}</p>
    </div>
    <form id="share-form" autocomplete="off"><div class="urlfield"><label for="share-room">?</label><input id="share-room" placeholder="${t('sala')}01" spellcheck="false" autocapitalize="off" maxlength="60" enterkeyhint="go"><button class="btn accent big" type="submit">${t('Mandar')}</button></div></form>
    <div class="recents"><h2 class="sec-title">${t('Salas recentes neste aparelho')}</h2><ul id="share-recents"></ul></div>`
    : `<div class="share-head"><h1>${t('Nada para mandar')}</h1><p class="lede">${t('O que foi compartilhado já foi enviado ou expirou.')}</p><a class="btn accent big" href="./" data-nav>${t('Voltar ao início')}</a></div>`}
  </div></section>`;
  if (!item) return;
  const go = room => {
    room = normalizeRoom(room);
    if (!room) return;
    sessionStorage.setItem('p3p.share', id);
    api.navigate(`./?${room}`);
  };
  $('#share-form').addEventListener('submit', e => { e.preventDefault(); go($('#share-room').value); });
  const list = await hist.recentRooms().catch(() => []);
  $('#share-recents').innerHTML = list.length ? list.slice(0, 8).map(r => `<li><a href="?${api.esc(r.room)}" data-room="${api.esc(r.room)}"><span class="rname"><span>?</span>${api.esc(r.room)}</span></a></li>`).join('')
    : `<li class="empty">${t('Nenhuma sala ainda. Digite o nome de uma sala acima.')}</li>`;
  $('#share-recents').addEventListener('click', e => { const a = e.target.closest('[data-room]'); if (a) { e.preventDefault(); go(a.dataset.room); } });
}

async function deliverShare(v) {
  const id = sessionStorage.getItem('p3p.share');
  if (!id) return;
  sessionStorage.removeItem('p3p.share');
  const item = await idbGet(id).catch(() => null);
  if (!item) return;
  // Espera entrar na sala e dá uns segundos para os outros aparelhos conectarem direto.
  const t0 = Date.now();
  while (!v.destroyed && (!v.welcomed || (Date.now() - t0 < 4000 && ![...v.peers.keys()].some(p => v.mesh.isOpen(p))))) await new Promise(r => setTimeout(r, 200));
  if (v.destroyed) return;
  if (item.files?.length) { v.sendFiles(item.files); api.toast(item.files.length === 1 ? t('Mandando {name}', { name: item.files[0].name }) : t('Mandando {n} arquivos', { n: item.files.length })); }
  if (item.text) { const m = $('#msg'); if (m) { m.value = item.text; m.dispatchEvent(new Event('input')); m.focus(); } }
  idbDel(id);
}
