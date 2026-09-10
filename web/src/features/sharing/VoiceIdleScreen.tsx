import { useMemo } from 'react';
import { ArrowLeft, ArrowRight, LogIn, MessageSquare, Volume2 } from 'lucide-react';
import { useRoom } from '../../state/RoomContext';
import { Avatar, colorFor } from '../../shared/Avatar';
import { Button } from '@/components/ui/button';

interface VoiceIdleScreenProps {
  channelId: string;
  onBackMobile: () => void;
  onOpenChat: () => void;
}

const CHANNEL_NAME_SEPARATORS = ['┃', '|'];

function splitChannelDisplay(name: string): { icon: string | null; label: string } {
  let bar = -1;
  for (const sep of CHANNEL_NAME_SEPARATORS) {
    const i = name.indexOf(sep);
    if (i > 0) { bar = i; break; }
  }
  if (bar <= 0) return { icon: null, label: name };
  const icon = name.slice(0, bar).trim();
  const label = name.slice(bar + 1).trim();
  return icon && label ? { icon, label } : { icon: null, label: name };
}

export function VoiceIdleScreen({ channelId, onBackMobile, onOpenChat }: VoiceIdleScreenProps) {
  const { state, categories, joinVoiceChannel } = useRoom();
  const channel = useMemo(
    () => categories.flatMap((c) => c.channels).find((ch) => ch.id === channelId) ?? null,
    [categories, channelId]
  );
  const participants = useMemo(
    () => [...state.participants.values()].filter((p) => p.voiceChannelId === channelId),
    [state.participants, channelId]
  );
  const name = channel?.name ?? '';
  const { icon, label } = splitChannelDisplay(name);
  const accent = colorFor(channelId);

  return (
    <main
      className="relative flex flex-1 min-w-0 flex-col overflow-auto text-text-primary"
      style={{ background: `linear-gradient(160deg, var(--color-bg-call) 10%, ${accent} 160%)` }}
    >
      <div className="flex flex-none items-center justify-between px-4 py-3.5 md:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Voltar pros canais"
            onClick={onBackMobile}
            className="-ml-1 flex-none text-text-secondary hover:text-text-primary md:hidden"
          >
            <ArrowLeft size={18} />
          </Button>
          <Volume2 size={16} className="flex-none text-text-secondary" />
          <h1 className="truncate text-body font-semibold text-text-secondary">{name}</h1>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Ir pro chat"
          onClick={onOpenChat}
          className="flex-none text-text-secondary hover:text-text-primary"
        >
          <MessageSquare size={16} />
        </Button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 pb-16 text-center">
        <div className="flex flex-col items-center gap-2">
          {icon ? (
            <span className="text-6xl leading-none">{icon}</span>
          ) : (
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/20 text-white">
              <Volume2 size={28} />
            </span>
          )}
          <p className="text-title font-bold text-text-primary">{label}</p>
        </div>

        {participants.length === 0 ? (
          <p className="select-none text-body text-text-secondary">Ninguém está em voz</p>
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-3">
            {participants.map((p) => (
              <div key={p.id} className="flex flex-col items-center gap-1">
                <Avatar id={p.id} name={p.displayName} avatar={p.avatar} avatarColor={p.avatarColor} size={44} />
                <span className="max-w-20 truncate text-caption text-text-secondary">{p.displayName}</span>
              </div>
            ))}
          </div>
        )}

        <Button type="button" size="lg" className="bg-white text-black hover:bg-white/90" onClick={() => joinVoiceChannel(channelId)}>
          <LogIn size={16} />
          <span>Entrar na chamada de voz</span>
          <ArrowRight size={16} className="ml-auto" />
        </Button>
      </div>
    </main>
  );
}
