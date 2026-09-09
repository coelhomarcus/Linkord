import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useRoom } from '../../state/RoomContext';
import { Avatar } from '../../shared/Avatar';
import { formatTime } from '../../shared/lib/formatChatTime';
import { renderSearchSnippet } from '../../shared/lib/searchSnippet';
import type { SearchResult } from '../../types/protocol';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

const DEBOUNCE_MS = 300;

interface ChatSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeChannelId: string | null;
  activeChannelName: string | null;
}

/** Same live-profile-over-snapshot resolution ChatMessageRow already does
 * (see ChatMessageList.tsx) — a search result's name/avatar are whatever
 * they were when the message was sent, allUsers has the current value. */
function SearchResultRow({ result, showChannel, onSelect }: { result: SearchResult; showChannel: boolean; onSelect: () => void }) {
  const { allUsers } = useRoom();
  const author = result.id ? allUsers.get(result.id) : undefined;
  const displayedName = author?.displayName ?? result.name;
  const displayedAvatar = author?.avatar ?? result.avatar;
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-start gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <div className="mt-0.5 flex-none">
        <Avatar id={result.id ?? result.name} name={displayedName} avatar={displayedAvatar} avatarColor={author?.avatarColor} size={32} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-label font-medium text-text-primary">{displayedName}</span>
          {showChannel && (
            <span className="flex-none truncate rounded-sm bg-bg-tertiary px-1.5 py-0.5 text-caption text-text-muted">#{result.channelName}</span>
          )}
          <span className="flex-none text-caption text-text-muted">{formatTime(result.ts)}</span>
        </div>
        <p className="truncate text-body text-text-secondary">{renderSearchSnippet(result.snippet)}</p>
      </div>
    </button>
  );
}

/** Search dialog reachable from the channel header (see ChatPage.tsx) —
 * defaults to the currently open channel, with a toggle to broaden to every
 * channel (safe: this app has no per-channel access control, everyone
 * already sees every channel). Clicking a result calls jumpToMessage
 * (RoomProvider.tsx), which loads a fresh window of history centered on it
 * and scrolls there (see ChatMessageList.tsx's pendingJumpTarget effect). */
export function ChatSearchDialog({ open, onOpenChange, activeChannelId, activeChannelName }: ChatSearchDialogProps) {
  const { searchResults, searchLoading, searchError, clearSearchError, searchMessages, jumpToMessage } = useRoom();
  const [query, setQuery] = useState('');
  const [scopeAll, setScopeAll] = useState(false);
  const debounceRef = useRef<number | null>(null);

  // fresh state every time the dialog opens — always starts scoped to the
  // current channel, never carries a stale query/scope from last time.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setScopeAll(false);
    clearSearchError();
  }, [open, clearSearchError]);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      searchMessages(query, scopeAll ? undefined : (activeChannelId ?? undefined));
    }, DEBOUNCE_MS);
    return () => { if (debounceRef.current != null) window.clearTimeout(debounceRef.current); };
  }, [open, query, scopeAll, activeChannelId, searchMessages]);

  function handleSelect(result: SearchResult) {
    jumpToMessage(result.channelId, result.msgId);
    onOpenChange(false);
  }

  const trimmed = query.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* same max-h-[90vh] outer / overflow-y-auto inner split as
          SettingsModal/ProfileModal/ImageCropDialog. */}
      <DialogContent className="max-h-[90vh] max-w-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden bg-bg-modal p-0 sm:max-w-2xl">
        <DialogHeader className="px-4 pt-4 pr-12">
          <DialogTitle className="text-title font-bold text-text-primary">Buscar mensagens</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 pb-4 pt-3">
          <div className="relative flex-none">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            {/* eslint-disable-next-line jsx-a11y/no-autofocus -- opening the
                dialog IS the user asking to type a search query */}
            <Input
              autoFocus
              placeholder="Buscar mensagens..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="flex flex-none items-center justify-between gap-3">
            <span className="min-w-0 truncate text-label text-text-muted">
              {scopeAll ? 'Buscando em todos os canais' : `Buscando em #${activeChannelName ?? 'canal'}`}
            </span>
            <div className="flex flex-none items-center gap-2">
              <Label htmlFor="searchScopeAll" className="text-label text-text-secondary">Todos os canais</Label>
              <Switch id="searchScopeAll" checked={scopeAll} onCheckedChange={setScopeAll} aria-label="Buscar em todos os canais" />
            </div>
          </div>

          {searchError && <p className="flex-none text-label text-red">{searchError}</p>}

          <div className="flex min-h-0 flex-1 flex-col gap-1">
            {searchLoading && (
              <p className="select-none px-1 py-4 text-center text-label text-text-muted">Buscando…</p>
            )}
            {!searchLoading && trimmed && searchResults.length === 0 && (
              <p className="select-none px-1 py-4 text-center text-label text-text-muted">Nenhuma mensagem encontrada.</p>
            )}
            {!searchLoading && searchResults.map((result) => (
              <SearchResultRow key={result.msgId} result={result} showChannel={scopeAll} onSelect={() => handleSelect(result)} />
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
