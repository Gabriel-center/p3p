// Português é o texto-base. Em navegadores em outro idioma, usa o inglês abaixo.
export const LANG = /^pt\b/i.test(navigator.language || 'pt') ? 'pt' : 'en';

const EN = {
  'Abra uma sala.': 'Open a room.',
  'Quem abrir o mesmo endereço entra na mesma sala. Mande mensagens e arquivos entre seus aparelhos, direto de um para o outro sempre que a rede deixar.':
    'Anyone who opens the same address joins the same room. Send messages and files between your devices, straight from one to the other whenever the network allows.',
  'Entrar': 'Join', 'Criar sala com nome aleatório': 'Create a room with a random name',
  'Letras, números, - e _. Até 48 caracteres.': 'Letters, numbers, - and _. Up to 48 characters.',
  'Salas recentes neste aparelho': 'Recent rooms on this device',
  'Nenhuma sala ainda. As salas que você abrir aparecem aqui.': 'No rooms yet. Rooms you open show up here.',
  'Sem cadastro': 'No sign-up', 'A sala nasce quando alguém abre o link e qualquer um com o link entra.': 'A room starts when someone opens its link, and anyone with the link can join.',
  'Três caminhos': 'Three paths', 'Direto entre aparelhos, relay da Cloudflare ou nuvem, nessa ordem.': 'Direct between devices, Cloudflare relay, or the cloud, in that order.',
  'Arquivos guardados por 48 h': 'Files kept for 48 h', 'Contadas a partir do último acesso. Cada download renova o prazo.': 'Counted from the last access. Every download restarts the clock.',
  'Histórico': 'History', 'Agora': 'Now', '{n} visitas': '{n} visits', '1 visita': '1 visit',
  'Copiar link': 'Copy link', 'QR code': 'QR code', 'Renomear': 'Rename', 'Link copiado': 'Link copied',
  'Conversa': 'Chat', 'Aparelhos': 'Devices', 'Guardados': 'Stored', 'Na sala': 'In the room',
  'você': 'you', 'aba {n}': 'tab {n}', 'Este aparelho': 'This device',
  'Celular': 'Phone', 'Tablet': 'Tablet', 'Computador': 'Computer',
  'Direto': 'Direct', 'Relay': 'Relay', 'Servidor': 'Server', 'Reconectando': 'Reconnecting', 'Conectando': 'Connecting',
  'Conexão direta entre os aparelhos': 'Direct connection between devices',
  'Passa pelo TURN da Cloudflare': 'Goes through the Cloudflare TURN relay',
  'Sem conexão direta: arquivos vão pela nuvem': 'No direct connection: files go through the cloud',
  'A conexão caiu e está voltando': 'The connection dropped and is coming back',
  'Procurando o melhor caminho': 'Looking for the best path',
  'Mensagem para a sala': 'Message to the room', 'Anexar': 'Attach', 'Enviar': 'Send',
  'Para todos na sala ({n})': 'To everyone in the room ({n})', 'Só para {name}': 'Only to {name}',
  'Arraste arquivos ou cole com Ctrl+V': 'Drag files or paste with Ctrl+V',
  'Guardados na sala': 'Stored in the room', 'Qualquer um na sala baixa, inclusive quem entrar depois.': 'Anyone in the room can download, including people who join later.',
  'Solte aqui para guardar na sala': 'Drop here to store in the room', 'Escolher arquivo': 'Choose file',
  'Nada guardado ainda.': 'Nothing stored yet.', 'por {name}': 'by {name}', 'Some em {h} h sem novo acesso': 'Deleted in {h} h without a new access',
  'Some em menos de 1 h sem novo acesso': 'Deleted in under 1 h without a new access',
  'Usando {used} de {max} desta sala.': 'Using {used} of {max} in this room.',
  'Baixar {name}': 'Download {name}', 'Apagar {name}': 'Delete {name}',
  'Você entrou na sala': 'You joined the room', '{name} entrou': '{name} joined', '{name} saiu': '{name} left',
  '{name} agora está em {path}': '{name} is now on {path}',
  '{name} entrou sem conexão direta. Arquivos para esse aparelho vão pela nuvem.': '{name} has no direct connection. Files for this device go through the cloud.',
  'Para {name}': 'To {name}', 'De {name}': 'From {name}', 'Para a sala': 'To the room',
  'Recebido em {t}': 'Received in {t}', 'Enviado em {t}': 'Sent in {t}', 'Salvar arquivo': 'Save file', 'Guardar na sala': 'Store in the room',
  '{done} de {total} blocos de 1 MB': '{done} of {total} 1 MB blocks', '{speed}, faltam {eta}': '{speed}, {eta} left',
  'Pausar': 'Pause', 'Continuar': 'Resume', 'Cancelar': 'Cancel', 'Tentar agora': 'Try now',
  'A conexão caiu. O envio continua do bloco {n} assim que a rede voltar.': 'The connection dropped. Sending resumes from block {n} once the network is back.',
  'Esperando {name} aceitar': 'Waiting for {name}', 'Preparando': 'Preparing', 'Cancelado': 'Cancelled', 'Falhou: {why}': 'Failed: {why}',
  'Comprimido {p}%': 'Compressed {p}%', 'Sem compressão': 'No compression', 'Sem compressão, já compactado': 'No compression, already compressed',
  'Continuando pela nuvem': 'Continuing through the cloud', 'Enviando para a nuvem': 'Uploading to the cloud',
  'Enviado pela nuvem. {name} baixa quando quiser.': 'Sent through the cloud. {name} can download it any time.',
  'Recebido pela nuvem': 'Received through the cloud', 'Baixar': 'Download',
  'O envio foi interrompido do outro lado. Peça para enviar de novo.': 'The sender stopped. Ask them to send it again.',
  'Ninguém mais na sala. O arquivo foi guardado na sala por 48 h.': 'Nobody else is here. The file was stored in the room for 48 h.',
  'Esta sala tem senha': 'This room has a password', 'Senha': 'Password', 'Lembrar neste aparelho': 'Remember on this device',
  'Senha errada. Restam {n} tentativas.': 'Wrong password. {n} attempts left.', 'Muitas tentativas. Espere um minuto e recarregue a página.': 'Too many attempts. Wait a minute and reload the page.',
  'Sala cheia': 'Room is full', 'Esta sala já tem {n} aparelhos, o máximo permitido. Tente de novo quando alguém sair.': 'This room already has {n} devices, the maximum. Try again when someone leaves.',
  'Voltar ao início': 'Back to start', 'Conectando à sala': 'Connecting to the room', 'Sem conexão com o servidor. Tentando de novo em {s} s.': 'No connection to the server. Retrying in {s} s.',
  'Sem conexão com o servidor. Mensagens vão direto para quem estiver conectado.': 'No connection to the server. Messages go straight to connected devices.',
  'Sala': 'Room', 'Configurações da sala': 'Room settings', 'Senha da sala': 'Room password',
  'Sem senha. Qualquer um com o link entra.': 'No password. Anyone with the link can join.', 'Com senha. Quem entrar precisa digitar a senha.': 'Password set. People joining must type it.',
  'Nova senha': 'New password', 'Definir senha': 'Set password', 'Trocar senha': 'Change password', 'Remover senha': 'Remove password',
  'Senha definida por {name}': 'Password set by {name}', 'Senha removida por {name}': 'Password removed by {name}',
  'Apagar tudo': 'Delete everything', 'Apaga todas as mensagens e arquivos guardados desta sala. Não dá para desfazer.': 'Deletes every message and stored file in this room. This cannot be undone.',
  'Senha de admin': 'Admin password', 'Apagar mensagens e arquivos': 'Delete messages and files', 'Senha de admin errada.': 'Wrong admin password.',
  '{name} apagou tudo nesta sala': '{name} deleted everything in this room', 'Fechar': 'Close',
  'Uso da nuvem': 'Cloud usage', 'reset em {t}': 'resets in {t}', 'sem reset': 'no reset', 'Libera conforme os arquivos expiram.': 'Frees up as files expire.',
  'Estimativa local. Configure o token de analytics para números exatos.': 'Local estimate. Set the analytics token for exact numbers.',
  '{d} dias e {hms}': '{d} days and {hms}', '1 dia e {hms}': '1 day and {hms}',
  'Abrir no celular': 'Open on your phone', 'Aponte a câmera para entrar em {room}.': 'Point your camera to join {room}.',
  'Agora você é {name}': 'You are now {name}', 'Arquivo grande demais. O limite na nuvem é {max}.': 'File too large. The cloud limit is {max}.',
  'A nuvem desta sala está cheia ({max}).': 'This room’s cloud space is full ({max}).', 'A nuvem está cheia. Espere arquivos expirarem.': 'The cloud is full. Wait for files to expire.',
  'Fica só neste navegador. Guarda quem conectou, por qual caminho e o que foi transferido, nunca o conteúdo.':
    'Stays in this browser only. It records who connected, over which path and what was transferred, never the content.',
  'Todas as salas': 'All rooms', 'Buscar arquivo ou aparelho': 'Search file or device', 'Limpar histórico': 'Clear history',
  'Limpar todo o histórico deste aparelho?': 'Clear all history on this device?', 'Limpar': 'Clear',
  'Nada no histórico ainda.': 'Nothing in history yet.', 'Hoje': 'Today', 'Ontem': 'Yesterday',
  'Enviado {name} para {to}': 'Sent {name} to {to}', 'Recebido {name} de {from}': 'Received {name} from {from}',
  'Guardado na sala: {name}': 'Stored in the room: {name}', '{name} entrou ({kind})': '{name} joined ({kind})', 'Você saiu da sala': 'You left the room',
  'Envio cancelado: {name}': 'Transfer cancelled: {name}', 'Envio falhou: {name}': 'Transfer failed: {name}',
  'Velocidade: {s}': 'Speed: {s}', '{done} de {total}': '{done} of {total}', 'faltam {t}': '{t} left', 'bloco {n} de {total}': 'block {n} of {total}', 'média de {s}': 'average {s}',
  'Início': 'Start', 'Nuvem': 'Cloud', 'Gravações': 'Writes', 'Leituras': 'Reads', 'Salas': 'Rooms', 'sala': 'room', 'Mensagem não enviada. Tentando de novo.': 'Message not sent. Retrying.',
  "Gerar nome aleatório": "Random name",
  "Sem cadastro. Letras, números, - e _.": "No sign-up. Letters, numbers, - and _.",
  "Os arquivos vão de um aparelho para o outro, sem passar por servidor. É o caminho mais rápido.": "Files go straight from one device to the other, without a server in between. The fastest path.",
  "Quando a rede bloqueia a conexão direta, a Cloudflare repassa os dados sem guardar nada.": "When the network blocks a direct connection, Cloudflare relays the data without storing it.",
  "Sem nenhum dos dois, o arquivo fica guardado na sala por 48 h para quem baixar depois.": "If neither works, the file is kept in the room for 48 h for whoever downloads it later.",
  "Copiar link da sala": "Copy room link",
  "Convidar": "Invite",
  "Mudar meu nome": "Change my name",
  "Entrando na sala": "Joining the room",
  "Escreva uma mensagem": "Write a message",
  "Anexar arquivo": "Attach file",
  "Enviar para": "Send to",
  "Convidar para a sala": "Invite to the room",
  "Quem abrir este endereço entra na sala.": "Anyone who opens this address joins the room.",
  "Compartilhar": "Share",
  "No celular, aponte a câmera para o código.": "On a phone, point the camera at the code.",
  "Seu nome na sala": "Your name in the room",
  "É como os outros aparelhos veem você.": "This is how other devices see you.",
  "Nome": "Name",
  "Salvar": "Save",
  "Solte para enviar": "Drop to send",
  "Vai para quem estiver selecionado no campo de envio.": "Goes to whoever is selected next to the message box.",
  "Ninguém mais na sala: fica guardado por 48 h.": "Nobody else is here: it will be stored for 48 h.",
  "Conectado": "Connected",
  "Sem sinal agora": "No signal right now",
  "Ausente": "Away",
  "aparelhos": "devices",
  "aparelho": "device",
  "Só você por aqui": "Just you here",
  "Abra o mesmo endereço em outro aparelho para conectar.": "Open the same address on another device to connect.",
  "Mostrar QR code": "Show QR code",
  "Para todos ({n})": "To everyone ({n})",
  "A sala está pronta": "The room is ready",
  "Abra o mesmo endereço em outro aparelho, ou aponte a câmera do celular para o código. Arquivos enviados agora ficam guardados por 48 h.": "Open the same address on another device, or point your phone camera at the code. Files you send now are kept for 48 h.",
  "Conectado com {name}": "Connected to {name}",
  "{n} aparelhos conectados": "{n} devices connected",
  "Escreva uma mensagem ou arraste arquivos para cá. Eles vão direto para os outros aparelhos sempre que a rede deixar.": "Write a message or drag files here. They go straight to the other devices whenever the network allows.",
  "some em {h} h": "deleted in {h} h",
  "some em menos de 1 h": "deleted in under 1 h",
  "Cada download renova o prazo de 48 h.": "Every download restarts the 48 h clock.",
  "Apagar": "Delete",
  "Toque de novo para apagar": "Tap again to delete",
  "Recebido pela nuvem. Fica disponível por 48 h.": "Received through the cloud. Available for 48 h.",
  "Sem conexão direta. Continuando pela nuvem.": "No direct connection. Continuing through the cloud.",
  "Mandar pela nuvem": "Send through the cloud",
  'Aparência': 'Appearance', 'Automático': 'Automatic', 'Claro': 'Light', 'Escuro': 'Dark',
  'Tema: automático': 'Theme: automatic', 'Tema: claro': 'Theme: light', 'Tema: escuro': 'Theme: dark',
  'Escolha o arquivo para guardar': 'Choose a file to store', 'Copiado': 'Copied', 'Copiar': 'Copy'
};

export function t(s, vars) {
  let out = LANG === 'pt' ? s : (EN[s] ?? s);
  if (vars) out = out.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
  return out.replace(/(\d) (h|s|min|B|KB|MB|GB|TB)\b/g, '$1\u00a0$2');
}

const nf = new Intl.NumberFormat(LANG === 'pt' ? 'pt-BR' : 'en-US', { maximumFractionDigits: 1 });
export function bytes(n) {
  if (!Number.isFinite(n)) return '–';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${nf.format(i === 0 ? n : n)} ${u[i]}`;
}
export function count(n) {
  return new Intl.NumberFormat(LANG === 'pt' ? 'pt-BR' : 'en-US', { notation: n >= 100000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n);
}
export function duration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return r ? `${m} min ${r} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}
export function time(ts) {
  return new Date(ts).toLocaleTimeString(LANG === 'pt' ? 'pt-BR' : 'en-US', { hour: '2-digit', minute: '2-digit' });
}
export function dayLabel(ts) {
  const d = new Date(ts), today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  const same = (a, b) => a.toDateString() === b.toDateString();
  const fmt = d.toLocaleDateString(LANG === 'pt' ? 'pt-BR' : 'en-US', { day: 'numeric', month: 'long' });
  if (same(d, today)) return `${t('Hoje')}, ${fmt}`;
  if (same(d, y)) return `${t('Ontem')}, ${fmt}`;
  return d.toLocaleDateString(LANG === 'pt' ? 'pt-BR' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' });
}
/** "20 dias e 08:30:23" */
export function countdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const hms = [Math.floor(s % 86400 / 3600), Math.floor(s % 3600 / 60), s % 60].map(x => String(x).padStart(2, '0')).join(':');
  if (d === 0) return hms;
  if (d === 1) return t('1 dia e {hms}', { hms });
  return t('{d} dias e {hms}', { d, hms });
}
