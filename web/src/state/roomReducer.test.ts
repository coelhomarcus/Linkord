import { describe, expect, it } from 'vitest';
import { initialRoomState, roomReducer } from './roomReducer';
import type { Participant } from '../types/protocol';

function participant(overrides: Partial<Participant> = {}): Participant {
  return { id: 'p1', userId: 'u1', name: 'Fulana', avatar: '', role: 'user', deafened: false, voiceChannelId: null, ...overrides };
}

describe('roomReducer', () => {
  it('WELCOME preenche "me" e a lista de participantes, e limpa roomError', () => {
    const state = { ...initialRoomState, roomError: 'sala cheia' };
    const next = roomReducer(state, {
      type: 'WELCOME',
      id: 'conn1',
      userId: 'u1',
      name: 'Fulana',
      avatar: 'a.png',
      role: 'admin',
      participants: [participant({ id: 'p2', userId: 'u2' })],
    });
    expect(next.me).toEqual({ ...initialRoomState.me, id: 'conn1', userId: 'u1', name: 'Fulana', avatar: 'a.png', role: 'admin' });
    expect(next.participants.get('p2')?.userId).toBe('u2');
    expect(next.joined).toBe(true);
    expect(next.roomError).toBeNull();
  });

  it('PARTICIPANT_UPDATED ignora quem nao esta na sala (evita reviver um participante que ja saiu)', () => {
    const state = { ...initialRoomState, participants: new Map([['p1', participant()]]) };
    const next = roomReducer(state, { type: 'PARTICIPANT_UPDATED', participant: participant({ id: 'ghost' }) });
    expect(next.participants.has('ghost')).toBe(false);
    expect(next).toBe(state); // sem mudanca de verdade -> mesma referencia
  });

  it('PARTICIPANT_UPDATED atualiza quem ja esta na sala', () => {
    const state = { ...initialRoomState, participants: new Map([['p1', participant({ deafened: false })]]) };
    const next = roomReducer(state, { type: 'PARTICIPANT_UPDATED', participant: participant({ deafened: true }) });
    expect(next.participants.get('p1')?.deafened).toBe(true);
  });

  describe('PARTICIPANT_LEFT', () => {
    it('remove o participante e desfoca se o foco era NELE (prefixo `${id}:`)', () => {
      const state = { ...initialRoomState, participants: new Map([['p1', participant()]]), focusedId: 'p1:screen' };
      const next = roomReducer(state, { type: 'PARTICIPANT_LEFT', id: 'p1' });
      expect(next.participants.has('p1')).toBe(false);
      expect(next.focusedId).toBeNull();
    });

    it('nao mexe no foco se o foco era de OUTRA pessoa', () => {
      const state = {
        ...initialRoomState,
        participants: new Map([['p1', participant()], ['p2', participant({ id: 'p2' })]]),
        focusedId: 'p2:camera',
      };
      const next = roomReducer(state, { type: 'PARTICIPANT_LEFT', id: 'p1' });
      expect(next.focusedId).toBe('p2:camera');
    });

    it('nao confunde prefixo — "p1x" saindo nao desfoca "p1:screen"', () => {
      const state = {
        ...initialRoomState,
        participants: new Map([['p1', participant()], ['p1x', participant({ id: 'p1x' })]]),
        focusedId: 'p1:screen',
      };
      const next = roomReducer(state, { type: 'PARTICIPANT_LEFT', id: 'p1x' });
      expect(next.focusedId).toBe('p1:screen');
    });
  });

  it('PARTICIPANT_JOINED adiciona um participante novo a sala', () => {
    const next = roomReducer(initialRoomState, { type: 'PARTICIPANT_JOINED', participant: participant({ id: 'p2', userId: 'u2' }) });
    expect(next.participants.get('p2')?.userId).toBe('u2');
  });

  it('SET_RECONNECTING liga/desliga o flag', () => {
    const next = roomReducer(initialRoomState, { type: 'SET_RECONNECTING', value: true });
    expect(next.reconnecting).toBe(true);
    expect(roomReducer(next, { type: 'SET_RECONNECTING', value: false }).reconnecting).toBe(false);
  });

  it('SET_LOCAL_AVATAR atualiza so o avatar de "me", sem mexer no resto', () => {
    const next = roomReducer(initialRoomState, { type: 'SET_LOCAL_AVATAR', avatar: 'novo.png' });
    expect(next.me.avatar).toBe('novo.png');
    expect(next.me.name).toBe(initialRoomState.me.name);
  });

  it('SET_ROOM_ERROR seta e limpa (null) a mensagem de erro de sala', () => {
    const withError = roomReducer(initialRoomState, { type: 'SET_ROOM_ERROR', message: 'sala cheia' });
    expect(withError.roomError).toBe('sala cheia');
    expect(roomReducer(withError, { type: 'SET_ROOM_ERROR', message: null }).roomError).toBeNull();
  });

  it('SET_LOCAL_CAMERA liga/desliga o flag de camera de "me"', () => {
    const next = roomReducer(initialRoomState, { type: 'SET_LOCAL_CAMERA', on: true });
    expect(next.me.cameraOn).toBe(true);
  });

  it('SET_FOCUSED muda o id em foco (tile key, nao so participantId)', () => {
    const next = roomReducer(initialRoomState, { type: 'SET_FOCUSED', id: 'p1:screen' });
    expect(next.focusedId).toBe('p1:screen');
    expect(roomReducer(next, { type: 'SET_FOCUSED', id: null }).focusedId).toBeNull();
  });

  it('SET_SHARE_ERROR seta e limpa (null) o erro de compartilhamento/mic', () => {
    const withError = roomReducer(initialRoomState, { type: 'SET_SHARE_ERROR', message: 'sem permissao de microfone' });
    expect(withError.shareError).toBe('sem permissao de microfone');
    expect(roomReducer(withError, { type: 'SET_SHARE_ERROR', message: null }).shareError).toBeNull();
  });

  describe('SET_LOCAL_SHARING', () => {
    it('liga: registra sharingSince se ainda nao tinha um', () => {
      const next = roomReducer(initialRoomState, { type: 'SET_LOCAL_SHARING', sharing: true });
      expect(next.me.sharing).toBe(true);
      expect(next.me.sharingSince).toEqual(expect.any(Number));
    });

    it('liga de novo sem desligar antes: mantem o sharingSince original (nao reseta o cronometro)', () => {
      const state = { ...initialRoomState, me: { ...initialRoomState.me, sharing: true, sharingSince: 1000 } };
      const next = roomReducer(state, { type: 'SET_LOCAL_SHARING', sharing: true });
      expect(next.me.sharingSince).toBe(1000);
    });

    it('desliga: zera sharingSince', () => {
      const state = { ...initialRoomState, me: { ...initialRoomState.me, sharing: true, sharingSince: 1000 } };
      const next = roomReducer(state, { type: 'SET_LOCAL_SHARING', sharing: false });
      expect(next.me.sharing).toBe(false);
      expect(next.me.sharingSince).toBeNull();
    });
  });

  it('acao desconhecida devolve o mesmo state (default do switch)', () => {
    const next = roomReducer(initialRoomState, { type: 'NOT_A_REAL_ACTION' } as never);
    expect(next).toBe(initialRoomState);
  });
});
