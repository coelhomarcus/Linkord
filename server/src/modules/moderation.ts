import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { findById } from './auth/users.js';
import { invalidateSessionsForUser } from './auth/session.js';
import { participants, broadcast, send, removeParticipant } from '../realtime/participants.js';
import { deleteAvatarFile } from './attachments.js';
import type { AppSocket, HandlerTable, Participant } from '../types.js';

// Settings "Moderation" tab (admin-only) — currently only deletes accounts.
// Deleted users' messages don't disappear (authorId becomes NULL, but
// authorName/authorAvatar are already frozen on the row at send time, see
// db/schema.ts — deleting an account means "this person can't log in
// anymore," not "rewrite chat history"). Sessions vanish via CASCADE.

function isAdmin(p: Participant | undefined): boolean {
  return !!p && p.role === 'admin';
}

async function handleUserDelete(socket: AppSocket, msg: { userId?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket || !isAdmin(p)) return;

  const targetId = String(msg.userId || '');
  if (!targetId) return;

  // no "promote to admin" screen exists — the only way back to admin would
  // be re-registering with ADMIN_USERNAME, so it's safer to just never
  // allow deleting your OWN account here.
  if (targetId === p.userId) {
    send(socket, { t: 'error', code: 'cannot-delete-self', message: 'Voce nao pode apagar a propria conta por aqui.' });
    return;
  }

  const target = await findById(targetId);
  if (!target) return; // already deleted (race with another admin, or invalid id)

  // delete the avatar FILE before the row — after the delete below there's
  // no way to know which one it was (users.avatar only exists on this row;
  // attachments has no userId column). Only matters for our own uploads
  // (`/uploads/<id>`) — deleteAvatarFile already silently ignores an
  // external/empty URL.
  if (target.avatar) {
    await deleteAvatarFile(target.avatar).catch((err) => {
      console.error(`[moderation] falha ao apagar foto de perfil de ${targetId}:`, err instanceof Error ? err.stack : err);
    });
  }

  const result = await db.delete(users).where(eq(users.id, targetId));
  if (result.rowCount === 0) return;

  // closes the up-to-60s window the session cache (modules/auth/session.ts)
  // would otherwise leave open — without this, a recently-resolved session
  // would stay "valid" to the server for a while even after the account is
  // gone from the DB.
  invalidateSessionsForUser(targetId);

  // immediately kick every live connection for this account (could be more
  // than one tab) — sessions are already gone via CASCADE, but an already-
  // connected socket has no way to know that until it tries to reconnect.
  for (const other of [...participants.values()]) {
    if (other.userId !== targetId) continue;
    const otherSocket = other.socket;
    removeParticipant(other);
    try { otherSocket?.disconnect(true); } catch { /* socket dying */ }
  }

  broadcast({ t: 'user-deleted', userId: targetId });
}

export const handlers: HandlerTable = {
  'user-delete': handleUserDelete,
};
