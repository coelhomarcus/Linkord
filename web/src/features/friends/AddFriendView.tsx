import { useState } from 'react';
import { Link } from 'react-router';
import { Check, Copy } from 'lucide-react';
import { useRoom } from '@/state/RoomContext';
import { Button } from '@/shared/ui/primitives/button';
import { friendsSection } from '@/shared/lib/routes';
import { AddFriendForm } from './AddFriendForm';
import { useFriends } from './FriendsContext';
import { ListSectionHeader } from './ListSectionHeader';

/** Add by exact @username, plus your own username to share. Discovery is never a
 * catalog: nothing here lists accounts. */
export function AddFriendView() {
  const { state } = useRoom();
  const { bump, pendingFriendRequestCount } = useFriends();
  const [copied, setCopied] = useState(false);

  async function handleCopyUsername() {
    try {
      await navigator.clipboard.writeText(`@${state.me.name}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — nothing useful to show */ }
  }

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="add-title">
        <ListSectionHeader id="add-title" title="Adicionar amigo" />
        <div className="pt-3"><AddFriendForm onSent={bump} autoFocus /></div>
      </section>
      <section aria-labelledby="share-title">
        <ListSectionHeader id="share-title" title="Seu nome de usuário" />
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
          <p className="break-all text-body text-text-primary">@{state.me.name}</p>
          <Button type="button" variant="secondary" size="sm" onClick={() => void handleCopyUsername()}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
            <span>{copied ? 'Copiado' : `Copiar @${state.me.name}`}</span>
          </Button>
        </div>
        {pendingFriendRequestCount > 0 && (
          <p className="pt-3 text-label text-text-muted">
            Você tem {pendingFriendRequestCount} solicitaç{pendingFriendRequestCount === 1 ? 'ão' : 'ões'} aguardando resposta.{' '}
            <Link to={friendsSection('received')} className="underline underline-offset-2">Ver solicitações recebidas</Link>
          </p>
        )}
      </section>
    </div>
  );
}
