import crypto from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { categories, channels } from '../db/schema.js';
import { participants, broadcast, send, setVoiceChannelId } from '../realtime/participants.js';
import { deleteVoiceRoom } from '../realtime/livekit.js';
import type { AppSocket, HandlerTable, Participant } from '../types.js';

// Categories/channels — text or voice, admins create/delete/reorder either
// freely (only the LAST voice channel is protected, see handleChannelDelete).
// Every mutation rebroadcasts the WHOLE fresh tree (`channels-tree`) instead
// of incremental events — the tree is small (only admins touch it), so
// "refetch and resend everything" is simpler and harder to desync than
// reconciling diffs.

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

// External LiveKit deletion and the Postgres row deletion cannot share one
// transaction. This marker closes the interval in which voice-join could
// mint a token while those two operations are in flight.
const deletingChannelIds = new Set<string>();

export function isChannelBeingDeleted(channelId: string): boolean {
  return deletingChannelIds.has(channelId);
}

export function sanitizeChannelName(name: unknown): string | null {
  const s = String(name == null ? '' : name).trim().slice(0, 60);
  return s || null;
}

function isAdmin(p: Participant | undefined): boolean {
  return !!p && p.role === 'admin';
}

/** The room can never be left with NO voice channel — deleting the last
 * one would only be recoverable with a server restart
 * (ensureVoiceChannelExists only runs at boot). Text channels never lock. */
export function canDeleteChannel(type: string, voiceChannelCount: number): boolean {
  return type !== 'voice' || voiceChannelCount > 1;
}

/** "General" category + "general" text channel the first time the server
 * boots with an empty DB — covers both a fresh install and upgrading from
 * the old single in-memory chat. Called once at boot. */
export async function ensureSeeded(): Promise<void> {
  const [existing] = await db.select({ id: categories.id }).from(categories).limit(1);
  if (existing) return;
  const categoryId = crypto.randomUUID();
  const channelId = crypto.randomUUID();
  await db.insert(categories).values({ id: categoryId, name: 'Geral', position: 0 });
  await db.insert(channels).values({ id: channelId, categoryId, name: 'geral', type: 'text', position: 0 });
}

/** Guarantees at least one voice channel exists somewhere in the tree —
 * runs on every boot (not just an empty DB, see ensureSeeded), covering
 * both a fresh install and upgrading an installation that had text
 * channels but no voice channel row yet. Just logs if there's no category
 * at all (admin deleted everything) — nowhere to put it. */
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

/** Ordered tree (categories -> channels), for `welcome` and for
 * rebroadcasting after any mutation. */
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

/** Whether a channel type may carry chat/history/attachments. Kept as a
 * small pure predicate so every entry point applies the exact same rule. */
export function isTextChannelType(type: string | null | undefined): boolean {
  return type === 'text';
}

export async function textChannelExists(channelId: string): Promise<boolean> {
  return isTextChannelType(await getChannelType(channelId));
}

/** Used by realtime/socket.ts#handleVoiceJoin to check the channel exists
 * and is actually voice before minting a LiveKit token — null covers both
 * "doesn't exist" and any read error. */
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
    // 23001 = restrict_violation (the specific SQLSTATE for ON DELETE
    // RESTRICT — NOT the generic 23503/foreign_key_violation) — the
    // category still has channels in it.
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
    if (deletingChannelIds.has(channelId)) {
      send(socket, { t: 'error', code: 'channel-delete-in-progress', message: 'Esse canal ja esta sendo apagado.' });
      return;
    }
    deletingChannelIds.add(channelId);
  }
  try {
    if (existing.type === 'voice') {
      try {
        // Do this before deleting the DB row: an infrastructure failure leaves
        // the visible channel intact instead of an unreachable ghost room.
        await deleteVoiceRoom(channelId);
      } catch (err) {
        console.error(`[channels] falha ao encerrar sala LiveKit ${channelId}:`, err instanceof Error ? err.stack : err);
        send(socket, { t: 'error', code: 'livekit-room-delete-failed', message: 'Nao foi possivel encerrar a chamada. Tente apagar o canal novamente.' });
        return;
      }
    }

    // dynamic import to avoid a cycle (modules/attachments.ts imports channel
    // helpers). Called before the delete below: message/attachment rows go via
    // CASCADE, so this prevents orphaned files on disk.
    const { deleteForChannel } = await import('./attachments.js');
    await deleteForChannel(channelId);
    const result = await db.delete(channels).where(eq(channels.id, channelId));
    if (result.rowCount === 0) return;
    if (existing.type === 'voice') {
      for (const participant of participants.values()) {
        if (participant.voiceChannelId === channelId) setVoiceChannelId(participant, null);
      }
      // Catch a join that obtained a token immediately before the deletion
      // marker was installed and connected while the DB row was removed.
      try {
        await deleteVoiceRoom(channelId);
      } catch (err) {
        console.error(`[channels] canal ${channelId} apagado, mas a segunda limpeza LiveKit falhou:`, err instanceof Error ? err.stack : err);
        send(socket, { t: 'error', code: 'livekit-room-cleanup-incomplete', message: 'O canal foi apagado, mas a chamada pode demorar para encerrar por completo.' });
      }
    }
    // messages already gone via CASCADE — this is what "permanently deleted"
    // means here. Explicit notice (besides the fresh tree) for whoever was in
    // exactly this channel.
    broadcast({ t: 'channel-deleted', channelId });
    await broadcastTree();
  } finally {
    deletingChannelIds.delete(channelId);
  }
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
  // the set sent must EXACTLY match what exists — avoids reindexing over an
  // id that no longer exists (race with a delete).
  if (orderedIds.length !== existingIds.size || !orderedIds.every((id) => existingIds.has(id))) return;
  await Promise.all(orderedIds.map((id, index) => db.update(categories).set({ position: index }).where(eq(categories.id, id))));
  await broadcastTree();
}

/** Reorders one category's channels — also covers moving a channel to
 * ANOTHER category (drag it into another list): client sends the
 * destination category's full final list, and every channel in it gets
 * that categoryId (no-op for ones already there). */
async function handleChannelsReorder(socket: AppSocket, msg: { categoryId?: string; orderedIds?: unknown }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket || !isAdmin(p)) return;
  const categoryId = String(msg.categoryId || '');
  const orderedIds = Array.isArray(msg.orderedIds) ? msg.orderedIds.map(String) : [];
  if (!categoryId || !orderedIds.length) return;
  const [category] = await db.select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId)).limit(1);
  if (!category) return;
  const existing = await db.select({ id: channels.id }).from(channels).where(inArray(channels.id, orderedIds));
  if (existing.length !== orderedIds.length) return; // some id disappeared (race with a delete)
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
