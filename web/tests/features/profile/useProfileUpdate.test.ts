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
  it('updateProfile sends the full patch with requestId and resolves on the correlated response', async () => {
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

  it('uploadProfileImage never includes displayName/bio/color/links — only the image fields', async () => {
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

  it('offline: rejects right away, without ever sending anything', async () => {
    const { result, sendWs } = setup(() => false);
    await expect(result.current.updateProfile(fullProfile)).rejects.toBeInstanceOf(ProfileSaveOffline);
    expect(sendWs).not.toHaveBeenCalled();
  });

  it('server refusal rejects with the code and message, without touching local state', async () => {
    const { result, sent, dispatch } = setup();
    const promise = result.current.updateProfile(fullProfile);
    act(() => result.current.handleProfileResult({ t: 'profile-result', requestId: (sent[0] as any).requestId, ok: false, code: 'rate_limited', message: 'Devagar.' } as never));
    await expect(promise).rejects.toMatchObject({ code: 'rate_limited', message: 'Devagar.' });
    await expect(promise).rejects.toBeInstanceOf(ProfileSaveRefused);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('no response at all: rejects on timeout (never hangs forever)', async () => {
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

  it('a response that arrives after the timeout (or from another session) is silently ignored', () => {
    const { result } = setup();
    expect(() => result.current.handleProfileResult({ t: 'profile-result', requestId: 'nunca-pedido', ok: true, ...fullProfile } as never)).not.toThrow();
  });

  it('unmounting rejects any still-pending request, without leaving a loose timer', async () => {
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
  it('uses each known error type\'s message, and the fallback for the rest', () => {
    expect(describeProfileSaveError(new ProfileSaveOffline())).toMatch(/conexão/);
    expect(describeProfileSaveError(new ProfileSaveTimeout())).toMatch(/confirmado a tempo/);
    expect(describeProfileSaveError(new ProfileSaveRefused('x', 'Motivo do servidor.'))).toBe('Motivo do servidor.');
    expect(describeProfileSaveError(new Error('outra coisa'))).toBe('Não foi possível salvar o perfil. Tente de novo.');
    expect(describeProfileSaveError(new Error('x'), 'Mensagem própria.')).toBe('Mensagem própria.');
  });
});
