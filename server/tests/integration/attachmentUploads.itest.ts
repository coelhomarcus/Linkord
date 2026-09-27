import { uploadDir } from './isolatedUploadDir.js';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import Fastify from 'fastify';
import sharp from 'sharp';
import { and, eq } from 'drizzle-orm';
import { config } from '../../src/config/env.js';
import { attachments as attachmentsTable, conversationMembers, messageSendOperations, messages, stagedAttachments } from '../../src/db/schema.js';
import { getByMessageIds } from '../../src/modules/attachments/attachments.js';
import { getUserUsage } from '../../src/modules/attachments/attachmentQuota.js';
import { STAGED_TTL_MS, stagedFileIds, sweepExpiredStaged } from '../../src/modules/attachments/stagedAttachments.js';
import { handlers as chatHandlers } from '../../src/modules/messages/messages.js';
import { registerAttachmentRoutes } from '../../src/modules/attachments/attachments.js';
import { createSession } from '../../src/modules/auth/session.js';
import { cleanupParticipant, db, joinNew, makeGroupWithMembers, makeUser, pool } from './helpers.js';

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

describe('upload preparado e publicacao do lote (Postgres real)', () => {
  async function stage(cookie: string, conversationId: string, buffer = bigPng, fileName = 'foto.png'): Promise<string> {
    const init = await app.inject({
      method: 'POST', url: '/api/attachments/init', headers: { cookie },
      payload: { conversationId, fileName, mimeType: 'image/png', totalSize: buffer.length, stage: true },
    });
    assert.equal(init.statusCode, 201, init.body);
    const { uploadId } = init.json() as { uploadId: string };
    const chunk = await app.inject({ method: 'POST', url: `/api/attachments/${uploadId}/chunk/0`, headers: { cookie, 'content-type': 'application/octet-stream' }, payload: buffer });
    assert.equal(chunk.statusCode, 200, chunk.body);
    const complete = await app.inject({ method: 'POST', url: `/api/attachments/${uploadId}/complete`, headers: { cookie }, payload: {} });
    assert.equal(complete.statusCode, 201, complete.body);
    return (complete.json() as { staged: { id: string } }).staged.id;
  }

  async function member() {
    const owner = await makeUser('st');
    const conversationId = await makeGroupWithMembers(owner.id, []);
    return { owner, conversationId, cookie: await sessionFor(owner.id) };
  }

  const correlatedSend = async (owner: { id: string; username: string }, conversationId: string, attachmentIds: string[], text = '', clientMessageId = crypto.randomUUID()) => {
    const { socket, sent, participant } = joinNew(owner);
    try {
      await chatHandlers.chat!(socket, { conversationId, text, requestId: 'r', clientMessageId, attachmentIds });
      return sent.filter((s) => s.event === 'chat-send-result').map((s) => s.payload)[0];
    } finally {
      cleanupParticipant(participant);
    }
  };

  it('preparar nao publica nada, nao serve o arquivo a ninguem e conta na cota', async () => {
    const { owner, conversationId, cookie } = await member();
    const before = await getUserUsage(owner.id);
    const id = await stage(cookie, conversationId);

    assert.equal((await db.select().from(messages).where(eq(messages.conversationId, conversationId))).length, 0);
    assert.equal((await db.select().from(attachmentsTable).where(eq(attachmentsTable.id, id))).length, 0);
    const served = await app.inject({ method: 'GET', url: `/uploads/${id}`, headers: { cookie } });
    assert.equal(served.statusCode, 404);
    const after = await getUserUsage(owner.id);
    assert.ok(after.totalBytes >= before.totalBytes + bigPng.length, 'bytes preparados contam na cota');
    assert.ok((await stagedFileIds()).includes(id), 'a limpeza de orfaos enxerga o arquivo preparado');
  });

  it('repetir o complete depois do sucesso devolve o mesmo arquivo preparado', async () => {
    const { conversationId, cookie } = await member();
    const id = await stage(cookie, conversationId);
    const again = await app.inject({ method: 'POST', url: `/api/attachments/${id}/complete`, headers: { cookie }, payload: {} });
    assert.equal(again.statusCode, 200, again.body);
    assert.equal((again.json() as { staged: { id: string } }).staged.id, id);
  });

  it('o envio publica o lote inteiro na ordem escolhida, numa mensagem so, sem duplicar miniaturas', async () => {
    const { owner, conversationId, cookie } = await member();
    const small = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#00ff00' } }).png().toBuffer();
    // finished out of order on purpose: the order sent is what counts
    const [c, a, b] = [await stage(cookie, conversationId, small, 'c.png'), await stage(cookie, conversationId, bigPng, 'a.png'), await stage(cookie, conversationId, small, 'b.png')];
    const clientMessageId = crypto.randomUUID();

    const result = await correlatedSend(owner, conversationId, [a!, b!, c!], 'lote', clientMessageId);
    assert.deepEqual(result.message.attachments.map((x: { name: string }) => x.name), ['a.png', 'b.png', 'c.png']);
    assert.ok(result.message.attachments[0].thumbId, 'a imagem grande leva miniatura');

    const history = await getByMessageIds([result.message.msgId]);
    assert.deepEqual(history.get(result.message.msgId)!.map((x) => x.fileName), ['a.png', 'b.png', 'c.png']);
    assert.equal((await db.select().from(stagedAttachments).where(eq(stagedAttachments.ownerId, owner.id))).length, 0);

    const retry = await correlatedSend(owner, conversationId, [a!, b!, c!], 'lote', clientMessageId);
    assert.equal(retry.message.msgId, result.message.msgId);
    assert.equal((await db.select().from(messages).where(eq(messages.conversationId, conversationId))).length, 1);
  });

  it('arquivo preparado por outra conta nao pode ser publicado; nada muda e a chave fica livre', async () => {
    const victim = await member();
    const victimFile = await stage(victim.cookie, victim.conversationId);
    const attacker = await makeUser('st');
    await db.insert(conversationMembers).values({ conversationId: victim.conversationId, userId: attacker.id, role: 'member' });
    const clientMessageId = crypto.randomUUID();

    const result = await correlatedSend(attacker, victim.conversationId, [victimFile], '', clientMessageId);
    assert.equal(result.error.code, 'attachments_unavailable');
    assert.equal((await db.select().from(messages).where(eq(messages.conversationId, victim.conversationId))).length, 0);
    assert.equal((await db.select().from(stagedAttachments).where(eq(stagedAttachments.id, victimFile))).length, 1);
    assert.equal((await db.select().from(messageSendOperations).where(eq(messageSendOperations.clientMessageId, clientMessageId))).length, 0);
  });

  it('arquivo preparado para outra conversa nao entra nesta', async () => {
    const { owner, conversationId, cookie } = await member();
    const otherConversation = await makeGroupWithMembers(owner.id, []);
    const id = await stage(cookie, otherConversation);
    const result = await correlatedSend(owner, conversationId, [id]);
    assert.equal(result.error.code, 'attachments_unavailable');
  });

  it('descartar remove o registro e o arquivo; vencidos sao varridos', async () => {
    const { owner, conversationId, cookie } = await member();
    const kept = await stage(cookie, conversationId);
    const dropped = await stage(cookie, conversationId);

    const cancel = await app.inject({ method: 'DELETE', url: `/api/attachments/${dropped}`, headers: { cookie } });
    assert.equal(cancel.statusCode, 200);
    assert.equal(fs.existsSync(path.join(uploadDir, dropped)), false);
    assert.equal((await db.select().from(stagedAttachments).where(eq(stagedAttachments.id, dropped))).length, 0);

    await sweepExpiredStaged(Date.now() + STAGED_TTL_MS + 1000);
    assert.equal((await db.select().from(stagedAttachments).where(eq(stagedAttachments.ownerId, owner.id))).length, 0);
    assert.equal(fs.existsSync(path.join(uploadDir, kept)), false);
  });
});

describe('dimensoes de midia (Postgres real)', () => {
  async function stageBuffer(cookie: string, conversationId: string, buffer: Buffer, fileName: string, mimeType: string) {
    const init = await app.inject({ method: 'POST', url: '/api/attachments/init', headers: { cookie }, payload: { conversationId, fileName, mimeType, totalSize: buffer.length, stage: true } });
    const { uploadId } = init.json() as { uploadId: string };
    await app.inject({ method: 'POST', url: `/api/attachments/${uploadId}/chunk/0`, headers: { cookie, 'content-type': 'application/octet-stream' }, payload: buffer });
    const complete = await app.inject({ method: 'POST', url: `/api/attachments/${uploadId}/complete`, headers: { cookie }, payload: {} });
    return (complete.json() as { staged: { id: string; width?: number; height?: number; thumbId?: string } }).staged;
  }

  it('imagem preparada informa largura/altura e a mensagem publicada tambem', async () => {
    const owner = await makeUser('dm');
    const conversationId = await makeGroupWithMembers(owner.id, []);
    const cookie = await sessionFor(owner.id);
    const staged = await stageBuffer(cookie, conversationId, bigPng, 'paisagem.png', 'image/png');
    assert.deepEqual([staged.width, staged.height], [1200, 900]);

    const { socket, sent, participant } = joinNew(owner);
    try {
      await chatHandlers.chat!(socket, { conversationId, text: '', requestId: 'r', clientMessageId: crypto.randomUUID(), attachmentIds: [staged.id] });
    } finally {
      cleanupParticipant(participant);
    }
    const result = sent.find((s) => s.event === 'chat-send-result')!.payload;
    assert.deepEqual([result.message.attachments[0].width, result.message.attachments[0].height], [1200, 900]);
    const [row] = await db.select().from(attachmentsTable).where(eq(attachmentsTable.id, staged.id));
    assert.deepEqual([row!.width, row!.height], [1200, 900]);
  });

  it('foto girada por EXIF: dimensoes de exibicao e miniatura em retrato', async () => {
    const owner = await makeUser('dm');
    const conversationId = await makeGroupWithMembers(owner.id, []);
    const cookie = await sessionFor(owner.id);
    // stored landscape, displayed portrait (orientation 6 = rotate 90°)
    const rotated = await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#aa3300' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const staged = await stageBuffer(cookie, conversationId, rotated, 'celular.jpg', 'image/jpeg');
    assert.deepEqual([staged.width, staged.height], [900, 1200]);
    const thumb = await sharp(path.join(uploadDir, staged.thumbId!)).metadata();
    assert.ok(thumb.height! > thumb.width!, `miniatura deveria ser retrato, veio ${thumb.width}x${thumb.height}`);
  });

  it('arquivo que nao e imagem nao inventa dimensoes', async () => {
    const owner = await makeUser('dm');
    const conversationId = await makeGroupWithMembers(owner.id, []);
    const staged = await stageBuffer(await sessionFor(owner.id), conversationId, Buffer.from('%PDF-1.4 x'), 'doc.pdf', 'application/pdf');
    assert.equal(staged.width, undefined);
  });
});
