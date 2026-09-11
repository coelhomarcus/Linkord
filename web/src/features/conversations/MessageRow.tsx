import { useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { MoreHorizontal, Pencil, Reply, SmilePlus, Trash2 } from 'lucide-react';
import { Avatar } from '@/shared/Avatar';
import { ChatAttachment, IMAGE_MIME_TYPES } from '@/features/chat/ChatAttachment';
import { ImageAttachmentGrid } from '@/features/chat/ImageAttachmentGrid';
import { ChatMessageText } from '@/features/chat/ChatMessageText';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EmojiPicker, EmojiPickerContent, EmojiPickerSearch } from '@/components/ui/emoji-picker';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { formatTime } from '@/shared/lib/formatChatTime';
import { mentionsUser } from '@/shared/lib/mentions';
import { cn } from '@/shared/lib/utils';
import { useRoom } from '@/state/RoomContext';
import type { ChatMessage, PublicUser, ReactionEmoji } from '@/types/protocol';

const DELETED_AUTHOR_NAME = 'Usuario apagado';

function ReactionButton({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button type="button" variant="ghost" size="icon-xs" aria-label="Reagir" />}>
        <SmilePlus size={13} />
      </PopoverTrigger>
      <PopoverContent className="w-75 p-0" side="top" align="center">
        <EmojiPicker
          className="h-80 w-full"
          onEmojiSelect={({ emoji }) => {
            onPick(emoji);
            setOpen(false);
          }}
        >
          <EmojiPickerSearch />
          <EmojiPickerContent />
        </EmojiPicker>
      </PopoverContent>
    </Popover>
  );
}

interface MessageRowProps {
  message: ChatMessage;
  showHeader: boolean;
  highlighted: boolean;
  allUsers: Map<string, PublicUser>;
  mentionLookup: Map<string, PublicUser>;
  onOpenProfile: (userId: string) => void;
  onReply: () => void;
  onJumpTo: (msgId: number) => void;
}

export function MessageRow({ message, showHeader, highlighted, allUsers, mentionLookup, onOpenProfile, onReply, onJumpTo }: MessageRowProps) {
  const { state, deleteChatMessage, editChatMessage, reactToChatMessage, editingMsgId, setEditingMsgId } = useRoom();
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

  function startEdit() {
    setEditText(message.text);
    setEditingMsgId(message.msgId);
  }

  function handleEditKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      saveEdit();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setEditingMsgId(null);
      setEditText(message.text);
    }
  }

  return (
    <div
      id={`chat-msg-${message.msgId}`}
      data-message-id={message.msgId}
      className={cn(
        'group/row relative flex gap-3 rounded-md px-4 py-0.5',
        showHeader ? 'mt-[17px]' : 'mt-0',
        'hover:bg-white/[0.03]',
        mentionsMe && 'border-l-2 border-yellow/50 bg-yellow/[0.06] pl-[calc(1rem-2px)] hover:bg-yellow/[0.08]',
        highlighted && 'bg-primary/10'
      )}
    >
      <div className="w-10 flex-none">
        {showHeader && (
          message.id ? (
            <button type="button" onClick={() => onOpenProfile(message.id!)} className="mt-0.5 block rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Avatar id={message.id} name={displayedName} avatar={displayedAvatar} avatarColor={author?.avatarColor} size={40} />
            </button>
          ) : (
            <Avatar id={message.name} name={displayedName} avatar={displayedAvatar} avatarColor={null} size={40} />
          )
        )}
      </div>

      <div className="min-w-0 flex-1">
        {showHeader && (
          <div className="flex items-baseline gap-2">
            {message.id ? (
              <button type="button" onClick={() => onOpenProfile(message.id!)} className="truncate text-body font-medium text-text-primary hover:underline">
                {displayedName}
              </button>
            ) : (
              <span className="truncate text-body font-medium text-text-primary">{displayedName}</span>
            )}
            <span className="flex-none text-[11px] text-text-muted">{formatTime(message.ts)}</span>
          </div>
        )}

        <div className="max-w-[680px]">
          {message.replyTo && (
            <button
              type="button"
              onClick={() => onJumpTo(message.replyTo!.msgId)}
              className="mb-1 flex max-w-full items-center gap-1.5 truncate text-caption text-text-muted hover:text-text-secondary"
            >
              <Reply size={12} className="flex-none -scale-x-100" />
              <span className="flex-none font-medium text-text-secondary">{replyAuthor?.displayName ?? DELETED_AUTHOR_NAME}</span>
              {message.replyTo.text && <span className="truncate">{message.replyTo.text}</span>}
            </button>
          )}

          {isEditing ? (
            <div className="flex flex-col gap-1.5 py-0.5">
              <Textarea
                value={editText}
                onChange={(event) => setEditText(event.target.value)}
                onKeyDown={handleEditKeyDown}
                autoFocus
                rows={1}
                className="min-h-9 resize-none border-white/15 bg-black/20 text-body"
              />
              <p className="text-caption text-text-muted">
                escape para <button type="button" onClick={() => setEditingMsgId(null)} className="underline hover:text-text-secondary">cancelar</button> · enter para <button type="button" onClick={saveEdit} className="underline hover:text-text-secondary">salvar</button>
              </p>
            </div>
          ) : (
            <>
              <div className="text-body leading-[1.375rem] text-text-secondary">
                <ChatMessageText text={message.text} mentionLookup={mentionLookup} myUserId={state.me.userId} />
                {message.editedAt && <span className="ml-1 text-caption text-text-muted">(editado)</span>}
              </div>
              {message.attachments?.length === 4 && message.attachments.every((a) => IMAGE_MIME_TYPES.has(a.mime)) ? (
                <ImageAttachmentGrid attachments={message.attachments} />
              ) : (
                message.attachments?.map((attachment) => (
                  <ChatAttachment key={attachment.id} attachment={attachment} />
                ))
              )}
            </>
          )}
        </div>

        {message.reactions && (
          <div className="mt-1 flex flex-wrap gap-1">
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

      {/* Desktop hover toolbar — right-click (GlobalContextMenu) covers the
          same actions, this is just the discoverable, no-right-click path.
          Stays laid out (flex) at all times at md+ and only fades via
          opacity/pointer-events on hover — toggling `display` here instead
          would collapse the reaction trigger's anchor rect to zero the
          moment the mouse leaves the row (e.g. to move onto the open emoji
          picker, which is portaled outside this row), snapping the open
          popover to the viewport's top-left corner. */}
      <div className="absolute right-3 top-0 hidden -translate-y-1/2 items-center gap-0.5 rounded-full border border-white/10 bg-[rgb(20_20_23)] p-0.5 opacity-0 shadow-popover transition-opacity pointer-events-none group-hover/row:opacity-100 group-hover/row:pointer-events-auto md:flex">
        <ReactionButton onPick={(emoji) => reactToChatMessage(message.msgId, emoji)} />
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Responder" onClick={onReply}>
          <Reply size={13} />
        </Button>
        {isMine && (
          <Button type="button" variant="ghost" size="icon-xs" aria-label="Editar" onClick={startEdit}>
            <Pencil size={13} />
          </Button>
        )}
        {canDelete && (
          <Button type="button" variant="ghost" size="icon-xs" aria-label="Apagar" onClick={() => deleteChatMessage(message.msgId)} className="hover:bg-red/10 hover:text-red">
            <Trash2 size={13} />
          </Button>
        )}
      </div>

      {/* Mobile — no hover, so the toolbar above is unreachable; a persistent
          reaction button plus a tap menu for the rest cover the same actions. */}
      <div className="absolute right-3 top-1 flex items-center gap-0.5 md:hidden">
        <ReactionButton onPick={(emoji) => reactToChatMessage(message.msgId, emoji)} />
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-xs" aria-label="Acoes" />}>
            <MoreHorizontal size={13} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onReply}><Reply size={14} />Responder</DropdownMenuItem>
            {isMine && <DropdownMenuItem onClick={startEdit}><Pencil size={14} />Editar</DropdownMenuItem>}
            {canDelete && <DropdownMenuItem variant="destructive" onClick={() => deleteChatMessage(message.msgId)}><Trash2 size={14} />Apagar</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
