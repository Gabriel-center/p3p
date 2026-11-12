// Contador global de uso (um único Durable Object para a conta inteira).
// Guarda o espaço ocupado no R2 em tempo real e, se houver token de analytics,
// consulta a API GraphQL da Cloudflare para os outros limites do plano grátis.
import { DurableObject } from 'cloudflare:workers';

const GB = 1024 ** 3;
const FREE = {
  storage: 10 * GB,
  r2ClassA: 1_000_000,
  r2ClassB: 10_000_000,
  workers: 100_000,
  durableObjects: 100_000,
  turn: 1000 * 1e9
};
const CLASS_A = new Set(['ListBuckets', 'PutBucket', 'ListObjects', 'PutObject', 'CopyObject', 'CompleteMultipartUpload',
  'CreateMultipartUpload', 'LifecycleStorageTierTransition', 'ListMultipartUploads', 'UploadPart', 'UploadPartCopy',
  'ListParts', 'PutBucketEncryption', 'PutBucketCors', 'PutBucketLifecycleConfiguration']);
const CLASS_B = new Set(['HeadBucket', 'HeadObject', 'GetObject', 'UsageSummary', 'GetBucketEncryption',
  'GetBucketLocation', 'GetBucketCors', 'GetBucketLifecycleConfiguration']);
const CACHE_MS = 60 * 1000;

function nextDayUTC(now = new Date()) {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
}
function nextMonthUTC(now = new Date()) {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
}
function dayStartUTC(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
function monthStartUTC(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
const monthKey = (d = new Date()) => `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;

export class Usage extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)`);
    this.cache = null;
  }
  get(k, d = 0) {
    const r = this.sql.exec(`SELECT v FROM kv WHERE k = ?`, k).toArray();
    return r.length ? JSON.parse(r[0].v) : d;
  }
  set(k, v) {
    this.sql.exec(`INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`, k, JSON.stringify(v));
  }
  rollMonth() {
    const mk = monthKey();
    if (this.get('month', '') !== mk) {
      this.set('month', mk);
      this.set('opsA', 0);
      this.set('opsB', 0);
    }
  }

  storedBytes() { return Math.max(0, this.get('stored', 0)); }

  /** delta em bytes (+ ao concluir upload, - ao apagar). ops = operações classe A estimadas. */
  adjust(delta, ops = 0) {
    this.rollMonth();
    this.set('stored', Math.max(0, this.get('stored', 0) + Number(delta || 0)));
    // createMultipartUpload + cada parte + complete
    if (delta > 0) this.set('opsA', this.get('opsA', 0) + Number(ops) + 2);
    this.cache = null;
    return this.storedBytes();
  }
  countRead() {
    this.rollMonth();
    this.set('opsB', this.get('opsB', 0) + 1);
  }

  async report() {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.data;
    this.rollMonth();
    const now = new Date();
    const day = nextDayUTC(now), month = nextMonthUTC(now);
    const meters = {
      storage: { label: 'Espaço na nuvem', used: this.storedBytes(), limit: FREE.storage, unit: 'bytes', resetAt: null, source: 'local' },
      r2ClassA: { label: 'Gravações na nuvem (mês)', used: this.get('opsA', 0), limit: FREE.r2ClassA, unit: 'count', resetAt: month, source: 'estimate' },
      r2ClassB: { label: 'Leituras na nuvem (mês)', used: this.get('opsB', 0), limit: FREE.r2ClassB, unit: 'count', resetAt: month, source: 'estimate' }
    };

    const token = this.env.CF_API_TOKEN, account = this.env.CF_ACCOUNT_ID;
    if (token && account) {
      const q = (query, variables) => fetch('https://api.cloudflare.com/client/v4/graphql', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: { account, ...variables } })
      }).then(r => r.json()).then(j => {
        if (j.errors && j.errors.length) throw new Error(j.errors[0].message);
        return j.data.viewer.accounts[0];
      });
      const iso = d => d.toISOString();
      const date = d => d.toISOString().slice(0, 10);
      const jobs = {
        workers: q(`query ($account: string!, $from: Time!, $to: Time!) { viewer { accounts(filter: {accountTag: $account}) {
            workersInvocationsAdaptive(limit: 10000, filter: {datetime_geq: $from, datetime_leq: $to}) { sum { requests } } } } }`,
          { from: iso(dayStartUTC(now)), to: iso(now) })
          .then(a => a.workersInvocationsAdaptive.reduce((s, r) => s + r.sum.requests, 0)),
        durableObjects: q(`query ($account: string!, $from: Date!, $to: Date!) { viewer { accounts(filter: {accountTag: $account}) {
            durableObjectsInvocationsAdaptiveGroups(limit: 10000, filter: {date_geq: $from, date_leq: $to}) { sum { requests } } } } }`,
          { from: date(now), to: date(now) })
          .then(a => a.durableObjectsInvocationsAdaptiveGroups.reduce((s, r) => s + r.sum.requests, 0)),
        r2ops: q(`query ($account: string!, $from: Time!, $to: Time!) { viewer { accounts(filter: {accountTag: $account}) {
            r2OperationsAdaptiveGroups(limit: 10000, filter: {datetime_geq: $from, datetime_leq: $to}) { sum { requests } dimensions { actionType } } } } }`,
          { from: iso(monthStartUTC(now)), to: iso(now) })
          .then(a => {
            let A = 0, B = 0;
            for (const r of a.r2OperationsAdaptiveGroups) {
              if (CLASS_A.has(r.dimensions.actionType)) A += r.sum.requests;
              else if (CLASS_B.has(r.dimensions.actionType)) B += r.sum.requests;
            }
            return { A, B };
          }),
        r2storage: q(`query ($account: string!, $from: Time!, $to: Time!) { viewer { accounts(filter: {accountTag: $account}) {
            r2StorageAdaptiveGroups(limit: 1, filter: {datetime_geq: $from, datetime_leq: $to}, orderBy: [datetime_DESC]) { max { payloadSize metadataSize } } } } }`,
          { from: iso(new Date(now - 2 * 86400000)), to: iso(now) })
          .then(a => a.r2StorageAdaptiveGroups.length ? a.r2StorageAdaptiveGroups[0].max.payloadSize + a.r2StorageAdaptiveGroups[0].max.metadataSize : null),
        turn: q(`query ($account: string!, $from: Date!, $to: Date!) { viewer { accounts(filter: {accountTag: $account}) {
            callsTurnUsageAdaptiveGroups(limit: 10000, filter: {date_geq: $from, date_leq: $to}) { sum { egressBytes } } } } }`,
          { from: date(monthStartUTC(now)), to: date(now) })
          .then(a => a.callsTurnUsageAdaptiveGroups.reduce((s, r) => s + r.sum.egressBytes, 0))
      };
      const keys = Object.keys(jobs);
      const results = await Promise.allSettled(keys.map(k => jobs[k]));
      const got = Object.fromEntries(keys.map((k, i) => [k, results[i]]));
      if (got.workers.status === 'fulfilled') meters.workers = { label: 'Requisições do servidor (hoje)', used: got.workers.value, limit: FREE.workers, unit: 'count', resetAt: day, source: 'cloudflare' };
      if (got.durableObjects.status === 'fulfilled') meters.durableObjects = { label: 'Requisições das salas (hoje)', used: got.durableObjects.value, limit: FREE.durableObjects, unit: 'count', resetAt: day, source: 'cloudflare' };
      if (got.r2ops.status === 'fulfilled') {
        meters.r2ClassA = { ...meters.r2ClassA, used: got.r2ops.value.A, source: 'cloudflare' };
        meters.r2ClassB = { ...meters.r2ClassB, used: got.r2ops.value.B, source: 'cloudflare' };
      }
      if (got.r2storage.status === 'fulfilled' && got.r2storage.value !== null) {
        meters.storage = { ...meters.storage, used: Math.max(meters.storage.used, got.r2storage.value) };
      }
      if (got.turn.status === 'fulfilled') meters.turn = { label: 'Relay TURN (mês)', used: got.turn.value, limit: FREE.turn, unit: 'bytes', resetAt: month, source: 'cloudflare' };
      const failed = keys.filter(k => got[k].status === 'rejected').map(k => `${k}: ${String(got[k].reason?.message || got[k].reason).slice(0, 160)}`);
      if (failed.length) meters._errors = failed;
    }

    const errors = meters._errors;
    delete meters._errors;
    const list = Object.entries(meters).map(([id, m]) => ({ id, ...m, pct: m.limit ? m.used / m.limit : 0 }));
    const data = { updatedAt: Date.now(), analytics: !!(token && account), errors, meters: list };
    this.cache = { at: Date.now(), data };
    return data;
  }
}
