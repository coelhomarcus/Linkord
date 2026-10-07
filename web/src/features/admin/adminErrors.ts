import { ApiError } from '@/shared/api/api';
import { ERROR_CODES } from '@/shared/api/errorCodes';

export const REASON_MIN = 3;
export const REASON_MAX = 500;

/** Mirrors the server's normalizeReason: whitespace runs collapse to one space, so
 * what the form validates is what the server will accept (and store). */
export function normalizeReasonText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/** The server refused because the entity is no longer in the state the admin was
 * looking at (409), or is gone (404): what is on screen is out of date. */
export function isStaleStateError(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return status === 409 || status === 404;
}

export function describeAdminError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case ERROR_CODES.reason_required: return 'Informe o motivo (3 a 500 caracteres).';
      case ERROR_CODES.self_action: return 'Você não pode fazer isso na própria conta.';
      case ERROR_CODES.last_admin: return 'Essa conta é o último administrador ativo.';
      case ERROR_CODES.confirmation_mismatch: return 'A confirmação não confere.';
      case ERROR_CODES.already_admin: return 'Essa conta já é administradora.';
      case ERROR_CODES.not_admin: return 'Essa conta não é administradora.';
      case ERROR_CODES.target_inactive: return 'Só uma conta ativa pode virar administradora.';
      case ERROR_CODES.already_suspended: return 'Já estava suspenso — o estado mudou antes da sua ação. Os dados foram atualizados.';
      case ERROR_CODES.not_suspended: return 'Já estava ativo — o estado mudou antes da sua ação. Os dados foram atualizados.';
      case ERROR_CODES.not_member: return 'Essa conta não é mais membro do grupo. A lista de membros foi atualizada.';
      case ERROR_CODES.forbidden: return 'Você não tem mais permissão de administrador.';
      case ERROR_CODES.rate_limited: return 'Muitas ações seguidas. Espere um pouco.';
      default: if (err.message) return err.message;
    }
  }
  return 'Não foi possível concluir a ação. Tente de novo.';
}
