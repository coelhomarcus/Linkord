export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const ACTION_LABELS: Record<string, string> = {
  'user.suspend': 'Conta suspensa', 'user.reactivate': 'Conta reativada', 'user.revoke_sessions': 'Sessões revogadas', 'user.delete': 'Conta excluída',
  'user.delete.avatar_cleanup': 'Limpeza da foto', 'group.suspend': 'Grupo suspenso', 'group.reactivate': 'Grupo reativado',
  'group.assign_owner': 'Dono atribuído', 'group.delete': 'Grupo excluído', 'group.owner_succession': 'Sucessão de dono',
  'message.delete': 'Mensagem apagada', 'call.kick': 'Removido da chamada', 'report.view': 'Evidência aberta',
  'report.claim': 'Denúncia assumida', 'report.resolve': 'Denúncia resolvida', 'report.dismiss': 'Denúncia dispensada',
};
