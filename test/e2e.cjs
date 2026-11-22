// Teste ponta a ponta: três navegadores na mesma sala.
// Precisa de: site em http://127.0.0.1:8788 e `wrangler dev` em http://127.0.0.1:8787.
// Uso: node test/e2e.cjs <pasta com puppeteer-core e @sparticuz/chromium> <pasta de saída>
//   ou CHROME=/caminho/do/chrome node test/e2e.cjs <pasta com puppeteer-core> <pasta de saída>
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const MODS = process.argv[2];
const OUT = process.argv[3] || '/tmp';
const puppeteer = require(path.join(MODS, 'puppeteer-core'));
const chromium = process.env.CHROME ? null : require(path.join(MODS, '@sparticuz/chromium'));

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

// PNG sem depender de nada: fn(x, y) → [r, g, b].
function png(w, h, fn) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = fn(x, y); const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Lote de teste: 5 imagens (uma grande, com ruído), um vídeo (se houver ffmpeg) e um texto. */
function makeMedia() {
  const dir = path.join(OUT, 'lote');
  fs.mkdirSync(dir, { recursive: true });
  const list = [];
  const add = (name, buf) => { const p = path.join(dir, name); fs.writeFileSync(p, buf); list.push({ name, path: p, hash: sha(buf) }); };
  add('praia.png', png(1200, 800, (x, y) => [30 + y / 5, 120 + x / 10, 200 - y / 6]));
  add('retrato.png', png(700, 1100, (x, y) => [200 - y / 8, 90 + x / 6, 120 + ((x ^ y) & 31)]));
  add('ruido-grande.png', png(1300, 1000, () => [Math.random() * 255, Math.random() * 255, Math.random() * 255]));
  let video = null;
  try {
    const v = path.join(dir, 'clipe.webm');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=4:size=640x360:rate=25', '-c:v', 'libvpx', '-b:v', '600k', v]);
    const buf = fs.readFileSync(v);
    list.push({ name: 'clipe.webm', path: v, hash: sha(buf) });
    video = 'clipe.webm';
  } catch { /* sem ffmpeg: lote sem vídeo */ }
  add('quadrado.png', png(600, 600, (x, y) => [(x * 255 / 600) | 0, (y * 255 / 600) | 0, 160]));
  add('panorama.png', png(1600, 500, (x, y) => [80 + x / 12, 60 + y / 4, 90]));
  add('notas.txt', Buffer.from(Array.from({ length: 4000 }, (_, i) => `nota ${i}: tudo certo por aqui\n`).join('')));
  return { list, video };
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
  const media = makeMedia();
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || await chromium.executablePath(),
    args: [...(chromium ? chromium.args.filter(a => !/single-process|no-zygote/.test(a)) : ['--no-sandbox']), '--disable-features=WebRtcHideLocalIpsWithMdns', '--autoplay-policy=no-user-gesture-required'],
    headless: true
  });
  const pages = {};
  const errors = [];
  async function open(name, viewport = { width: 1440, height: 900 }) {
    const ctx = await browser.createBrowserContext();
    const p = await ctx.newPage();
    await p.setViewport(viewport);
    await p.evaluateOnNewDocument(() => Object.defineProperty(navigator, 'language', { get: () => 'pt-BR' }));
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

  await step('QR continua na lateral com gente na sala e abre grande', async () => {
    const side = await A.$eval('#devices-pane .qr-tile svg', e => Math.round(e.getBoundingClientRect().width));
    if (!(side > 100)) throw new Error('QR da lateral sumiu: ' + side);
    const center = await B.$eval('#feed-empty .qrmini svg', e => Math.round(e.getBoundingClientRect().width));
    await A.click('#side-qr');
    await waitFor(A, () => document.querySelector('#qr-dialog').open);
    await sleep(300);
    const big = await A.$eval('#qr-box svg', e => Math.round(e.getBoundingClientRect().width));
    await A.screenshot({ path: path.join(OUT, 'e2e-qr-aberto.png') });
    await A.keyboard.press('Escape');
    if (big < 360) throw new Error('QR do convite pequeno: ' + big);
    return `lateral ${side} px, na conversa ${center} px, aberto ${big} px`;
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

  await step('cartões mostram a compressão (% e antes → depois) e a conferência SHA-256', async () => {
    const line = (p, sel) => p.evaluate(sel => [...document.querySelectorAll('#feed .xfer')].filter(x => x.querySelector('.fname')?.textContent === 'medicoes.tsv').map(x => x.querySelector(sel)?.textContent.replace(/\s+/g, ' ').trim() || ''), sel);
    await waitFor(B, () => [...document.querySelectorAll('#feed .xfer .comp .ok')].length > 0, null, 10000);
    const a = await line(A, '.comp'), b = await line(B, '.comp');
    for (const x of [...a, ...b]) if (!/(Comprimido|Compressed) \d+%/.test(x) || !/\d.* → \d/.test(x)) throw new Error('linha de compressão incompleta: ' + x);
    if (!/Idêntico|Identical/.test(b[0]) || !a.every(x => /Idêntico|Identical/.test(x))) throw new Error('faltou a conferência: ' + [...a, ...b].join(' | '));
    const intact = await B.evaluate(() => [...window.__p2p.transfers.inc.values()].filter(t => t.name === 'medicoes.tsv').map(t => `${t.verified}/${t.blocks}`));
    return `${b[0]} (blocos conferidos: ${intact})`;
  });

  await step('lote com fotos, vídeo e texto vira álbum, abre no visualizador e baixa em .zip', async () => {
    const n = media.list.length;
    const input = await A.$('#file-input');
    await input.uploadFile(...media.list.map(f => f.path));
    const album = '#feed .xfer.album:not(.mine)';
    await waitFor(B, ([sel, n]) => { const a = document.querySelector(sel); return a && a.querySelectorAll('.album-grid .tile').length === 4 && a.querySelector('.tile .more')?.textContent === `+${n - 4}`; }, [album, n], 30000);
    const early = await B.evaluate(sel => document.querySelectorAll(`${sel} .tile img`).length, album);
    await B.screenshot({ path: path.join(OUT, 'e2e-lote-chegando.png') });
    for (const p of [B, C]) await waitFor(p, () => [...window.__p2p.albums.values()].some(a => !a.mine && !a.active && a.ids.filter(Boolean).length === a.n), null, 180000);
    const got = await B.evaluate(async () => {
      const a = [...window.__p2p.albums.values()].find(a => !a.mine);
      const out = {};
      for (const id of a.ids) {
        const m = window.__p2p.models.get(id);
        const d = new Uint8Array(await crypto.subtle.digest('SHA-256', await m.blob.arrayBuffer()));
        out[m.name] = { h: [...d].map(b => b.toString(16).padStart(2, '0')).join(''), intact: m.intact, codec: m.codec };
      }
      return out;
    });
    for (const f of media.list) {
      if (got[f.name]?.h !== f.hash) throw new Error(`${f.name} chegou diferente`);
      if (!got[f.name].intact) throw new Error(`${f.name} sem conferência`);
    }
    await waitFor(A, () => document.querySelectorAll('#feed .xfer.album.mine .tile img:not(.blur)').length >= 3, null, 20000);
    await waitFor(B, sel => document.querySelectorAll(`${sel} .tile img:not(.blur)`).length >= 3, album, 20000);
    await B.evaluate(sel => document.querySelector(sel).scrollIntoView(), album);
    await B.screenshot({ path: path.join(OUT, 'e2e-lote-B.png') });
    await C.evaluate(() => document.querySelector('#feed .xfer.album:not(.mine)').scrollIntoView());
    await C.screenshot({ path: path.join(OUT, 'e2e-lote-C-celular.png') });
    // Visualizador: abre a primeira foto
    await B.click(`${album} .tile`);
    await waitFor(B, () => document.querySelector('#viewer').open && document.querySelector('#viewer .vw-media img')?.naturalWidth > 0, null, 10000);
    const strip = await B.$$eval('#viewer .vw-strip button', b => b.length);
    if (strip !== n) throw new Error(`faixa com ${strip} miniaturas, esperava ${n}`);
    await B.screenshot({ path: path.join(OUT, 'e2e-visualizador-foto.png') });
    await B.keyboard.press('ArrowRight');
    await waitFor(B, () => document.querySelector('#viewer .vw-count').textContent.startsWith('2 /'));
    let played = 'sem ffmpeg';
    if (media.video) {
      const vi = media.list.findIndex(f => f.name === media.video);
      await B.evaluate(i => document.querySelector(`#viewer [data-vi="${i}"]`).click(), vi);
      await waitFor(B, () => { const v = document.querySelector('#viewer video'); return v && v.readyState >= 2; }, null, 10000);
      const at = await B.evaluate(async () => { const v = document.querySelector('#viewer video'); v.muted = true; await v.play(); await new Promise(r => setTimeout(r, 1500)); return v.currentTime; });
      if (!(at > 0.5)) throw new Error('vídeo não tocou: ' + at);
      await B.screenshot({ path: path.join(OUT, 'e2e-visualizador-video.png') });
      played = `vídeo tocou até ${at.toFixed(1)} s`;
    }
    await B.keyboard.press('Escape');
    // Baixar tudo em .zip
    await B.click(`${album} [data-act="zip"]`);
    await waitFor(B, () => !!window.__p2p.lastZip, null, 60000);
    const b64 = await B.evaluate(async () => { const b = new Uint8Array(await window.__p2p.lastZip.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); });
    const zipPath = path.join(OUT, 'lote.zip');
    fs.writeFileSync(zipPath, Buffer.from(b64, 'base64'));
    const inZip = JSON.parse(execFileSync('python3', ['-c', 'import zipfile,hashlib,json,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps({i.filename: hashlib.sha256(z.read(i)).hexdigest() for i in z.infolist()}))', zipPath]).toString());
    for (const f of media.list) if (inZip[f.name] !== f.hash) throw new Error(`${f.name} diferente dentro do zip`);
    const comp = await B.$eval(`${album} .comp`, e => e.textContent.replace(/\s+/g, ' ').trim());
    return `${n} arquivos, ${early} miniaturas antes de chegar, ${played}, zip com ${Object.keys(inZip).length} arquivos idênticos; ${comp}`;
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
    try {
      await waitFor(B, () => [...document.querySelectorAll('#feed .xfer a[download]')].some(a => a.download === 'video-bruto.bin'), null, 120000);
    } catch (e) {
      const a = await A.evaluate(() => [...window.__p2p.transfers.out.values()].filter(t => t.name === 'video-bruto.bin').map(t => `${t.state} ${t.acked}/${t.blocks} ${t.error || ''}`).join(';') + ' | ' + [...window.__p2p.mesh.links.values()].map(l => `${l.path} ${l.dc && l.dc.readyState}`).join(','));
      const b = await B.evaluate(() => [...window.__p2p.transfers.inc.values()].filter(t => t.name === 'video-bruto.bin').map(t => `${t.state} ${t.written}/${t.blocks} bad=${t.bad} ${t.error || ''}`).join(';'));
      const logs = await Promise.all([A, B].map(p => p.evaluate(() => JSON.stringify([...window.__p2p.mesh.links.values()].map(l => ({ init: l.initiator, path: l.path, log: (l.log || []).slice(-25) }))))));
      throw new Error(`${e.message}\n   A: ${a}\n   B: ${b}\n   logs A: ${logs[0]}\n   logs B: ${logs[1]}`);
    }
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
  });

  await step('lote pela nuvem: C vê o álbum com miniaturas e baixa tudo em .zip', async () => {
    const pick = media.list.filter(f => /png|txt/.test(f.name)).slice(0, 3);
    const input = await A.$('#file-input');
    await input.uploadFile(...pick.map(f => f.path));
    await waitFor(C, n => [...window.__p2p.albums.values()].some(a => !a.mine && a.n === n && a.ids.filter(Boolean).length === n && !a.active), pick.length, 60000);
    const info = await C.evaluate(() => { const a = [...window.__p2p.albums.values()].filter(a => !a.mine).pop(); return { thumbs: a.el.querySelectorAll('.tile img').length, kinds: a.ids.map(id => window.__p2p.models.get(id)?.kind || window.__p2p.cardModels?.get(id)?.kind) }; });
    if (!info.kinds.every(k => k === 'cloud-in')) throw new Error('esperava tudo pela nuvem: ' + info.kinds);
    await C.evaluate(() => { window.__p2p.lastZip = null; const a = [...window.__p2p.albums.values()].filter(a => !a.mine).pop(); a.el.scrollIntoView(); a.el.querySelector('[data-act="zip"]').click(); });
    await waitFor(C, () => !!window.__p2p.lastZip, null, 60000);
    await C.screenshot({ path: path.join(OUT, 'e2e-lote-nuvem-C.png') });
    const b64 = await C.evaluate(async () => { const b = new Uint8Array(await window.__p2p.lastZip.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); });
    const zipPath = path.join(OUT, 'lote-nuvem.zip');
    fs.writeFileSync(zipPath, Buffer.from(b64, 'base64'));
    const inZip = JSON.parse(execFileSync('python3', ['-c', 'import zipfile,hashlib,json,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps({i.filename: hashlib.sha256(z.read(i)).hexdigest() for i in z.infolist()}))', zipPath]).toString());
    for (const f of pick) if (inZip[f.name] !== f.hash) throw new Error(`${f.name} diferente no zip da nuvem`);
    const comp = await C.evaluate(() => [...window.__p2p.albums.values()].filter(a => !a.mine).pop().el.querySelector('.comp')?.textContent.replace(/\s+/g, ' ').trim());
    await A.select('#target', 'all');
    const cId = await peerIdOf(C);
    await A.evaluate(id => window.__p2p.mesh.links.get(id).recreate('test'), cId);
    return `${info.thumbs} miniaturas, zip com ${Object.keys(inZip).length} arquivos idênticos; ${comp}`;
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
