import type { ChatMessage } from '@/shared/types/protocol';

export interface MessagePermissions {
  react: boolean;
  reply: boolean;
  copy: boolean;
  edit: boolean;
  delete: boolean;
  report: boolean;
}

/** What the viewer may do with a message — one answer for the hover
 * toolbar, the phone menu and the right-click menu, so they can't drift.
 * The server checks again; this only decides what to offer. */
export function messagePermissions(message: ChatMessage, me: { userId: string | null; role: string }): MessagePermissions {
  const isInvite = message.kind === 'group_invite';
  const isMine = !!me.userId && message.id === me.userId;
  return {
    react: !isInvite,
    reply: !isInvite,
    copy: !!message.text,
    edit: isMine && !isInvite,
    delete: isMine || me.role === 'admin',
    report: !isMine && !isInvite && !!message.id,
  };
}
