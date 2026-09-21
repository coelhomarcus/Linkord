import type { InviteOutcome } from '@/shared/api/api';

export function describeInviteOutcome(outcome: InviteOutcome): string {
  switch (outcome) {
    case 'sent': return 'convite enviado';
    case 'already_pending': return 'já tem um convite pendente';
    case 'already_member': return 'já está no grupo';
    case 'not_friends': return 'não é mais seu amigo';
    case 'cooldown': return 'recusou há pouco; tente mais tarde';
    case 'group_full': return 'o grupo está cheio';
    case 'unavailable': return 'indisponível';
  }
}
