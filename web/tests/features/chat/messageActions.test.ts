import { describe, expect, it } from 'vitest';
import { messagePermissions } from '@/features/chat/messageActions';
import type { ChatMessage } from '@/shared/types/protocol';

const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({ msgId: 1, conversationId: 'c', id: 'autor', name: 'A', avatar: '', text: 'oi', ts: 1, ...over });

describe('messagePermissions', () => {
  it('propria: edita e apaga, nao denuncia', () => {
    expect(messagePermissions(msg(), { userId: 'autor', role: 'user' })).toEqual({ react: true, reply: true, copy: true, edit: true, delete: true, report: false });
  });

  it('de outra pessoa: denuncia, nao edita nem apaga', () => {
    expect(messagePermissions(msg(), { userId: 'eu', role: 'user' })).toMatchObject({ edit: false, delete: false, report: true });
  });

  it('admin apaga a de outra pessoa, mas nao edita', () => {
    expect(messagePermissions(msg(), { userId: 'adm', role: 'admin' })).toMatchObject({ edit: false, delete: true });
  });

  it('cartao de convite: sem reagir, responder, editar ou denunciar', () => {
    expect(messagePermissions(msg({ kind: 'group_invite', text: '' }), { userId: 'autor', role: 'user' })).toEqual({ react: false, reply: false, copy: false, edit: false, delete: true, report: false });
  });

  it('autor apagado: nao ha quem denunciar', () => {
    expect(messagePermissions(msg({ id: null }), { userId: 'eu', role: 'user' }).report).toBe(false);
  });
});
