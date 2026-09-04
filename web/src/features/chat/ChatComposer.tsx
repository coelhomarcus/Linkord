import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, DragEvent, FormEvent, KeyboardEvent } from 'react';
import EmojiPicker, { Categories, EmojiStyle, Theme } from 'emoji-picker-react';
import type { CategoryConfig, EmojiClickData } from 'emoji-picker-react';
import { File as FileIcon, Plus, Send, Smile, Upload, X } from 'lucide-react';
import { useRoom } from '../../state/RoomContext';
import { MAX_ATTACHMENT_BYTES } from '../../types/protocol';
import type { ChatMessage } from '../../types/protocol';
import { Textarea } from '@/components/ui/textarea';
import { Button, buttonVariants } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { UploadProgressBar } from '../../shared/UploadProgressBar';
import { formatFileSize, formatSizeLimit } from '../../shared/lib/formatBytes';

// nomes de categoria em pt-BR — a lib so vem em ingles por padrao, e o
// resto do app inteiro e pt-BR (inclusive o placeholder do proprio campo de
// mensagem logo abaixo).
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

/** Campo de mensagem do chat — Enter manda, Shift+Enter quebra linha, cresce
 * sozinho ate um teto (field-sizing-content, ja embutido no Textarea). */
export function ChatComposer({ className, channelId, replyingTo, onCancelReply }: ChatComposerProps) {
  const { state, sendChatMessage, sendAttachment } = useRoom();
  const [text, setText] = useState('');
  // arquivo escolhido/colado fica "anexado" aqui — so sobe de verdade quando
  // a mensagem e enviada (Enter/botao), igual o Discord: da pra digitar uma
  // legenda, trocar de ideia (X) ou trocar o arquivo antes de mandar.
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
  // dragenter/dragleave disparam pra CADA elemento filho conforme o mouse
  // atravessa a arvore (entra no filho = leave do pai, sai do filho = enter
  // do pai de novo) — sem um contador, isDragOver piscaria toda vez que o
  // arrasto passasse por cima de qualquer coisa dentro do composer (a
  // pilula, o banner de resposta etc.). So volta a false quando o contador
  // zera de verdade (saiu de tudo).
  const dragCounterRef = useRef(0);

  // preview local (so pra imagem) via object URL — nao chega a subir nada,
  // e so leitura do arquivo que ja esta na maquina. Revoga ao trocar/remover
  // pra nao vazar memoria.
  useEffect(() => {
    if (!pendingFile || !pendingFile.type.startsWith('image/')) {
      setPendingPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(pendingFile);
    setPendingPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFile]);

  // "foco segue a digitacao" estilo Discord: comecar a digitar em qualquer
  // lugar do Chat manda o foco pro campo, sem precisar clicar nele primeiro.
  // So mexe se nenhum OUTRO campo de texto ja estiver focado (nome, busca,
  // um input de um modal aberto por cima etc.) e so pra tecla que realmente
  // digita algo (e.key.length === 1 cobre letras/numeros/simbolos/espaco,
  // exclui Tab/Escape/setas/F1/Shift, que tem nomes com mais de 1 caractere).
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

  // sobe o anexo pendente de verdade — chamado so ao mandar (Enter/botao),
  // nunca no momento de escolher o arquivo. A legenda e o texto atual do
  // campo, se houver (pode ir vazia).
  async function sendPendingFile(file: File) {
    setAttachError(null);
    setUploadProgress(0);
    setSendingFile(true);
    try {
      await sendAttachment(channelId, file, text.trim(), setUploadProgress);
      setPendingFile(null);
      setText('');
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
    onCancelReply?.();
  }

  function removePendingFile() {
    setPendingFile(null);
    setAttachError(null);
  }

  // insere no CURSOR (nao so no fim) — clicar um emoji com o texto ja
  // parcialmente digitado e o cursor no meio deve continuar dali, nao jogar
  // o emoji pro final. selectionStart/End some assim que o campo perde foco
  // (o Popover tira o foco do textarea ao abrir), entao cai pro fim do texto
  // atual como fallback razoavel.
  function handleEmojiClick(data: EmojiClickData) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + data.emoji + text.slice(end);
    setText(next);
    setEmojiOpen(false);
    const caret = start + data.emoji.length;
    // o valor novo so existe no DOM depois do proximo render — setar a
    // selecao no mesmo tick ainda pegaria o texto ANTIGO.
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      formRef.current?.requestSubmit();
    }
    if (e.key === 'Escape') {
      if (replyingTo) { e.preventDefault(); onCancelReply?.(); }
      else if (pendingFile) { e.preventDefault(); removePendingFile(); }
    }
  }

  // so anexa (nao sobe ainda) — reaproveitado tanto pelo clipe
  // (handleFileChange) quanto por colar imagem (handlePaste). Escolher um
  // arquivo novo enquanto ja tem um anexado troca pelo novo (so um anexo por
  // mensagem, igual o protocolo hoje).
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
    e.target.value = ''; // permite escolher o MESMO arquivo de novo depois
    if (file) attachFile(file);
  }

  // Ctrl+V com uma imagem na area de transferencia — mesmo caminho do clipe,
  // so a origem do arquivo que muda. Sem isso, colar uma imagem colava so o
  // texto/lixo que o navegador as vezes extrai do clipboard de imagem (ou
  // nada) — preventDefault so quando ACHA uma imagem, colar texto normal
  // continua funcionando do jeito nativo.
  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const item = Array.from(e.clipboardData.items).find((it) => it.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    const file = item.getAsFile();
    if (file) attachFile(file);
  }

  // arrastar um arquivo do sistema pra cima do composer — mesmo caminho de
  // anexo que o clipe/colar ja usam (attachFile ja valida o tamanho contra
  // MAX_ATTACHMENT_BYTES, ver acima; nao duplica essa checagem aqui).
  function handleDragEnter(e: DragEvent<HTMLDivElement>) {
    if (disabled || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    setIsDragOver(true);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (disabled || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault(); // sem isso o navegador recusa o drop (abre o arquivo na aba)
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

  const disabled = !state.joined || sendingFile;

  return (
    // sem border-t: o composer agora "flutua" sobre o bg-bg-panel (respiro
    // nas laterais/embaixo via padding), a propria pilula do campo (com sua
    // borda) e que separa visualmente — nao mais uma linha encostada no
    // topo, pedido explicito de estilo flutuante igual a referencia.
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
      {/* anexo escolhido/colado, ainda NAO enviado — Discord-like: da pra
          digitar uma legenda, trocar de ideia (X) ou so mandar assim mesmo.
          Continua visivel (com a barra por baixo) durante o envio de
          verdade tambem — so troca o X por progresso. */}
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
      {/* pilula unica, estilo Discord: anexar + campo + emoji + enviar todos
          DENTRO do mesmo contorno (era uma linha solta com o Textarea sendo
          o unico elemento com fundo proprio). O Textarea perde bg/borda
          proprios aqui (bg-transparent) pra virar uma continuacao visual da
          pilula, nao uma caixa dentro de outra caixa. */}
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="flex items-end gap-1 rounded-xl border border-strong bg-bg-textarea py-1.5 pr-1.5 pl-1"
      >
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
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={pendingFile ? 'Adicionar uma legenda (opcional)' : 'Mandar mensagem'}
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
        <Button type="submit" size="icon-lg" disabled={disabled || (!text.trim() && !pendingFile)}>
          <Send size={16} />
        </Button>
      </form>
    </div>
  );
}
