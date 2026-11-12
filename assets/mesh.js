// Conexões diretas (WebRTC) entre todos os aparelhos da sala.
// Para cada par, o aparelho com o menor id inicia. A sinalização passa pelo servidor da sala.
import { WORKER_URL, CONNECT_TIMEOUT_MS } from './config.js';
import { randomId } from './device.js';

const HEARTBEAT_MS = 5000;
const DEAD_MS = 16000;
const RETRY_SERVER_MS = 60000;
const MAX_ICE_RESTARTS = 2;
const DEBUG = ['localhost', '127.0.0.1'].includes(location.hostname);
const STUN_ONLY = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];

let iceCache = null;
export async function getIceServers() {
  if (iceCache && Date.now() - iceCache.at < 30 * 60 * 1000) return iceCache.servers;
  try {
    const r = await fetch(`${WORKER_URL}/api/ice`, { cache: 'no-store' });
    const j = await r.json();
    if (Array.isArray(j.iceServers) && j.iceServers.length) {
      iceCache = { at: Date.now(), servers: j.iceServers, turn: !!j.turn };
      return j.iceServers;
    }
  } catch { /* sem servidor: tenta só STUN */ }
  return STUN_ONLY;
}

export class Mesh extends EventTarget {
  constructor(room, me) {
    super();
    this.room = room;
    this.me = me;
    this.links = new Map();
    this.closed = false;
    room.addEventListener('welcome', e => {
      const ids = new Set(e.detail.peers.map(p => p.peerId));
      for (const p of e.detail.peers) this.ensure(p, true);
      for (const [id, l] of this.links) if (!ids.has(id)) this.drop(id);
    });
    room.addEventListener('peer-join', e => this.ensure(e.detail.peer, false));
    room.addEventListener('peer-update', e => { const l = this.links.get(e.detail.peer.peerId); if (l) l.info = e.detail.peer; });
    room.addEventListener('peer-leave', e => this.drop(e.detail.peerId));
    room.addEventListener('peer', e => {
      const { from, data } = e.detail;
      if (!data || data.ch !== 'rtc') return;
      let l = this.links.get(from);
      if (!l) return;
      l.onSignal(data).catch(err => console.warn('sinal', err));
    });
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  ensure(info, fromWelcome) {
    if (info.peerId === this.me.peerId) return;
    let l = this.links.get(info.peerId);
    if (l) { l.info = info; if (fromWelcome) l.helloAfterReconnect(); return; }
    l = new Link(this, info);
    this.links.set(info.peerId, l);
    l.start();
  }

  drop(peerId) {
    const l = this.links.get(peerId);
    if (!l) return;
    l.destroy();
    this.links.delete(peerId);
    this.emit('gone', { peerId });
  }

  signal(peerId, data) {
    const ok = this.room.send({ t: 'peer', to: peerId, data: { ch: 'rtc', ...data } });
    this.links.get(peerId)?.trace(`→ ${data.kind}${data.description ? ':' + data.description.type : ''} g=${data.gen || '-'}${ok ? '' : ' (FALHOU)'}`);
    return ok;
  }

  path(peerId) { return this.links.get(peerId)?.path ?? 'server'; }
  isOpen(peerId) { const l = this.links.get(peerId); return !!(l && l.dc && l.dc.readyState === 'open'); }
  channel(peerId) { return this.links.get(peerId)?.dc ?? null; }
  remoteCaps(peerId) { return this.links.get(peerId)?.caps ?? null; }

  send(peerId, data) {
    const dc = this.channel(peerId);
    if (!dc || dc.readyState !== 'open') return false;
    try { dc.send(data); return true; } catch { return false; }
  }

  /** Tenta de novo todas as conexões que caíram para a nuvem. */
  retryAll() { for (const l of this.links.values()) if (l.path === 'server') l.recreate('manual'); }

  close() {
    this.closed = true;
    for (const id of [...this.links.keys()]) this.drop(id);
  }
}

class Link {
  constructor(mesh, info) {
    this.mesh = mesh;
    this.info = info;
    this.id = info.peerId;
    this.initiator = mesh.me.peerId < info.peerId;
    this.pc = null;
    this.dc = null;
    this.gen = null;          // geração da conexão atual (o iniciador cria, o outro ecoa)
    this.path = 'connecting';
    this.restarts = 0;
    this.lastRx = 0;
    this.createdAt = 0;
    this.caps = null;
    this.pendingIce = [];
  }

  trace(s) {
    if (!DEBUG) return;
    (this.log ||= []).push(`${(performance.now() / 1000).toFixed(2)} ${s}`);
    if (this.log.length > 80) this.log.shift();
  }

  setPath(p) {
    if (this.path === p) return;
    const prev = this.path;
    this.path = p;
    this.mesh.emit('path', { peerId: this.id, path: p, prev });
  }

  async start() {
    if (this.initiator) await this.createPc(randomId(6));
    else {
      // Pede ao outro lado uma conexão nova (cobre o caso de o outro achar que a antiga ainda vale).
      this.mesh.signal(this.id, { kind: 'reset' });
      this.armTimeout();
    }
  }

  helloAfterReconnect() {
    // O servidor voltou: se a conexão direta caiu nesse meio-tempo, recria.
    if (!this.dc || this.dc.readyState !== 'open') this.recreate('server-back');
  }

  armTimeout() {
    clearTimeout(this.timeout);
    this.timeout = setTimeout(() => {
      if (!this.dc || this.dc.readyState !== 'open') this.fallBack();
    }, CONNECT_TIMEOUT_MS);
  }

  fallBack() {
    this.setPath('server');
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.recreate('retry'), RETRY_SERVER_MS);
  }

  async createPc(gen) {
    this.trace(`createPc ${gen}`);
    this.closePc();
    this.gen = gen;
    this.createdAt = Date.now();
    this.pendingIce = [];
    this.creating = true;
    const iceServers = await getIceServers();
    this.creating = false;
    // Outra criação começou enquanto esta esperava: a mais recente vence.
    if (this.mesh.closed || this.gen !== gen) return;
    const pc = new RTCPeerConnection({ iceServers });
    this.pc = pc;
    pc.onicecandidate = e => { if (e.candidate && this.pc === pc) this.mesh.signal(this.id, { kind: 'ice', gen, candidate: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => this.pc === pc && this.onState();
    pc.oniceconnectionstatechange = () => this.pc === pc && this.onState();
    pc.ondatachannel = e => this.pc === pc && this.attach(e.channel);
    if (this.initiator) {
      pc.onnegotiationneeded = async () => {
        if (this.pc !== pc) return;
        try {
          await pc.setLocalDescription();
          this.mesh.signal(this.id, { kind: 'sdp', gen, description: pc.localDescription.toJSON() });
        } catch (err) { console.warn('oferta', err); }
      };
      this.attach(pc.createDataChannel('p2p', { ordered: true }));
    }
    this.armTimeout();
  }

  async onSignal(data) {
    this.trace(`← ${data.kind}${data.description ? ':' + data.description.type : ''} g=${data.gen || '-'} (atual ${this.gen}, pc ${this.pc ? this.pc.signalingState : 'nenhum'}${this.creating ? ', criando' : ''})`);
    if (data.kind === 'reset' || data.kind === 'restart') {
      if (!this.initiator) return;
      if (data.kind === 'restart' && this.pc && this.restarts < MAX_ICE_RESTARTS) { this.restarts++; this.pc.restartIce(); return; }
      // Ignora pedidos repetidos logo depois de criar a conexão.
      if (this.creating) return;
      if (this.pc && Date.now() - this.createdAt < 3000 && this.pc.connectionState !== 'failed') return;
      await this.recreate('reset');
      return;
    }
    if (data.kind === 'sdp') {
      const d = data.description;
      if (this.initiator) {
        if (data.gen !== this.gen || d.type !== 'answer' || !this.pc) return;
        if (this.pc.signalingState !== 'have-local-offer') return;
        await this.pc.setRemoteDescription(d);
        await this.drainIce();
        return;
      }
      if (d.type !== 'offer') return;
      if (data.gen !== this.gen || !this.pc) await this.createPc(data.gen);
      if (data.gen !== this.gen || !this.pc) return;
      const pc = this.pc;
      await pc.setRemoteDescription(d);
      await this.drainIce();
      await pc.setLocalDescription();
      this.mesh.signal(this.id, { kind: 'sdp', gen: this.gen, description: pc.localDescription.toJSON() });
      return;
    }
    if (data.kind === 'ice') {
      if (data.gen !== this.gen) return;
      // Conexão ainda sendo criada ou sem descrição remota: guarda o candidato para depois.
      if (!this.pc || !this.pc.remoteDescription) { this.pendingIce.push(data.candidate); return; }
      try { await this.pc.addIceCandidate(data.candidate); } catch { /* candidato velho */ }
    }
  }

  async drainIce() {
    const list = this.pendingIce;
    this.pendingIce = [];
    for (const c of list) { try { await this.pc.addIceCandidate(c); } catch { /* ok */ } }
  }

  attach(dc) {
    this.dc = dc;
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = 1024 * 1024;
    dc.onopen = () => {
      if (this.dc !== dc) return;
      this.lastRx = Date.now();
      this.restarts = 0;
      clearTimeout(this.timeout);
      clearTimeout(this.retryTimer);
      this.startHeartbeat();
      dc.send(JSON.stringify({ x: 'hello', caps: this.mesh.localCaps || {} }));
      this.detectPath();
      this.mesh.emit('open', { peerId: this.id });
    };
    dc.onmessage = e => {
      if (this.dc !== dc) return;
      this.lastRx = Date.now();
      const d = e.data;
      if (typeof d === 'string') {
        if (d.charCodeAt(0) === 123 /* { */) {
          let m; try { m = JSON.parse(d); } catch { return; }
          if (m.x === 'ping') { try { dc.send('{"x":"pong"}'); } catch { /* ok */ } return; }
          if (m.x === 'pong') return;
          if (m.x === 'hello') { this.caps = m.caps || {}; this.mesh.emit('caps', { peerId: this.id, caps: this.caps }); return; }
          this.mesh.emit('data', { peerId: this.id, msg: m });
        }
        return;
      }
      this.mesh.emit('binary', { peerId: this.id, buf: d });
    };
    dc.onclose = () => {
      if (this.dc !== dc) return;
      this.stopHeartbeat();
      this.mesh.emit('close', { peerId: this.id });
      if (!this.mesh.closed && this.mesh.links.get(this.id) === this) {
        this.setPath('reconnecting');
        setTimeout(() => this.recreate('dc-closed'), 1500);
      }
    };
  }

  onState() {
    const pc = this.pc;
    const s = pc.connectionState || pc.iceConnectionState;
    if (s === 'connected' || pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
      this.detectPath();
      return;
    }
    if (s === 'disconnected') {
      this.setPath('reconnecting');
      clearTimeout(this.discTimer);
      this.discTimer = setTimeout(() => {
        if (this.pc === pc && pc.connectionState === 'disconnected') this.restartIce();
      }, 4000);
      return;
    }
    if (s === 'failed') this.restartIce();
  }

  restartIce() {
    if (this.restarts >= MAX_ICE_RESTARTS) { this.fallBack(); return; }
    this.setPath('reconnecting');
    if (this.initiator) { this.restarts++; try { this.pc.restartIce(); } catch { this.recreate('restart-failed'); } }
    else this.mesh.signal(this.id, { kind: 'restart' });
    this.armTimeout();
  }

  async detectPath() {
    const pc = this.pc;
    if (!pc) return;
    try {
      const stats = await pc.getStats();
      let pair = null;
      stats.forEach(r => {
        if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId);
      });
      if (!pair) stats.forEach(r => { if (r.type === 'candidate-pair' && (r.selected || r.nominated) && r.state === 'succeeded') pair = r; });
      if (!pair) return;
      const local = stats.get(pair.localCandidateId), remote = stats.get(pair.remoteCandidateId);
      const relayed = local?.candidateType === 'relay' || remote?.candidateType === 'relay';
      if (this.dc && this.dc.readyState === 'open') this.setPath(relayed ? 'relay' : 'direct');
    } catch { /* estatísticas indisponíveis */ }
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.hb = setInterval(() => {
      const dc = this.dc;
      if (!dc || dc.readyState !== 'open') return;
      if (Date.now() - this.lastRx > DEAD_MS) {
        this.setPath('reconnecting');
        this.recreate('heartbeat');
        return;
      }
      try { dc.send('{"x":"ping"}'); } catch { /* ok */ }
      this.detectPath();
    }, HEARTBEAT_MS);
  }
  stopHeartbeat() { clearInterval(this.hb); }

  async recreate(why) {
    if (this.mesh.closed) return;
    clearTimeout(this.retryTimer);
    if (this.path !== 'server') this.setPath('reconnecting');
    if (this.initiator) {
      this.restarts = 0;
      await this.createPc(randomId(6));
    } else {
      this.closePc();
      this.mesh.signal(this.id, { kind: 'reset', why });
      this.armTimeout();
    }
  }

  closePc() {
    this.stopHeartbeat();
    clearTimeout(this.discTimer);
    const dc = this.dc, pc = this.pc;
    this.dc = null;
    this.pc = null;
    try { dc?.close(); } catch { /* ok */ }
    try { pc?.close(); } catch { /* ok */ }
  }

  destroy() {
    clearTimeout(this.timeout);
    clearTimeout(this.retryTimer);
    this.closePc();
  }
}
