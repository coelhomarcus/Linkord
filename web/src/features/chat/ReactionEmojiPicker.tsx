import { EmojiPicker, EmojiPickerContent, EmojiPickerSearch } from '@/shared/ui/primitives/emoji-picker';
import { QuickReactionRow } from './QuickReactionRow';

interface ReactionEmojiPickerProps {
  /** Whether the full picker (as opposed to the quick row) is what should
   * currently be visible. */
  fullPickerOpen: boolean;
  /** From `useKeepPopoverWarm(fullPickerOpen)` in the caller — passed in
   * rather than computed here so the caller can also give the SAME value to
   * its `PopoverContent`/`ContextMenuContent`'s own `keepMounted`, keeping
   * one source of truth for "has this ever been opened". */
  warmed: boolean;
  onPick: (emoji: string) => void;
  onMore: () => void;
  quickRowClassName?: string;
}

/** The quick-reaction row that escalates to the full emoji picker on "mais"
 * — shared by MessageRow's reaction popover and GlobalContextMenu's message
 * block. Once the full picker has been opened once, it stays mounted
 * (hidden via `hidden`, not torn down) instead of frimousse re-fetching,
 * re-parsing and re-measuring its whole emoji dataset on every single open —
 * see useKeepPopoverWarm. Toggling `hidden` here (a plain DOM attribute, not
 * conditional rendering) is what actually keeps it alive across opens: the
 * enclosing Popover/ContextMenu's own `keepMounted` only stops IT from
 * unmounting the content on close, it does nothing to stop US from
 * unmounting our own children via a ternary. */
export function ReactionEmojiPicker({ fullPickerOpen, warmed, onPick, onMore, quickRowClassName }: ReactionEmojiPickerProps) {
  return (
    <>
      {!fullPickerOpen && <QuickReactionRow className={quickRowClassName} onPick={onPick} onMore={onMore} />}
      {warmed && (
        <div hidden={!fullPickerOpen}>
          <EmojiPicker className="h-80 w-full" onEmojiSelect={({ emoji }) => onPick(emoji)}>
            <EmojiPickerSearch />
            <EmojiPickerContent />
          </EmojiPicker>
        </div>
      )}
    </>
  );
}
