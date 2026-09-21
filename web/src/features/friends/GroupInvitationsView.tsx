import { useState } from 'react';
import { Button } from '@/shared/ui/primitives/button';
import { ApiError, acceptInvitation, declineInvitation, fetchReceivedInvitations } from '@/shared/api/api';
import { ERROR_CODES } from '@/shared/api/errorCodes';
import { GroupAvatar } from '@/features/conversations/GroupAvatar';
import { useFriends } from './FriendsContext';
import { useCursorList } from './useCursorList';

export function GroupInvitationsView({ onOpenProfile }: { onOpenProfile: (userId: string) => void }) {
  const { revision, bump } = useFriends();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const list = useCursorList(fetchReceivedInvitations, `invitations|${revision}`);

  async function act(id: string, action: (id: string) => Promise<unknown>) {
    if (busyId) return;
    setBusyId(id);
    setActionError(null);
    try {
      await action(id);
    } catch (err) {
      setActionError(describeInvitationError(err));
    } finally {
      // a failed accept (expired, full, no longer friends) leaves the row
      // stale, so refetch either way
      bump();
      setBusyId(null);
    }
  }

  if (list.status === 'loading') return <p className="py-8 text-center text-label text-text-muted">Carregando convites…</p>;
  if (list.status === 'error') {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-body text-text-muted">Não foi possível carregar os convites.</p>
        <Button type="button" variant="secondary" size="sm" onClick={list.retry}>Tentar de novo</Button>
      </div>
    );
  }
  if (list.items.length === 0) return <p className="py-10 text-center text-label text-text-muted">Nenhum convite de grupo pendente.</p>;

  return (
    <>
      {actionError && <p role="alert" className="mb-2 rounded-md bg-red/12 px-2.5 py-1.5 text-label text-red-text">{actionError}</p>}
      <div className="flex flex-col">
        {list.items.map((entry) => (
          <div key={entry.id} className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.04]">
            <GroupAvatar title={entry.group.title} avatar={entry.group.avatar} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-body font-medium text-text-primary">{entry.group.title}</p>
              <p className="truncate text-caption text-text-muted">
                de{' '}
                <button type="button" onClick={() => onOpenProfile(entry.inviter.id)} className="hover:underline">{entry.inviter.displayName}</button>
                {` · ${entry.group.memberCount} ${entry.group.memberCount === 1 ? 'membro' : 'membros'}}`}
              </p>
            </div>
            <div className="flex flex-none items-center gap-1.5">
              <Button type="button" size="sm" disabled={busyId === entry.id} onClick={() => void act(entry.id, acceptInvitation)}>Entrar</Button>
              <Button type="button" variant="ghost" size="sm" disabled={busyId === entry.id} onClick={() => void act(entry.id, declineInvitation)}>Recusar</Button>
            </div>
          </div>
        ))}
      </div>
      {list.hasMore && (
        <Button type="button" variant="ghost" size="sm" className="mt-2 self-center" disabled={list.loadingMore} onClick={list.loadMore}>
          {list.loadingMore ? 'Carregando…' : 'Carregar mais'}
        </Button>
      )}
    </>
  );
}

function describeInvitationError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === ERROR_CODES.group_full) return 'O grupo está cheio.';
    if (err.code === ERROR_CODES.quota_exceeded) return 'Você já participa do máximo de grupos permitido.';
  }
  return 'Não foi possível concluir a ação. Tente de novo.';
}

