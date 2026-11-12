// Teste do servidor contra `wrangler dev` (rode com: node test/server.test.mjs [url]).
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';

const BASE = process.argv[2] || 'http://127.0.0.1:8787';
const WSBASE = BASE.replace(/^http/, 'ws');
const room = 'teste-' + Math.random().toString(36).slice(2, 8);
const id = () => Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function client(name, kind = 'desktop') {
  const peer = id(), device = id();
  const ws = new WebSocket(`${WSBASE}/api/rooms/${room}/ws?peer=${peer}&device=${device}&name=${encodeURIComponent(name)}&kind=${kind}`);
  const inbox = [];
  const waiters = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
  });
  const wait = (pred, ms = 5000) => {
    const found = inbox.find(pred);
    if (found) { inbox.splice(inbox.indexOf(found), 1); return Promise.resolve(found); }
    return new Promise((res, rej) => {
      const w = { pred, res: m => { inbox.splice(inbox.indexOf(m), 1); res(m); } };
      waiters.push(w);
      setTimeout(() => rej(new Error(`${name}: tempo esgotado esperando mensagem`)), ms);
    });
  };
  const open = new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  return { ws, peer, name, wait, open, send: o => ws.send(JSON.stringify(o)) };
}

async function api(method, path, { token, body, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h['X-Room-Token'] = token;
  if (body && !(body instanceof Uint8Array)) { h['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
  const r = await fetch(`${BASE}${path}`, { method, headers: h, body });
  return r;
}

async function upload(token, peer, name, data, { encoding } = {}) {
  const r = await api('POST', `/api/rooms/${room}/uploads`, { token, body: { name, type: 'application/octet-stream', size: data.originalSize ?? data.length, encoding, byPeer: peer, byName: 'Teste' } });
  const j = await r.json();
  assert.equal(r.status, 201, JSON.stringify(j));
  const parts = [];
  for (let i = 0, n = 1; i < data.length; i += j.partSize, n++) {
    const chunk = data.subarray(i, Math.min(i + j.partSize, data.length));
    const pr = await fetch(`${BASE}/api/rooms/${room}/uploads/${j.fileId}/parts/${n}?uploadId=${encodeURIComponent(j.uploadId)}`, { method: 'PUT', body: chunk });
    const pj = await pr.json();
    assert.equal(pr.status, 200, JSON.stringify(pj));
    parts.push(pj);
  }
  const c = await api('POST', `/api/rooms/${room}/uploads/${j.fileId}/complete`, { token, body: { uploadId: j.uploadId, parts } });
  const cj = await c.json();
  assert.equal(c.status, 200, JSON.stringify(cj));
  return cj.file;
}

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['ok', name]); console.log('✔', name); }
  catch (e) { results.push(['falhou', name, e.message]); console.log('✘', name, '\n   ', e.message); }
}

const A = client('Lontra Azul');
const B = client('Garça Cinza', 'mobile');
let tokenA, fileBig, fileGz;

await step('dois aparelhos entram e se veem', async () => {
  await A.open;
  const wa = await A.wait(m => m.t === 'welcome');
  tokenA = wa.token;
  assert.equal(wa.room, room);
  assert.equal(wa.peers.length, 0);
  await B.open;
  const wb = await B.wait(m => m.t === 'welcome');
  assert.equal(wb.peers.length, 1);
  assert.equal(wb.peers[0].name, 'Lontra Azul');
  const j = await A.wait(m => m.t === 'peer-join');
  assert.equal(j.peer.kind, 'mobile');
});

await step('mensagem é distribuída e não duplica', async () => {
  const mid = id();
  A.send({ t: 'chat', id: mid, text: 'olá <b>sala</b>' });
  const mb = await B.wait(m => m.t === 'chat');
  assert.equal(mb.msg.text, 'olá <b>sala</b>');
  await A.wait(m => m.t === 'chat');
  A.send({ t: 'chat', id: mid, text: 'olá de novo' });
  await A.wait(m => m.t === 'chat-ack' && m.id === mid);
});

await step('sinalização vai só para o destinatário', async () => {
  A.send({ t: 'peer', to: B.peer, data: { kind: 'offer', sdp: 'x' } });
  const s = await B.wait(m => m.t === 'peer');
  assert.equal(s.from, A.peer);
  assert.equal(s.data.kind, 'offer');
});

await step('renomear aparelho avisa os outros', async () => {
  B.send({ t: 'rename', name: 'Garça Branca' });
  const u = await A.wait(m => m.t === 'peer-update');
  assert.equal(u.peer.name, 'Garça Branca');
});

await step('upload em partes (9 MB, 2 partes) e download completo e parcial', async () => {
  const data = new Uint8Array(9 * 1024 * 1024);
  for (let i = 0; i < data.length; i++) data[i] = (i * 31 + 7) & 255;
  fileBig = await upload(tokenA, A.peer, 'relatório final.bin', data);
  const added = await B.wait(m => m.t === 'file-added');
  assert.equal(added.file.id, fileBig.id);
  assert.equal(added.file.size, data.length);
  const r = await fetch(`${BASE}/api/rooms/${room}/files/${fileBig.id}?t=${encodeURIComponent(tokenA)}`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /filename\*=UTF-8''relat%C3%B3rio%20final\.bin/);
  const got = new Uint8Array(await r.arrayBuffer());
  assert.equal(got.length, data.length);
  assert.ok(got.every((v, i) => v === data[i]), 'conteúdo diferente');
  const rr = await fetch(`${BASE}/api/rooms/${room}/files/${fileBig.id}?t=${encodeURIComponent(tokenA)}`, { headers: { Range: 'bytes=100-199' } });
  assert.equal(rr.status, 206);
  const part = new Uint8Array(await rr.arrayBuffer());
  assert.equal(part.length, 100);
  assert.equal(part[0], data[100]);
});

await step('arquivo comprimido em gzip é entregue com Content-Encoding', async () => {
  const text = Buffer.from('linha de texto repetida\n'.repeat(50000));
  const gz = gzipSync(text);
  gz.originalSize = text.length;
  fileGz = await upload(tokenA, A.peer, 'log.txt', gz, { encoding: 'gzip' });
  assert.equal(fileGz.encoding, 'gzip');
  assert.equal(fileGz.size, text.length);
  const r = await fetch(`${BASE}/api/rooms/${room}/files/${fileGz.id}?t=${encodeURIComponent(tokenA)}`);
  assert.equal(r.headers.get('content-encoding'), 'gzip');
  const body = Buffer.from(await r.arrayBuffer()); // fetch do Node descompacta
  assert.equal(body.length, text.length);
});

await step('download sem token é recusado', async () => {
  const r = await fetch(`${BASE}/api/rooms/${room}/files/${fileBig.id}`);
  assert.equal(r.status, 401);
});

await step('origem desconhecida é recusada', async () => {
  const r = await fetch(`${BASE}/api/rooms/${room}/uploads`, { method: 'POST', headers: { Origin: 'https://site-estranho.example', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
});

await step('arquivo acima do limite é recusado', async () => {
  const r = await api('POST', `/api/rooms/${room}/uploads`, { token: tokenA, body: { name: 'enorme.iso', size: 3 * 1024 ** 3 } });
  assert.equal(r.status, 413);
});

await step('senha: definir, entrar sem senha falha, com senha entra', async () => {
  A.send({ t: 'set-password', password: 'abacaxi 42' });
  const up = await B.wait(m => m.t === 'room-update');
  assert.equal(up.protected, true);
  const C = client('Tatu Laranja');
  await C.open;
  await C.wait(m => m.t === 'auth-required');
  C.send({ t: 'auth', password: 'errada' });
  const wrong = await C.wait(m => m.t === 'auth-required' && m.reason === 'wrong');
  assert.equal(wrong.left, 4);
  C.send({ t: 'auth', password: 'abacaxi 42' });
  const w = await C.wait(m => m.t === 'welcome');
  assert.equal(w.protected, true);
  assert.equal(w.files.length, 2);
  C.ws.close(1000, 'saindo');
  await A.wait(m => m.t === 'peer-join');
  await A.wait(m => m.t === 'peer-leave');
});

await step('queda de conexão: fica ausente e volta sem anunciar entrada nova', async () => {
  const D = client('Arara Azul');
  await D.open;
  await D.wait(m => m.t === 'auth-required');
  D.send({ t: 'auth', password: 'abacaxi 42' });
  await D.wait(m => m.t === 'welcome');
  const joined = await A.wait(m => m.t === 'peer-join' && m.peer.peerId === D.peer);
  D.ws.close();                                   // sem "saindo": parece queda de rede
  const away = await A.wait(m => m.t === 'peer-update' && m.peer.peerId === D.peer);
  assert.equal(away.peer.away, true);
  // Volta com o mesmo id antes do prazo.
  const ws2 = new WebSocket(`${WSBASE}/api/rooms/${room}/ws?peer=${D.peer}&device=${id()}&name=Arara%20Azul&kind=mobile`);
  await new Promise(r => ws2.addEventListener('open', r));
  await new Promise(r => ws2.addEventListener('message', function f(e) {
    if (JSON.parse(e.data).t === 'auth-required') { ws2.removeEventListener('message', f); r(); }
  }));
  ws2.send(JSON.stringify({ t: 'auth', password: 'abacaxi 42' }));
  const back = await A.wait(m => m.t === 'peer-update' && m.peer.peerId === D.peer && !m.peer.away);
  assert.equal(back.peer.joined, joined.peer.joined);
  await sleep(300);
  assert.equal(await A.wait(m => (m.t === 'peer-join' || m.t === 'peer-leave') && (m.peer?.peerId || m.peerId) === D.peer, 50).catch(() => null), null);
  ws2.close(1000, 'saindo');
  await A.wait(m => m.t === 'peer-leave' && m.peerId === D.peer);
});

await step('token antigo deixa de valer depois de trocar a senha', async () => {
  const r = await fetch(`${BASE}/api/rooms/${room}/files/${fileBig.id}?t=${encodeURIComponent(tokenA)}`);
  assert.equal(r.status, 401);
  A.send({ t: 'refresh-token' });
  tokenA = (await A.wait(m => m.t === 'token')).token;
  const r2 = await fetch(`${BASE}/api/rooms/${room}/files/${fileBig.id}?t=${encodeURIComponent(tokenA)}`, { method: 'HEAD' });
  assert.equal(r2.status, 200);
});

await step('arquivo some depois de 48 h sem acesso', async () => {
  const r = await api('POST', `/api/rooms/${room}/_debug/age`, { body: { ms: 49 * 3600 * 1000 } });
  assert.equal(r.status, 200);
  const gone1 = await A.wait(m => m.t === 'file-removed' && m.reason === 'expired', 8000);
  const gone2 = await A.wait(m => m.t === 'file-removed' && m.reason === 'expired', 8000);
  assert.deepEqual(new Set([gone1.fileId, gone2.fileId]), new Set([fileBig.id, fileGz.id]));
  const rr = await fetch(`${BASE}/api/rooms/${room}/files/${fileBig.id}?t=${encodeURIComponent(tokenA)}`);
  assert.equal(rr.status, 404);
});

await step('apagar tudo exige senha de admin', async () => {
  const f = await upload(tokenA, A.peer, 'x.bin', new Uint8Array(1000));
  await B.wait(m => m.t === 'file-added');
  A.send({ t: 'wipe', adminPassword: 'chute' });
  await A.wait(m => m.t === 'error' && m.code === 'admin-wrong');
  A.send({ t: 'wipe', adminPassword: 'admin' });
  await B.wait(m => m.t === 'file-removed' && m.fileId === f.id);
  const w = await B.wait(m => m.t === 'wiped');
  assert.equal(w.by, 'Lontra Azul');
});

await step('painel de uso responde', async () => {
  const r = await fetch(`${BASE}/api/usage`);
  const j = await r.json();
  const st = j.meters.find(m => m.id === 'storage');
  assert.ok(st && st.limit === 10 * 1024 ** 3);
  assert.equal(typeof st.used, 'number');
});

A.ws.close(); B.ws.close();
await sleep(200);
const bad = results.filter(r => r[0] !== 'ok');
console.log(`\n${results.length - bad.length}/${results.length} passaram`);
process.exit(bad.length ? 1 : 0);
