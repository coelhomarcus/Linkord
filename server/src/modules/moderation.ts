import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { findById } from './auth/users.js';
import { invalidateSessionsForUser } from './auth/session.js';
import { participants, broadcast, send, removeParticipant } from '../realtime/participants.js';
import { deleteAvatarFile } from './attachments.js';
import type { AppSocket, HandlerTable, Participant } from '../types.js';

// ---------------------------------------------------------------------------
// Aba "Moderacao" dos Ajustes (admin-only) — hoje so apaga conta. Mensagens
// de quem for apagado NAO somem (authorId vira NULL, mas authorName/
// authorAvatar ja ficam congelados na propria linha desde o envio, ver
// db/schema.ts — apagar uma conta e "essa pessoa nao pode mais entrar", nao
// "reescrever o historico do chat"). Sessions somem sozinhas via CASCADE.
// ---------------------------------------------------------------------------

function isAdmin(p: Participant | undefined): boolean {
  return !!p && p.role === 'admin';
}

async function handleUserDelete(socket: AppSocket, msg: { userId?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket || !isAdmin(p)) return;

  const targetId = String(msg.userId || '');
  if (!targetId) return;

  // sem tela de "promover a admin" nenhuma, o unico jeito de voltar a ser
  // admin depois seria re-registrar com o username de ADMIN_USERNAME — mais
  // seguro simplesmente nao deixar apagar a PROPRIA conta por aqui.
  if (targetId === p.userId) {
    send(socket, { t: 'error', code: 'cannot-delete-self', message: 'Voce nao pode apagar a propria conta por aqui.' });
    return;
  }

  const target = await findById(targetId);
  if (!target) return; // ja foi apagada (corrida com outro admin, ou id invalido)

  // apaga o ARQUIVO da foto de perfil antes da linha — depois do delete
  // abaixo nao ha mais como saber qual era (users.avatar so existe nessa
  // propria linha, attachments nao tem coluna de userId nenhuma). So faz
  // sentido pra upload nosso (`/uploads/<id>`) — deleteAvatarFile ja ignora
  // URL externa/vazia em silencio.
  if (target.avatar) {
    await deleteAvatarFile(target.avatar).catch((err) => {
      console.error(`[moderation] falha ao apagar foto de perfil de ${targetId}:`, err instanceof Error ? err.stack : err);
    });
  }

  const result = await db.delete(users).where(eq(users.id, targetId));
  if (result.rowCount === 0) return;

  // fecha a janela de ate 60s que o cache de sessao (modules/auth/session.ts)
  // deixaria aberta — sem isso, uma sessao ja resolvida recentemente
  // continuaria "valida" pro servidor por um tempo mesmo com a conta ja
  // apagada do banco.
  invalidateSessionsForUser(targetId);

  // kick imediato de toda conexao ao vivo dessa conta (pode ter mais de
  // uma aba) — sessions ja sumiram via CASCADE, mas um socket que ja estava
  // conectado nao sabe disso sozinho ate tentar reconectar.
  for (const other of [...participants.values()]) {
    if (other.userId !== targetId) continue;
    const otherSocket = other.socket;
    removeParticipant(other);
    try { otherSocket?.disconnect(true); } catch { /* socket ja morrendo */ }
  }

  broadcast({ t: 'user-deleted', userId: targetId });
}

export const handlers: HandlerTable = {
  'user-delete': handleUserDelete,
};
