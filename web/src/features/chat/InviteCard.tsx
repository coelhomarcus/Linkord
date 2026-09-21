import { useState } from 'react';
import { Users } from 'lucide-react';
import { GroupAvatar } from '@/features/conversations/GroupAvatar';
import { Button } from '@/shared/ui/primitives/button';
import { acceptInvitation, ApiError, declineInvitation, revokeInvitation } from '@/shared/api/api';
import { useRoom } from '@/state/RoomContext';
import type { InvitationCard, InvitationStatus } from '@/shared/types/protocol';

type LocalOutcome = 'group_full' | null;

const STATUS_LABEL: Record<Exclude<InvitationStatus, 'pending'>, string> = {
  accepted: 'Aceito',
  declined: 'Recusado',
  revoked: 'Cancelado',
  expired: 'Expirado',
};

export function InviteCard({ invitation }: { invitation: InvitationCard | null | undefined }) {
  if (!invitation) {
    return (
      <div className="mt-1 max-w-[380px] rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-label text-text-muted">
        Convite indisponível — o grupo não existe mais.
      </div>
    );
  }
  return <LiveInviteCard invitation={invitation} />;
}

function LiveInviteCard({ invitation }: { invitation: InvitationCard }) {
  const { state, conversations, openConversation } = useRoom();
  const [busy, setBusy] = useState<'accept' | 'decline' | 'revoke' | null>(null);
  const [outcome, setOutcome] = useState<LocalOutcome>(null);
  const [error, setError] = useState<string | null>(null);

  const myId = state.me.userId;
  const isInvitee = invitation.inviteeId === myId;
  const isInviter = invitation.inviterId === myId;
  const status: InvitationStatus = invitation.status;
  const group = conversations.find((c) => c.id === invitation.groupId);
  const isMember = !!group;
  const canRevoke = isInviter && group?.myRole === 'owner';

  async function run(kind: 'accept' | 'decline' | 'revoke', action: (id: string) => Promise<unknown>) {
    setBusy(kind);
    setError(null);
    try {
      await action(invitation.id);
      // the card itself updates from the server's `invitation-updated`
    } catch (err) {
      if (err instanceof ApiError && err.code === 'group_full') setOutcome('group_full');
      else if (err instanceof ApiError && err.code === 'quota_exceeded') setError('Você já participa do máximo de grupos permitido.');
      else setError('Não foi possível concluir a ação. Tente de novo.');
    } finally {
      setBusy(null);
    }
  }

  let footer: React.ReactNode;
  if (status === 'pending' && outcome === 'group_full') {
    footer = <p className="text-label text-text-muted">Limite atingido — o grupo está cheio.</p>;
  } else if (status === 'pending' && isInvitee && isMember) {
    footer = <p className="text-label text-text-muted">Você já participa deste grupo.</p>;
  } else if (status === 'pending' && isInvitee) {
    footer = (
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={busy !== null} onClick={() => run('accept', acceptInvitation)}>
          {busy === 'accept' ? 'Aceitando…' : 'Entrar no grupo'}
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={busy !== null} onClick={() => run('decline', declineInvitation)}>
          Recusar
        </Button>
      </div>
    );
  } else if (status === 'pending') {
    footer = (
      <div className="flex items-center gap-2">
        <span className="text-label text-text-muted">Aguardando resposta</span>
        {canRevoke && (
          <Button type="button" size="xs" variant="ghost" disabled={busy !== null} onClick={() => run('revoke', revokeInvitation)}>
            Revogar
          </Button>
        )}
      </div>
    );
  } else if (status === 'accepted' && isMember) {
    footer = (
      <Button type="button" size="sm" variant="secondary" onClick={() => openConversation(invitation.groupId)}>
        Abrir grupo
      </Button>
    );
  } else {
    footer = <p className="text-label font-medium text-text-muted">{STATUS_LABEL[status]}</p>;
  }

  return (
    <div className="mt-1 max-w-[380px] rounded-xl border border-white/10 bg-white/[0.04] p-3" data-invite-status={status}>
      <p className="mb-2 text-caption uppercase tracking-wide text-text-muted">Convite para grupo</p>
      <div className="mb-3 flex items-center gap-3">
        <GroupAvatar title={invitation.groupTitle} avatar={invitation.groupAvatar} size={44} />
        <div className="min-w-0">
          <p className="truncate text-body font-medium text-text-primary">{invitation.groupTitle}</p>
          <p className="flex items-center gap-1 text-caption text-text-muted">
            <Users size={12} />
            {invitation.memberCount} {invitation.memberCount === 1 ? 'membro' : 'membros'}
          </p>
        </div>
      </div>
      {status === 'pending' && isInvitee && !isMember && outcome !== 'group_full' && (
        <p className="mb-2 text-caption text-text-muted">Ao entrar, você verá o histórico do grupo.</p>
      )}
      {footer}
      {error && <p role="alert" className="mt-2 text-caption text-red">{error}</p>}
    </div>
  );
}
