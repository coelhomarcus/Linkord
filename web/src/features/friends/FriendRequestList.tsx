import { useCallback, useState } from 'react';
import { Button } from '@/shared/ui/primitives/button';
import { acceptFriendRequest, cancelFriendRequest, declineFriendRequest, fetchFriendRequests } from '@/shared/api/api';
import type { SocialEntry } from '@/shared/api/api';
import { ActionFeedback } from './ActionFeedback';
import type { Feedback } from './ActionFeedback';
import { LoadMoreFooter } from './LoadMoreFooter';
import { SocialUserRow } from './SocialUserRow';
import { useFriends } from './FriendsContext';
import { useCursorList } from './useCursorList';
import { usePendingIds } from './usePendingIds';

export type RequestDirection = 'incoming' | 'outgoing';

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

const entryKey = (entry: SocialEntry) => entry.user.id;

export function FriendRequestList({ direction, search = '', headingId, onOpenProfile }: {
  direction: RequestDirection;
  search?: string;
  /** the section heading: focus moves there once an action removes the row that had it */
  headingId?: string;
  onOpenProfile: (userId: string) => void;
}) {
  const { revision, bump } = useFriends();
  const pending = usePendingIds();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const clearFeedback = useCallback(() => setFeedback(null), []);
  const fetchPage = useCallback((cursor: string | null) => fetchFriendRequests(direction, cursor, search), [direction, search]);
  const list = useCursorList(fetchPage, `${direction}|${search}`, { revision, getKey: entryKey });

  async function act(userId: string, action: (id: string) => Promise<unknown>, success: string) {
    setFeedback(null);
    const outcome = await pending.run(userId, () => action(userId));
    if (!outcome) return;
    if (!outcome.ok) {
      setFeedback({ tone: 'error', text: 'Não foi possível concluir a ação. Tente de novo.' });
      bump(); // the row may already be settled elsewhere: re-read, the message stays
      return;
    }
    list.removeItem(userId);
    setFeedback({ tone: 'success', text: success });
    if (headingId) document.getElementById(headingId)?.focus();
    bump();
  }

  let body;
  if (list.status === 'loading') {
    body = <p className="py-8 text-center text-label text-text-muted">Carregando solicitações…</p>;
  } else if (list.status === 'error') {
    body = (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-body text-text-muted">Não foi possível carregar as solicitações.</p>
        <Button type="button" variant="secondary" size="sm" onClick={list.retry}>Tentar de novo</Button>
      </div>
    );
  } else if (list.items.length === 0) {
    body = (
      <p className="py-10 text-center text-label text-text-muted">
        {search ? 'Nenhum resultado para esta busca.' : direction === 'incoming' ? 'Nenhuma solicitação recebida.' : 'Você não tem solicitações enviadas.'}
      </p>
    );
  } else {
    body = (
      <div className="flex flex-col divide-y divide-white/[0.06]">
        {list.items.map(({ user, at }) => {
          const busy = pending.isPending(user.id);
          return (
            <SocialUserRow key={user.id} user={user} subtitle={formatWhen(at)} onOpenProfile={() => onOpenProfile(user.id)}>
              {direction === 'incoming' ? (
                <>
                  <Button type="button" size="sm" disabled={busy} onClick={() => void act(user.id, acceptFriendRequest, 'Solicitação aceita.')}>Aceitar</Button>
                  <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void act(user.id, declineFriendRequest, 'Solicitação recusada.')}>Recusar</Button>
                </>
              ) : (
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void act(user.id, cancelFriendRequest, 'Solicitação cancelada.')}>Cancelar</Button>
              )}
            </SocialUserRow>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <ActionFeedback feedback={feedback} onClear={clearFeedback} />
      {body}
      {list.status === 'ready' && <LoadMoreFooter list={list} className="pt-2" />}
    </div>
  );
}
