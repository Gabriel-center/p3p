// Worker do p2p: porta de entrada HTTP/WebSocket.
// O site (GitHub Pages) fala com este Worker; cada sala vive num Durable Object.
import { Room } from './room.js';
import { Usage } from './usage.js';
import { ROOM_RE, limits, contentDisposition } from './util.js';

export { Room, Usage };

const ICE_CACHE_MS = 60 * 60 * 1000;
let iceCache = null;

function allowedOrigins(env) {
  return new Set(String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean));
}

function cors(request, env) {
  const origin = request.headers.get('Origin');
  const h = new Headers({ Vary: 'Origin' });
  if (origin && allowedOrigins(env).has(origin)) {
    h.set('Access-Control-Allow-Origin', origin);
    h.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, OPTIONS');
    h.set('Access-Control-Allow-Headers', 'Content-Type, X-Room-Token');
    h.set('Access-Control-Expose-Headers', 'ETag, Content-Length, Content-Range, Content-Encoding, X-Original-Size');
    h.set('Access-Control-Max-Age', '86400');
  }
  return h;
}

function json(request, env, body, status = 200) {
  const h = cors(request, env);
  h.set('Content-Type', 'application/json; charset=utf-8');
  h.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers: h });
}

function fail(request, env, err) {
  const { status = 400, ...rest } = err;
  return json(request, env, { error: rest }, status);
}

/** Pedidos de navegador vindos de outro site são recusados. Sem Origin (download direto), passa. */
function originOk(request, env) {
  const origin = request.headers.get('Origin');
  return !origin || allowedOrigins(env).has(origin);
}

async function iceServers(env) {
  const stun = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return { iceServers: stun, turn: false };
  if (iceCache && Date.now() - iceCache.at < ICE_CACHE_MS) return iceCache.data;
  const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: 86400 })
  });
  if (!r.ok) return { iceServers: stun, turn: false, error: `turn ${r.status}` };
  const j = await r.json();
  // A porta 53 é bloqueada pelos navegadores; remove para não esperar o tempo limite.
  const servers = (j.iceServers || []).map(s => ({
    ...s,
    urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter(u => !/:53(\?|$)/.test(u))
  })).filter(s => s.urls.length);
  const data = { iceServers: servers, turn: true };
  iceCache = { at: Date.now(), data };
  return data;
}

function roomStub(env, room) {
  return env.ROOMS.get(env.ROOMS.idFromName(room));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request, env) });
    if (!originOk(request, env)) return json(request, env, { error: { code: 'origin' } }, 403);

    try {
      if (path === '' || path === '/api' || path === '/api/health') {
        return json(request, env, {
          ok: true,
          turn: !!(env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN),
          analytics: !!(env.CF_API_TOKEN && env.CF_ACCOUNT_ID),
          adminPasswordSet: !!env.ADMIN_PASSWORD,
          limits: limits(env)
        });
      }

      if (path === '/api/ice' && request.method === 'GET') {
        return json(request, env, await iceServers(env));
      }

      if (path === '/api/usage' && request.method === 'GET') {
        const stub = env.USAGE.get(env.USAGE.idFromName('global'));
        return json(request, env, await stub.report());
      }

      const m = path.match(/^\/api\/rooms\/([^/]+)(\/.*)?$/);
      if (!m) return json(request, env, { error: { code: 'not-found' } }, 404);
      const room = decodeURIComponent(m[1]);
      if (!ROOM_RE.test(room)) return json(request, env, { error: { code: 'room-name' } }, 400);
      const rest = m[2] || '';
      const stub = roomStub(env, room);
      const token = request.headers.get('X-Room-Token') || url.searchParams.get('t');

      // WebSocket da sala
      if (rest === '/ws') {
        if (request.headers.get('Upgrade') !== 'websocket') return json(request, env, { error: { code: 'upgrade' } }, 426);
        const u = new URL(request.url);
        u.searchParams.set('room', room);
        return stub.fetch(new Request(u.toString(), request));
      }

      // Criar upload
      if (rest === '/uploads' && request.method === 'POST') {
        const b = await request.json().catch(() => ({}));
        const r = await stub.createUpload({ room, token, name: b.name, type: b.type, size: b.size, encoding: b.encoding, byPeer: b.byPeer, byName: b.byName, to: b.to });
        return r.error ? fail(request, env, r.error) : json(request, env, r, 201);
      }

      // Enviar uma parte: vai direto para o R2, sem processar no Worker.
      let mm = rest.match(/^\/uploads\/([A-Za-z0-9_-]+)\/parts\/(\d+)$/);
      if (mm && request.method === 'PUT') {
        const [, fileId, nS] = mm;
        const n = Number(nS);
        const uploadId = url.searchParams.get('uploadId');
        const len = Number(request.headers.get('Content-Length'));
        const cfg = limits(env);
        if (!uploadId || !(n >= 1 && n <= 10000)) return json(request, env, { error: { code: 'part' } }, 400);
        if (!request.headers.has('Content-Length') || !Number.isFinite(len) || len < 0) return json(request, env, { error: { code: 'length-required' } }, 411);
        if (len > cfg.partSize) return json(request, env, { error: { code: 'part-too-large', max: cfg.partSize } }, 413);
        const up = env.FILES.resumeMultipartUpload(`rooms/${room}/${fileId}`, uploadId);
        try {
          const part = await up.uploadPart(n, len === 0 ? new Uint8Array(0) : request.body);
          return json(request, env, { partNumber: part.partNumber, etag: part.etag });
        } catch (e) {
          return json(request, env, { error: { code: 'part-failed', message: String(e.message || e) } }, 400);
        }
      }

      mm = rest.match(/^\/uploads\/([A-Za-z0-9_-]+)\/complete$/);
      if (mm && request.method === 'POST') {
        const b = await request.json().catch(() => ({}));
        const r = await stub.completeUpload({ room, token, fileId: mm[1], uploadId: b.uploadId, parts: b.parts });
        return r.error ? fail(request, env, r.error) : json(request, env, r);
      }

      mm = rest.match(/^\/uploads\/([A-Za-z0-9_-]+)$/);
      if (mm && request.method === 'DELETE') {
        const r = await stub.abortUpload({ room, token, fileId: mm[1], uploadId: url.searchParams.get('uploadId') });
        return r.error ? fail(request, env, r.error) : json(request, env, r);
      }

      // Baixar ou apagar um arquivo guardado
      mm = rest.match(/^\/files\/([A-Za-z0-9_-]+)$/);
      if (mm && (request.method === 'GET' || request.method === 'HEAD')) {
        const r = await stub.touchFile({ room, token, fileId: mm[1] });
        if (r.error) return fail(request, env, r.error);
        const { file, key } = r;
        const encoded = !!file.encoding;
        const obj = request.method === 'HEAD'
          ? await env.FILES.head(key)
          : await env.FILES.get(key, encoded ? {} : { range: request.headers });
        if (!obj) return json(request, env, { error: { code: 'file-not-found' } }, 404);
        const h = cors(request, env);
        h.set('Content-Type', file.type || 'application/octet-stream');
        h.set('Content-Disposition', contentDisposition(file.name, url.searchParams.get('inline') === '1'));
        h.set('Cache-Control', 'private, no-store');
        h.set('ETag', obj.httpEtag);
        h.set('X-Original-Size', String(file.size));
        h.set('X-Content-Type-Options', 'nosniff');
        if (encoded) {
          // Guardado comprimido: o navegador descompacta sozinho.
          h.set('Content-Encoding', file.encoding);
          h.set('Content-Length', String(obj.size));
          const body = request.method === 'HEAD' ? null : obj.body;
          return new Response(body, { status: 200, headers: h, encodeBody: 'manual' });
        }
        h.set('Accept-Ranges', 'bytes');
        if (request.method === 'HEAD') {
          h.set('Content-Length', String(obj.size));
          return new Response(null, { status: 200, headers: h });
        }
        if (!('body' in obj)) return new Response(null, { status: 412, headers: h });
        if (obj.range && request.headers.get('Range')) {
          const off = obj.range.offset ?? (obj.size - obj.range.suffix);
          const len = obj.range.length ?? (obj.size - off);
          h.set('Content-Range', `bytes ${off}-${off + len - 1}/${obj.size}`);
          h.set('Content-Length', String(len));
          return new Response(obj.body, { status: 206, headers: h });
        }
        h.set('Content-Length', String(obj.size));
        return new Response(obj.body, { status: 200, headers: h });
      }
      if (mm && request.method === 'DELETE') {
        const r = await stub.deleteFileHttp({ room, token, fileId: mm[1] });
        return r.error ? fail(request, env, r.error) : json(request, env, r);
      }

      if (rest === '/_debug/age' && request.method === 'POST' && env.DEBUG === '1') {
        const b = await request.json().catch(() => ({}));
        return json(request, env, await stub.debugAge({ ms: Number(b.ms) || 0 }));
      }

      return json(request, env, { error: { code: 'not-found' } }, 404);
    } catch (e) {
      console.error('erro', e && e.stack || e);
      return json(request, env, { error: { code: 'internal', message: String(e && e.message || e) } }, 500);
    }
  }
};
