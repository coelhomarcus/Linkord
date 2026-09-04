import { config } from '../config/env.js';
import { participants } from '../realtime/participants.js';
import type { AppSocket, HandlerTable } from '../types.js';

const KIND_MESSAGE: Record<string, (name: string) => string> = {
  joined: (name) => `📞 **${name}** entrou na chamada.`,
  screenshare: (name) => `🖥️ **${name}** começou a compartilhar a tela.`,
};

/** Sends a notification to the configured Discord channel
 * (`DISCORD_WEBHOOK_URL` — optional, see config/env.ts). Never throws: a
 * network failure/revoked webhook can't take down the connection of
 * whoever just activated their mic/screen. */
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

/** Client reports its OWN action (never on behalf of someone else) — same
 * spirit as `deafened`/`reaction`: the server has no visibility into who's
 * in the call/sharing (that lives in LiveKit only, see
 * useParticipantMedia.ts), so only the client itself knows "I just
 * published my mic/screen" (see RoomProvider.tsx). */
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
