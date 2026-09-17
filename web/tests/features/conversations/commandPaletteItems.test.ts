import { describe, expect, it, vi } from 'vitest';
import { buildCommandItems } from '@/features/conversations/commandPaletteItems';
import type { Conversation, Participant, PublicUser } from '@/shared/types/protocol';

function fakeUser(id: string, username: string, displayName: string): PublicUser {
  return { id, username, displayName, avatar: '', avatarColor: 'blurple', banner: '', bio: '', profileLinks: [], role: 'user' };
}

function fakeConversation(overrides: Partial<Conversation> & { id: string }): Conversation {
  return {
    type: 'direct', title: '', avatar: '', createdBy: null, memberIds: [],
    lastMessageAt: null, createdAt: 1, updatedAt: 1, pinnedAt: null,
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

const noopActions = { onOpenConversation: vi.fn(), onMessageUser: vi.fn(), onCall: vi.fn() };

function callStage(items: ReturnType<typeof buildCommandItems>) {
  return items.find((it) => it.id === 'action:call')?.stage?.items ?? [];
}

function messageStage(items: ReturnType<typeof buildCommandItems>) {
  return items.find((it) => it.id === 'action:message')?.stage?.items ?? [];
}

describe('buildCommandItems', () => {
  it('lista uma entrada de "Conversas" por conversa existente', () => {
    const items = buildCommandItems(conversations, allUsers, me, new Map(), null, noopActions);
    const conversationItems = items.filter((it) => it.group === 'Conversas');
    expect(conversationItems.map((it) => it.label)).toEqual(['Ana', 'Squad']);
  });

  it('a raiz só tem "Ações", "Chamadas em andamento" e "Conversas" — nada de pessoa solta', () => {
    const items = buildCommandItems(conversations, allUsers, me, new Map(), null, noopActions);
    const groups = new Set(items.map((it) => it.group));
    expect(groups).toEqual(new Set(['Ações', 'Conversas']));
  });

  it('os itens de ação levam ícone (não avatar); os demais levam avatar (não ícone genérico)', () => {
    const items = buildCommandItems(conversations, allUsers, me, new Map(), null, noopActions);
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
    const items = buildCommandItems(conversations, allUsers, me, new Map(), null, noopActions);
    const peopleItems = messageStage(items);
    // Ana already has a DM (dmWithAna) — doesn't show up here. Bruno is only
    // a group member, no DM — shows up. Carla has no conversation at all — shows up.
    expect(peopleItems.map((it) => it.label).sort()).toEqual(['Bruno', 'Carla']);
  });

  it('não lista eu mesmo na etapa "Conversar com…"', () => {
    const meAsUser = fakeUser(me, 'eu', 'Eu Mesmo');
    const withMe = new Map([...allUsers, [me, meAsUser]]);
    const items = buildCommandItems(conversations, withMe, me, new Map(), null, noopActions);
    expect(messageStage(items).some((it) => it.label.includes('Eu Mesmo'))).toBe(false);
  });

  it('selecionar um item de conversa chama onOpenConversation com o id certo', () => {
    const actions = { onOpenConversation: vi.fn(), onMessageUser: vi.fn(), onCall: vi.fn() };
    const items = buildCommandItems(conversations, allUsers, me, new Map(), null, actions);
    items.find((it) => it.group === 'Conversas' && it.label === 'Squad')?.onSelect?.();
    expect(actions.onOpenConversation).toHaveBeenCalledWith('conv-group');
  });

  it('selecionar uma pessoa na etapa "Conversar com…" chama onMessageUser com o id certo', () => {
    const actions = { onOpenConversation: vi.fn(), onMessageUser: vi.fn(), onCall: vi.fn() };
    const items = buildCommandItems(conversations, allUsers, me, new Map(), null, actions);
    messageStage(items).find((it) => it.label === 'Carla')?.onSelect?.();
    expect(actions.onMessageUser).toHaveBeenCalledWith(carla.id);
  });

  it('conversa com participante em chamada vira "Entrar na chamada" na raiz, e some da etapa "Ligar para…"', () => {
    const participants = new Map([
      ['p-bruno', fakeParticipant({ id: 'p-bruno', userId: bruno.id, callConversationId: 'conv-group' })],
    ]);
    const items = buildCommandItems(conversations, allUsers, me, participants, null, noopActions);

    const joinItems = items.filter((it) => it.group === 'Chamadas em andamento');
    expect(joinItems.map((it) => it.label)).toEqual(['Entrar na chamada em Squad']);
    // dmWithAna has no one on the call — stays in the "Ligar para…" stage.
    expect(callStage(items).map((it) => it.label)).toEqual(['Ana']);
  });

  it('a chamada em que eu já estou não aparece nem em "entrar" nem na etapa "Ligar para…"', () => {
    const participants = new Map([
      ['p-bruno', fakeParticipant({ id: 'p-bruno', userId: bruno.id, callConversationId: 'conv-group' })],
    ]);
    const items = buildCommandItems(conversations, allUsers, me, participants, 'conv-group', noopActions);

    expect(items.some((it) => it.group === 'Chamadas em andamento')).toBe(false);
    expect(callStage(items).map((it) => it.label)).toEqual(['Ana']);
  });

  it('selecionar "entrar em chamada" (raiz) ou uma conversa na etapa "Ligar para…" chama onCall com o id certo', () => {
    const actions = { onOpenConversation: vi.fn(), onMessageUser: vi.fn(), onCall: vi.fn() };
    const items = buildCommandItems(conversations, allUsers, me, new Map(), null, actions);
    callStage(items).find((it) => it.label === 'Ana')?.onSelect?.();
    expect(actions.onCall).toHaveBeenCalledWith('conv-dm-ana');
  });

  it('os itens de ação ("Ligar para…"/"Conversar com…") não têm onSelect — só navegam pra etapa', () => {
    const items = buildCommandItems(conversations, allUsers, me, new Map(), null, noopActions);
    const callAction = items.find((it) => it.id === 'action:call');
    const messageAction = items.find((it) => it.id === 'action:message');
    expect(callAction?.onSelect).toBeUndefined();
    expect(messageAction?.onSelect).toBeUndefined();
    expect(callAction?.stage).toBeTruthy();
    expect(messageAction?.stage).toBeTruthy();
  });
});
