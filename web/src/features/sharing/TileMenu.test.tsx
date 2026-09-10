import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { initialRoomState } from '../../state/roomReducer';
import { renderWithRoom } from '../../test/roomContextFixture';
import { TileMenu } from './TileMenu';
import type { Participant } from '../../types/protocol';

function fakeParticipant(overrides: Partial<Participant> = {}): Participant {
  return {
    id: 'p-2', userId: 'u-2', name: 'Fulana', displayName: 'Fulana', avatar: '', avatarColor: 'green',
    banner: '', bio: '', profileLinks: [], role: 'user', deafened: false, callConversationId: 'conv-1',
    micActivated: true, micMuted: false, cameraOn: false, sharing: false, speaking: false,
    ...overrides,
  };
}

const menuTarget = { key: 'p-2:avatar', participantId: 'p-2', kind: 'avatar' as const, rect: { left: 0, top: 0, right: 0, bottom: 0 } };

describe('TileMenu — remover da chamada', () => {
  it('aparece para admin olhando o tile de outra pessoa', () => {
    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<TileMenu />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1', role: 'admin' }, participants },
      menuTarget,
    });
    expect(screen.getByText('Remover da chamada')).toBeInTheDocument();
  });

  it('nao aparece para quem nao e admin', () => {
    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<TileMenu />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1', role: 'user' }, participants },
      menuTarget,
    });
    expect(screen.queryByText('Remover da chamada')).not.toBeInTheDocument();
  });

  it('nao aparece no proprio tile, mesmo sendo admin', () => {
    const participants = new Map([['p-1', fakeParticipant({ id: 'p-1', userId: 'u-1' })]]);
    renderWithRoom(<TileMenu />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1', role: 'admin' }, participants },
      menuTarget: { ...menuTarget, participantId: 'p-1' },
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
    });
    fireEvent.click(screen.getByText('Remover da chamada'));
    expect(kickFromCall).toHaveBeenCalledWith('p-2');
    expect(closeTileMenu).toHaveBeenCalled();
  });
});
