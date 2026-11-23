# p3p

Versão de teste do [p2p](https://github.com/gabriel-center/p2p) com a interface nova. Salas por nome para mandar mensagens e arquivos entre aparelhos. Quem abre o mesmo endereço entra na mesma sala, sem cadastro:

```
https://gabriel-center.github.io/p3p/?sala01
```

## Como funciona

- **Site:** arquivos estáticos neste repositório, servidos pelo GitHub Pages.
- **Servidor:** um Worker da Cloudflare (código em `worker/`, configuração em `wrangler.jsonc` na raiz). Cada sala é um Durable Object que cuida de presença, mensagens (últimas 200), senha, lista de arquivos e expiração.
- **Entrega de arquivos, em ordem de preferência:**
  1. WebRTC direto entre os aparelhos (STUN)
  2. WebRTC pelo relay TURN da Cloudflare
  3. Nuvem: R2, bucket `p3p-files`
- **Transferência direta:** blocos numerados com compressão Zstandard por bloco, com deflate como reserva. Retoma do último bloco confirmado quando a conexão cai.
  - **Nível automático:** começa no 3 (6 no relay). A cada segundo, compara a velocidade da rede com a da compressão: sobe de nível (6, 9, 12, 15, 19) quando a rede é o gargalo e o processador tem folga, e desce quando a compressão começa a segurar o envio. Em rede lenta, manda mais arquivo por segundo; em rede rápida, não atrasa nada.
  - **Blocos de 8 MB:** em arquivos a partir de 24 MB, o site testa uma amostra do meio. Se o nível 9 com bloco grande render bem mais que o normal (arquivos com partes repetidas, como backups e imagens de disco), usa blocos de 8 MB. No teste, um backup passou de 59% para 85% de economia.
  - **Conferência sem perda:** antes de cada bloco vai o SHA-256 do bloco original. Quem recebe descompacta, calcula de novo e só grava se for igual; se não for, pede o bloco de novo (3 tentativas, depois o envio falha em vez de gravar dado errado). O cartão mostra "Idêntico ao original" quando todos os blocos bateram.
- **Nuvem:** upload em partes de 8 MB, gzip quando compensa. O arquivo some 48 h depois do último acesso, e cada download renova o prazo.
- **Compressão sempre à vista:** cada cartão (e cada arquivo guardado) mostra quanto foi comprimido, em % e em tamanho original → tamanho que passou pela rede, com o algoritmo usado.
- **Fotos e vídeos:** a oferta leva uma miniatura de 96 px, então quem recebe já vê a prévia desfocada enquanto o arquivo chega, como no WhatsApp. Tocar na foto ou no vídeo abre o visualizador em tela cheia (setas, teclado, deslizar no celular, vídeo e áudio com play).
- **Lotes:** vários arquivos enviados juntos viram um cartão só, com até 4 quadrados e "+N" no último, a lista completa e os botões "Baixar tudo (.zip)" e "Baixar separados". O zip é montado no próprio navegador (`assets/zip.js`, com ZIP64 para arquivos acima de 4 GB).
- **Convite:** o QR code fica sempre na lateral (e na conversa vazia), mesmo com gente na sala, e abre grande ao tocar.
- **Presença:** quem perde a conexão fica "ausente" por 30 s antes de sair da sala. Uma queda rápida de rede ou recarregar a página não aparece para os outros. Sair pela seta de voltar avisa na hora.
- **Histórico:** local, no IndexedDB do navegador. Nunca vai para o servidor.
- **Interface:** tema claro, escuro ou automático (escolha em Configurações, salva no aparelho). Fontes Red Hat servidas pelo próprio site.

## Versão "vidro"

`vidro/index.html` (no ar em `/p3p/vidro/`) é o mesmo site com outra identidade visual: material de vidro translúcido sobre o conteúdo, cápsulas, cantos concêntricos, cores e fonte do sistema (San Francisco nos aparelhos que a têm, Inter nos outros). No celular, barra de navegação e barra de abas flutuantes, com o campo de envio logo acima; no computador, barra lateral e inspetor flutuando. Usa o mesmo código, servidor e salas: abrir `?sala` nas duas versões coloca as duas na mesma sala.

- Estilo: `assets/vidro.css`, carregado depois de `assets/app.css`. Todas as regras começam com `html[data-skin="vidro"]`.
- Comportamento: igual. O `app.js` só troca ícones, a marca e pequenos trechos de HTML quando a página tem `data-skin="vidro"`.
- Fonte Inter (OFL): `assets/fonts/inter-*.woff2`, licença em `assets/fonts/LICENSE-inter.txt`.

## Publicar

### 1. Site (GitHub Pages)

Settings → Pages → Source: *Deploy from a branch* → Branch `main`, pasta `/ (root)`.

### 2. Servidor (Cloudflare Workers)

1. R2 → crie o bucket `p3p-files`.
2. Workers & Pages → Create → *Import a repository* → `gabriel-center/p3p`. Use as opções padrão:
   - **Root directory:** vazio (raiz do repositório)
   - **Build command:** vazio
   - **Deploy command:** `npx wrangler deploy`
3. No Worker `p3p` → Settings → *Variables and Secrets*, adicione como **Secret**:

| Nome | Para quê | Obrigatório |
| --- | --- | --- |
| `TURN_KEY_ID` | Key ID da chave TURN (Realtime → TURN) | Sim, para o relay |
| `TURN_KEY_API_TOKEN` | API Token da mesma chave | Sim, para o relay |
| `ADMIN_PASSWORD` | Senha do botão "Apagar tudo". Sem ela, vale `admin` | Recomendado |
| `CF_ACCOUNT_ID` | ID da conta, para o painel de uso | Opcional |
| `CF_API_TOKEN` | Token com permissão *Account Analytics: Read* | Opcional |

Por enquanto o p3p usa o servidor do p2p (`https://p2p.gabriel-center.workers.dev`), definido em `SERVER` no `assets/config.js`. Para ter um servidor só dele, publique o Worker `p3p` com os passos acima e troque `SERVER` por `APP`.

Sem `CF_ACCOUNT_ID` e `CF_API_TOKEN`, o painel de uso mostra o espaço ocupado e uma estimativa das operações. Com eles, mostra os números reais da Cloudflare: requisições do dia, operações do R2 e tráfego TURN do mês.

## Desenvolvimento local

```bash
npm install
npm run dev                                     # servidor em http://127.0.0.1:8787
python3 -m http.server 8788                     # site, em outro terminal
```

Abra `http://127.0.0.1:8788/?teste` em duas abas anônimas.

### Testes

```bash
node worker/test/server.test.mjs                 # servidor: 14 cenários
node test/lossless.test.mjs                      # compressão sem perda: zstd em todos os níveis, deflate, gzip, transferência completa e blocos corrompidos
node test/zip.test.mjs                           # .zip do navegador conferido pelo Python e pelo unzip (normal e ZIP64)
node test/adaptive.test.mjs                      # ajuste automático do nível de compressão
node test/e2e.cjs <node_modules com puppeteer-core e @sparticuz/chromium> <pasta>
CHROME=/usr/bin/google-chrome node test/e2e.cjs <node_modules com puppeteer-core> <pasta>   # com o Chrome instalado
```

O teste ponta a ponta abre três navegadores e cobre:

- conexão direta e mensagens
- QR code na lateral com gente na sala, e grande ao abrir
- 10 MB comprimidos, com a linha de compressão e a conferência SHA-256 nos cartões
- lote com fotos, vídeo e texto: álbum com "+N", miniaturas antes de chegar, visualizador (foto e vídeo tocando) e zip conferido
- 60 MB com queda no meio e retomada
- envio pela nuvem, também em lote (álbum e zip baixando da nuvem)
- arquivos guardados na sala
- senha, painel de uso e "Apagar tudo"

## Limites (plano grátis)

| Item | Limite |
| --- | --- |
| Aparelhos por sala | 8 |
| Arquivo na nuvem | 2 GB |
| Nuvem por sala | 5 GB |
| Nuvem no total | cerca de 9,5 GB, dos 10 GB grátis do R2 |

Os valores ficam em `wrangler.jsonc`.

## Licenças de terceiros

- `assets/vendor/zstd`: @bokuweb/zstd-wasm (MIT) e Zstandard (BSD)
- `assets/vendor/qrcode`: qrcode-generator (MIT)

## Atualizar o site

O GitHub Pages deixa os arquivos no cache do navegador por até 10 minutos. Antes de cada commit que muda o site, rode `npm run stamp`: ele carimba uma versão nos endereços dos arquivos, e quem abrir o site recebe a versão nova na hora.
