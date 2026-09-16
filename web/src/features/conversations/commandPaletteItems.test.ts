import { describe, expect, it, vi } from 'vitest';
import { buildCommandItems } from './commandPaletteItems';
import type { Conversation, Participant, PublicUser } from '@/types/protocol';

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

describe('buildCommandItems', () => {
  it('lista uma entrada de "Conversas" por conversa existente', () => {
    const items = buildCommandItems(conversations, allUsers, me, new Map(), null, noopActions);
    const conversationItems = items.filter((it) => it.group === 'Conversas');
    expect(conversationItems.map((it) => it.label)).toEqual(['Ana', 'Squad']);
  });

  it('todo item leva o avatar do usuário/grupo correspondente, não um ícone genérico', () => {
    const items = buildCommandItems(conversations, allUsers, me, new Map(), null, noopActions);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.avatar).toBeTruthy();
      expect(item.icon).toBeUndefined();
    }
  });

  it('"Pessoas" só lista quem ainda não tem uma DM na lista (evita duplicar com "Conversas")', () => {
    const items = buildCommandItems(conversations, allUsers, me, new Map(), null, noopActions);
    const peopleItems = items.filter((it) => it.group === 'Pessoas');
    // Ana já tem DM (dmWithAna) — não aparece aqui. Bruno é só membro de
    // grupo, não tem DM — aparece. Carla não tem nenhuma conversa — aparece.
    expect(peopleItems.map((it) => it.label).sort()).toEqual(['Conversar com Bruno', 'Conversar com Carla']);
  });

  it('não lista eu mesmo em "Pessoas"', () => {
    const meAsUser = fakeUser(me, 'eu', 'Eu Mesmo');
    const withMe = new Map([...allUsers, [me, meAsUser]]);
    const items = buildCommandItems(conversations, withMe, me, new Map(), null, noopActions);
    expect(items.some((it) => it.label.includes('Eu Mesmo'))).toBe(false);
  });

  it('selecionar um item de conversa chama onOpenConversation com o id certo', () => {
    const actions = { onOpenConversation: vi.fn(), onMessageUser: vi.fn(), onCall: vi.fn() };
    const items = buildCommandItems(conversations, allUsers, me, new Map(), null, actions);
    items.find((it) => it.group === 'Conversas' && it.label === 'Squad')?.onSelect();
    expect(actions.onOpenConversation).toHaveBeenCalledWith('conv-group');
  });

  it('selecionar um item de pessoa chama onMessageUser com o id certo', () => {
    const actions = { onOpenConversation: vi.fn(), onMessageUser: vi.fn(), onCall: vi.fn() };
    const items = buildCommandItems(conversations, allUsers, me, new Map(), null, actions);
    items.find((it) => it.label === 'Conversar com Carla')?.onSelect();
    expect(actions.onMessageUser).toHaveBeenCalledWith(carla.id);
  });

  it('conversa com participante em chamada vira "Entrar na chamada", não "Iniciar chamada"', () => {
    const participants = new Map([
      ['p-bruno', fakeParticipant({ id: 'p-bruno', userId: bruno.id, callConversationId: 'conv-group' })],
    ]);
    const items = buildCommandItems(conversations, allUsers, me, participants, null, noopActions);

    const joinItems = items.filter((it) => it.group === 'Chamadas em andamento');
    const startItems = items.filter((it) => it.group === 'Iniciar chamada');
    expect(joinItems.map((it) => it.label)).toEqual(['Entrar na chamada em Squad']);
    // dmWithAna não tem ninguém em chamada — continua como "iniciar".
    expect(startItems.map((it) => it.label)).toEqual(['Iniciar chamada em Ana']);
  });

  it('a chamada em que eu já estou não aparece nem em "entrar" nem em "iniciar"', () => {
    const participants = new Map([
      ['p-bruno', fakeParticipant({ id: 'p-bruno', userId: bruno.id, callConversationId: 'conv-group' })],
    ]);
    const items = buildCommandItems(conversations, allUsers, me, participants, 'conv-group', noopActions);

    expect(items.some((it) => it.group === 'Chamadas em andamento')).toBe(false);
    expect(items.filter((it) => it.group === 'Iniciar chamada').map((it) => it.label)).toEqual(['Iniciar chamada em Ana']);
  });

  it('selecionar "entrar"/"iniciar chamada" chama onCall com o id da conversa', () => {
    const actions = { onOpenConversation: vi.fn(), onMessageUser: vi.fn(), onCall: vi.fn() };
    const items = buildCommandItems(conversations, allUsers, me, new Map(), null, actions);
    items.find((it) => it.label === 'Iniciar chamada em Ana')?.onSelect();
    expect(actions.onCall).toHaveBeenCalledWith('conv-dm-ana');
  });
});
