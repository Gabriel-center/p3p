// Teste do movimento, gestos, app instalável, ⌘K e leitor de QR (assets/next.js) com navegadores de verdade.
// Precisa do servidor local (npm run dev) e do site em http://127.0.0.1:8788 (python3 -m http.server 8788).
// Uso: CHROME=/caminho/do/chrome node test/vidro.e2e.cjs <pasta com puppeteer-core> <pasta de saída> [vídeo .y4m com um QR de sala]
//   O .y4m (ffmpeg -loop 1 -i qr.png -t 2 -pix_fmt yuv420p qr.y4m) vira a "câmera" do leitor de QR (opcional: sem ele, o passo do leitor é pulado).
const path = require('path');
const fs = require('fs');
const MODS = process.argv[2];
const OUT = process.argv[3] || '/tmp';
const QR_VIDEO = process.argv[4] || '';
const puppeteer = require(path.join(MODS, 'puppeteer-core'));
const SITE = 'http://127.0.0.1:8788/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const room = `vt-${Math.random().toString(36).slice(2, 7)}`;
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const results = [];
async function step(name, fn) {
  const t0 = Date.now();
  try { const note = await fn(); results.push(true); console.log(`✔ ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)${note ? ` — ${note}` : ''}`); }
  catch (e) { results.push(false); console.log(`✘ ${name}\n   ${e.message}`); }
}
const waitFor = (p, fn, arg, timeout = 15000) => p.waitForFunction(fn, { timeout, polling: 100 }, arg);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const args = ['--no-sandbox', '--disable-features=WebRtcHideLocalIpsWithMdns'];
  if (QR_VIDEO) args.push('--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${QR_VIDEO}`);
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME, args, headless: true });
  const errors = [];
  const open = async (name, vp, url = `${SITE}?${room}`) => {
    const ctx = await browser.createBrowserContext();
    const p = await ctx.newPage();
    await p.setViewport(vp);
    await p.evaluateOnNewDocument(() => Object.defineProperty(navigator, 'language', { get: () => 'pt-BR' }));
    p.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    p.on('console', m => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
    await p.goto(url);
    return p;
  };
  const A = await open('A', { width: 1280, height: 860 });
  const B = await open('B', PHONE);
  const peerIdOf = p => p.evaluate(() => window.__p2p.me.peerId);

  await step('dois aparelhos conectam direto', async () => {
    await waitFor(A, () => window.__p2p?.peers.size === 1 && [...window.__p2p.mesh.links.values()].every(l => l.path === 'direct'), null, 30000);
  });

  await step('barra de abas: a marca desliza até a aba tocada', async () => {
    const before = await B.$eval('.room-tabs .lens', l => l.getBoundingClientRect().left);
    await B.tap('[data-tab="files"]');
    await sleep(700);
    const [after, tab] = await B.evaluate(() => { const l = document.querySelector('.room-tabs .lens').getBoundingClientRect(); const t = document.querySelector('[data-tab="files"]').getBoundingClientRect(); return [l.left, t.left]; });
    await B.tap('[data-tab="feed"]');
    if (Math.abs(after - tab) > 2 || after <= before) throw new Error(`marca em ${after}, aba em ${tab}`);
    return `${Math.round(before)} → ${Math.round(after)} px`;
  });

  await step('mensagem nova entra com animação e o botão de enviar só aparece com texto', async () => {
    const hidden = await B.$eval('#composer .send', b => getComputedStyle(b).opacity);
    await A.type('#msg', 'Oi do computador, olha https://example.com');
    await A.click('#composer .send');
    await waitFor(B, () => document.querySelectorAll('#feed .msg').length >= 1);
    const animated = await B.evaluate(() => document.querySelector('#feed .msg').getAnimations().length);
    await B.type('#msg', 'Oi!');
    await sleep(500);
    const shown = await B.$eval('#composer .send', b => getComputedStyle(b).opacity);
    await B.tap('#composer .send');
    if (Number(hidden) > 0.1 || Number(shown) < 0.9) throw new Error(`opacidade do enviar: vazio ${hidden}, com texto ${shown}`);
    return `animações na mensagem: ${animated}`;
  });

  await step('deslizar a conversa para a esquerda mostra os horários', async () => {
    await waitFor(B, () => document.querySelectorAll('#feed .msg').length >= 2);
    const r = await B.$eval('#feed', f => { const b = f.getBoundingClientRect(); return { x: b.left + b.width * 0.6, y: b.top + b.height * 0.4 }; });
    await B.touchscreen.touchStart(r.x, r.y);
    for (let i = 1; i <= 8; i++) { await B.touchscreen.touchMove(r.x - i * 12, r.y + 1); await sleep(16); }
    const mid = await B.evaluate(() => ({ rv: getComputedStyle(document.querySelector('#feed')).getPropertyValue('--rv'), t: document.querySelector('#feed .msg').dataset.t }));
    await B.screenshot({ path: path.join(OUT, 'vt-horarios.png') });
    await B.touchscreen.touchEnd();
    if (!(Number(mid.rv) > 40) || !mid.t) throw new Error(JSON.stringify(mid));
    return `deslocamento ${mid.rv}, hora ${mid.t}`;
  });

  await step('toque longo na mensagem abre o menu (copiar e link)', async () => {
    const r = await B.$eval('#feed .msg:not(.mine) .body', b => { const x = b.getBoundingClientRect(); return { x: x.left + 30, y: x.top + x.height / 2 }; });
    await B.touchscreen.touchStart(r.x, r.y);
    await sleep(650);
    await B.touchscreen.touchEnd();
    await waitFor(B, () => !!document.querySelector('.ctx .ctx-menu'));
    const items = await B.$$eval('.ctx-menu button', b => b.map(x => x.textContent.trim()));
    await sleep(400);
    await B.screenshot({ path: path.join(OUT, 'vt-menu.png') });
    await sleep(800);
    await B.evaluate(() => document.querySelector('.ctx').click());
    await waitFor(B, () => !document.querySelector('.ctx'));
    if (!items.includes('Copiar') || !items.includes('Abrir link')) throw new Error(items.join(', '));
    return items.join(', ');
  });

  await step('foto abre crescendo do cartão, um toque esconde as barras, arrastar para baixo fecha', async () => {
    const png = fs.readFileSync(path.join(OUT, 'foto.png'));
    const input = await A.$('#file-input');
    await input.uploadFile(path.join(OUT, 'foto.png'));
    await waitFor(B, () => [...window.__p2p.transfers.inc.values()].some(t => t.state === 'done'), null, 30000);
    await sleep(800);
    await B.evaluate(() => { const f = document.querySelector('#feed'); f.style.scrollBehavior = 'auto'; f.scrollTop = f.scrollHeight; });
    await sleep(300);
    await B.tap('#feed .media');
    await sleep(120);
    const midAnim = await B.evaluate(() => document.querySelector('#viewer .vw-media img')?.getAnimations().length || 0);
    await sleep(700);
    const opened = await B.evaluate(() => document.querySelector('#viewer').open);
    const sz = await B.$eval('#viewer .vw-stage', s => { const r = s.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    await B.touchscreen.tap(sz.x + sz.width / 2, sz.y + sz.height / 2);
    await sleep(500);
    const bare = await B.evaluate(() => document.querySelector('#viewer').classList.contains('bare'));
    await B.screenshot({ path: path.join(OUT, 'vt-visualizador.png') });
    const x = sz.x + sz.width / 2, y = sz.y + sz.height / 2;
    await B.touchscreen.touchStart(x, y);
    for (let i = 1; i <= 10; i++) { await B.touchscreen.touchMove(x, y + i * 22); await sleep(16); }
    await B.screenshot({ path: path.join(OUT, 'vt-arrastando.png') });
    await B.touchscreen.touchEnd();
    await waitFor(B, () => !document.querySelector('#viewer').open, null, 3000);
    if (!opened || !midAnim || !bare) throw new Error(JSON.stringify({ opened, midAnim, bare }));
    return `${(png.length / 1024).toFixed(0)} KB, animação ao abrir, barras escondidas, fechou arrastando`;
  });

  await step('soltar arquivo sobre um aparelho manda só para ele', async () => {
    const C = await open('C', PHONE);
    await waitFor(A, () => window.__p2p.peers.size === 2 && [...window.__p2p.mesh.links.values()].every(l => l.path === 'direct'), null, 30000);
    const bId = await peerIdOf(B);
    await sleep(500);
    await A.evaluate(id => {
      const row = document.querySelector(`.device[data-peer="${id}"]`);
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(300000).fill(7)], 'so-para-b.bin'));
      row.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      row.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, bId);
    await waitFor(B, () => [...window.__p2p.transfers.inc.values()].some(t => t.name === 'so-para-b.bin' && t.state === 'done'), null, 20000);
    await sleep(1500);
    const cGot = await C.evaluate(() => [...window.__p2p.transfers.inc.values()].some(t => t.name === 'so-para-b.bin'));
    if (cGot) throw new Error('C também recebeu');
    // Anel no avatar enquanto manda algo maior para C
    const cId = await peerIdOf(C);
    await A.evaluate(id => {
      const v = window.__p2p; const prev = v.target; v.target = id;
      v.sendFiles([new File([crypto.getRandomValues(new Uint8Array(65536)), new Uint8Array(40 * 1024 * 1024)], 'grande.bin')]);
      v.target = prev;
    }, cId);
    await waitFor(A, id => Number(document.querySelector(`.device[data-peer="${id}"] .av.busy`)?.style.getPropertyValue('--p')) > 0.05, cId, 15000);
    const ring = await A.$eval(`.device[data-peer="${cId}"] .av.busy`, a => a.style.getPropertyValue('--p'));
    await A.screenshot({ path: path.join(OUT, 'vt-anel.png') });
    await C.close();
    return `só B recebeu; anel no avatar de C em ${(Number(ring) * 100).toFixed(0)}%`;
  });

  await step('busca de comandos (Ctrl+K) entra em outra sala pelo nome', async () => {
    await A.keyboard.down('Control'); await A.keyboard.press('k'); await A.keyboard.up('Control');
    await waitFor(A, () => document.querySelector('#palette')?.open);
    await A.type('#palette input', 'sala dois');
    await A.keyboard.press('Enter');
    await waitFor(A, () => location.search === '?sala-dois', null, 5000);
    await A.goto(`${SITE}?${room}`);
  });

  await step('compartilhar de outro app: escolhe a sala e o arquivo é enviado', async () => {
    const S = await open('S', PHONE, SITE);
    await waitFor(S, () => !!navigator.serviceWorker?.controller, null, 15000).catch(async () => { await S.reload(); await waitFor(S, () => !!navigator.serviceWorker?.controller, null, 15000); });
    // O que o sistema faz ao compartilhar: POST multipart para ./?share
    await S.evaluate(() => {
      const f = document.createElement('form');
      f.method = 'POST'; f.action = './?share'; f.enctype = 'multipart/form-data';
      const inp = document.createElement('input'); inp.type = 'file'; inp.name = 'files'; inp.multiple = true;
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(123456).fill(3)], 'compartilhado.bin', { type: 'application/octet-stream' }));
      inp.files = dt.files;
      const txt = document.createElement('input'); txt.name = 'text'; txt.value = 'veio do Compartilhar';
      f.append(inp, txt); document.body.appendChild(f); f.submit();
    });
    await waitFor(S, () => /[?&]share=/.test(location.search) && !!document.querySelector('#share-form'), null, 15000);
    await S.screenshot({ path: path.join(OUT, 'vt-compartilhar.png') });
    await S.type('#share-room', room);
    await S.click('#share-form button[type="submit"]');
    await waitFor(B, () => [...window.__p2p.transfers.inc.values()].some(t => t.name === 'compartilhado.bin' && t.state === 'done'), null, 30000);
    const text = await S.$eval('#msg', m => m.value);
    await S.close();
    if (text !== 'veio do Compartilhar') throw new Error(`texto: ${text}`);
    return 'arquivo chegou em B e o texto ficou no campo de mensagem';
  });

  if (QR_VIDEO) await step('leitor de QR: a câmera lê o código e entra na sala', async () => {
    const Q = await open('Q', PHONE, SITE);
    await waitFor(Q, () => !!document.querySelector('[data-scan]'));
    await Q.tap('[data-scan]');
    await waitFor(Q, () => location.search === '?sala-do-qr', null, 20000);
    await Q.close();
    return 'entrou em ?sala-do-qr';
  });

  console.log(errors.length ? `\nErros de página:\n${errors.join('\n')}` : '\nSem erros de página.');
  console.log(`${results.filter(Boolean).length}/${results.length} passaram`);
  await browser.close();
  process.exit(results.every(Boolean) && !errors.length ? 0 : 1);
})();
