import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { conversationMembers, messageSendOperations, messages } from '../../src/db/schema.js';
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

describe('correlated chat (real Postgres)', () => {
  it('a new send answers with the persisted message and the key back', () => withMember(async ({ socket, sent, conversationId }) => {
    const clientMessageId = key();
    await handlers.chat!(socket, { conversationId, text: 'hi', requestId: 'r1', clientMessageId });

    const [result] = results(sent);
    assert.equal(result.requestId, 'r1');
    assert.equal(result.clientMessageId, clientMessageId);
    assert.equal(result.message.text, 'hi');
    assert.equal(result.message.clientMessageId, clientMessageId);
    assert.equal((await rowsIn(conversationId)).length, 1);
    // the author's own broadcast carries the key too, for reconciliation
    const broadcast = sent.find((s) => s.event === 'chat');
    assert.equal(broadcast?.payload.message.clientMessageId, clientMessageId);
  }));

  it('repeating the same key with the same content returns the same message, without inserting another', () => withMember(async ({ socket, sent, conversationId }) => {
    const clientMessageId = key();
    await handlers.chat!(socket, { conversationId, text: 'once', requestId: 'a', clientMessageId });
    await handlers.chat!(socket, { conversationId, text: 'once', requestId: 'b', clientMessageId });

    const [first, second] = results(sent);
    assert.equal(second.requestId, 'b');
    assert.equal(second.message.msgId, first.message.msgId);
    assert.equal((await rowsIn(conversationId)).length, 1);
    assert.equal(sent.filter((s) => s.event === 'chat').length, 1, 'the repeat does not trigger a second broadcast');
  }));

  it('two simultaneous attempts with the same key produce a single message', () => withMember(async ({ socket, sent, conversationId }) => {
    const clientMessageId = key();
    await Promise.all([
      handlers.chat!(socket, { conversationId, text: 'race', requestId: 'a', clientMessageId }),
      handlers.chat!(socket, { conversationId, text: 'race', requestId: 'b', clientMessageId }),
    ]);
    const [a, b] = results(sent);
    assert.equal(a.message.msgId, b.message.msgId);
    assert.equal((await rowsIn(conversationId)).length, 1);
  }));

  it('same key with different content is a conflict', () => withMember(async ({ socket, sent, conversationId }) => {
    const clientMessageId = key();
    await handlers.chat!(socket, { conversationId, text: 'original', requestId: 'a', clientMessageId });
    await handlers.chat!(socket, { conversationId, text: 'different text', requestId: 'b', clientMessageId });
    assert.equal(results(sent)[1].error.code, 'conflict');
    assert.equal((await rowsIn(conversationId)).length, 1);
  }));

  it('repeating after a delete does not recreate the message', () => withMember(async ({ socket, sent, conversationId }) => {
    const clientMessageId = key();
    await handlers.chat!(socket, { conversationId, text: 'about to vanish', requestId: 'a', clientMessageId });
    await handlers['chat-delete']!(socket, { msgId: results(sent)[0].message.msgId });
    await handlers.chat!(socket, { conversationId, text: 'about to vanish', requestId: 'b', clientMessageId });
    assert.equal(results(sent)[1].error.code, 'message_deleted');
    assert.equal((await rowsIn(conversationId)).length, 0);
  }));

  it('refusals are also answered: overly long text is not truncated', () => withMember(async ({ socket, sent, conversationId }) => {
    await handlers.chat!(socket, { conversationId, text: 'x'.repeat(2001), requestId: 'a', clientMessageId: key() });
    assert.equal(results(sent)[0].error.code, 'message_too_long');
    assert.equal((await rowsIn(conversationId)).length, 0);
  }));

  it('refusals are also answered: someone else\'s conversation', () => withMember(async ({ socket, sent }) => {
    const stranger = await makeUser('cs');
    const otherGroup = await makeGroupWithMembers(stranger.id, []);
    await handlers.chat!(socket, { conversationId: otherGroup, text: 'trespassing', requestId: 'a', clientMessageId: key() });
    assert.equal(results(sent)[0].error.code, 'conversation_not_found');
  }));

  it('DM with someone who is not a friend answers relationship_required', async () => {
    const [a, b] = [await makeUser('cs'), await makeUser('cs')];
    const { conversation } = await getOrCreateDirect(a.id, b.id, a.id);
    const { socket, sent, participant } = joinNew(a);
    try {
      await handlers.chat!(socket, { conversationId: conversation.id, text: 'hi', requestId: 'a', clientMessageId: key() });
      assert.equal(results(sent)[0].error.code, 'relationship_required');
    } finally {
      cleanupParticipant(participant);
    }
  });

  it('without clientMessageId: malformed request, dropped without persisting or answering', () => withMember(async ({ socket, sent, conversationId }) => {
    await handlers.chat!(socket, { conversationId, text: 'no key' });
    assert.equal(results(sent).length, 0);
    assert.equal((await rowsIn(conversationId)).length, 0);
  }));

  it('retention sweep removes operations older than the window', () => withMember(async ({ socket, conversationId, userId }) => {
    const clientMessageId = key();
    await handlers.chat!(socket, { conversationId, text: 'recent', requestId: 'a', clientMessageId });
    await sweepSendOperations(Date.now() + 8 * 24 * 60 * 60 * 1000);
    const left = await db.select().from(messageSendOperations).where(eq(messageSendOperations.authorId, userId));
    assert.equal(left.length, 0);
  }));
});

describe('edit and delete with a result (real Postgres)', () => {
  const actionResults = (sent: Sent) => sent.filter((s) => s.event === 'chat-action-result').map((s) => s.payload);

  async function ownMessage(ctx: { socket: any; sent: Sent; conversationId: string }) {
    await handlers.chat!(ctx.socket, { conversationId: ctx.conversationId, text: 'original', requestId: 's', clientMessageId: key() });
    return results(ctx.sent)[0].message.msgId as number;
  }

  it('editing answers success and saves', () => withMember(async (ctx) => {
    const msgId = await ownMessage(ctx);
    await handlers['chat-edit']!(ctx.socket, { msgId, text: 'edited', requestId: 'e1' });
    assert.deepEqual(actionResults(ctx.sent), [{ t: 'chat-action-result', requestId: 'e1' }]);
    const [row] = await db.select().from(messages).where(eq(messages.id, msgId));
    assert.equal(row!.text, 'edited');
  }));

  it('editing someone else\'s message answers forbidden', () => withMember(async (ctx) => {
    const msgId = await ownMessage(ctx);
    const other = await makeUser('cs');
    await db.insert(conversationMembers).values({ conversationId: ctx.conversationId, userId: other.id, role: 'member' });
    const { socket, sent, participant } = joinNew(other);
    try {
      await handlers['chat-edit']!(socket, { msgId, text: 'trespassing', requestId: 'e2' });
      assert.equal(actionResults(sent)[0].error.code, 'forbidden');
    } finally {
      cleanupParticipant(participant);
    }
  }));

  it('editing with overly long text answers an error without truncating', () => withMember(async (ctx) => {
    const msgId = await ownMessage(ctx);
    await handlers['chat-edit']!(ctx.socket, { msgId, text: 'x'.repeat(2001), requestId: 'e3' });
    assert.equal(actionResults(ctx.sent)[0].error.code, 'message_too_long');
    const [row] = await db.select().from(messages).where(eq(messages.id, msgId));
    assert.equal(row!.text, 'original');
  }));

  it('deleting answers success; deleting again also does (already gone)', () => withMember(async (ctx) => {
    const msgId = await ownMessage(ctx);
    await handlers['chat-delete']!(ctx.socket, { msgId, requestId: 'd1' });
    await handlers['chat-delete']!(ctx.socket, { msgId, requestId: 'd2' });
    assert.deepEqual(actionResults(ctx.sent).map((r) => r.error), [undefined, undefined]);
    assert.equal((await rowsIn(ctx.conversationId)).length, 0);
  }));

  it('without a requestId: the action still happens, there is just nothing to answer with', () => withMember(async (ctx) => {
    const msgId = await ownMessage(ctx);
    await handlers['chat-edit']!(ctx.socket, { msgId, text: 'new' });
    const [row] = await db.select().from(messages).where(eq(messages.id, msgId));
    assert.equal(row!.text, 'new');
    await handlers['chat-delete']!(ctx.socket, { msgId });
    assert.equal((await rowsIn(ctx.conversationId)).length, 0);
    assert.equal(actionResults(ctx.sent).length, 0);
  }));
});

describe('reactions by desired state (real Postgres)', () => {
  const actionResults = (sent: Sent) => sent.filter((s) => s.event === 'chat-action-result').map((s) => s.payload);
  const reactionBroadcasts = (sent: Sent) => sent.filter((s) => s.event === 'chat-reaction-updated').map((s) => s.payload);

  it('adding twice leaves one reaction; the repeat does not broadcast', () => withMember(async (ctx) => {
    await handlers.chat!(ctx.socket, { conversationId: ctx.conversationId, text: 'react', requestId: 's', clientMessageId: key() });
    const msgId = results(ctx.sent)[0].message.msgId;
    await handlers['chat-react']!(ctx.socket, { msgId, emoji: '👍', present: true, requestId: 'r1' });
    await handlers['chat-react']!(ctx.socket, { msgId, emoji: '👍', present: true, requestId: 'r2' });
    assert.deepEqual(actionResults(ctx.sent).map((r) => [r.requestId, r.error]), [['r1', undefined], ['r2', undefined]]);
    assert.deepEqual(reactionBroadcasts(ctx.sent).map((b) => b.userIds), [[ctx.userId]]);
  }));

  it('removing with present=false is idempotent', () => withMember(async (ctx) => {
    await handlers.chat!(ctx.socket, { conversationId: ctx.conversationId, text: 'react', requestId: 's', clientMessageId: key() });
    const msgId = results(ctx.sent)[0].message.msgId;
    await handlers['chat-react']!(ctx.socket, { msgId, emoji: '🎉', present: true, requestId: 'a' });
    await handlers['chat-react']!(ctx.socket, { msgId, emoji: '🎉', present: false, requestId: 'b' });
    await handlers['chat-react']!(ctx.socket, { msgId, emoji: '🎉', present: false, requestId: 'c' });
    assert.deepEqual(reactionBroadcasts(ctx.sent).map((b) => b.userIds), [[ctx.userId], []]);
  }));

  it('without "present" (neither true nor false): invalid reaction, no broadcast', () => withMember(async (ctx) => {
    await handlers.chat!(ctx.socket, { conversationId: ctx.conversationId, text: 'react', requestId: 's', clientMessageId: key() });
    const msgId = results(ctx.sent)[0].message.msgId;
    await handlers['chat-react']!(ctx.socket, { msgId, emoji: '😂' });
    assert.equal(reactionBroadcasts(ctx.sent).length, 0);
    // with a requestId it's answered as a refusal, not silently dropped
    await handlers['chat-react']!(ctx.socket, { msgId, emoji: '😂', requestId: 'r' });
    assert.equal(actionResults(ctx.sent)[0]!.error.code, 'invalid_message');
  }));

  it('DM without friendship refuses with a result', async () => {
    const [a, b] = [await makeUser('cs'), await makeUser('cs')];
    const { conversation } = await getOrCreateDirect(a.id, b.id, a.id);
    const [row] = await db.insert(messages).values({ conversationId: conversation.id, authorId: b.id, text: 'hi' }).returning();
    const { socket, sent, participant } = joinNew(a);
    try {
      await handlers['chat-react']!(socket, { msgId: row!.id, emoji: '👍', present: true, requestId: 'x' });
      assert.equal(actionResults(sent)[0].error.code, 'relationship_required');
    } finally {
      cleanupParticipant(participant);
    }
  });
});

describe('forward history (real Postgres)', () => {
  it('load-messages-after returns the newest ones, in order, with the requestId back', () => withMember(async (ctx) => {
    const ids: number[] = [];
    for (const text of ['m1', 'm2', 'm3', 'm4']) {
      const [row] = await db.insert(messages).values({ conversationId: ctx.conversationId, authorId: ctx.userId, text }).returning();
      ids.push(row!.id);
    }
    await handlers['load-messages-after']!(ctx.socket, { conversationId: ctx.conversationId, afterMsgId: ids[1], requestId: 'pg1' });
    const page = ctx.sent.find((s) => s.event === 'conversation-history-newer')!.payload;
    assert.deepEqual(page.messages.map((m: { text: string }) => m.text), ['m3', 'm4']);
    assert.equal(page.hasMoreAfter, false);
    assert.equal(page.requestId, 'pg1');
  }));

  it('someone else\'s conversation does not respond', async () => {
    const stranger = await makeUser('cs');
    const otherGroup = await makeGroupWithMembers(stranger.id, []);
    await withMember(async (ctx) => {
      await handlers['load-messages-after']!(ctx.socket, { conversationId: otherGroup, afterMsgId: 0 });
      assert.equal(ctx.sent.filter((s) => s.event === 'conversation-history-newer').length, 0);
    });
  });
});
