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

function getMentionQuery(text: string, cursor: number): { start: number; query: string } | null {
  const upToCursor = text.slice(0, cursor);
  const match = /@([A-Za-z0-9_.-]{0,20})$/.exec(upToCursor);
  if (!match) return null;
  const atIndex = match.index;
  const charBefore = atIndex > 0 ? upToCursor[atIndex - 1] : ' ';
  if (!/\s/.test(charBefore)) return null;
  return { start: atIndex, query: match[1] ?? '' };
}

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
  pendingFiles: PendingAttachment[];
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (id: string) => void;
  onClearFiles: () => void;
  attachError: string | null;
  onAttachError: (message: string | null) => void;
}

export function ChatComposer({
  className, channelId, replyingTo, onCancelReply,
  pendingFiles, onAddFiles, onRemoveFile, onClearFiles, attachError, onAttachError,
}: ChatComposerProps) {
  const { state, sendChatMessage, sendAttachments, allUsers } = useRoom();
  const [text, setText] = useState('');
  const [mentionQuery, setMentionQuery] = useState<{ start: number; query: string } | null>(null);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const [activeUploadId, setActiveUploadId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sendingFiles = activeUploadId !== null;

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

  const mentionCandidates = useMemo(() => {
    if (!mentionQuery) return [];
    const q = mentionQuery.query.toLowerCase();
    return [...allUsers.values()]
      .filter((u) => u.username.toLowerCase().startsWith(q) || u.displayName.toLowerCase().startsWith(q))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .slice(0, MAX_MENTION_RESULTS);
  }, [allUsers, mentionQuery]);

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

  function handleEmojiClick(data: EmojiClickData) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + data.emoji + text.slice(end);
    setText(next);
    setEmojiOpen(false);
    setMentionQuery(null);
    const caret = start + data.emoji.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
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
    e.target.value = '';
    if (files.length) onAddFiles(files);
  }

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
        {mentionQuery && mentionCandidates.length > 0 && (
          <div className="absolute inset-x-0 bottom-full z-20 mb-1 max-h-56 overflow-y-auto rounded-md border border-strong bg-bg-floating py-1 shadow-popover">
            <p className="select-none px-3 pb-1 pt-0.5 text-caption font-semibold uppercase text-text-muted">Mencionar alguém</p>
            {mentionCandidates.map((user, i) => (
              <button
                key={user.id}
                type="button"
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
