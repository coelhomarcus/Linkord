import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ContextMenuRootActions } from '@base-ui/react/context-menu';
import { Copy, Download, FolderPlus, Hash, Pencil, Reply, Trash2 } from 'lucide-react';
import { ContextMenu, ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { useRoom } from '../state/RoomContext';
import { PromptDialog } from '../shared/PromptDialog';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { NewChannelDialog } from './ChannelTree';
import { downloadFile } from '../shared/lib/download';
import { ALLOWED_REACTIONS } from '../types/protocol';

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
    state, categories, createCategory, renameCategory, deleteCategory, renameChannel, deleteChannel,
    hideAudioOnlyTiles, setHideAudioOnlyTiles,
    activeChannelId, messagesByChannel, reactToChatMessage, deleteChatMessage, setReplyingTo, setEditingMsgId,
  } = useRoom();
  const [hasSelection, setHasSelection] = useState(false);
  const [sidebarTarget, setSidebarTarget] = useState(false);
  const [stageTarget, setStageTarget] = useState(false);
  const [downloadTarget, setDownloadTarget] = useState<{ url: string; name: string } | null>(null);
  const [messageTarget, setMessageTarget] = useState<number | null>(null);
  const [channelTarget, setChannelTarget] = useState<string | null>(null);
  const [categoryTarget, setCategoryTarget] = useState<string | null>(null);
  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [newChannelOpen, setNewChannelOpen] = useState(false);
  const [renameChannelOpen, setRenameChannelOpen] = useState(false);
  const [deleteChannelOpen, setDeleteChannelOpen] = useState(false);
  const [renameCategoryOpen, setRenameCategoryOpen] = useState(false);
  const [deleteCategoryOpen, setDeleteCategoryOpen] = useState(false);
  const contextMenuActionsRef = useRef<ContextMenuRootActions | null>(null);
  const isAdmin = state.me.role === 'admin';
  const targetMessage = messageTarget != null
    ? activeChannelId ? messagesByChannel.get(activeChannelId)?.find((m) => m.msgId === messageTarget) : undefined
    : undefined;
  const targetIsMine = !!targetMessage && targetMessage.id === state.me.userId;
  const targetCanDelete = targetIsMine || isAdmin;
  const targetChannel = channelTarget != null
    ? categories.flatMap((c) => c.channels).find((ch) => ch.id === channelTarget)
    : undefined;
  const targetCategory = categoryTarget != null ? categories.find((c) => c.id === categoryTarget) : undefined;

  const showMessageBlock = !!targetMessage;
  const showDownloadBlock = !!downloadTarget;
  const showSelectionBlock = hasSelection;
  const showChannelBlock = isAdmin && !!targetChannel;
  const showCategoryBlock = isAdmin && !!targetCategory;
  const showSidebarCreateBlock = isAdmin && sidebarTarget && !targetChannel && !targetCategory;
  const showStageBlock = stageTarget;

  useEffect(() => {
    function captureTarget(e: MouseEvent) {
      const element = e.target instanceof Element ? e.target : null;
      const wantsNativeMenu = isEditableTarget(e.target) || e.shiftKey;
      const nextSidebarTarget = !!element?.closest('[data-sidebar-channels]');
      const nextStageTarget = !!element?.closest('[data-stage]');
      const downloadEl = element?.closest<HTMLElement>('[data-download-url]') ?? null;
      const messageEl = element?.closest<HTMLElement>('[data-message-id]') ?? null;
      const nextMessageTarget = messageEl ? Number(messageEl.dataset.messageId) : null;
      const channelEl = element?.closest<HTMLElement>('[data-channel-id]') ?? null;
      const nextChannelTarget = channelEl?.dataset.channelId ?? null;
      const categoryEl = element?.closest<HTMLElement>('[data-category-id]') ?? null;
      const nextCategoryTarget = categoryEl?.dataset.categoryId ?? null;
      const nextHasSelection = !wantsNativeMenu && !!window.getSelection()?.toString();

      setSidebarTarget(nextSidebarTarget);
      setStageTarget(nextStageTarget);
      setDownloadTarget(downloadEl ? { url: downloadEl.dataset.downloadUrl!, name: downloadEl.dataset.downloadName || '' } : null);
      setMessageTarget(nextMessageTarget);
      setChannelTarget(nextChannelTarget);
      setCategoryTarget(nextCategoryTarget);
      setHasSelection(nextHasSelection);

      if (wantsNativeMenu) return;

      const nextHasMessageBlock = nextMessageTarget != null && !!activeChannelId
        && !!messagesByChannel.get(activeChannelId)?.some((m) => m.msgId === nextMessageTarget);
      const nextHasChannelBlock = isAdmin && nextChannelTarget != null
        && categories.some((c) => c.channels.some((ch) => ch.id === nextChannelTarget));
      const nextHasCategoryBlock = isAdmin && nextCategoryTarget != null
        && categories.some((c) => c.id === nextCategoryTarget);
      const nextHasSidebarCreateBlock = isAdmin && nextSidebarTarget && !nextHasChannelBlock && !nextHasCategoryBlock;
      const hasVisibleItems = nextHasMessageBlock
        || !!downloadEl
        || nextHasSelection
        || nextHasChannelBlock
        || nextHasCategoryBlock
        || nextHasSidebarCreateBlock
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
  }, [activeChannelId, categories, isAdmin, messagesByChannel]);

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
      <ContextMenu
        actionsRef={contextMenuActionsRef}
        onOpenChange={(open) => { if (open) setHasSelection(!!window.getSelection()?.toString()); }}
      >
        <ContextMenuTrigger className="contents">{children}</ContextMenuTrigger>
        <ContextMenuContent className="w-64">
          {showMessageBlock && targetMessage && (
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
              {(showDownloadBlock || showSelectionBlock || showChannelBlock || showCategoryBlock || showSidebarCreateBlock || showStageBlock) && <ContextMenuSeparator />}
            </>
          )}
          {showDownloadBlock && (
            <>
              <ContextMenuItem onClick={handleDownload}>
                <Download size={14} />
                <span>Baixar</span>
              </ContextMenuItem>
              {(showSelectionBlock || showChannelBlock || showCategoryBlock || showSidebarCreateBlock || showStageBlock) && <ContextMenuSeparator />}
            </>
          )}
          {showSelectionBlock && (
            <>
              <ContextMenuItem onClick={handleCopy}>
                <Copy size={14} />
                <span>Copiar</span>
              </ContextMenuItem>
              {(showChannelBlock || showCategoryBlock || showSidebarCreateBlock || showStageBlock) && <ContextMenuSeparator />}
            </>
          )}
          {showChannelBlock && targetChannel && (
            <>
              <ContextMenuItem onClick={() => setRenameChannelOpen(true)}>
                <Pencil size={14} />
                <span>Renomear canal</span>
              </ContextMenuItem>
              <ContextMenuItem variant="destructive" onClick={() => setDeleteChannelOpen(true)}>
                <Trash2 size={14} />
                <span>Apagar canal</span>
              </ContextMenuItem>
              {(showCategoryBlock || showSidebarCreateBlock || showStageBlock) && <ContextMenuSeparator />}
            </>
          )}
          {showCategoryBlock && (
            <>
              <ContextMenuItem onClick={() => setNewChannelOpen(true)}>
                <Hash size={14} />
                <span>Novo canal</span>
              </ContextMenuItem>
              <ContextMenuItem onClick={() => setRenameCategoryOpen(true)}>
                <Pencil size={14} />
                <span>Renomear categoria</span>
              </ContextMenuItem>
              <ContextMenuItem variant="destructive" onClick={() => setDeleteCategoryOpen(true)}>
                <Trash2 size={14} />
                <span>Apagar categoria</span>
              </ContextMenuItem>
              {(showSidebarCreateBlock || showStageBlock) && <ContextMenuSeparator />}
            </>
          )}
          {showSidebarCreateBlock && (
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
      {targetChannel && (
        <>
          <PromptDialog
            open={renameChannelOpen}
            onOpenChange={setRenameChannelOpen}
            title="Renomear canal"
            label="Nome do canal"
            confirmLabel="Salvar"
            initialValue={targetChannel.name}
            onConfirm={(name) => renameChannel(targetChannel.id, name)}
          />
          <ConfirmDialog
            open={deleteChannelOpen}
            onOpenChange={setDeleteChannelOpen}
            title="Apagar canal"
            description={
              targetChannel.type === 'voice'
                ? `Isso apaga o canal de voz "${targetChannel.name}" pra sempre. Essa acao nao pode ser desfeita.`
                : `Isso apaga "${targetChannel.name}" e TODAS as mensagens dele pra sempre. Essa acao nao pode ser desfeita.`
            }
            confirmLabel="Apagar"
            destructive
            onConfirm={() => deleteChannel(targetChannel.id)}
          />
        </>
      )}
      {targetCategory && (
        <>
          <PromptDialog
            open={renameCategoryOpen}
            onOpenChange={setRenameCategoryOpen}
            title="Renomear categoria"
            label="Nome da categoria"
            confirmLabel="Salvar"
            initialValue={targetCategory.name}
            onConfirm={(name) => renameCategory(targetCategory.id, name)}
          />
          <ConfirmDialog
            open={deleteCategoryOpen}
            onOpenChange={setDeleteCategoryOpen}
            title="Apagar categoria"
            description={`Isso apaga a categoria "${targetCategory.name}". Ela precisa estar vazia (sem canais). Apague os canais primeiro.`}
            confirmLabel="Apagar"
            destructive
            onConfirm={() => deleteCategory(targetCategory.id)}
          />
        </>
      )}
    </>
  );
}
