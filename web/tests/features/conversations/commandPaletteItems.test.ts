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
const carla = fakeUser('user-carla', 'carla', 'Carla');
const allUsers = new Map([[ana.id, ana], [bruno.id, bruno], [carla.id, carla]]);

const dmWithAna = fakeConversation({ id: 'conv-dm-ana', type: 'direct', memberIds: [me, ana.id] });
const group = fakeConversation({ id: 'conv-group', type: 'group', title: 'Squad', memberIds: [me, bruno.id] });
const conversations = [dmWithAna, group];

const noFriendsSummary = { pendingFriendRequestCount: 0, pendingInvitationCount: 0 };
const noopActions = { onOpenConversation: vi.fn(), onMessageUser: vi.fn(), onCall: vi.fn(), onNavigate: vi.fn(), onOpenProfile: vi.fn() };

function build(overrides: Partial<{
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
  it('lista uma entrada de "Conversas" por conversa existente', () => {
    const items = build();
    const conversationItems = items.filter((it) => it.group === 'Conversas');
    expect(conversationItems.map((it) => it.label)).toEqual(['Ana', 'Squad']);
  });

  it('a raiz só tem "Ações", "Chamadas em andamento" e "Conversas" — nada de pessoa solta', () => {
    const items = build();
    const groups = new Set(items.map((it) => it.group));
    expect(groups).toEqual(new Set(['Ações', 'Conversas']));
  });

  it('os itens de ação levam ícone (não avatar); os demais levam avatar (não ícone genérico)', () => {
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

  it('a etapa "Conversar com…" só lista quem ainda não tem uma DM (evita duplicar com "Conversas")', () => {
    const items = build();
    const peopleItems = messageStage(items);
    // Ana already has a DM (dmWithAna) — doesn't show up here. Bruno is only
    // a group member, no DM — shows up. Carla has no conversation at all — shows up.
    expect(peopleItems.map((it) => it.label).sort()).toEqual(['Bruno', 'Carla']);
  });

  it('não lista eu mesmo na etapa "Conversar com…"', () => {
    const meAsUser = fakeUser(me, 'eu', 'Eu Mesmo');
    const withMe = new Map([...allUsers, [me, meAsUser]]);
    const items = buildCommandItems(conversations, withMe, me, new Map(), null, noFriendsSummary, false, noopActions);
    expect(messageStage(items).some((it) => it.label.includes('Eu Mesmo'))).toBe(false);
  });

  it('selecionar um item de conversa chama onOpenConversation com o id certo', () => {
    const actions = { ...noopActions, onOpenConversation: vi.fn() };
    const items = build({ actions });
    items.find((it) => it.group === 'Conversas' && it.label === 'Squad')?.onSelect?.();
    expect(actions.onOpenConversation).toHaveBeenCalledWith('conv-group');
  });

  it('selecionar uma pessoa na etapa "Conversar com…" chama onMessageUser com o id certo', () => {
    const actions = { ...noopActions, onMessageUser: vi.fn() };
    const items = build({ actions });
    messageStage(items).find((it) => it.label === 'Carla')?.onSelect?.();
    expect(actions.onMessageUser).toHaveBeenCalledWith(carla.id);
  });

  it('conversa com participante em chamada vira "Entrar na chamada" na raiz, e some da etapa "Ligar para…"', () => {
    const participants = new Map([
      ['p-bruno', fakeParticipant({ id: 'p-bruno', userId: bruno.id, callConversationId: 'conv-group' })],
    ]);
    const items = build({ participants });

    const joinItems = items.filter((it) => it.group === 'Chamadas em andamento');
    expect(joinItems.map((it) => it.label)).toEqual(['Entrar na chamada em Squad']);
    // dmWithAna has no one on the call — stays in the "Ligar para…" stage.
    expect(callStage(items).map((it) => it.label)).toEqual(['Ana']);
  });

  it('a chamada em que eu já estou não aparece nem em "entrar" nem na etapa "Ligar para…"', () => {
    const participants = new Map([
      ['p-bruno', fakeParticipant({ id: 'p-bruno', userId: bruno.id, callConversationId: 'conv-group' })],
    ]);
    const items = build({ participants, activeCallConversationId: 'conv-group' });

    expect(items.some((it) => it.group === 'Chamadas em andamento')).toBe(false);
    expect(callStage(items).map((it) => it.label)).toEqual(['Ana']);
  });

  it('selecionar "entrar em chamada" (raiz) ou uma conversa na etapa "Ligar para…" chama onCall com o id certo', () => {
    const actions = { ...noopActions, onCall: vi.fn() };
    const items = build({ actions });
    callStage(items).find((it) => it.label === 'Ana')?.onSelect?.();
    expect(actions.onCall).toHaveBeenCalledWith('conv-dm-ana');
  });

  it('os itens de ação ("Ligar para…"/"Conversar com…") não têm onSelect — só navegam pra etapa', () => {
    const items = build();
    const callAction = items.find((it) => it.id === 'action:call');
    const messageAction = items.find((it) => it.id === 'action:message');
    expect(callAction?.onSelect).toBeUndefined();
    expect(messageAction?.onSelect).toBeUndefined();
    expect(callAction?.stage).toBeTruthy();
    expect(messageAction?.stage).toBeTruthy();
  });

  describe('etapa "Amigos"', () => {
    it('lista os 5 destinos da página de Amigos', () => {
      const items = build();
      expect(friendsStage(items).map((it) => it.label)).toEqual([
        'Todos os amigos', 'Amigos online', 'Solicitações de amizade', 'Convites de grupo', 'Adicionar amigo',
      ]);
    });

    it('selecionar um destino chama onNavigate com a URL certa da página de Amigos', () => {
      const actions = { ...noopActions, onNavigate: vi.fn() };
      const items = build({ actions });
      friendsStage(items).find((it) => it.label === 'Amigos online')?.onSelect?.();
      expect(actions.onNavigate).toHaveBeenCalledWith(friendsView('online'));
    });

    it('mostra badge com a contagem pendente, e soma amizade+convite no item raiz "Amigos"', () => {
      const items = build({ friends: { pendingFriendRequestCount: 2, pendingInvitationCount: 3 } });
      expect(items.find((it) => it.id === 'action:friends')?.badge).toBeTruthy();
      expect(friendsStage(items).find((it) => it.label === 'Solicitações de amizade')?.badge).toBeTruthy();
      expect(friendsStage(items).find((it) => it.label === 'Convites de grupo')?.badge).toBeTruthy();
    });

    it('sem nada pendente, nenhum badge aparece', () => {
      const items = build();
      expect(items.find((it) => it.id === 'action:friends')?.badge).toBeUndefined();
      expect(friendsStage(items).find((it) => it.label === 'Solicitações de amizade')?.badge).toBeUndefined();
    });
  });

  describe('etapa "Ajustes"', () => {
    it('lista as categorias de ajustes, sem a de administração (conta comum)', () => {
      const items = build({ isAdmin: false });
      const labels = settingsStage(items).map((it) => it.label);
      expect(labels).toContain('Perfil');
      expect(labels).toContain('Áudio e vídeo');
      expect(labels).not.toContain('Administração');
    });

    it('conta admin também vê a categoria de administração', () => {
      const items = build({ isAdmin: true });
      expect(settingsStage(items).map((it) => it.label)).toContain('Administração');
    });

    it('selecionar uma categoria chama onNavigate com a rota de ajustes certa', () => {
      const actions = { ...noopActions, onNavigate: vi.fn() };
      const items = build({ actions });
      settingsStage(items).find((it) => it.label === 'Perfil')?.onSelect?.();
      expect(actions.onNavigate).toHaveBeenCalledWith(ROUTES.settingsTab('profile'));
    });
  });

  it('"Meu perfil" chama onOpenProfile com o meu próprio id', () => {
    const actions = { ...noopActions, onOpenProfile: vi.fn() };
    const items = build({ actions });
    items.find((it) => it.id === 'action:profile')?.onSelect?.();
    expect(actions.onOpenProfile).toHaveBeenCalledWith(me);
  });

  it('"Área administrativa" só aparece pra conta admin, e navega pra /admin/users', () => {
    const actions = { ...noopActions, onNavigate: vi.fn() };
    expect(build({ isAdmin: false }).find((it) => it.id === 'action:admin')).toBeUndefined();
    const items = build({ isAdmin: true, actions });
    items.find((it) => it.id === 'action:admin')?.onSelect?.();
    expect(actions.onNavigate).toHaveBeenCalledWith(ROUTES.admin);
  });
});
