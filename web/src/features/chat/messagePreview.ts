import type { ChatMessage } from '@/shared/types/protocol';

/** One-line text for a message wherever the body itself can't be shown
 * (sidebar subtitle, desktop notification). Invite cards have an empty
 * `text`, so without this they would read as an attachment. */
export function messagePreviewText(message: Pick<ChatMessage, 'text' | 'kind' | 'invitation'>): string {
  if (message.kind === 'group_invite') {
    return message.invitation ? `Convite para o grupo ${message.invitation.groupTitle}` : 'Convite indisponível';
  }
  return message.text || 'Anexo';
}
