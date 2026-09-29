import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

describe('Tile — muted indicator (for me)', () => {
  it('shows the "Reativar áudio" button when the participant\'s audio is muted for me, and unmutes on click', () => {
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

  it('does not show the button when the audio is not muted', () => {
    const audio = new Audio();
    audio.volume = 1;
    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants },
      audioRegistry: { current: new Map([['p-2', { element: audio }]]) },
    });

    expect(screen.queryByLabelText('Reativar áudio')).not.toBeInTheDocument();
  });

  it('does not show the button on your own tile', () => {
    const audio = new Audio();
    audio.volume = 0;
    renderWithRoom(<Tile participantId="p-1" kind="avatar" isMine />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' } },
      audioRegistry: { current: new Map([['p-1', { element: audio }]]) },
    });

    expect(screen.queryByLabelText('Reativar áudio')).not.toBeInTheDocument();
  });
});

describe('Tile — loading (publication with no track yet)', () => {
  it('shows a loading indicator over the avatar, not just a plain avatar', () => {
    const { container } = renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} loading />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]) },
    });
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('without loading, the avatar appears normal and without a spinner', () => {
    const { container } = renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]) },
    });
    expect(container.querySelector('.animate-spin')).not.toBeInTheDocument();
  });
});

describe('Tile — mirroring your own camera', () => {
  it('my camera with the preference on appears mirrored', () => {
    const { container } = renderWithRoom(<Tile participantId="p-1" kind="camera" isMine />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' } },
      mirrorCameraPreview: true,
    });
    expect(container.querySelector('video')).toHaveStyle({ transform: 'scaleX(-1)' });
  });

  it('with the preference off, does not mirror', () => {
    const { container } = renderWithRoom(<Tile participantId="p-1" kind="camera" isMine />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' } },
      mirrorCameraPreview: false,
    });
    expect(container.querySelector('video')).not.toHaveStyle({ transform: 'scaleX(-1)' });
  });

  it('another participant\'s camera never mirrors, even with the preference on', () => {
    const { container } = renderWithRoom(<Tile participantId="p-2" kind="camera" isMine={false} />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]) },
      mirrorCameraPreview: true,
    });
    expect(container.querySelector('video')).not.toHaveStyle({ transform: 'scaleX(-1)' });
  });

  it('screen share never mirrors, even when it is mine', () => {
    const { container } = renderWithRoom(<Tile participantId="p-1" kind="screen" isMine />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' } },
      mirrorCameraPreview: true,
    });
    expect(container.querySelector('video')).not.toHaveStyle({ transform: 'scaleX(-1)' });
  });
});

describe('Tile — grouped action pill', () => {
  it('with only "Configurações da transmissão": no divider, and the unmute button does not appear', () => {
    renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]) },
    });
    expect(screen.getByLabelText('Configurações da transmissão')).toBeInTheDocument();
    expect(screen.queryByLabelText('Reativar áudio')).not.toBeInTheDocument();
  });

  it('with audio muted for me, both buttons stay in the same pill (same parent)', () => {
    const audio = new Audio();
    audio.volume = 0;
    renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants: new Map([['p-2', fakeParticipant()]]) },
      audioRegistry: { current: new Map([['p-2', { element: audio }]]) },
    });
    const unmute = screen.getByLabelText('Reativar áudio');
    const gear = screen.getByLabelText('Configurações da transmissão');
    expect(unmute.parentElement).toBe(gear.parentElement);
  });

  it('the action pill stays in the top-left corner, no longer on the right', () => {
    renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]) },
    });
    const pill = screen.getByLabelText('Configurações da transmissão').parentElement;
    expect(pill).toHaveClass('left-1.5');
    expect(pill?.className).not.toMatch(/\bright-/);
  });
});

describe('Tile — stable frame while speaking', () => {
  it('the border width does not change between speaking and not speaking (no layout jump)', () => {
    const { container: notSpeaking } = renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant({ speaking: false })]]) },
    });
    const root = notSpeaking.querySelector('.tile-fullscreen-target');
    expect(root).toHaveClass('border-[3.5px]');
  });
});

describe('Tile — name in grid layout', () => {
  it('default density (grid) uses the small 12px text', () => {
    renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]) },
    });
    expect(screen.getByText('Fulana')).toHaveClass('text-caption');
  });

  it('"label" density (focused tile) uses slightly larger text', () => {
    renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} nameSize="label" />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]) },
    });
    expect(screen.getByText('Fulana')).toHaveClass('text-label');
  });
});

describe('Tile — video hidden for me', () => {
  it('another person\'s camera with the key in hiddenVideoKeys: does not render <video>, shows the "Vídeo oculto" badge', () => {
    const { container } = renderWithRoom(<Tile participantId="p-2" kind="camera" isMine={false} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants: new Map([['p-2', fakeParticipant()]]), hiddenVideoKeys: new Set(['p-2:participant']) },
    });
    expect(container.querySelector('video')).not.toBeInTheDocument();
    expect(screen.getByText('Vídeo oculto')).toBeInTheDocument();
  });

  it('another person\'s camera without the hidden key: renders <video> normally, without the badge', () => {
    const { container } = renderWithRoom(<Tile participantId="p-2" kind="camera" isMine={false} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants: new Map([['p-2', fakeParticipant()]]), hiddenVideoKeys: new Set<string>() },
    });
    expect(container.querySelector('video')).toBeInTheDocument();
    expect(screen.queryByText('Vídeo oculto')).not.toBeInTheDocument();
  });

  it('my own camera is never hidden, even if the key is in hiddenVideoKeys', () => {
    const { container } = renderWithRoom(<Tile participantId="p-1" kind="camera" isMine />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, hiddenVideoKeys: new Set(['p-1:participant']) },
    });
    expect(container.querySelector('video')).toBeInTheDocument();
    expect(screen.queryByText('Vídeo oculto')).not.toBeInTheDocument();
  });

  it('shared screen is never hidden, even if the key is in hiddenVideoKeys', () => {
    const { container } = renderWithRoom(<Tile participantId="p-2" kind="screen" isMine={false} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants: new Map([['p-2', fakeParticipant()]]), hiddenVideoKeys: new Set(['p-2:screen']) },
    });
    expect(container.querySelector('video')).toBeInTheDocument();
    expect(screen.queryByText('Vídeo oculto')).not.toBeInTheDocument();
  });
});

describe('Tile — shared screen: paused or "stopped watching"', () => {
  it('normal screen (not paused, being watched): shows <video>, with no badge', () => {
    const { container } = renderWithRoom(<Tile participantId="p-2" kind="screen" isMine={false} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants: new Map([['p-2', fakeParticipant()]]) },
    });
    expect(container.querySelector('video')).toBeInTheDocument();
    expect(screen.queryByText('Prévia pausada')).not.toBeInTheDocument();
    expect(screen.queryByText('Você parou de assistir')).not.toBeInTheDocument();
  });

  it('screen paused by the presenter: does not render <video>, shows "Prévia pausada"', () => {
    const { container } = renderWithRoom(<Tile participantId="p-2" kind="screen" isMine={false} paused />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants: new Map([['p-2', fakeParticipant()]]) },
    });
    expect(container.querySelector('video')).not.toBeInTheDocument();
    expect(screen.getByText('Prévia pausada')).toBeInTheDocument();
  });

  it('your own screen also shows "Prévia pausada" when paused (not only for the viewer)', () => {
    const { container } = renderWithRoom(<Tile participantId="p-1" kind="screen" isMine paused />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' } },
    });
    expect(container.querySelector('video')).not.toBeInTheDocument();
    expect(screen.getByText('Prévia pausada')).toBeInTheDocument();
  });

  it('"stopped watching" (key in unwatchedScreenKeys): does not render <video>, shows the notice — takes priority over "paused"', () => {
    const { container } = renderWithRoom(<Tile participantId="p-2" kind="screen" isMine={false} paused />, {
      state: {
        ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants: new Map([['p-2', fakeParticipant()]]),
        unwatchedScreenKeys: new Set(['p-2:screen']),
      },
    });
    expect(container.querySelector('video')).not.toBeInTheDocument();
    expect(screen.getByText('Você parou de assistir')).toBeInTheDocument();
    expect(screen.queryByText('Prévia pausada')).not.toBeInTheDocument();
  });

  it('"stopped watching" never applies to your own screen, even if the key is present', () => {
    const { container } = renderWithRoom(<Tile participantId="p-1" kind="screen" isMine />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, unwatchedScreenKeys: new Set(['p-1:screen']) },
    });
    expect(container.querySelector('video')).toBeInTheDocument();
    expect(screen.queryByText('Você parou de assistir')).not.toBeInTheDocument();
  });
});

describe('Tile — keyboard accessibility', () => {
  it('is focusable and has button role, with aria-pressed reflecting the current focus', () => {
    renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]), focusedId: null },
    });
    const tile = screen.getByRole('button', { name: /Destacar Fulana/ });
    expect(tile).toHaveAttribute('tabindex', '0');
    expect(tile).toHaveAttribute('aria-pressed', 'false');
  });

  it('when it is already the focused tile, the label and action offer to undo it', () => {
    renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]), focusedId: 'p-2:participant' },
    });
    const tile = screen.getByRole('button', { name: /Desfazer destaque de Fulana/ });
    expect(tile).toHaveAttribute('aria-pressed', 'true');
  });

  it('Enter on the tile toggles focus, just like a click — with origin "manual"', () => {
    const dispatch = vi.fn();
    renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]), focusedId: null },
      dispatch,
    });
    const tile = screen.getByRole('button', { name: /Destacar Fulana/ });
    fireEvent.keyDown(tile, { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_FOCUSED', id: 'p-2:participant', origin: 'manual' });
  });

  it('Space on the tile also toggles focus', () => {
    const dispatch = vi.fn();
    renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]), focusedId: null },
      dispatch,
    });
    fireEvent.keyDown(screen.getByRole('button', { name: /Destacar Fulana/ }), { key: ' ' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_FOCUSED', id: 'p-2:participant', origin: 'manual' });
  });

  it('other keys do not trigger anything', () => {
    const dispatch = vi.fn();
    renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]) },
      dispatch,
    });
    fireEvent.keyDown(screen.getByRole('button', { name: /Destacar Fulana/ }), { key: 'a' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('Enter on a nested button (gear icon) does NOT also trigger the tile focus', () => {
    const dispatch = vi.fn();
    renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]) },
      dispatch,
      openTileMenu: vi.fn(),
    });
    const gear = screen.getByLabelText('Configurações da transmissão');
    fireEvent.keyDown(gear, { key: 'Enter' });
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_FOCUSED' }));
  });
});
