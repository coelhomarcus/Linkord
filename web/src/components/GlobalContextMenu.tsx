import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ContextMenuRootActions } from '@base-ui/react/context-menu';
import { Copy, Download, Pencil, Reply, Trash2 } from 'lucide-react';
import { ContextMenu, ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { EmojiPicker, EmojiPickerContent, EmojiPickerSearch } from '@/components/ui/emoji-picker';
import { useRoom } from '../state/RoomContext';
import { downloadFile } from '../shared/lib/download';

interface GlobalContextMenuProps {
  children: ReactNode;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function GlobalContextMenu({ children }: GlobalContextMenuProps) {
  const {
    state, hideAudioOnlyTiles, setHideAudioOnlyTiles,
    activeConversationId, messagesByConversation, reactToChatMessage, deleteChatMessage, setReplyingTo, setEditingMsgId,
  } = useRoom();
  const [hasSelection, setHasSelection] = useState(false);
  const [stageTarget, setStageTarget] = useState(false);
  const [downloadTarget, setDownloadTarget] = useState<{ url: string; name: string } | null>(null);
  const [messageTarget, setMessageTarget] = useState<number | null>(null);
  const contextMenuActionsRef = useRef<ContextMenuRootActions | null>(null);
  const isAdmin = state.me.role === 'admin';
  const targetMessage = messageTarget != null
    ? activeConversationId ? messagesByConversation.get(activeConversationId)?.find((m) => m.msgId === messageTarget) : undefined
    : undefined;
  const targetIsMine = !!targetMessage && targetMessage.id === state.me.userId;
  const targetCanDelete = targetIsMine || isAdmin;

  const showMessageBlock = !!targetMessage;
  const showDownloadBlock = !!downloadTarget;
  const showSelectionBlock = hasSelection;
  const showStageBlock = stageTarget;

  useEffect(() => {
    function captureTarget(e: MouseEvent) {
      const element = e.target instanceof Element ? e.target : null;
      const wantsNativeMenu = isEditableTarget(e.target) || e.shiftKey;
      const nextStageTarget = !!element?.closest('[data-stage]');
      const downloadEl = element?.closest<HTMLElement>('[data-download-url]') ?? null;
      const messageEl = element?.closest<HTMLElement>('[data-message-id]') ?? null;
      const nextMessageTarget = messageEl ? Number(messageEl.dataset.messageId) : null;
      const nextHasSelection = !wantsNativeMenu && !!window.getSelection()?.toString();

      setStageTarget(nextStageTarget);
      setDownloadTarget(downloadEl ? { url: downloadEl.dataset.downloadUrl!, name: downloadEl.dataset.downloadName || '' } : null);
      setMessageTarget(nextMessageTarget);
      setHasSelection(nextHasSelection);

      if (wantsNativeMenu) return;

      const nextHasMessageBlock = nextMessageTarget != null && !!activeConversationId
        && !!messagesByConversation.get(activeConversationId)?.some((m) => m.msgId === nextMessageTarget);
      const hasVisibleItems = nextHasMessageBlock
        || !!downloadEl
        || nextHasSelection
        || nextStageTarget;

      if (!hasVisibleItems) {
        contextMenuActionsRef.current?.close();
        e.preventDefault();
        e.stopPropagation();
      }
    }
    function blockNative(e: MouseEvent) {
      if (isEditableTarget(e.target) || e.shiftKey) return;
      e.preventDefault();
    }
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
  }, [activeConversationId, messagesByConversation]);

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
    <ContextMenu
      actionsRef={contextMenuActionsRef}
      onOpenChange={(open) => { if (open) setHasSelection(!!window.getSelection()?.toString()); }}
    >
      <ContextMenuTrigger className="contents">{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-75">
        {showMessageBlock && targetMessage && (
          <>
            <EmojiPicker className="h-80 w-full" onEmojiSelect={({ emoji }) => reactToChatMessage(targetMessage.msgId, emoji)}>
              <EmojiPickerSearch />
              <EmojiPickerContent />
            </EmojiPicker>
            <ContextMenuSeparator />
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
            {(showDownloadBlock || showSelectionBlock || showStageBlock) && <ContextMenuSeparator />}
          </>
        )}
        {showDownloadBlock && (
          <>
            <ContextMenuItem onClick={handleDownload}>
              <Download size={14} />
              <span>Baixar</span>
            </ContextMenuItem>
            {(showSelectionBlock || showStageBlock) && <ContextMenuSeparator />}
          </>
        )}
        {showSelectionBlock && (
          <>
            <ContextMenuItem onClick={handleCopy}>
              <Copy size={14} />
              <span>Copiar</span>
            </ContextMenuItem>
            {showStageBlock && <ContextMenuSeparator />}
          </>
        )}
        {showStageBlock && (
          <ContextMenuCheckboxItem
            checked={hideAudioOnlyTiles}
            onCheckedChange={setHideAudioOnlyTiles}
          >
            <span>Ocultar sem video</span>
          </ContextMenuCheckboxItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
