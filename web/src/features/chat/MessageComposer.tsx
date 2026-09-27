import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, KeyboardEvent as ReactKeyboardEvent, SyntheticEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp, ImagePlus, Paperclip, Plus, Reply, Smile } from 'lucide-react';
import { CloseButton } from '@/shared/ui/primitives/close-button';
import { Button } from '@/shared/ui/primitives/button';
import { EmojiPicker, EmojiPickerContent, EmojiPickerSearch } from '@/shared/ui/primitives/emoji-picker';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/primitives/popover';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/shared/ui/primitives/dropdown-menu';
import { Textarea } from '@/shared/ui/primitives/textarea';
import { Avatar } from '@/shared/Avatar';
import { DocumentAttachmentCard } from '@/features/media/DocumentAttachmentCard';
import { UploadProgressBar } from '@/shared/UploadProgressBar';
import { useKeepPopoverWarm } from '@/shared/hooks/useKeepPopoverWarm';
import { compressImageFile } from '@/shared/lib/compressImageFile';
import { formatFileSize, formatSizeLimit } from '@/shared/lib/formatBytes';
import { cn } from '@/shared/lib/utils';
import { useRoom } from '@/state/RoomContext';
import { ApiError } from '@/shared/api/api';
import { PartialAttachmentError } from './useAttachmentsUpload';
import { readDraft, useConversationDraft, type PendingAttachment } from './conversationDrafts';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_MESSAGE } from '@/shared/types/protocol';
import type { PublicUser } from '@/shared/types/protocol';

// How often notifyTyping actually emits typing:true while the user keeps
// typing (leading-edge: fires right away after being idle, then throttles),
// and how long without a keystroke before it emits typing:false on its own.
const TYPING_THROTTLE_MS = 3000;
const TYPING_IDLE_MS = 5000;

const MAX_MENTION_RESULTS = 8;
// mirrors the server's MAX_CHAT_LEN; the counter only shows near the end so
// it doesn't compete with the text for most messages
const MAX_MESSAGE_LEN = 2000;
const COUNTER_THRESHOLD = 1800;

/** Finds the "@query" the cursor is currently sitting inside of, if any —
 * "@" must start a token (preceded by whitespace or the start of the text),
 * otherwise a plain email like "a@b.com" would trigger the dropdown too. */
function getMentionQuery(text: string, cursor: number): { start: number; query: string } | null {
  const upToCursor = text.slice(0, cursor);
  const match = /@([A-Za-z0-9_.-]{0,20})$/.exec(upToCursor);
  if (!match) return null;
  const atIndex = match.index;
  const charBefore = atIndex > 0 ? upToCursor[atIndex - 1] : ' ';
  if (!/\s/.test(charBefore!)) return null;
  return { start: atIndex, query: match[1] ?? '' };
}

// A retry that tries to extend the message and is told it can't (too old,
// deleted, full) has to fall back to a fresh message for the remaining files.
const UNRESUMABLE_TARGET_CODES = new Set(['target_message_too_old', 'target_message_not_found', 'too_many_attachments', 'not_your_message']);

export interface MessageComposerHandle {
  addFiles: (files: File[]) => void;
}

export const MessageComposer = forwardRef<MessageComposerHandle, { conversationId: string }>(function MessageComposer({ conversationId }, ref) {
  const { state, allUsers, conversations, sendChatMessage, sendAttachments, queueMessageWithFiles, sendTyping, replyingTo, setReplyingTo, compressImagesDefault, setCompressImagesDefault } = useRoom();
  const accountId = state.me.userId ?? '';
  const [draft, updateDraft] = useConversationDraft(accountId, conversationId);
  const { text, pendingFiles, attachError, upload } = draft;
  const setText = (next: string) => updateDraft(() => ({ text: next }));
  const [compressImages, setCompressImages] = useState(compressImagesDefault);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  // once opened, keeps the picker mounted (hidden) instead of paying its
  // dataset fetch/measure cost again on every open — see useKeepPopoverWarm.
  const emojiPickerWarmed = useKeepPopoverWarm(emojiPickerOpen);
  // active "@query" under the cursor, or null when not mentioning anyone
  // right now (see getMentionQuery) — drives the autocomplete dropdown.
  const [mentionQuery, setMentionQuery] = useState<{ start: number; query: string } | null>(null);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const mentionOptionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const counterId = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // an upload can finish after the user moved to another conversation; the
  // reply target is global, so it's only cleared if they're still here
  const conversationIdRef = useRef(conversationId);
  useEffect(() => { conversationIdRef.current = conversationId; }, [conversationId]);
  const typingThrottleRef = useRef<number | null>(null); // Date.now() of the last emitted typing:true
  const typingIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const disabled = !state.joined || upload !== null;
  const tooLong = text.length > MAX_MESSAGE_LEN;
  const canSubmit = !disabled && !tooLong && (text.trim().length > 0 || pendingFiles.length > 0);

  // Keeps the arrow-key-highlighted mention option visible — without this,
  // ArrowDown/ArrowUp move mentionSelectedIndex past the dropdown's visible
  // rows (it's capped at max-h-56) with no compensating scroll.
  useEffect(() => {
    mentionOptionRefs.current[mentionSelectedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [mentionSelectedIndex, mentionQuery]);

  function notifyTyping() {
    if (disabled) return;
    const now = Date.now();
    if (!isTypingRef.current || typingThrottleRef.current === null || now - typingThrottleRef.current >= TYPING_THROTTLE_MS) {
      sendTyping(conversationId, true);
      typingThrottleRef.current = now;
      isTypingRef.current = true;
    }
    if (typingIdleTimerRef.current !== null) clearTimeout(typingIdleTimerRef.current);
    typingIdleTimerRef.current = setTimeout(() => {
      isTypingRef.current = false;
      typingThrottleRef.current = null;
      sendTyping(conversationId, false);
    }, TYPING_IDLE_MS);
  }

  function stopTyping() {
    if (typingIdleTimerRef.current !== null) { clearTimeout(typingIdleTimerRef.current); typingIdleTimerRef.current = null; }
    if (isTypingRef.current) sendTyping(conversationId, false);
    isTypingRef.current = false;
    typingThrottleRef.current = null;
  }

  // Composer isn't remounted when switching conversations (ConversationPanel
  // renders one persistent instance) — this cleanup fires on conversationId
  // change too, flushing typing:false for the conversation being LEFT before
  // sendTyping starts targeting the new one, and dismissing any dropdown
  // left open from the conversation being left.
  useEffect(() => () => { stopTyping(); setMentionQuery(null); }, [conversationId]);

  // Scoped to this conversation's actual members (not every registered
  // user in the room) — a big roster elsewhere shouldn't show up as
  // mentionable in a DM/group they're not part of.
  const memberIds = conversations.find((c) => c.id === conversationId)?.memberIds ?? [];
  const mentionCandidates = useMemo(() => {
    if (!mentionQuery) return [];
    const q = mentionQuery.query.toLowerCase();
    const members: PublicUser[] = [];
    for (const id of memberIds) {
      const user = allUsers.get(id);
      if (user) members.push(user);
    }
    return members
      .filter((u) => u.username.toLowerCase().startsWith(q))
      .sort((a, b) => a.username.localeCompare(b.username))
      .slice(0, MAX_MENTION_RESULTS);
  }, [allUsers, mentionQuery, memberIds]);

  // re-derives the active "@query" from wherever the cursor is now — called
  // after every edit (the Textarea's onChange) and every cursor move that
  // ISN'T an edit (onSelect: arrow keys, click), since either can start,
  // change, or leave a mention.
  function syncMentionQuery(value: string, cursor: number) {
    setMentionQuery(getMentionQuery(value, cursor));
    setMentionSelectedIndex(0);
  }

  function handleTextareaSelect(event: SyntheticEvent<HTMLTextAreaElement>) {
    const el = event.currentTarget;
    syncMentionQuery(el.value, el.selectionStart ?? 0);
  }

  // replaces the "@query" itself (not the whole field) with "@username " —
  // mirrors insertEmoji's cursor handling below.
  function selectMention(user: PublicUser) {
    const el = textareaRef.current;
    if (!mentionQuery) return;
    const before = text.slice(0, mentionQuery.start);
    const after = text.slice(mentionQuery.start + 1 + mentionQuery.query.length);
    const insertion = `@${user.username} `;
    const next = before + insertion + after;
    setText(next);
    setMentionQuery(null);
    const caret = before.length + insertion.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  }

  function addFiles(files: File[]) {
    if (!files.length) return;
    const remainingSlots = MAX_ATTACHMENTS_PER_MESSAGE - readDraft(accountId, conversationId).pendingFiles.length;
    const accepted: PendingAttachment[] = [];
    let error: string | null = null;
    for (const file of files) {
      if (accepted.length >= remainingSlots) {
        error = `Máximo de ${MAX_ATTACHMENTS_PER_MESSAGE} anexos por mensagem.`;
        break;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        error = `"${file.name}" é grande demais (máximo ${formatSizeLimit(MAX_ATTACHMENT_BYTES)}).`;
        continue;
      }
      accepted.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      });
    }
    updateDraft((d) => ({ pendingFiles: accepted.length ? [...d.pendingFiles, ...accepted] : d.pendingFiles, attachError: error }));
  }

  useImperativeHandle(ref, () => ({ addFiles }));

  function removeFile(id: string) {
    updateDraft((d) => ({ pendingFiles: d.pendingFiles.filter((file) => file.id !== id) }));
  }

  function toggleCompress(next: boolean) {
    setCompressImages(next);
    setCompressImagesDefault(next);
  }

  async function submit() {
    // read from the store, not this render: Enter and a click landing in the
    // same tick would otherwise both see the text as unsent
    const current = readDraft(accountId, conversationId);
    if (!state.joined || current.upload) return;
    const trimmed = current.text.trim();
    const batch = current.pendingFiles;
    if (!batch.length && !trimmed) return;
    // the server would cut it silently; the counter already says why
    if (current.text.length > MAX_MESSAGE_LEN) return;
    stopTyping(); // sending is proof they stopped — don't wait for the idle timeout
    setMentionQuery(null);
    const replyTo = replyingTo?.msgId;
    const clearReplyIfStillHere = () => { if (conversationIdRef.current === conversationId) setReplyingTo(null); };

    if (!batch.length) {
      if (!sendChatMessage(conversationId, trimmed, replyTo)) {
        updateDraft(() => ({ attachError: 'Sem conexão com o servidor. A mensagem não foi enviada; tente de novo quando reconectar.' }));
        return;
      }
      updateDraft(() => ({ text: '', attachError: null }));
      clearReplyIfStillHere();
      return;
    }

    const resumeMsgId = current.partialBatchMsgId;
    // the batch is owned by the outbox from here: the field is free for the
    // next message while the files upload
    if (resumeMsgId == null && queueMessageWithFiles(conversationId, trimmed, replyTo, batch.map((item) => ({ file: item.file, compress: compressImages })))) {
      updateDraft(() => ({ text: '', pendingFiles: [], attachError: null }));
      clearReplyIfStillHere();
      return;
    }
    // Mark the first file as "uploading" immediately, before the network
    // round-trip, so the UI reacts the instant the user submits instead of
    // waiting on the first progress event to arrive.
    updateDraft(() => ({ attachError: null, upload: { activeFileId: batch[0]!.id, progress: 0 } }));
    try {
      const filesToSend = compressImages
        ? await Promise.all(batch.map((item) => (
            item.file.type.startsWith('image/') ? compressImageFile(item.file) : item.file
          )))
        : batch.map((item) => item.file);
      await sendAttachments({
        conversationId,
        files: filesToSend,
        // on resume the caption and reply already went out with the first file
        caption: resumeMsgId != null ? '' : trimmed,
        replyTo: resumeMsgId != null ? undefined : replyTo,
        targetMsgId: resumeMsgId ?? undefined,
        onProgress: (fileIndex, fraction) => {
          updateDraft(() => ({ upload: { activeFileId: batch[fileIndex]?.id ?? null, progress: fraction } }));
        },
        onFileSent: (fileIndex, msgId) => {
          const sentId = batch[fileIndex]!.id;
          const createdMessage = resumeMsgId == null && fileIndex === 0;
          updateDraft((d) => ({
            pendingFiles: d.pendingFiles.filter((file) => file.id !== sentId),
            ...(createdMessage ? { partialBatchMsgId: msgId, text: '' } : {}),
          }));
          if (createdMessage) clearReplyIfStillHere();
        },
      });
      // typed after a partial failure: the resumed files carry no caption,
      // so the text goes out as its own message rather than being dropped
      if (resumeMsgId != null && trimmed) sendChatMessage(conversationId, trimmed, replyTo);
      updateDraft(() => ({ partialBatchMsgId: null, text: '' }));
      clearReplyIfStillHere();
    } catch (err) {
      if (err instanceof PartialAttachmentError) {
        const failed = err.totalCount - err.failedIndex;
        updateDraft(() => ({
          attachError: failed === 1
            ? 'Um anexo não foi enviado. Envie de novo para tentar só ele.'
            : `${failed} anexos não foram enviados. Envie de novo para tentar só esses.`,
        }));
      } else if (resumeMsgId != null && err instanceof ApiError && UNRESUMABLE_TARGET_CODES.has(err.code)) {
        updateDraft(() => ({
          partialBatchMsgId: null,
          attachError: 'Não deu para completar a mensagem anterior. Envie de novo para mandar os anexos restantes numa nova mensagem.',
        }));
      } else {
        updateDraft(() => ({ attachError: err instanceof Error ? err.message : 'Falha ao enviar.' }));
      }
    } finally {
      updateDraft(() => ({ upload: null }));
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    // the mention dropdown intercepts navigation/confirm keys FIRST — while
    // it's open, Enter picks a mention instead of sending the message, and
    // arrows move the selection instead of the caret.
    if (mentionQuery && mentionCandidates.length) {
      if (event.key === 'ArrowDown') { event.preventDefault(); setMentionSelectedIndex((i) => (i + 1) % mentionCandidates.length); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); setMentionSelectedIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length); return; }
      if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); selectMention(mentionCandidates[mentionSelectedIndex]!); return; }
      if (event.key === 'Escape') { event.preventDefault(); setMentionQuery(null); return; }
    }
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submit();
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    addFiles(files);
  }

  function insertEmoji(emoji: string) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + emoji + text.slice(end));
    setEmojiPickerOpen(false);
    setMentionQuery(null);
    // caret restore has to wait for the controlled value to actually reach
    // the DOM (this same tick's setText hasn't rendered yet).
    requestAnimationFrame(() => {
      const caret = start + emoji.length;
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
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

  const remaining = MAX_MESSAGE_LEN - text.length;
  const showCounter = text.length >= COUNTER_THRESHOLD;
  const iconButton = 'flex-none rounded-full text-text-muted hover:text-text-primary';

  return (
    <div className="w-full flex-none px-2 pb-3 @min-[640px]/chat:px-4 @min-[640px]/chat:pb-4">
      <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileChange} />
      <input ref={imageInputRef} type="file" accept="image/*" multiple hidden onChange={handleFileChange} />

      <div className="relative flex flex-col rounded-2xl border border-white/10 bg-[rgb(18_18_20)] focus-within:border-white/20">
        {mentionQuery && mentionCandidates.length > 0 && (
          <div className="absolute inset-x-0 bottom-full z-20 mb-1 max-h-56 overflow-y-auto rounded-xl border border-white/10 bg-[rgb(24_24_27)] py-1 shadow-popover">
            <p className="select-none px-3 pb-1 pt-0.5 text-caption font-semibold uppercase text-text-muted">Mencionar alguém</p>
            {mentionCandidates.map((user, i) => (
              <button
                key={user.id}
                ref={(el) => { mentionOptionRefs.current[i] = el; }}
                type="button"
                // onMouseDown (not onClick) fires BEFORE the textarea's blur
                // — preventDefault stops that blur from happening at all, so
                // focus/caret position never leaves the field.
                onMouseDown={(event) => { event.preventDefault(); selectMention(user); }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left',
                  i === mentionSelectedIndex ? 'bg-white/8 text-text-primary' : 'text-text-secondary hover:bg-white/5'
                )}
              >
                <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={24} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-label font-medium">{user.displayName}</span>
                  <span className="block truncate text-caption text-text-muted">@{user.username}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {replyingTo && (
          <div className="flex items-center gap-2 border-b border-white/8 py-1.5 pl-3 pr-1.5 text-label">
            <Reply size={14} className="flex-none text-text-muted" />
            <span className="min-w-0 flex-1 truncate text-text-muted">
              Respondendo a <span className="font-medium text-text-secondary">{replyName}</span>
              {replyingTo.text ? <span> - {replyingTo.text}</span> : null}
            </span>
            <CloseButton size="xs" label="Cancelar resposta" onClick={() => setReplyingTo(null)} />
          </div>
        )}

        <AnimatePresence initial={false}>
          {pendingFiles.length > 0 && (
            <motion.div
              key="attachments"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              {/* one scrolling row keeps the tray from eating the history on a phone */}
              <div className="flex gap-2 overflow-x-auto px-2 pt-2">
                {pendingFiles.map((item) => {
                  const uploading = upload?.activeFileId === item.id;
                  return (
                    <motion.div
                      key={item.id}
                      layout
                      title={`${item.file.name} - ${formatFileSize(item.file.size)}`}
                      className={cn(
                        'relative flex-none overflow-hidden rounded-xl border border-white/10 bg-white/[0.04]',
                        item.previewUrl ? 'size-18' : 'flex w-56 items-center py-2.5 pl-2.5 pr-8'
                      )}
                    >
                      {item.previewUrl ? (
                        <img src={item.previewUrl} alt={item.file.name} className="size-full object-cover" />
                      ) : (
                        <DocumentAttachmentCard name={item.file.name} size={item.file.size} mime={item.file.type} className="min-w-0" />
                      )}
                      {uploading ? (
                        <>
                          <div className="absolute inset-0 bg-black/55" />
                          <div className="absolute inset-x-1.5 bottom-1.5"><UploadProgressBar progress={upload?.progress ?? 0} /></div>
                        </>
                      ) : (
                        <CloseButton variant="overlay" size="xs" label="Remover anexo" onClick={() => removeFile(item.id)} className="absolute right-1 top-1" />
                      )}
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {attachError && <p role="alert" className="mx-2 mt-2 rounded-lg border border-red/20 bg-red/10 px-3 py-2 text-label text-red">{attachError}</p>}

        <div className="flex items-end gap-1 p-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button type="button" variant="ghost" size="icon" aria-label="Adicionar" disabled={disabled} className={iconButton} />}
            >
              <Plus size={20} />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-64">
              <DropdownMenuItem onClick={() => fileInputRef.current?.click()}><Paperclip size={14} />Anexar arquivos</DropdownMenuItem>
              <DropdownMenuItem onClick={() => imageInputRef.current?.click()}><ImagePlus size={14} />Enviar imagens</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={compressImages} onCheckedChange={toggleCompress}>
                Compactar imagens (WebP)
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => {
              const value = event.target.value;
              setText(value);
              if (value.trim()) notifyTyping(); else stopTyping();
              syncMentionQuery(value, event.target.selectionStart ?? value.length);
            }}
            onSelect={handleTextareaSelect}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={disabled}
            rows={1}
            aria-label="Mensagem"
            aria-invalid={tooLong || undefined}
            aria-describedby={showCounter ? counterId : undefined}
            placeholder={pendingFiles.length ? 'Adicionar legenda' : 'Mensagem'}
            className="min-h-9 max-h-40 flex-1 resize-none border-none bg-transparent px-1 py-1.5 text-body shadow-none focus-visible:ring-0"
          />
          {showCounter && (
            <span id={counterId} className={cn('flex-none self-end px-1 pb-2.5 text-caption tabular-nums', tooLong ? 'font-semibold text-red' : 'text-text-muted')}>
              {remaining}
            </span>
          )}
          {/* below ~480px it moves into "+" so the text field keeps its room */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Enviar imagens"
            disabled={disabled}
            onClick={() => imageInputRef.current?.click()}
            className={cn(iconButton, 'hidden @min-[480px]/chat:inline-flex')}
          >
            <ImagePlus size={18} />
          </Button>
          <Popover open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
            <PopoverTrigger
              render={<Button type="button" variant="ghost" size="icon" aria-label="Inserir emoji" disabled={disabled} className={iconButton} />}
            >
              <Smile size={18} />
            </PopoverTrigger>
            <PopoverContent keepMounted={emojiPickerWarmed} className="w-75 p-0" side="top" align="end">
              <EmojiPicker className="h-80 w-full" onEmojiSelect={({ emoji }) => insertEmoji(emoji)}>
                <EmojiPickerSearch />
                <EmojiPickerContent />
              </EmojiPicker>
            </PopoverContent>
          </Popover>
          <Button
            type="button"
            size="icon"
            aria-label="Enviar mensagem"
            disabled={!canSubmit}
            onClick={() => void submit()}
            className="flex-none rounded-full"
          >
            <ArrowUp size={18} />
          </Button>
        </div>
      </div>
    </div>
  );
});
