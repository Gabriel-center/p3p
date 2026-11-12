// Carimba uma versão nos endereços dos arquivos do site (app.js?v=..., import './x.js?v=...').
// O GitHub Pages deixa os arquivos no cache do navegador por 10 min; com a versão no endereço,
// quem abre o site depois de uma atualização recebe os arquivos novos na hora.
// Uso: npm run stamp  (antes de cada commit que muda o site)
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const v = new Date().toISOString().replace(/\D/g, '').slice(0, 12);
const files = ['index.html', ...readdirSync(join(root, 'assets')).filter(f => f.endsWith('.js')).map(f => `assets/${f}`)];

for (const f of files) {
  const p = join(root, f);
  const before = readFileSync(p, 'utf8');
  let s = before
    // import ... from './x.js' e import('./x.js') entre módulos do site
    .replace(/((?:from|import)\s*\(?\s*['"])(\.\/[\w-]+\.js)(?:\?v=\w+)?(['"])/g, `$1$2?v=${v}$3`)
    // index.html: assets/app.js, assets/app.css
    .replace(/(["'])(assets\/(?:app\.js|app\.css))(?:\?v=\w+)?(["'])/g, `$1$2?v=${v}$3`);
  if (s !== before) writeFileSync(p, s);
}
console.log(`versão ${v}`);
