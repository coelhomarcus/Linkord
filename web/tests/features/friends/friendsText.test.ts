import { describe, expect, it } from 'vitest';
import { ApiError } from '@/shared/api/api';
import { describeOutcome, describeSendError, normalizeUsernameInput } from '@/features/friends/friendsText';

describe('normalizeUsernameInput', () => {
  it('tira espacos e o @ que a pessoa digita naturalmente', () => {
    expect(normalizeUsernameInput('  @Lune ')).toBe('Lune');
    expect(normalizeUsernameInput('@@lune')).toBe('lune');
    expect(normalizeUsernameInput('lune')).toBe('lune');
    expect(normalizeUsernameInput(' @ ')).toBe('');
  });
});

describe('describeSendError', () => {
  it('usuario inexistente e bloqueio tem a MESMA mensagem generica (nao revela bloqueio)', () => {
    const text = describeSendError(new ApiError(404, 'user_unavailable', 'x'));
    expect(text).toMatch(/Não foi possível enviar/);
    expect(text).not.toMatch(/bloque/i);
  });

  it('cooldown informa quando volta a poder', () => {
    const text = describeSendError(new ApiError(409, 'cooldown', 'x', '2026-09-19T18:16:53.312Z'));
    expect(text).toMatch(/a partir de/);
  });

  it('cooldown sem data ainda orienta a esperar', () => {
    expect(describeSendError(new ApiError(409, 'cooldown', 'x'))).toMatch(/Aguarde/);
  });

  it('limite de taxa repassa a mensagem do servidor; o resto vira generico', () => {
    expect(describeSendError(new ApiError(429, 'rate_limited', 'Devagar!'))).toBe('Devagar!');
    expect(describeSendError(new Error('boom'))).toBe('Não foi possível enviar a solicitação.');
  });
});

describe('describeOutcome', () => {
  it('cada desfecho tem um texto proprio e um tom', () => {
    expect(describeOutcome('created', 'ana')).toEqual({ text: 'Solicitação enviada para @ana.', tone: 'success' });
    expect(describeOutcome('pending_received', 'ana').text).toMatch(/Solicitações/);
    expect(describeOutcome('already_pending', 'ana').tone).toBe('info');
    expect(describeOutcome('already_friends', 'ana').text).toMatch(/já são amigos/);
  });
});
