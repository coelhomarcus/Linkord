export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const ACTION_LABELS: Record<string, string> = {
  'user.suspend': 'Conta suspensa', 'user.grant_admin': 'Admin concedido', 'user.revoke_admin': 'Admin removido', 'storage.sweep_orphans': 'Órfãos coletados', 'storage.orphan_delete': 'Falha ao apagar órfão', 'user.reactivate': 'Conta reativada', 'user.revoke_sessions': 'Sessões revogadas', 'user.delete': 'Conta excluída',
  'user.delete.avatar_cleanup': 'Limpeza da foto', 'group.suspend': 'Grupo suspenso', 'group.reactivate': 'Grupo reativado',
  'group.assign_owner': 'Dono atribuído', 'group.delete': 'Grupo excluído', 'group.owner_succession': 'Sucessão de dono',
  'message.delete': 'Mensagem apagada', 'call.kick': 'Removido da chamada', 'report.view': 'Evidência aberta',
  'report.claim': 'Denúncia assumida', 'report.resolve': 'Denúncia resolvida', 'report.dismiss': 'Denúncia dispensada',
};

/** A local calendar day (`yyyy-mm-dd`, as a date input gives it), or null when it is not a real date. */
function parseDay(day: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(y, m - 1, d);
  // 2026-02-31 would silently roll over to March: reject it instead
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? { y, m, d } : null;
}

/** Start of a local calendar day as an ISO instant. */
export function dayStartIso(day: string): string | undefined {
  const parsed = parseDay(day);
  return parsed ? new Date(parsed.y, parsed.m - 1, parsed.d).toISOString() : undefined;
}

/** The instant just after a local calendar day ends — the EXCLUSIVE upper bound
 * the server expects for "up to and including this day". */
export function nextDayStartIso(day: string): string | undefined {
  const parsed = parseDay(day);
  return parsed ? new Date(parsed.y, parsed.m - 1, parsed.d + 1).toISOString() : undefined;
}
