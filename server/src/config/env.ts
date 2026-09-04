import path from 'node:path';

// ---------------------------------------------------------------------------
// Configuracao (variaveis de ambiente) — fonte unica pra todas as features.
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT || 3000);
const HOST_BIND = process.env.HOST_BIND || '0.0.0.0';
const MAX_PARTICIPANTS = Number(process.env.MAX_PARTICIPANTS || 50);
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
// Video (camera/tela) vai por WebRTC via LiveKit, e anexo/avatar vao por
// HTTP puro (server/src/modules/attachments.ts) — nada de binario grande passa
// pelo Socket.IO. Isso e so o teto do TRANSPORTE do Socket.IO em si (o
// Socket.IO DERRUBA A CONEXAO se uma mensagem passar desse teto, nao e so
// validacao de aplicacao) — 64KB sobra bem pra qualquer mensagem de
// sinalizacao real (chat tem MAX_CHAT_LEN de 2000 chars, reorder manda uma
// lista de ids).
const MAX_MSG_BYTES = Number(process.env.MAX_MSG_BYTES || 64 * 1024);
// Tempo que a identidade de alguem fica reservada apos a conexao cair, pra
// uma reconexao (queda de rede, reload) nao aparecer como "saiu"/"entrou".
const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS || 30000);
const MAX_AVATAR_LEN = 500;
const MAX_CHAT_LEN = 2000;
// quantas mensagens ficam guardadas pra dar contexto a quem entra depois
const CHAT_HISTORY_LIMIT = 50;

// Anexos no chat (imagem ou qualquer outro arquivo) — em disco, fora do
// banco (so a linha em attachments/messages fica no Postgres), ver
// server/src/modules/attachments.ts. O default e ancorado na raiz do repo
// (nao no cwd, que muda conforme de onde o processo foi iniciado): dentro do
// Dockerfile isso da exatamente /app/uploads — o mesmo caminho de antes, que
// o bind mount de fora (Dokploy) ja espera — e em `npm run dev`, fora de
// container, da <repo>/uploads, que a pasta existe de verdade.
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(import.meta.dirname, '..', '..', '..', 'uploads');
const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_STORAGE_BYTES = 30 * 1024 * 1024 * 1024;
// Upload de anexo de chat vai sempre em pedacos (server/src/modules/attachments.ts) —
// nem Cloudflare/nginx na frente barram um POST de 2GB inteiro, nem o
// processo Node precisa segurar o arquivo inteiro em memoria de uma vez.
// 8MB fica bem abaixo de qualquer teto de proxy comum (Cloudflare Free/Pro
// barra corpo de requisicao acima de 100MB).
const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
// Sessao de upload (pasta em UPLOAD_DIR/tmp/<uploadId>) abandonada — aba
// fechada, crash do navegador, sem nunca chamar complete/cancelar — expira
// depois disso; varredura roda no boot e a cada hora (ver server/src/index.ts).
const UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
// Foto de perfil — mesma pasta/rota dos anexos (ver server/src/modules/attachments.ts),
// teto bem menor: nao precisa dos 12MB de um anexo de chat, e cada conta so
// tem UMA (a antiga e apagada ao trocar), nao entra na cota de 10GB.
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

// ---- Contas de usuario -----------------------------------------------------
// PostgreSQL: obrigatorio agora que a identidade vem do banco (sem ele nao ha
// login, entao o processo nao sobe — ver bootstrap em index.ts).
const DATABASE_URL = process.env.DATABASE_URL || '';
// A URL do banco e remota; sem sslmode as credenciais e os dados de sessao
// atravessam a internet em texto puro. '1' liga TLS no driver pra quando o
// servidor aceita mas nao apresenta um certificado que o Node valide sozinho.
const DATABASE_SSL = process.env.DATABASE_SSL === '1';
// Roda as migrations pendentes antes de aceitar conexao. Ligado por padrao
// porque NENHUM dos dois caminhos de deploy (Docker CMD, systemd ExecStart)
// passa por npm script — sem isso, ninguem migra em producao.
const MIGRATE_ON_BOOT = process.env.MIGRATE_ON_BOOT !== '0';

const SESSION_COOKIE = process.env.SESSION_COOKIE || 'ss_session';
const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS || 30);
// Registro e FECHADO por padrao: sem codigo configurado ninguem cria conta
// (fail closed — um deploy que esqueceu de setar isso nao vira cadastro
// aberto pra internet inteira).
const REGISTRATION_CODE = process.env.REGISTRATION_CODE || '';
// Quem registrar com esse username vira admin. Unico (indice case-insensitive
// no banco), entao so uma pessoa consegue.
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'lune';
// 'auto' decide pelo X-Forwarded-Proto (Caddy/nginx ja mandam); '1'/'0'
// forcam. Sem isso o cookie Secure some no http://localhost do dev.
const COOKIE_SECURE = process.env.COOKIE_SECURE || 'auto';
// Corpo de requisicao HTTP (JSON de login/registro) — nada a ver com
// MAX_MSG_BYTES, que e o teto do transporte do Socket.IO (protocolos
// diferentes, cada um com seu proprio limite).
const MAX_BODY_BYTES = 8 * 1024;
const MIN_USERNAME_LEN = 3;
const MAX_USERNAME_LEN = 20;
const MIN_PASSWORD_LEN = 8;
const MAX_PASSWORD_LEN = 200; // teto de higiene: hash de 1MB de senha e DoS

// LiveKit Cloud — camera/tela viram WebRTC de verdade por aqui (SFU
// gerenciado). Crie um projeto free em https://cloud.livekit.io.
const LIVEKIT_URL = process.env.LIVEKIT_URL || '';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';
// Sala unica (mesmo modelo do resto do app) — todo mundo entra na mesma
// Room do LiveKit.
const LIVEKIT_ROOM_NAME = process.env.LIVEKIT_ROOM_NAME || 'linkord-room';

// Webhook do Discord (opcional) — avisa um canal do Discord sempre que
// alguem entra na chamada ou comeca a compartilhar a tela, ver
// server/src/modules/discordWebhook.ts. Vazio = feature desligada (nao falha
// nada, so nao manda nenhuma notificacao).
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';

export const config = {
  PORT, HOST_BIND, MAX_PARTICIPANTS, TRUST_PROXY, MAX_MSG_BYTES, RECONNECT_GRACE_MS,
  MAX_AVATAR_LEN, MAX_CHAT_LEN, CHAT_HISTORY_LIMIT,
  UPLOAD_DIR, MAX_ATTACHMENT_BYTES, MAX_STORAGE_BYTES, MAX_AVATAR_BYTES,
  UPLOAD_CHUNK_BYTES, UPLOAD_SESSION_TTL_MS,
  DATABASE_URL, DATABASE_SSL, MIGRATE_ON_BOOT,
  SESSION_COOKIE, SESSION_TTL_DAYS, REGISTRATION_CODE, ADMIN_USERNAME,
  COOKIE_SECURE, MAX_BODY_BYTES,
  MIN_USERNAME_LEN, MAX_USERNAME_LEN, MIN_PASSWORD_LEN, MAX_PASSWORD_LEN,
  LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_ROOM_NAME,
  DISCORD_WEBHOOK_URL,
};
