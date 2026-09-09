import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Copy, Download, FolderPlus, Hash, Pencil, Reply, Settings, Trash2 } from 'lucide-react';
import { ContextMenu, ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { useRoom } from '../state/RoomContext';
import { PromptDialog } from '../shared/PromptDialog';
import { NewChannelDialog } from './ChannelTree';
import { downloadFile } from '../shared/lib/download';
import { ALLOWED_REACTIONS } from '../types/protocol';

interface GlobalContextMenuProps {
  children: ReactNode;
  onOpenSettings: () => void;
}

// text field: let the NATIVE menu show there (paste, spelling suggestions,
// etc.) instead of ours — pasting text anywhere would be impossible otherwise.
function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** Replaces the browser's native context menu with ours everywhere on the
 * site. `className="contents"` on the trigger removes the wrapper div from
 * layout (display: contents) without removing it from the DOM — children
 * stay direct children of the Shell's flex, visually identical to no
 * wrapper at all.
 *
 * There's only ONE ContextMenu in the whole app (not one per region) — its
 * content changes based on WHERE the right-click happened (see
 * `sidebarTarget`), instead of nesting two menus (which would conflict:
 * both triggers listening to the same native `contextmenu` event).
 * Create category/channel for admins is conditional the same way "Copy"
 * already is when there's a text selection. */
export function GlobalContextMenu({ children, onOpenSettings }: GlobalContextMenuProps) {
  const {
    state, categories, createCategory, hideAudioOnlyTiles, setHideAudioOnlyTiles,
    activeChannelId, messagesByChannel, reactToChatMessage, deleteChatMessage, setReplyingTo, setEditingMsgId,
  } = useRoom();
  const [hasSelection, setHasSelection] = useState(false);
  const [sidebarTarget, setSidebarTarget] = useState(false);
  const [stageTarget, setStageTarget] = useState(false);
  const [downloadTarget, setDownloadTarget] = useState<{ url: string; name: string } | null>(null);
  const [messageTarget, setMessageTarget] = useState<number | null>(null);
  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [newChannelOpen, setNewChannelOpen] = useState(false);
  const isAdmin = state.me.role === 'admin';
  // resolved from the active channel's loaded messages, not stored directly
  // in state — right-clicking only ever targets a message that's currently
  // rendered, i.e. already in this list.
  const targetMessage = messageTarget != null
    ? activeChannelId ? messagesByChannel.get(activeChannelId)?.find((m) => m.msgId === messageTarget) : undefined
    : undefined;
  const targetIsMine = !!targetMessage && targetMessage.id === state.me.userId;
  const targetCanDelete = targetIsMine || isAdmin;

  useEffect(() => {
    function captureTarget(e: MouseEvent) {
      // Element, not HTMLElement: an icon button's target can be its inner
      // SVG/path (an SVGElement) when the click lands exactly on the glyph,
      // and SVGElement isn't an HTMLElement — that excluded every icon
      // button (e.g. a video's centered play button) from these checks.
      setSidebarTarget(e.target instanceof Element && !!e.target.closest('[data-sidebar-channels]'));
      setStageTarget(e.target instanceof Element && !!e.target.closest('[data-stage]'));
      const downloadEl = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-download-url]') : null;
      setDownloadTarget(downloadEl ? { url: downloadEl.dataset.downloadUrl!, name: downloadEl.dataset.downloadName || '' } : null);
      const messageEl = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-message-id]') : null;
      setMessageTarget(messageEl ? Number(messageEl.dataset.messageId) : null);
    }
    function blockNative(e: MouseEvent) {
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
    }
    // capture phase, before ContextMenuTrigger (spanning the whole tree via
    // className="contents") sees the event — stops propagation so it never
    // opens our menu on a text field, letting the browser show its own
    // menu (with "Paste") normally. Shift+right-click gets the same
    // escape hatch, everywhere — the universal shortcut for "give me the
    // real browser menu" (inspect element, save image as, etc).
    function stopForNativeMenu(e: MouseEvent) {
      if (isEditableTarget(e.target) || e.shiftKey) e.stopPropagation();
    }
    document.addEventListener('contextmenu', captureTarget, { capture: true });
    document.addEventListener('contextmenu', stopForNativeMenu, { capture: true });
    document.addEventListener('contextmenu', blockNative);
    return () => {
      document.removeEventListener('contextmenu', captureTarget, { capture: true });
      document.removeEventListener('contextmenu', stopForNativeMenu, { capture: true });
      document.removeEventListener('contextmenu', blockNative);
    };
  }, []);

  function handleCopy() {
    const text = window.getSelection()?.toString();
    if (text) navigator.clipboard.writeText(text).catch(() => {});
  }

  function handleDownload() {
    if (downloadTarget) downloadFile(downloadTarget.url, downloadTarget.name);
  }

  function handleCopyMessageText() {
    if (targetMessage?.text) navigator.clipboard.writeText(targetMessage.text).catch(() => {});
  }

  return (
    <>
      <ContextMenu onOpenChange={(open) => { if (open) setHasSelection(!!window.getSelection()?.toString()); }}>
        <ContextMenuTrigger className="contents">{children}</ContextMenuTrigger>
        <ContextMenuContent className="w-64">
          {targetMessage && (
            <>
              <div className="flex items-center justify-between gap-0.5 px-1 py-1">
                {ALLOWED_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => reactToChatMessage(targetMessage.msgId, emoji)}
                    className="rounded-md p-1 text-base leading-none transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <ContextMenuItem onClick={() => setReplyingTo(targetMessage)}>
                <Reply size={14} />
                <span>Responder</span>
              </ContextMenuItem>
              {targetMessage.text && (
                <ContextMenuItem onClick={handleCopyMessageText}>
                  <Copy size={14} />
                  <span>Copiar texto</span>
                </ContextMenuItem>
              )}
              {targetIsMine && (
                <ContextMenuItem onClick={() => setEditingMsgId(targetMessage.msgId)}>
                  <Pencil size={14} />
                  <span>Editar</span>
                </ContextMenuItem>
              )}
              {targetCanDelete && (
                <ContextMenuItem variant="destructive" onClick={() => deleteChatMessage(targetMessage.msgId)}>
                  <Trash2 size={14} />
                  <span>Apagar</span>
                </ContextMenuItem>
              )}
              <ContextMenuSeparator />
            </>
          )}
          {downloadTarget && (
            <>
              <ContextMenuItem onClick={handleDownload}>
                <Download size={14} />
                <span>Baixar</span>
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          {hasSelection && (
            <>
              <ContextMenuItem onClick={handleCopy}>
                <Copy size={14} />
                <span>Copiar</span>
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          {isAdmin && sidebarTarget && (
            <>
              <ContextMenuItem onClick={() => setNewCategoryOpen(true)}>
                <FolderPlus size={14} />
                <span>Nova categoria</span>
              </ContextMenuItem>
              {categories.length > 0 && (
                <ContextMenuItem onClick={() => setNewChannelOpen(true)}>
                  <Hash size={14} />
                  <span>Novo canal</span>
                </ContextMenuItem>
              )}
              <ContextMenuSeparator />
            </>
          )}
          {stageTarget && (
            <>
              <ContextMenuCheckboxItem
                checked={hideAudioOnlyTiles}
                onCheckedChange={setHideAudioOnlyTiles}
              >
                <span>Ocultar sem video</span>
              </ContextMenuCheckboxItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem onClick={onOpenSettings}>
            <Settings size={14} />
            <span>Abrir Ajustes</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <PromptDialog
        open={newCategoryOpen}
        onOpenChange={setNewCategoryOpen}
        title="Nova categoria"
        label="Nome da categoria"
        placeholder="Ex: Anúncios"
        confirmLabel="Criar"
        onConfirm={createCategory}
      />
      <NewChannelDialog open={newChannelOpen} onOpenChange={setNewChannelOpen} />
    </>
  );
}
