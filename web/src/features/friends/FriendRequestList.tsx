import { useCallback, useState } from 'react';
import { Button } from '@/shared/ui/primitives/button';
import { acceptFriendRequest, cancelFriendRequest, declineFriendRequest, fetchFriendRequests } from '@/shared/api/api';
import { SocialUserRow } from './SocialUserRow';
import { useFriends } from './FriendsContext';
import { useCursorList } from './useCursorList';

export type RequestDirection = 'incoming' | 'outgoing';

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

export function FriendRequestList({ direction, search = '', onOpenProfile }: { direction: RequestDirection; search?: string; onOpenProfile: (userId: string) => void }) {
  const { revision, bump } = useFriends();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const fetchPage = useCallback((cursor: string | null) => fetchFriendRequests(direction, cursor, search), [direction, search]);
  const list = useCursorList(fetchPage, `${direction}|${search}|${revision}`);

  async function act(userId: string, action: (id: string) => Promise<unknown>) {
    if (busyId) return;
    setBusyId(userId);
    setActionError(null);
    try {
      await action(userId);
      bump();
    } catch {
      setActionError('Não foi possível concluir a ação. Tente de novo.');
    } finally {
      setBusyId(null);
    }
  }

  if (list.status === 'loading') return <p className="py-8 text-center text-label text-text-muted">Carregando solicitações…</p>;
  if (list.status === 'error') {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-body text-text-muted">Não foi possível carregar as solicitações.</p>
        <Button type="button" variant="secondary" size="sm" onClick={list.retry}>Tentar de novo</Button>
      </div>
    );
  }
  if (list.items.length === 0) {
    return (
      <p className="py-10 text-center text-label text-text-muted">
        {search ? 'Nenhum resultado para esta busca.' : direction === 'incoming' ? 'Nenhuma solicitação recebida.' : 'Você não tem solicitações enviadas.'}
      </p>
    );
  }

  return (
    <>
      {actionError && <p role="alert" className="mb-2 rounded-md bg-red/12 px-2.5 py-1.5 text-label text-red-text">{actionError}</p>}
      <div className="flex flex-col">
        {list.items.map(({ user, at }) => (
          <SocialUserRow key={user.id} user={user} subtitle={formatWhen(at)} onOpenProfile={() => onOpenProfile(user.id)}>
            {direction === 'incoming' ? (
              <>
                <Button type="button" size="sm" disabled={busyId === user.id} onClick={() => void act(user.id, acceptFriendRequest)}>Aceitar</Button>
                <Button type="button" variant="ghost" size="sm" disabled={busyId === user.id} onClick={() => void act(user.id, declineFriendRequest)}>Recusar</Button>
              </>
            ) : (
              <Button type="button" variant="ghost" size="sm" disabled={busyId === user.id} onClick={() => void act(user.id, cancelFriendRequest)}>Cancelar</Button>
            )}
          </SocialUserRow>
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

