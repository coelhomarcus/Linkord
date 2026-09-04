import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyIncomingChatMessage, setNotificationsModuleEnabled } from './notifications';
import type { IncomingChatEvent } from './notifications';

interface FakeNotificationInstance {
  title: string;
  options: NotificationOptions | undefined;
  onclick: (() => void) | null;
  close: () => void;
}

let created: FakeNotificationInstance[] = [];

class FakeNotification {
  static permission: NotificationPermission = 'granted';
  title: string;
  options: NotificationOptions | undefined;
  onclick: (() => void) | null = null;
  constructor(title: string, options?: NotificationOptions) {
    this.title = title;
    this.options = options;
    created.push(this);
  }
  close(): void {}
}

function baseEvent(overrides: Partial<IncomingChatEvent> = {}): IncomingChatEvent {
  return {
    channelId: 'ch-1',
    channelName: 'geral',
    senderId: 'user-1',
    senderName: 'Fulano',
    text: 'oi',
    mentioned: false,
    ...overrides,
  };
}

beforeEach(() => {
  created = [];
  vi.stubGlobal('Notification', FakeNotification);
  vi.useFakeTimers();
  setNotificationsModuleEnabled(true);
});

afterEach(() => {
  setNotificationsModuleEnabled(false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('notifyIncomingChatMessage', () => {
  it('nao cria notificacao quando o modulo esta desabilitado', () => {
    setNotificationsModuleEnabled(false);
    notifyIncomingChatMessage(baseEvent());
    vi.runAllTimers();
    expect(created).toHaveLength(0);
  });

  it('nao cria notificacao sem permissao concedida', () => {
    FakeNotification.permission = 'default';
    notifyIncomingChatMessage(baseEvent());
    vi.runAllTimers();
    expect(created).toHaveLength(0);
    FakeNotification.permission = 'granted';
  });

  it('uma unica mensagem gera "Remetente: texto"', () => {
    notifyIncomingChatMessage(baseEvent({ senderName: 'Fulano', text: 'oi pessoal' }));
    vi.runAllTimers();
    expect(created).toHaveLength(1);
    expect(created[0]!.options?.body).toBe('Fulano: oi pessoal');
    expect(created[0]!.options?.tag).toBe('chat-ch-1');
  });

  it('rajada rapida do mesmo remetente no mesmo canal colapsa em UMA notificacao', () => {
    for (let i = 0; i < 6; i++) {
      notifyIncomingChatMessage(baseEvent({ text: `mensagem ${i}` }));
      vi.advanceTimersByTime(200); // bem abaixo do debounce
    }
    vi.runAllTimers();
    expect(created).toHaveLength(1);
    expect(created[0]!.options?.body).toBe('Fulano enviou 6 mensagens');
  });

  it('rajada com remetentes diferentes no mesmo canal colapsa citando quantidade de pessoas', () => {
    notifyIncomingChatMessage(baseEvent({ senderId: 'user-1', senderName: 'Fulano' }));
    vi.advanceTimersByTime(200);
    notifyIncomingChatMessage(baseEvent({ senderId: 'user-2', senderName: 'Ciclano' }));
    vi.runAllTimers();
    expect(created).toHaveLength(1);
    expect(created[0]!.options?.body).toBe('2 pessoas enviaram mensagens');
  });

  it('canais diferentes nao se misturam (buffer por canal)', () => {
    notifyIncomingChatMessage(baseEvent({ channelId: 'ch-1' }));
    notifyIncomingChatMessage(baseEvent({ channelId: 'ch-2' }));
    vi.runAllTimers();
    expect(created).toHaveLength(2);
    expect(created.map((n) => n.options?.tag).sort()).toEqual(['chat-ch-1', 'chat-ch-2']);
  });

  it('uma rajada continua (sem pausa) ainda assim dispara periodicamente (MAX_WAIT)', () => {
    for (let i = 0; i < 40; i++) {
      notifyIncomingChatMessage(baseEvent({ text: `m${i}` }));
      vi.advanceTimersByTime(300); // reseta o debounce a cada mensagem, nunca fica quieto
    }
    // 40 * 300ms = 12s de rajada continua, bem acima do MAX_WAIT (6s) —
    // deve ter disparado pelo menos uma vez no meio do caminho.
    expect(created.length).toBeGreaterThan(0);
  });

  it('mensagem com mencao usa titulo diferenciado', () => {
    notifyIncomingChatMessage(baseEvent({ mentioned: true }));
    vi.runAllTimers();
    expect(created[0]!.title).toBe('Voce foi mencionado em #geral');
  });
});
