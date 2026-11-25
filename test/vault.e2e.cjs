// Cofre (assets/vault.js): a conversa continua no aparelho depois de recarregar, quem entra depois vê os
// cartões e pede os arquivos a quem tem, "Remover deste aparelho" e a limpeza depois de 48 h.
// Uso: CHROME=/usr/bin/google-chrome node test/vault.e2e.cjs <node_modules com puppeteer-core> [./ ou vidro/] [pasta com as fotos]
// Precisa do servidor local (npm run dev) e do site em http://127.0.0.1:8788.
const puppeteer = require(require('path').join(process.argv[2] || '/tmp/mods/node_modules', 'puppeteer-core'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const site = process.argv[3] || './';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const L = (process.argv[4] || '/tmp/e2e/lote') + '/';   // fotos de teste: o test/e2e.cjs cria em /tmp/e2e/lote
(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox'], headless: true });
  const room = 'vt-' + Date.now().toString(36);
  const url = `http://127.0.0.1:8788/${site}?${room}`;
  const mk = async name => { const c = await b.createBrowserContext(); const p = await c.newPage(); await p.setViewport({ width: 1280, height: 900 }); p.on('pageerror', e => console.log(name, 'ERR', e.message)); p.on('console', m => { if (m.type() === 'error') console.log(name, 'console', m.text().slice(0, 200)); }); return p; };
  const A = await mk('A'), B = await mk('B');
  let fails = 0;
  const ok = (c, msg) => { if (!c) fails++; console.log(c ? 'OK  ' : 'FAIL', msg); };
  const welcome = p => p.waitForFunction(() => window.__p2p?.welcomed, { timeout: 20000 });
  const direct = (p, n) => p.waitForFunction(n => window.__p2p.peers.size === n && [...window.__p2p.mesh.links.values()].every(l => l.path === 'direct' && l.dc?.readyState === 'open'), { timeout: 30000 }, n);
  await A.goto(url); await B.goto(url); await welcome(A); await welcome(B); await direct(A, 1); await direct(B, 1);
  await A.type('#msg', 'antes das fotos'); await A.click('#composer .send'); await sleep(500);
  let inp = await A.$('#file-input');
  await inp.uploadFile(L + 'praia.png'); await sleep(400);
  inp = await A.$('#file-input');
  await inp.uploadFile(L + 'retrato.png', L + 'quadrado.png', L + 'notas.txt');
  await B.waitForFunction(() => [...window.__p2p.transfers.inc.values()].filter(t => t.state === 'done').length >= 4, { timeout: 60000 });
  await A.type('#msg', 'depois das fotos'); await A.click('#composer .send');
  await sleep(2500);   // cofre grava
  const feedSig = p => p.evaluate(() => [...document.querySelectorAll('#feed > *')].map(e => e.classList.contains('msg') ? 'msg:' + e.querySelector('.body').textContent : e.dataset.album ? 'album' : e.dataset.card ? 'card' : e.className));
  console.log('B before', JSON.stringify(await feedSig(B)));
  await B.reload(); await welcome(B); await sleep(2500);
  const sigB = await feedSig(B);
  console.log('B after ', JSON.stringify(sigB));
  ok(JSON.stringify(sigB) === JSON.stringify(['msg:antes das fotos', 'card', 'album', 'msg:depois das fotos']), 'B keeps cards after reload, in order');
  const prevB = await B.evaluate(() => [...document.querySelectorAll('#feed img')].filter(i => i.src.startsWith('blob:') || i.src.startsWith('data:')).length);
  ok(prevB >= 3, `B shows previews from local copies (${prevB})`);
  await A.reload(); await welcome(A); await sleep(2500);
  const sigA = await feedSig(A);
  ok(JSON.stringify(sigA) === JSON.stringify(['msg:antes das fotos', 'card', 'album', 'msg:depois das fotos']), 'A (sender) keeps cards after reload ' + JSON.stringify(sigA));
  // C entra depois
  const C = await mk('C');
  await C.goto(url); await welcome(C); await direct(C, 2); await sleep(3000);
  const sigC = await feedSig(C);
  ok(JSON.stringify(sigC) === JSON.stringify(['msg:antes das fotos', 'card', 'album', 'msg:depois das fotos']), 'late joiner C sees file history ' + JSON.stringify(sigC));
  const st = await C.evaluate(() => [...window.__p2p.stored.values()].map(m => window.__p2p.storedInfo(m)).map(x => [x.name, x.state, x.available]));
  console.log('C stored', JSON.stringify(st));
  ok(st.length === 4 && st.every(x => x[1] === 'missing' && x[2]), 'C: all missing and available');
  
  // C toca na foto avulsa
  await C.click('#feed > [data-card] [data-act="view"], #feed > [data-card] [data-act="fetch"]');
  await C.waitForFunction(() => [...window.__p2p.stored.values()].some(m => m.blob), { timeout: 30000 });
  ok(true, 'C fetched the single photo by tapping');
  // baixa o resto do álbum
  await C.click('#feed > [data-album] [data-act="fetch-all"]');
  await C.waitForFunction(() => [...window.__p2p.stored.values()].every(m => m.blob || (m.tr && m.tr.state === 'done')), { timeout: 60000 });
  ok(true, 'C fetched the whole album');
  const same = await C.evaluate(async () => { const out = []; for (const m of window.__p2p.stored.values()) { const it = window.__p2p.storedInfo(m); out.push([m.name, it.blob.size === m.size, it.intact]); } return out; });
  console.log('C files', JSON.stringify(same));
  ok(same.every(x => x[1] && x[2]), 'C copies are complete and SHA-verified');
  await sleep(1500);
  
  const noNewCardsOnServer = await A.evaluate(() => document.querySelectorAll('#feed > [data-card], #feed > [data-album]').length);
  ok(noNewCardsOnServer === 2, 'serving C did not add cards on A/B');
  // B esquece o álbum e uma mensagem
  await B.evaluate(() => window.__p2p.forgetEl(document.querySelector('#feed > [data-album]')));
  await B.evaluate(() => window.__p2p.forgetEl([...document.querySelectorAll('#feed .msg')].find(e => e.textContent.includes('depois'))));
  await sleep(800);
  await B.reload(); await welcome(B); await sleep(3000);
  const sigB2 = await feedSig(B);
  ok(JSON.stringify(sigB2) === JSON.stringify(['msg:antes das fotos', 'card']), 'B: forgotten album and message stay gone after reload/sync ' + JSON.stringify(sigB2));
  const bDisk = await B.evaluate(async () => { const r = await navigator.storage.getDirectory(); const n = []; for await (const [k] of r.entries()) n.push(k); return n; });
  ok(bDisk.length === 1, 'B disk holds only the remaining photo ' + JSON.stringify(bDisk));
  // expiração: arquivos sem acesso por 48 h
  await B.evaluate(async () => { await window.__vault.debugAge(49 * 3600e3); await window.__vault.seen(window.__p2p.room); await window.__vault.sweep(); });
  await B.reload(); await welcome(B); await sleep(3000);
  const stB = await B.evaluate(() => [...window.__p2p.stored.values()].map(m => window.__p2p.storedInfo(m).state));
  ok(JSON.stringify(stB) === '["missing"]', 'B: file expired after 48 h without access, card stays ' + JSON.stringify(stB));
  // sala sem visita há 48 h: tudo some
  await B.evaluate(async () => { await window.__vault.debugAge(49 * 3600e3); await window.__vault.sweep(); });
  const left = await B.evaluate(async () => (await window.__vault.posts(window.__p2p.room)).length);
  ok(left === 0, 'B: room unvisited for 48 h is wiped locally');
  await b.close();
  console.log(fails ? `${fails} falharam` : 'Tudo certo.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('CRASH', e.message); process.exit(1); });
