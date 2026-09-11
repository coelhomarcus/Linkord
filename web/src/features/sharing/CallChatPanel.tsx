import { motion } from 'motion/react';
import { MessageCircle, X } from 'lucide-react';
import { useAnimatedSidebar } from '@/components/motion/animated-sidebar';
import { Drawer } from '@/components/motion/drawer';
import { Button } from '@/components/ui/button';
import { SPRING_LAYOUT } from '@/shared/lib/ease';
import { ChatSurfaceWidthProvider } from '@/shared/lib/chatSurfaceWidth';
import { useRoom } from '@/state/RoomContext';
import { conversationTitle } from '../conversations/conversationUtils';
import { MessageBubbleListBridge } from '../conversations/ConversationPanel';

const PANEL_WIDTH = 360;
const MOBILE_PANEL_WIDTH = 384;

interface CallChatPanelProps {
  conversationId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenProfile: (userId: string) => void;
}

/** The group chat, reachable as a sidebar while the call view (Stage) is
 * full-screen — same panel used in the normal chat view, just following
 * the app's right-sidebar convention instead of replacing the call. */
export function CallChatPanel({ conversationId, open, onOpenChange, onOpenProfile }: CallChatPanelProps) {
  const { state, conversations, allUsers } = useRoom();
  const { isMobile } = useAnimatedSidebar();
  const conversation = conversationId ? conversations.find((c) => c.id === conversationId) ?? null : null;
  const title = conversationTitle(conversation, state.me.userId, allUsers);

  const content = conversation && (
    <ChatSurfaceWidthProvider width={isMobile ? MOBILE_PANEL_WIDTH : PANEL_WIDTH}>
      <div className="flex flex-none items-center gap-2 border-b border-white/10 px-4 py-4">
        <MessageCircle size={18} className="flex-none text-text-muted" />
        <h2 className="min-w-0 flex-1 truncate text-title font-semibold">{title}</h2>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Fechar chat" onClick={() => onOpenChange(false)}>
          <X size={16} />
        </Button>
      </div>
      <MessageBubbleListBridge conversationId={conversation.id} onOpenProfile={onOpenProfile} />
    </ChatSurfaceWidthProvider>
  );

  return isMobile ? (
    <Drawer
      open={open && !!conversation}
      onOpenChange={onOpenChange}
      ariaLabel="Chat da chamada"
      className="flex w-96 flex-col border-white/10 bg-[rgb(14_14_16)] text-text-primary"
    >
      {content}
    </Drawer>
  ) : (
    <motion.aside
      aria-label="Chat da chamada"
      aria-hidden={!open || !conversation}
      initial={false}
      animate={{ width: open && conversation ? PANEL_WIDTH : 0, opacity: open && conversation ? 1 : 0 }}
      transition={SPRING_LAYOUT}
      className="flex-none overflow-hidden bg-bg-primary text-text-primary will-change-[width]"
    >
      <div className="flex h-full flex-col" style={{ width: PANEL_WIDTH }}>
        {content}
      </div>
    </motion.aside>
  );
}
