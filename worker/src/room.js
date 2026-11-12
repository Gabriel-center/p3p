// Uma sala = um Durable Object. Guarda presença, mensagens, arquivos e senha.
import { DurableObject } from 'cloudflare:workers';
import {
  ID_RE, KINDS, limits, cleanText, cleanFileName, randomId, safeEqual,
  hashPassword, signToken, verifyToken
} from './util.js';

const UPLOAD_TTL_MS = 24 * 3600 * 1000;
const MAX_WS_MESSAGE = 64 * 1024;
const MAX_CHAT = 8000;
const MAX_AUTH_FAILS = 5;
// Quem perde a conexão fica "ausente" por este tempo antes de sair da sala.
// Uma queda rápida de rede ou um recarregar de página não vira entra-e-sai.
const AWAY_GRACE_MS = 30000;

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.cfg = limits(env);
    ctx.blockConcurrencyWhile(async () => this.migrate());
    // Responde "ping" com "pong" sem acordar o objeto (não conta como uso).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  migrate() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, ts INTEGER NOT NULL, from_peer TEXT, from_device TEXT, from_name TEXT, from_kind TEXT, text TEXT NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT, size INTEGER NOT NULL, stored_size INTEGER,
      encoding TEXT, by_peer TEXT, by_name TEXT, to_peer TEXT, created INTEGER NOT NULL,
      last_access INTEGER NOT NULL, status TEXT NOT NULL, upload_id TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS away (peer_id TEXT PRIMARY KEY, view TEXT NOT NULL, gone_at INTEGER NOT NULL)`);
  }

  // ---------- meta ----------
  getMeta(k) {
    const r = this.sql.exec(`SELECT v FROM meta WHERE k = ?`, k).toArray();
    return r.length ? r[0].v : null;
  }
  setMeta(k, v) {
    if (v === null || v === undefined) this.sql.exec(`DELETE FROM meta WHERE k = ?`, k);
    else this.sql.exec(`INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`, k, String(v));
  }
  get roomName() { return this.getMeta('room') || ''; }
  setRoom(room) { if (room && !this.getMeta('room')) this.setMeta('room', room); }
  secret() {
    let s = this.getMeta('secret');
    if (!s) { s = randomId(32); this.setMeta('secret', s); }
    return s;
  }
  isProtected() { return !!this.getMeta('pw_hash'); }
  touchActivity() { this.setMeta('activity', Date.now()); }

  // ---------- sockets ----------
  sockets() {
    return this.ctx.getWebSockets().filter(ws => ws.readyState === 1);
  }
  att(ws) {
    try { return ws.deserializeAttachment() || {}; } catch { return {}; }
  }
  peerView(a) {
    return { peerId: a.peerId, deviceId: a.deviceId, name: a.name, kind: a.kind, joined: a.joined };
  }
  /** Quem está na sala: conectados e, com away: true, quem caiu há menos de AWAY_GRACE_MS. */
  peers(except, { withAway = true } = {}) {
    const seen = new Map();
    for (const ws of this.sockets()) {
      if (ws === except) continue;
      const a = this.att(ws);
      if (a.authed && a.peerId) seen.set(a.peerId, this.peerView(a));
    }
    if (withAway) {
      for (const r of this.sql.exec(`SELECT peer_id, view FROM away`).toArray()) {
        if (seen.has(r.peer_id)) continue;
        try { seen.set(r.peer_id, { ...JSON.parse(r.view), away: true }); } catch { /* linha estragada */ }
      }
    }
    return [...seen.values()].sort((x, y) => x.joined - y.joined);
  }
  send(ws, obj) {
    try { ws.send(JSON.stringify(obj)); } catch { /* socket fechado */ }
  }
  broadcast(obj, except) {
    const s = JSON.stringify(obj);
    for (const ws of this.sockets()) {
      if (ws === except) continue;
      if (!this.att(ws).authed) continue;
      try { ws.send(s); } catch { /* ignora */ }
    }
  }
  sendTo(peerId, obj) {
    for (const ws of this.ctx.getWebSockets(peerId)) {
      if (ws.readyState === 1 && this.att(ws).authed) this.send(ws, obj);
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Esperava WebSocket', { status: 426 });
    const room = url.searchParams.get('room');
    const peerId = url.searchParams.get('peer');
    const deviceId = url.searchParams.get('device');
    if (!ID_RE.test(peerId || '') || !ID_RE.test(deviceId || '')) return new Response('Identificação inválida', { status: 400 });
    this.setRoom(room);

    const kind = KINDS.has(url.searchParams.get('kind')) ? url.searchParams.get('kind') : 'desktop';
    const name = cleanText(url.searchParams.get('name'), 32) || 'Aparelho';

    // Reconexão do mesmo participante: fecha a conexão antiga.
    for (const old of this.ctx.getWebSockets(peerId)) {
      try { old.close(4000, 'substituída por nova conexão'); } catch { /* já fechada */ }
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [peerId]);
    const a = { peerId, deviceId, name, kind, joined: Date.now(), authed: false, fails: 0 };
    server.serializeAttachment(a);

    if (this.isProtected()) {
      this.send(server, { t: 'auth-required' });
    } else {
      await this.admit(server, a);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async admit(ws, a) {
    const others = this.peers(ws).filter(p => p.peerId !== a.peerId);
    if (others.filter(p => !p.away).length >= this.cfg.maxPeers) {
      this.send(ws, { t: 'error', code: 'room-full', max: this.cfg.maxPeers });
      try { ws.close(4001, 'sala cheia'); } catch { /* ok */ }
      return;
    }
    // Voltou dentro do prazo: mantém a ordem de chegada e não anuncia de novo.
    const back = this.sql.exec(`SELECT view FROM away WHERE peer_id = ?`, a.peerId).toArray()[0];
    if (back) {
      try { a.joined = JSON.parse(back.view).joined || a.joined; } catch { /* usa o novo */ }
      this.sql.exec(`DELETE FROM away WHERE peer_id = ?`, a.peerId);
    }
    a.authed = true;
    a.fails = 0;
    ws.serializeAttachment(a);
    this.touchActivity();
    this.send(ws, {
      t: 'welcome',
      you: a.peerId,
      room: this.roomName,
      serverTime: Date.now(),
      protected: this.isProtected(),
      token: await signToken(this.secret(), this.roomName),
      peers: others,
      files: this.listFiles(),
      messages: this.listMessages(),
      limits: {
        maxPeers: this.cfg.maxPeers, maxFileBytes: this.cfg.maxFileBytes, maxRoomBytes: this.cfg.maxRoomBytes,
        fileTtlMs: this.cfg.fileTtlMs, partSize: this.cfg.partSize, messageLimit: this.cfg.messageLimit
      }
    });
    this.broadcast({ t: back ? 'peer-update' : 'peer-join', peer: this.peerView(a) }, ws);
    await this.scheduleAlarm();
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_WS_MESSAGE) {
      this.send(ws, { t: 'error', code: 'too-large' });
      return;
    }
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    const a = this.att(ws);

    if (!a.authed) {
      if (m.t !== 'auth') return;
      const ok = await this.checkPassword(m.password);
      if (ok) return this.admit(ws, a);
      a.fails = (a.fails || 0) + 1;
      ws.serializeAttachment(a);
      if (a.fails >= MAX_AUTH_FAILS) {
        this.send(ws, { t: 'auth-required', reason: 'locked' });
        try { ws.close(4003, 'muitas tentativas'); } catch { /* ok */ }
      } else {
        this.send(ws, { t: 'auth-required', reason: 'wrong', left: MAX_AUTH_FAILS - a.fails });
      }
      return;
    }

    switch (m.t) {
      case 'peer': {
        if (!ID_RE.test(m.to || '')) return;
        this.sendTo(m.to, { t: 'peer', from: a.peerId, data: m.data });
        return;
      }
      case 'chat': {
        const text = cleanChat(m.text);
        if (!text || !ID_RE.test(m.id || '')) return;
        const exists = this.sql.exec(`SELECT 1 FROM messages WHERE id = ?`, m.id).toArray().length;
        if (exists) { this.send(ws, { t: 'chat-ack', id: m.id }); return; }
        const msg = { id: m.id, ts: Date.now(), fromPeer: a.peerId, fromDevice: a.deviceId, fromName: a.name, fromKind: a.kind, text };
        this.sql.exec(`INSERT INTO messages (id, ts, from_peer, from_device, from_name, from_kind, text) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          msg.id, msg.ts, msg.fromPeer, msg.fromDevice, msg.fromName, msg.fromKind, msg.text);
        this.sql.exec(`DELETE FROM messages WHERE id NOT IN (SELECT id FROM messages ORDER BY ts DESC LIMIT ?)`, this.cfg.messageLimit);
        this.touchActivity();
        this.broadcast({ t: 'chat', msg });
        return;
      }
      case 'rename': {
        const name = cleanText(m.name, 32);
        if (!name) return;
        a.name = name;
        ws.serializeAttachment(a);
        this.broadcast({ t: 'peer-update', peer: this.peerView(a) });
        return;
      }
      case 'set-password': {
        const pw = typeof m.password === 'string' ? m.password : '';
        if (pw.length > 128) return this.send(ws, { t: 'error', code: 'password-too-long' });
        if (pw) {
          const { salt, hash } = await hashPassword(pw);
          this.setMeta('pw_salt', salt);
          this.setMeta('pw_hash', hash);
        } else {
          this.setMeta('pw_salt', null);
          this.setMeta('pw_hash', null);
        }
        // Novo segredo: links de download antigos deixam de valer.
        this.setMeta('secret', randomId(32));
        const token = await signToken(this.secret(), this.roomName);
        this.broadcast({ t: 'room-update', protected: !!pw, by: a.name, token });
        return;
      }
      case 'refresh-token': {
        this.send(ws, { t: 'token', token: await signToken(this.secret(), this.roomName) });
        return;
      }
      case 'delete-file': {
        const r = await this.removeFile(m.fileId, 'deleted', a.name);
        if (!r) this.send(ws, { t: 'error', code: 'file-not-found' });
        return;
      }
      case 'wipe': {
        const expected = this.env.ADMIN_PASSWORD || 'admin';
        if (typeof m.adminPassword !== 'string' || !safeEqual(m.adminPassword, expected)) {
          a.fails = (a.fails || 0) + 1;
          ws.serializeAttachment(a);
          this.send(ws, { t: 'error', code: 'admin-wrong' });
          if (a.fails >= MAX_AUTH_FAILS) { try { ws.close(4003, 'muitas tentativas'); } catch { /* ok */ } }
          return;
        }
        await this.wipe();
        this.broadcast({ t: 'wiped', by: a.name });
        return;
      }
      default:
        return;
    }
  }

  // Código 1000 com motivo "saindo" = a pessoa saiu da sala de propósito. O resto (rede caiu,
  // aba fechou ou recarregou) espera AWAY_GRACE_MS antes de anunciar a saída.
  async webSocketClose(ws, code, reason) { await this.onGone(ws, code === 1000 && reason === 'saindo'); }
  async webSocketError(ws) { await this.onGone(ws, false); }

  async onGone(ws, leaving) {
    const a = this.att(ws);
    if (!a.peerId) return;
    const stillHere = this.ctx.getWebSockets(a.peerId).some(o => o !== ws && o.readyState === 1);
    if (a.authed && !stillHere) {
      if (leaving) {
        this.sql.exec(`DELETE FROM away WHERE peer_id = ?`, a.peerId);
        this.broadcast({ t: 'peer-leave', peerId: a.peerId }, ws);
      } else {
        const view = this.peerView(a);
        this.sql.exec(`INSERT INTO away (peer_id, view, gone_at) VALUES (?, ?, ?)
          ON CONFLICT(peer_id) DO UPDATE SET view = excluded.view, gone_at = excluded.gone_at`, a.peerId, JSON.stringify(view), Date.now());
        this.broadcast({ t: 'peer-update', peer: { ...view, away: true } }, ws);
      }
      this.touchActivity();
    }
    await this.scheduleAlarm();
  }

  /** Tira da sala quem ficou ausente além do prazo. */
  expireAway(now) {
    const gone = this.sql.exec(`SELECT peer_id FROM away WHERE gone_at <= ?`, now - AWAY_GRACE_MS).toArray();
    for (const r of gone) {
      this.sql.exec(`DELETE FROM away WHERE peer_id = ?`, r.peer_id);
      if (this.ctx.getWebSockets(r.peer_id).some(o => o.readyState === 1)) continue;
      this.broadcast({ t: 'peer-leave', peerId: r.peer_id });
    }
  }

  async checkPassword(pw) {
    if (!this.isProtected()) return true;
    if (typeof pw !== 'string' || pw.length > 128) return false;
    const { hash } = await hashPassword(pw, this.getMeta('pw_salt'));
    return safeEqual(hash, this.getMeta('pw_hash'));
  }

  // ---------- mensagens ----------
  listMessages() {
    return this.sql.exec(`SELECT * FROM messages ORDER BY ts ASC`).toArray().map(r => ({
      id: r.id, ts: r.ts, fromPeer: r.from_peer, fromDevice: r.from_device, fromName: r.from_name, fromKind: r.from_kind, text: r.text
    }));
  }

  // ---------- arquivos ----------
  fileView(r) {
    return {
      id: r.id, name: r.name, type: r.type, size: r.size, storedSize: r.stored_size, encoding: r.encoding,
      byPeer: r.by_peer, byName: r.by_name, to: r.to_peer, created: r.created, lastAccess: r.last_access,
      expiresAt: r.last_access + this.cfg.fileTtlMs
    };
  }
  listFiles() {
    return this.sql.exec(`SELECT * FROM files WHERE status = 'ready' ORDER BY created DESC`).toArray().map(r => this.fileView(r));
  }
  key(fileId) { return `rooms/${this.roomName}/${fileId}`; }
  usage() { return this.env.USAGE.get(this.env.USAGE.idFromName('global')); }

  /** Chamado pelo Worker. Valida token e cotas, cria o upload em partes no R2. */
  async createUpload({ room, token, name, type, size, encoding, byPeer, byName, to }) {
    this.setRoom(room);
    if (!(await verifyToken(this.secret(), this.roomName, token))) return { error: { status: 401, code: 'token' } };
    size = Number(size);
    if (!Number.isFinite(size) || size < 0) return { error: { status: 400, code: 'size' } };
    if (size > this.cfg.maxFileBytes) return { error: { status: 413, code: 'file-too-large', max: this.cfg.maxFileBytes } };
    const used = this.sql.exec(`SELECT COALESCE(SUM(size), 0) AS s FROM files`).one().s;
    if (used + size > this.cfg.maxRoomBytes) return { error: { status: 413, code: 'room-full', used, max: this.cfg.maxRoomBytes } };
    const global = await this.usage().storedBytes();
    if (global + size > this.cfg.maxCloudBytes) return { error: { status: 507, code: 'cloud-full' } };

    const id = randomId(12);
    const fname = cleanFileName(name);
    const ftype = cleanText(type, 120) || 'application/octet-stream';
    const enc = encoding === 'gzip' ? 'gzip' : null;
    const mp = await this.env.FILES.createMultipartUpload(this.key(id), {
      httpMetadata: { contentType: ftype, contentEncoding: enc || undefined },
      customMetadata: { name: fname, size: String(size) }
    });
    const now = Date.now();
    this.sql.exec(`INSERT INTO files (id, name, type, size, stored_size, encoding, by_peer, by_name, to_peer, created, last_access, status, upload_id)
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'uploading', ?)`,
      id, fname, ftype, size, enc, cleanText(byPeer, 64), cleanText(byName, 32), ID_RE.test(to || '') ? to : null, now, now, mp.uploadId);
    await this.scheduleAlarm();
    return { fileId: id, uploadId: mp.uploadId, key: this.key(id), partSize: this.cfg.partSize };
  }

  async completeUpload({ room, token, fileId, uploadId, parts }) {
    this.setRoom(room);
    if (!(await verifyToken(this.secret(), this.roomName, token))) return { error: { status: 401, code: 'token' } };
    const rows = this.sql.exec(`SELECT * FROM files WHERE id = ? AND status = 'uploading'`, fileId).toArray();
    if (!rows.length || rows[0].upload_id !== uploadId) return { error: { status: 404, code: 'upload-not-found' } };
    if (!Array.isArray(parts) || !parts.length || parts.length > 10000) return { error: { status: 400, code: 'parts' } };
    const clean = parts.map(p => ({ partNumber: Number(p.partNumber), etag: String(p.etag) })).sort((x, y) => x.partNumber - y.partNumber);
    let obj;
    try {
      obj = await this.env.FILES.resumeMultipartUpload(this.key(fileId), uploadId).complete(clean);
    } catch (e) {
      return { error: { status: 400, code: 'complete-failed', message: String(e.message || e) } };
    }
    const now = Date.now();
    this.sql.exec(`UPDATE files SET status = 'ready', stored_size = ?, upload_id = NULL, last_access = ? WHERE id = ?`, obj.size, now, fileId);
    await this.usage().adjust(obj.size, clean.length);
    const file = this.fileView(this.sql.exec(`SELECT * FROM files WHERE id = ?`, fileId).one());
    this.touchActivity();
    this.broadcast({ t: 'file-added', file });
    await this.scheduleAlarm();
    return { file };
  }

  async abortUpload({ room, token, fileId, uploadId }) {
    this.setRoom(room);
    if (!(await verifyToken(this.secret(), this.roomName, token))) return { error: { status: 401, code: 'token' } };
    const rows = this.sql.exec(`SELECT * FROM files WHERE id = ? AND status = 'uploading'`, fileId).toArray();
    if (!rows.length || rows[0].upload_id !== uploadId) return { error: { status: 404, code: 'upload-not-found' } };
    try { await this.env.FILES.resumeMultipartUpload(this.key(fileId), uploadId).abort(); } catch { /* já expirado */ }
    this.sql.exec(`DELETE FROM files WHERE id = ?`, fileId);
    await this.scheduleAlarm();
    return { ok: true };
  }

  /** Download: valida token, renova as 48 h e devolve os metadados. */
  async touchFile({ room, token, fileId }) {
    this.setRoom(room);
    if (!(await verifyToken(this.secret(), this.roomName, token))) return { error: { status: 401, code: 'token' } };
    const rows = this.sql.exec(`SELECT * FROM files WHERE id = ? AND status = 'ready'`, fileId).toArray();
    if (!rows.length) return { error: { status: 404, code: 'file-not-found' } };
    const now = Date.now();
    this.sql.exec(`UPDATE files SET last_access = ? WHERE id = ?`, now, fileId);
    const file = this.fileView({ ...rows[0], last_access: now });
    this.broadcast({ t: 'file-updated', file });
    this.usage().countRead().catch(() => {});
    await this.scheduleAlarm();
    return { file, key: this.key(fileId) };
  }

  async deleteFileHttp({ room, token, fileId }) {
    this.setRoom(room);
    if (!(await verifyToken(this.secret(), this.roomName, token))) return { error: { status: 401, code: 'token' } };
    const ok = await this.removeFile(fileId, 'deleted', null);
    return ok ? { ok: true } : { error: { status: 404, code: 'file-not-found' } };
  }

  async removeFile(fileId, reason, by) {
    const rows = this.sql.exec(`SELECT * FROM files WHERE id = ?`, String(fileId || '')).toArray();
    if (!rows.length) return false;
    const r = rows[0];
    if (r.status === 'uploading' && r.upload_id) {
      try { await this.env.FILES.resumeMultipartUpload(this.key(r.id), r.upload_id).abort(); } catch { /* ok */ }
    } else {
      await this.env.FILES.delete(this.key(r.id));
      if (r.stored_size) await this.usage().adjust(-r.stored_size, 1);
    }
    this.sql.exec(`DELETE FROM files WHERE id = ?`, r.id);
    if (r.status === 'ready') this.broadcast({ t: 'file-removed', fileId: r.id, reason, by });
    await this.scheduleAlarm();
    return true;
  }

  async wipe() {
    for (const r of this.sql.exec(`SELECT id FROM files`).toArray()) {
      await this.removeFile(r.id, 'wiped', null);
    }
    // Remove sobras no R2 (uploads interrompidos de versões antigas, por exemplo).
    let cursor;
    do {
      const list = await this.env.FILES.list({ prefix: `rooms/${this.roomName}/`, cursor, limit: 1000 });
      if (list.objects.length) await this.env.FILES.delete(list.objects.map(o => o.key));
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
    this.sql.exec(`DELETE FROM messages`);
    this.touchActivity();
  }

  // ---------- expiração ----------
  async scheduleAlarm() {
    const now = Date.now();
    const times = [];
    const ready = this.sql.exec(`SELECT MIN(last_access) AS t FROM files WHERE status = 'ready'`).one().t;
    if (ready) times.push(ready + this.cfg.fileTtlMs);
    const up = this.sql.exec(`SELECT MIN(created) AS t FROM files WHERE status = 'uploading'`).one().t;
    if (up) times.push(up + UPLOAD_TTL_MS);
    const away = this.sql.exec(`SELECT MIN(gone_at) AS t FROM away`).one().t;
    if (away) times.push(away + AWAY_GRACE_MS);
    if (!this.sockets().length) {
      const act = Number(this.getMeta('activity') || now);
      times.push(act + this.cfg.fileTtlMs);
    }
    if (!times.length) { await this.ctx.storage.deleteAlarm(); return; }
    const next = Math.max(now + 1000, Math.min(...times));
    const cur = await this.ctx.storage.getAlarm();
    if (cur !== next) await this.ctx.storage.setAlarm(next);
  }

  async alarm() {
    const now = Date.now();
    this.expireAway(now);
    const expired = this.sql.exec(
      `SELECT id FROM files WHERE (status = 'ready' AND last_access <= ?) OR (status = 'uploading' AND created <= ?)`,
      now - this.cfg.fileTtlMs, now - UPLOAD_TTL_MS).toArray();
    for (const r of expired) await this.removeFile(r.id, 'expired', null);

    const nobody = !this.sockets().length;
    const noFiles = this.sql.exec(`SELECT COUNT(*) AS n FROM files`).one().n === 0;
    const act = Number(this.getMeta('activity') || 0);
    if (nobody && noFiles && act + this.cfg.fileTtlMs <= now) {
      // Sala abandonada há 48 h: apaga tudo, inclusive mensagens e senha.
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      this.migrate();
      return;
    }
    await this.scheduleAlarm();
  }

  /** Só em desenvolvimento local: envelhece arquivos e atividade para testar a expiração. */
  async debugAge({ ms }) {
    if (this.env.DEBUG !== '1') return { error: { status: 404, code: 'not-found' } };
    this.sql.exec(`UPDATE files SET last_access = last_access - ?, created = created - ?`, ms, ms);
    const act = Number(this.getMeta('activity') || Date.now());
    this.setMeta('activity', act - ms);
    await this.ctx.storage.setAlarm(Date.now() + 500);
    return { ok: true };
  }
}

function cleanChat(t) {
  if (typeof t !== 'string') return '';
  return t.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, MAX_CHAT);
}
