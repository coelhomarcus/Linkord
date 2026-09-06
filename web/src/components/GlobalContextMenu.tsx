import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Copy, FolderPlus, Hash, Settings } from 'lucide-react';
import { ContextMenu, ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { useRoom } from '../state/RoomContext';
import { PromptDialog } from '../shared/PromptDialog';
import { NewChannelDialog } from './ChannelTree';

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
  const { state, categories, createCategory, hideAudioOnlyTiles, setHideAudioOnlyTiles } = useRoom();
  const [hasSelection, setHasSelection] = useState(false);
  const [sidebarTarget, setSidebarTarget] = useState(false);
  const [stageTarget, setStageTarget] = useState(false);
  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [newChannelOpen, setNewChannelOpen] = useState(false);
  const isAdmin = state.me.role === 'admin';

  useEffect(() => {
    function captureTarget(e: MouseEvent) {
      setSidebarTarget(e.target instanceof HTMLElement && !!e.target.closest('[data-sidebar-channels]'));
      setStageTarget(e.target instanceof HTMLElement && !!e.target.closest('[data-stage]'));
    }
    function blockNative(e: MouseEvent) {
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
    }
    // capture phase, before ContextMenuTrigger (spanning the whole tree via
    // className="contents") sees the event — stops propagation so it never
    // opens our menu on a text field, letting the browser show its own
    // menu (with "Paste") normally.
    function stopForEditable(e: MouseEvent) {
      if (isEditableTarget(e.target)) e.stopPropagation();
    }
    document.addEventListener('contextmenu', captureTarget, { capture: true });
    document.addEventListener('contextmenu', stopForEditable, { capture: true });
    document.addEventListener('contextmenu', blockNative);
    return () => {
      document.removeEventListener('contextmenu', captureTarget, { capture: true });
      document.removeEventListener('contextmenu', stopForEditable, { capture: true });
      document.removeEventListener('contextmenu', blockNative);
    };
  }, []);

  function handleCopy() {
    const text = window.getSelection()?.toString();
    if (text) navigator.clipboard.writeText(text).catch(() => {});
  }

  return (
    <>
      <ContextMenu onOpenChange={(open) => { if (open) setHasSelection(!!window.getSelection()?.toString()); }}>
        <ContextMenuTrigger className="contents">{children}</ContextMenuTrigger>
        <ContextMenuContent className="w-56">
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
