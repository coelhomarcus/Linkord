import { describe, expect, it } from 'vitest';
import {
  ROUTES, conversationIdFromPath, isAwaitingOpen, isConversationsPath, isSettingsTab,
} from '@/shared/lib/routes';

describe('conversationIdFromPath', () => {
  it('extrai o id de /app/conversations/:id', () => {
    expect(conversationIdFromPath('/app/conversations/abc-123')).toBe('abc-123');
    expect(conversationIdFromPath('/app/conversations/abc-123/')).toBe('abc-123');
  });

  it('decodifica o id (ida e volta com ROUTES.conversation)', () => {
    expect(conversationIdFromPath(ROUTES.conversation('a b/c'))).toBe('a b/c');
  });

  it('e null na rota sem id e em qualquer outra pagina', () => {
    expect(conversationIdFromPath('/app/conversations')).toBeNull();
    expect(conversationIdFromPath('/app/friends')).toBeNull();
    expect(conversationIdFromPath('/app/conversations/a/extra')).toBeNull();
  });

  it('percent-encoding quebrado nao lanca', () => {
    expect(conversationIdFromPath('/app/conversations/%E0%A4%A')).toBeNull();
  });
});

describe('isConversationsPath', () => {
  it('cobre a lista e a conversa, e nada alem disso', () => {
    expect(isConversationsPath('/app/conversations')).toBe(true);
    expect(isConversationsPath('/app/conversations/x')).toBe(true);
    expect(isConversationsPath('/app/conversationsX')).toBe(false);
    expect(isConversationsPath('/app/friends')).toBe(false);
    expect(isConversationsPath('/app/settings/profile')).toBe(false);
  });
});

describe('isSettingsTab', () => {
  it('aceita so as abas conhecidas', () => {
    expect(isSettingsTab('privacy')).toBe(true);
    expect(isSettingsTab('moderation')).toBe(true);
    expect(isSettingsTab('nope')).toBe(false);
    expect(isSettingsTab(undefined)).toBe(false);
  });
});

describe('isAwaitingOpen', () => {
  it('le a marca do state de navegacao, sem confiar em qualquer forma', () => {
    expect(isAwaitingOpen({ awaitingOpen: true })).toBe(true);
    expect(isAwaitingOpen({ awaitingOpen: 'sim' })).toBe(false);
    expect(isAwaitingOpen(null)).toBe(false);
    expect(isAwaitingOpen('x')).toBe(false);
  });
});
