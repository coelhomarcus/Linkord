import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { Tile } from '@/features/calls/Tile';
import type { Participant } from '@/shared/types/protocol';

function fakeParticipant(overrides: Partial<Participant> = {}): Participant {
  return {
    id: 'p-2', userId: 'u-2', name: 'Fulana', displayName: 'Fulana', avatar: '', avatarPoster: '', avatarColor: 'green',
    banner: '', bannerPoster: '', bio: '', profileLinks: [], role: 'user', deafened: false, callConversationId: 'conv-1',
    micActivated: true, micMuted: false, cameraOn: false, sharing: false, speaking: false,
    ...overrides,
  };
}

describe('Tile — indicador de mutado (para mim)', () => {
  it('mostra botao "Reativar audio" quando o audio do participante esta mutado para mim, e desmuta ao clicar', () => {
    const audio = new Audio();
    audio.volume = 0;
    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants },
      audioRegistry: { current: new Map([['p-2', { element: audio }]]) },
    });

    const button = screen.getByLabelText('Reativar áudio');
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    expect(audio.volume).toBeCloseTo(0.4);
    expect(screen.queryByLabelText('Reativar áudio')).not.toBeInTheDocument();
  });

  it('nao mostra o botao quando o audio nao esta mutado', () => {
    const audio = new Audio();
    audio.volume = 1;
    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants },
      audioRegistry: { current: new Map([['p-2', { element: audio }]]) },
    });

    expect(screen.queryByLabelText('Reativar áudio')).not.toBeInTheDocument();
  });

  it('nao mostra o botao no proprio tile', () => {
    const audio = new Audio();
    audio.volume = 0;
    renderWithRoom(<Tile participantId="p-1" kind="avatar" isMine />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' } },
      audioRegistry: { current: new Map([['p-1', { element: audio }]]) },
    });

    expect(screen.queryByLabelText('Reativar áudio')).not.toBeInTheDocument();
  });
});

describe('Tile — carregando (publicacao sem track ainda)', () => {
  it('mostra um indicador de carregamento sobre o avatar, nao so um avatar comum', () => {
    const { container } = renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} loading />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]) },
    });
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('sem loading, o avatar aparece normal e sem spinner', () => {
    const { container } = renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]) },
    });
    expect(container.querySelector('.animate-spin')).not.toBeInTheDocument();
  });
});

describe('Tile — espelhamento da propria camera', () => {
  it('minha camera com a preferencia ligada aparece espelhada', () => {
    const { container } = renderWithRoom(<Tile participantId="p-1" kind="camera" isMine />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' } },
      mirrorCameraPreview: true,
    });
    expect(container.querySelector('video')).toHaveStyle({ transform: 'scaleX(-1)' });
  });

  it('com a preferencia desligada, nao espelha', () => {
    const { container } = renderWithRoom(<Tile participantId="p-1" kind="camera" isMine />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' } },
      mirrorCameraPreview: false,
    });
    expect(container.querySelector('video')).not.toHaveStyle({ transform: 'scaleX(-1)' });
  });

  it('a camera de outro participante nunca espelha, mesmo com a preferencia ligada', () => {
    const { container } = renderWithRoom(<Tile participantId="p-2" kind="camera" isMine={false} />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]) },
      mirrorCameraPreview: true,
    });
    expect(container.querySelector('video')).not.toHaveStyle({ transform: 'scaleX(-1)' });
  });

  it('compartilhamento de tela nunca espelha, mesmo sendo meu', () => {
    const { container } = renderWithRoom(<Tile participantId="p-1" kind="screen" isMine />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' } },
      mirrorCameraPreview: true,
    });
    expect(container.querySelector('video')).not.toHaveStyle({ transform: 'scaleX(-1)' });
  });
});
