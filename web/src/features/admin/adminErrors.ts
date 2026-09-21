import { ApiError } from '@/shared/api/api';

export const REASON_MIN = 3;
export const REASON_MAX = 500;

export function describeAdminError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'reason_required': return 'Informe o motivo (3 a 500 caracteres).';
      case 'self_action': return 'Você não pode fazer isso na própria conta.';
      case 'last_admin': return 'Essa conta é o último administrador ativo.';
      case 'confirmation_mismatch': return 'A confirmação não confere.';
      case 'already_admin': return 'Essa conta já é administradora.';
      case 'not_admin': return 'Essa conta não é administradora.';
      case 'target_inactive': return 'Só uma conta ativa pode virar administradora.';
      case 'forbidden': return 'Você não tem mais permissão de administrador.';
      case 'rate_limited': return 'Muitas ações seguidas. Espere um pouco.';
      default: if (err.message) return err.message;
    }
  }
  return 'Não foi possível concluir a ação. Tente de novo.';
}
