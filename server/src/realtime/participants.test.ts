import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config/env.js';
import type { AppSocket } from '../types.js';
import {
  participants, join, removeParticipant, handleClose, isUserOnline, setVoiceChannelId, publicParticipant,
} from './participants.js';

/** Fake minimo de AppSocket — so os campos que participants.ts de fato le
 * (nunca uma Socket.IO de verdade, sem conexao nenhuma). */
function fakeSocket(userId: string, overrides: Partial<{ username: string; avatar: string; role: 'user' | 'admin' }> = {}): AppSocket {
  return {
    participantId: null,
    ip: '127.0.0.1',
    connected: true,
    emit: () => {},
    disconnect: () => {},
    user: { tokenHash: 'x', userId, username: overrides.username ?? userId, avatar: overrides.avatar ?? '', role: overrides.role ?? 'user' },
  } as unknown as AppSocket;
}

// participants e um Map module-level compartilhado entre TODOS os testes
// deste processo — cada teste guarda os ids que criou aqui e limpa no
// afterEach (inclusive cancelando qualquer graceTimer pendente, que senao
// seguraria o processo do `node --test` vivo ate o timeout de reconexao).
let createdIds: string[] = [];
afterEach(() => {
  for (const id of createdIds) {
    const p = participants.get(id);
    if (p?.graceTimer) clearTimeout(p.graceTimer);
    participants.delete(id);
  }
  createdIds = [];
});

describe('join', () => {
  test('cria um participante novo e marca socket.participantId', () => {
    const userId = `u-${Math.random()}`;
    const socket = fakeSocket(userId);
    const p = join(socket, {});
    assert.ok(p);
    createdIds.push(p!.id);
    assert.equal(socket.participantId, p!.id);
    assert.equal(p!.userId, userId);
    assert.equal(p!.deafened, false);
    assert.equal(p!.voiceChannelId, null);
    assert.equal(participants.get(p!.id), p);
  });

  test('primeira conexao de uma conta vira "online"; segunda aba da MESMA conta nao duplica o status', () => {
    const userId = `u-${Math.random()}`;
    assert.equal(isUserOnline(userId), false);

    const p1 = join(fakeSocket(userId), {});
    createdIds.push(p1!.id);
    assert.equal(isUserOnline(userId), true);

    // segunda aba, sem token de resume — cria um SEGUNDO participante (id de
    // conexao diferente), mas a conta continua sendo so UMA "online".
    const p2 = join(fakeSocket(userId), {});
    createdIds.push(p2!.id);
    assert.notEqual(p1!.id, p2!.id);
    assert.equal(isUserOnline(userId), true);
  });

  test('sala cheia (MAX_PARTICIPANTS) rejeita join novo', () => {
    const original = config.MAX_PARTICIPANTS;
    config.MAX_PARTICIPANTS = participants.size + 1;
    try {
      const p1 = join(fakeSocket(`u-${Math.random()}`), {});
      createdIds.push(p1!.id);
      const p2 = join(fakeSocket(`u-${Math.random()}`), {});
      assert.equal(p2, null);
    } finally {
      config.MAX_PARTICIPANTS = original;
    }
  });
});

describe('reconexao (handleClose + resume por id/token)', () => {
  test('resume a MESMA identidade com id/token validos, limpando o graceTimer', () => {
    const userId = `u-${Math.random()}`;
    const socket1 = fakeSocket(userId);
    const original = join(socket1, {});
    createdIds.push(original!.id);

    handleClose(socket1); // "aba caiu" — entra na janela de graca
    assert.equal(original!.socket, null);
    assert.ok(original!.graceTimer);

    const socket2 = fakeSocket(userId);
    const resumed = join(socket2, { id: original!.id, token: original!.token });

    assert.equal(resumed!.id, original!.id); // mesma identidade, nao um participante novo
    assert.equal(resumed!.socket, socket2);
    assert.equal(resumed!.graceTimer, null);
  });

  test('token errado nao resume a identidade antiga (mas evict do fantasma libera um join novo)', () => {
    const userId = `u-${Math.random()}`;
    const socket1 = fakeSocket(userId);
    const original = join(socket1, {});
    createdIds.push(original!.id);

    handleClose(socket1);

    const socket2 = fakeSocket(userId);
    const fresh = join(socket2, { id: original!.id, token: 'token-errado' });
    createdIds.push(fresh!.id);

    assert.notEqual(fresh!.id, original!.id); // NAO reaproveitou a identidade antiga
    // o fantasma da conexao antiga (socket null) foi removido no processo —
    // so sobra a nova identidade pra essa conta.
    assert.equal(participants.has(original!.id), false);
  });
});

describe('removeParticipant', () => {
  test('remove do Map e marca offline se era a unica conexao dessa conta', () => {
    const userId = `u-${Math.random()}`;
    const p = join(fakeSocket(userId), {})!;
    assert.equal(isUserOnline(userId), true);

    removeParticipant(p);
    assert.equal(participants.has(p.id), false);
    assert.equal(isUserOnline(userId), false);
  });

  test('chamar de novo (ja removido) e no-op seguro', () => {
    const p = join(fakeSocket(`u-${Math.random()}`), {})!;
    removeParticipant(p);
    assert.doesNotThrow(() => removeParticipant(p));
  });
});

describe('setVoiceChannelId', () => {
  test('muda o campo e reflete em publicParticipant (sem vazar token)', () => {
    const p = join(fakeSocket(`u-${Math.random()}`), {})!;
    createdIds.push(p.id);

    setVoiceChannelId(p, 'canal-voz-1');
    assert.equal(p.voiceChannelId, 'canal-voz-1');
    assert.equal(publicParticipant(p).voiceChannelId, 'canal-voz-1');
    assert.equal('token' in publicParticipant(p), false);

    setVoiceChannelId(p, null);
    assert.equal(p.voiceChannelId, null);
  });
});
