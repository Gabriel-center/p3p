// Visualizador em tela cheia: fotos, vídeos (com play) e áudios. Setas, teclado (← →), deslizar no celular
// e faixa de miniaturas quando é um lote. Quem chama passa resolve(id) → como mostrar aquele item agora.
//   item = { id, name, kind, src, poster, blur, status, href, download, meta, label }
// Com fancy (versão de teste): a foto cresce a partir do cartão e volta para ele, arrastar para baixo fecha,
// deslizar acompanha o dedo, pinça e dois toques dão zoom, um toque esconde as barras.
import { spring, reduced, tick } from './motion.js?v=202611251832';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class Viewer {
  constructor({ resolve, esc, icons, t, fancy = false }) {
    this.resolve = resolve;
    this.esc = esc;
    this.icons = icons;
    this.t = t;
    this.fancy = fancy;
    this.ids = [];
    this.i = 0;
    this.zoom = { s: 1, x: 0, y: 0 };
    const d = document.createElement('dialog');
    d.className = `viewer${fancy ? ' fancy' : ''}`;
    d.id = 'viewer';
    d.tabIndex = -1;
    d.setAttribute('aria-label', t('Visualizar'));
    d.innerHTML = `<div class="vw-bar">
        <div class="vw-title"><b class="vw-name"></b><span class="vw-meta"></span></div>
        <span class="vw-count tnum"></span>
        <a class="btn vw-btn vw-dl" title="${esc(t('Baixar'))}" aria-label="${esc(t('Baixar'))}">${icons.down}</a>
        <button class="btn vw-btn vw-x" type="button" title="${esc(t('Fechar'))}" aria-label="${esc(t('Fechar'))}">${icons.x}</button>
      </div>
      <div class="vw-stage">
        <button class="vw-nav prev" type="button" aria-label="${esc(t('Anterior'))}">${icons.back}</button>
        <div class="vw-media"></div>
        <button class="vw-nav next" type="button" aria-label="${esc(t('Próximo'))}">${icons.back}</button>
      </div>
      <div class="vw-strip"></div>`;
    document.body.appendChild(d);
    this.d = d;
    this.$ = s => d.querySelector(s);
    this.$('.vw-x').addEventListener('click', () => this.close());
    this.$('.prev').addEventListener('click', () => this.go(-1));
    this.$('.next').addEventListener('click', () => this.go(1));
    d.addEventListener('close', () => { this.$('.vw-media').innerHTML = ''; this.key = null; d.classList.remove('bare', 'zoomed', 'dragging'); d.style.backgroundColor = ''; });
    d.addEventListener('cancel', e => { if (this.fancy) { e.preventDefault(); this.close(); } });
    d.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); this.go(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); this.go(1); }
    });
    this.$('.vw-strip').addEventListener('click', e => {
      const b = e.target.closest('[data-vi]');
      if (b) this.show(Number(b.dataset.vi));
    });
    if (fancy) { this.gestures(); return; }
    this.$('.vw-stage').addEventListener('click', e => { if (e.target.classList.contains('vw-stage') || e.target.classList.contains('vw-media')) d.close(); });
    // Deslizar para os lados no celular.
    let start = null;
    const stage = this.$('.vw-stage');
    stage.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') start = { x: e.clientX, y: e.clientY }; });
    stage.addEventListener('pointerup', e => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      start = null;
      if (Math.abs(dx) > 60 && Math.abs(dy) < 90) this.go(dx < 0 ? 1 : -1);
    });
  }

  get open() { return this.d.open; }

  show(i) {
    if (!this.ids.length) return;
    this.i = Math.max(0, Math.min(this.ids.length - 1, i));
    this.key = null;
    this.zoom = { s: 1, x: 0, y: 0 };
    this.d.classList.remove('zoomed');
    this.render();
    this.renderStrip();
  }
  go(step) {
    if (this.i + step < 0 || this.i + step >= this.ids.length) return;
    if (this.fancy && !reduced()) { this.slide(step); return; }
    this.show(this.i + step);
  }

  openWith(ids, index = 0, from = null) {
    this.ids = ids;
    const wasOpen = this.d.open;
    if (!wasOpen) this.d.showModal();
    this.show(index);
    // Foco no próprio visualizador: as setas do teclado funcionam e nenhum botão fica com o anel de foco.
    this.d.focus({ preventScroll: true });
    if (this.fancy && !wasOpen && !reduced()) this.enter(from);
  }

  /** Chamado o tempo todo pelo app: troca a mídia quando o arquivo termina de chegar, atualiza o progresso. */
  refresh() {
    if (!this.d.open || this.busy || this.closing || this.d.classList.contains('dragging') || this.zoom.s > 1) return;
    this.render();
    if (this.stripKey !== this.stripSig()) this.renderStrip();
  }

  render() {
    const it = this.resolve(this.ids[this.i]);
    if (!it) return;
    const { esc, t } = this;
    this.$('.vw-name').textContent = it.name;
    this.$('.vw-meta').textContent = it.meta || '';
    this.$('.vw-count').textContent = this.ids.length > 1 ? `${this.i + 1} / ${this.ids.length}` : '';
    const dl = this.$('.vw-dl');
    dl.hidden = !it.href;
    if (it.href) { dl.href = it.href; if (it.download) dl.setAttribute('download', it.download); else dl.removeAttribute('download'); }
    this.$('.prev').hidden = this.i === 0;
    this.$('.next').hidden = this.i >= this.ids.length - 1;
    const key = `${it.id}|${it.src || ''}|${it.poster || ''}|${it.kind}`;
    const box = this.$('.vw-media');
    if (key !== this.key) {
      this.key = key;
      let html = '';
      if (it.src && it.kind === 'image') html = `<img src="${esc(it.src)}" alt="${esc(it.name)}" draggable="false">`;
      else if (it.src && it.kind === 'video') html = `<video src="${esc(it.src)}" controls autoplay playsinline${it.poster ? ` poster="${esc(it.poster)}"` : ''}></video>`;
      else if (it.src && it.kind === 'audio') html = `<div class="vw-file"><span class="vw-ext">${this.icons.music}</span><b>${esc(it.name)}</b><audio src="${esc(it.src)}" controls autoplay></audio></div>`;
      else if (it.poster) html = `<div class="vw-wait"><img class="${it.blur ? 'blur' : ''}" src="${esc(it.poster)}" alt="" draggable="false"><span class="vw-status"></span></div>`;
      else html = `<div class="vw-file"><span class="vw-ext">${esc(it.label || '')}</span><b>${esc(it.name)}</b><span class="vw-status"></span>${it.href ? `<a class="btn solid" href="${esc(it.href)}"${it.download ? ` download="${esc(it.download)}"` : ''}>${this.icons.down}${esc(t('Baixar'))}</a>` : ''}</div>`;
      box.innerHTML = html;
      this.kind = it.src ? it.kind : 'wait';
    }
    const st = box.querySelector('.vw-status');
    if (st) { st.textContent = it.status || ''; st.hidden = !it.status; }
  }

  stripSig() { return this.ids.map(id => { const it = this.resolve(id); return it ? (it.poster || it.label) : ''; }).join('|') + this.i; }

  renderStrip() {
    const s = this.$('.vw-strip');
    this.stripKey = this.stripSig();
    if (this.ids.length < 2) { s.hidden = true; s.innerHTML = ''; return; }
    s.hidden = false;
    s.innerHTML = this.ids.map((id, i) => {
      const it = this.resolve(id) || {};
      const inner = it.poster ? `<img src="${this.esc(it.poster)}" alt=""${it.blur ? ' class="blur"' : ''}>` : `<span>${this.esc(it.label || '')}</span>`;
      return `<button type="button" data-vi="${i}" class="${i === this.i ? 'on' : ''}" aria-label="${this.esc(it.name || '')}">${inner}${it.kind === 'video' ? `<i class="pl">${this.icons.play}</i>` : ''}</button>`;
    }).join('');
    s.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  // ---------- versão de teste: movimento ----------
  media() { return this.$('.vw-media').firstElementChild; }

  /** Cartão de onde a foto atual saiu (se ainda estiver na tela). */
  source(id = this.ids[this.i]) {
    const el = document.querySelector(`.feed [data-act="view"][data-id="${CSS.escape(id || '')}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight && r.width > 0 ? el : null;
  }

  /** Transformação que leva a mídia (do jeito que está, sem transformação) até o retângulo do cartão. */
  toRect(m, a) {
    const prev = m.style.transform;
    m.style.transform = 'none';
    const b = m.getBoundingClientRect();
    m.style.transform = prev;
    if (!b.width || !b.height || !a.width) return null;
    const s = Math.max(a.width / b.width, a.height / b.height);
    const dx = a.left + a.width / 2 - (b.left + b.width / 2);
    const dy = a.top + a.height / 2 - (b.top + b.height / 2);
    const ix = Math.max(0, (b.width - a.width / s) / 2), iy = Math.max(0, (b.height - a.height / s) / 2);
    return { transform: `translate(${dx}px, ${dy}px) scale(${s})`, clip: `inset(${iy}px ${ix}px round ${14 / s}px)` };
  }

  fadeChrome(on, delay = 0) {
    for (const el of [this.$('.vw-bar'), this.$('.vw-strip')]) {
      el.animate([{ opacity: on ? 0 : 1 }, { opacity: on ? 1 : 0 }], { duration: 220, delay, easing: 'ease-out', fill: on ? 'backwards' : 'forwards' });
    }
  }

  async enter(from) {
    const m = this.media();
    const img = m?.tagName === 'IMG' ? m : null;
    if (img && !img.complete) await Promise.race([new Promise(r => { img.onload = r; img.onerror = r; }), sleep(300)]);
    const sp = spring(520, 0.1);
    this.d.animate([{ backgroundColor: 'rgba(0,0,0,0)' }, { backgroundColor: 'rgba(0,0,0,1)' }], { duration: 320, easing: 'ease-out' });
    this.fadeChrome(true, 140);
    const flip = from && m && (m.tagName === 'IMG' || m.classList.contains('vw-wait')) && this.toRect(m, from.getBoundingClientRect());
    if (flip) m.animate([{ transform: flip.transform, clipPath: flip.clip }, { transform: 'none', clipPath: 'inset(0px 0px round 0px)' }], sp);
    else if (m) m.animate([{ transform: 'scale(.86)', opacity: 0 }, { transform: 'none', opacity: 1 }], sp);
  }

  async close() {
    if (!this.d.open || this.closing) return;
    if (!this.fancy || reduced()) { this.d.close(); return; }
    this.closing = true;
    const m = this.media();
    const src = this.source();
    const current = m ? getComputedStyle(m).transform : 'none';
    const from = current === 'none' ? 'none' : current;
    const anims = [this.d.animate([{ backgroundColor: getComputedStyle(this.d).backgroundColor }, { backgroundColor: 'rgba(0,0,0,0)' }], { duration: 300, easing: 'ease-in', fill: 'forwards' })];
    this.fadeChrome(false);
    const flip = src && m && (m.tagName === 'IMG' || m.classList.contains('vw-wait')) && this.toRect(m, src.getBoundingClientRect());
    if (flip) anims.push(m.animate([{ transform: from, clipPath: 'inset(0px 0px round 0px)' }, { transform: flip.transform, clipPath: flip.clip }], { ...spring(420, 0), fill: 'forwards' }));
    else if (m) anims.push(m.animate([{ transform: from, opacity: 1 }, { transform: `${from === 'none' ? '' : from} scale(.9)`, opacity: 0 }], { duration: 240, easing: 'ease-in', fill: 'forwards' }));
    await Promise.all(anims.map(a => a.finished.catch(() => {})));
    this.d.close();
    this.d.getAnimations({ subtree: true }).forEach(a => a.cancel());
    this.closing = false;
  }

  /** Troca de item deslizando: o atual sai para um lado e o próximo entra pelo outro. */
  async slide(step, fromDx = 0) {
    if (this.busy) return;
    this.busy = true;
    const w = this.$('.vw-stage').clientWidth || innerWidth;
    const m = this.media();
    if (m) await m.animate([{ transform: `translateX(${fromDx}px)` }, { transform: `translateX(${-step * w}px)`, opacity: 0.4 }], { duration: 220, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'forwards' }).finished.catch(() => {});
    this.busy = false;
    this.show(this.i + step);
    tick(6);
    this.media()?.animate([{ transform: `translateX(${step * w * 0.45}px)`, opacity: 0.4 }, { transform: 'none', opacity: 1 }], spring(460, 0.08));
  }

  setZoom(s, x, y, animate) {
    const m = this.media();
    if (!m || m.tagName !== 'IMG') return;
    const r = this.$('.vw-stage').getBoundingClientRect();
    s = Math.max(1, Math.min(5, s));
    // Não deixa a foto sair da tela.
    const mx = Math.max(0, (m.offsetWidth * s - r.width) / 2), my = Math.max(0, (m.offsetHeight * s - r.height) / 2);
    x = s === 1 ? 0 : Math.max(-mx, Math.min(mx, x));
    y = s === 1 ? 0 : Math.max(-my, Math.min(my, y));
    this.zoom = { s, x, y };
    const tf = s === 1 ? 'none' : `translate(${x}px, ${y}px) scale(${s})`;
    if (animate) m.animate([{ transform: getComputedStyle(m).transform }, { transform: tf }], spring(380, 0.05));
    m.style.transform = tf === 'none' ? '' : tf;
    this.d.classList.toggle('zoomed', s > 1);
  }

  gestures() {
    const stage = this.$('.vw-stage');
    const pts = new Map();
    let g = null;          // gesto em andamento
    let lastTap = 0, tapTimer = null;
    const center = () => { const a = [...pts.values()]; return { x: (a[0].x + (a[1]?.x ?? a[0].x)) / 2, y: (a[0].y + (a[1]?.y ?? a[0].y)) / 2 }; };
    const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };

    stage.addEventListener('pointerdown', e => {
      if (e.target.closest('.vw-nav, audio, a, button') || (e.target.tagName === 'VIDEO' && e.offsetY > e.target.clientHeight - 64)) return;
      if (this.busy || this.closing) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { stage.setPointerCapture(e.pointerId); } catch { /* ok */ }
      const z = this.zoom;
      if (pts.size === 2 && this.kind === 'image') g = { type: 'pinch', d0: dist(), s0: z.s, x0: z.x, y0: z.y, c0: center() };
      else if (pts.size === 1) {
        const now = performance.now();
        g = { type: z.s > 1 ? 'pan' : null, x0: e.clientX, y0: e.clientY, zx: z.x, zy: z.y, t0: now, last: { x: e.clientX, y: e.clientY, t: now }, v: { x: 0, y: 0 } };
      }
    });
    stage.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId) || !g) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const m = this.media();
      if (!m) return;
      if (g.type === 'pinch') {
        if (pts.size === 2) { const c = center(); this.setZoom(g.s0 * dist() / g.d0, g.x0 + c.x - g.c0.x, g.y0 + c.y - g.c0.y); }
        return;
      }
      const now = performance.now();
      const dt = Math.max(1, now - g.last.t);
      g.v = { x: (e.clientX - g.last.x) / dt, y: (e.clientY - g.last.y) / dt };
      g.last = { x: e.clientX, y: e.clientY, t: now };
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
      if (g.type === 'pan') { this.setZoom(this.zoom.s, g.zx + dx, g.zy + dy); return; }
      if (!g.type) {
        if (Math.hypot(dx, dy) < 9) return;
        g.type = Math.abs(dy) > Math.abs(dx) ? 'dismiss' : 'swipe';
      }
      if (g.type === 'dismiss') {
        const k = Math.max(0, dy);
        m.style.transform = `translate(${dx * 0.6}px, ${dy}px) scale(${1 - Math.min(0.3, k / 1400)})`;
        this.d.style.backgroundColor = `rgba(0,0,0,${Math.max(0, 1 - k / 420)})`;
        this.d.classList.add('dragging');
      } else {
        const edge = (dx > 0 && this.i === 0) || (dx < 0 && this.i >= this.ids.length - 1);
        m.style.transform = `translateX(${edge ? dx * 0.3 : dx}px)`;
      }
    });
    const settle = m => { if (!m) return; m.animate([{ transform: m.style.transform || 'none' }, { transform: 'none' }], spring(420, 0.15)); m.style.transform = ''; };
    const end = e => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (!g) return;
      const m = this.media();
      if (g.type === 'pinch') {
        if (pts.size === 0) { if (this.zoom.s < 1.05) this.setZoom(1, 0, 0, true); g = null; }
        else { const p = [...pts.values()][0]; const now = performance.now(); g = { type: 'pan', x0: p.x, y0: p.y, zx: this.zoom.x, zy: this.zoom.y, t0: now, last: { x: p.x, y: p.y, t: now }, v: { x: 0, y: 0 } }; }
        return;
      }
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
      const { type, v } = g, dur = performance.now() - g.t0;
      g = null;
      if (type === 'dismiss') {
        this.d.classList.remove('dragging');
        if (dy > 110 || v.y > 0.55) { tick(8); this.close(); return; }
        settle(m);
        this.d.animate([{ backgroundColor: this.d.style.backgroundColor }, { backgroundColor: 'rgb(0,0,0)' }], { duration: 250 });
        this.d.style.backgroundColor = '';
        return;
      }
      if (type === 'swipe') {
        const step = dx < 0 ? 1 : -1;
        const ok = (Math.abs(dx) > stage.clientWidth * 0.22 || Math.abs(v.x) > 0.45) && this.i + step >= 0 && this.i + step < this.ids.length;
        if (ok) this.slide(step, dx); else settle(m);
        return;
      }
      if (type === 'pan') return;
      // Toque: um esconde/mostra as barras, dois dão zoom.
      if (Math.hypot(dx, dy) > 9 || dur > 400) return;
      const now = performance.now();
      if (now - lastTap < 300 && this.kind === 'image') {
        clearTimeout(tapTimer);
        lastTap = 0;
        const r = stage.getBoundingClientRect();
        if (this.zoom.s > 1) this.setZoom(1, 0, 0, true);
        else { const s = 2.6; this.setZoom(s, -(e.clientX - r.left - r.width / 2) * (s - 1), -(e.clientY - r.top - r.height / 2) * (s - 1), true); }
        tick(6);
        return;
      }
      lastTap = now;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => this.d.classList.toggle('bare'), 300);
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    // Pinça no trackpad (Ctrl + rodinha) e rodinha com a foto ampliada.
    stage.addEventListener('wheel', e => {
      if (this.kind !== 'image') return;
      if (e.ctrlKey) { e.preventDefault(); this.setZoom(this.zoom.s * Math.exp(-e.deltaY / 120), this.zoom.x, this.zoom.y); }
      else if (this.zoom.s > 1) { e.preventDefault(); this.setZoom(this.zoom.s, this.zoom.x - e.deltaX, this.zoom.y - e.deltaY); }
    }, { passive: false });
  }

  destroy() { try { this.d.close(); } catch { /* ok */ } this.d.remove(); }
}
