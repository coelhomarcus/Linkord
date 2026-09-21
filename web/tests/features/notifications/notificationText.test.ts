import { describe, expect, it } from 'vitest';
import type { NotificationEntry } from '@/shared/api/api';
import { describeNotification, formatRelativeTime, formatUnread, notificationTarget } from '@/features/notifications/notificationText';

const actor = { id: 'u-ana', username: 'ana', displayName: 'Ana', avatar: '', avatarColor: 'blurple' };
const base: NotificationEntry = { id: 'n1', kind: 'friend_request', at: '2026-01-01T00:00:00.000Z', read: false, friendshipId: 'f1', invitationId: null, actor, group: null };

describe('notificationText', () => {
  it('descreve cada tipo', () => {
    expect(describeNotification(base)).toBe('Ana enviou uma solicitação de amizade');
    expect(describeNotification({ ...base, kind: 'friend_accepted' })).toBe('Ana aceitou sua solicitação de amizade');
    expect(describeNotification({ ...base, kind: 'group_invitation', group: { id: 'g', title: 'Squad', avatar: '' } })).toBe('Ana convidou você para o grupo Squad');
  });

  it('tolera ator ou grupo ausentes', () => {
    expect(describeNotification({ ...base, actor: null })).toBe('Alguém enviou uma solicitação de amizade');
    expect(describeNotification({ ...base, kind: 'group_invitation' })).toBe('Ana convidou você para um grupo');
  });

  it('cada tipo leva a sua pagina', () => {
    expect(notificationTarget(base)).toBe('/app/friends?tab=pending#received');
    expect(notificationTarget({ ...base, kind: 'friend_accepted' })).toBe('/app/friends');
    expect(notificationTarget({ ...base, kind: 'group_invitation' })).toBe('/app/friends?tab=invitations');
  });

  it('contador vira 9+', () => {
    expect(formatUnread(3)).toBe('3');
    expect(formatUnread(10)).toBe('9+');
  });

  it('tempo relativo', () => {
    const now = new Date('2026-01-01T12:00:00Z').getTime();
    expect(formatRelativeTime('2026-01-01T11:59:40Z', now)).toBe('agora');
    expect(formatRelativeTime('2026-01-01T11:30:00Z', now)).toBe('há 30 min');
    expect(formatRelativeTime('2026-01-01T09:00:00Z', now)).toBe('há 3 h');
    expect(formatRelativeTime('2025-12-30T12:00:00Z', now)).toBe('há 2 d');
    expect(formatRelativeTime('lixo', now)).toBe('');
  });
});
