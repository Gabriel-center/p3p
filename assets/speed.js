// Gráfico de velocidade ao vivo, no estilo da cópia de arquivos do Windows:
// eixo horizontal = progresso (0 a 100%), altura = velocidade naquele ponto,
// linha tracejada = velocidade atual.
export class SpeedMeter {
  constructor() {
    this.bins = new Float64Array(200).fill(-1);
    this.lastBin = -1;
    this.speed = 0;
    this.peak = 0;
    this.progress = 0;
    this.prev = null;
    this.startedAt = performance.now();
  }

  /** net: bytes que já passaram pela rede (cumulativo). progress: 0 a 1. */
  sample(net, progress) {
    const now = performance.now();
    if (!this.prev) this.prev = { t: now, b: net };
    const dt = (now - this.prev.t) / 1000;
    if (dt >= 0.2) {
      const inst = Math.max(0, (net - this.prev.b) / dt);
      this.speed = this.prev.seen ? this.speed * 0.55 + inst * 0.45 : inst;
      this.prev = { t: now, b: net, seen: true };
    }
    this.progress = Math.max(this.progress, Math.min(1, Math.max(0, progress || 0)));
    const n = this.bins.length;
    const bin = Math.min(n - 1, Math.floor(this.progress * n));
    for (let k = Math.max(0, this.lastBin + 1); k <= bin; k++) this.bins[k] = this.speed;
    if (bin >= 0) this.bins[bin] = this.speed;
    this.lastBin = Math.max(this.lastBin, bin);
    if (this.speed > this.peak) this.peak = this.speed;
  }

  svg() {
    const H = 40, n = this.bins.length;
    const top = Math.max(1, this.peak) * 1.2;
    const y = v => (H - Math.max(0, v) / top * (H - 3)).toFixed(2);
    const p = this.progress * 100;
    let d = '';
    if (this.lastBin >= 0) {
      d = `M0,${H}`;
      for (let i = 0; i <= this.lastBin; i++) d += ` L${((i + 0.5) / n * 100).toFixed(2)},${y(this.bins[i])}`;
      d += ` L${p.toFixed(2)},${y(this.bins[this.lastBin])} L${p.toFixed(2)},${H} Z`;
    }
    const cy = y(this.speed);
    return `<svg viewBox="0 0 100 ${H}" preserveAspectRatio="none" aria-hidden="true">
      <rect class="sg-done" x="0" y="0" width="${p.toFixed(2)}" height="${H}"/>
      <path class="sg-area" d="${d}"/>
      <line class="sg-cur" x1="0" x2="100" y1="${cy}" y2="${cy}"/>
      <line class="sg-at" x1="${p.toFixed(2)}" x2="${p.toFixed(2)}" y1="0" y2="${H}"/>
    </svg>`;
  }
}
