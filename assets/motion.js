// Movimento com mola: o mesmo jeito de acelerar e assentar em tudo o que se mexe no site.
// spring() devolve { easing, duration } para usar com element.animate(). Onde o navegador não entende
// linear(), cai numa curva parecida.
const LINEAR_OK = typeof CSS !== 'undefined' && CSS.supports?.('animation-timing-function', 'linear(0, 1)');
const cache = new Map();

/** bounce 0 = sem passar do ponto; 0.15 = passa um pouquinho e volta. */
export function spring(duration = 480, bounce = 0.12) {
  const key = `${duration}|${bounce}`;
  if (cache.has(key)) return cache.get(key);
  let easing = 'cubic-bezier(.32, .72, 0, 1)';
  if (LINEAR_OK) {
    const zeta = 1 - Math.min(0.9, Math.max(0, bounce)) * 0.9;    // amortecimento
    const w = 2 * Math.PI / (duration / 1000) * 0.9;               // frequência natural
    const wd = w * Math.sqrt(Math.max(1e-6, 1 - zeta * zeta));
    const pts = [];
    const N = 48;
    for (let i = 0; i <= N; i++) {
      const tt = (i / N) * duration / 1000;
      const v = zeta < 1
        ? 1 - Math.exp(-zeta * w * tt) * (Math.cos(wd * tt) + (zeta * w / wd) * Math.sin(wd * tt))
        : 1 - Math.exp(-w * tt) * (1 + w * tt);
      pts.push(i === N ? 1 : Math.round(v * 10000) / 10000);
    }
    easing = `linear(${pts.join(', ')})`;
  }
  const out = { easing, duration };
  cache.set(key, out);
  return out;
}

export const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Vibração curtinha onde o aparelho deixa (Android). */
export function tick(ms = 8) { try { navigator.vibrate?.(ms); } catch { /* sem vibração */ } }
