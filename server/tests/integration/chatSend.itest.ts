import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { messageSendOperations, messages } from '../../src/db/schema.js';
import { handlers } from '../../src/modules/messages/messages.js';
import { getOrCreateDirect } from '../../src/modules/conversations/conversationsRepository.js';
import { sweepSendOperations } from '../../src/modules/messages/sendOperations.js';
import { cleanupParticipant, db, joinNew, makeGroupWithMembers, makeUser, pool } from './helpers.js';

after(() => pool.end());

type Sent = { event: string; payload: any }[];
const results = (sent: Sent) => sent.filter((s) => s.event === 'chat-send-result').map((s) => s.payload);
const key = () => crypto.randomUUID();

async function rowsIn(conversationId: string) {
  return db.select().from(messages).where(eq(messages.conversationId, conversationId));
}

async function withMember<T>(fn: (ctx: { socket: any; sent: Sent; conversationId: string; userId: string }) => Promise<T>): Promise<T> {
  const owner = await makeUser('cs');
  const conversationId = await makeGroupWithMembers(owner.id, []);
  const { socket, sent, participant } = joinNew(owner);
  try {
    return await fn({ socket, sent, conversationId, userId: owner.id });
  } finally {
    cleanupParticipant(participant);
  }
}

describe('chat correlacionado (Postgres real)', () => {
  it('envio novo responde com a mensagem persistida e a chave de volta', () => withMember(async ({ socket, sent, conversationId }) => {
    const clientMessageId = key();
    await handlers.chat!(socket, { conversationId, text: 'oi', requestId: 'r1', clientMessageId });

    const [result] = results(sent);
    assert.equal(result.requestId, 'r1');
    assert.equal(result.clientMessageId, clientMessageId);
    assert.equal(result.message.text, 'oi');
    assert.equal(result.message.clientMessageId, clientMessageId);
    assert.equal((await rowsIn(conversationId)).length, 1);
    // the author's own broadcast carries the key too, for reconciliation
    const broadcast = sent.find((s) => s.event === 'chat');
    assert.equal(broadcast?.payload.message.clientMessageId, clientMessageId);
  }));

  it('repetir a mesma chave com o mesmo conteudo devolve a mesma mensagem, sem inserir outra', () => withMember(async ({ socket, sent, conversationId }) => {
    const clientMessageId = key();
    await handlers.chat!(socket, { conversationId, text: 'uma vez', requestId: 'a', clientMessageId });
    await handlers.chat!(socket, { conversationId, text: 'uma vez', requestId: 'b', clientMessageId });

    const [first, second] = results(sent);
    assert.equal(second.requestId, 'b');
    assert.equal(second.message.msgId, first.message.msgId);
    assert.equal((await rowsIn(conversationId)).length, 1);
    assert.equal(sent.filter((s) => s.event === 'chat').length, 1, 'a repeticao nao faz um segundo broadcast');
  }));

  it('duas tentativas simultaneas com a mesma chave geram uma mensagem so', () => withMember(async ({ socket, sent, conversationId }) => {
    const clientMessageId = key();
    await Promise.all([
      handlers.chat!(socket, { conversationId, text: 'corrida', requestId: 'a', clientMessageId }),
      handlers.chat!(socket, { conversationId, text: 'corrida', requestId: 'b', clientMessageId }),
    ]);
    const [a, b] = results(sent);
    assert.equal(a.message.msgId, b.message.msgId);
    assert.equal((await rowsIn(conversationId)).length, 1);
  }));

  it('mesma chave com conteudo diferente e conflito', () => withMember(async ({ socket, sent, conversationId }) => {
    const clientMessageId = key();
    await handlers.chat!(socket, { conversationId, text: 'original', requestId: 'a', clientMessageId });
    await handlers.chat!(socket, { conversationId, text: 'outro texto', requestId: 'b', clientMessageId });
    assert.equal(results(sent)[1].error.code, 'conflict');
    assert.equal((await rowsIn(conversationId)).length, 1);
  }));

  it('repetir depois de apagar nao recria a mensagem', () => withMember(async ({ socket, sent, conversationId }) => {
    const clientMessageId = key();
    await handlers.chat!(socket, { conversationId, text: 'vai sumir', requestId: 'a', clientMessageId });
    await handlers['chat-delete']!(socket, { msgId: results(sent)[0].message.msgId });
    await handlers.chat!(socket, { conversationId, text: 'vai sumir', requestId: 'b', clientMessageId });
    assert.equal(results(sent)[1].error.code, 'message_deleted');
    assert.equal((await rowsIn(conversationId)).length, 0);
  }));

  it('recusas tambem sao respondidas: texto longo demais nao e cortado', () => withMember(async ({ socket, sent, conversationId }) => {
    await handlers.chat!(socket, { conversationId, text: 'x'.repeat(2001), requestId: 'a', clientMessageId: key() });
    assert.equal(results(sent)[0].error.code, 'message_too_long');
    assert.equal((await rowsIn(conversationId)).length, 0);
  }));

  it('recusas tambem sao respondidas: conversa alheia', () => withMember(async ({ socket, sent }) => {
    const stranger = await makeUser('cs');
    const otherGroup = await makeGroupWithMembers(stranger.id, []);
    await handlers.chat!(socket, { conversationId: otherGroup, text: 'invasao', requestId: 'a', clientMessageId: key() });
    assert.equal(results(sent)[0].error.code, 'conversation_not_found');
  }));

  it('DM com quem nao e amigo responde relationship_required', async () => {
    const [a, b] = [await makeUser('cs'), await makeUser('cs')];
    const { conversation } = await getOrCreateDirect(a.id, b.id, a.id);
    const { socket, sent, participant } = joinNew(a);
    try {
      await handlers.chat!(socket, { conversationId: conversation.id, text: 'oi', requestId: 'a', clientMessageId: key() });
      assert.equal(results(sent)[0].error.code, 'relationship_required');
    } finally {
      cleanupParticipant(participant);
    }
  });

  it('cliente antigo (sem clientMessageId) continua funcionando e nao recebe chat-send-result', () => withMember(async ({ socket, sent, conversationId }) => {
    await handlers.chat!(socket, { conversationId, text: 'legado' });
    assert.equal(results(sent).length, 0);
    assert.equal((await rowsIn(conversationId)).length, 1);
  }));

  it('a limpeza por retencao remove operacoes mais velhas que a janela', () => withMember(async ({ socket, conversationId, userId }) => {
    const clientMessageId = key();
    await handlers.chat!(socket, { conversationId, text: 'recente', requestId: 'a', clientMessageId });
    await sweepSendOperations(Date.now() + 8 * 24 * 60 * 60 * 1000);
    const left = await db.select().from(messageSendOperations).where(eq(messageSendOperations.authorId, userId));
    assert.equal(left.length, 0);
  }));
});
