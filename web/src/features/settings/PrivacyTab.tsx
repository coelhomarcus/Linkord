import { useCallback, useState } from 'react';
import { Button } from '@/shared/ui/primitives/button';
import { fetchBlocks, unblockUser } from '@/shared/api/api';
import { SocialUserRow } from '@/features/friends/SocialUserRow';
import { useFriends } from '@/features/friends/FriendsContext';
import { useCursorList } from '@/features/friends/useCursorList';

/** Blocked accounts. Only YOUR blocks are listed — who blocked you is never
 * exposed anywhere. */
export function PrivacyTab({ onOpenProfile }: { onOpenProfile: (userId: string) => void }) {
  const { revision, bump } = useFriends();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const fetchPage = useCallback((cursor: string | null) => fetchBlocks(cursor), []);
  const list = useCursorList(fetchPage, String(revision));

  async function handleUnblock(userId: string) {
    if (busyId) return;
    setBusyId(userId);
    setActionError(null);
    try {
      await unblockUser(userId);
      bump();
    } catch {
      setActionError('Não foi possível desbloquear. Tente de novo.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-body font-medium text-text-primary">Pessoas bloqueadas</h2>
        <p className="select-none text-label text-text-muted">
          Quem você bloqueia não consegue te enviar mensagens nem te ligar em conversa privada. Desbloquear não devolve a amizade — vocês precisam se adicionar de novo.
        </p>
      </div>

      {actionError && <p role="alert" className="rounded-md bg-red/12 px-2.5 py-1.5 text-label text-red-text">{actionError}</p>}
      {list.status === 'loading' && <p className="py-4 text-center text-label text-text-muted">Carregando…</p>}
      {list.status === 'error' && (
        <div className="flex items-center gap-2 rounded-md bg-red/12 px-2.5 py-1.5 text-label text-red-text">
          <span className="min-w-0 flex-1">Não foi possível carregar a lista.</span>
          <button type="button" onClick={list.retry} className="flex-none font-medium underline-offset-2 hover:underline">Tentar de novo</button>
        </div>
      )}
      {list.status === 'ready' && list.items.length === 0 && (
        <p className="py-4 text-center text-label text-text-muted">Você não bloqueou ninguém.</p>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,22rem),1fr))] gap-x-4">
        {list.items.map(({ user }) => (
          <SocialUserRow key={user.id} user={user} onOpenProfile={() => onOpenProfile(user.id)}>
            <Button type="button" variant="secondary" size="sm" disabled={busyId === user.id} onClick={() => void handleUnblock(user.id)}>
              Desbloquear
            </Button>
          </SocialUserRow>
        ))}
      </div>

      {list.hasMore && list.status === 'ready' && (
        <Button type="button" variant="ghost" size="sm" className="self-center" disabled={list.loadingMore} onClick={list.loadMore}>
          {list.loadingMore ? 'Carregando…' : 'Carregar mais'}
        </Button>
      )}
    </div>
  );
}
