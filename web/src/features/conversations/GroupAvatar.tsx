import { cn } from '@/shared/lib/utils';
import { conversationInitials } from './conversationUtils';

interface GroupAvatarProps {
  title: string;
  avatar?: string | null;
  active?: boolean;
  size?: number;
  className?: string;
}

export function GroupAvatar({ title, avatar, active, size = 44, className }: GroupAvatarProps) {
  return (
    <div
      className={cn(
        'grid flex-none place-items-center overflow-hidden rounded-full border font-semibold',
        active ? 'border-primary/50 bg-primary/20 text-text-primary' : 'border-white/10 bg-white/[0.06] text-text-secondary',
        className
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.32) }}
    >
      {avatar ? <img src={avatar} alt="" className="size-full object-cover" /> : conversationInitials(title)}
    </div>
  );
}
