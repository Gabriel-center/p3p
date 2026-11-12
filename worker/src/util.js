// Utilidades compartilhadas entre o Worker e os Durable Objects.

export const ROOM_RE = /^[a-z0-9_-]{1,48}$/;
export const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
export const KINDS = new Set(['mobile', 'tablet', 'desktop']);

export function num(env, key, fallback) {
  const v = Number(env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export function limits(env) {
  return {
    maxPeers: num(env, 'MAX_PEERS', 8),
    maxFileBytes: num(env, 'MAX_FILE_BYTES', 2 * 1024 ** 3),
    maxRoomBytes: num(env, 'MAX_ROOM_BYTES', 5 * 1024 ** 3),
    maxCloudBytes: num(env, 'MAX_CLOUD_BYTES', 9.5 * 1024 ** 3),
    fileTtlMs: num(env, 'FILE_TTL_HOURS', 48) * 3600 * 1000,
    messageLimit: num(env, 'MESSAGE_LIMIT', 200),
    partSize: num(env, 'PART_SIZE', 8 * 1024 * 1024)
  };
}

/** Limpa um nome de dispositivo ou de arquivo para exibição. */
export function cleanText(s, max) {
  return String(s ?? '')
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim()
    .slice(0, max);
}

export function cleanFileName(s) {
  const n = cleanText(s, 200).replace(/[\\/]/g, '_');
  return n || 'arquivo';
}

export function randomId(bytes = 16) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return b64url(a);
}

export function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

/** Comparação em tempo constante de duas strings. */
export function safeEqual(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function hashPassword(password, saltB64) {
  const salt = saltB64 ? fromB64url(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 20000 }, key, 256);
  return { salt: b64url(salt), hash: b64url(new Uint8Array(bits)) };
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', fromB64url(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** Token de acesso à sala: "<expira>.<assinatura>", assinado com o segredo da sala. */
export async function signToken(secret, room, ttlMs = 24 * 3600 * 1000) {
  const exp = Date.now() + ttlMs;
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${room}.${exp}`));
  return `${exp}.${b64url(new Uint8Array(sig))}`;
}

export async function verifyToken(secret, room, token) {
  if (typeof token !== 'string') return false;
  const [expS, sig] = token.split('.');
  const exp = Number(expS);
  if (!Number.isFinite(exp) || exp < Date.now() || !sig) return false;
  try {
    const key = await hmacKey(secret);
    return await crypto.subtle.verify('HMAC', key, fromB64url(sig), new TextEncoder().encode(`${room}.${exp}`));
  } catch {
    return false;
  }
}

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

export function contentDisposition(name, inline = false) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
