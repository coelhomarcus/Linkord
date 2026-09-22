import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, KeyboardEvent as ReactKeyboardEvent, SyntheticEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp, Paperclip, Reply, Smile } from 'lucide-react';
import { CloseButton } from '@/shared/ui/primitives/close-button';
import { Button } from '@/shared/ui/primitives/button';
import { EmojiPicker, EmojiPickerContent, EmojiPickerSearch } from '@/shared/ui/primitives/emoji-picker';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/primitives/popover';
import { Switch } from '@/shared/ui/primitives/switch';
import { Textarea } from '@/shared/ui/primitives/textarea';
import { Avatar } from '@/shared/Avatar';
import { DocumentAttachmentCard } from '@/features/media/DocumentAttachmentCard';
import { UploadProgressBar } from '@/shared/UploadProgressBar';
import { useKeepPopoverWarm } from '@/shared/hooks/useKeepPopoverWarm';
import { compressImageFile } from '@/shared/lib/compressImageFile';
import { formatFileSize, formatSizeLimit } from '@/shared/lib/formatBytes';
import { cn } from '@/shared/lib/utils';
import { useRoom } from '@/state/RoomContext';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_MESSAGE } from '@/shared/types/protocol';
import type { PublicUser } from '@/shared/types/protocol';

export interface PendingAttachment {
  id: string;
  file: File;
  previewUrl: string | null;
}

// How often notifyTyping actually emits typing:true while the user keeps
// typing (leading-edge: fires right away after being idle, then throttles),
// and how long without a keystroke before it emits typing:false on its own.
const TYPING_THROTTLE_MS = 3000;
const TYPING_IDLE_MS = 5000;

const MAX_MENTION_RESULTS = 8;

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

export interface MessageComposerHandle {
  addFiles: (files: File[]) => void;
}

export const MessageComposer = forwardRef<MessageComposerHandle, { conversationId: string }>(function MessageComposer({ conversationId }, ref) {
  const { state, allUsers, conversations, sendChatMessage, sendAttachments, sendTyping, replyingTo, setReplyingTo, compressImagesDefault, setCompressImagesDefault } = useRoom();
  const [text, setText] = useState('');
  const [compressImages, setCompressImages] = useState(compressImagesDefault);
  const [pendingFiles, setPendingFiles] = useState<PendingAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [activeUploadId, setActiveUploadId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingFilesRef = useRef<PendingAttachment[]>([]);
  const isSubmittingRef = useRef(false);
  const typingThrottleRef = useRef<number | null>(null); // Date.now() of the last emitted typing:true
  const typingIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const disabled = !state.joined || activeUploadId !== null;
  const canSubmit = !disabled && (text.trim().length > 0 || pendingFiles.length > 0);

  // Keeps the arrow-key-highlighted mention option visible — without this,
  // ArrowDown/ArrowUp move mentionSelectedIndex past the dropdown's visible
  // rows (it's capped at max-h-56) with no compensating scroll.
  useEffect(() => {
    mentionOptionRefs.current[mentionSelectedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [mentionSelectedIndex, mentionQuery]);

  useEffect(() => { pendingFilesRef.current = pendingFiles; }, [pendingFiles]);
  useEffect(() => () => {
    pendingFilesRef.current.forEach((file) => {
      if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
    });
  }, []);

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
    const remainingSlots = MAX_ATTACHMENTS_PER_MESSAGE - pendingFiles.length;
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
    if (accepted.length) setPendingFiles((prev) => [...prev, ...accepted]);
    setAttachError(error);
  }

  useImperativeHandle(ref, () => ({ addFiles }));

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

  function toggleCompress(next: boolean) {
    setCompressImages(next);
    setCompressImagesDefault(next);
  }

  async function submit() {
    // Guard against a second submit firing before `disabled` (an async
    // state update) has re-rendered — e.g. a fast double-click, or Enter
    // and the send button both landing in the same tick.
    if (isSubmittingRef.current) return;
    const trimmed = text.trim();
    if (!pendingFiles.length && !trimmed) return;
    isSubmittingRef.current = true;
    stopTyping(); // sending is proof they stopped — don't wait for the idle timeout
    setMentionQuery(null);
    try {
      if (pendingFiles.length) {
        setAttachError(null);
        setUploadProgress(0);
        // Mark the first file as "uploading" immediately, before the
        // network round-trip, so the UI reacts the instant the user submits
        // instead of waiting on the first progress event to arrive.
        setActiveUploadId(pendingFiles[0]?.id ?? null);
        const filesToSend = compressImages
          ? await Promise.all(pendingFiles.map((item) => (
              item.file.type.startsWith('image/') ? compressImageFile(item.file) : item.file
            )))
          : pendingFiles.map((item) => item.file);
        await sendAttachments(conversationId, filesToSend, trimmed, (fileIndex, fraction) => {
          setActiveUploadId(pendingFiles[fileIndex]?.id ?? null);
          setUploadProgress(fraction);
        });
        clearFiles();
        setText('');
        setReplyingTo(null);
        return;
      }
      sendChatMessage(conversationId, trimmed, replyingTo?.msgId);
      setText('');
      setReplyingTo(null);
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'Falha ao enviar.');
    } finally {
      isSubmittingRef.current = false;
      setActiveUploadId(null);
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

  return (
    <div className="w-full flex-none px-2 pb-4">
      {replyingTo && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-white/10 bg-[rgb(18_18_20)] px-3 py-2 text-label">
          <Reply size={14} className="text-text-muted" />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium text-text-secondary">{replyName}</span>
            {replyingTo.text ? <span className="text-text-muted"> - {replyingTo.text}</span> : null}
          </span>
          <CloseButton size="xs" label="Cancelar resposta" onClick={() => setReplyingTo(null)} />
        </div>
      )}

      <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileChange} />

      <div className="relative flex flex-col gap-2 rounded-2xl border border-white/10 bg-[rgb(18_18_20)] p-2 shadow-[0_16px_50px_rgb(0_0_0_/_0.25)]">
        {mentionQuery && mentionCandidates.length > 0 && (
          <div className="absolute inset-x-0 bottom-full z-20 mb-1 max-h-56 overflow-y-auto rounded-xl border border-white/10 bg-[rgb(24_24_27)] py-1 shadow-[0_16px_50px_rgb(0_0_0_/_0.25)]">
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
              <div className="flex flex-wrap gap-2 px-1 pt-1">
                {pendingFiles.map((item) => {
                  const uploading = activeUploadId === item.id;
                  return (
                    <motion.div
                      key={item.id}
                      layout
                      title={`${item.file.name} - ${formatFileSize(item.file.size)}`}
                      className={cn(
                        'relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.04]',
                        item.previewUrl ? 'size-18' : 'flex w-56 max-w-full items-center py-2.5 pl-2.5 pr-8'
                      )}
                    >
                      {item.previewUrl ? (
                        <img src={item.previewUrl} alt="" className="size-full object-cover" />
                      ) : (
                        <DocumentAttachmentCard name={item.file.name} size={item.file.size} mime={item.file.type} className="min-w-0" />
                      )}
                      {uploading ? (
                        <>
                          <div className="absolute inset-0 bg-black/55" />
                          <div className="absolute inset-x-1.5 bottom-1.5"><UploadProgressBar progress={uploadProgress} /></div>
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

        {pendingFiles.some((item) => item.file.type.startsWith('image/')) && (
          <div className="flex items-center gap-2 px-1 text-label text-text-muted">
            <Switch checked={compressImages} onCheckedChange={toggleCompress} size="sm" aria-label="Compactar imagens antes de enviar" />
            <span className="select-none">Compactar imagens (WebP)</span>
          </div>
        )}

        {attachError && <p className="rounded-lg border border-red/20 bg-red/10 px-3 py-2 text-label text-red">{attachError}</p>}

        <div className="flex items-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Anexar arquivo"
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
            className="flex-none rounded-full text-text-muted hover:text-text-primary"
          >
            <Paperclip size={18} />
          </Button>
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
            maxLength={2000}
            rows={1}
            placeholder={pendingFiles.length ? 'Adicionar legenda' : 'Mensagem'}
            className="min-h-9 max-h-40 flex-1 resize-none border-none bg-transparent px-1 py-1.5 text-body shadow-none focus-visible:ring-0"
          />
          <Popover open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Inserir emoji"
                  disabled={disabled}
                  className="flex-none rounded-full text-text-muted hover:text-text-primary"
                />
              }
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
