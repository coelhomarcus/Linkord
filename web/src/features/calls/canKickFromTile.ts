import type { Conversation } from '@/shared/types/protocol';

/** Mirrors the server's canKickFromCall (modules/moderation/moderation.ts):
 * instance admins as before, plus the OWNER of the group the call belongs
 * to — for a member of that group. Never in a 1:1 call, and never on
 * yourself. The server re-checks; this only decides whether to show it. */
export function canKickFromTile(input: {
  isMe: boolean; conversation: Conversation | undefined; meIsAdmin: boolean; targetUserId: string | undefined;
}): boolean {
  const { isMe, conversation, meIsAdmin, targetUserId } = input;
  if (isMe || conversation?.type !== 'group') return false;
  if (meIsAdmin) return true;
  return conversation.myRole === 'owner' && !!targetUserId && conversation.memberIds.includes(targetUserId);
}
