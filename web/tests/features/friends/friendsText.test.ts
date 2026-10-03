import { describe, expect, it } from 'vitest';
import { ApiError } from '@/shared/api/api';
import { describeOutcome, describeSendError, normalizeUsernameInput } from '@/features/friends/friendsText';

describe('normalizeUsernameInput', () => {
  it('strips spaces and the @ that people naturally type', () => {
    expect(normalizeUsernameInput('  @Lune ')).toBe('Lune');
    expect(normalizeUsernameInput('@@lune')).toBe('lune');
    expect(normalizeUsernameInput('lune')).toBe('lune');
    expect(normalizeUsernameInput(' @ ')).toBe('');
  });
});

describe('describeSendError', () => {
  it('a nonexistent user and a block share the SAME generic message (does not reveal the block)', () => {
    const text = describeSendError(new ApiError(404, 'user_unavailable', 'x'));
    expect(text).toMatch(/Não foi possível enviar/);
    expect(text).not.toMatch(/bloque/i);
  });

  it('cooldown tells you when you can retry', () => {
    const text = describeSendError(new ApiError(409, 'cooldown', 'x', '2026-09-19T18:16:53.312Z'));
    expect(text).toMatch(/a partir de/);
  });

  it('cooldown with no date still tells you to wait', () => {
    expect(describeSendError(new ApiError(409, 'cooldown', 'x'))).toMatch(/Aguarde/);
  });

  it('rate limit passes through the server message; everything else becomes generic', () => {
    expect(describeSendError(new ApiError(429, 'rate_limited', 'Devagar!'))).toBe('Devagar!');
    expect(describeSendError(new Error('boom'))).toBe('Não foi possível enviar a solicitação.');
  });
});

describe('describeOutcome', () => {
  it('each outcome has its own text and tone', () => {
    expect(describeOutcome('created', 'ana')).toEqual({ text: 'Solicitação enviada para @ana.', tone: 'success' });
    expect(describeOutcome('pending_received', 'ana').text).toMatch(/Solicitações/);
    expect(describeOutcome('already_pending', 'ana').tone).toBe('info');
    expect(describeOutcome('already_friends', 'ana').text).toMatch(/já são amigos/);
  });
});
