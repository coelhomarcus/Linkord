import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { users } from '../../src/db/schema.js';
import { handlers } from '../../src/modules/presence/participants.js';
import { cleanupParticipant, db, joinNew, makeOwnedAvatarUpload, makeUser, pool } from './helpers.js';

// handleProfile hits the real `users` table (updateProfile), unlike every
// other participants.ts handler — the unit suite never touches a database
// (see AGENTS.md), so its persist-before-confirm/broadcast contract, the
// per-account serialization and the image/text isolation live here instead.

after(() => pool.end());

describe('handleProfile: persiste antes de confirmar/transmitir (Postgres real)', () => {
  it('sucesso: grava no banco, transmite e responde profile-result ok com o requestId', async () => {
    const user = await makeUser('pu');
    const { socket, sent, participant } = joinNew(user);
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
      cleanupParticipant(participant);
    }
  });

  it('conta apagada no meio da sessao: responde not_found, nao transmite e nao muda o participante em memoria', async () => {
    const user = await makeUser('pu');
    const { socket, sent, participant } = joinNew(user);
    try {
      await db.delete(users).where(eq(users.id, user.id));
      await handlers.profile(socket, { requestId: 'r2', displayName: 'Fantasma' });

      const result = sent.find((e) => e.payload?.t === 'profile-result');
      assert.deepEqual(result?.payload, { t: 'profile-result', requestId: 'r2', ok: false, code: 'not_found', message: 'Sua conta não foi encontrada.' });
      assert.ok(!sent.some((e) => e.payload?.t === 'participant-updated'), 'nao deveria ter transmitido nada');
      assert.notEqual(participant.displayName, 'Fantasma');
    } finally {
      cleanupParticipant(participant);
    }
  });

  it('sem requestId (uso interno futuro): ainda persiste e transmite, so nao responde profile-result', async () => {
    const user = await makeUser('pu');
    const { socket, sent, participant } = joinNew(user);
    try {
      await handlers.profile(socket, { displayName: 'Sem Id' });
      const [row] = await db.select().from(users).where(eq(users.id, user.id));
      assert.equal(row!.displayName, 'Sem Id');
      assert.ok(!sent.some((e) => e.payload?.t === 'profile-result'));
    } finally {
      cleanupParticipant(participant);
    }
  });

  it('patch so de imagem nao publica nem sobrescreve nome/bio/links em rascunho', async () => {
    const user = await makeUser('pu');
    const { socket, participant } = joinNew(user);
    try {
      const avatarUrl = await makeOwnedAvatarUpload(user.id);
      await handlers.profile(socket, { requestId: 'r3', displayName: 'Original', bio: 'bio original' });
      // a media-only patch — no displayName/bio/profileLinks key at all,
      // the way an avatar upload sends it (see useProfileUpdate.ts)
      await handlers.profile(socket, { requestId: 'r4', avatar: avatarUrl });

      const [row] = await db.select().from(users).where(eq(users.id, user.id));
      assert.equal(row!.avatar, avatarUrl);
      assert.equal(row!.displayName, 'Original', 'o patch de imagem nao deveria ter tocado no nome');
      assert.equal(row!.bio, 'bio original', 'nem na bio');
    } finally {
      cleanupParticipant(participant);
    }
  });

  it('avatar/uploads/<id> que nao foi upado por essa conta e recusado silenciosamente (fica vazio)', async () => {
    // the exact bug this fix closes: a client could set `avatar` to ANY
    // account's own /uploads/<id> (the id is a public, observable string) —
    // sanitizeAvatar only checked the FORMAT, not who actually uploaded it.
    const owner = await makeUser('pu');
    const attacker = await makeUser('pu');
    const { socket, participant } = joinNew(attacker);
    try {
      const someoneElsesAvatar = await makeOwnedAvatarUpload(owner.id);
      await handlers.profile(socket, { requestId: 'r7', avatar: someoneElsesAvatar });

      const [row] = await db.select().from(users).where(eq(users.id, attacker.id));
      assert.equal(row!.avatar, '', 'uma referencia que nao e minha deveria virar vazio, nao ser aceita');
    } finally {
      cleanupParticipant(participant);
    }
  });

  it('uma URL externa (https://...) continua aceita normalmente — o check e so pra /uploads/<id>', async () => {
    const user = await makeUser('pu');
    const { socket, participant } = joinNew(user);
    try {
      await handlers.profile(socket, { requestId: 'r8', avatar: 'https://exemplo.com/foto.png' });
      const [row] = await db.select().from(users).where(eq(users.id, user.id));
      assert.equal(row!.avatar, 'https://exemplo.com/foto.png');
    } finally {
      cleanupParticipant(participant);
    }
  });

  it('duas edicoes da mesma conta em sequencia rapida se aplicam em ordem, sem uma apagar a outra', async () => {
    const user = await makeUser('pu');
    const { socket, participant } = joinNew(user);
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
      cleanupParticipant(participant);
    }
  });

  it('uma conta nao interfere na fila da outra (patches de contas diferentes nao esperam uma pela outra)', async () => {
    const a = await makeUser('pu'); const b = await makeUser('pu');
    const A = joinNew(a); const B = joinNew(b);
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
      cleanupParticipant(A.participant); cleanupParticipant(B.participant);
    }
  });
});
