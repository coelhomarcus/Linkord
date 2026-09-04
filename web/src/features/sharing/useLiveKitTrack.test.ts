import { describe, expect, it } from 'vitest';
import { Track } from 'livekit-client';
import type { Participant, Room } from 'livekit-client';
import { getParticipant, activeTrack } from './useLiveKitTrack';

// getParticipant/activeTrack sao funcoes puras exportadas (nao hooks) —
// testaveis com objetos fake no formato minimo que elas leem, sem precisar
// conectar uma Room de verdade a nenhum servidor LiveKit.
describe('getParticipant', () => {
  it('devolve o localParticipant quando a identity bate com ele mesmo', () => {
    const local = { identity: 'me' };
    const room = { localParticipant: local, getParticipantByIdentity: () => undefined } as unknown as Room;
    expect(getParticipant(room, 'me')).toBe(local);
  });

  it('devolve o participante remoto encontrado por identity', () => {
    const remote = { identity: 'outro' };
    const room = {
      localParticipant: { identity: 'me' },
      getParticipantByIdentity: (id: string) => (id === 'outro' ? remote : undefined),
    } as unknown as Room;
    expect(getParticipant(room, 'outro')).toBe(remote);
  });

  it('identity desconhecida devolve undefined', () => {
    const room = { localParticipant: { identity: 'me' }, getParticipantByIdentity: () => undefined } as unknown as Room;
    expect(getParticipant(room, 'fantasma')).toBeUndefined();
  });
});

describe('activeTrack', () => {
  function fakeParticipant(pub: { isMuted: boolean; track: unknown } | null): Participant {
    return { getTrackPublication: () => pub } as unknown as Participant;
  }

  it('sem publication nenhuma, devolve null', () => {
    expect(activeTrack(fakeParticipant(null), Track.Source.Camera)).toBeNull();
  });

  it('publication MUTADA devolve null mesmo com a track ainda existindo — desligar camera/tela nao despublica, so muta', () => {
    const p = fakeParticipant({ isMuted: true, track: { id: 'trackreal' } });
    expect(activeTrack(p, Track.Source.Camera)).toBeNull();
  });

  it('publication ativa (nao mutada) devolve a track', () => {
    const track = { id: 'trackreal' };
    const p = fakeParticipant({ isMuted: false, track });
    expect(activeTrack(p, Track.Source.Camera)).toBe(track);
  });

  it('publication ativa mas sem track anexada ainda devolve null (nunca undefined)', () => {
    const p = fakeParticipant({ isMuted: false, track: undefined });
    expect(activeTrack(p, Track.Source.Camera)).toBeNull();
  });
});
