import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/shared/ui/primitives/button';
import { ApiError, acceptInvitation, declineInvitation, fetchReceivedInvitations } from '@/shared/api/api';
import type { ReceivedInvitationEntry } from '@/shared/api/api';
import { ERROR_CODES } from '@/shared/api/errorCodes';
import { GroupAvatar } from '@/features/conversations/GroupAvatar';
import { ActionFeedback } from './ActionFeedback';
import type { Feedback } from './ActionFeedback';
import { useFriends } from './FriendsContext';
import { ListSearch } from './ListSearch';
import { ListSectionHeader } from './ListSectionHeader';
import { LoadMoreFooter } from './LoadMoreFooter';
import { useCursorList } from './useCursorList';
import { usePendingIds } from './usePendingIds';
import { useUrlSearch } from './useUrlSearch';

const HEADING_ID = 'invitations-title';
const invitationKey = (entry: ReceivedInvitationEntry) => entry.id;

export function GroupInvitationsView({ query, onQueryChange, onOpenProfile }: { query: string; onQueryChange: (next: string) => void; onOpenProfile: (userId: string) => void }) {
  const { revision, bump } = useFriends();
  const pending = usePendingIds();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const clearFeedback = useCallback(() => setFeedback(null), []);
  const { value, setValue, search } = useUrlSearch(query, onQueryChange);
  const fetchPage = useCallback((cursor: string | null) => fetchReceivedInvitations(cursor, search), [search]);
  const list = useCursorList(fetchPage, `invitations|${search}`, { revision, getKey: invitationKey });

  async function act(id: string, action: (id: string) => Promise<unknown>, success: string) {
    setFeedback(null);
    const outcome = await pending.run(id, () => action(id));
    if (!outcome) return;
    if (!outcome.ok) {
      // a failed accept (expired, full, no longer friends) leaves the row stale:
      // re-read it, and keep saying why
      setFeedback({ tone: 'error', text: describeInvitationError(outcome.error) });
      bump();
      return;
    }
    list.removeItem(id);
    setFeedback({ tone: 'success', text: success });
    document.getElementById(HEADING_ID)?.focus();
    bump();
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
      <div className="flex flex-col divide-y divide-white/[0.06]">
        {list.items.map((entry) => {
          const busy = pending.isPending(entry.id);
          return (
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
                <Button type="button" size="sm" disabled={busy} onClick={() => void act(entry.id, acceptInvitation, 'Você entrou no grupo.')}>Entrar</Button>
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void act(entry.id, declineInvitation, 'Convite recusado.')}>Recusar</Button>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ListSearch value={value} onChange={setValue} label="Buscar nos convites" />
      <section aria-labelledby={HEADING_ID} className="flex flex-col gap-2">
        <ListSectionHeader id={HEADING_ID} title="Convites de grupo" />
        <ActionFeedback feedback={feedback} onClear={clearFeedback} />
        {body}
        {list.status === 'ready' && <LoadMoreFooter list={list} className="pt-2" />}
      </section>
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
