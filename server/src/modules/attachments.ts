import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsStreams from 'node:fs'; // so pra createReadStream/createWriteStream (montagem dos chunks), ver assembleChunks
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq, and, inArray, isNull, isNotNull, sql } from 'drizzle-orm';
import { config } from '../config/env.js';
import { db } from '../db/client.js';
import { attachments as attachmentsTable, messages, type Attachment } from '../db/schema.js';
import { broadcast } from '../realtime/participants.js';
import { sendJson, sendError, jsonBody } from '../http/respond.js';
import { parseCookies } from '../http/cookies.js';
import { resolveSession } from './auth/session.js';
import { channelExists } from './channels.js';

// ---------------------------------------------------------------------------
// Anexos no chat (imagem ou qualquer outro arquivo) — no maximo UM por
// mensagem. O arquivo em si vive em disco (config.UPLOAD_DIR, bind mount
// configurado por fora, ver .env.example), nomeado so pelo uuid gerado aqui
// (sem extensao — o tipo real fica na coluna mime_type, nunca confiamos no
// nome pra decidir como servir de volta). So a linha (metadado) mora no
// Postgres. Cota global calculada AO VIVO (soma/conta a tabela inteira) em
// vez de um contador separado — sem isso, nao ha risco de "dessincronizar"
// do que existe de verdade em disco.
//
// So uma lista curta de mime de imagem e servida inline; qualquer outro tipo
// vira download forcado (application/octet-stream + Content-Disposition:
// attachment) — evita que um .svg/.html com script embutido rode no nosso
// dominio se alguem abrir o link direto (ver serveUpload).
// ---------------------------------------------------------------------------

// imagem, video e audio: nenhum desses executa script embutido no navegador
// (diferente de svg/html), servir inline e seguro. Qualquer OUTRO tipo
// (pdf, zip, doc...) continua forcando download (ver serveUpload abaixo).
const INLINE_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/ogg',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4',
]);
const ID_RE = /^[0-9a-f]{32}$/; // crypto.randomUUID() sem hifens (ver newId)
const AVATAR_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
// so reconhece o formato que NOS geramos (ver newId) — uma URL externa
// (https://...) ou qualquer outra coisa simplesmente nao casa, e tratada
// como "nao e upload nosso" em vez de erro.
const AVATAR_URL_RE = /^\/uploads\/([0-9a-f]{32})$/;

function newId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

function filePathFor(id: string): string {
  return path.join(config.UPLOAD_DIR, id);
}

export async function ensureUploadDir(): Promise<void> {
  await fs.mkdir(config.UPLOAD_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// Upload de anexo de chat em pedacos (chunks) — necessario pro teto de 2GB
// (config.MAX_ATTACHMENT_BYTES): um POST unico desse tamanho nem passa de
// proxy nenhum na frente (Cloudflare/nginx barram corpo grande) nem seria
// seguro pro processo Node segurar inteiro em memoria de uma vez. Estado da
// sessao de upload vive so em disco (sem tabela no Postgres) — deploy e
// single-instance (ver docker-compose.yml/deploy/install.sh), entao nao ha
// motivo pra compartilhar isso entre processos. `uploadId` (mesmo formato de
// newId()) vira DIRETO o id final do anexo, sem passo de rename.
// ---------------------------------------------------------------------------

interface UploadManifest {
  uploadId: string;
  userId: string;
  channelId: string;
  fileName: string;
  mimeType: string;
  totalSize: number;
  caption: string;
  chunkSize: number;
  totalChunks: number;
  createdAt: string;
}

function tmpDirFor(uploadId: string): string {
  return path.join(config.UPLOAD_DIR, 'tmp', uploadId);
}

function manifestPathFor(uploadId: string): string {
  return path.join(tmpDirFor(uploadId), 'manifest.json');
}

function chunkPathFor(uploadId: string, index: number): string {
  // zero-padded a 6 digitos: sobra de longe pro totalChunks de qualquer
  // arquivo real (8MB/chunk, ate arquivo gigante ainda fica na casa dos
  // milhares), e mantem a ordenacao alfabetica == ordenacao numerica.
  return path.join(tmpDirFor(uploadId), String(index).padStart(6, '0'));
}

/** Le o manifest de uma sessao de upload — null se nao existe ou esta
 * corrompido (sessao desconhecida pro chamador, trata como 404). */
async function readManifest(uploadId: string): Promise<UploadManifest | null> {
  try {
    return JSON.parse(await fs.readFile(manifestPathFor(uploadId), 'utf8'));
  } catch {
    return null;
  }
}

/** Tamanho esperado de UM chunk especifico — todos tem chunkSize, exceto o
 * ultimo, que e o resto (totalSize nem sempre e multiplo exato de chunkSize). */
export function expectedChunkLength(manifest: UploadManifest, index: number): number {
  return index === manifest.totalChunks - 1
    ? manifest.totalSize - manifest.chunkSize * (manifest.totalChunks - 1)
    : manifest.chunkSize;
}

/** Concatena os chunks (em ordem) no arquivo final via STREAM — nunca
 * Buffer.concat do arquivo inteiro, que e exatamente o que se quer evitar
 * num anexo de ate 2GB (memoria do processo). */
async function assembleChunks(uploadId: string, manifest: UploadManifest, destPath: string): Promise<void> {
  const writeStream = fsStreams.createWriteStream(destPath);
  try {
    for (let i = 0; i < manifest.totalChunks; i++) {
      await new Promise<void>((resolve, reject) => {
        const readStream = fsStreams.createReadStream(chunkPathFor(uploadId, i));
        readStream.on('error', reject);
        writeStream.on('error', reject);
        readStream.pipe(writeStream, { end: false });
        readStream.on('end', resolve);
      });
    }
    await new Promise<void>((resolve, reject) => {
      writeStream.end((err: NodeJS.ErrnoException | null | undefined) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    writeStream.destroy();
    throw err;
  }
}

/** Varredura de sessoes de upload abandonadas (aba fechada, crash do
 * navegador — nunca chamou complete nem cancelar) — chamada no boot e a cada
 * hora (ver src/index.ts), mesmo padrao do sweepExpiredSessions de login. */
export async function sweepStaleUploads(): Promise<void> {
  const tmpRoot = path.join(config.UPLOAD_DIR, 'tmp');
  let ids: string[];
  try {
    ids = await fs.readdir(tmpRoot);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  for (const id of ids) {
    const dir = path.join(tmpRoot, id);
    let createdAtMs: number;
    try {
      const manifest: UploadManifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
      createdAtMs = new Date(manifest.createdAt).getTime();
    } catch {
      // manifest ausente/corrompido (ex.: crash bem no meio do init) — usa a
      // data de criacao da PASTA como fallback, pra ainda conseguir varrer.
      try {
        createdAtMs = (await fs.stat(dir)).birthtimeMs;
      } catch {
        continue;
      }
    }
    if (Date.now() - createdAtMs > config.UPLOAD_SESSION_TTL_MS) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export interface UsageInfo {
  totalBytes: number;
  totalFiles: number;
  maxBytes: number;
}

/** Uso atual da cota — sempre a verdade (soma/conta a tabela inteira, sem
 * contador que possa dessincronizar). Uma sala pequena nunca vai ter linhas
 * o bastante pra isso pesar. So conta anexo de CHAT (messageId preenchido) —
 * foto de perfil (messageId nulo, ver schema.ts) fica de fora da cota de
 * 30GB de proposito. */
export async function getUsage(): Promise<UsageInfo> {
  const [row] = await db
    .select({ totalBytes: sql<number>`coalesce(sum(${attachmentsTable.size}), 0)`, totalFiles: sql<number>`count(*)` })
    .from(attachmentsTable)
    .where(isNotNull(attachmentsTable.messageId));
  return { totalBytes: Number(row!.totalBytes), totalFiles: Number(row!.totalFiles), maxBytes: config.MAX_STORAGE_BYTES };
}

async function broadcastUsage(): Promise<void> {
  broadcast({ t: 'storage-usage', ...(await getUsage()) });
}

/** Anexos de varias mensagens de uma vez (historico do canal) — uma query so,
 * evita N+1. Devolve um Map messageId -> linha crua de attachments. */
export async function getByMessageIds(messageIds: number[]): Promise<Map<number, Attachment>> {
  const map = new Map<number, Attachment>();
  if (!messageIds.length) return map;
  const rows = await db.select().from(attachmentsTable).where(inArray(attachmentsTable.messageId, messageIds));
  for (const row of rows) if (row.messageId !== null) map.set(row.messageId, row);
  return map;
}

/** Apaga o ARQUIVO de disco do anexo de uma mensagem (se houver) — chamado
 * ANTES do DELETE da mensagem em modules/chat.ts. A linha de attachments
 * some sozinha via CASCADE quando a mensagem e apagada logo em seguida;
 * aqui so cuida do que o Postgres nao sabe (o arquivo). */
export async function deleteForMessage(messageId: number): Promise<void> {
  const [row] = await db.select().from(attachmentsTable).where(eq(attachmentsTable.messageId, messageId)).limit(1);
  if (!row) return;
  await fs.unlink(filePathFor(row.id)).catch((err: NodeJS.ErrnoException) => { if (err.code !== 'ENOENT') throw err; });
}

/** Mesma ideia, em lote — apagar um CANAL faz CASCADE em messages (e dali em
 * attachments) direto no Postgres, sem passar por deleteForMessage/
 * handleChatDelete. Sem isso, apagar um canal com imagens deixaria os
 * arquivos orfaos no disco pra sempre. Chamado por modules/channels.ts ANTES
 * do delete do canal. */
export async function deleteForChannel(channelId: string): Promise<void> {
  const rows = await db
    .select({ id: attachmentsTable.id })
    .from(attachmentsTable)
    .innerJoin(messages, eq(attachmentsTable.messageId, messages.id))
    .where(eq(messages.channelId, channelId));
  await Promise.all(rows.map((row) => fs.unlink(filePathFor(row.id)).catch((err: NodeJS.ErrnoException) => { if (err.code !== 'ENOENT') throw err; })));
}

/** Apaga a foto de perfil ANTIGA de disco (e sua linha) quando a conta troca
 * pra uma nova — chamado por realtime/participants.ts#handleProfile. Sem
 * isso, cada troca de foto deixaria a anterior orfa no disco pra sempre (uma
 * conta so tem UMA foto de cada vez, nunca precisa manter historico).
 * `avatarValue` pode ser uma URL externa ou vazio — nesse caso nao e nosso
 * upload, `AVATAR_URL_RE` so casa o formato `/uploads/<id>` que NOS geramos,
 * e a funcao simplesmente nao faz nada. `isNull(messageId)` na query e uma
 * segunda trava (alem do regex): mesmo que alguem manipule o valor mandado
 * pro servidor, so deixa apagar uma linha que e mesmo de foto de perfil,
 * nunca um anexo de chat de verdade. */
export async function deleteAvatarFile(avatarValue: unknown): Promise<void> {
  const match = AVATAR_URL_RE.exec(String(avatarValue == null ? '' : avatarValue));
  if (!match) return;
  const id = match[1]!;
  const deleted = await db.delete(attachmentsTable).where(and(eq(attachmentsTable.id, id), isNull(attachmentsTable.messageId))).returning({ id: attachmentsTable.id });
  if (!deleted.length) return; // nao era uma linha de foto de perfil — nao mexe no arquivo
  await fs.unlink(filePathFor(id)).catch((err: NodeJS.ErrnoException) => { if (err.code !== 'ENOENT') throw err; });
}

export function sanitizeFileName(raw: unknown): string {
  const s = String(raw == null ? '' : raw).trim().replace(/[\r\n/\\]/g, '_').slice(0, 200);
  return s || 'arquivo';
}

/** Content-Disposition seguro pra nome com acentuacao/espacos/aspas — ASCII
 * simplificado como fallback (`filename=`) + UTF-8 de verdade via
 * `filename*=` (RFC 5987), que navegadores modernos preferem. */
export function contentDispositionFor(kind: 'inline' | 'attachment', fileName: string): string {
  const asciiFallback = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
  return `${kind}; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

// Guarda em memoria pra serializar chamadas concorrentes de complete() do
// MESMO uploadId — sem isso, duas requisicoes (retry duplicado do cliente,
// aba duplicada) poderiam tentar montar/gravar o mesmo arquivo final ao
// mesmo tempo. So precisa durar a vida do processo (reset num restart e
// correto: nenhum complete estava de fato em andamento na hora do restart).
const completingUploads = new Set<string>();

/** Passo 1/3 do upload em pedacos — declara o arquivo (nome, tamanho, canal)
 * antes de mandar qualquer byte, pra falhar cedo (canal inexistente, cota
 * cheia, tamanho acima do teto) sem o cliente ja ter subido nada. Devolve o
 * uploadId (que tambem sera o id final do anexo) e o chunkSize que o
 * servidor decidiu (config.UPLOAD_CHUNK_BYTES) — o cliente nunca hardcoda
 * esse valor. */
async function handleAttachmentInit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Nao autenticado.');

  const body = jsonBody(request.body);
  const channelId = String(body.channelId || '');
  if (!channelId || !(await channelExists(channelId))) return sendError(reply, 404, 'channel_not_found', 'Canal nao encontrado.');

  const fileName = sanitizeFileName(body.fileName);
  const mimeType = String(body.mimeType || 'application/octet-stream').split(';')[0]!.trim() || 'application/octet-stream';
  const caption = String(body.caption || '').trim().slice(0, config.MAX_CHAT_LEN);

  const totalSize = Number(body.totalSize);
  if (!Number.isInteger(totalSize) || totalSize <= 0 || totalSize > config.MAX_ATTACHMENT_BYTES) {
    return sendError(reply, 400, 'invalid_size', 'Tamanho de arquivo invalido.');
  }

  const usage = await getUsage();
  if (usage.totalBytes + totalSize > config.MAX_STORAGE_BYTES) {
    return sendError(reply, 400, 'storage_full', 'Armazenamento cheio (30GB no total). Apague arquivos antigos antes de enviar mais.');
  }

  const uploadId = newId();
  const chunkSize = config.UPLOAD_CHUNK_BYTES;
  const totalChunks = Math.ceil(totalSize / chunkSize);
  await fs.mkdir(tmpDirFor(uploadId), { recursive: true });
  await fs.writeFile(manifestPathFor(uploadId), JSON.stringify({
    uploadId, userId: sess.userId, channelId, fileName, mimeType, totalSize, caption,
    chunkSize, totalChunks, createdAt: new Date().toISOString(),
  } satisfies UploadManifest));

  sendJson(reply, 201, { uploadId, chunkSize, totalChunks });
}

/** Passo 2/3 — recebe UM pedaco do arquivo (no maximo config.UPLOAD_CHUNK_BYTES,
 * so o ultimo pode ser menor). Gravacao e idempotente (overwrite) — o cliente
 * pode reenviar o mesmo indice sem problema (retry de conexao instavel). */
export async function handleAttachmentChunk(request: FastifyRequest<{ Params: { id: string; index: string } }>, reply: FastifyReply): Promise<void> {
  const uploadId = request.params.id;
  const index = Number(request.params.index);
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Nao autenticado.');

  const manifest = await readManifest(uploadId);
  if (!manifest || manifest.userId !== sess.userId) return sendError(reply, 404, 'upload_not_found', 'Upload nao encontrado.');
  if (!Number.isInteger(index) || index < 0 || index >= manifest.totalChunks) {
    return sendError(reply, 400, 'invalid_index', 'Indice de pedaco invalido.');
  }

  // corpo cru (Buffer) — o parser de conteudo pra essas rotas e trocado em
  // registerAttachmentRoutes abaixo; o teto de tamanho vem do bodyLimit da
  // rota (config.UPLOAD_CHUNK_BYTES), esse length exato ainda precisa ser
  // conferido aqui (o ULTIMO pedaco e sempre menor que o teto).
  const expected = expectedChunkLength(manifest, index);
  const buffer = request.body as Buffer;
  if (buffer.length !== expected) return sendError(reply, 400, 'chunk_size_mismatch', 'Tamanho do pedaco nao bate com o esperado.');

  await fs.writeFile(chunkPathFor(uploadId, index), buffer);
  sendJson(reply, 200, { received: index });
}

/** Passo 3/3 — confirma que todos os pedacos chegaram, monta o arquivo final
 * via stream (nunca inteiro em memoria) e so entao cria a mensagem/anexo no
 * banco. Os chunks so somem do disco DEPOIS do commit da transacao (exigencia
 * de sempre limpar o que nao e mais preciso assim que o arquivo monta). */
export async function handleAttachmentComplete(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<void> {
  const uploadId = request.params.id;
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Nao autenticado.');

  const manifest = await readManifest(uploadId);
  if (!manifest || manifest.userId !== sess.userId) return sendError(reply, 404, 'upload_not_found', 'Upload nao encontrado.');

  if (completingUploads.has(uploadId)) return sendError(reply, 409, 'already_completing', 'Upload ja esta sendo finalizado.');
  completingUploads.add(uploadId);

  try {
    for (let i = 0; i < manifest.totalChunks; i++) {
      try {
        await fs.access(chunkPathFor(uploadId, i));
      } catch {
        return sendError(reply, 400, 'incomplete_upload', 'Faltam pedacos do arquivo.');
      }
    }
    let receivedTotal = 0;
    for (let i = 0; i < manifest.totalChunks; i++) {
      receivedTotal += (await fs.stat(chunkPathFor(uploadId, i))).size;
    }
    if (receivedTotal !== manifest.totalSize) return sendError(reply, 400, 'size_mismatch', 'Tamanho recebido nao bate com o declarado.');

    const usage = await getUsage();
    if (usage.totalBytes + manifest.totalSize > config.MAX_STORAGE_BYTES) {
      return sendError(reply, 400, 'storage_full', 'Armazenamento cheio (30GB no total). Apague arquivos antigos antes de enviar mais.');
    }

    const destPath = filePathFor(uploadId);
    let row: Attachment;
    let message: typeof messages.$inferSelect;
    try {
      await assembleChunks(uploadId, manifest, destPath);
      const inserted = await db.transaction(async (tx) => {
        const [messageRow] = await tx.insert(messages).values({
          channelId: manifest.channelId, authorId: sess.userId, authorName: sess.username, authorAvatar: sess.avatar, text: manifest.caption,
        }).returning();
        const [attachmentRow] = await tx.insert(attachmentsTable).values({
          id: uploadId, messageId: messageRow!.id, fileName: manifest.fileName, mimeType: manifest.mimeType, size: manifest.totalSize,
        }).returning();
        return { messageRow: messageRow!, attachmentRow: attachmentRow! };
      });
      row = inserted.attachmentRow;
      message = inserted.messageRow;
    } catch (err) {
      // mantem os CHUNKS de proposito (nao apaga tmpDirFor aqui) — o cliente
      // pode chamar complete() de novo sem precisar re-subir o arquivo
      // inteiro. So o arquivo final (parcial/invalido) e descartado.
      await fs.unlink(destPath).catch(() => {});
      throw err;
    }

    // so apaga os chunks DEPOIS do commit ter dado certo (exigencia: sempre
    // que o arquivo monta, os chunks somem). Falha ao apagar so loga —
    // sweepStaleUploads() limpa o que sobrar mais tarde.
    await fs.rm(tmpDirFor(uploadId), { recursive: true, force: true })
      .catch((err) => console.error('[attachments] falha ao apagar chunks apos montagem:', err instanceof Error ? err.stack : err));

    const chatMessage = {
      msgId: message.id,
      channelId: message.channelId,
      id: message.authorId,
      name: message.authorName,
      avatar: message.authorAvatar,
      text: message.text,
      ts: message.createdAt.getTime(),
      attachment: { id: row.id, name: row.fileName, mime: row.mimeType, size: row.size },
    };
    broadcast({ t: 'chat', message: chatMessage });
    await broadcastUsage();
    sendJson(reply, 201, { message: chatMessage });
  } finally {
    completingUploads.delete(uploadId);
  }
}

/** Cancela uma sessao de upload em andamento (chamado pelo cliente quando um
 * envio falha de forma irrecuperavel) — apaga os chunks na hora, sem esperar
 * a varredura. Idempotente: chamar de novo numa sessao ja apagada e sucesso. */
export async function handleAttachmentCancel(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<void> {
  const uploadId = request.params.id;
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Nao autenticado.');

  const manifest = await readManifest(uploadId);
  if (manifest && manifest.userId === sess.userId) {
    await fs.rm(tmpDirFor(uploadId), { recursive: true, force: true }).catch(() => {});
  }
  sendJson(reply, 200, { ok: true });
}

/** Upload de foto de perfil — mesma pasta/rota de servir (`/uploads/<id>`)
 * dos anexos de chat, so que a linha nasce com `messageId: null` (marca
 * "isso e foto de perfil", ver schema.ts e getUsage) e sem passar pela cota
 * de 30GB (uma unica foto por conta, teto proprio bem menor,
 * config.MAX_AVATAR_BYTES). O cliente manda so os bytes crus da imagem
 * (Content-Type = mime real) e recebe `{ avatar: '/uploads/<id>' }` de
 * volta — quem realmente APLICA isso como avatar da conta e o fluxo
 * existente (`profile` por WebSocket, ver realtime/participants.ts), que
 * tambem cuida de apagar a foto antiga (deleteAvatarFile acima). */
async function handleAvatarUpload(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Nao autenticado.');

  const mimeType = String(request.headers['content-type'] || '').split(';')[0]!.trim();
  if (!AVATAR_MIME_TYPES.has(mimeType)) {
    return sendError(reply, 400, 'invalid_type', 'Formato invalido. Use PNG, JPEG, GIF ou WEBP.');
  }

  const buffer = request.body as Buffer;
  if (buffer.length === 0) return sendError(reply, 400, 'empty_file', 'Arquivo vazio.');

  const id = newId();
  await fs.writeFile(filePathFor(id), buffer);
  try {
    await db.insert(attachmentsTable).values({ id, messageId: null, fileName: 'avatar', mimeType, size: buffer.length });
  } catch (err) {
    await fs.unlink(filePathFor(id)).catch(() => {});
    throw err;
  }
  sendJson(reply, 201, { avatar: `/uploads/${id}` });
}

export async function serveUpload(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) { reply.code(401).send('nao autenticado'); return; }

  const id = request.params.id;
  if (!ID_RE.test(id)) { reply.code(400).send('id invalido'); return; }

  const [row] = await db.select().from(attachmentsTable).where(eq(attachmentsTable.id, id)).limit(1);
  if (!row) { reply.code(404).send('nao encontrado'); return; }

  let data: Buffer;
  try {
    data = await fs.readFile(filePathFor(id));
  } catch {
    reply.code(404).send('nao encontrado');
    return;
  }

  const inline = INLINE_MIME_TYPES.has(row.mimeType);
  reply
    .code(200)
    .header('Content-Type', inline ? row.mimeType : 'application/octet-stream')
    .header('Content-Disposition', contentDispositionFor(inline ? 'inline' : 'attachment', row.fileName))
    .header('Content-Length', data.length)
    .header('X-Content-Type-Options', 'nosniff')
    // privado (nao 'public'): gated por sessao, um cache compartilhado nao
    // deveria guardar isso pra servir a outra pessoa sem checar de novo.
    .header('Cache-Control', 'private, max-age=31536000, immutable')
    .send(data);
}

export function registerAttachmentRoutes(fastify: FastifyInstance): void {
  fastify.post('/api/attachments/init', handleAttachmentInit);
  fastify.post('/api/attachments/:id/complete', handleAttachmentComplete);
  fastify.delete('/api/attachments/:id', handleAttachmentCancel);
  fastify.get('/uploads/:id', serveUpload);

  // corpo cru (Buffer), nao JSON — plugin proprio (encapsulado) so pra essas
  // duas rotas: trocar addContentTypeParser na instancia raiz quebraria o
  // parse de JSON de toda rota /api/* do resto do app.
  fastify.register(async (scoped) => {
    scoped.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));
    scoped.post('/api/attachments/:id/chunk/:index', { bodyLimit: config.UPLOAD_CHUNK_BYTES }, handleAttachmentChunk);
    scoped.post('/api/avatar', { bodyLimit: config.MAX_AVATAR_BYTES }, handleAvatarUpload);
  });
}
