import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, ClipboardEvent } from 'react';
import { ArrowLeft, File as FileIcon, Info, MoreHorizontal, Paperclip, Phone, Reply, Search, Trash2, X, Pencil, SmilePlus } from 'lucide-react';
import { MessageBubble, MessageBubbleContent } from '@/components/agents/message-bubble';
import { PromptInput } from '@/components/agents/prompt-input';
import { useAnimatedSidebar } from '@/components/motion/animated-sidebar';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { Avatar } from '@/shared/Avatar';
import { ChatAttachment } from '@/features/chat/ChatAttachment';
import { ChatMessageText } from '@/features/chat/ChatMessageText';
import { UploadProgressBar } from '@/shared/UploadProgressBar';
import { formatDateHeading, formatTime } from '@/shared/lib/formatChatTime';
import { formatFileSize, formatSizeLimit } from '@/shared/lib/formatBytes';
import { mentionsUser, buildMentionLookup } from '@/shared/lib/mentions';
import { cn } from '@/shared/lib/utils';
import { useRoom } from '@/state/RoomContext';
import { ALLOWED_REACTIONS, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_MESSAGE } from '@/types/protocol';
import type { ChatMessage, PublicUser, ReactionEmoji } from '@/types/protocol';
import { conversationInitials, conversationTitle, directUser, groupMembers } from './conversationUtils';
import { GroupDetailsPanel } from './GroupDetailsPanel';

const GROUP_GAP_MS = 5 * 60 * 1000;
const EMPTY_MESSAGES: ChatMessage[] = [];
const DELETED_AUTHOR_NAME = 'Usuario apagado';

type RenderItem =
  | { type: 'date'; key: string; label: string }
  | { type: 'message'; key: string; message: ChatMessage; showHeader: boolean };

export interface PendingAttachment {
  id: string;
  file: File;
  previewUrl: string | null;
}

function buildRenderItems(messages: ChatMessage[]): RenderItem[] {
  const items: RenderItem[] = [];
  let lastMsg: ChatMessage | null = null;
  let lastDateKey = '';
  for (const message of messages) {
    const dateKey = new Date(message.ts).toDateString();
    if (dateKey !== lastDateKey) {
      items.push({ type: 'date', key: `date-${dateKey}`, label: formatDateHeading(message.ts) });
      lastDateKey = dateKey;
      lastMsg = null;
    }
    const showHeader = !lastMsg || lastMsg.id !== message.id || message.ts - lastMsg.ts > GROUP_GAP_MS;
    items.push({ type: 'message', key: String(message.msgId), message, showHeader });
    lastMsg = message;
  }
  return items;
}

function MessageRow({
  message,
  showHeader,
  allUsers,
  mentionLookup,
  onOpenProfile,
  onReply,
  onJumpTo,
}: {
  message: ChatMessage;
  showHeader: boolean;
  allUsers: Map<string, PublicUser>;
  mentionLookup: Map<string, PublicUser>;
  onOpenProfile: (userId: string) => void;
  onReply: () => void;
  onJumpTo: (msgId: number) => void;
}) {
  const { state, deleteChatMessage, editChatMessage, reactToChatMessage, editingMsgId, setEditingMsgId } = useRoom();
  const [reactOpen, setReactOpen] = useState(false);
  const [editText, setEditText] = useState(message.text);
  const isMine = message.id === state.me.userId;
  const isMod = state.me.role === 'admin';
  const canDelete = isMine || isMod;
  const author = message.id ? allUsers.get(message.id) : undefined;
  const displayedName = author?.displayName ?? message.name;
  const displayedAvatar = author?.avatar ?? message.avatar;
  const replyAuthor = message.replyTo?.authorId ? allUsers.get(message.replyTo.authorId) : undefined;
  const mentionsMe = !isMine && mentionsUser(message.text, mentionLookup, state.me.userId);
  const isEditing = editingMsgId === message.msgId;

  function saveEdit() {
    const trimmed = editText.trim();
    if (trimmed) editChatMessage(message.msgId, trimmed);
    setEditingMsgId(null);
  }

  function handleEditKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      saveEdit();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setEditingMsgId(null);
      setEditText(message.text);
    }
  }

  function pickReaction(emoji: ReactionEmoji) {
    reactToChatMessage(message.msgId, emoji);
    setReactOpen(false);
  }

  return (
    <div
      id={`chat-msg-${message.msgId}`}
      data-message-id={message.msgId}
      className={cn(
        'group/message flex w-full gap-2 px-4 py-1',
        isMine ? 'justify-end' : 'justify-start',
        showHeader ? 'mt-4' : 'mt-1'
      )}
    >
      {!isMine && (
        <div className="w-9 flex-none pt-5">
          {showHeader && message.id ? (
            <button type="button" onClick={() => onOpenProfile(message.id!)} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Avatar id={message.id} name={displayedName} avatar={displayedAvatar} avatarColor={author?.avatarColor} size={32} />
            </button>
          ) : null}
        </div>
      )}

      <div className={cn('flex max-w-[min(680px,calc(100%-3rem))] flex-col', isMine ? 'items-end' : 'items-start')}>
        {showHeader && (
          <div className={cn('mb-1 flex items-center gap-2 px-1', isMine && 'flex-row-reverse')}>
            {message.id ? (
              <button type="button" onClick={() => onOpenProfile(message.id!)} className="truncate text-caption font-medium text-text-secondary hover:text-text-primary">
                {displayedName}
              </button>
            ) : (
              <span className="truncate text-caption font-medium text-text-secondary">{displayedName}</span>
            )}
            <span className="text-[11px] text-text-muted">{formatTime(message.ts)}</span>
          </div>
        )}

        <div className={cn('relative flex items-center gap-1.5', isMine && 'flex-row-reverse')}>
          <MessageBubble align={isMine ? 'end' : 'start'} variant={mentionsMe ? 'tint' : isMine ? 'tint' : 'outline'} animateIn>
            <MessageBubbleContent
              className={cn(
                'max-w-[min(620px,76vw)] whitespace-pre-wrap break-words border-white/10',
                isMine && 'bg-primary text-primary-foreground',
                mentionsMe && !isMine && 'border-yellow/30 bg-yellow/10'
              )}
            >
              {message.replyTo && (
                <button
                  type="button"
                  onClick={() => onJumpTo(message.replyTo!.msgId)}
                  className={cn(
                    'mb-2 block max-w-full truncate rounded-lg border px-2.5 py-1.5 text-left text-xs',
                    isMine ? 'border-white/20 bg-black/15 text-white/85' : 'border-white/10 bg-white/[0.04] text-text-muted'
                  )}
                >
                  <span className="font-medium">{replyAuthor?.displayName ?? DELETED_AUTHOR_NAME}</span>
                  {message.replyTo.text ? <span> - {message.replyTo.text}</span> : null}
                </button>
              )}
              {isEditing ? (
                <div className="flex min-w-72 flex-col gap-2">
                  <Textarea
                    value={editText}
                    onChange={(event) => setEditText(event.target.value)}
                    onKeyDown={handleEditKeyDown}
                    autoFocus
                    rows={2}
                    className="resize-none border-white/15 bg-black/20 text-sm"
                  />
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setEditingMsgId(null)}>Cancelar</Button>
                    <Button type="button" size="sm" onClick={saveEdit}>Salvar</Button>
                  </div>
                </div>
              ) : (
                <>
                  <ChatMessageText text={message.text} mentionLookup={mentionLookup} myUserId={state.me.userId} />
                  {message.editedAt && <span className="ml-1 text-caption opacity-70">(editado)</span>}
                  {message.attachments?.map((attachment) => <ChatAttachment key={attachment.id} attachment={attachment} />)}
                </>
              )}
            </MessageBubbleContent>
          </MessageBubble>

          <div className="hidden items-center gap-0.5 rounded-full border border-white/10 bg-[rgb(20_20_23)] p-0.5 opacity-0 shadow-popover transition-opacity group-hover/message:flex group-hover/message:opacity-100">
            <Popover open={reactOpen} onOpenChange={setReactOpen}>
              <PopoverTrigger render={<Button type="button" variant="ghost" size="icon-xs" aria-label="Reagir" />}>
                <SmilePlus size={13} />
              </PopoverTrigger>
              <PopoverContent className="w-auto border-white/10 bg-[rgb(20_20_23)] p-1.5" side="top" align="center">
                <div className="flex gap-1">
                  {ALLOWED_REACTIONS.map((emoji) => (
                    <button key={emoji} type="button" onClick={() => pickReaction(emoji)} className="rounded-md p-1.5 text-[18px] leading-none hover:bg-white/10">
                      {emoji}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <Button type="button" variant="ghost" size="icon-xs" aria-label="Responder" onClick={onReply}>
              <Reply size={13} />
            </Button>
            {isMine && (
              <Button type="button" variant="ghost" size="icon-xs" aria-label="Editar" onClick={() => { setEditText(message.text); setEditingMsgId(message.msgId); }}>
                <Pencil size={13} />
              </Button>
            )}
            {canDelete && (
              <Button type="button" variant="ghost" size="icon-xs" aria-label="Apagar" onClick={() => deleteChatMessage(message.msgId)} className="hover:bg-red/10 hover:text-red">
                <Trash2 size={13} />
              </Button>
            )}
          </div>

          <div className="md:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-xs" aria-label="Acoes" />}>
                <MoreHorizontal size={13} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <div className="flex gap-1 px-1 py-1">
                  {ALLOWED_REACTIONS.map((emoji) => (
                    <button key={emoji} type="button" onClick={() => reactToChatMessage(message.msgId, emoji)} className="rounded-md p-1.5 text-[18px] leading-none hover:bg-muted">
                      {emoji}
                    </button>
                  ))}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onReply}><Reply size={14} />Responder</DropdownMenuItem>
                {isMine && <DropdownMenuItem onClick={() => setEditingMsgId(message.msgId)}><Pencil size={14} />Editar</DropdownMenuItem>}
                {canDelete && <DropdownMenuItem variant="destructive" onClick={() => deleteChatMessage(message.msgId)}><Trash2 size={14} />Apagar</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {message.reactions && (
          <div className={cn('mt-1 flex flex-wrap gap-1 px-1', isMine && 'justify-end')}>
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
                    mine ? 'border-primary/50 bg-primary/15 text-text-primary' : 'border-white/10 bg-white/[0.04] text-text-secondary hover:bg-white/[0.08]'
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

      {isMine && <div className="w-9 flex-none" />}
    </div>
  );
}

function MessageBubbleList({ conversationId, onReply, onOpenProfile }: {
  conversationId: string;
  onReply: (message: ChatMessage) => void;
  onOpenProfile: (userId: string) => void;
}) {
  const {
    messagesByConversation,
    allUsers,
    hasMoreByConversation,
    loadingOlderByConversation,
    loadOlderMessages,
    hasMoreAfterByConversation,
    pendingJumpTarget,
    clearPendingJumpTarget,
    openConversation,
  } = useRoom();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const pendingPrependRef = useRef(false);
  const prevScrollHeightRef = useRef(0);
  const wasLoadingOlderRef = useRef(false);
  const [highlightedMsgId, setHighlightedMsgId] = useState<number | null>(null);
  const highlightTimeoutRef = useRef<number | null>(null);
  const mentionLookup = useMemo(() => buildMentionLookup(allUsers), [allUsers]);
  const messages = messagesByConversation.get(conversationId) ?? EMPTY_MESSAGES;
  const hasMoreHistory = hasMoreByConversation.get(conversationId) !== false;
  const isLoadingOlder = loadingOlderByConversation.has(conversationId);
  const items = useMemo(() => buildRenderItems(messages), [messages]);

  useLayoutEffect(() => {
    stickToBottomRef.current = true;
    pendingPrependRef.current = false;
    wasLoadingOlderRef.current = false;
  }, [conversationId]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const scrollEl = scrollRef.current;
    const contentEl = contentRef.current;
    if (!scrollEl || !contentEl) return;
    const scrollNode: HTMLDivElement = scrollEl;
    const contentNode: HTMLDivElement = contentEl;
    function handleScroll() {
      stickToBottomRef.current = scrollNode.scrollHeight - scrollNode.scrollTop - scrollNode.clientHeight < 80;
      if (scrollNode.scrollTop <= 100 && !pendingPrependRef.current && !isLoadingOlder && hasMoreHistory) {
        pendingPrependRef.current = true;
        prevScrollHeightRef.current = scrollNode.scrollHeight;
        loadOlderMessages(conversationId);
      }
    }
    const observer = new ResizeObserver(() => {
      if (stickToBottomRef.current) scrollNode.scrollTop = scrollNode.scrollHeight;
    });
    observer.observe(contentNode);
    scrollNode.addEventListener('scroll', handleScroll);
    return () => {
      observer.disconnect();
      scrollNode.removeEventListener('scroll', handleScroll);
    };
  }, [conversationId, hasMoreHistory, isLoadingOlder, loadOlderMessages]);

  useLayoutEffect(() => {
    if (wasLoadingOlderRef.current && !isLoadingOlder) {
      const el = scrollRef.current;
      if (el && pendingPrependRef.current) {
        const delta = el.scrollHeight - prevScrollHeightRef.current;
        if (delta > 0) el.scrollTop = delta;
      }
      pendingPrependRef.current = false;
    }
    wasLoadingOlderRef.current = isLoadingOlder;
  }, [isLoadingOlder, messages]);

  function jumpToMessage(msgId: number, behavior: ScrollBehavior = 'smooth') {
    const el = document.getElementById(`chat-msg-${msgId}`);
    if (!el) return;
    el.scrollIntoView({ behavior, block: 'center' });
    if (highlightTimeoutRef.current != null) window.clearTimeout(highlightTimeoutRef.current);
    setHighlightedMsgId(msgId);
    highlightTimeoutRef.current = window.setTimeout(() => setHighlightedMsgId(null), 1500);
  }

  useLayoutEffect(() => {
    if (!pendingJumpTarget || pendingJumpTarget.conversationId !== conversationId) return;
    if (!messages.some((message) => message.msgId === pendingJumpTarget.msgId)) return;
    stickToBottomRef.current = false;
    jumpToMessage(pendingJumpTarget.msgId, 'auto');
    clearPendingJumpTarget();
  }, [pendingJumpTarget, messages, conversationId, clearPendingJumpTarget]);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} className="h-full overflow-y-auto px-2 pb-4 pt-3">
        <div ref={contentRef} className="mx-auto flex w-full max-w-5xl flex-col">
          {isLoadingOlder && <p className="my-3 text-center text-label text-text-muted">Carregando mensagens anteriores...</p>}
          {messages.length === 0 && (
            <div className="flex min-h-[45vh] items-center justify-center px-6 text-center text-label text-text-muted">
              Nenhuma mensagem ainda.
            </div>
          )}
          {items.map((item) => item.type === 'date' ? (
            <div key={item.key} className="my-4 flex select-none items-center gap-3 px-4">
              <div className="h-px flex-1 bg-white/10" />
              <span className="flex-none text-caption font-medium text-text-muted">{item.label}</span>
              <div className="h-px flex-1 bg-white/10" />
            </div>
          ) : (
            <div key={item.key} className={highlightedMsgId === item.message.msgId ? 'rounded-2xl bg-primary/10' : undefined}>
              <MessageRow
                message={item.message}
                showHeader={item.showHeader}
                allUsers={allUsers}
                mentionLookup={mentionLookup}
                onReply={() => onReply(item.message)}
                onOpenProfile={onOpenProfile}
                onJumpTo={jumpToMessage}
              />
            </div>
          ))}
        </div>
      </div>
      {hasMoreAfterByConversation.get(conversationId) === true && (
        <button
          type="button"
          onClick={() => {
            stickToBottomRef.current = true;
            openConversation(conversationId);
          }}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1.5 text-label font-medium text-primary-foreground shadow-popover"
        >
          Voltar para o mais recente
        </button>
      )}
    </div>
  );
}

function Composer({ conversationId }: { conversationId: string }) {
  const { state, allUsers, sendChatMessage, sendAttachments, replyingTo, setReplyingTo } = useRoom();
  const [text, setText] = useState('');
  const [pendingFiles, setPendingFiles] = useState<PendingAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [activeUploadId, setActiveUploadId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingFilesRef = useRef<PendingAttachment[]>([]);
  const disabled = !state.joined || activeUploadId !== null;

  useEffect(() => { pendingFilesRef.current = pendingFiles; }, [pendingFiles]);
  useEffect(() => () => {
    pendingFilesRef.current.forEach((file) => {
      if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
    });
  }, []);

  function addFiles(files: File[]) {
    if (!files.length) return;
    const remainingSlots = MAX_ATTACHMENTS_PER_MESSAGE - pendingFiles.length;
    const accepted: PendingAttachment[] = [];
    let error: string | null = null;
    for (const file of files) {
      if (accepted.length >= remainingSlots) {
        error = `Maximo de ${MAX_ATTACHMENTS_PER_MESSAGE} anexos por mensagem.`;
        break;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        error = `"${file.name}" e grande demais (maximo ${formatSizeLimit(MAX_ATTACHMENT_BYTES)}).`;
        continue;
      }
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
      const found = prev.find((file) => file.id === id);
      if (found?.previewUrl) URL.revokeObjectURL(found.previewUrl);
      return prev.filter((file) => file.id !== id);
    });
  }

  function clearFiles() {
    setPendingFiles((prev) => {
      prev.forEach((file) => {
        if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
      });
      return [];
    });
  }

  async function submit(value: string) {
    const trimmed = value.trim();
    try {
      if (pendingFiles.length) {
        setAttachError(null);
        setUploadProgress(0);
        await sendAttachments(conversationId, pendingFiles.map((item) => item.file), trimmed, (fileIndex, fraction) => {
          setActiveUploadId(pendingFiles[fileIndex]?.id ?? null);
          setUploadProgress(fraction);
        });
        clearFiles();
        setText('');
        setReplyingTo(null);
        return;
      }
      if (!trimmed) return;
      sendChatMessage(conversationId, trimmed, replyingTo?.msgId);
      setText('');
      setReplyingTo(null);
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'Falha ao enviar.');
    } finally {
      setActiveUploadId(null);
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    addFiles(files);
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file);
    if (!files.length) return;
    event.preventDefault();
    addFiles(files);
  }

  const replyAuthor = replyingTo?.id ? allUsers.get(replyingTo.id) : undefined;
  const replyName = replyAuthor?.displayName ?? replyingTo?.name;

  return (
    <div className="mx-auto w-full max-w-4xl flex-none px-4 pb-4">
      {replyingTo && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-label">
          <Reply size={14} className="text-text-muted" />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium text-text-secondary">{replyName}</span>
            {replyingTo.text ? <span className="text-text-muted"> - {replyingTo.text}</span> : null}
          </span>
          <Button type="button" variant="ghost" size="icon-xs" aria-label="Cancelar resposta" onClick={() => setReplyingTo(null)}>
            <X size={14} />
          </Button>
        </div>
      )}

      {pendingFiles.length > 0 && (
        <div className="mb-2 flex items-end justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {pendingFiles.map((item) => {
              const uploading = activeUploadId === item.id;
              return (
                <div key={item.id} title={`${item.file.name} - ${formatFileSize(item.file.size)}`} className="relative size-18 overflow-hidden rounded-xl border border-white/10 bg-white/[0.04]">
                  {item.previewUrl ? (
                    <img src={item.previewUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <div className="grid size-full place-items-center bg-black/30">
                      <FileIcon size={22} className="text-text-muted" />
                    </div>
                  )}
                  {uploading ? (
                    <>
                      <div className="absolute inset-0 bg-black/55" />
                      <div className="absolute inset-x-1.5 bottom-1.5"><UploadProgressBar progress={uploadProgress} /></div>
                    </>
                  ) : (
                    <Button type="button" variant="ghost" size="icon-xs" aria-label="Remover anexo" onClick={() => removeFile(item.id)} className="absolute right-1 top-1 size-5 rounded-full bg-black/60 text-white hover:bg-black/80 hover:text-white">
                      <X size={12} />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          <Button type="button" size="sm" disabled={disabled} onClick={() => { void submit(text); }}>
            Enviar anexos
          </Button>
        </div>
      )}

      {attachError && <p className="mb-2 rounded-lg border border-red/20 bg-red/10 px-3 py-2 text-label text-red">{attachError}</p>}

      <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileChange} />
      <PromptInput
        value={text}
        onValueChange={setText}
        onSubmit={(value) => { void submit(value); }}
        disabled={disabled}
        minRows={1}
        maxRows={6}
        maxLength={2000}
        placeholder={pendingFiles.length ? 'Adicionar legenda' : 'Mensagem'}
        onPaste={handlePaste}
        actions={[
          {
            value: 'attach',
            label: 'Anexar arquivo',
            description: 'Imagem, video, audio ou documento',
            icon: <Paperclip size={16} />,
          },
        ]}
        onAction={(action) => {
          if (action === 'attach') fileInputRef.current?.click();
        }}
        className="border-white/10 bg-[rgb(18_18_20)] shadow-[0_16px_50px_rgb(0_0_0_/_0.25)]"
      />
    </div>
  );
}

interface ConversationPanelProps {
  onOpenProfile: (userId: string) => void;
  onOpenCall: (conversationId: string) => void;
  onOpenSearch: () => void;
}

export function ConversationPanel({ onOpenProfile, onOpenCall, onOpenSearch }: ConversationPanelProps) {
  const { state, conversations, activeConversationId, allUsers, onlineUserIds } = useRoom();
  const { setOpenMobile } = useAnimatedSidebar();
  const conversation = conversations.find((item) => item.id === activeConversationId) ?? null;
  const title = conversationTitle(conversation, state.me.userId, allUsers);
  const other = directUser(conversation, state.me.userId, allUsers);
  const members = groupMembers(conversation, allUsers);
  const online = other ? onlineUserIds.has(other.id) : false;
  const subtitle = conversation?.type === 'group'
    ? `${members.length} membros`
    : other ? (online ? 'Online' : 'Offline') : '';
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <div className="flex h-full min-w-0 flex-1">
      <main className="flex min-w-0 flex-1 flex-col text-text-primary">
      {conversation ? (
        <>
          <header className="flex h-16 flex-none items-center gap-3 border-b border-white/10 bg-[rgb(12_12_14)]/90 px-4 backdrop-blur">
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Voltar" onClick={() => setOpenMobile(true)} className="-ml-1 md:hidden">
              <ArrowLeft size={18} />
            </Button>
            {conversation.type === 'direct' && other ? (
              <Avatar id={other.id} name={other.displayName} avatar={other.avatar} avatarColor={other.avatarColor} size={40} />
            ) : (
              <button
                type="button"
                onClick={() => setDetailsOpen(true)}
                className="grid size-10 flex-none place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-label font-semibold text-text-secondary transition-colors hover:border-white/20"
                aria-label="Detalhes do grupo"
              >
                {conversationInitials(title)}
              </button>
            )}
            <button
              type="button"
              onClick={conversation.type === 'group' ? () => setDetailsOpen(true) : undefined}
              className="min-w-0 flex-1 text-left"
            >
              <h2 className="truncate text-title font-semibold">{title}</h2>
              {subtitle && <p className="truncate text-caption text-text-muted">{subtitle}</p>}
            </button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Buscar mensagens" onClick={onOpenSearch} className="text-text-muted hover:text-text-primary">
              <Search size={16} />
            </Button>
            {conversation.type === 'group' && (
              <>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Detalhes do grupo" onClick={() => setDetailsOpen(true)} className="text-text-muted hover:text-text-primary">
                  <Info size={16} />
                </Button>
                <Button type="button" size="icon-sm" aria-label="Entrar na chamada" onClick={() => onOpenCall(conversation.id)}>
                  <Phone size={16} />
                </Button>
              </>
            )}
          </header>
          <MessageBubbleListBridge conversationId={conversation.id} onOpenProfile={onOpenProfile} />
        </>
      ) : (
        <div className="grid flex-1 place-items-center px-6 text-center">
          <div>
            <p className="text-title font-semibold text-text-primary">Abra uma conversa</p>
            <p className="mt-1 text-label text-text-muted">Escolha uma pessoa ou grupo na sidebar.</p>
          </div>
        </div>
      )}
      </main>
      <GroupDetailsPanel
        conversationId={conversation?.type === 'group' ? conversation.id : null}
        open={detailsOpen && conversation?.type === 'group'}
        onOpenChange={setDetailsOpen}
        onOpenProfile={onOpenProfile}
      />
    </div>
  );
}

function MessageBubbleListBridge({ conversationId, onOpenProfile }: { conversationId: string; onOpenProfile: (userId: string) => void }) {
  const { setReplyingTo } = useRoom();
  return (
    <>
      <MessageBubbleList conversationId={conversationId} onReply={setReplyingTo} onOpenProfile={onOpenProfile} />
      <Composer conversationId={conversationId} />
    </>
  );
}
