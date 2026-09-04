import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { MoreHorizontal, Pencil, Reply, SmilePlus, Trash2 } from 'lucide-react';
import { useRoom } from '../../state/RoomContext';
import { Avatar } from '../../shared/Avatar';
import { ChatMessageText } from './ChatMessageText';
import { ChatAttachment } from './ChatAttachment';
import { ALLOWED_REACTIONS } from '../../types/protocol';
import type { ChatMessage, ReactionEmoji } from '../../types/protocol';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/shared/lib/utils';

// mensagens consecutivas do mesmo autor dentro dessa janela agrupam (avatar/
// nome so na primeira) — mesmo espirito do Discord.
const GROUP_GAP_MS = 5 * 60 * 1000;
// referencia estavel — reaproveitada em vez de `[]` a cada render quando um
// canal ainda nao teve o historico carregado (ver channel-open).
const EMPTY_MESSAGES: ChatMessage[] = [];

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDateHeading(ts: number): string {
  return new Date(ts).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
}

type RenderItem =
  | { type: 'date'; key: string; label: string }
  | { type: 'message'; key: string; message: ChatMessage; showHeader: boolean };

function buildRenderItems(messages: ChatMessage[]): RenderItem[] {
  const items: RenderItem[] = [];
  let lastMsg: ChatMessage | null = null;
  let lastDateKey = '';
  for (const m of messages) {
    const dateKey = new Date(m.ts).toDateString();
    if (dateKey !== lastDateKey) {
      items.push({ type: 'date', key: `date-${dateKey}`, label: formatDateHeading(m.ts) });
      lastDateKey = dateKey;
      lastMsg = null; // forca cabecalho de autor de novo apos o divisor
    }
    const showHeader = !lastMsg || lastMsg.id !== m.id || m.ts - lastMsg.ts > GROUP_GAP_MS;
    items.push({ type: 'message', key: String(m.msgId), message: m, showHeader });
    lastMsg = m;
  }
  return items;
}

interface ChatMessageRowProps {
  message: ChatMessage;
  showHeader: boolean;
  isMod: boolean;
  isHighlighted: boolean;
  isEditing: boolean;
  editText: string;
  onEditTextChange: (text: string) => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onReply: () => void;
  onJumpTo: (msgId: number) => void;
}

/** Uma linha do historico — sem balao, fundo continuo. `showHeader` decide
 * se mostra avatar/nome (primeira de uma sequencia do mesmo autor) ou fica
 * compacta (so o horario, no hover, no lugar do avatar). */
function ChatMessageRow({
  message, showHeader, isMod, isHighlighted, isEditing, editText, onEditTextChange,
  onStartEdit, onSaveEdit, onCancelEdit, onReply, onJumpTo,
}: ChatMessageRowProps) {
  const { state, deleteChatMessage, reactToChatMessage } = useRoom();
  const [reactOpen, setReactOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // a barra so em CSS (group-hover) fechava sozinha assim que o mouse saia
  // da linha pra ir ate o popover/dropdown — eles portam pra fora da arvore
  // da linha, entao ":hover" na linha para de valer no meio do caminho.
  // Aqui o hover vira estado: continua "ativo" enquanto um popover/dropdown
  // desta linha estiver aberto, mesmo com o mouse fisicamente fora dela.
  const [isRowActive, setIsRowActive] = useState(false);
  // message.id e o USERID da conta (nao o id de conexao) — comparar contra
  // state.me.userId, nao state.me.id, senao "e minha mensagem?" quebra depois
  // de reconectar/recarregar (id de conexao muda, userId nao).
  const isMine = message.id === state.me.userId;

  function handleEditKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSaveEdit(); }
    if (e.key === 'Escape') { e.preventDefault(); onCancelEdit(); }
  }

  return (
    <div
      id={`chat-msg-${message.msgId}`}
      onMouseEnter={() => setIsRowActive(true)}
      onMouseLeave={() => { if (!reactOpen && !moreOpen) setIsRowActive(false); }}
      className={cn(
        'group/msg relative flex gap-3 rounded-md px-3 transition-colors',
        showHeader ? 'mt-3' : '',
        isHighlighted ? 'bg-blurple/15' : 'hover:bg-bg-hover'
      )}
    >
      <div className="w-10 flex-none pt-0.5">
        {/* message.id (o authorId) vira null quando a conta de quem mandou
            foi apagada (moderacao, ver protocol.ts) — cai pro nome (que fica
            congelado na mensagem pra sempre) como semente da cor, so pra
            nao repetir sempre a MESMA cor pra todo autor apagado. */}
        {showHeader ? (
          <Avatar id={message.id ?? message.name} name={message.name} avatar={message.avatar} size={40} />
        ) : (
          <span className="hidden select-none text-center text-caption text-text-muted group-hover/msg:block">
            {formatTime(message.ts)}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1 py-0.5">
        {message.replyTo && (
          <button
            type="button"
            onClick={() => onJumpTo(message.replyTo!.msgId)}
            className="mb-0.5 flex max-w-full items-center gap-1.5 pl-4 text-label text-text-muted transition-colors hover:text-text-secondary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {/* conector curvo do Discord (baixado do kit do Figma) — troca o
                icone de seta generico por um SVG proprio; stroke="currentColor"
                pra acompanhar a cor do texto (igual hover/normal do resto da
                linha). */}
            <svg width="14" height="5" viewBox="0 0 25 8.5" fill="none" className="flex-none -translate-y-px" xmlns="http://www.w3.org/2000/svg">
              <path d="M0.5 8.5V5.5C0.5 2.73858 2.73858 0.5 5.5 0.5H25" stroke="currentColor" />
            </svg>
            <span className="flex-none font-medium">{message.replyTo.name}</span>
            <span className="truncate">{message.replyTo.text}</span>
          </button>
        )}

        {showHeader && (
          <div className="flex items-baseline gap-2">
            <span className="text-body font-semibold text-text-primary">{message.name}</span>
            <span className="text-caption text-text-muted">{formatTime(message.ts)}</span>
          </div>
        )}

        {isEditing ? (
          <div className="flex flex-col gap-1 py-0.5">
            <Textarea
              value={editText}
              onChange={(e) => onEditTextChange(e.target.value)}
              onKeyDown={handleEditKeyDown}
              autoFocus
              rows={1}
              className="min-h-8 resize-none bg-bg-textarea py-1.5 text-body"
            />
            <p className="select-none text-caption text-text-muted">escape pra cancelar · enter pra salvar</p>
          </div>
        ) : (
          <div className="text-body text-text-primary">
            <ChatMessageText text={message.text} />
            {message.editedAt && <span className="ml-1 select-none text-caption text-text-muted">(editado)</span>}
            {message.attachment && <ChatAttachment attachment={message.attachment} />}
          </div>
        )}

        {message.reactions && (
          <div className="mt-1 flex flex-wrap gap-1">
            {(Object.entries(message.reactions) as [ReactionEmoji, string[]][]).map(([emoji, userIds]) => {
              if (!userIds?.length) return null;
              const mine = !!state.me.userId && userIds.includes(state.me.userId);
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => reactToChatMessage(message.msgId, emoji)}
                  className={cn(
                    'flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-label transition-colors',
                    mine ? 'border-border-accent bg-blurple/15 text-text-primary' : 'border-strong bg-bg-tertiary text-text-secondary hover:bg-bg-hover'
                  )}
                >
                  <span>{emoji}</span>
                  <span>{userIds.length}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* barra de acoes — visivel no hover da linha OU enquanto um popover/
          dropdown dela estiver aberto (ver isRowActive acima). */}
      <div className={cn(
        'absolute right-2 top-0 z-10 -translate-y-1/2 items-center gap-0.5 rounded-md border border-strong bg-bg-floating p-0.5 shadow-popover',
        isRowActive ? 'flex' : 'hidden'
      )}>
        <Popover open={reactOpen} onOpenChange={(open) => { setReactOpen(open); if (!open) setIsRowActive(false); }}>
          <PopoverTrigger render={<Button type="button" variant="ghost" size="icon-xs" aria-label="Reagir" />}>
            <SmilePlus size={14} />
          </PopoverTrigger>
          <PopoverContent className="w-auto p-1.5" side="top" align="end">
            <div className="flex gap-1">
              {ALLOWED_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => { reactToChatMessage(message.msgId, emoji); setReactOpen(false); setIsRowActive(false); }}
                  className="rounded-md p-1.5 text-[18px] leading-none transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Responder" onClick={onReply}>
          <Reply size={14} />
        </Button>
        {isMine && (
          <Button type="button" variant="ghost" size="icon-xs" aria-label="Editar" onClick={onStartEdit}>
            <Pencil size={14} />
          </Button>
        )}
        {isMod && (
          <DropdownMenu onOpenChange={(open) => { setMoreOpen(open); if (!open) setIsRowActive(false); }}>
            <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-xs" aria-label="Mais opcoes" />}>
              <MoreHorizontal size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" onClick={() => deleteChatMessage(message.msgId)}>
                <Trash2 size={14} />
                <span>Apagar</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

interface ChatMessageListProps {
  className?: string;
  channelId: string;
  onReply: (message: ChatMessage) => void;
}

/** Historico do chat — estilo Discord: sem balao, fundo continuo, mensagens
 * agrupadas por autor, divisor de data, e a barra de acoes por mensagem no
 * hover (reagir/responder/editar/apagar). */
export function ChatMessageList({ className, channelId, onReply }: ChatMessageListProps) {
  const { state, messagesByChannel, editChatMessage } = useRoom();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // wrapper SO do conteudo (nao o viewport com scroll) — com overflow-y-auto,
  // o viewport tem tamanho fixo (nao cresce com o conteudo), entao um
  // ResizeObserver NELE nunca dispara por causa de mensagem/imagem nova. O
  // que cresce e esse div de dentro; e ele que precisa ser observado (ver
  // useEffect abaixo).
  const contentRef = useRef<HTMLDivElement | null>(null);
  // true enquanto o usuario estiver "colado" no fim (ou ainda nao rolou pra
  // lugar nenhum) — so entao um conteudo novo (mensagem, ou uma imagem/anexo
  // que so ganha altura de verdade DEPOIS de carregar) reajusta o scroll
  // sozinho; se a pessoa rolou pra cima pra ler o historico, nada aqui deve
  // puxar ela de volta pro fim.
  const stickToBottomRef = useRef(true);
  const isMod = state.me.role === 'admin';
  const chatMessages = messagesByChannel.get(channelId) ?? EMPTY_MESSAGES;

  const [editingMsgId, setEditingMsgId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [highlightedMsgId, setHighlightedMsgId] = useState<number | null>(null);
  const highlightTimeoutRef = useRef<number | null>(null);

  // trocar de canal SEMPRE comeca no fim (a mensagem mais recente) — nunca
  // preserva a posicao de rolagem de outro canal.
  useEffect(() => {
    stickToBottomRef.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [channelId]);

  // "colado no fim" (ver stickToBottomRef acima) via ResizeObserver no
  // CONTEUDO (nao no numero de mensagens): cobre tanto mensagem nova quanto
  // qualquer coisa que so muda de altura depois de renderizada — imagem/
  // anexo carregando (ChatAttachment), preview de link (ChatEmbed) — sem
  // isso, o scroll ficava "certo" no momento em que a imagem ainda nao tinha
  // altura nenhuma e ficava pra tras assim que ela terminava de carregar.
  useEffect(() => {
    const scrollEl = scrollRef.current;
    const contentEl = contentRef.current;
    if (!scrollEl || !contentEl) return;

    function handleScroll() {
      const el = scrollEl!;
      // tolerancia de alguns px pra "no fim" nao exigir pixel perfeito
      stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    }
    const resizeObserver = new ResizeObserver(() => {
      if (stickToBottomRef.current) scrollEl.scrollTop = scrollEl.scrollHeight;
    });
    resizeObserver.observe(contentEl);
    scrollEl.addEventListener('scroll', handleScroll);
    return () => {
      resizeObserver.disconnect();
      scrollEl.removeEventListener('scroll', handleScroll);
    };
    // liga so uma vez — scrollRef/contentRef sao os MESMOS nos do DOM a vida
    // inteira do componente (nao remonta ao trocar de canal), nao precisa
    // recriar o observer/listener a cada troca.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // mensagem MINHA enviada agora sempre puxa pro fim, mesmo se eu tivesse
  // rolado pra cima antes de mandar — eu que acabei de escrever, faz sentido
  // eu ver ela aparecer (mensagem de OUTRA pessoa nao forca isso, so gruda
  // se eu ja estava no fim, ver o ResizeObserver acima).
  const lastMineTsRef = useRef(0);
  useEffect(() => {
    const last = chatMessages[chatMessages.length - 1];
    if (last && last.id === state.me.userId && last.ts !== lastMineTsRef.current) {
      lastMineTsRef.current = last.ts;
      stickToBottomRef.current = true;
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [chatMessages, state.me.userId]);

  const renderItems = useMemo(() => buildRenderItems(chatMessages), [chatMessages]);

  function startEdit(message: ChatMessage) {
    setEditingMsgId(message.msgId);
    setEditText(message.text);
  }
  function saveEdit() {
    const trimmed = editText.trim();
    if (editingMsgId != null && trimmed) editChatMessage(editingMsgId, trimmed);
    setEditingMsgId(null);
  }

  function jumpToMessage(msgId: number) {
    const el = document.getElementById(`chat-msg-${msgId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (highlightTimeoutRef.current != null) window.clearTimeout(highlightTimeoutRef.current);
    setHighlightedMsgId(msgId);
    highlightTimeoutRef.current = window.setTimeout(() => setHighlightedMsgId(null), 1500);
  }

  return (
    <div ref={scrollRef} className={`min-h-0 flex-1 overflow-y-auto ${className ?? ''}`}>
      <div ref={contentRef} className="flex flex-col">
        {chatMessages.length === 0 && (
          <p className="mt-4 select-none px-1 text-center text-label text-text-muted">Nenhuma mensagem ainda. Diga oi!</p>
        )}
        {renderItems.map((item) => {
          if (item.type === 'date') {
            return (
              <div key={item.key} className="my-3 flex select-none items-center gap-3 px-3">
                <div className="h-px flex-1 bg-border-strong" />
                <span className="flex-none text-caption font-medium text-text-muted">{item.label}</span>
                <div className="h-px flex-1 bg-border-strong" />
              </div>
            );
          }
          const { message, showHeader } = item;
          return (
            <ChatMessageRow
              key={item.key}
              message={message}
              showHeader={showHeader}
              isMod={isMod}
              isHighlighted={highlightedMsgId === message.msgId}
              isEditing={editingMsgId === message.msgId}
              editText={editText}
              onEditTextChange={setEditText}
              onStartEdit={() => startEdit(message)}
              onSaveEdit={saveEdit}
              onCancelEdit={() => setEditingMsgId(null)}
              onReply={() => onReply(message)}
              onJumpTo={jumpToMessage}
            />
          );
        })}
      </div>
    </div>
  );
}
