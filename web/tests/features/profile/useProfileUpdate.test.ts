import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ClientMessage, PublicUser, ServerMessage } from '@/shared/types/protocol';
import {
  ProfileSaveOffline, ProfileSaveRefused, ProfileSaveTimeout, describeProfileSaveError, useProfileUpdate,
} from '@/features/profile/useProfileUpdate';

const fullProfile = { avatar: '', avatarPoster: '', avatarColor: 'blurple', displayName: 'Fulana', banner: '', bannerPoster: '', bio: '', profileLinks: [] };

function setup(isConnected = () => true) {
  const dispatch = vi.fn();
  const sent: ClientMessage[] = [];
  const sendWs = vi.fn((msg: ClientMessage) => { sent.push(msg); });
  const setAllUsers = vi.fn();
  const myUserIdRef = { current: 'u1' };
  const { result } = renderHook(() => useProfileUpdate({ dispatch, sendWs, isConnected, myUserIdRef, setAllUsers, name: 'fulana' }));
  const requestIdOf = (i = 0) => (sent[i] as Extract<ClientMessage, { t: 'profile' }>).requestId;
  const resultFor = (i: number, patch: Partial<Extract<ServerMessage, { t: 'profile-result' }>>): Extract<ServerMessage, { t: 'profile-result' }> => ({
    t: 'profile-result', requestId: requestIdOf(i), ok: true, ...fullProfile, ...patch,
  }) as never;
  return { result, dispatch, sendWs, sent, setAllUsers, myUserIdRef, requestIdOf, resultFor };
}

describe('useProfileUpdate', () => {
  it('updateProfile manda o patch completo com requestId e resolve na resposta correlacionada', async () => {
    const { result, sent, dispatch, setAllUsers } = setup();
    setAllUsers.mockImplementation((updater) => updater(new Map([['u1', { id: 'u1' } as PublicUser]])));

    const promise = result.current.updateProfile(fullProfile);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ t: 'profile', displayName: 'Fulana' });
    expect(typeof (sent[0] as any).requestId).toBe('string');

    act(() => result.current.handleProfileResult({ t: 'profile-result', requestId: (sent[0] as any).requestId, ok: true, ...fullProfile, displayName: 'Confirmado' } as never));
    await promise;
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_LOCAL_PROFILE', displayName: 'Confirmado' }));
  });

  it('uploadProfileImage nunca inclui displayName/bio/cor/links — so os campos da imagem', async () => {
    // uploadWithProgress.ts drives a raw XMLHttpRequest (property assignment,
    // not addEventListener) — this fake matches exactly that shape.
    class FakeXHR {
      upload = { onprogress: null as (() => void) | null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      open = vi.fn();
      setRequestHeader = vi.fn();
      status = 200;
      responseText = JSON.stringify({ avatar: '/uploads/novo', avatarPoster: '/uploads/poster' });
      send = vi.fn(() => { queueMicrotask(() => this.onload?.()); });
    }
    // @ts-expect-error test double, not the real constructor signature
    global.XMLHttpRequest = FakeXHR;

    const { result, sent } = setup();
    const uploadPromise = result.current.uploadProfileImage('avatar', new Blob(['x']), { x: 0, y: 0, width: 1, height: 1 });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(sent).toHaveLength(1);
    const patch = sent[0] as any;
    expect(patch).toMatchObject({ t: 'profile', avatar: '/uploads/novo', avatarPoster: '/uploads/poster' });
    expect(patch).not.toHaveProperty('displayName');
    expect(patch).not.toHaveProperty('bio');
    expect(patch).not.toHaveProperty('avatarColor');
    expect(patch).not.toHaveProperty('profileLinks');

    act(() => result.current.handleProfileResult({ t: 'profile-result', requestId: patch.requestId, ok: true, ...fullProfile, avatar: '/uploads/novo' } as never));
    await uploadPromise;
  });

  it('sem conexao: rejeita na hora, sem chegar a enviar nada', async () => {
    const { result, sendWs } = setup(() => false);
    await expect(result.current.updateProfile(fullProfile)).rejects.toBeInstanceOf(ProfileSaveOffline);
    expect(sendWs).not.toHaveBeenCalled();
  });

  it('recusa do servidor rejeita com o codigo e a mensagem, sem tocar no estado local', async () => {
    const { result, sent, dispatch } = setup();
    const promise = result.current.updateProfile(fullProfile);
    act(() => result.current.handleProfileResult({ t: 'profile-result', requestId: (sent[0] as any).requestId, ok: false, code: 'rate_limited', message: 'Devagar.' } as never));
    await expect(promise).rejects.toMatchObject({ code: 'rate_limited', message: 'Devagar.' });
    await expect(promise).rejects.toBeInstanceOf(ProfileSaveRefused);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('sem resposta nenhuma: rejeita por timeout (nao fica pendurado para sempre)', async () => {
    vi.useFakeTimers();
    try {
      const { result } = setup();
      const promise = result.current.updateProfile(fullProfile);
      const assertion = expect(promise).rejects.toBeInstanceOf(ProfileSaveTimeout);
      await vi.advanceTimersByTimeAsync(20_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('uma resposta que chega depois do timeout (ou de outra sessao) e ignorada em silencio', () => {
    const { result } = setup();
    expect(() => result.current.handleProfileResult({ t: 'profile-result', requestId: 'nunca-pedido', ok: true, ...fullProfile } as never)).not.toThrow();
  });

  it('desmontar rejeita qualquer pedido ainda pendente, sem deixar timer solto', async () => {
    const { result, sent, unmount } = (() => {
      const dispatch = vi.fn(); const sent: ClientMessage[] = [];
      const sendWs = vi.fn((m: ClientMessage) => sent.push(m));
      const hook = renderHook(() => useProfileUpdate({ dispatch, sendWs, isConnected: () => true, myUserIdRef: { current: 'u1' }, setAllUsers: vi.fn(), name: 'fulana' }));
      return { result: hook.result, sent, unmount: hook.unmount };
    })();
    const promise = result.current.updateProfile(fullProfile);
    const assertion = expect(promise).rejects.toBeInstanceOf(ProfileSaveTimeout);
    unmount();
    await assertion;
    expect(sent).toHaveLength(1);
  });
});

describe('describeProfileSaveError', () => {
  it('usa a mensagem de cada tipo conhecido e o fallback para o resto', () => {
    expect(describeProfileSaveError(new ProfileSaveOffline())).toMatch(/conexão/);
    expect(describeProfileSaveError(new ProfileSaveTimeout())).toMatch(/confirmado a tempo/);
    expect(describeProfileSaveError(new ProfileSaveRefused('x', 'Motivo do servidor.'))).toBe('Motivo do servidor.');
    expect(describeProfileSaveError(new Error('outra coisa'))).toBe('Não foi possível salvar o perfil. Tente de novo.');
    expect(describeProfileSaveError(new Error('x'), 'Mensagem própria.')).toBe('Mensagem própria.');
  });
});
