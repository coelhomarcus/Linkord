import crypto from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { categories, channels } from '../db/schema.js';
import { participants, broadcast, send } from '../realtime/participants.js';
import type { AppSocket, HandlerTable, Participant } from '../types.js';

// ---------------------------------------------------------------------------
// Categorias e canais — de TEXTO ou de VOZ, admin cria/apaga/reordena a
// vontade (so trava apagar o ULTIMO canal de voz, ver handleChannelDelete —
// a sala nunca pode ficar sem nenhum). ensureVoiceChannelExists (abaixo)
// so garante que exista pelo menos um na primeira vez que o servidor sobe.
// Quadro continua fixo, fora desse sistema (decisao ja tomada, nao
// mencionado quando a Chamada entrou pra arvore). Toda mutacao rebroadcast
// a ARVORE INTEIRA fresca (`channels-tree`) em vez de eventos incrementais —
// a estrutura e pequena (gerenciada so pelo admin), entao "buscar tudo de
// novo e reenviar" e mais simples e mais dificil de deixar o cliente
// dessincronizado do que reconciliar diffs.
// ---------------------------------------------------------------------------

interface ChannelSummary {
  id: string;
  name: string;
  type: string;
}

interface CategoryTree {
  id: string;
  name: string;
  channels: ChannelSummary[];
}

export function sanitizeChannelName(name: unknown): string | null {
  const s = String(name == null ? '' : name).trim().slice(0, 60);
  return s || null;
}

function isAdmin(p: Participant | undefined): boolean {
  return !!p && p.role === 'admin';
}

/** A sala nunca pode ficar sem NENHUM canal de voz — apagar o ultimo
 * deixaria isso so recuperavel com um restart do servidor
 * (ensureVoiceChannelExists so roda no boot). Canal de texto nunca trava. */
export function canDeleteChannel(type: string, voiceChannelCount: number): boolean {
  return type !== 'voice' || voiceChannelCount > 1;
}

/** Categoria "Geral" + canal de texto "geral" na primeira vez que o servidor
 * sobe com o banco vazio — cobre tanto instalacao nova quanto upgrade de
 * quem tinha o chat unico antigo (em memoria, ja removido). Chamado uma vez
 * no boot. */
export async function ensureSeeded(): Promise<void> {
  const [existing] = await db.select({ id: categories.id }).from(categories).limit(1);
  if (existing) return;
  const categoryId = crypto.randomUUID();
  const channelId = crypto.randomUUID();
  await db.insert(categories).values({ id: categoryId, name: 'Geral', position: 0 });
  await db.insert(channels).values({ id: channelId, categoryId, name: 'geral', type: 'text', position: 0 });
}

/** Garante que existe exatamente UM canal de voz (a Chamada) em algum lugar
 * da arvore — chamado toda vez que o servidor sobe (nao so quando o banco
 * esta vazio, ver ensureSeeded): cobre tanto instalacao nova (roda logo
 * apos o seed acima, cai na mesma categoria "Geral") quanto upgrade de uma
 * instalacao que ja tinha categorias/canais de texto mas ainda nao tinha a
 * Chamada como linha do banco (ela vivia so em memoria antes). Se nao houver
 * NENHUMA categoria (o admin apagou tudo), so avisa no log — nao ha onde
 * colocar a Chamada. */
export async function ensureVoiceChannelExists(): Promise<void> {
  const [existingVoice] = await db.select({ id: channels.id }).from(channels).where(eq(channels.type, 'voice')).limit(1);
  if (existingVoice) return;
  const [firstCategory] = await db.select().from(categories).orderBy(categories.position).limit(1);
  if (!firstCategory) {
    console.warn('[channels] nenhuma categoria existe — nao da pra criar o canal de voz (Chamada) ainda.');
    return;
  }
  const rows = await db.select({ position: channels.position }).from(channels).where(eq(channels.categoryId, firstCategory.id));
  const position = rows.length ? Math.max(...rows.map((r) => r.position)) + 1 : 0;
  await db.insert(channels).values({ id: crypto.randomUUID(), categoryId: firstCategory.id, name: 'Chamada', type: 'voice', position });
}

/** Arvore ordenada (categorias -> canais), pro `welcome` e pra rebroadcast
 * apos qualquer mutacao. */
export async function listTree(): Promise<CategoryTree[]> {
  const cats = await db.select().from(categories).orderBy(categories.position);
  const chans = await db.select().from(channels).orderBy(channels.position);
  const byCategory = new Map<string, ChannelSummary[]>();
  for (const c of chans) {
    const list = byCategory.get(c.categoryId) || [];
    list.push({ id: c.id, name: c.name, type: c.type });
    byCategory.set(c.categoryId, list);
  }
  return cats.map((c) => ({ id: c.id, name: c.name, channels: byCategory.get(c.id) || [] }));
}

export async function channelExists(channelId: string): Promise<boolean> {
  const [row] = await db.select({ id: channels.id }).from(channels).where(eq(channels.id, channelId)).limit(1);
  return !!row;
}

/** Usado por realtime/socket.ts#handleVoiceJoin pra validar que o canal
 * escolhido existe e e mesmo de voz antes de mintar um token do LiveKit pra
 * ele — null cobre tanto "nao existe" quanto qualquer erro de leitura. */
export async function getChannelType(channelId: string): Promise<string | null> {
  const [row] = await db.select({ type: channels.type }).from(channels).where(eq(channels.id, channelId)).limit(1);
  return row?.type ?? null;
}

async function broadcastTree(): Promise<void> {
  broadcast({ t: 'channels-tree', categories: await listTree() });
}

async function handleCategoryCreate(socket: AppSocket, msg: { name?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket || !isAdmin(p)) return;
  const name = sanitizeChannelName(msg.name);
  if (!name) return;
  const rows = await db.select({ position: categories.position }).from(categories);
  const position = rows.length ? Math.max(...rows.map((r) => r.position)) + 1 : 0;
  await db.insert(categories).values({ id: crypto.randomUUID(), name, position });
  await broadcastTree();
}

async function handleCategoryDelete(socket: AppSocket, msg: { categoryId?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket || !isAdmin(p)) return;
  const categoryId = String(msg.categoryId || '');
  if (!categoryId) return;
  try {
    await db.delete(categories).where(eq(categories.id, categoryId));
  } catch (err: unknown) {
    // 23001 = restrict_violation (SQLSTATE especifico de ON DELETE RESTRICT —
    // NAO e o 23503/foreign_key_violation generico) — a categoria ainda tem
    // canais dentro.
    const cause = (err as { cause?: { code?: string } } | undefined)?.cause;
    if (cause?.code === '23001') {
      send(socket, { t: 'error', code: 'category-not-empty', message: 'Apague os canais dessa categoria antes de apaga-la.' });
      return;
    }
    throw err;
  }
  await broadcastTree();
}

async function handleChannelCreate(socket: AppSocket, msg: { categoryId?: string; name?: string; type?: unknown }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket || !isAdmin(p)) return;
  const categoryId = String(msg.categoryId || '');
  const name = sanitizeChannelName(msg.name);
  const type = msg.type === 'voice' ? 'voice' : 'text';
  if (!categoryId || !name) return;
  const [category] = await db.select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId)).limit(1);
  if (!category) return;
  const rows = await db.select({ position: channels.position }).from(channels).where(eq(channels.categoryId, categoryId));
  const position = rows.length ? Math.max(...rows.map((r) => r.position)) + 1 : 0;
  await db.insert(channels).values({ id: crypto.randomUUID(), categoryId, name, type, position });
  await broadcastTree();
}

async function handleChannelDelete(socket: AppSocket, msg: { channelId?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket || !isAdmin(p)) return;
  const channelId = String(msg.channelId || '');
  if (!channelId) return;
  const [existing] = await db.select({ type: channels.type }).from(channels).where(eq(channels.id, channelId)).limit(1);
  if (!existing) return;
  if (existing.type === 'voice') {
    const voiceChannels = await db.select({ id: channels.id }).from(channels).where(eq(channels.type, 'voice'));
    if (!canDeleteChannel(existing.type, voiceChannels.length)) {
      send(socket, { t: 'error', code: 'cannot-delete-last-voice-channel', message: 'Precisa existir pelo menos um canal de voz.' });
      return;
    }
  }
  // import() dinamico (nao no topo do arquivo) so pra quebrar o ciclo —
  // modules/attachments.ts ja importa channelExists DESTE arquivo, um
  // import estatico no topo aqui criaria um ciclo. Chamado antes do delete
  // abaixo: as mensagens do canal (e os anexos delas) vao embora via CASCADE
  // no Postgres, sem passar por handleChatDelete — sem isso, os ARQUIVOS em
  // disco de qualquer imagem/anexo desse canal ficariam orfaos pra sempre.
  const { deleteForChannel } = await import('./attachments.js');
  await deleteForChannel(channelId);
  const result = await db.delete(channels).where(eq(channels.id, channelId));
  if (result.rowCount === 0) return;
  // mensagens do canal ja foram embora via CASCADE — isso e o que "apaga do
  // banco pra sempre" significa aqui. Aviso explicito (alem da arvore nova)
  // pra quem estava exatamente NESSE canal saber que precisa trocar.
  broadcast({ t: 'channel-deleted', channelId });
  await broadcastTree();
}

async function handleCategoryRename(socket: AppSocket, msg: { categoryId?: string; name?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket || !isAdmin(p)) return;
  const categoryId = String(msg.categoryId || '');
  const name = sanitizeChannelName(msg.name);
  if (!categoryId || !name) return;
  const result = await db.update(categories).set({ name }).where(eq(categories.id, categoryId));
  if (result.rowCount === 0) return;
  await broadcastTree();
}

async function handleChannelRename(socket: AppSocket, msg: { channelId?: string; name?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket || !isAdmin(p)) return;
  const channelId = String(msg.channelId || '');
  const name = sanitizeChannelName(msg.name);
  if (!channelId || !name) return;
  const result = await db.update(channels).set({ name }).where(eq(channels.id, channelId));
  if (result.rowCount === 0) return;
  await broadcastTree();
}

async function handleCategoriesReorder(socket: AppSocket, msg: { orderedIds?: unknown }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket || !isAdmin(p)) return;
  const orderedIds = Array.isArray(msg.orderedIds) ? msg.orderedIds.map(String) : [];
  if (!orderedIds.length) return;
  const existing = await db.select({ id: categories.id }).from(categories);
  const existingIds = new Set(existing.map((r) => r.id));
  // o conjunto mandado tem que bater EXATAMENTE com o que existe — evita
  // reindexar em cima de um id que nao existe mais (corrida com um delete).
  if (orderedIds.length !== existingIds.size || !orderedIds.every((id) => existingIds.has(id))) return;
  await Promise.all(orderedIds.map((id, index) => db.update(categories).set({ position: index }).where(eq(categories.id, id))));
  await broadcastTree();
}

/** Reordena os canais de UMA categoria — tambem cobre "mover pra outra
 * categoria" (arrastar um canal pra dentro de outra lista no Discord): o
 * cliente manda a lista final inteira da categoria DE DESTINO, e todo canal
 * nela tem seu categoryId setado pra essa categoria (no-op pra quem ja
 * estava, mudanca de verdade so pro que foi movido). */
async function handleChannelsReorder(socket: AppSocket, msg: { categoryId?: string; orderedIds?: unknown }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket || !isAdmin(p)) return;
  const categoryId = String(msg.categoryId || '');
  const orderedIds = Array.isArray(msg.orderedIds) ? msg.orderedIds.map(String) : [];
  if (!categoryId || !orderedIds.length) return;
  const [category] = await db.select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId)).limit(1);
  if (!category) return;
  const existing = await db.select({ id: channels.id }).from(channels).where(inArray(channels.id, orderedIds));
  if (existing.length !== orderedIds.length) return; // algum id sumiu (corrida com um delete)
  await Promise.all(orderedIds.map((id, index) => db.update(channels).set({ categoryId, position: index }).where(eq(channels.id, id))));
  await broadcastTree();
}

export const handlers: HandlerTable = {
  'category-create': handleCategoryCreate,
  'category-delete': handleCategoryDelete,
  'category-rename': handleCategoryRename,
  'channel-create': handleChannelCreate,
  'channel-delete': handleChannelDelete,
  'channel-rename': handleChannelRename,
  'categories-reorder': handleCategoriesReorder,
  'channels-reorder': handleChannelsReorder,
};
