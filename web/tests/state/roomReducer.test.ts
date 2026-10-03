import { describe, expect, it } from 'vitest';
import { initialRoomState, roomReducer } from '@/state/roomReducer';
import type { Participant } from '@/shared/types/protocol';

function participant(overrides: Partial<Participant> = {}): Participant {
  return {
    id: 'p1', userId: 'u1', name: 'Jane', displayName: 'Jane', avatar: '', avatarPoster: '', avatarColor: 'green',
    banner: '', bannerPoster: '', bio: '', profileLinks: [], role: 'user', deafened: false, callConversationId: null,
    micActivated: false, micMuted: true, cameraOn: false, sharing: false, speaking: false,
    ...overrides,
  };
}

describe('roomReducer', () => {
  it('WELCOME fills in "me" and the participant list, and clears roomError', () => {
    const state = { ...initialRoomState, roomError: 'room is full' };
    const next = roomReducer(state, {
      type: 'WELCOME',
      id: 'conn1',
      userId: 'u1',
      name: 'Jane',
      displayName: 'Nickname',
      avatar: 'a.png',
      avatarPoster: 'a-poster.jpg',
      avatarColor: 'fuchsia',
      banner: 'https://example.com/banner.png',
      bannerPoster: 'https://example.com/banner-poster.jpg',
      bio: 'Short bio',
      profileLinks: ['https://youtube.com/@jane'],
      role: 'admin',
      participants: [participant({ id: 'p2', userId: 'u2' })],
    });
    expect(next.me).toEqual({
      ...initialRoomState.me,
      id: 'conn1',
      userId: 'u1',
      name: 'Jane',
      displayName: 'Nickname',
      avatar: 'a.png',
      avatarPoster: 'a-poster.jpg',
      avatarColor: 'fuchsia',
      banner: 'https://example.com/banner.png',
      bannerPoster: 'https://example.com/banner-poster.jpg',
      bio: 'Short bio',
      profileLinks: ['https://youtube.com/@jane'],
      role: 'admin',
    });
    expect(next.participants.get('p2')?.userId).toBe('u2');
    expect(next.joined).toBe(true);
    expect(next.roomError).toBeNull();
  });

  it('PARTICIPANT_UPDATED ignores whoever is not in the room (avoids reviving a participant who already left)', () => {
    const state = { ...initialRoomState, participants: new Map([['p1', participant()]]) };
    const next = roomReducer(state, { type: 'PARTICIPANT_UPDATED', participant: participant({ id: 'ghost' }) });
    expect(next.participants.has('ghost')).toBe(false);
    expect(next).toBe(state);
  });

  it('PARTICIPANT_UPDATED updates whoever is already in the room', () => {
    const state = { ...initialRoomState, participants: new Map([['p1', participant({ deafened: false })]]) };
    const next = roomReducer(state, { type: 'PARTICIPANT_UPDATED', participant: participant({ deafened: true }) });
    expect(next.participants.get('p1')?.deafened).toBe(true);
  });

  describe('PARTICIPANT_LEFT', () => {
    it('removes the participant and unfocuses if the focus was on THEM (prefix `${id}:`), clearing the origin too', () => {
      const state = { ...initialRoomState, participants: new Map([['p1', participant()]]), focusedId: 'p1:screen', focusOrigin: 'manual' as const };
      const next = roomReducer(state, { type: 'PARTICIPANT_LEFT', id: 'p1' });
      expect(next.participants.has('p1')).toBe(false);
      expect(next.focusedId).toBeNull();
      expect(next.focusOrigin).toBeNull();
    });

    it('does not touch the focus if it belonged to ANOTHER person', () => {
      const state = {
        ...initialRoomState,
        participants: new Map([['p1', participant()], ['p2', participant({ id: 'p2' })]]),
        focusedId: 'p2:camera',
      };
      const next = roomReducer(state, { type: 'PARTICIPANT_LEFT', id: 'p1' });
      expect(next.focusedId).toBe('p2:camera');
    });

    it('does not confuse prefixes — "p1x" leaving does not unfocus "p1:screen"', () => {
      const state = {
        ...initialRoomState,
        participants: new Map([['p1', participant()], ['p1x', participant({ id: 'p1x' })]]),
        focusedId: 'p1:screen',
      };
      const next = roomReducer(state, { type: 'PARTICIPANT_LEFT', id: 'p1x' });
      expect(next.focusedId).toBe('p1:screen');
    });

    it('clears hiddenVideoKeys and unwatchedScreenKeys for the participant who left, without touching another person\'s', () => {
      const state = {
        ...initialRoomState,
        participants: new Map([['p1', participant()], ['p2', participant({ id: 'p2' })]]),
        hiddenVideoKeys: new Set(['p1:participant', 'p2:participant']),
        unwatchedScreenKeys: new Set(['p1:screen', 'p2:screen']),
      };
      const next = roomReducer(state, { type: 'PARTICIPANT_LEFT', id: 'p1' });
      expect(next.hiddenVideoKeys).toEqual(new Set(['p2:participant']));
      expect(next.unwatchedScreenKeys).toEqual(new Set(['p2:screen']));
    });

    it('does not confuse prefixes when clearing unwatchedScreenKeys — "p1x" leaving does not touch "p1:screen"', () => {
      const state = {
        ...initialRoomState,
        participants: new Map([['p1', participant()], ['p1x', participant({ id: 'p1x' })]]),
        unwatchedScreenKeys: new Set(['p1:screen']),
      };
      const next = roomReducer(state, { type: 'PARTICIPANT_LEFT', id: 'p1x' });
      expect(next.unwatchedScreenKeys).toEqual(new Set(['p1:screen']));
    });
  });

  describe('TOGGLE_SCREEN_WATCH', () => {
    it('toggles the key in/out of unwatchedScreenKeys', () => {
      const first = roomReducer(initialRoomState, { type: 'TOGGLE_SCREEN_WATCH', key: 'p1:screen' });
      expect(first.unwatchedScreenKeys).toEqual(new Set(['p1:screen']));

      const second = roomReducer(first, { type: 'TOGGLE_SCREEN_WATCH', key: 'p1:screen' });
      expect(second.unwatchedScreenKeys).toEqual(new Set());
    });

    it('does not touch hiddenVideoKeys (they are independent)', () => {
      const state = { ...initialRoomState, hiddenVideoKeys: new Set(['p1:participant']) };
      const next = roomReducer(state, { type: 'TOGGLE_SCREEN_WATCH', key: 'p1:screen' });
      expect(next.hiddenVideoKeys).toEqual(new Set(['p1:participant']));
    });
  });

  describe('TOGGLE_HIDDEN_VIDEO', () => {
    it('toggles the key in/out of hiddenVideoKeys', () => {
      const first = roomReducer(initialRoomState, { type: 'TOGGLE_HIDDEN_VIDEO', key: 'p1:participant' });
      expect(first.hiddenVideoKeys).toEqual(new Set(['p1:participant']));

      const second = roomReducer(first, { type: 'TOGGLE_HIDDEN_VIDEO', key: 'p1:participant' });
      expect(second.hiddenVideoKeys).toEqual(new Set());
    });
  });

  describe('PARTICIPANTS_SYNC', () => {
    it('unfocuses (and clears the origin) if the focus owner is no longer in the synced list', () => {
      const state = {
        ...initialRoomState,
        participants: new Map([['p1', participant()]]),
        focusedId: 'p1:screen',
        focusOrigin: 'manual' as const,
      };
      const next = roomReducer(state, { type: 'PARTICIPANTS_SYNC', participants: [] });
      expect(next.focusedId).toBeNull();
      expect(next.focusOrigin).toBeNull();
    });

    it('keeps the focus if the owner is still in the synced list', () => {
      const state = { ...initialRoomState, focusedId: 'p1:camera', focusOrigin: 'manual' as const };
      const next = roomReducer(state, { type: 'PARTICIPANTS_SYNC', participants: [participant()] });
      expect(next.focusedId).toBe('p1:camera');
      expect(next.focusOrigin).toBe('manual');
    });

    it('keeps the focus on yourself even if you do not come in the remote participants list', () => {
      const state = { ...initialRoomState, me: { ...initialRoomState.me, id: 'me-id' }, focusedId: 'me-id:camera', focusOrigin: 'manual' as const };
      const next = roomReducer(state, { type: 'PARTICIPANTS_SYNC', participants: [] });
      expect(next.focusedId).toBe('me-id:camera');
    });
  });

  it('PARTICIPANT_JOINED adds a new participant to the room', () => {
    const next = roomReducer(initialRoomState, { type: 'PARTICIPANT_JOINED', participant: participant({ id: 'p2', userId: 'u2' }) });
    expect(next.participants.get('p2')?.userId).toBe('u2');
  });

  it('SET_RECONNECTING toggles the flag on/off', () => {
    const next = roomReducer(initialRoomState, { type: 'SET_RECONNECTING', value: true });
    expect(next.reconnecting).toBe(true);
    expect(roomReducer(next, { type: 'SET_RECONNECTING', value: false }).reconnecting).toBe(false);
  });

  it('SET_LOCAL_AVATAR updates only "me"\'s avatar, without touching the rest', () => {
    const state = { ...initialRoomState, me: { ...initialRoomState.me, avatarColor: 'green' } };
    const next = roomReducer(state, { type: 'SET_LOCAL_AVATAR', avatar: 'new.png' });
    expect(next.me.avatar).toBe('new.png');
    expect(next.me.avatarColor).toBe('green');
    expect(next.me.name).toBe(state.me.name);
  });

  it('SET_LOCAL_PROFILE updates "me"\'s editable profile fields', () => {
    const next = roomReducer(initialRoomState, {
      type: 'SET_LOCAL_PROFILE',
      avatar: 'new.png',
      avatarPoster: 'new-poster.jpg',
      avatarColor: 'red',
      displayName: 'Nickname',
      banner: 'https://example.com/banner.png',
      bannerPoster: 'https://example.com/banner-poster.jpg',
      bio: 'Short bio',
      profileLinks: ['https://twitch.tv/jane'],
    });
    expect(next.me.avatar).toBe('new.png');
    expect(next.me.avatarPoster).toBe('new-poster.jpg');
    expect(next.me.avatarColor).toBe('red');
    expect(next.me.displayName).toBe('Nickname');
    expect(next.me.banner).toBe('https://example.com/banner.png');
    expect(next.me.bannerPoster).toBe('https://example.com/banner-poster.jpg');
    expect(next.me.bio).toBe('Short bio');
    expect(next.me.profileLinks).toEqual(['https://twitch.tv/jane']);
  });

  it('SET_ROOM_ERROR sets and clears (null) the room error message', () => {
    const withError = roomReducer(initialRoomState, { type: 'SET_ROOM_ERROR', message: 'room is full' });
    expect(withError.roomError).toBe('room is full');
    expect(roomReducer(withError, { type: 'SET_ROOM_ERROR', message: null }).roomError).toBeNull();
  });

  it('SET_LOCAL_CAMERA toggles "me"\'s camera flag on/off', () => {
    const next = roomReducer(initialRoomState, { type: 'SET_LOCAL_CAMERA', on: true });
    expect(next.me.cameraOn).toBe(true);
  });

  describe('SET_FOCUSED', () => {
    it('changes the focused id (tile key, not just participantId) and stores the origin', () => {
      const next = roomReducer(initialRoomState, { type: 'SET_FOCUSED', id: 'p1:screen', origin: 'manual' });
      expect(next.focusedId).toBe('p1:screen');
      expect(next.focusOrigin).toBe('manual');
    });

    it('unfocusing (id: null) always clears the origin too, even if "origin" is passed', () => {
      const focused = roomReducer(initialRoomState, { type: 'SET_FOCUSED', id: 'p1:screen', origin: 'automatic' });
      const next = roomReducer(focused, { type: 'SET_FOCUSED', id: null, origin: 'manual' });
      expect(next.focusedId).toBeNull();
      expect(next.focusOrigin).toBeNull();
    });

    it('stores automatic focus separately from manual', () => {
      const next = roomReducer(initialRoomState, { type: 'SET_FOCUSED', id: 'p2:screen', origin: 'automatic' });
      expect(next.focusOrigin).toBe('automatic');
    });

    it('stores the "capacity" origin (fallback when the grid is full) as distinct from manual/automatic', () => {
      const next = roomReducer(initialRoomState, { type: 'SET_FOCUSED', id: 'p2:avatar', origin: 'capacity' });
      expect(next.focusOrigin).toBe('capacity');
    });
  });

  it('SET_SHARE_ERROR sets and clears (null) the sharing/mic error', () => {
    const withError = roomReducer(initialRoomState, { type: 'SET_SHARE_ERROR', message: 'no microphone permission' });
    expect(withError.shareError).toBe('no microphone permission');
    expect(roomReducer(withError, { type: 'SET_SHARE_ERROR', message: null }).shareError).toBeNull();
  });

  describe('SET_LOCAL_SHARING', () => {
    it('turning on: records sharingSince if it did not already have one', () => {
      const next = roomReducer(initialRoomState, { type: 'SET_LOCAL_SHARING', sharing: true });
      expect(next.me.sharing).toBe(true);
      expect(next.me.sharingSince).toEqual(expect.any(Number));
    });

    it('turning on again without turning off first: keeps the original sharingSince (does not reset the timer)', () => {
      const state = { ...initialRoomState, me: { ...initialRoomState.me, sharing: true, sharingSince: 1000 } };
      const next = roomReducer(state, { type: 'SET_LOCAL_SHARING', sharing: true });
      expect(next.me.sharingSince).toBe(1000);
    });

    it('turning off: clears sharingSince', () => {
      const state = { ...initialRoomState, me: { ...initialRoomState.me, sharing: true, sharingSince: 1000 } };
      const next = roomReducer(state, { type: 'SET_LOCAL_SHARING', sharing: false });
      expect(next.me.sharing).toBe(false);
      expect(next.me.sharingSince).toBeNull();
    });
  });

  it('an unknown action returns the same state (switch default)', () => {
    const next = roomReducer(initialRoomState, { type: 'NOT_A_REAL_ACTION' } as never);
    expect(next).toBe(initialRoomState);
  });
});

describe('roomReducer — SET_ROLE', () => {
  it('updates the account\'s own role without touching the rest of the state', () => {
    const state = { ...initialRoomState, me: { ...initialRoomState.me, userId: 'u1', role: 'user' as const } };
    const next = roomReducer(state, { type: 'SET_ROLE', role: 'admin' });
    expect(next.me.role).toBe('admin');
    expect(next.me.userId).toBe('u1');
    expect(roomReducer(next, { type: 'SET_ROLE', role: 'user' }).me.role).toBe('user');
  });
});

describe('roomReducer — SET_CLIENT_OUTDATED', () => {
  it('marks the client as outdated without touching roomError (the dedicated screen takes over)', () => {
    expect(initialRoomState.clientOutdated).toBe(false);
    const next = roomReducer(initialRoomState, { type: 'SET_CLIENT_OUTDATED' });
    expect(next.clientOutdated).toBe(true);
    expect(next.roomError).toBeNull();
  });
});
