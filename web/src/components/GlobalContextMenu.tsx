import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Copy, FolderPlus, Hash, Settings } from 'lucide-react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { useRoom } from '../state/RoomContext';
import { PromptDialog } from '../shared/PromptDialog';
import { NewChannelDialog } from './ChannelTree';

interface GlobalContextMenuProps {
  children: ReactNode;
  onOpenSettings: () => void;
}

// campo de texto: deixa o menu NATIVO aparecer ali (colar, sugestao de
// ortografia, etc) em vez do nosso — nao faz sentido "ir pra aba" num
// campo de nome, e sem isso ninguem conseguia colar texto em lugar nenhum.
function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** Substitui o menu nativo do navegador pelo nosso em qualquer lugar do site.
 * `className="contents"` no trigger tira a div wrapper do layout (display:
 * contents) sem tirar ela do DOM — os filhos continuam filhos diretos do
 * flex do Shell, visualmente identico a nao ter wrapper nenhum.
 *
 * So existe UM ContextMenu no app inteiro (nao um por regiao) — o conteudo
 * muda de acordo com ONDE o clique direito aconteceu (ver `sidebarTarget`),
 * em vez de aninhar dois menus (o que causaria conflito: os dois triggers
 * escutando o mesmo evento nativo `contextmenu`). Criar categoria/canal
 * pra admin entra aqui do mesmo jeito que "Copiar" ja entra condicionalmente
 * quando ha selecao de texto. */
export function GlobalContextMenu({ children, onOpenSettings }: GlobalContextMenuProps) {
  const { state, categories, createCategory } = useRoom();
  const [hasSelection, setHasSelection] = useState(false);
  const [sidebarTarget, setSidebarTarget] = useState(false);
  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [newChannelOpen, setNewChannelOpen] = useState(false);
  const isAdmin = state.me.role === 'admin';

  useEffect(() => {
    function captureTarget(e: MouseEvent) {
      setSidebarTarget(e.target instanceof HTMLElement && !!e.target.closest('[data-sidebar-channels]'));
    }
    function blockNative(e: MouseEvent) {
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
    }
    // fase de captura, antes do ContextMenuTrigger (que fica na arvore
    // inteira via className="contents") ver o evento — corta a propagacao
    // pra ele nunca abrir nosso menu num campo de texto, deixando o
    // navegador cuidar do proprio menu (com "Colar") normalmente.
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
