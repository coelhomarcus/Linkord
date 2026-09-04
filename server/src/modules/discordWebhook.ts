import { config } from '../config/env.js';
import { participants } from '../realtime/participants.js';
import type { AppSocket, HandlerTable } from '../types.js';

const KIND_MESSAGE: Record<string, (name: string) => string> = {
  joined: (name) => `📞 **${name}** entrou na chamada.`,
  screenshare: (name) => `🖥️ **${name}** começou a compartilhar a tela.`,
};

/** Manda uma notificação pro canal do Discord configurado (`DISCORD_WEBHOOK_URL`
 * — opcional, ver config/env.ts). Nunca lança: uma falha de rede/webhook
 * revogado não pode derrubar a conexão de quem só ativou o mic/tela. */
async function notify(text: string): Promise<void> {
  if (!config.DISCORD_WEBHOOK_URL) return;
  try {
    const res = await fetch(config.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
    });
    if (!res.ok) {
      console.warn(`[discord-webhook] resposta ${res.status} ao notificar`);
    }
  } catch (err) {
    console.warn('[discord-webhook] falha ao notificar:', err instanceof Error ? err.message : err);
  }
}

/** Cliente reporta a própria ação (nunca em nome de outro participante) —
 * mesmo espírito de `deafened`/`reaction`: o servidor não tem visibilidade
 * de quem está na chamada/compartilhando tela, isso vive só no LiveKit (ver
 * useParticipantMedia.ts), então quem sabe que "eu acabei de publicar o mic/
 * tela agora" é o próprio cliente (ver RoomProvider.tsx). */
async function handleCallEvent(socket: AppSocket, msg: { kind?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const build = msg.kind ? KIND_MESSAGE[msg.kind] : undefined;
  if (!build) return;
  await notify(build(p.name));
}

export const handlers: HandlerTable = {
  'call-event': handleCallEvent,
};
