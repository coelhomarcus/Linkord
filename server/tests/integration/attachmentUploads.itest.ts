import { uploadDir } from './isolatedUploadDir.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, describe, it } from 'node:test';
import Fastify from 'fastify';
import sharp from 'sharp';
import { and, eq } from 'drizzle-orm';
import { config } from '../../src/config/env.js';
import { attachments as attachmentsTable, messages } from '../../src/db/schema.js';
import { registerAttachmentRoutes } from '../../src/modules/attachments/attachments.js';
import { createSession } from '../../src/modules/auth/session.js';
import { db, makeGroupWithMembers, makeUser, pool } from './helpers.js';

const app = Fastify();
registerAttachmentRoutes(app);

after(async () => {
  await app.close();
  await pool.end();
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

// Big enough that attachmentThumbnails.ts actually generates a thumbnail row
// (it skips images already within its max dimension).
const bigPng = await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#3366ff' } }).png().toBuffer();

async function sessionFor(userId: string): Promise<string> {
  const { rawToken } = await createSession(userId);
  return `${config.SESSION_COOKIE}=${rawToken}`;
}

async function upload(cookie: string, conversationId: string, extra: { targetMsgId?: number; replyTo?: number; caption?: string } = {}) {
  const init = await app.inject({
    method: 'POST', url: '/api/attachments/init', headers: { cookie },
    payload: { conversationId, fileName: 'foto.png', mimeType: 'image/png', totalSize: bigPng.length, caption: extra.caption ?? '', replyTo: extra.replyTo },
  });
  assert.equal(init.statusCode, 201, init.body);
  const { uploadId } = init.json() as { uploadId: string };
  const chunk = await app.inject({
    method: 'POST', url: `/api/attachments/${uploadId}/chunk/0`,
    headers: { cookie, 'content-type': 'application/octet-stream' }, payload: bigPng,
  });
  assert.equal(chunk.statusCode, 200, chunk.body);
  return app.inject({
    method: 'POST', url: `/api/attachments/${uploadId}/complete`, headers: { cookie },
    payload: extra.targetMsgId != null ? { targetMsgId: extra.targetMsgId } : {},
  });
}

describe('upload de anexos (Postgres real)', () => {
  it('miniaturas nao contam no limite: 4 imagens grandes cabem numa mensagem, a 5a nao', async () => {
    const owner = await makeUser('up');
    const conversationId = await makeGroupWithMembers(owner.id, []);
    const cookie = await sessionFor(owner.id);

    const first = await upload(cookie, conversationId);
    assert.equal(first.statusCode, 201, first.body);
    const msgId = (first.json() as { message: { msgId: number } }).message.msgId;
    for (let i = 0; i < 3; i++) {
      const res = await upload(cookie, conversationId, { targetMsgId: msgId });
      assert.equal(res.statusCode, 201, `anexo ${i + 2}: ${res.body}`);
    }

    const rows = await db.select().from(attachmentsTable).where(eq(attachmentsTable.messageId, msgId));
    assert.equal(rows.filter((r) => !r.isThumbnail).length, 4);
    assert.ok(rows.some((r) => r.isThumbnail), 'o teste so prova algo se miniaturas foram geradas');

    const fifth = await upload(cookie, conversationId, { targetMsgId: msgId });
    assert.equal(fifth.statusCode, 400);
    assert.equal((fifth.json() as { error: { code: string } }).error.code, 'too_many_attachments');
  });

  it('resposta com anexo guarda a referencia da mensagem respondida', async () => {
    const owner = await makeUser('up');
    const conversationId = await makeGroupWithMembers(owner.id, []);
    const cookie = await sessionFor(owner.id);
    const [original] = await db.insert(messages).values({ conversationId, authorId: owner.id, text: 'mensagem original' }).returning();

    const res = await upload(cookie, conversationId, { replyTo: original!.id, caption: 'olha isso' });
    assert.equal(res.statusCode, 201, res.body);
    const { message } = res.json() as { message: { msgId: number; replyTo?: { msgId: number; text: string } } };
    assert.equal(message.replyTo?.msgId, original!.id);
    assert.equal(message.replyTo?.text, 'mensagem original');

    const [row] = await db.select({ replyTo: messages.replyTo }).from(messages).where(eq(messages.id, message.msgId));
    assert.equal((row!.replyTo as { msgId: number }).msgId, original!.id);
  });

  it('resposta a uma mensagem de outra conversa e descartada, sem falhar o upload', async () => {
    const owner = await makeUser('up');
    const conversationId = await makeGroupWithMembers(owner.id, []);
    const otherConversationId = await makeGroupWithMembers(owner.id, []);
    const cookie = await sessionFor(owner.id);
    const [elsewhere] = await db.insert(messages).values({ conversationId: otherConversationId, authorId: owner.id, text: 'outra conversa' }).returning();

    const res = await upload(cookie, conversationId, { replyTo: elsewhere!.id });
    assert.equal(res.statusCode, 201, res.body);
    const { message } = res.json() as { message: { msgId: number; replyTo?: unknown } };
    assert.equal(message.replyTo, undefined);
    const [row] = await db.select({ replyTo: messages.replyTo }).from(messages)
      .where(and(eq(messages.id, message.msgId), eq(messages.conversationId, conversationId)));
    assert.equal(row!.replyTo, null);
  });
});
