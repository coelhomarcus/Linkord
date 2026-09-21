import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { PROTOCOL_VERSION } from '@/shared/types/protocol';
import { useSocketConnection } from '@/state/hooks/useSocketConnection';

type Handler = (...args: unknown[]) => void;
const fake = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), any: null as Handler | null }));

vi.mock('socket.io-client', () => ({
  io: () => ({
    active: true,
    on: (event: string, handler: Handler) => { fake.handlers.set(event, handler); },
    onAny: (handler: Handler) => { fake.any = handler; },
    disconnect: vi.fn(),
  }),
}));

beforeEach(() => { fake.handlers.clear(); fake.any = null; });

function setup() {
  const sendWs = vi.fn();
  const onMessage = vi.fn();
  renderHook(() => useSocketConnection({
    socketRef: { current: null }, intentionalCloseRef: { current: false }, sendWs, dispatch: vi.fn(), refreshAuth: vi.fn().mockResolvedValue(undefined), onMessage,
  }));
  return { sendWs, onMessage };
}

describe('useSocketConnection — join', () => {
  it('o join anuncia a versao do protocolo (sem ela o servidor manda atualizar)', () => {
    const { sendWs } = setup();
    fake.handlers.get('connect')!();
    expect(sendWs).toHaveBeenCalledWith(expect.objectContaining({ t: 'join', v: PROTOCOL_VERSION }));
  });

  it('repassa as mensagens do servidor, inclusive o client_outdated', () => {
    const { onMessage } = setup();
    fake.any!('error', { t: 'error', code: 'client_outdated', message: 'x' });
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ code: 'client_outdated' }));
  });
});
