import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent, DragOverEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Hash, HeadphoneOff, MicOff, MoreHorizontal, Pencil, ScreenShare, Trash2, Video, Volume2, X } from 'lucide-react';
import { useRoom } from '../state/RoomContext';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { PromptDialog } from '../shared/PromptDialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { sectionLabelClass } from '../shared/SectionLabel';
import { cn } from '@/shared/lib/utils';
import { useParticipantMedia, useIsSpeaking } from '../features/sharing/useLiveKitTrack';
import { Avatar, colorFor } from '../shared/Avatar';
import type { AppView } from './LeftSidebar';
import type { Category, Channel } from '../types/protocol';

/** Uma linha de participante conectado na chamada — decide sozinha se
 * aparece (so quem ativou o mic), mesmo padrao que ParticipantAudioLayer ja
 * usa pra decidir quem monta um <audio>. Aparece pra QUALQUER UM conectado,
 * nao so quando eu mesma estou na chamada — igual o Discord mostra quem
 * esta num canal de voz mesmo antes de voce entrar nele. Anel colorido
 * (mesma cor da borda de "falando" dos tiles, ver Tile.tsx) quando fala. */
function CallParticipantRow({ id, name, avatar }: { id: string; name: string; avatar: string }) {
  const { state, deafened } = useRoom();
  const media = useParticipantMedia(id);
  const isSpeaking = useIsSpeaking(id);
  if (!media.micActivated) return null;
  const tint = colorFor(id);
  // ensurdecido nao tem track no LiveKit (ver protocol.ts) — pra mim mesma
  // e o estado local (instantaneo); pros outros vem do Participant que o
  // servidor ja repassa (participant-updated).
  const isDeafened = id === state.me.id ? deafened : (state.participants.get(id)?.deafened ?? false);

  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-bg-hover">
      <div className="rounded-full transition-shadow" style={{ boxShadow: isSpeaking ? `0 0 0 2px ${tint}` : 'none' }}>
        <Avatar id={id} name={name} avatar={avatar} size={26} />
      </div>
      <span className="min-w-0 flex-1 truncate text-body text-text-secondary">{name}</span>
      {!!media.cameraTrack && <Video size={15} className="flex-none text-green" />}
      {!!media.screenTrack && <ScreenShare size={15} className="flex-none text-blurple" />}
      {/* ensurdecido ja implica mudo — mostrar os dois icones juntos seria
          redundante, igual o Discord so mostra o de ensurdecido nesse caso. */}
      {isDeafened ? (
        <HeadphoneOff size={15} className="flex-none text-red" />
      ) : (
        media.micMuted && <MicOff size={15} className="flex-none text-red" />
      )}
    </div>
  );
}

function SortableChannelRow({ channel, categoryId, active, unread, isAdmin, onSelect, onDelete }: {
  channel: Channel;
  categoryId: string;
  active: boolean;
  unread: number;
  isAdmin: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { renameChannel } = useRoom();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: channel.id,
    data: { type: 'channel' as const, categoryId },
    disabled: !isAdmin,
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="group/channel relative"
    >
      <button
        type="button"
        onClick={onSelect}
        {...(isAdmin ? attributes : {})}
        {...(isAdmin ? listeners : {})}
        className={cn(
          'flex w-full items-center gap-2 rounded-md py-2 pl-2.5 pr-7 text-body transition-colors',
          active
            ? 'bg-bg-channel-active text-text-primary'
            : unread > 0
              ? 'font-medium text-text-primary hover:bg-bg-hover'
              : 'text-text-muted hover:bg-bg-hover hover:text-text-secondary'
        )}
      >
        {channel.type === 'voice' ? <Volume2 size={18} className="flex-none" /> : <Hash size={18} className="flex-none" />}
        <span className="min-w-0 flex-1 truncate text-left">{channel.name}</span>
        {unread > 0 && (
          <span className="flex-none rounded-full bg-red px-1.5 py-0.5 text-caption font-bold leading-none text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {isAdmin && (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label="Mais opcoes do canal"
                className={cn(
                  'absolute right-1 top-1/2 h-5 w-5 -translate-y-1/2 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                  menuOpen ? 'flex' : 'hidden group-hover/channel:flex'
                )}
              />
            }
          >
            <MoreHorizontal size={14} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setRenameOpen(true)}>
              <Pencil size={14} />
              <span>Renomear</span>
            </DropdownMenuItem>
            {channel.type !== 'voice' && (
              <DropdownMenuItem variant="destructive" onClick={() => setConfirmOpen(true)}>
                <Trash2 size={14} />
                <span>Apagar</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <PromptDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="Renomear canal"
        label="Nome do canal"
        confirmLabel="Salvar"
        initialValue={channel.name}
        onConfirm={(name) => renameChannel(channel.id, name)}
      />
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Apagar canal"
        description={`Isso apaga "${channel.name}" e TODAS as mensagens dele pra sempre. Essa acao nao pode ser desfeita.`}
        confirmLabel="Apagar"
        destructive
        onConfirm={onDelete}
      />
    </div>
  );
}

function CategoryBlock({ category, activeView, activeChannelId, isAdmin, onSelectChannel }: {
  category: Category;
  activeView: AppView;
  activeChannelId: string | null;
  isAdmin: boolean;
  onSelectChannel: (channel: Channel) => void;
}) {
  const { state, unreadByChannel, deleteChannel, deleteCategory, renameCategory } = useRoom();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: category.id,
    data: { type: 'category' as const },
    disabled: !isAdmin,
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}>
      <div className="group/category flex items-center gap-1 px-2.5 pb-1 pt-3 first:pt-1.5">
        <p
          {...(isAdmin ? attributes : {})}
          {...(isAdmin ? listeners : {})}
          className={cn(
            'min-w-0 flex-1 truncate select-none text-label font-semibold uppercase tracking-wide text-text-muted',
            isAdmin && 'cursor-grab active:cursor-grabbing'
          )}
        >
          {category.name}
        </p>
        {isAdmin && (
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label="Mais opcoes da categoria"
                  className={cn(
                    'h-4 w-4 flex-none items-center justify-center rounded-sm text-text-muted transition-colors hover:text-text-secondary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                    menuOpen ? 'flex' : 'hidden group-hover/category:flex'
                  )}
                />
              }
            >
              <MoreHorizontal size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setRenameOpen(true)}>
                <Pencil size={14} />
                <span>Renomear</span>
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => setConfirmOpen(true)}>
                <Trash2 size={14} />
                <span>Apagar</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <SortableContext items={category.channels.map((ch) => ch.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-0.5">
          {category.channels.map((ch) => (
            <div key={ch.id}>
              <SortableChannelRow
                channel={ch}
                categoryId={category.id}
                active={ch.type === 'voice' ? activeView === 'call' : ch.id === activeChannelId}
                unread={unreadByChannel.get(ch.id) ?? 0}
                isAdmin={isAdmin}
                onSelect={() => onSelectChannel(ch)}
                onDelete={() => deleteChannel(ch.id)}
              />
              {ch.type === 'voice' && (
                <div className="ml-4 flex flex-col gap-0.5 py-0.5 pl-2">
                  {state.me.id && <CallParticipantRow id={state.me.id} name={state.me.name} avatar={state.me.avatar} />}
                  {[...state.participants.values()].map((p) => (
                    <CallParticipantRow key={p.id} id={p.id} name={p.name} avatar={p.avatar} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </SortableContext>

      <PromptDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="Renomear categoria"
        label="Nome da categoria"
        confirmLabel="Salvar"
        initialValue={category.name}
        onConfirm={(name) => renameCategory(category.id, name)}
      />
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Apagar categoria"
        description={`Isso apaga a categoria "${category.name}". Ela precisa estar vazia (sem canais). Apague os canais primeiro.`}
        confirmLabel="Apagar"
        destructive
        onConfirm={() => deleteCategory(category.id)}
      />
    </div>
  );
}

interface ChannelTreeProps {
  activeView: AppView;
  activeChannelId: string | null;
  onSelectChannel: (channel: Channel) => void;
}

/** Categorias/canais (texto E o unico canal de voz, a Chamada), com
 * drag-and-drop de verdade (admin) — reordenar categorias, reordenar canais
 * dentro de uma, e mover um canal pra OUTRA categoria arrastando (a Chamada
 * inclusive, ela e um canal como qualquer outro pro dnd-kit). `localCategories`
 * e um espelho otimista: o onDragOver ja "arrasta visualmente" um canal pra
 * outra categoria antes do servidor confirmar, e onDragEnd manda o pedido
 * final — a proxima `channels-tree` do servidor (fonte de verdade) sincroniza
 * de volta assim que chegar. */
export function ChannelTree({ activeView, activeChannelId, onSelectChannel }: ChannelTreeProps) {
  const { state, categories, reorderCategories, reorderChannels, channelsError, clearChannelsError } = useRoom();
  const isAdmin = state.me.role === 'admin';
  const [localCategories, setLocalCategories] = useState<Category[]>(categories);
  const draggingRef = useRef(false);

  useEffect(() => {
    if (!draggingRef.current) setLocalCategories(categories);
  }, [categories]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function findCategoryOf(channelId: string, cats: Category[]): Category | undefined {
    return cats.find((c) => c.channels.some((ch) => ch.id === channelId));
  }

  function handleDragStart() {
    draggingRef.current = true;
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    if (active.data.current?.type !== 'channel') return; // categoria so reordena no dragEnd

    setLocalCategories((prev) => {
      const fromCat = findCategoryOf(String(active.id), prev);
      if (!fromCat) return prev;
      const overType = over.data.current?.type;
      const toCatId = overType === 'channel' ? findCategoryOf(String(over.id), prev)?.id : String(over.id);
      if (!toCatId || fromCat.id === toCatId) return prev; // mesma categoria: dragEnd cuida via arrayMove

      const channel = fromCat.channels.find((ch) => ch.id === active.id);
      if (!channel) return prev;
      return prev.map((c) => {
        if (c.id === fromCat.id) return { ...c, channels: c.channels.filter((ch) => ch.id !== active.id) };
        if (c.id === toCatId) {
          const overIndex = c.channels.findIndex((ch) => ch.id === over.id);
          const channels = [...c.channels];
          channels.splice(overIndex === -1 ? channels.length : overIndex, 0, channel);
          return { ...c, channels };
        }
        return c;
      });
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    draggingRef.current = false;
    const { active, over } = event;
    if (!over) { setLocalCategories(categories); return; }

    if (active.data.current?.type === 'category') {
      if (over.data.current?.type !== 'category' || active.id === over.id) return;
      const oldIndex = localCategories.findIndex((c) => c.id === active.id);
      const newIndex = localCategories.findIndex((c) => c.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      const reordered = arrayMove(localCategories, oldIndex, newIndex);
      setLocalCategories(reordered);
      reorderCategories(reordered.map((c) => c.id));
      return;
    }

    // canal: onDragOver ja moveu localCategories pra outra categoria se
    // cruzou uma fronteira — so falta fixar a ordem final dentro de onde ele
    // pousou (reordenar a lista dessa categoria).
    const targetCat = findCategoryOf(String(active.id), localCategories);
    if (!targetCat) { setLocalCategories(categories); return; }
    const oldIndex = targetCat.channels.findIndex((ch) => ch.id === active.id);
    const overIsChannel = over.data.current?.type === 'channel';
    const newIndex = overIsChannel ? targetCat.channels.findIndex((ch) => ch.id === over.id) : targetCat.channels.length - 1;
    const reorderedChannels = oldIndex === -1 || newIndex === -1 ? targetCat.channels : arrayMove(targetCat.channels, oldIndex, newIndex);
    const finalCategories = localCategories.map((c) => (c.id === targetCat.id ? { ...c, channels: reorderedChannels } : c));
    setLocalCategories(finalCategories);
    reorderChannels(targetCat.id, reorderedChannels.map((ch) => ch.id));
  }

  return (
    <>
      {channelsError && (
        <div className="mx-1 mb-1 flex items-center gap-2 rounded-md bg-red/12 px-2.5 py-1.5 text-label text-red-text">
          <span className="min-w-0 flex-1">{channelsError}</span>
          <button type="button" onClick={clearChannelsError} aria-label="Dispensar" className="flex-none text-red-text/70 transition-colors hover:text-red-text focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <X size={14} />
          </button>
        </div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
        <SortableContext items={localCategories.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {localCategories.map((cat) => (
            <CategoryBlock key={cat.id} category={cat} activeView={activeView} activeChannelId={activeChannelId} isAdmin={isAdmin} onSelectChannel={onSelectChannel} />
          ))}
        </SortableContext>
      </DndContext>
    </>
  );
}

/** Criar canal — pedido pelo menu de contexto (botao direito) da sidebar,
 * nao mais um "+" inline: precisa escolher a categoria tambem, entao um
 * modal com Select cabe melhor do que um campinho de texto sozinho. */
export function NewChannelDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { categories, createChannel } = useRoom();
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');

  useEffect(() => {
    if (open) {
      setName('');
      setCategoryId(categories[0]?.id ?? '');
    }
  }, [open, categories]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !categoryId) return;
    createChannel(categoryId, trimmed);
    onOpenChange(false);
  }

  const selectedCategory = categories.find((c) => c.id === categoryId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-90 bg-bg-modal p-6">
        <DialogTitle className="text-title font-bold text-text-primary">Novo canal</DialogTitle>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className={sectionLabelClass}>Categoria</Label>
            <Select value={categoryId} onValueChange={(v) => v && setCategoryId(v)}>
              <SelectTrigger className="w-full">
                <SelectValue>{() => selectedCategory?.name ?? ''}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="newChannelName" className={sectionLabelClass}>Nome do canal</Label>
            <Input id="newChannelName" autoFocus maxLength={60} placeholder="novo-canal" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              <span>Cancelar</span>
            </Button>
            <Button type="submit" disabled={!name.trim() || !categoryId}>
              <span>Criar</span>
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
