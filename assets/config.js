// Nome do app e onde está o servidor.
// O nome vem da pasta do site no GitHub Pages: /p3p/ → "p3p". Ele aparece no título e separa
// o que fica guardado no navegador; o servidor é escolhido em SERVER, logo abaixo.
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
const folder = (location.pathname.split('/').filter(Boolean)[0] || '').toLowerCase();

export const APP = !local && /^[a-z0-9-]{2,32}$/.test(folder) && !folder.includes('.') ? folder : 'p3p';

// O p3p usa o mesmo servidor do p2p (já configurado, com TURN e nuvem).
// Para ter um servidor só dele, troque 'p2p' por APP e publique o Worker "p3p".
const SERVER = 'p2p';

export const WORKER_URL = (window.P2P_WORKER_URL || (local
  ? `http://${location.hostname}:8787`
  : `https://${SERVER}.gabriel-center.workers.dev`)).replace(/\/+$/, '');

export const WS_URL = WORKER_URL.replace(/^http/, 'ws');

/** Endereço da página sem a sala, por exemplo https://gabriel-center.github.io/p3p/ */
export const PAGE_URL = `${location.origin}${location.pathname.replace(/[^/]*$/, '')}`;

/** Prefixo das chaves guardadas no navegador, para o p2p e o p3p não se misturarem. */
export const KEY = APP;

export const BLOCK_SIZE = 1024 * 1024;       // blocos de 1 MB nas transferências diretas
export const FRAME_SIZE = 64 * 1024 - 16;    // pedaço máximo por mensagem do WebRTC
export const CONNECT_TIMEOUT_MS = 20000;      // sem conexão direta depois disso, usa a nuvem
export const CLOUD_SWITCH_MS = 60000;         // transferência parada há 60 s vai para a nuvem
