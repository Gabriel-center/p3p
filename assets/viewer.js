// Visualizador em tela cheia: fotos, vídeos (com play) e áudios. Setas, teclado (← →), deslizar no celular
// e faixa de miniaturas quando é um lote. Quem chama passa resolve(id) → como mostrar aquele item agora.
//   item = { id, name, kind, src, poster, blur, status, href, download, meta, label }
export class Viewer {
  constructor({ resolve, esc, icons, t }) {
    this.resolve = resolve;
    this.esc = esc;
    this.icons = icons;
    this.t = t;
    this.ids = [];
    this.i = 0;
    const d = document.createElement('dialog');
    d.className = 'viewer';
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
    this.$('.vw-x').addEventListener('click', () => d.close());
    this.$('.prev').addEventListener('click', () => this.go(-1));
    this.$('.next').addEventListener('click', () => this.go(1));
    d.addEventListener('close', () => { this.$('.vw-media').innerHTML = ''; this.key = null; });
    d.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); this.go(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); this.go(1); }
    });
    this.$('.vw-stage').addEventListener('click', e => { if (e.target.classList.contains('vw-stage') || e.target.classList.contains('vw-media')) d.close(); });
    this.$('.vw-strip').addEventListener('click', e => {
      const b = e.target.closest('[data-vi]');
      if (b) this.show(Number(b.dataset.vi));
    });
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
    this.render();
    this.renderStrip();
  }
  go(step) { if (this.i + step >= 0 && this.i + step < this.ids.length) this.show(this.i + step); }

  openWith(ids, index = 0) {
    this.ids = ids;
    if (!this.d.open) this.d.showModal();
    this.show(index);
    // Foco no próprio visualizador: as setas do teclado funcionam e nenhum botão fica com o anel de foco.
    this.d.focus({ preventScroll: true });
  }

  /** Chamado o tempo todo pelo app: troca a mídia quando o arquivo termina de chegar, atualiza o progresso. */
  refresh() {
    if (!this.d.open) return;
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
      if (it.src && it.kind === 'image') html = `<img src="${esc(it.src)}" alt="${esc(it.name)}">`;
      else if (it.src && it.kind === 'video') html = `<video src="${esc(it.src)}" controls autoplay playsinline${it.poster ? ` poster="${esc(it.poster)}"` : ''}></video>`;
      else if (it.src && it.kind === 'audio') html = `<div class="vw-file"><span class="vw-ext">${this.icons.music}</span><b>${esc(it.name)}</b><audio src="${esc(it.src)}" controls autoplay></audio></div>`;
      else if (it.poster) html = `<div class="vw-wait"><img class="${it.blur ? 'blur' : ''}" src="${esc(it.poster)}" alt=""><span class="vw-status"></span></div>`;
      else html = `<div class="vw-file"><span class="vw-ext">${esc(it.label || '')}</span><b>${esc(it.name)}</b><span class="vw-status"></span>${it.href ? `<a class="btn solid" href="${esc(it.href)}"${it.download ? ` download="${esc(it.download)}"` : ''}>${this.icons.down}${esc(t('Baixar'))}</a>` : ''}</div>`;
      box.innerHTML = html;
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

  destroy() { try { this.d.close(); } catch { /* ok */ } this.d.remove(); }
}
