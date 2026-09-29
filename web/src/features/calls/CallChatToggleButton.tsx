import { MessageCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { buttonVariants } from '@/shared/ui/primitives/button';
import { cn } from '@/shared/lib/utils';

interface CallChatToggleButtonProps {
  chatOpen: boolean;
  onToggleChat: () => void;
  /** Fades out (but stays mounted, never affecting layout) when the HUD
   * auto-hides after inactivity — see useCallHud.ts. */
  hudVisible?: boolean;
}

// Top-right, not with the rest of the call controls at the bottom — its
// position doubles as a hint that it opens a side panel, same corner a
// sidebar toggle would live in.
export function CallChatToggleButton({ chatOpen, onToggleChat, hudVisible = true }: CallChatToggleButtonProps) {
  return (
    <div className={cn(
      'absolute right-[calc(1rem+env(safe-area-inset-right))] top-[calc(1rem+env(safe-area-inset-top))] z-20 transition-opacity duration-200 motion-reduce:transition-none',
      hudVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
    )}>
      <Tooltip>
        <TooltipTrigger
          onClick={onToggleChat}
          aria-label={chatOpen ? 'Fechar chat' : 'Abrir chat'}
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'icon-lg' }),
            'h-11 w-11 rounded-full border border-strong bg-bg-floating/90 shadow-popover backdrop-blur-xl',
            chatOpen ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'
          )}
        >
          <MessageCircle size={18} />
        </TooltipTrigger>
        <TooltipContent side="left">{chatOpen ? 'Fechar chat' : 'Abrir chat'}</TooltipContent>
      </Tooltip>
    </div>
  );
}
