// Confere o .zip feito no navegador (assets/zip.js): o Python e o unzip abrem, conferem o CRC de cada
// arquivo e o conteúdo extraído é idêntico ao original. Também testa o formato ZIP64 e nomes repetidos.
// Uso: node test/zip.test.mjs
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeZip } from '../assets/zip.js';

const sha = b => createHash('sha256').update(b).digest('hex');
const text = Buffer.from(Array.from({ length: 60000 }, (_, i) => `linha ${i}: temperatura ${(i % 40) + 0.5}\n`).join(''));
const files = [
  ['relatório final.txt', text, 'text/plain'],
  ['foto.jpg', randomBytes(700 * 1024 + 3), 'image/jpeg'],
  ['foto.jpg', randomBytes(1000), 'image/jpeg'],             // nome repetido
  ['../../etc/passwd', Buffer.from('nada de pastas'), ''],    // nome perigoso
  ['vazio.bin', Buffer.alloc(0), ''],
  ['dados.bin', randomBytes(3 * 1024 * 1024), 'application/octet-stream'],
  ['ação ✓ 日本.csv', Buffer.from('a;b;c\n1;2;3\n'.repeat(5000)), 'text/csv']
];
const dir = mkdtempSync(join(tmpdir(), 'zip-'));
const py = `
import zipfile, hashlib, json, sys
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None, 'CRC'
print(json.dumps({i.filename: [hashlib.sha256(z.read(i)).hexdigest(), i.compress_type, i.file_size, i.compress_size] for i in z.infolist()}))`;

for (const force64 of [false, true]) {
  let last = 0;
  const blob = await makeZip(files.map(([name, buf, type]) => ({ name, blob: new Blob([buf], { type }) })), { force64, onProgress: d => { last = d; } });
  const path = join(dir, force64 ? 'z64.zip' : 'z.zip');
  writeFileSync(path, Buffer.from(await blob.arrayBuffer()));
  const got = JSON.parse(execFileSync('python3', ['-c', py, path]).toString());
  const names = Object.keys(got);
  assert.deepEqual(names, ['relatório final.txt', 'foto.jpg', 'foto (2).jpg', '_.._etc_passwd', 'vazio.bin', 'dados.bin', 'ação ✓ 日本.csv']);
  files.forEach(([, buf], i) => assert.equal(got[names[i]][0], sha(buf), `${names[i]}: conteúdo`));
  assert.equal(got['relatório final.txt'][1], 8, 'texto deveria ser comprimido');
  assert.equal(got['foto.jpg'][1], 0, 'foto deveria entrar como está');
  assert.equal(got['dados.bin'][1], 0, 'dado aleatório não encolhe: entra como está');
  assert.equal(last, files.reduce((s, f) => s + f[1].length, 0), 'progresso chega ao total');
  execFileSync('unzip', ['-tq', path]);
  const zipped = got['relatório final.txt'];
  console.log(`✔ zip${force64 ? '64' : ''}: ${names.length} arquivos idênticos, CRC conferido pelo Python e pelo unzip (texto: ${zipped[2]} → ${zipped[3]} bytes)`);
}
