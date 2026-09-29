import { describe, expect, it, vi } from 'vitest';
import { buildCommandItems } from '@/features/conversations/commandPaletteItems';
import { ROUTES, friendsView } from '@/shared/lib/routes';
import type { Conversation, Participant, PublicUser } from '@/shared/types/protocol';

function fakeUser(id: string, username: string, displayName: string): PublicUser {
  return { id, username, displayName, avatar: '', avatarColor: 'blurple', banner: '', bio: '', profileLinks: [], role: 'user' };
}

function fakeConversation(overrides: Partial<Conversation> & { id: string }): Conversation {
  return {
    type: 'direct', title: '', avatar: '', createdBy: null, memberIds: [],
    lastMessageAt: null, createdAt: 1, updatedAt: 1, pinnedAt: null, myRole: 'member', ownerId: null, memberCount: 0,
    ...overrides,
  };
}

function fakeParticipant(overrides: Partial<Participant> & { id: string; userId: string }): Participant {
  return {
    name: '', displayName: '', avatar: '', avatarPoster: '', avatarColor: 'blurple', banner: '', bannerPoster: '', bio: '', profileLinks: [],
    role: 'user', deafened: false, callConversationId: null, micActivated: false, micMuted: true, cameraOn: false,
    sharing: false, speaking: false,
    ...overrides,
  };
}

const me = 'user-me';
const ana = fakeUser('user-ana', 'ana', 'Ana');
const bruno = fakeUser('user-bruno', 'bruno', 'Bruno');
// Carla: a co-member of the group below, but NOT a friend — allUsers
// carries her (her profile is needed to render the shared group), but
// she must not be offered as a DM target (docs/plano-rede-social.md §3).
const carla = fakeUser('user-carla', 'carla', 'Carla');
const dara = fakeUser('user-dara', 'dara', 'Dara'); // a friend with no conversation at all yet
const allUsers = new Map([[ana.id, ana], [bruno.id, bruno], [carla.id, carla], [dara.id, dara]]);

const dmWithAna = fakeConversation({ id: 'conv-dm-ana', type: 'direct', memberIds: [me, ana.id] });
const group = fakeConversation({ id: 'conv-group', type: 'group', title: 'Squad', memberIds: [me, bruno.id, carla.id] });
const conversations = [dmWithAna, group];

// Ana (has a DM already) and Bruno (group member) are friends; Carla (also a
// group member) is not; Dara is a friend with no conversation yet.
const defaultFriendUserIds = new Set([ana.id, bruno.id, dara.id]);

const noFriendsSummary = { pendingFriendRequestCount: 0, pendingInvitationCount: 0 };
const noopActions = { onOpenConversation: vi.fn(), onMessageUser: vi.fn(), onCall: vi.fn(), onNavigate: vi.fn(), onOpenProfile: vi.fn() };

function build(overrides: Partial<{
  friendUserIds: Set<string>;
  participants: Map<string, Participant>;
  activeCallConversationId: string | null;
  friends: typeof noFriendsSummary;
  isAdmin: boolean;
  actions: typeof noopActions;
}> = {}) {
  return buildCommandItems(
    conversations, allUsers, me,
    overrides.participants ?? new Map(),
    overrides.activeCallConversationId ?? null,
    overrides.friendUserIds ?? defaultFriendUserIds,
    overrides.friends ?? noFriendsSummary,
    overrides.isAdmin ?? false,
    overrides.actions ?? noopActions
  );
}

function callStage(items: ReturnType<typeof buildCommandItems>) {
  return items.find((it) => it.id === 'action:call')?.stage?.items ?? [];
}

function messageStage(items: ReturnType<typeof buildCommandItems>) {
  return items.find((it) => it.id === 'action:message')?.stage?.items ?? [];
}

function friendsStage(items: ReturnType<typeof buildCommandItems>) {
  return items.find((it) => it.id === 'action:friends')?.stage?.items ?? [];
}

function settingsStage(items: ReturnType<typeof buildCommandItems>) {
  return items.find((it) => it.id === 'action:settings')?.stage?.items ?? [];
}

describe('buildCommandItems', () => {
  it('lists one "Conversas" entry per existing conversation', () => {
    const items = build();
    const conversationItems = items.filter((it) => it.group === 'Conversas');
    expect(conversationItems.map((it) => it.label)).toEqual(['Ana', 'Squad']);
  });

  it('the root only has "Ações", "Chamadas em andamento" and "Conversas" — no loose person', () => {
    const items = build();
    const groups = new Set(items.map((it) => it.group));
    expect(groups).toEqual(new Set(['Ações', 'Conversas']));
  });

  it('action items carry an icon (not an avatar); the rest carry an avatar (not a generic icon)', () => {
    const items = build();
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      if (item.id.startsWith('action:')) {
        expect(item.icon).toBeTruthy();
        expect(item.avatar).toBeUndefined();
      } else {
        expect(item.avatar).toBeTruthy();
        expect(item.icon).toBeUndefined();
      }
    }
  });

  it('the "Conversar com…" stage only lists friends — not a group co-member who is not a friend', () => {
    const items = build();
    const peopleItems = messageStage(items);
    // Carla is a group co-member but NOT a friend — must not appear, even
    // though she's in allUsers (her profile is needed to render the group).
    expect(peopleItems.map((it) => it.label).sort()).toEqual(['Ana', 'Bruno', 'Dara']);
  });

  it('lists a friend even if I already have a DM with them — picking it just reopens the conversation', () => {
    const items = build();
    expect(messageStage(items).map((it) => it.label)).toContain('Ana');
  });

  it('does not list a non-friend, even when they are a co-member of a shared group', () => {
    const items = build();
    expect(messageStage(items).some((it) => it.label === 'Carla')).toBe(false);
  });

  it('does not list myself in the "Conversar com…" stage', () => {
    const meAsUser = fakeUser(me, 'eu', 'Eu Mesmo');
    const withMe = new Map([...allUsers, [me, meAsUser]]);
    const friendUserIds = new Set([...defaultFriendUserIds, me]);
    const items = buildCommandItems(conversations, withMe, me, new Map(), null, friendUserIds, noFriendsSummary, false, noopActions);
    expect(messageStage(items).some((it) => it.label.includes('Eu Mesmo'))).toBe(false);
  });

  it('selecting a conversation item calls onOpenConversation with the right id', () => {
    const actions = { ...noopActions, onOpenConversation: vi.fn() };
    const items = build({ actions });
    items.find((it) => it.group === 'Conversas' && it.label === 'Squad')?.onSelect?.();
    expect(actions.onOpenConversation).toHaveBeenCalledWith('conv-group');
  });

  it('selecting a person in the "Conversar com…" stage calls onMessageUser with the right id', () => {
    const actions = { ...noopActions, onMessageUser: vi.fn() };
    const items = build({ actions });
    messageStage(items).find((it) => it.label === 'Dara')?.onSelect?.();
    expect(actions.onMessageUser).toHaveBeenCalledWith(dara.id);
  });

  it('a conversation with a participant on a call becomes "Entrar na chamada" at the root, and drops out of the "Ligar para…" stage', () => {
    const participants = new Map([
      ['p-bruno', fakeParticipant({ id: 'p-bruno', userId: bruno.id, callConversationId: 'conv-group' })],
    ]);
    const items = build({ participants });

    const joinItems = items.filter((it) => it.group === 'Chamadas em andamento');
    expect(joinItems.map((it) => it.label)).toEqual(['Entrar na chamada em Squad']);
    // dmWithAna has no one on the call — stays in the "Ligar para…" stage.
    expect(callStage(items).map((it) => it.label)).toEqual(['Ana']);
  });

  it('a call I am already in does not show up in "join" nor in the "Ligar para…" stage', () => {
    const participants = new Map([
      ['p-bruno', fakeParticipant({ id: 'p-bruno', userId: bruno.id, callConversationId: 'conv-group' })],
    ]);
    const items = build({ participants, activeCallConversationId: 'conv-group' });

    expect(items.some((it) => it.group === 'Chamadas em andamento')).toBe(false);
    expect(callStage(items).map((it) => it.label)).toEqual(['Ana']);
  });

  it('selecting "join call" (root) or a conversation in the "Ligar para…" stage calls onCall with the right id', () => {
    const actions = { ...noopActions, onCall: vi.fn() };
    const items = build({ actions });
    callStage(items).find((it) => it.label === 'Ana')?.onSelect?.();
    expect(actions.onCall).toHaveBeenCalledWith('conv-dm-ana');
  });

  it('action items ("Ligar para…"/"Conversar com…") have no onSelect — they only navigate to the stage', () => {
    const items = build();
    const callAction = items.find((it) => it.id === 'action:call');
    const messageAction = items.find((it) => it.id === 'action:message');
    expect(callAction?.onSelect).toBeUndefined();
    expect(messageAction?.onSelect).toBeUndefined();
    expect(callAction?.stage).toBeTruthy();
    expect(messageAction?.stage).toBeTruthy();
  });

  describe('the "Amigos" stage', () => {
    it('lists the 5 destinations of the Amigos page', () => {
      const items = build();
      expect(friendsStage(items).map((it) => it.label)).toEqual([
        'Todos os amigos', 'Amigos online', 'Solicitações de amizade', 'Convites de grupo', 'Adicionar amigo',
      ]);
    });

    it('selecting a destination calls onNavigate with the right URL of the Amigos page', () => {
      const actions = { ...noopActions, onNavigate: vi.fn() };
      const items = build({ actions });
      friendsStage(items).find((it) => it.label === 'Amigos online')?.onSelect?.();
      expect(actions.onNavigate).toHaveBeenCalledWith(friendsView('online'));
    });

    it('shows a badge with the pending count, and sums friend requests+invitations on the root "Amigos" item', () => {
      const items = build({ friends: { pendingFriendRequestCount: 2, pendingInvitationCount: 3 } });
      expect(items.find((it) => it.id === 'action:friends')?.badge).toBeTruthy();
      expect(friendsStage(items).find((it) => it.label === 'Solicitações de amizade')?.badge).toBeTruthy();
      expect(friendsStage(items).find((it) => it.label === 'Convites de grupo')?.badge).toBeTruthy();
    });

    it('with nothing pending, no badge appears', () => {
      const items = build();
      expect(items.find((it) => it.id === 'action:friends')?.badge).toBeUndefined();
      expect(friendsStage(items).find((it) => it.label === 'Solicitações de amizade')?.badge).toBeUndefined();
    });
  });

  describe('the "Ajustes" stage', () => {
    it('lists the settings categories, without the admin one (regular account)', () => {
      const items = build({ isAdmin: false });
      const labels = settingsStage(items).map((it) => it.label);
      expect(labels).toContain('Perfil');
      expect(labels).toContain('Áudio e vídeo');
      expect(labels).not.toContain('Administração');
    });

    it('an admin account also sees the admin category', () => {
      const items = build({ isAdmin: true });
      expect(settingsStage(items).map((it) => it.label)).toContain('Administração');
    });

    it('selecting a category calls onNavigate with the right settings route', () => {
      const actions = { ...noopActions, onNavigate: vi.fn() };
      const items = build({ actions });
      settingsStage(items).find((it) => it.label === 'Perfil')?.onSelect?.();
      expect(actions.onNavigate).toHaveBeenCalledWith(ROUTES.settingsTab('profile'));
    });
  });

  it('"Meu perfil" calls onOpenProfile with my own id', () => {
    const actions = { ...noopActions, onOpenProfile: vi.fn() };
    const items = build({ actions });
    items.find((it) => it.id === 'action:profile')?.onSelect?.();
    expect(actions.onOpenProfile).toHaveBeenCalledWith(me);
  });

  it('"Área administrativa" only appears for an admin account, and navigates to /admin/users', () => {
    const actions = { ...noopActions, onNavigate: vi.fn() };
    expect(build({ isAdmin: false }).find((it) => it.id === 'action:admin')).toBeUndefined();
    const items = build({ isAdmin: true, actions });
    items.find((it) => it.id === 'action:admin')?.onSelect?.();
    expect(actions.onNavigate).toHaveBeenCalledWith(ROUTES.admin);
  });
});
