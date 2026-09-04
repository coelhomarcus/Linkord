import { eq, and, lt, desc, sql } from 'drizzle-orm';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from '../config/env.js';
import { db } from '../db/client.js';
import { messages, channels, attachments as attachmentsTable } from '../db/schema.js';
import { sendJson, sendError, type RouteTable } from '../http/router.js';
import { parseCookies } from '../http/cookies.js';
import { resolveSession } from './auth/session.js';
import { firstEmbed, type DetectedEmbed } from './link-preview/embeds.js';

// ---------------------------------------------------------------------------
// GET /api/media — aba "Midias" dos Ajustes: agrega TODO anexo enviado e
// TODO link embutivel do projeto inteiro (todos os canais, nao so o aberto
// no momento), mais recente primeiro. Duas listas separadas (?kind=uploads
// ou ?kind=embeds), cada uma paginada por cursor (?before=<msgId>, exclusive)
// em vez de offset — o historico cresce com o tempo, e cursor nao pula nem
// repete item se uma mensagem nova chegar entre dois cliques de
// "carregar mais" (offset pularia/repetiria).
//
// uploads e uma query so, exata (innerJoin em attachments ja filtra pra so
// mensagem-com-anexo). embeds precisa escanear o TEXTO da mensagem em JS
// (mesma logica de web/src/shared/lib/chatEmbeds.ts, espelhada em
// modules/link-preview/embeds.ts) — nem todo link vira embed (a maioria dos
// links do dia a dia nao casa com YouTube/Twitch/midia direta), entao o
// filtro SQL (~* 'https?://') so pega candidatos; fetchEmbedsPage escaneia
// em lotes ate juntar `limit` embeds de verdade ou esgotar a tabela.
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;
const EMBED_BATCH_SIZE = 40;
// teto de linhas escaneadas numa unica chamada, mesmo sem juntar `limit`
// embeds — evita um loop caro se o canal tiver centenas de links que nao
// viram embed nenhum. Quem clicar "carregar mais" de novo so continua do
// cursor onde parou (ver nextBefore), sem perder nem repetir nada.
const EMBED_SCAN_CEILING = 400;
// messages.id e `serial` (integer de 4 bytes) — Number.MAX_SAFE_INTEGER
// como sentinela de "sem cursor ainda" estoura o range do Postgres (erro
// "integer out of range" na hora da query). O teto real da coluna e esse.
const PG_INT4_MAX = 2147483647;

interface MediaBaseRow {
  msgId: number;
  channelId: string;
  channelName: string;
  authorName: string;
  authorAvatar: string;
  createdAt: Date;
}

interface MediaBase {
  msgId: number;
  channelId: string;
  channelName: string;
  authorName: string;
  authorAvatar: string;
  ts: number;
}

interface UploadItem extends MediaBase {
  attachment: { id: string; name: string; mime: string; size: number };
}

interface EmbedItem extends MediaBase {
  embed: DetectedEmbed;
}

function toMediaBase(row: MediaBaseRow): MediaBase {
  return {
    msgId: row.msgId,
    channelId: row.channelId,
    channelName: row.channelName,
    authorName: row.authorName,
    authorAvatar: row.authorAvatar,
    ts: row.createdAt.getTime(),
  };
}

async function fetchUploadsPage(before: number | null, limit: number): Promise<{ items: UploadItem[]; nextBefore: number | null }> {
  const rows = await db
    .select({
      msgId: messages.id,
      channelId: messages.channelId,
      channelName: channels.name,
      authorName: messages.authorName,
      authorAvatar: messages.authorAvatar,
      createdAt: messages.createdAt,
      attachmentId: attachmentsTable.id,
      fileName: attachmentsTable.fileName,
      mimeType: attachmentsTable.mimeType,
      size: attachmentsTable.size,
    })
    .from(messages)
    // innerJoin (nao left) em attachments.message_id=messages.id ja filtra
    // sozinho pra so mensagem-com-anexo — foto de perfil (attachments com
    // message_id NULL) nunca bate nesse join, fica de fora sem precisar de
    // filtro extra.
    .innerJoin(attachmentsTable, eq(attachmentsTable.messageId, messages.id))
    .innerJoin(channels, eq(channels.id, messages.channelId))
    .where(lt(messages.id, before ?? PG_INT4_MAX))
    .orderBy(desc(messages.id))
    .limit(limit);

  const items: UploadItem[] = rows.map((row) => ({
    ...toMediaBase(row),
    attachment: { id: row.attachmentId, name: row.fileName, mime: row.mimeType, size: row.size },
  }));
  return { items, nextBefore: rows.length === limit ? rows[rows.length - 1]!.msgId : null };
}

async function fetchEmbedsPage(before: number | null, limit: number): Promise<{ items: EmbedItem[]; nextBefore: number | null }> {
  const items: EmbedItem[] = [];
  let cursor = before ?? null;
  let exhausted = false;
  let scanned = 0;

  while (items.length < limit && scanned < EMBED_SCAN_CEILING) {
    const batch = await db
      .select({
        msgId: messages.id,
        channelId: messages.channelId,
        channelName: channels.name,
        authorName: messages.authorName,
        authorAvatar: messages.authorAvatar,
        createdAt: messages.createdAt,
        text: messages.text,
      })
      .from(messages)
      .innerJoin(channels, eq(channels.id, messages.channelId))
      .where(and(lt(messages.id, cursor ?? PG_INT4_MAX), sql`${messages.text} ~* ${'https?://'}`))
      .orderBy(desc(messages.id))
      .limit(EMBED_BATCH_SIZE);

    if (batch.length === 0) { exhausted = true; break; }
    scanned += batch.length;

    // se o `limit` for atingido NO MEIO do lote, paramos de consumi-lo sem
    // saber se havia mais candidatos depois do ponto onde paramos — nesse
    // caso NAO da pra concluir "fim da tabela" so por esse lote ter vindo
    // mais curto que EMBED_BATCH_SIZE (ele so ficou curto porque nos
    // desistimos de le-lo inteiro, nao porque acabaram as linhas).
    let stoppedEarly = false;
    for (const row of batch) {
      // cursor SEMPRE avanca, mesmo quando o candidato nao vira embed —
      // e o que garante que a proxima chamada (outro clique de "carregar
      // mais") retoma exatamente daqui, sem re-escanear nem pular nada.
      cursor = row.msgId;
      const embed = firstEmbed(row.text);
      if (embed) {
        items.push({ ...toMediaBase(row), embed });
        if (items.length >= limit) { stoppedEarly = true; break; }
      }
    }
    // so aqui, com o lote INTEIRO consumido, um lote curto de fato significa
    // que a tabela acabou.
    if (!stoppedEarly && batch.length < EMBED_BATCH_SIZE) { exhausted = true; break; }
  }

  return { items, nextBefore: exhausted ? null : cursor };
}

async function handleMedia(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const cookies = parseCookies(req.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(res, 401, 'unauthenticated', 'Nao autenticado.');

  const url = new URL(req.url || '', 'http://x');
  const kind = url.searchParams.get('kind') === 'embeds' ? 'embeds' : 'uploads';
  const beforeRaw = url.searchParams.get('before');
  const before = beforeRaw && /^\d+$/.test(beforeRaw) ? Number(beforeRaw) : null;
  const limitRaw = Number(url.searchParams.get('limit'));
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : DEFAULT_LIMIT, 1), MAX_LIMIT);

  const page = kind === 'embeds' ? await fetchEmbedsPage(before, limit) : await fetchUploadsPage(before, limit);
  sendJson(res, 200, page);
}

export const routes: RouteTable = { 'GET /api/media': handleMedia };
