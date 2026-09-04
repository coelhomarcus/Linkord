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

/** Chat como pagina cheia (canal de texto estilo Discord) — sem balao, sem
 * coluna centralizada, ocupa a largura toda entre a sidebar esquerda e o
 * diretorio de usuarios (direita). */
export function ChatPage() {
  const { state, categories, activeChannelId, deleteChannel } = useRoom();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const isMod = state.me.role === 'admin';

  const activeChannel = useMemo(
    () => categories.flatMap((c) => c.channels).find((ch) => ch.id === activeChannelId) ?? null,
    [categories, activeChannelId]
  );

  // trocar de canal cancela uma resposta pendente — sem isso o banner
  // "Respondendo a X" (e o replyTo mandado no envio) ficaria referenciando
  // uma mensagem de um canal DIFERENTE do que a pessoa esta olhando agora.
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
            {/* so existe pra admin — apagar o canal e a unica opcao hoje
                (substitui o antigo "limpar chat": apaga o canal inteiro,
                mensagens somem do banco pra sempre). */}
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
            {/* key={activeChannelId}: forca remontar ao trocar de canal — sem
                isso o composer e a MESMA instancia (so o prop channelId
                muda), entao texto/anexo pendente sobreviveriam a troca de
                canal e um Enter tardio mandaria pro canal ERRADO (o que
                esta ativo agora, nao aquele onde a pessoa realmente
                digitou/anexou). */}
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
