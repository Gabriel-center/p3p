// Teste ponta a ponta: três navegadores na mesma sala.
// Precisa de: site em http://127.0.0.1:8788 e `wrangler dev` em http://127.0.0.1:8787.
// Uso: node test/e2e.cjs <pasta com puppeteer-core e @sparticuz/chromium> <pasta de saída>
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const MODS = process.argv[2];
const OUT = process.argv[3] || '/tmp';
const puppeteer = require(path.join(MODS, 'puppeteer-core'));
const chromium = require(path.join(MODS, '@sparticuz/chromium'));

const SITE = 'http://127.0.0.1:8788';
const room = 'e2e-' + Math.random().toString(36).slice(2, 7);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');

function makeFiles() {
  const dir = path.join(OUT, 'files');
  fs.mkdirSync(dir, { recursive: true });
  const lines = [];
  for (let i = 0; i < 400000; i++) lines.push(`${i}\tsensor-${i % 97}\t${(Math.sin(i) * 1000).toFixed(3)}\tok\n`);
  const text = Buffer.from(lines.join(''));
  const rnd = crypto.randomBytes(60 * 1024 * 1024);
  const small = crypto.randomBytes(3 * 1024 * 1024 + 123);
  const files = { text: path.join(dir, 'medicoes.tsv'), rnd: path.join(dir, 'video-bruto.bin'), small: path.join(dir, 'fotos.bin') };
  fs.writeFileSync(files.text, text);
  fs.writeFileSync(files.rnd, rnd);
  fs.writeFileSync(files.small, small);
  return { files, hashes: { text: sha(text), rnd: sha(rnd), small: sha(small) }, sizes: { text: text.length, rnd: rnd.length } };
}

const results = [];
async function step(name, fn) {
  const t0 = Date.now();
  try { const extra = await fn(); results.push(['ok', name]); console.log(`✔ ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)${extra ? ' — ' + extra : ''}`); }
  catch (e) { results.push(['falhou', name, e.message]); console.log(`✘ ${name}\n   ${e.message}`); }
}

async function waitFor(page, fn, arg, timeout = 30000) {
  return page.waitForFunction(fn, { timeout, polling: 200 }, arg);
}

(async () => {
  const { files, hashes, sizes } = makeFiles();
  const browser = await puppeteer.launch({
    executablePath: await chromium.executablePath(),
    args: [...chromium.args.filter(a => !/single-process|no-zygote/.test(a)), '--disable-features=WebRtcHideLocalIpsWithMdns', '--autoplay-policy=no-user-gesture-required'],
    headless: true
  });
  const pages = {};
  const errors = [];
  async function open(name, viewport = { width: 1440, height: 900 }) {
    const ctx = await browser.createBrowserContext();
    const p = await ctx.newPage();
    await p.setViewport(viewport);
    p.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_TUNNEL|net::ERR/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
    await p.goto(`${SITE}/?${room}`, { waitUntil: 'domcontentloaded' });
    pages[name] = p;
    return p;
  }
  const peerIdOf = async p => p.evaluate(() => window.__p2p.me.peerId);
  const blobHash = (p, sel) => p.evaluate(async sel => {
    const a = [...document.querySelectorAll(sel)].pop();
    const buf = await (await fetch(a.href)).arrayBuffer();
    const h = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
  }, sel);

  const A = await open('A');
  const B = await open('B');
  const C = await open('C', { width: 390, height: 844 });

  await step('três aparelhos entram e conectam direto', async () => {
    for (const p of [A, B, C]) await waitFor(p, () => window.__p2p && window.__p2p.peers.size === 2);
    const dump = async () => (await Promise.all([A, B, C].map(p => p.evaluate(() => JSON.stringify([...window.__p2p.mesh.links.values()].map(l => ({ init: l.initiator, path: l.path, pc: l.pc && l.pc.connectionState, ice: l.pc && l.pc.iceConnectionState, sig: l.pc && l.pc.signalingState, dc: l.dc && l.dc.readyState, log: l.path !== 'direct' ? l.log : undefined }))))))).join('\n   ');
    try {
      for (const p of [A, B, C]) await waitFor(p, () => window.__p2p.mesh.links.size === 2 && [...window.__p2p.mesh.links.values()].every(l => l.path === 'direct'), null, 30000);
    } catch (e) { throw new Error(e.message + '\n   ' + await dump()); }
    const n = await A.$$eval('#devices-pane .path.direct', els => els.length);
    if (n !== 2) throw new Error(`esperava 2 pílulas Direto, achei ${n}`);
  });

  await step('mensagem chega nos outros dois', async () => {
    await A.type('#msg', 'olá, sala! https://example.com/teste');
    await A.click('#composer .send');
    for (const p of [B, C]) await waitFor(p, () => [...document.querySelectorAll('#feed .msg .body')].some(b => b.textContent.includes('olá, sala!')));
    await waitFor(A, () => !document.querySelector('#feed .msg.pending'));
    const link = await B.$eval('#feed .msg .body a', a => a.href);
    if (link !== 'https://example.com/teste') throw new Error('link errado ' + link);
  });

  await step('texto de 10 MB para todos, com compressão', async () => {
    const input = await A.$('#file-input');
    await input.uploadFile(files.text);
    for (const p of [B, C]) await waitFor(p, () => [...document.querySelectorAll('#feed .xfer a[download]')].some(a => a.download === 'medicoes.tsv'), null, 90000);
    const hb = await blobHash(B, '#feed .xfer a[download="medicoes.tsv"]');
    const hc = await blobHash(C, '#feed .xfer a[download="medicoes.tsv"]');
    if (hb !== hashes.text || hc !== hashes.text) throw new Error('conteúdo diferente do original');
    const codec = await A.evaluate(() => [...window.__p2p.transfers.out.values()].map(t => `${t.codec} ${Math.round((1 - t.ratio) * 100)}%`).join(', '));
    await waitFor(A, () => [...window.__p2p.transfers.out.values()].every(t => t.state === 'done'));
    return `codec: ${codec}`;
  });

  await step('60 MB aleatórios para B, conexão cai no meio e retoma', async () => {
    const bId = await peerIdOf(B);
    await A.select('#target', bId);
    const input = await A.$('#file-input');
    await input.uploadFile(files.rnd);
    await waitFor(B, () => [...window.__p2p.transfers.inc.values()].some(t => t.name === 'video-bruto.bin' && t.written > 15), null, 60000);
    const before = await B.evaluate(() => [...window.__p2p.transfers.inc.values()].find(t => t.name === 'video-bruto.bin').written);
    await A.evaluate(id => window.__p2p.mesh.links.get(id).dc.close(), bId);
    await waitFor(A, () => [...window.__p2p.transfers.out.values()].some(t => t.name === 'video-bruto.bin' && t.state === 'interrupted'), null, 10000).catch(() => {});
    await waitFor(B, () => [...document.querySelectorAll('#feed .xfer a[download]')].some(a => a.download === 'video-bruto.bin'), null, 120000);
    const h = await blobHash(B, '#feed .xfer a[download="video-bruto.bin"]');
    if (h !== hashes.rnd) throw new Error('conteúdo diferente depois da retomada');
    const codec = await A.evaluate(() => [...window.__p2p.transfers.out.values()].find(t => t.name === 'video-bruto.bin').codec);
    await A.select('#target', 'all');
    return `caiu no bloco ${before}, retomou e terminou; codec ${codec}`;
  });

  await step('sem conexão direta com C: arquivo vai pela nuvem', async () => {
    const cId = await peerIdOf(C);
    await A.select('#target', cId);
    await A.evaluate(id => { const l = window.__p2p.mesh.links.get(id); l.closePc(); l.fallBack(); }, cId);
    const input = await A.$('#file-input');
    await input.uploadFile(files.small);
    await waitFor(C, () => [...document.querySelectorAll('#feed .xfer.server a.btn.solid')].length > 0, null, 60000);
    const h = await C.evaluate(async () => {
      const a = [...document.querySelectorAll('#feed .xfer.server a.btn.solid')].pop();
      const buf = await (await fetch(a.href)).arrayBuffer();
      const d = await crypto.subtle.digest('SHA-256', buf);
      return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
    });
    if (h !== hashes.small) throw new Error('conteúdo da nuvem diferente');
    await A.select('#target', 'all');
    await A.evaluate(id => window.__p2p.mesh.links.get(id).recreate('test'), cId);
  });

  await step('guardar na sala e baixar de outro aparelho', async () => {
    const input = await B.$('#shelf-input');
    await input.uploadFile(files.text);
    await waitFor(A, () => [...document.querySelectorAll('#shelf li .fname')].some(e => e.textContent === 'medicoes.tsv'), null, 60000);
    const h = await A.evaluate(async () => {
      const li = [...document.querySelectorAll('#shelf li')].find(l => l.querySelector('.fname')?.textContent === 'medicoes.tsv');
      const buf = await (await fetch(li.querySelector('a').href)).arrayBuffer();
      const d = await crypto.subtle.digest('SHA-256', buf);
      return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
    });
    if (h !== hashes.text) throw new Error('arquivo guardado diferente');
    const enc = await A.evaluate(() => [...window.__p2p.files.values()].find(f => f.name === 'medicoes.tsv'));
    return `guardado com ${enc.encoding || 'sem compressão'}: ${(enc.storedSize / 1048576).toFixed(1)} MB de ${(enc.size / 1048576).toFixed(1)} MB`;
  });

  await step('senha na sala: quem chega precisa digitar', async () => {
    await A.click('#settings');
    await A.type('#pw-new', 'jabuticaba');
    await A.click('#pw-save');
    await waitFor(B, () => !document.querySelector('.lock').hidden);
    const D = await open('D');
    await waitFor(D, () => !document.querySelector('#gate').hidden && document.querySelector('#auth-pw'));
    await D.type('#auth-pw', 'errada');
    await D.click('#auth-form .btn.solid');
    await waitFor(D, () => document.querySelector('#auth-form .err') && !document.querySelector('#auth-form .err').hidden);
    await D.$eval('#auth-pw', e => { e.value = ''; });
    await D.type('#auth-pw', 'jabuticaba');
    await D.click('#auth-form .btn.solid');
    await waitFor(D, () => document.querySelector('#gate').hidden && window.__p2p.peers.size === 3);
    await D.close();
    await A.keyboard.press('Escape');
  });

  await step('painel de uso mostra porcentagem e reset', async () => {
    await A.evaluate(() => window.__p2p.loadUsage());
    await waitFor(A, () => !document.querySelector('#usage-chip').hidden);
    return await A.$eval('#usage-chip', e => e.textContent.trim().replace(/\s+/g, ' '));
  });

  await step('apagar tudo exige senha de admin', async () => {
    await A.click('#settings');
    await A.type('#admin-pw', 'chute');
    await A.click('#wipe-form .btn.danger');
    await waitFor(A, () => !document.querySelector('#wipe-err').hidden);
    await A.$eval('#admin-pw', e => { e.value = ''; });
    await A.type('#admin-pw', 'admin');
    await A.click('#wipe-form .btn.danger');
    await waitFor(B, () => window.__p2p.files.size === 0 && !document.querySelector('#feed .msg'), null, 15000);
  });

  await A.screenshot({ path: path.join(OUT, 'e2e-A-desktop.png') });
  await C.screenshot({ path: path.join(OUT, 'e2e-C-phone.png') });
  await B.screenshot({ path: path.join(OUT, 'e2e-B-desktop.png') });

  console.log(errors.length ? `\nErros de página:\n${[...new Set(errors)].slice(0, 15).join('\n')}` : '\nSem erros de página.');
  const bad = results.filter(r => r[0] !== 'ok');
  console.log(`${results.length - bad.length}/${results.length} passaram`);
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
