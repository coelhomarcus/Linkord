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
import type { Category, Channel } from '../types/protocol';

/** A connected call participant's row — shows for ANYONE connected, not
 * just when I'm in the call myself, like Discord shows who's in a voice
 * channel even before you join it (membership comes from `voiceChannelId`,
 * Socket.IO, always live — see the filter at the call site). Colored ring
 * (same "speaking" border color as tiles, see Tile.tsx) while speaking.
 *
 * Media icons (camera/screen/mic/speaking) have two possible sources:
 * LiveKit, real-time but ONLY known for people in the SAME room I'm
 * connected to; and each participant's own Socket.IO self-report (see
 * protocol.ts's Participant fields and ClientMessage 'mic-state'/'camera'/
 * 'screen-share'/'speaking'), always available but one broadcast round-trip
 * behind. `viewerInSameChannel` picks which one to trust — never both, to
 * avoid a stale value from one leaking through when the other should win. */
function CallParticipantRow({ id, name, avatar, viewerInSameChannel }: {
  id: string; name: string; avatar: string; viewerInSameChannel: boolean;
}) {
  const { state, deafened } = useRoom();
  const media = useParticipantMedia(id);
  const isSpeakingLive = useIsSpeaking(id);
  const participant = state.participants.get(id); // socket-driven; undefined for "me"
  const isMe = id === state.me.id;
  // my own room IS whichever voice channel I'm connected to — always
  // trust LiveKit for myself, same as for anyone else in that same room.
  const trustLiveKit = isMe || viewerInSameChannel;
  const micActivated = trustLiveKit ? media.micActivated : (participant?.micActivated ?? false);
  const micMuted = trustLiveKit ? media.micMuted : (participant?.micMuted ?? true);
  const cameraOn = trustLiveKit ? !!media.cameraTrack : (participant?.cameraOn ?? false);
  const sharing = trustLiveKit ? !!media.screenTrack : (participant?.sharing ?? false);
  // speaking border only shows when I can actually verify it myself
  // (LiveKit, same room) — the Socket.IO self-report is accurate but noisy
  // to show for a call I'm not in, so it's ignored here on purpose.
  const isSpeaking = trustLiveKit && isSpeakingLive;
  const tint = colorFor(id);
  // deafened has no LiveKit track (see protocol.ts) — for myself it's
  // local state (instant); for others it comes from the Participant the
  // server relays (participant-updated).
  const isDeafened = isMe ? deafened : (participant?.deafened ?? false);

  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-bg-hover">
      <div className="rounded-full transition-shadow" style={{ boxShadow: isSpeaking ? `0 0 0 2px ${tint}` : 'none' }}>
        <Avatar id={id} name={name} avatar={avatar} size={26} />
      </div>
      <span className="min-w-0 flex-1 truncate text-body text-text-secondary">{name}</span>
      {cameraOn && <Video size={15} className="flex-none text-green" />}
      {sharing && <ScreenShare size={15} className="flex-none text-blurple" />}
      {/* deafened already implies muted — showing both icons would be
          redundant, same as Discord only showing the deafened one. */}
      {isDeafened ? (
        <HeadphoneOff size={15} className="flex-none text-red" />
      ) : (
        micActivated && micMuted && <MicOff size={15} className="flex-none text-red" />
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
            <DropdownMenuItem variant="destructive" onClick={() => setConfirmOpen(true)}>
              <Trash2 size={14} />
              <span>Apagar</span>
            </DropdownMenuItem>
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
        description={
          channel.type === 'voice'
            ? `Isso apaga o canal de voz "${channel.name}" pra sempre. Essa acao nao pode ser desfeita.`
            : `Isso apaga "${channel.name}" e TODAS as mensagens dele pra sempre. Essa acao nao pode ser desfeita.`
        }
        confirmLabel="Apagar"
        destructive
        onConfirm={onDelete}
      />
    </div>
  );
}

function CategoryBlock({ category, activeChannelId, isAdmin, onSelectChannel }: {
  category: Category;
  activeChannelId: string | null;
  isAdmin: boolean;
  onSelectChannel: (channel: Channel) => void;
}) {
  const { state, activeVoiceChannelId, unreadByChannel, deleteChannel, deleteCategory, renameCategory } = useRoom();
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
                active={ch.type === 'voice' ? ch.id === activeVoiceChannelId : ch.id === activeChannelId}
                unread={unreadByChannel.get(ch.id) ?? 0}
                isAdmin={isAdmin}
                onSelect={() => onSelectChannel(ch)}
                onDelete={() => deleteChannel(ch.id)}
              />
              {ch.type === 'voice' && (
                <div className="ml-4 flex flex-col gap-0.5 py-0.5 pl-2">
                  {state.me.id && activeVoiceChannelId === ch.id && (
                    <CallParticipantRow id={state.me.id} name={state.me.name} avatar={state.me.avatar} viewerInSameChannel />
                  )}
                  {[...state.participants.values()].filter((p) => p.voiceChannelId === ch.id).map((p) => (
                    <CallParticipantRow key={p.id} id={p.id} name={p.name} avatar={p.avatar} viewerInSameChannel={activeVoiceChannelId === ch.id} />
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
  activeChannelId: string | null;
  onSelectChannel: (channel: Channel) => void;
}

/** Categories/channels (text and voice), with real drag-and-drop (admin) —
 * reordering categories, reordering channels within one, and dragging a
 * channel into ANOTHER category (voice channels included, just another
 * channel to dnd-kit). `localCategories` is an optimistic mirror: onDragOver
 * already "visually drags" a channel into another category before the
 * server confirms, and onDragEnd sends the final request — the next
 * `channels-tree` from the server (source of truth) syncs back once it
 * arrives. */
export function ChannelTree({ activeChannelId, onSelectChannel }: ChannelTreeProps) {
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
    if (active.data.current?.type !== 'channel') return; // a category only reorders on dragEnd

    setLocalCategories((prev) => {
      const fromCat = findCategoryOf(String(active.id), prev);
      if (!fromCat) return prev;
      const overType = over.data.current?.type;
      const toCatId = overType === 'channel' ? findCategoryOf(String(over.id), prev)?.id : String(over.id);
      if (!toCatId || fromCat.id === toCatId) return prev; // same category: dragEnd handles it via arrayMove

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

    // channel: onDragOver already moved localCategories to another category
    // if it crossed a boundary — just needs the final order fixed within
    // wherever it landed (reorder that category's list).
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
            <CategoryBlock key={cat.id} category={cat} activeChannelId={activeChannelId} isAdmin={isAdmin} onSelectChannel={onSelectChannel} />
          ))}
        </SortableContext>
      </DndContext>
    </>
  );
}

/** Create a channel — requested from the sidebar's context menu
 * (right-click), no longer an inline "+": also needs picking a category,
 * so a modal with a Select fits better than a lone text field. */
export function NewChannelDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { categories, createChannel } = useRoom();
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [type, setType] = useState<'text' | 'voice'>('text');

  useEffect(() => {
    if (open) {
      setName('');
      setCategoryId(categories[0]?.id ?? '');
      setType('text');
    }
  }, [open, categories]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !categoryId) return;
    createChannel(categoryId, trimmed, type);
    onOpenChange(false);
  }

  const selectedCategory = categories.find((c) => c.id === categoryId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] bg-bg-modal p-6 sm:max-w-90">
        <DialogTitle className="text-title font-bold text-text-primary">Novo canal</DialogTitle>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className={sectionLabelClass}>Tipo</Label>
            <div className="flex gap-2">
              <Button type="button" variant={type === 'text' ? 'default' : 'outline'} className="flex-1" onClick={() => setType('text')}>
                <Hash size={16} />
                <span>Texto</span>
              </Button>
              <Button type="button" variant={type === 'voice' ? 'default' : 'outline'} className="flex-1" onClick={() => setType('voice')}>
                <Volume2 size={16} />
                <span>Voz</span>
              </Button>
            </div>
          </div>
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
