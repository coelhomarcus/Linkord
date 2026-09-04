import { useEffect, useMemo, useState } from 'react';
import { Hash, MoreHorizontal, Trash2 } from 'lucide-react';
import { useRoom } from '../../state/RoomContext';
import { ChatMessageList } from './ChatMessageList';
import { ChatComposer } from './ChatComposer';
import { UserDirectory } from './UserDirectory';
import { ConfirmDialog } from '../../shared/ConfirmDialog';
import type { ChatMessage } from '../../types/protocol';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

/** Chat as a full page (Discord-style text channel) — no bubble, no
 * centered column, fills the whole width between the left sidebar and the
 * user directory (right). */
export function ChatPage() {
  const { state, categories, activeChannelId, deleteChannel } = useRoom();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const isMod = state.me.role === 'admin';

  const activeChannel = useMemo(
    () => categories.flatMap((c) => c.channels).find((ch) => ch.id === activeChannelId) ?? null,
    [categories, activeChannelId]
  );

  // switching channels cancels a pending reply — otherwise the "Replying
  // to X" banner (and the replyTo sent on submit) would reference a
  // message from a DIFFERENT channel than the one now being viewed.
  useEffect(() => setReplyingTo(null), [activeChannelId]);

  return (
    <main className="flex min-w-0 flex-1 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-bg-panel text-text-primary">
        <div className="flex flex-none items-center justify-between border-b border-subtle px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Hash size={18} className="flex-none text-text-muted" />
            <h1 className="truncate text-title font-semibold text-text-primary">{activeChannel?.name ?? 'Chat'}</h1>
          </div>
          <div className="flex flex-none items-center gap-1">
            {/* admin-only — deleting the channel removes it and all its
                messages from the database permanently. */}
            {isMod && activeChannel && (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label="Mais opcoes" className="text-text-muted hover:text-text-secondary" />}>
                  <MoreHorizontal size={16} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem variant="destructive" onClick={() => setDeleteConfirmOpen(true)}>
                    <Trash2 size={14} />
                    <span>Apagar</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {activeChannelId && (
          <>
            <ChatMessageList className="px-2 pb-3 pt-2" channelId={activeChannelId} onReply={setReplyingTo} />
            {/* key={activeChannelId}: forces a remount on channel switch —
                otherwise the composer is the SAME instance (only the
                channelId prop changes), so pending text/attachment would
                survive the switch and a late Enter would send to the
                WRONG channel (the one now active, not where it was
                actually typed/attached). */}
            <ChatComposer key={activeChannelId} channelId={activeChannelId} replyingTo={replyingTo} onCancelReply={() => setReplyingTo(null)} />
          </>
        )}

        <ConfirmDialog
          open={deleteConfirmOpen}
          onOpenChange={setDeleteConfirmOpen}
          title="Apagar canal"
          description={`Isso apaga "${activeChannel?.name}" e TODAS as mensagens dele pra sempre. Essa acao nao pode ser desfeita.`}
          confirmLabel="Apagar"
          destructive
          onConfirm={() => { if (activeChannelId) deleteChannel(activeChannelId); }}
        />
      </div>
      <UserDirectory />
    </main>
  );
}
