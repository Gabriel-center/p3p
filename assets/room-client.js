// Ligação com o servidor da sala: reconecta sozinho, lida com senha e guarda mensagens na fila.
import { WS_URL, WORKER_URL } from './config.js?v=202611122007';

const PING_MS = 20000;
const DEAD_MS = 50000;
const MAX_BACKOFF = 30000;

export class RoomClient extends EventTarget {
  constructor({ room, me }) {
    super();
    this.room = room;
    this.me = me;
    this.ws = null;
    this.state = 'idle';           // idle | connecting | auth | open | reconnecting | full | locked | closed
    this.backoff = 1000;
    this.retryAt = 0;
    this.queue = [];               // mensagens esperando o servidor voltar
    this.token = null;
    this.password = null;
    this.protected = false;
    this.lastPong = 0;
    this.onOnline = () => this.nudge();
    this.onVisible = () => { if (document.visibilityState === 'visible') this.nudge(); };
    window.addEventListener('online', this.onOnline);
    document.addEventListener('visibilitychange', this.onVisible);
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.emit('state', { state: s, retryAt: this.retryAt });
  }

  connect() {
    clearTimeout(this.retryTimer);
    if (this.state === 'closed') return;
    const q = new URLSearchParams({ peer: this.me.peerId, device: this.me.deviceId, name: this.me.name, kind: this.me.kind });
    let ws;
    try {
      ws = new WebSocket(`${WS_URL}/api/rooms/${encodeURIComponent(this.room)}/ws?${q}`);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    if (this.state !== 'reconnecting') this.setState('connecting');
    ws.onopen = () => { this.lastPong = Date.now(); this.startPing(); };
    ws.onmessage = e => {
      if (e.data === 'pong') { this.lastPong = Date.now(); return; }
      this.lastPong = Date.now();
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      this.handle(m);
    };
    ws.onclose = e => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopPing();
      if (this.state === 'closed') return;
      if (e.code === 4001) { this.setState('full'); return; }
      if (e.code === 4003) { this.setState('locked'); this.retryAt = Date.now() + 60000; this.retryTimer = setTimeout(() => this.connect(), 60000); return; }
      this.scheduleRetry();
    };
    ws.onerror = () => { /* o onclose cuida */ };
  }

  scheduleRetry() {
    if (this.state === 'closed') return;
    const delay = this.backoff;
    this.backoff = Math.min(MAX_BACKOFF, this.backoff * 2);
    this.retryAt = Date.now() + delay;
    this.setState('reconnecting');
    this.emit('state', { state: 'reconnecting', retryAt: this.retryAt });
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  /** Rede voltou ou a aba voltou para a frente: tenta já. */
  nudge() {
    if (this.state === 'closed' || this.state === 'full') return;
    if (this.ws && this.ws.readyState === 1) { this.sendRaw('ping'); return; }
    if (this.ws && this.ws.readyState === 0) return;
    this.backoff = 1000;
    this.connect();
  }

  startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== 1) return;
      if (Date.now() - this.lastPong > DEAD_MS) { try { this.ws.close(); } catch { /* ok */ } return; }
      this.sendRaw('ping');
    }, PING_MS);
    // Token vale 24 h; renova a cada 6 h.
    this.tokenTimer = setInterval(() => this.send({ t: 'refresh-token' }), 6 * 3600 * 1000);
  }
  stopPing() { clearInterval(this.pingTimer); clearInterval(this.tokenTimer); }

  handle(m) {
    switch (m.t) {
      case 'auth-required':
        this.protected = true;
        if (!m.reason && this.password) { this.send({ t: 'auth', password: this.password }, { force: true }); return; }
        this.setState('auth');
        this.emit('auth', m);
        return;
      case 'welcome':
        this.backoff = 1000;
        this.token = m.token;
        this.protected = m.protected;
        this.setState('open');
        this.emit('welcome', m);
        this.flush();
        return;
      case 'token':
        this.token = m.token;
        return;
      case 'room-update':
        this.protected = m.protected;
        if (m.token) this.token = m.token;
        this.emit('room-update', m);
        return;
      default:
        this.emit(m.t, m);
    }
  }

  sendRaw(s) {
    try { this.ws.send(s); return true; } catch { return false; }
  }

  /** Envia agora; se queue=true e o servidor estiver fora, guarda para depois. */
  send(obj, { queue = false, force = false } = {}) {
    const ok = this.ws && this.ws.readyState === 1 && (this.state === 'open' || force);
    if (ok && this.sendRaw(JSON.stringify(obj))) return true;
    if (queue) this.queue.push(obj);
    return false;
  }

  flush() {
    const q = this.queue;
    this.queue = [];
    for (const o of q) this.send(o, { queue: true });
  }

  auth(password) {
    this.password = password;
    if (this.ws && this.ws.readyState === 1) this.send({ t: 'auth', password }, { force: true });
    else this.nudge();
  }

  isOpen() { return this.state === 'open'; }

  api(path) { return `${WORKER_URL}/api/rooms/${encodeURIComponent(this.room)}${path}`; }

  close() {
    this.setState('closed');
    this.stopPing();
    clearTimeout(this.retryTimer);
    window.removeEventListener('online', this.onOnline);
    document.removeEventListener('visibilitychange', this.onVisible);
    try { this.ws?.close(1000, 'saindo'); } catch { /* ok */ }
  }
}
