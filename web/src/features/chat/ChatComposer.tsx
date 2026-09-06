import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, DragEvent, FormEvent, KeyboardEvent, SyntheticEvent } from 'react';
import EmojiPicker, { Categories, EmojiStyle, Theme } from 'emoji-picker-react';
import type { CategoryConfig, EmojiClickData } from 'emoji-picker-react';
import { File as FileIcon, Plus, Send, Smile, Upload, X } from 'lucide-react';
import { useRoom } from '../../state/RoomContext';
import { MAX_ATTACHMENT_BYTES } from '../../types/protocol';
import type { ChatMessage, PublicUser } from '../../types/protocol';
import { Textarea } from '@/components/ui/textarea';
import { Button, buttonVariants } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { UploadProgressBar } from '../../shared/UploadProgressBar';
import { formatFileSize, formatSizeLimit } from '../../shared/lib/formatBytes';
import { Avatar } from '../../shared/Avatar';
import { cn } from '@/shared/lib/utils';
import { clearChatDraft, loadChatDraft, saveChatDraft } from './chatDrafts';

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
  if (!/\s/.test(charBefore)) return null;
  return { start: atIndex, query: match[1] ?? '' };
}

// category names in Portuguese — the library only ships English by
// default, and the rest of the app is Portuguese too.
const EMOJI_CATEGORIES: CategoryConfig[] = [
  { category: Categories.SUGGESTED, name: 'Usados recentemente' },
  { category: Categories.SMILEYS_PEOPLE, name: 'Carinhas e pessoas' },
  { category: Categories.ANIMALS_NATURE, name: 'Animais e natureza' },
  { category: Categories.FOOD_DRINK, name: 'Comidas e bebidas' },
  { category: Categories.TRAVEL_PLACES, name: 'Viagens e lugares' },
  { category: Categories.ACTIVITIES, name: 'Atividades' },
  { category: Categories.OBJECTS, name: 'Objetos' },
  { category: Categories.SYMBOLS, name: 'Simbolos' },
  { category: Categories.FLAGS, name: 'Bandeiras' },
];

interface ChatComposerProps {
  className?: string;
  channelId: string;
  replyingTo?: ChatMessage | null;
  onCancelReply?: () => void;
}

/** Chat message field — Enter sends, Shift+Enter breaks a line, grows on
 * its own up to a cap (field-sizing-content, already built into Textarea). */
export function ChatComposer({ className, channelId, replyingTo, onCancelReply }: ChatComposerProps) {
  const { state, sendChatMessage, sendAttachment, allUsers } = useRoom();
  const [text, setText] = useState(() => loadChatDraft(channelId));
  // active "@query" under the cursor, or null when not mentioning anyone
  // right now (see getMentionQuery) — drives the autocomplete dropdown.
  const [mentionQuery, setMentionQuery] = useState<{ start: number; query: string } | null>(null);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  // chosen/pasted file stays "attached" here — only actually uploads when
  // the message is sent (Enter/button), Discord-style: lets you type a
  // caption, change your mind (X), or swap the file before sending.
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null);
  const [sendingFile, setSendingFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // dragenter/dragleave fire for EVERY child element as the mouse crosses
  // the tree (entering a child = leaving the parent, leaving the child =
  // entering the parent again) — without a counter, isDragOver would
  // flicker every time the drag passed over anything inside the composer.
  // Only goes back to false once the counter truly hits zero.
  const dragCounterRef = useRef(0);

  useEffect(() => {
    saveChatDraft(channelId, text);
  }, [channelId, text]);

  // local preview (images only) via object URL — never uploads anything,
  // just reads the file already on disk. Revoked on change/removal to
  // avoid a memory leak.
  useEffect(() => {
    if (!pendingFile || !pendingFile.type.startsWith('image/')) {
      setPendingPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(pendingFile);
    setPendingPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFile]);

  // Discord-style "focus follows typing": typing anywhere in Chat sends
  // focus to the field without clicking it first. Only kicks in if no
  // OTHER text field is already focused, and only for a key that actually
  // types something (e.key.length === 1 covers letters/digits/symbols/
  // space, excludes Tab/Escape/arrows/F1 etc., which have longer names).
  useEffect(() => {
    function handleGlobalKeyDown(e: globalThis.KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      textareaRef.current?.focus();
    }
    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // actually uploads the pending attachment — called only on send
  // (Enter/button), never when picking the file. The caption is whatever
  // text is in the field right now (can be empty).
  async function sendPendingFile(file: File) {
    setAttachError(null);
    setUploadProgress(0);
    setSendingFile(true);
    try {
      await sendAttachment(channelId, file, text.trim(), setUploadProgress);
      setPendingFile(null);
      setText('');
      clearChatDraft(channelId);
      setMentionQuery(null);
      onCancelReply?.();
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'Falha ao enviar o arquivo.');
    } finally {
      setSendingFile(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (sendingFile) return;
    if (pendingFile) { void sendPendingFile(pendingFile); return; }
    const trimmed = text.trim();
    if (!trimmed) return;
    sendChatMessage(channelId, trimmed, replyingTo?.msgId);
    setText('');
    setMentionQuery(null);
    onCancelReply?.();
  }

  // users whose name starts with the active "@query" (case-insensitive) —
  // capped so the dropdown never grows unreasonably tall for a big roster.
  const mentionCandidates = useMemo(() => {
    if (!mentionQuery) return [];
    const q = mentionQuery.query.toLowerCase();
    return [...allUsers.values()]
      .filter((u) => u.username.toLowerCase().startsWith(q))
      .sort((a, b) => a.username.localeCompare(b.username))
      .slice(0, MAX_MENTION_RESULTS);
  }, [allUsers, mentionQuery]);

  // re-derives the active "@query" from wherever the cursor is now — called
  // after every edit (handleTextChange) and every cursor move that ISN'T an
  // edit (handleSelect: arrow keys, click), since either can start, change,
  // or leave a mention.
  function syncMentionQuery(value: string, cursor: number) {
    setMentionQuery(getMentionQuery(value, cursor));
    setMentionSelectedIndex(0);
  }

  function handleTextChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setText(e.target.value);
    syncMentionQuery(e.target.value, e.target.selectionStart ?? e.target.value.length);
  }

  function handleSelect(e: SyntheticEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    syncMentionQuery(el.value, el.selectionStart ?? 0);
  }

  // replaces the "@query" itself (not the whole field) with "@username " —
  // mirrors handleEmojiClick's cursor handling below.
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

  function removePendingFile() {
    setPendingFile(null);
    setAttachError(null);
  }

  // inserts at the CURSOR (not just the end) — clicking an emoji with text
  // already half-typed and the cursor mid-string should continue from
  // there, not jump the emoji to the end. selectionStart/End disappear as
  // soon as the field loses focus (the Popover steals it on open), so this
  // falls back to the end of the current text.
  function handleEmojiClick(data: EmojiClickData) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + data.emoji + text.slice(end);
    setText(next);
    setEmojiOpen(false);
    setMentionQuery(null);
    const caret = start + data.emoji.length;
    // the new value only exists in the DOM after the next render — setting
    // the selection in the same tick would still see the OLD text.
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // the mention dropdown intercepts navigation/confirm keys FIRST — while
    // it's open, Enter picks a mention instead of sending the message, and
    // arrows move the selection instead of the caret.
    if (mentionQuery && mentionCandidates.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionSelectedIndex((i) => (i + 1) % mentionCandidates.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionSelectedIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectMention(mentionCandidates[mentionSelectedIndex]!); return; }
      if (e.key === 'Escape') { e.preventDefault(); setMentionQuery(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      formRef.current?.requestSubmit();
    }
    if (e.key === 'Escape') {
      if (replyingTo) { e.preventDefault(); onCancelReply?.(); }
      else if (pendingFile) { e.preventDefault(); removePendingFile(); }
    }
  }

  // only attaches (doesn't upload yet) — shared by both the clip button
  // (handleFileChange) and pasting an image (handlePaste). Picking a new
  // file while one is already attached replaces it (one attachment per
  // message, per the current protocol).
  function attachFile(file: File) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setAttachError(`Arquivo muito grande (máximo ${formatSizeLimit(MAX_ATTACHMENT_BYTES)}).`);
      return;
    }
    setAttachError(null);
    setPendingFile(file);
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // lets the SAME file be picked again later
    if (file) attachFile(file);
  }

  // Ctrl+V with an image on the clipboard — same path as the clip button,
  // just a different file source. Without this, pasting an image would
  // paste whatever stray text/garbage the browser sometimes extracts from
  // an image clipboard entry (or nothing) — preventDefault only fires when
  // an image is FOUND, pasting normal text still works natively.
  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const item = Array.from(e.clipboardData.items).find((it) => it.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    const file = item.getAsFile();
    if (file) attachFile(file);
  }

  // dragging a file from the OS onto the composer — same attach path the
  // clip/paste already use (attachFile already validates size against
  // MAX_ATTACHMENT_BYTES above, not duplicated here).
  function handleDragEnter(e: DragEvent<HTMLDivElement>) {
    if (disabled || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    setIsDragOver(true);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (disabled || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault(); // without this the browser refuses the drop (opens the file in the tab instead)
  }

  function handleDragLeave(_e: DragEvent<HTMLDivElement>) {
    if (disabled) return;
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragOver(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    if (disabled) return;
    const file = e.dataTransfer.files[0];
    if (file) attachFile(file);
  }

  // Not gated on state.reconnecting: sendChatMessage now queues locally and
  // flushes on reconnect (see RoomProvider.tsx), and attachments already go
  // over their own HTTP upload, independent of the socket — blocking the
  // whole composer during a brief reconnect no longer buys anything.
  const disabled = !state.joined || sendingFile;

  return (
    <div
      className={`relative flex flex-none flex-col gap-1.5 px-3 pb-3 ${className ?? ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-10 mx-3 mb-3 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-blurple bg-bg-textarea/90">
          <Upload size={28} className="text-blurple" />
          <p className="select-none text-label font-medium text-text-primary">Solte pra enviar</p>
        </div>
      )}
      {replyingTo && (
        <div className="flex items-center gap-2 rounded-md border border-strong bg-bg-tertiary px-3 py-1.5 text-label">
          <span className="text-text-muted">Respondendo a</span>
          <span className="min-w-0 flex-1 truncate font-medium text-text-secondary">{replyingTo.name}</span>
          <Button type="button" variant="ghost" size="icon-xs" aria-label="Cancelar resposta" onClick={onCancelReply} className="text-text-muted">
            <X size={14} />
          </Button>
        </div>
      )}
      {/* stays visible during the actual upload too — only the X becomes a progress bar. */}
      {pendingFile && (
        <div className="flex flex-col gap-1.5 rounded-md border border-strong bg-bg-tertiary px-3 py-2">
          <div className="flex items-center gap-2.5">
            {pendingPreviewUrl ? (
              <img src={pendingPreviewUrl} alt="" className="h-10 w-10 flex-none rounded-md border border-strong object-cover" />
            ) : (
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-md border border-strong bg-bg-textarea">
                <FileIcon size={16} className="text-text-muted" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-label font-medium text-text-secondary">{pendingFile.name}</p>
              <p className="text-caption text-text-muted">
                {sendingFile ? `Enviando… ${Math.round(uploadProgress * 100)}%` : formatFileSize(pendingFile.size)}
              </p>
            </div>
            {!sendingFile && (
              <Button type="button" variant="ghost" size="icon-xs" aria-label="Remover anexo" onClick={removePendingFile} className="flex-none text-text-muted">
                <X size={14} />
              </Button>
            )}
          </div>
          {sendingFile && <UploadProgressBar progress={uploadProgress} />}
        </div>
      )}
      {attachError && (
        <p className="rounded-md border border-strong bg-red/12 px-3 py-1.5 text-label text-red">{attachError}</p>
      )}
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="relative flex items-end gap-1 rounded-xl border border-strong bg-bg-textarea py-1.5 pr-1.5 pl-1"
      >
        {/* absolute: positioned relative to the FORM, not the whole
            composer, so it sits right above the input row even when a
            reply banner or a pending attachment is showing above it. */}
        {mentionQuery && mentionCandidates.length > 0 && (
          <div className="absolute inset-x-0 bottom-full z-20 mb-1 max-h-56 overflow-y-auto rounded-md border border-strong bg-bg-floating py-1 shadow-popover">
            <p className="select-none px-3 pb-1 pt-0.5 text-caption font-semibold uppercase text-text-muted">Mencionar alguém</p>
            {mentionCandidates.map((user, i) => (
              <button
                key={user.id}
                type="button"
                // onMouseDown (not onClick) fires BEFORE the textarea's blur
                // — preventDefault stops that blur from happening at all, so
                // focus/caret position never leaves the field.
                onMouseDown={(e) => { e.preventDefault(); selectMention(user); }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-label',
                  i === mentionSelectedIndex ? 'bg-bg-selected text-text-primary' : 'text-text-secondary hover:bg-bg-hover'
                )}
              >
                <Avatar id={user.id} name={user.username} avatar={user.avatar} size={24} />
                <span className="truncate">{user.username}</span>
              </button>
            ))}
          </div>
        )}
        <input ref={fileInputRef} type="file" hidden onChange={handleFileChange} />
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label="Anexar arquivo"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
        >
          <Plus size={20} />
        </Button>
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextChange}
          onSelect={handleSelect}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={pendingFile ? 'Adicionar uma legenda (opcional)' : 'Mandar mensagem'}
          aria-label="Mensagem"
          maxLength={2000}
          disabled={disabled}
          rows={1}
          className="max-h-40 min-h-9 resize-none border-transparent bg-transparent py-1.5 text-body focus-visible:border-transparent focus-visible:ring-0"
        />
        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <PopoverTrigger
            aria-label="Escolher emoji"
            disabled={disabled}
            className={buttonVariants({ variant: 'ghost', size: 'icon-lg' })}
          >
            <Smile size={20} />
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-auto border-strong p-0">
            <EmojiPicker
              theme={Theme.DARK}
              emojiStyle={EmojiStyle.NATIVE}
              onEmojiClick={handleEmojiClick}
              categories={EMOJI_CATEGORIES}
              searchPlaceholder="Pesquisar"
              skinTonesDisabled
              previewConfig={{ showPreview: false }}
              width={320}
              height={380}
            />
          </PopoverContent>
        </Popover>
        <Button type="submit" size="icon-lg" aria-label="Enviar mensagem" disabled={disabled || (!text.trim() && !pendingFile)}>
          <Send size={16} />
        </Button>
      </form>
    </div>
  );
}
