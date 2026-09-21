import { useCallback, useState } from 'react';
import { Button } from '@/shared/ui/primitives/button';
import { fetchBlocks, unblockUser } from '@/shared/api/api';
import { SocialUserRow } from '@/features/friends/SocialUserRow';
import { useFriends } from '@/features/friends/FriendsContext';
import { useCursorList } from '@/features/friends/useCursorList';
import { usePendingIds } from '@/features/friends/usePendingIds';
import { ActionFeedback } from '@/features/friends/ActionFeedback';
import type { Feedback } from '@/features/friends/ActionFeedback';
import { LoadMoreFooter } from '@/features/friends/LoadMoreFooter';
import type { SocialEntry } from '@/shared/api/api';
import { SettingsSection, SettingsSections } from './SettingsLayout';

const blockedKey = (entry: SocialEntry) => entry.user.id;

/** Blocked accounts. Only YOUR blocks are listed — who blocked you is never
 * exposed anywhere. */
export function PrivacyTab({ onOpenProfile }: { onOpenProfile: (userId: string) => void }) {
  const { revision, bump } = useFriends();
  const pending = usePendingIds();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const clearFeedback = useCallback(() => setFeedback(null), []);
  const fetchPage = useCallback((cursor: string | null) => fetchBlocks(cursor), []);
  const list = useCursorList(fetchPage, 'blocked', { revision, getKey: blockedKey });

  async function handleUnblock(userId: string) {
    setFeedback(null);
    const outcome = await pending.run(userId, () => unblockUser(userId));
    if (!outcome) return;
    if (!outcome.ok) {
      // the person stays listed and the action can be tried again
      setFeedback({ tone: 'error', text: 'Não foi possível desbloquear. Tente de novo.' });
      return;
    }
    list.removeItem(userId);
    bump();
  }

  return (
    <SettingsSections>
    <SettingsSection
      id="blocked"
      title="Pessoas bloqueadas"
      description="Quem você bloqueia não consegue te enviar mensagens nem te ligar em conversa privada. Desbloquear não devolve a amizade — vocês precisam se adicionar de novo."
    >
      <ActionFeedback feedback={feedback} onClear={clearFeedback} />
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

      <div className="flex flex-col divide-y divide-white/10">
        {list.items.map(({ user }) => (
          <SocialUserRow key={user.id} user={user} onOpenProfile={() => onOpenProfile(user.id)}>
            <Button type="button" variant="secondary" size="sm" disabled={pending.isPending(user.id)} onClick={() => void handleUnblock(user.id)}>
              Desbloquear
            </Button>
          </SocialUserRow>
        ))}
      </div>

      {list.status === 'ready' && <LoadMoreFooter list={list} />}
    </SettingsSection>
    </SettingsSections>
  );
}
