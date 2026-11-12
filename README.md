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
- **Transferência direta:** blocos de 1 MB numerados, compressão Zstandard por bloco (nível 3, ou 6 no relay), com deflate como reserva. Retoma do último bloco confirmado quando a conexão cai.
- **Nuvem:** upload em partes de 8 MB, gzip quando compensa. O arquivo some 48 h depois do último acesso, e cada download renova o prazo.
- **Presença:** quem perde a conexão fica "ausente" por 30 s antes de sair da sala. Uma queda rápida de rede ou recarregar a página não aparece para os outros. Sair pela seta de voltar avisa na hora.
- **Histórico:** local, no IndexedDB do navegador. Nunca vai para o servidor.
- **Interface:** tema claro, escuro ou automático (escolha em Configurações, salva no aparelho). Fontes Red Hat servidas pelo próprio site.

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
node test/e2e.cjs <node_modules com puppeteer-core e @sparticuz/chromium> <pasta>
```

O teste ponta a ponta abre três navegadores e cobre:

- conexão direta e mensagens
- 10 MB comprimidos
- 60 MB com queda no meio e retomada
- envio pela nuvem
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
