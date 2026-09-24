import type { ReactNode } from 'react';
import { useRoom } from '@/state/RoomContext';
import { ProfileActions } from './ProfileActions';
import { useRelationship } from './useRelationship';

/** In a direct conversation with someone who isn't a friend (never was, was
 * removed, or is blocked), the composer is replaced by an explanation plus the
 * one action that fixes it — the history above stays fully readable
 * (docs/plano-rede-social.md §5.7). This is presentation only: the server
 * refuses the writes on its own (canSendDirectMessage), so a stale answer here
 * can never let a message through. While the relationship is still loading, or
 * if it failed to load, the composer stays — hiding it on a hiccup would be
 * worse than letting the server say no. */
export function DirectComposerGate({ conversationId, children }: { conversationId: string; children: ReactNode }) {
  const { conversations, allUsers, state } = useRoom();
  const conversation = conversations.find((item) => item.id === conversationId);
  const peerId = conversation?.type === 'direct' ? (conversation.memberIds.find((id) => id !== state.me.userId) ?? null) : null;
  const { state: relationship } = useRelationship(peerId);

  if (!peerId || relationship.status !== 'ready' || relationship.value.relation === 'friends') return <>{children}</>;

  const peer = allUsers.get(peerId);
  const blocked = relationship.value.relation === 'blocked';
  return (
    <div className="mx-3 mb-3 rounded-xl border border-white/10 bg-bg-secondary p-3 md:mx-4 md:mb-4">
      <p className="px-4 pt-1 pb-2 text-label text-text-muted">
        {blocked
          ? 'Você não pode enviar mensagens nem ligar enquanto essa pessoa estiver bloqueada. O histórico continua disponível.'
          : 'Vocês precisam ser amigos para trocar mensagens e fazer chamadas aqui. O histórico continua disponível.'}
      </p>
      {peer && <ProfileActions userId={peer.id} username={peer.username} displayName={peer.displayName} />}
    </div>
  );
}
