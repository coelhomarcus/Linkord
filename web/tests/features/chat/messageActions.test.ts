import { describe, expect, it } from 'vitest';
import { messagePermissions } from '@/features/chat/messageActions';
import type { ChatMessage } from '@/shared/types/protocol';

const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({ msgId: 1, conversationId: 'c', id: 'autor', name: 'A', avatar: '', text: 'oi', ts: 1, ...over });

describe('messagePermissions', () => {
  it('own message: can edit and delete, cannot report', () => {
    expect(messagePermissions(msg(), { userId: 'autor', role: 'user' })).toEqual({ react: true, reply: true, copy: true, edit: true, delete: true, report: false });
  });

  it("someone else's message: can report, cannot edit or delete", () => {
    expect(messagePermissions(msg(), { userId: 'eu', role: 'user' })).toMatchObject({ edit: false, delete: false, report: true });
  });

  it("admin deletes someone else's message, but cannot edit", () => {
    expect(messagePermissions(msg(), { userId: 'adm', role: 'admin' })).toMatchObject({ edit: false, delete: true });
  });

  it('invitation card: no react, reply, edit or report', () => {
    expect(messagePermissions(msg({ kind: 'group_invite', text: '' }), { userId: 'autor', role: 'user' })).toEqual({ react: false, reply: false, copy: false, edit: false, delete: true, report: false });
  });

  it('deleted author: no one to report', () => {
    expect(messagePermissions(msg({ id: null }), { userId: 'eu', role: 'user' }).report).toBe(false);
  });
});
