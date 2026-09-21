import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/shared/ui/primitives/button';
import { ApiError, acceptInvitation, declineInvitation, fetchReceivedInvitations } from '@/shared/api/api';
import { ERROR_CODES } from '@/shared/api/errorCodes';
import { GroupAvatar } from '@/features/conversations/GroupAvatar';
import { useFriends } from './FriendsContext';
import { ListSearch } from './ListSearch';
import { useCursorList } from './useCursorList';
import { useUrlSearch } from './useUrlSearch';

export function GroupInvitationsView({ query, onQueryChange, onOpenProfile }: { query: string; onQueryChange: (next: string) => void; onOpenProfile: (userId: string) => void }) {
  const { revision, bump } = useFriends();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { value, setValue, search } = useUrlSearch(query, onQueryChange);
  const fetchPage = useCallback((cursor: string | null) => fetchReceivedInvitations(cursor, search), [search]);
  const list = useCursorList(fetchPage, `invitations|${search}|${revision}`);

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

  let body: ReactNode;
  if (list.status === 'loading') {
    body = <p className="py-8 text-center text-label text-text-muted">Carregando convites…</p>;
  } else if (list.status === 'error') {
    body = (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-body text-text-muted">Não foi possível carregar os convites.</p>
        <Button type="button" variant="secondary" size="sm" onClick={list.retry}>Tentar de novo</Button>
      </div>
    );
  } else if (list.items.length === 0) {
    body = <p className="py-10 text-center text-label text-text-muted">{search ? 'Nenhum resultado para esta busca.' : 'Nenhum convite de grupo pendente.'}</p>;
  } else {
    body = (
      <>
        <div className="flex flex-col divide-y divide-white/[0.06]">
          {list.items.map((entry) => (
            <div key={entry.id} className="flex flex-wrap items-center gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-white/[0.04]">
              <GroupAvatar title={entry.group.title} avatar={entry.group.avatar} size={40} />
              <div className="min-w-0 flex-1 basis-48">
                <p className="truncate text-body font-medium text-text-primary">{entry.group.title}</p>
                <p className="truncate text-caption text-text-muted">
                  de{' '}
                  <button type="button" onClick={() => onOpenProfile(entry.inviter.id)} className="hover:underline">{entry.inviter.displayName}</button>
                  {` · ${entry.group.memberCount} ${entry.group.memberCount === 1 ? 'membro' : 'membros'}`}
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

  return (
    <div className="flex flex-col gap-4">
      <ListSearch value={value} onChange={setValue} label="Buscar nos convites" />
      {actionError && <p role="alert" className="rounded-md bg-red/12 px-2.5 py-1.5 text-label text-red-text">{actionError}</p>}
      {body}
    </div>
  );
}

function describeInvitationError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === ERROR_CODES.group_full) return 'O grupo está cheio.';
    if (err.code === ERROR_CODES.quota_exceeded) return 'Você já participa do máximo de grupos permitido.';
  }
  return 'Não foi possível concluir a ação. Tente de novo.';
}

