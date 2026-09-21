import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Ban, Loader2, MessageCircle, MoreHorizontal, Pencil, UserCheck, UserPlus } from 'lucide-react';
import { useRoom } from '@/state/RoomContext';
import {
  acceptFriendRequest, blockUser, cancelFriendRequest, declineFriendRequest, removeFriend, sendFriendRequest, unblockUser,
} from '@/shared/api/api';
import { Button } from '@/shared/ui/primitives/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/primitives/dropdown-menu';
import { ROUTES } from '@/shared/lib/routes';
import { describeSendError, formatRetryAfter } from './friendsText';
import { SocialConfirmDialog } from './SocialConfirmDialog';
import type { SocialConfirm } from './SocialConfirmDialog';
import { useFriends } from './FriendsContext';
import { useRelationship } from './useRelationship';

/** The social actions on someone's profile — what's offered depends only on
 * the viewer's relation to them (docs/plano-rede-social.md §5.4). Composed
 * next to ProfileCard rather than inside it, so a card drawn elsewhere (the
 * settings preview) never grows relationship rules. */
export function ProfileActions({ userId, username, displayName, onNavigate }: {
  userId: string;
  username: string;
  displayName: string;
  /** called when an action moves the user to another page, so the modal can close */
  onNavigate?: () => void;
}) {
  const { openDirect, requestChatView } = useRoom();
  const { bump } = useFriends();
  const navigate = useNavigate();
  const { state, retry } = useRelationship(userId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<SocialConfirm | null>(null);

  async function run(action: () => Promise<unknown>, failure = 'Não foi possível concluir a ação. Tente de novo.') {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await action();
      bump();
    } catch (err) {
      setError(failure === 'send' ? describeSendError(err) : failure);
    } finally {
      setPending(false);
    }
  }

  if (state.status === 'loading') {
    return <p className="px-4 pb-4 text-label text-text-muted" aria-live="polite">Carregando…</p>;
  }
  if (state.status === 'error') {
    return (
      <div className="flex items-center gap-2 px-4 pb-4 text-label text-text-muted">
        <span>Não foi possível carregar as ações.</span>
        <Button type="button" variant="ghost" size="sm" onClick={retry}>Tentar de novo</Button>
      </div>
    );
  }

  const { relation, retryAfter } = state.value;
  const spinner = pending ? <Loader2 size={15} className="animate-spin" /> : null;

  let actions;
  switch (relation) {
    case 'self':
      actions = (
        <Button type="button" variant="secondary" size="sm" onClick={() => { navigate(ROUTES.settings); onNavigate?.(); }}>
          <Pencil size={15} /><span>Editar perfil</span>
        </Button>
      );
      break;
    case 'friends':
      actions = (
        <>
          <Button type="button" size="sm" onClick={() => { openDirect(userId); requestChatView(); navigate(ROUTES.conversations); onNavigate?.(); }}>
            <MessageCircle size={15} /><span>Mensagem</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label="Mais ações" />}>
              <MoreHorizontal size={16} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-max min-w-0">
              <DropdownMenuItem variant="destructive" onClick={() => setConfirm({ kind: 'remove', userId, displayName })}>Remover amizade</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => setConfirm({ kind: 'block', userId, displayName })}>Bloquear</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      );
      break;
    case 'outgoing':
      actions = (
        <>
          <span className="flex items-center gap-1.5 text-label text-text-muted"><UserCheck size={15} />Solicitação enviada</span>
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => void run(() => cancelFriendRequest(userId))}>{spinner}<span>Cancelar</span></Button>
        </>
      );
      break;
    case 'incoming':
      actions = (
        <>
          <Button type="button" size="sm" disabled={pending} onClick={() => void run(() => acceptFriendRequest(userId))}>{spinner}<span>Aceitar</span></Button>
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => void run(() => declineFriendRequest(userId))}><span>Recusar</span></Button>
        </>
      );
      break;
    case 'blocked':
      actions = (
        <>
          <span className="flex items-center gap-1.5 text-label text-text-muted"><Ban size={15} />Você bloqueou essa pessoa</span>
          <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => void run(() => unblockUser(userId))}>{spinner}<span>Desbloquear</span></Button>
        </>
      );
      break;
    default:
      actions = retryAfter ? (
        <span className="text-label text-text-muted">Você poderá enviar uma nova solicitação a partir de {formatRetryAfter(retryAfter)}.</span>
      ) : (
        <Button type="button" size="sm" disabled={pending} onClick={() => void run(() => sendFriendRequest(username), 'send')}>
          {spinner ?? <UserPlus size={15} />}<span>Adicionar amigo</span>
        </Button>
      );
  }

  return (
    <div className="flex flex-col gap-2 px-4 pb-4">
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
      {error && <p role="alert" className="text-label text-red">{error}</p>}
      <SocialConfirmDialog
        target={confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={(target) => void run(() => (target.kind === 'remove' ? removeFriend(target.userId) : blockUser(target.userId)))}
      />
    </div>
  );
}
