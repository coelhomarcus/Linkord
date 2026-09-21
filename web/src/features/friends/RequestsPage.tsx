import { useCallback, useState } from 'react';
import { ApiError } from '@/shared/api/api';
import { Button } from '@/shared/ui/primitives/button';
import {
  acceptFriendRequest, acceptInvitation, cancelFriendRequest, declineFriendRequest, declineInvitation, fetchFriendRequests, fetchReceivedInvitations,
} from '@/shared/api/api';
import { GroupAvatar } from '@/features/conversations/GroupAvatar';
import { Segmented } from './Segmented';
import { SocialPageLayout } from './SocialPageLayout';
import { SocialUserRow } from './SocialUserRow';
import { useFriends } from './FriendsContext';
import { useCursorList } from './useCursorList';

type Direction = 'incoming' | 'outgoing';
type Tab = Direction | 'invitations';

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function RequestList({ direction, onOpenProfile }: { direction: Direction; onOpenProfile: (userId: string) => void }) {
  const { revision, bump } = useFriends();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const fetchPage = useCallback((cursor: string | null) => fetchFriendRequests(direction, cursor), [direction]);
  const list = useCursorList(fetchPage, `${direction}|${revision}`);

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
        {direction === 'incoming' ? 'Nenhuma solicitação recebida.' : 'Você não tem solicitações enviadas.'}
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

function InvitationList({ onOpenProfile }: { onOpenProfile: (userId: string) => void }) {
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
                {` · ${entry.group.memberCount} ${entry.group.memberCount === 1 ? 'membro' : 'membros'} · vence em ${formatWhen(new Date(entry.expiresAt).toISOString())}`}
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
    if (err.code === 'group_full') return 'O grupo está cheio.';
    if (err.code === 'invitation_expired') return 'Este convite expirou.';
  }
  return 'Não foi possível concluir a ação. Tente de novo.';
}

export function RequestsPage({ onOpenProfile }: { onOpenProfile: (userId: string) => void }) {
  const { pendingIncomingCount } = useFriends();
  const [tab, setTab] = useState<Tab>('incoming');
  return (
    <SocialPageLayout title="Solicitações" subtitle={pendingIncomingCount > 0 ? `${pendingIncomingCount} pendente${pendingIncomingCount === 1 ? '' : 's'}` : undefined}>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <Segmented
          label="Tipo de solicitação"
          value={tab}
          onChange={setTab}
          options={[{ value: 'incoming', label: 'Recebidas' }, { value: 'outgoing', label: 'Enviadas' }, { value: 'invitations', label: 'Convites' }]}
        />
        {/* keyed so each tab gets its own list state — otherwise the previous
            tab's rows would sit under the wrong buttons until the fetch lands */}
        {tab === 'invitations'
          ? <InvitationList key={tab} onOpenProfile={onOpenProfile} />
          : <RequestList key={tab} direction={tab} onOpenProfile={onOpenProfile} />}
      </div>
    </SocialPageLayout>
  );
}
