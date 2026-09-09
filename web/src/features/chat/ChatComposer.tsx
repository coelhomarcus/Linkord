import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, FormEvent, KeyboardEvent, SyntheticEvent } from 'react';
import EmojiPicker, { Categories, EmojiStyle, Theme } from 'emoji-picker-react';
import type { CategoryConfig, EmojiClickData } from 'emoji-picker-react';
import { File as FileIcon, Plus, Reply, Send, Smile, X } from 'lucide-react';
import { useRoom } from '../../state/RoomContext';
import { PartialAttachmentError } from '../../state/RoomProvider';
import type { ChatMessage, PublicUser } from '../../types/protocol';
import type { PendingAttachment } from './ChatPage';
import { Textarea } from '@/components/ui/textarea';
import { Button, buttonVariants } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { UploadProgressBar } from '../../shared/UploadProgressBar';
import { formatFileSize } from '../../shared/lib/formatBytes';
import { Avatar } from '../../shared/Avatar';
import { cn } from '@/shared/lib/utils';

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
  // pending attachments live in ChatPage (so dropping a file anywhere on
  // the chat screen, not just this box, can add to them) — this component
  // only renders/edits them via these props.
  pendingFiles: PendingAttachment[];
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (id: string) => void;
  onClearFiles: () => void;
  attachError: string | null;
  onAttachError: (message: string | null) => void;
}

/** Chat message field — Enter sends, Shift+Enter breaks a line, grows on
 * its own up to a cap (field-sizing-content, already built into Textarea). */
export function ChatComposer({
  className, channelId, replyingTo, onCancelReply,
  pendingFiles, onAddFiles, onRemoveFile, onClearFiles, attachError, onAttachError,
}: ChatComposerProps) {
  const { state, sendChatMessage, sendAttachments, allUsers } = useRoom();
  const [text, setText] = useState('');
  // active "@query" under the cursor, or null when not mentioning anyone
  // right now (see getMentionQuery) — drives the autocomplete dropdown.
  const [mentionQuery, setMentionQuery] = useState<{ start: number; query: string } | null>(null);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  // id of whichever pendingFiles entry is currently uploading (uploads are
  // sequential — see RoomProvider.tsx#sendAttachments — so only one at a
  // time), null when nothing is in flight. Drives which card shows the
  // progress bar/disables its remove button.
  const [activeUploadId, setActiveUploadId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sendingFiles = activeUploadId !== null;

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

  // actually uploads the pending attachments — called only on send
  // (Enter/button), never when picking a file. The caption is whatever
  // text is in the field right now (can be empty). The FIRST file creates
  // the message; the rest (2nd-4th) attach to it (see
  // RoomProvider.tsx#sendAttachments) — sequential, so only one card shows
  // progress at a time.
  async function sendPendingFiles() {
    onAttachError(null);
    setUploadProgress(0);
    try {
      await sendAttachments(channelId, pendingFiles.map((p) => p.file), text.trim(), (fileIndex, fraction) => {
        setActiveUploadId(pendingFiles[fileIndex]?.id ?? null);
        setUploadProgress(fraction);
      });
      onClearFiles();
      setText('');
      setMentionQuery(null);
      onCancelReply?.();
    } catch (err) {
      if (err instanceof PartialAttachmentError) {
        // the message itself already exists (visible to everyone) with
        // whatever attached successfully — nothing left to retry here in
        // place, so just clear the list; the user can reattach and resend
        // the rest as a follow-up message if they want.
        onAttachError(`${err.sentCount} de ${err.totalCount} anexos enviados — os outros falharam. A mensagem ja foi enviada com os que deram certo.`);
        onClearFiles();
      } else {
        onAttachError(err instanceof Error ? err.message : 'Falha ao enviar os arquivos.');
      }
    } finally {
      setActiveUploadId(null);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (sendingFiles) return;
    if (pendingFiles.length) { void sendPendingFiles(); return; }
    const trimmed = text.trim();
    if (!trimmed) return;
    sendChatMessage(channelId, trimmed, replyingTo?.msgId);
    setText('');
    setMentionQuery(null);
    onCancelReply?.();
  }

  // users whose USERNAME or display name starts with the active "@query"
  // (case-insensitive) — capped so the dropdown never grows unreasonably
  // tall for a big roster. Matching on displayName too lets you find someone
  // by the name you actually recognize, even without remembering their handle.
  const mentionCandidates = useMemo(() => {
    if (!mentionQuery) return [];
    const q = mentionQuery.query.toLowerCase();
    return [...allUsers.values()]
      .filter((u) => u.username.toLowerCase().startsWith(q) || u.displayName.toLowerCase().startsWith(q))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
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
      else if (pendingFiles.length) { e.preventDefault(); onClearFiles(); }
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // lets the SAME file be picked again later
    if (files.length) onAddFiles(files);
  }

  // Ctrl+V with image(s) on the clipboard — same path as the clip button,
  // just a different file source. Without this, pasting an image would
  // paste whatever stray text/garbage the browser sometimes extracts from
  // an image clipboard entry (or nothing) — preventDefault only fires when
  // at least one image is FOUND, pasting normal text still works natively.
  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.items)
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file);
    if (!files.length) return;
    e.preventDefault();
    onAddFiles(files);
  }

  const disabled = !state.joined || sendingFiles;

  return (
    <div className={`flex flex-none flex-col gap-1.5 px-3 pb-3 ${className ?? ''}`}>
      {replyingTo && (() => {
        const replyAuthor = replyingTo.id ? allUsers.get(replyingTo.id) : undefined;
        const replyName = replyAuthor?.displayName ?? replyingTo.name;
        return (
          <div className="flex items-center gap-2 rounded-md border border-strong bg-bg-tertiary px-3 py-1.5 text-label">
            <Reply size={14} className="flex-none text-text-muted" />
            <Avatar id={replyingTo.id ?? replyingTo.name} name={replyName} avatar={replyAuthor?.avatar ?? replyingTo.avatar} avatarColor={replyAuthor?.avatarColor} size={20} />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium text-text-secondary">{replyName}</span>
              {replyingTo.text ? (
                <span className="text-text-muted"> — {replyingTo.text}</span>
              ) : replyingTo.attachments?.length ? (
                <span className="text-text-muted"> — 📎 {replyingTo.attachments.length > 1 ? `${replyingTo.attachments.length} anexos` : 'Anexo'}</span>
              ) : null}
            </span>
            <Button type="button" variant="ghost" size="icon-xs" aria-label="Cancelar resposta" onClick={onCancelReply} className="flex-none text-text-muted">
              <X size={14} />
            </Button>
          </div>
        );
      })()}
      {/* square Discord-style preview cards, one per pending file (up to
          MAX_ATTACHMENTS_PER_MESSAGE) — stay visible during the actual
          upload too, showing per-card progress instead of the remove
          button for whichever one is in flight. */}
      {pendingFiles.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {pendingFiles.map((p) => {
            const uploading = activeUploadId === p.id;
            return (
              <div
                key={p.id}
                title={`${p.file.name} · ${formatFileSize(p.file.size)}`}
                className="relative h-18 w-18 flex-none overflow-hidden rounded-md border border-strong bg-bg-tertiary"
              >
                {p.previewUrl ? (
                  <img src={p.previewUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-bg-textarea">
                    <FileIcon size={22} className="text-text-muted" />
                  </div>
                )}
                {uploading ? (
                  <>
                    <div className="absolute inset-0 bg-black/55" />
                    <div className="absolute inset-x-1.5 bottom-1.5"><UploadProgressBar progress={uploadProgress} /></div>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Remover anexo"
                    onClick={() => onRemoveFile(p.id)}
                    className="absolute right-0.5 top-0.5 size-5 rounded-full bg-black/60 text-white hover:bg-black/80 hover:text-white"
                  >
                    <X size={12} />
                  </Button>
                )}
              </div>
            );
          })}
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
            reply banner or pending attachments are showing above it. */}
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
                <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={24} />
                <span className="min-w-0 flex-1 truncate">
                  {user.displayName}
                  {user.displayName !== user.username && <span className="ml-1 text-text-muted">@{user.username}</span>}
                </span>
              </button>
            ))}
          </div>
        )}
        <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileChange} />
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
          placeholder={pendingFiles.length ? 'Adicionar uma legenda (opcional)' : 'Mandar mensagem'}
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
        <Button type="submit" size="icon-lg" disabled={disabled || (!text.trim() && !pendingFiles.length)}>
          <Send size={16} />
        </Button>
      </form>
    </div>
  );
}
