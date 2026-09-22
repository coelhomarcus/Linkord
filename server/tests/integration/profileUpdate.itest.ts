import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import type { AppSocket, Participant } from '../../src/types.js';
import { users } from '../../src/db/schema.js';
import { handlers, join, participants } from '../../src/modules/presence/participants.js';
import { db, makeUser, pool } from './helpers.js';

// handleProfile hits the real `users` table (updateProfile), unlike every
// other participants.ts handler — the unit suite never touches a database
// (see AGENTS.md), so its persist-before-confirm/broadcast contract, the
// per-account serialization and the image/text isolation live here instead.

after(() => pool.end());

/** Same shape as participants.test.ts's fakeSocket, plus a spy on `emit` —
 * this is what `send()` actually calls, gated on `socket.connected`. */
function fakeSocket(userId: string): { socket: AppSocket; sent: { event: string; payload: any }[] } {
  const sent: { event: string; payload: any }[] = [];
  const socket = {
    participantId: null,
    ip: '127.0.0.1',
    connected: true,
    emit: (event: string, payload: any) => { sent.push({ event, payload }); },
    disconnect: () => {},
    user: {
      tokenHash: 'x', userId, username: userId, displayName: '', avatar: '', avatarColor: 'blurple',
      banner: '', bio: '', profileLinks: [], role: 'user' as const,
    },
  } as unknown as AppSocket;
  return { socket, sent };
}

function joinNew(userId: string) {
  const { socket, sent } = fakeSocket(userId);
  const result = join(socket, {});
  assert.ok(result, 'join deveria criar o participante');
  return { socket, sent, participant: result.participant };
}

function cleanup(participant: Participant) {
  if (participant.graceTimer) clearTimeout(participant.graceTimer);
  participants.delete(participant.id);
}

describe('handleProfile: persiste antes de confirmar/transmitir (Postgres real)', () => {
  it('sucesso: grava no banco, transmite e responde profile-result ok com o requestId', async () => {
    const user = await makeUser('pu');
    const { socket, sent, participant } = joinNew(user.id);
    try {
      await handlers.profile(socket, { requestId: 'r1', displayName: 'Nome Novo', bio: 'bio nova' });

      const [row] = await db.select().from(users).where(eq(users.id, user.id));
      assert.equal(row!.displayName, 'Nome Novo');
      assert.equal(row!.bio, 'bio nova');

      // ok:true always carries the full confirmed profile (not just the
      // patched keys) — the client reconciles its draft against this, and a
      // partial reply would leave it guessing what the untouched fields are
      const ok = sent.find((e) => e.payload?.t === 'profile-result');
      assert.deepEqual(ok?.payload, {
        t: 'profile-result', requestId: 'r1', ok: true,
        avatar: '', avatarPoster: '', avatarColor: 'blurple', displayName: 'Nome Novo',
        banner: '', bannerPoster: '', bio: 'bio nova', profileLinks: [],
      });
      assert.ok(sent.some((e) => e.payload?.t === 'participant-updated'), 'deveria ter transmitido participant-updated');
      assert.equal(participant.displayName, 'Nome Novo');
    } finally {
      cleanup(participant);
    }
  });

  it('conta apagada no meio da sessao: responde not_found, nao transmite e nao muda o participante em memoria', async () => {
    const user = await makeUser('pu');
    const { socket, sent, participant } = joinNew(user.id);
    try {
      await db.delete(users).where(eq(users.id, user.id));
      await handlers.profile(socket, { requestId: 'r2', displayName: 'Fantasma' });

      const result = sent.find((e) => e.payload?.t === 'profile-result');
      assert.deepEqual(result?.payload, { t: 'profile-result', requestId: 'r2', ok: false, code: 'not_found', message: 'Sua conta não foi encontrada.' });
      assert.ok(!sent.some((e) => e.payload?.t === 'participant-updated'), 'nao deveria ter transmitido nada');
      assert.notEqual(participant.displayName, 'Fantasma');
    } finally {
      cleanup(participant);
    }
  });

  it('sem requestId (uso interno futuro): ainda persiste e transmite, so nao responde profile-result', async () => {
    const user = await makeUser('pu');
    const { socket, sent, participant } = joinNew(user.id);
    try {
      await handlers.profile(socket, { displayName: 'Sem Id' });
      const [row] = await db.select().from(users).where(eq(users.id, user.id));
      assert.equal(row!.displayName, 'Sem Id');
      assert.ok(!sent.some((e) => e.payload?.t === 'profile-result'));
    } finally {
      cleanup(participant);
    }
  });

  it('patch so de imagem nao publica nem sobrescreve nome/bio/links em rascunho', async () => {
    const user = await makeUser('pu');
    const { socket, participant } = joinNew(user.id);
    try {
      await handlers.profile(socket, { requestId: 'r3', displayName: 'Original', bio: 'bio original' });
      // a media-only patch — no displayName/bio/profileLinks key at all,
      // the way an avatar upload sends it (see useProfileUpdate.ts)
      await handlers.profile(socket, { requestId: 'r4', avatar: '/uploads/deadbeefdeadbeefdeadbeefdeadbeef' });

      const [row] = await db.select().from(users).where(eq(users.id, user.id));
      assert.equal(row!.avatar, '/uploads/deadbeefdeadbeefdeadbeefdeadbeef');
      assert.equal(row!.displayName, 'Original', 'o patch de imagem nao deveria ter tocado no nome');
      assert.equal(row!.bio, 'bio original', 'nem na bio');
    } finally {
      cleanup(participant);
    }
  });

  it('duas edicoes da mesma conta em sequencia rapida se aplicam em ordem, sem uma apagar a outra', async () => {
    const user = await makeUser('pu');
    const { socket, participant } = joinNew(user.id);
    try {
      // fired without awaiting the first — this is exactly the two-tabs-at-once
      // scenario the per-account queue (profileQueue.ts) exists for
      const first = handlers.profile(socket, { requestId: 'r5', displayName: 'Primeiro' });
      const second = handlers.profile(socket, { requestId: 'r6', bio: 'segunda edicao' });
      await Promise.all([first, second]);

      const [row] = await db.select().from(users).where(eq(users.id, user.id));
      // both changes landed: the second patch (bio-only) didn't run against a
      // stale base that would have reverted displayName to its pre-'Primeiro' value
      assert.equal(row!.displayName, 'Primeiro');
      assert.equal(row!.bio, 'segunda edicao');
      assert.equal(participant.displayName, 'Primeiro');
      assert.equal(participant.bio, 'segunda edicao');
    } finally {
      cleanup(participant);
    }
  });

  it('uma conta nao interfere na fila da outra (patches de contas diferentes nao esperam uma pela outra)', async () => {
    const a = await makeUser('pu'); const b = await makeUser('pu');
    const A = joinNew(a.id); const B = joinNew(b.id);
    try {
      await Promise.all([
        handlers.profile(A.socket, { requestId: 'ra', displayName: 'Conta A' }),
        handlers.profile(B.socket, { requestId: 'rb', displayName: 'Conta B' }),
      ]);
      const [rowA] = await db.select().from(users).where(eq(users.id, a.id));
      const [rowB] = await db.select().from(users).where(eq(users.id, b.id));
      assert.equal(rowA!.displayName, 'Conta A');
      assert.equal(rowB!.displayName, 'Conta B');
    } finally {
      cleanup(A.participant); cleanup(B.participant);
    }
  });
});
