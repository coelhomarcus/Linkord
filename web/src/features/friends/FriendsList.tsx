import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Check, Copy, MessageCircle, MoreHorizontal, Search, UserPlus, UserRound } from 'lucide-react';
import { useRoom } from '@/state/RoomContext';
import { blockUser, fetchFriends, removeFriend } from '@/shared/api/api';
import type { SocialUser } from '@/shared/api/api';
import { Button } from '@/shared/ui/primitives/button';
import { Input } from '@/shared/ui/primitives/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/primitives/dropdown-menu';
import { ROUTES, friendsView } from '@/shared/lib/routes';
import { ListSectionHeader } from './ListSectionHeader';
import { SocialConfirmDialog } from './SocialConfirmDialog';
import type { SocialConfirm } from './SocialConfirmDialog';
import { SocialUserRow } from './SocialUserRow';
import { useFriends } from './FriendsContext';
import { useCursorList } from './useCursorList';
import { useDebouncedValue } from './useDebouncedValue';

/** Everyone / Online. The search text lives in the URL (`?q=`): typing replaces the
 * entry, so Back returns to the previous VIEW, not to each keystroke. */
export function FriendsList({ view, query, onQueryChange, onOpenProfile }: {
  view: 'all' | 'online';
  query: string;
  onQueryChange: (next: string) => void;
  onOpenProfile: (userId: string) => void;
}) {
  const { state, onlineUserIds, openDirect, requestChatView } = useRoom();
  const { revision, bump } = useFriends();
  const navigate = useNavigate();
  const [value, setValue] = useState(query);
  const search = useDebouncedValue(value.trim(), 250);
  const [confirm, setConfirm] = useState<SocialConfirm | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // the URL is the source: an outside change of `q` (Back, a link) replaces the
  // input — adjusted during render, not from an effect
  const [seenQuery, setSeenQuery] = useState(query);
  if (query !== seenQuery) {
    setSeenQuery(query);
    setValue(query);
  }
  // and what was typed goes back to the URL once it settles
  useEffect(() => { if (search !== query.trim()) onQueryChange(search); }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchPage = useCallback((cursor: string | null) => fetchFriends(cursor, search), [search]);
  const list = useCursorList(fetchPage, `${search}|${revision}`);

  // "Online" narrows what's already loaded — presence is a live signal from the
  // room, not something the paginated endpoint knows about
  const visible = view === 'online' ? list.items.filter((entry) => onlineUserIds.has(entry.user.id)) : list.items;
  const isEmptyAccount = list.status === 'ready' && list.items.length === 0 && !search;

  async function runAction(action: () => Promise<unknown>) {
    setActionError(null);
    try {
      await action();
      bump();
    } catch {
      setActionError('Não foi possível concluir a ação. Tente de novo.');
    }
  }

  function handleMessage(user: SocialUser) {
    openDirect(user.id);
    requestChatView();
    navigate(ROUTES.conversations);
  }

  async function handleCopyUsername() {
    try {
      await navigator.clipboard.writeText(`@${state.me.name}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — nothing useful to show */ }
  }

  const countText = list.status !== 'ready'
    ? undefined
    : search
      ? `${list.items.length}${list.hasMore ? '+' : ''} resultado${list.items.length === 1 ? '' : 's'}`
      : `${list.items.length}${list.hasMore ? '+' : ''} amigo${list.items.length === 1 ? '' : 's'}`;

  return (
    <div className="flex flex-col gap-4">
      {!isEmptyAccount && (
        <div className="relative">
          <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Buscar nos seus amigos"
            aria-label="Buscar nos seus amigos"
            className="w-full pl-9"
          />
        </div>
      )}

      {actionError && <p role="alert" className="rounded-md bg-red/12 px-2.5 py-1.5 text-label text-red-text">{actionError}</p>}

      {list.status === 'loading' && <p className="py-8 text-center text-label text-text-muted">Carregando amigos…</p>}

      {list.status === 'error' && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-body text-text-muted">Não foi possível carregar seus amigos.</p>
          <Button type="button" variant="secondary" size="sm" onClick={list.retry}>Tentar de novo</Button>
        </div>
      )}

      {isEmptyAccount && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <UserRound size={32} className="text-text-muted" />
          <p className="text-body font-medium text-text-primary">Adicione amigos para começar uma conversa</p>
          <p className="max-w-sm text-label text-text-muted">Peça o @nome de usuário de quem você quer conversar, ou compartilhe o seu.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" size="sm" onClick={() => navigate(friendsView('add'))}><UserPlus size={16} /><span>Adicionar amigo</span></Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => void handleCopyUsername()}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              <span>{copied ? 'Copiado' : `Copiar @${state.me.name}`}</span>
            </Button>
          </div>
        </div>
      )}

      {list.status === 'ready' && !isEmptyAccount && (
        <section aria-labelledby="friends-list-title">
          <ListSectionHeader id="friends-list-title" title={view === 'online' ? 'Online' : 'Todos os amigos'} count={countText} />
          {visible.length === 0 ? (
            <p className="py-8 text-center text-label text-text-muted">
              {search
                ? 'Nenhum resultado para esta busca.'
                : view === 'online' && list.hasMore ? 'Nenhum amigo online entre os carregados.' : view === 'online' ? 'Nenhum amigo online agora.' : 'Nenhum amigo encontrado.'}
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-white/[0.06]">
              {visible.map(({ user }) => (
                <SocialUserRow key={user.id} user={user} online={onlineUserIds.has(user.id)} onOpenProfile={() => onOpenProfile(user.id)}>
                  <Button type="button" variant="secondary" size="sm" onClick={() => handleMessage(user)} aria-label={`Enviar mensagem para ${user.displayName}`}>
                    <MessageCircle size={15} />
                    <span className="hidden sm:inline">Mensagem</span>
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={<Button type="button" variant="ghost" size="icon-sm" aria-label={`Mais ações para ${user.displayName}`} />}
                    >
                      <MoreHorizontal size={16} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-max min-w-0">
                      <DropdownMenuItem onClick={() => onOpenProfile(user.id)}>Ver perfil</DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => setConfirm({ kind: 'remove', userId: user.id, displayName: user.displayName })}>
                        Remover amizade
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => setConfirm({ kind: 'block', userId: user.id, displayName: user.displayName })}>
                        Bloquear
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </SocialUserRow>
              ))}
            </div>
          )}
        </section>
      )}

      {list.hasMore && list.status === 'ready' && (
        <Button type="button" variant="ghost" size="sm" className="self-center" disabled={list.loadingMore} onClick={list.loadMore}>
          {list.loadingMore ? 'Carregando…' : 'Carregar mais'}
        </Button>
      )}

      <SocialConfirmDialog
        target={confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={(target) => void runAction(() => (target.kind === 'remove' ? removeFriend(target.userId) : blockUser(target.userId)))}
      />
    </div>
  );
}
