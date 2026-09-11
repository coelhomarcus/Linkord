import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { initialRoomState } from '../../state/roomReducer';
import { renderWithRoom } from '../../test/roomContextFixture';
import { TileMenu } from './TileMenu';
import type { Conversation, Participant } from '../../types/protocol';

function fakeParticipant(overrides: Partial<Participant> = {}): Participant {
  return {
    id: 'p-2', userId: 'u-2', name: 'Fulana', displayName: 'Fulana', avatar: '', avatarColor: 'green',
    banner: '', bio: '', profileLinks: [], role: 'user', deafened: false, callConversationId: 'conv-1',
    micActivated: true, micMuted: false, cameraOn: false, sharing: false, speaking: false,
    ...overrides,
  };
}

function fakeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1', type: 'group', title: 'Grupo', avatar: '', createdBy: 'u-1', memberIds: ['u-1', 'u-2'],
    lastMessageAt: null, createdAt: Date.now(), updatedAt: Date.now(), pinnedAt: null,
    ...overrides,
  };
}

const menuTarget = { key: 'p-2:avatar', participantId: 'p-2', kind: 'avatar' as const, rect: { left: 0, top: 0, right: 0, bottom: 0 } };
// "remover da chamada" only exists for GROUP calls (mirrors the server-side
// restriction in modules/moderation.ts#handleCallKick) — every test that
// expects it to be reachable needs the active call to resolve to a group.
const groupCallContext = { activeCallConversationId: 'conv-1', conversations: [fakeConversation()] };

describe('TileMenu — remover da chamada', () => {
  it('aparece para admin olhando o tile de outra pessoa em chamada de grupo', () => {
    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<TileMenu />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1', role: 'admin' }, participants },
      menuTarget,
      ...groupCallContext,
    });
    expect(screen.getByText('Remover da chamada')).toBeInTheDocument();
  });

  it('nao aparece para quem nao e admin', () => {
    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<TileMenu />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1', role: 'user' }, participants },
      menuTarget,
      ...groupCallContext,
    });
    expect(screen.queryByText('Remover da chamada')).not.toBeInTheDocument();
  });

  it('nao aparece no proprio tile, mesmo sendo admin', () => {
    const participants = new Map([['p-1', fakeParticipant({ id: 'p-1', userId: 'u-1' })]]);
    renderWithRoom(<TileMenu />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1', role: 'admin' }, participants },
      menuTarget: { ...menuTarget, participantId: 'p-1' },
      ...groupCallContext,
    });
    expect(screen.queryByText('Remover da chamada')).not.toBeInTheDocument();
  });

  it('nao aparece em chamada 1:1 (direta), mesmo sendo admin', () => {
    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<TileMenu />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1', role: 'admin' }, participants },
      menuTarget,
      activeCallConversationId: 'conv-1',
      conversations: [fakeConversation({ type: 'direct', title: '' })],
    });
    expect(screen.queryByText('Remover da chamada')).not.toBeInTheDocument();
  });

  it('chama kickFromCall com o participantId do alvo e fecha o menu', () => {
    const kickFromCall = vi.fn();
    const closeTileMenu = vi.fn(() => true);
    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<TileMenu />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1', role: 'admin' }, participants },
      menuTarget,
      kickFromCall,
      closeTileMenu,
      ...groupCallContext,
    });
    fireEvent.click(screen.getByText('Remover da chamada'));
    expect(kickFromCall).toHaveBeenCalledWith('p-2');
    expect(closeTileMenu).toHaveBeenCalled();
  });
});

describe('TileMenu — botao de mutar transmissao', () => {
  it('muta (volume -> 0) e o clique seguinte restaura o volume anterior', () => {
    const audio = new Audio();
    audio.volume = 0.8;
    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<TileMenu />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants },
      menuTarget,
      audioRegistry: { current: new Map([['p-2', { element: audio }]]) },
    });

    const button = screen.getByLabelText('Silenciar áudio');
    fireEvent.click(button);
    expect(audio.volume).toBe(0);
    expect(screen.getByLabelText('Reativar áudio')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Reativar áudio'));
    expect(audio.volume).toBeCloseTo(0.8);
    expect(screen.getByLabelText('Silenciar áudio')).toBeInTheDocument();
  });

  it('quando ja esta em 0%, o clique de reativar deixa em 40%', () => {
    const audio = new Audio();
    audio.volume = 0;
    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<TileMenu />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants },
      menuTarget,
      audioRegistry: { current: new Map([['p-2', { element: audio }]]) },
    });

    fireEvent.click(screen.getByLabelText('Reativar áudio'));
    expect(audio.volume).toBeCloseTo(0.4);
  });
});
