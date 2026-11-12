// Simula o ajuste automático do nível de compressão em redes de várias velocidades.
// Velocidades e taxas de cada nível medidas com o zstd do site num arquivo TSV. Uso: node test/adaptive.test.mjs
import assert from 'node:assert/strict';

let now = 0;
globalThis.location = { hostname: 'localhost', pathname: '/', origin: 'http://localhost' };
globalThis.window = {};
Object.defineProperty(globalThis, 'performance', { value: { now: () => now }, configurable: true });
const { Outgoing } = await import('../assets/transfer.js');

const MB = 1024 * 1024;
const CPU = { 3: 70, 6: 24, 9: 15, 12: 7, 15: 4.6, 19: 1.9 };          // MB/s do arquivo
const RATIO = { 3: 0.313, 6: 0.293, 9: 0.275, 12: 0.277, 15: 0.281, 19: 0.177 };
const HIGH_WATER = 8 * MB;

function simulate(netMBs, seconds = 120) {
  now = 0;
  const mgr = { mesh: { send() {}, path: () => 'direct', remoteCaps: () => null }, codec: {}, nextNum: 1, changed() {} };
  const t = new Outgoing(mgr, { name: 'x.tsv', size: 1e12, type: '' }, 'peer', {});
  t.codec = 'zstd'; t.level = 3; t.state = 'sending';
  const dc = { bufferedAmount: 0 };
  let compressDoneAt = 0, rawSent = 0;
  const levels = [];
  const step = 0.01;
  for (let s = 0; s < seconds; s += step) {
    now = s * 1000;
    dc.bufferedAmount = Math.max(0, dc.bufferedAmount - netMBs * MB * step);
    if (s >= compressDoneAt && dc.bufferedAmount < HIGH_WATER) {
      // O bloco anterior terminou de comprimir: mede a velocidade e manda.
      const level = t.level;
      t.cpu[level] = CPU[level] * MB;
      const wire = RATIO[level] * MB;
      const queued = dc.bufferedAmount;
      dc.bufferedAmount += wire;
      t.wireQueued += wire; t.raw += MB; t.wire += wire; rawSent += MB;
      t.tune(dc, queued);
      compressDoneAt = s + 1 / CPU[t.level];
      levels.push(t.level);
    }
  }
  const last = levels.slice(-20);
  return { level: last[last.length - 1], rawMBs: rawSent / MB / seconds, levels: [...new Set(levels)] };
}

const cases = [
  ['Wi-Fi rápido, 60 MB/s', 60],
  ['rede boa, 10 MB/s', 10],
  ['4G, 2 MB/s', 2],
  ['4G fraco, 0,4 MB/s', 0.4]
];
const out = {};
for (const [name, net] of cases) {
  const r = simulate(net);
  out[name] = r;
  console.log(`${name.padEnd(22)} nível final ${String(r.level).padStart(2)}  arquivo a ${r.rawMBs.toFixed(1)} MB/s  (níveis usados: ${r.levels.join(', ')})`);
}
// Rede rápida: nível baixo, sem segurar o envio. Rede lenta: nível alto, mais arquivo por segundo do que o nível 3 daria.
assert.ok(out['Wi-Fi rápido, 60 MB/s'].level <= 6, 'rede rápida deveria ficar em nível baixo');
assert.ok(out['4G fraco, 0,4 MB/s'].level >= 15, 'rede muito lenta deveria subir para nível alto');
assert.ok(out['4G fraco, 0,4 MB/s'].rawMBs > 0.4 / RATIO[3] * 1.2, 'rede lenta deveria render mais que o nível 3');
assert.ok(out['Wi-Fi rápido, 60 MB/s'].rawMBs > 45, 'rede rápida não pode ficar presa na compressão');
console.log('ok');
