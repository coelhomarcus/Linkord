import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RoomEvent, Track } from 'livekit-client';
import type { Room as LKRoom } from 'livekit-client';
import { initialRoomState } from '@/state/roomReducer';
import { RoomContext } from '@/state/RoomContext';
import { createFakeRoomContextValue, renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { TileMenu } from '@/features/calls/TileMenu';
import type { Conversation, Participant } from '@/shared/types/protocol';

interface FakePublication {
  isMuted: boolean;
  track: { mediaStreamTrack?: { getSettings: () => { width?: number; height?: number } }; getRTCStatsReport?: () => Promise<Map<string, unknown>> } | null;
}

/** A minimal LiveKit room fake for a single remote participant ('p-2'),
 * controllable enough to simulate a track appearing/disappearing and
 * re-derive useParticipantMedia via the same room events it listens to. */
function fakeLivekitRoomWithRemote() {
  const listeners = new Map<string, Set<() => void>>();
  const publications = new Map<Track.Source, FakePublication>();
  const localPublications = new Map<Track.Source, FakePublication>();
  const room = {
    on: vi.fn((event: string, fn: () => void) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(fn); }),
    off: vi.fn((event: string, fn: () => void) => { listeners.get(event)?.delete(fn); }),
    localParticipant: { identity: 'p-1', getTrackPublication: (source: Track.Source) => localPublications.get(source) },
    getParticipantByIdentity: vi.fn(() => ({ getTrackPublication: (source: Track.Source) => publications.get(source) })),
    emit(event: string) { for (const fn of listeners.get(event) ?? []) fn(); },
    setPublication(source: Track.Source, pub: FakePublication | undefined) {
      if (pub) publications.set(source, pub); else publications.delete(source);
      this.emit(RoomEvent.TrackPublished);
    },
    setLocalPublication(source: Track.Source, pub: FakePublication | undefined) {
      if (pub) localPublications.set(source, pub); else localPublications.delete(source);
      this.emit(RoomEvent.TrackPublished);
    },
  };
  return room as unknown as LKRoom & {
    emit: (event: string) => void;
    setPublication: (source: Track.Source, pub: FakePublication | undefined) => void;
    setLocalPublication: (source: Track.Source, pub: FakePublication | undefined) => void;
  };
}

const fakeTrack = (width = 1280, height = 720) => ({
  mediaStreamTrack: { getSettings: () => ({ width, height }) },
  getRTCStatsReport: async () => new Map(),
});

function fakeParticipant(overrides: Partial<Participant> = {}): Participant {
  return {
    id: 'p-2', userId: 'u-2', name: 'Fulana', displayName: 'Fulana', avatar: '', avatarPoster: '', avatarColor: 'green',
    banner: '', bannerPoster: '', bio: '', profileLinks: [], role: 'user', deafened: false, callConversationId: 'conv-1',
    micActivated: true, micMuted: false, cameraOn: false, sharing: false, speaking: false,
    ...overrides,
  };
}

function fakeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1', type: 'group', title: 'Group', avatar: '', createdBy: 'u-1', memberIds: ['u-1', 'u-2'],
    lastMessageAt: null, createdAt: Date.now(), updatedAt: Date.now(), pinnedAt: null, myRole: 'member', ownerId: null, memberCount: 0,
    ...overrides,
  };
}

const menuTarget = { key: 'p-2:avatar', participantId: 'p-2', kind: 'avatar' as const, rect: { left: 0, top: 0, right: 0, bottom: 0 } };
// "Remover da chamada" only exists for GROUP calls (mirrors the server-side
// restriction in modules/moderation.ts#handleCallKick) — every test that
// expects it to be reachable needs the active call to resolve to a group.
const groupCallContext = { activeCallConversationId: 'conv-1', conversations: [fakeConversation()] };

describe('TileMenu — remove from call', () => {
  it('appears for an admin looking at another person\'s tile in a group call', () => {
    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<TileMenu onOpenProfile={vi.fn()} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1', role: 'admin' }, participants },
      menuTarget,
      ...groupCallContext,
    });
    expect(screen.getByText('Remover da chamada')).toBeInTheDocument();
  });

  it('appears for the group OWNER (non-admin) looking at a member of that group', () => {
    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<TileMenu onOpenProfile={vi.fn()} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1', role: 'user' }, participants },
      menuTarget,
      activeCallConversationId: 'conv-1',
      conversations: [fakeConversation({ myRole: 'owner', ownerId: 'u-1' })],
    });
    expect(screen.getByText('Remover da chamada')).toBeInTheDocument();
  });

  it('owner cannot remove someone who is not a group member', () => {
    const participants = new Map([['p-2', fakeParticipant({ userId: 'u-9' })]]);
    renderWithRoom(<TileMenu onOpenProfile={vi.fn()} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1', role: 'user' }, participants },
      menuTarget,
      activeCallConversationId: 'conv-1',
      conversations: [fakeConversation({ myRole: 'owner', ownerId: 'u-1' })],
    });
    expect(screen.queryByText('Remover da chamada')).not.toBeInTheDocument();
  });

  it('does not appear for someone who is not an admin', () => {
    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<TileMenu onOpenProfile={vi.fn()} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1', role: 'user' }, participants },
      menuTarget,
      ...groupCallContext,
    });
    expect(screen.queryByText('Remover da chamada')).not.toBeInTheDocument();
  });

  it('does not appear on your own tile, even as admin', () => {
    const participants = new Map([['p-1', fakeParticipant({ id: 'p-1', userId: 'u-1' })]]);
    renderWithRoom(<TileMenu onOpenProfile={vi.fn()} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1', role: 'admin' }, participants },
      menuTarget: { ...menuTarget, participantId: 'p-1' },
      ...groupCallContext,
    });
    expect(screen.queryByText('Remover da chamada')).not.toBeInTheDocument();
  });

  it('does not appear in a 1:1 (direct) call, even as admin', () => {
    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<TileMenu onOpenProfile={vi.fn()} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1', role: 'admin' }, participants },
      menuTarget,
      activeCallConversationId: 'conv-1',
      conversations: [fakeConversation({ type: 'direct', title: '' })],
    });
    expect(screen.queryByText('Remover da chamada')).not.toBeInTheDocument();
  });

  it('calls kickFromCall with the target\'s participantId and closes the menu', () => {
    const kickFromCall = vi.fn();
    const closeTileMenu = vi.fn(() => true);
    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<TileMenu onOpenProfile={vi.fn()} />, {
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

describe('TileMenu — mute stream button', () => {
  it('mutes (volume -> 0) and the next click restores the previous volume', () => {
    const audio = new Audio();
    audio.volume = 0.8;
    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<TileMenu onOpenProfile={vi.fn()} />, {
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

  it('when already at 0%, the unmute click leaves it at 40%', () => {
    const audio = new Audio();
    audio.volume = 0;
    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<TileMenu onOpenProfile={vi.fn()} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants },
      menuTarget,
      audioRegistry: { current: new Map([['p-2', { element: audio }]]) },
    });

    fireEvent.click(screen.getByLabelText('Reativar áudio'));
    expect(audio.volume).toBeCloseTo(0.4);
  });
});

describe('TileMenu — view profile', () => {
  it('opens the TARGET\'s profile (not mine) and closes the menu', () => {
    const onOpenProfile = vi.fn();
    const closeTileMenu = vi.fn();
    const participants = new Map([['p-2', fakeParticipant({ userId: 'u-2' })]]);
    renderWithRoom(<TileMenu onOpenProfile={onOpenProfile} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1', userId: 'u-1' }, participants },
      menuTarget,
      closeTileMenu,
    });
    fireEvent.click(screen.getByText('Ver perfil'));
    expect(onOpenProfile).toHaveBeenCalledWith('u-2');
    expect(closeTileMenu).toHaveBeenCalled();
  });

  it('on your own tile, opens MY profile', () => {
    const onOpenProfile = vi.fn();
    renderWithRoom(<TileMenu onOpenProfile={onOpenProfile} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1', userId: 'u-1' } },
      menuTarget: { ...menuTarget, participantId: 'p-1' },
    });
    fireEvent.click(screen.getByText('Ver perfil'));
    expect(onOpenProfile).toHaveBeenCalledWith('u-1');
  });
});

describe('TileMenu — camera actions', () => {
  it('on my own camera, offers mirror and turn off — never "hide video for me"', () => {
    const setMirrorCameraPreview = vi.fn();
    const stopCamera = vi.fn();
    renderWithRoom(<TileMenu onOpenProfile={vi.fn()} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' } },
      menuTarget: { ...menuTarget, key: 'p-1:participant', participantId: 'p-1', kind: 'camera' },
      mirrorCameraPreview: true,
      setMirrorCameraPreview,
      stopCamera,
    });
    expect(screen.queryByText('Ocultar vídeo para mim')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Parar de espelhar minha prévia'));
    expect(setMirrorCameraPreview).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByText('Desligar câmera'));
    expect(stopCamera).toHaveBeenCalled();
  });

  it('on another person\'s camera, offers hide/restore video — never mirror/turn off', () => {
    const dispatch = vi.fn();
    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<TileMenu onOpenProfile={vi.fn()} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants, hiddenVideoKeys: new Set<string>() },
      menuTarget: { ...menuTarget, key: 'p-2:participant', kind: 'camera' },
      dispatch,
    });
    expect(screen.queryByText('Espelhar minha prévia')).not.toBeInTheDocument();
    expect(screen.queryByText('Desligar câmera')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Ocultar vídeo para mim'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'TOGGLE_HIDDEN_VIDEO', key: 'p-2:participant' });
  });

  it('when already hidden, offers "Restaurar vídeo"', () => {
    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<TileMenu onOpenProfile={vi.fn()} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants, hiddenVideoKeys: new Set(['p-2:participant']) },
      menuTarget: { ...menuTarget, key: 'p-2:participant', kind: 'camera' },
    });
    expect(screen.getByText('Restaurar vídeo')).toBeInTheDocument();
    expect(screen.queryByText('Ocultar vídeo para mim')).not.toBeInTheDocument();
  });

  it('on a screen (not camera), offers none of these actions', () => {
    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<TileMenu onOpenProfile={vi.fn()} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants },
      menuTarget: { ...menuTarget, kind: 'screen' },
    });
    expect(screen.queryByText('Ocultar vídeo para mim')).not.toBeInTheDocument();
    expect(screen.queryByText('Espelhar minha prévia')).not.toBeInTheDocument();
  });
});

describe('TileMenu — target invalidation', () => {
  it('closes the menu when the participant leaves the call', async () => {
    const closeTileMenu = vi.fn();
    const value = createFakeRoomContextValue({
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants: new Map([['p-2', fakeParticipant()]]) },
      menuTarget,
      closeTileMenu,
    });
    const { rerender } = renderWithRoom(<TileMenu onOpenProfile={vi.fn()} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants: new Map([['p-2', fakeParticipant()]]) },
      menuTarget,
      closeTileMenu,
    });
    expect(closeTileMenu).not.toHaveBeenCalled();

    rerender(
      <RoomContext.Provider value={{ ...value, state: { ...value.state, participants: new Map() } }}>
        <TileMenu onOpenProfile={vi.fn()} />
      </RoomContext.Provider>
    );
    await waitFor(() => expect(closeTileMenu).toHaveBeenCalled());
  });

  it('closes the menu when the active call/conversation changes', async () => {
    const closeTileMenu = vi.fn();
    const value = createFakeRoomContextValue({
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants: new Map([['p-2', fakeParticipant()]]) },
      menuTarget,
      closeTileMenu,
      activeCallConversationId: 'conv-1',
    });
    const { rerender } = renderWithRoom(<TileMenu onOpenProfile={vi.fn()} />, {
      state: value.state,
      menuTarget,
      closeTileMenu,
      activeCallConversationId: 'conv-1',
    });
    expect(closeTileMenu).not.toHaveBeenCalled();

    rerender(
      <RoomContext.Provider value={{ ...value, activeCallConversationId: 'conv-2' }}>
        <TileMenu onOpenProfile={vi.fn()} />
      </RoomContext.Provider>
    );
    await waitFor(() => expect(closeTileMenu).toHaveBeenCalled());
  });

  it('closes the menu when the person\'s source (camera) ends', async () => {
    const closeTileMenu = vi.fn();
    const livekitRoom = fakeLivekitRoomWithRemote();
    livekitRoom.setPublication(Track.Source.Camera, { isMuted: false, track: fakeTrack() });
    const value = createFakeRoomContextValue({
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants: new Map([['p-2', fakeParticipant()]]) },
      menuTarget: { ...menuTarget, key: 'p-2:participant', kind: 'camera' },
      closeTileMenu,
      livekitRoom,
    });
    renderWithRoom(<TileMenu onOpenProfile={vi.fn()} />, { ...value });
    await waitFor(() => expect(screen.getByText('Ocultar vídeo para mim')).toBeInTheDocument());
    expect(closeTileMenu).not.toHaveBeenCalled();

    livekitRoom.setPublication(Track.Source.Camera, undefined);
    await waitFor(() => expect(closeTileMenu).toHaveBeenCalled());
  });

  it('does NOT close the menu for its own screen just because it is paused — regression: pausing (mute) made "media.screenTrack" become null, which was read as "the source ended"', async () => {
    const closeTileMenu = vi.fn();
    const livekitRoom = fakeLivekitRoomWithRemote();
    livekitRoom.setLocalPublication(Track.Source.ScreenShare, { isMuted: true, track: fakeTrack() });
    const value = createFakeRoomContextValue({
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' } },
      menuTarget: { ...menuTarget, key: 'p-1:screen', participantId: 'p-1', kind: 'screen' },
      closeTileMenu,
      livekitRoom,
    });
    const { rerender } = renderWithRoom(<TileMenu onOpenProfile={vi.fn()} />, { ...value });
    await waitFor(() => expect(screen.getByText('Retomar prévia')).toBeInTheDocument());
    expect(closeTileMenu).not.toHaveBeenCalled();

    // simulates an unrelated participants-map update (e.g. someone else's
    // speaking/mic state changing) re-running the invalidation effect while
    // the screen stays paused — must still not close.
    rerender(
      <RoomContext.Provider value={{ ...value, state: { ...value.state, participants: new Map([['p-2', fakeParticipant()]]) } }}>
        <TileMenu onOpenProfile={vi.fn()} />
      </RoomContext.Provider>
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(closeTileMenu).not.toHaveBeenCalled();
  });
});

describe('TileMenu — stats with resolution', () => {
  it('shows the video source resolution when available via getSettings', async () => {
    const livekitRoom = fakeLivekitRoomWithRemote();
    livekitRoom.setPublication(Track.Source.Camera, { isMuted: false, track: fakeTrack(1920, 1080) });
    renderWithRoom(<TileMenu onOpenProfile={vi.fn()} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants: new Map([['p-2', fakeParticipant()]]) },
      menuTarget: { ...menuTarget, key: 'p-2:participant', kind: 'camera' },
      livekitRoom,
      showStats: true,
    });
    await waitFor(() => expect(screen.getByText('Resolução: 1920×1080')).toBeInTheDocument());
  });

  it('with no resolution stat available, does not show the row (never makes up a zero)', () => {
    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<TileMenu onOpenProfile={vi.fn()} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants },
      menuTarget,
      showStats: true,
    });
    expect(screen.queryByText(/Resolução/)).not.toBeInTheDocument();
  });
});

describe('TileMenu — my own shared screen', () => {
  it('offers change source, quality, pause preview and stop — never watch/stop watching', () => {
    renderWithRoom(<TileMenu onOpenProfile={vi.fn()} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' } },
      menuTarget: { ...menuTarget, key: 'p-1:screen', participantId: 'p-1', kind: 'screen' },
    });
    expect(screen.getByText('Trocar fonte')).toBeInTheDocument();
    expect(screen.getByText('Qualidade')).toBeInTheDocument();
    expect(screen.getByText('Pausar prévia')).toBeInTheDocument();
    expect(screen.getByText('Encerrar compartilhamento')).toBeInTheDocument();
    expect(screen.queryByText('Assistir')).not.toBeInTheDocument();
    expect(screen.queryByText('Parar de assistir')).not.toBeInTheDocument();
  });

  it('"Trocar fonte" calls changeSource', () => {
    const changeSource = vi.fn(async () => undefined);
    renderWithRoom(<TileMenu onOpenProfile={vi.fn()} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' } },
      menuTarget: { ...menuTarget, key: 'p-1:screen', participantId: 'p-1', kind: 'screen' },
      changeSource,
    });
    fireEvent.click(screen.getByText('Trocar fonte'));
    expect(changeSource).toHaveBeenCalled();
  });

  it('"Pausar prévia" calls pauseSharePreview when not paused', () => {
    const pauseSharePreview = vi.fn(async () => undefined);
    renderWithRoom(<TileMenu onOpenProfile={vi.fn()} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' } },
      menuTarget: { ...menuTarget, key: 'p-1:screen', participantId: 'p-1', kind: 'screen' },
      pauseSharePreview,
    });
    fireEvent.click(screen.getByText('Pausar prévia'));
    expect(pauseSharePreview).toHaveBeenCalled();
  });

  it('when already paused, shows "Retomar prévia" and calls resumeSharePreview on click', async () => {
    const resumeSharePreview = vi.fn(async () => undefined);
    const livekitRoom = fakeLivekitRoomWithRemote();
    livekitRoom.setLocalPublication(Track.Source.ScreenShare, { isMuted: true, track: fakeTrack() });
    renderWithRoom(<TileMenu onOpenProfile={vi.fn()} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' } },
      menuTarget: { ...menuTarget, key: 'p-1:screen', participantId: 'p-1', kind: 'screen' },
      livekitRoom,
      resumeSharePreview,
    });
    await waitFor(() => expect(screen.getByText('Retomar prévia')).toBeInTheDocument());
    expect(screen.queryByText('Pausar prévia')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Retomar prévia'));
    expect(resumeSharePreview).toHaveBeenCalled();
  });

  it('"Encerrar compartilhamento" calls stopSharing and closes the menu', () => {
    const stopSharing = vi.fn();
    const closeTileMenu = vi.fn();
    renderWithRoom(<TileMenu onOpenProfile={vi.fn()} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' } },
      menuTarget: { ...menuTarget, key: 'p-1:screen', participantId: 'p-1', kind: 'screen' },
      stopSharing,
      closeTileMenu,
    });
    fireEvent.click(screen.getByText('Encerrar compartilhamento'));
    expect(stopSharing).toHaveBeenCalled();
    expect(closeTileMenu).toHaveBeenCalled();
  });
});

describe('TileMenu — watch/stop watching another person\'s screen', () => {
  it('offers "Parar de assistir" — never your own screen\'s actions', () => {
    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<TileMenu onOpenProfile={vi.fn()} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants },
      menuTarget: { ...menuTarget, key: 'p-2:screen', kind: 'screen' },
    });
    expect(screen.getByText('Parar de assistir')).toBeInTheDocument();
    expect(screen.queryByText('Trocar fonte')).not.toBeInTheDocument();
    expect(screen.queryByText('Qualidade')).not.toBeInTheDocument();
    expect(screen.queryByText('Encerrar compartilhamento')).not.toBeInTheDocument();
  });

  it('clicking dispatches TOGGLE_SCREEN_WATCH with the right key', () => {
    const dispatch = vi.fn();
    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<TileMenu onOpenProfile={vi.fn()} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants },
      menuTarget: { ...menuTarget, key: 'p-2:screen', kind: 'screen' },
      dispatch,
    });
    fireEvent.click(screen.getByText('Parar de assistir'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'TOGGLE_SCREEN_WATCH', key: 'p-2:screen' });
  });

  it('when no longer watching, shows "Assistir" instead', () => {
    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<TileMenu onOpenProfile={vi.fn()} />, {
      state: {
        ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants,
        unwatchedScreenKeys: new Set(['p-2:screen']),
      },
      menuTarget: { ...menuTarget, key: 'p-2:screen', kind: 'screen' },
    });
    expect(screen.getByText('Assistir')).toBeInTheDocument();
    expect(screen.queryByText('Parar de assistir')).not.toBeInTheDocument();
  });
});
