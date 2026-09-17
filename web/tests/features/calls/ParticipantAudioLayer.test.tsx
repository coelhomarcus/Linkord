import { afterEach, describe, expect, it, vi } from 'vitest';
import { Room } from 'livekit-client';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { initialRoomState } from '@/state/roomReducer';
import { ParticipantAudioLayer } from '@/features/calls/ParticipantAudioLayer';
import { saveDevicePreference } from '@/features/settings/useDevicePreference';
import type { Participant } from '@/shared/types/protocol';

function fakeParticipant(overrides: Partial<Participant> = {}): Participant {
  return {
    id: 'p-2', userId: 'u-2', name: 'Fulana', displayName: 'Fulana', avatar: '', avatarPoster: '', avatarColor: 'green',
    banner: '', bannerPoster: '', bio: '', profileLinks: [], role: 'user', deafened: false, callConversationId: 'conv-1',
    micActivated: true, micMuted: false, cameraOn: false, sharing: false, speaking: false,
    ...overrides,
  };
}

describe('ParticipantAudioLayer — aplica a saida de audio (alto-falante) salva', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    // @ts-expect-error -- jsdom nao tem setSinkId; removida a versao fake do teste.
    delete HTMLMediaElement.prototype.setSinkId;
  });

  it('chama setSinkId com o deviceId salvo pros elementos de audio criados', () => {
    saveDevicePreference('audiooutput', 'fone-preferido');
    const setSinkId = vi.fn(async () => undefined);
    HTMLMediaElement.prototype.setSinkId = setSinkId;

    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<ParticipantAudioLayer participantIds={['p-2']} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants },
      livekitRoom: new Room(),
    });

    expect(setSinkId).toHaveBeenCalledWith('fone-preferido');
  });

  it('sem preferencia salva, nao chama setSinkId', () => {
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
