import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { ArrowLeft, Hash, MoreHorizontal, Search, Trash2, Upload, Users } from 'lucide-react';
import { useRoom } from '../../state/RoomContext';
import { ChatMessageList } from './ChatMessageList';
import { ChatComposer } from './ChatComposer';
import { ChatSearchDialog } from './ChatSearchDialog';
import { UserDirectory } from './UserDirectory';
import { ConfirmDialog } from '../../shared/ConfirmDialog';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_MESSAGE } from '../../types/protocol';
import { formatSizeLimit } from '../../shared/lib/formatBytes';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

interface ChatPageProps {
  /** Below md, shows a back button that returns to the channel list —
   * there's no room for sidebar + chat side by side (see Shell in
   * App.tsx). Irrelevant from md up, where the sidebar is always visible. */
  onBackMobile: () => void;
  onOpenProfile: (userId: string) => void;
}

/** A file attached but not sent yet — lives here (not ChatComposer) so a
 * drop anywhere on the chat screen (not just the composer box) can add to
 * it. `id` is a stable key independent of the File object (the same file
 * could be picked twice), `previewUrl` is eagerly created for images. */
export interface PendingAttachment {
  id: string;
  file: File;
  previewUrl: string | null;
}

/** Chat as a full page (Discord-style text channel) — no bubble, no
 * centered column, fills the whole width between the left sidebar and the
 * user directory (right). */
export function ChatPage({ onBackMobile, onOpenProfile }: ChatPageProps) {
  const { state, categories, activeChannelId, deleteChannel, replyingTo, setReplyingTo } = useRoom();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // below md, the member list has nowhere to sit beside the chat — becomes
  // an overlay toggled from the header instead (see UserDirectory's
  // mobileOpen prop).
  const [membersOpen, setMembersOpen] = useState(false);
  const isMod = state.me.role === 'admin';

  // files attached but not sent yet — lives here (not ChatComposer) so
  // dropping anywhere on the chat screen works, not just the composer box.
  const [pendingFiles, setPendingFiles] = useState<PendingAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  // dragenter/dragleave fire for EVERY child element as the mouse crosses
  // the tree (entering a child = leaving the parent, leaving the child =
  // entering the parent again) — without a counter, isDragOver would
  // flicker every time the drag passed over anything inside the page.
  const dragCounterRef = useRef(0);

  const activeChannel = useMemo(
    () => categories.flatMap((c) => c.channels).find((ch) => ch.id === activeChannelId) ?? null,
    [categories, activeChannelId]
  );

  // switching channels cancels any pending attachments — otherwise they'd
  // send to a DIFFERENT channel than the one now being viewed. (A pending
  // reply is reset the same way, but that lives in RoomProvider now — see
  // openChannel — since GlobalContextMenu needs to reach it too.)
  useEffect(() => {
    setPendingFiles((prev) => {
      prev.forEach((p) => { if (p.previewUrl) URL.revokeObjectURL(p.previewUrl); });
      return [];
    });
    setAttachError(null);
  }, [activeChannelId]);

  // shared by the file-picker/paste (ChatComposer) and drag-and-drop
  // (below) — same validation/cap regardless of how files got picked.
  function addFiles(files: File[]) {
    if (!files.length) return;
    const remainingSlots = MAX_ATTACHMENTS_PER_MESSAGE - pendingFiles.length;
    const accepted: PendingAttachment[] = [];
    let error: string | null = null;
    for (const file of files) {
      if (accepted.length >= remainingSlots) { error = `Máximo de ${MAX_ATTACHMENTS_PER_MESSAGE} anexos por mensagem.`; break; }
      if (file.size > MAX_ATTACHMENT_BYTES) { error = `"${file.name}" é grande demais (máximo ${formatSizeLimit(MAX_ATTACHMENT_BYTES)}).`; continue; }
      accepted.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      });
    }
    if (accepted.length) setPendingFiles((prev) => [...prev, ...accepted]);
    setAttachError(error);
  }

  function removeFile(id: string) {
    setPendingFiles((prev) => {
      const found = prev.find((p) => p.id === id);
      if (found?.previewUrl) URL.revokeObjectURL(found.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }

  function clearFiles() {
    setPendingFiles((prev) => {
      prev.forEach((p) => { if (p.previewUrl) URL.revokeObjectURL(p.previewUrl); });
      return [];
    });
    setAttachError(null);
  }

  // dragging a file from the OS onto the chat screen (message list, header,
  // composer — anywhere in this column) attaches it, same path as the
  // clip button/paste. Not gated on an in-flight send (unlike the old
  // composer-only version) — the 4-attachment cap and per-card upload lock
  // already prevent misuse.
  function handleDragEnter(e: DragEvent<HTMLDivElement>) {
    if (!state.joined || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    setIsDragOver(true);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (!state.joined || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault(); // without this the browser refuses the drop (opens the file in the tab instead)
  }

  function handleDragLeave(_e: DragEvent<HTMLDivElement>) {
    if (!state.joined) return;
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragOver(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    if (!state.joined) return;
    addFiles(Array.from(e.dataTransfer.files));
  }

  return (
    <main className="flex min-w-0 flex-1 overflow-hidden">
      <div
        className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-bg-panel text-text-primary"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragOver && (
          <div className="pointer-events-none absolute inset-3 z-20 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-blurple bg-bg-panel/90">
            <Upload size={32} className="text-blurple" />
            <p className="select-none text-label font-medium text-text-primary">Solte pra enviar</p>
          </div>
        )}
        <div className="flex flex-none items-center justify-between border-b border-subtle px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Voltar pros canais" onClick={onBackMobile} className="-ml-1 flex-none text-text-muted hover:text-text-secondary md:hidden">
              <ArrowLeft size={18} />
            </Button>
            <Hash size={18} className="flex-none text-text-muted" />
            <h1 className="truncate text-title font-semibold text-text-primary">{activeChannel?.name ?? 'Chat'}</h1>
          </div>
          <div className="flex flex-none items-center gap-1">
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Buscar mensagens" onClick={() => setSearchOpen(true)} className="text-text-muted hover:text-text-secondary">
              <Search size={16} />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Membros" onClick={() => setMembersOpen(true)} className="text-text-muted hover:text-text-secondary md:hidden">
              <Users size={16} />
            </Button>
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
            <ChatMessageList className="px-2 pb-3 pt-2" channelId={activeChannelId} onReply={setReplyingTo} onOpenProfile={onOpenProfile} />
            {/* key={activeChannelId}: forces a remount on channel switch —
                otherwise the composer is the SAME instance (only the
                channelId prop changes), so pending text would survive the
                switch and a late Enter would send to the WRONG channel
                (the one now active, not where it was actually typed).
                pendingFiles/attachError live up here instead (see above),
                cleared by the effect on activeChannelId. */}
            <ChatComposer
              key={activeChannelId}
              channelId={activeChannelId}
              replyingTo={replyingTo}
              onCancelReply={() => setReplyingTo(null)}
              pendingFiles={pendingFiles}
              onAddFiles={addFiles}
              onRemoveFile={removeFile}
              onClearFiles={clearFiles}
              attachError={attachError}
              onAttachError={setAttachError}
            />
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
        <ChatSearchDialog
          open={searchOpen}
          onOpenChange={setSearchOpen}
          activeChannelId={activeChannelId}
          activeChannelName={activeChannel?.name ?? null}
        />
      </div>
      <UserDirectory mobileOpen={membersOpen} onMobileClose={() => setMembersOpen(false)} onOpenProfile={onOpenProfile} />
    </main>
  );
}
