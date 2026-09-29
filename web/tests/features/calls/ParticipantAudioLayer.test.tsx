import { afterEach, describe, expect, it, vi } from 'vitest';
import { Room, Track } from 'livekit-client';
import type { Room as LKRoom } from 'livekit-client';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { initialRoomState } from '@/state/roomReducer';
import { ParticipantAudioLayer } from '@/features/calls/ParticipantAudioLayer';
import { saveDevicePreference } from '@/features/settings/useDevicePreference';
import type { Participant } from '@/shared/types/protocol';

function fakeParticipant(overrides: Partial<Participant> = {}): Participant {
  return {
    id: 'p-2', userId: 'u-2', name: 'Jane', displayName: 'Jane', avatar: '', avatarPoster: '', avatarColor: 'green',
    banner: '', bannerPoster: '', bio: '', profileLinks: [], role: 'user', deafened: false, callConversationId: 'conv-1',
    micActivated: true, micMuted: false, cameraOn: false, sharing: false, speaking: false,
    ...overrides,
  };
}

function fakeRoomWithScreenAudio(screenAudioPub?: { isMuted: boolean; track: object }) {
  const listeners = new Map<string, Set<() => void>>();
  const room = {
    on: vi.fn((event: string, fn: () => void) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(fn); }),
    off: vi.fn((event: string, fn: () => void) => { listeners.get(event)?.delete(fn); }),
    localParticipant: { identity: 'p-1', getTrackPublication: () => undefined },
    getParticipantByIdentity: vi.fn(() => ({
      getTrackPublication: (source: Track.Source) => (source === Track.Source.ScreenShareAudio ? screenAudioPub : undefined),
    })),
  };
  return room as unknown as LKRoom;
}

describe('ParticipantAudioLayer — screen-share audio only registers when it actually exists', () => {
  it('without a screen audio track (nothing was shared), does not register the ":screen" key — no "audio available" just because it was requested', () => {
    const audioRegistry = { current: new Map() };
    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<ParticipantAudioLayer participantIds={['p-2']} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants },
      livekitRoom: fakeRoomWithScreenAudio(undefined),
      audioRegistry,
    });

    expect(audioRegistry.current.has('p-2:screen')).toBe(false);
  });

  it('with a real screen audio track, registers the ":screen" key', () => {
    const audioRegistry = { current: new Map() };
    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<ParticipantAudioLayer participantIds={['p-2']} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants },
      livekitRoom: fakeRoomWithScreenAudio({ isMuted: false, track: { attach: vi.fn(), detach: vi.fn() } }),
      audioRegistry,
    });

    expect(audioRegistry.current.has('p-2:screen')).toBe(true);
  });
});

describe('ParticipantAudioLayer — applies the saved audio output (speaker)', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    // @ts-expect-error -- jsdom doesn't have setSinkId; remove the test's fake version.
    delete HTMLMediaElement.prototype.setSinkId;
  });

  it('calls setSinkId with the saved deviceId for created audio elements', () => {
    saveDevicePreference('audiooutput', 'preferred-device');
    const setSinkId = vi.fn(async () => undefined);
    HTMLMediaElement.prototype.setSinkId = setSinkId;

    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<ParticipantAudioLayer participantIds={['p-2']} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants },
      livekitRoom: new Room(),
    });

    expect(setSinkId).toHaveBeenCalledWith('preferred-device');
  });

  it('without a saved preference, does not call setSinkId', () => {
    const setSinkId = vi.fn(async () => undefined);
    HTMLMediaElement.prototype.setSinkId = setSinkId;

    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<ParticipantAudioLayer participantIds={['p-2']} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants },
      livekitRoom: new Room(),
    });

    expect(setSinkId).not.toHaveBeenCalled();
  });
});
