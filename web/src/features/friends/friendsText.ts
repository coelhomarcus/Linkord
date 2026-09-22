import { ApiError } from '@/shared/api/api';
import type { FriendRequestOutcome } from '@/shared/api/api';
import { ERROR_CODES } from '@/shared/api/errorCodes';

/** "  @Lune " → "Lune". The server lowercases for lookup itself
 * (users.ts#findByUsernameLower), so this only strips what a person naturally
 * types around a handle. */
export function normalizeUsernameInput(raw: string): string {
  return raw.trim().replace(/^@+/, '').trim();
}

export function formatRetryAfter(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function describeSendError(err: unknown): string {
  if (err instanceof ApiError) {
    // one deliberately generic answer for "doesn't exist" AND "can't be
    // reached" — the server never says which (a block must not be revealed)
    if (err.code === ERROR_CODES.user_unavailable) return 'Não foi possível enviar a solicitação. Confira o nome de usuário.';
    if (err.code === ERROR_CODES.cooldown) {
      const when = err.retryAfter ? formatRetryAfter(err.retryAfter) : '';
      return when ? `Aguarde para tentar de novo — disponível a partir de ${when}.` : 'Aguarde um pouco antes de tentar de novo.';
    }
    if (err.code === ERROR_CODES.rate_limited || err.code === ERROR_CODES.quota_exceeded) return err.message;
  }
  return 'Não foi possível enviar a solicitação.';
}

export function describeOutcome(outcome: FriendRequestOutcome, username: string): { text: string; tone: 'success' | 'info' } {
  switch (outcome) {
    case 'created': return { text: `Solicitação enviada para @${username}.`, tone: 'success' };
    case 'already_pending': return { text: `Você já enviou uma solicitação para @${username}.`, tone: 'info' };
    case 'pending_received': return { text: `@${username} já te enviou uma solicitação — aceite em Solicitações.`, tone: 'info' };
    case 'already_friends': return { text: `Você e @${username} já são amigos.`, tone: 'info' };
  }
}
