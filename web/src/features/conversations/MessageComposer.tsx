import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ArrowUp, Paperclip, Reply, Smile, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmojiPicker, EmojiPickerContent, EmojiPickerSearch } from '@/components/ui/emoji-picker';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { DocumentAttachmentCard } from '@/shared/DocumentAttachmentCard';
import { UploadProgressBar } from '@/shared/UploadProgressBar';
import { formatFileSize, formatSizeLimit } from '@/shared/lib/formatBytes';
import { cn } from '@/shared/lib/utils';
import { useRoom } from '@/state/RoomContext';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_MESSAGE } from '@/types/protocol';

export interface PendingAttachment {
  id: string;
  file: File;
  previewUrl: string | null;
}

export function MessageComposer({ conversationId }: { conversationId: string }) {
  const { state, allUsers, sendChatMessage, sendAttachments, replyingTo, setReplyingTo } = useRoom();
  const [text, setText] = useState('');
  const [pendingFiles, setPendingFiles] = useState<PendingAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [activeUploadId, setActiveUploadId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingFilesRef = useRef<PendingAttachment[]>([]);
  const isSubmittingRef = useRef(false);
  const disabled = !state.joined || activeUploadId !== null;
  const canSubmit = !disabled && (text.trim().length > 0 || pendingFiles.length > 0);

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

  async function submit() {
    // Guard against a second submit firing before `disabled` (an async
    // state update) has re-rendered — e.g. a fast double-click, or Enter
    // and the send button both landing in the same tick.
    if (isSubmittingRef.current) return;
    const trimmed = text.trim();
    if (!pendingFiles.length && !trimmed) return;
    isSubmittingRef.current = true;
    try {
      if (pendingFiles.length) {
        setAttachError(null);
        setUploadProgress(0);
        // Mark the first file as "uploading" immediately, before the
        // network round-trip, so the UI reacts the instant the user submits
        // instead of waiting on the first progress event to arrive.
        setActiveUploadId(pendingFiles[0]?.id ?? null);
        await sendAttachments(conversationId, pendingFiles.map((item) => item.file), trimmed, (fileIndex, fraction) => {
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
        <div className="mb-2 flex flex-wrap gap-2">
          {pendingFiles.map((item) => {
            const uploading = activeUploadId === item.id;
            return (
              <div
                key={item.id}
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
                  <Button type="button" variant="ghost" size="icon-xs" aria-label="Remover anexo" onClick={() => removeFile(item.id)} className="absolute right-1 top-1 size-5 rounded-full bg-black/60 text-white hover:bg-black/80 hover:text-white">
                    <X size={12} />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {attachError && <p className="mb-2 rounded-lg border border-red/20 bg-red/10 px-3 py-2 text-label text-red">{attachError}</p>}

      <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileChange} />

      <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-[rgb(18_18_20)] p-2 shadow-[0_16px_50px_rgb(0_0_0_/_0.25)]">
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
          onChange={(event) => setText(event.target.value)}
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
          <PopoverContent className="w-75 p-0" side="top" align="end">
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
  );
}
