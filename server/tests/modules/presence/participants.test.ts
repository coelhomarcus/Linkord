import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../../../src/config/env.js';
import type { AppSocket, Participant } from '../../../src/types.js';
import {
  participants, join, removeParticipant, handleClose, isUserOnline, setCallConversationId, publicParticipant,
  broadcastToKnownPeers, handlers,
} from '../../../src/modules/presence/participants.js';

// join() returns { participant, justCameOnline } (Etapa 7 — the caller now
// computes knownPeerIds before broadcasting 'user-online', see
// realtime/socket.ts#handleJoin). Every test here only cares about the
// participant itself, so this thin wrapper keeps every existing assertion
// unchanged instead of destructuring at each call site.
function joinP(socket: AppSocket, msg: Parameters<typeof join>[1]): Participant | null {
  const result = join(socket, msg);
  return result ? result.participant : null;
}

/** Minimal fake of AppSocket — only the fields participants.ts actually reads
 * (never a real Socket.IO, with no connection at all). */
function fakeSocket(
  userId: string,
  overrides: Partial<{
    username: string;
    displayName: string;
    avatar: string;
    avatarColor: string;
    banner: string;
    bio: string;
    profileLinks: string[];
    role: 'user' | 'admin';
  }> = {}
): AppSocket {
  return {
    participantId: null,
    ip: '127.0.0.1',
    connected: true,
    emit: () => {},
    disconnect: () => {},
    user: {
      tokenHash: 'x',
      userId,
      username: overrides.username ?? userId,
      // '' mirrors an account that never set one — session.ts resolves this
      // to the username before it ever reaches join(), but join() also
      // falls back defensively (see sanitizeDisplayName usage there).
      displayName: overrides.displayName ?? '',
      avatar: overrides.avatar ?? '',
      avatarColor: overrides.avatarColor ?? 'blurple',
      banner: overrides.banner ?? '',
      bio: overrides.bio ?? '',
      profileLinks: overrides.profileLinks ?? [],
      role: overrides.role ?? 'user',
    },
  } as unknown as AppSocket;
}

// participants is a module-level Map shared across ALL tests in this
// process — each test tracks the ids it created here and cleans them up in
// afterEach (including canceling any pending graceTimer, which otherwise
// would keep the `node --test` process alive until the reconnect timeout).
let createdIds: string[] = [];
afterEach(() => {
  for (const id of createdIds) {
    const p = participants.get(id);
    if (p?.graceTimer) clearTimeout(p.graceTimer);
    participants.delete(id);
  }
  createdIds = [];
});

describe('join', () => {
  test('creates a new participant and sets socket.participantId', () => {
    const userId = `u-${Math.random()}`;
    const socket = fakeSocket(userId);
    const p = joinP(socket, {});
    assert.ok(p);
    createdIds.push(p!.id);
    assert.equal(socket.participantId, p!.id);
    assert.equal(p!.userId, userId);
    assert.equal(p!.avatarColor, 'blurple');
    assert.equal(p!.deafened, false);
    assert.equal(p!.callConversationId, null);
    assert.equal(participants.get(p!.id), p);
  });

  test('uses the avatar color persisted on the account profile', () => {
    const p = joinP(fakeSocket(`u-${Math.random()}`, { avatarColor: 'fuchsia' }), {})!;
    createdIds.push(p.id);

    assert.equal(p.avatarColor, 'fuchsia');
    assert.equal(publicParticipant(p).avatarColor, 'fuchsia');
  });

  test('an invalid avatar color falls back to the safe default', () => {
    const p = joinP(fakeSocket(`u-${Math.random()}`, { avatarColor: 'url(javascript:alert(1))' }), {})!;
    createdIds.push(p.id);

    assert.equal(p.avatarColor, 'blurple');
  });

  test('accepts a custom hex avatar color (outside the presets)', () => {
    const p = joinP(fakeSocket(`u-${Math.random()}`, { avatarColor: '#A1B2C3' }), {})!;
    createdIds.push(p.id);

    assert.equal(p.avatarColor, '#a1b2c3');
  });

  test('a malformed hex falls back to the safe default (does not leak into CSS)', () => {
    const p = joinP(fakeSocket(`u-${Math.random()}`, { avatarColor: '#zzzzzz' }), {})!;
    createdIds.push(p.id);

    assert.equal(p.avatarColor, 'blurple');
  });

  test('uses the display name persisted on the account', () => {
    const p = joinP(fakeSocket(`u-${Math.random()}`, { displayName: 'Nickname' }), {})!;
    createdIds.push(p.id);

    assert.equal(p.displayName, 'Nickname');
    assert.equal(publicParticipant(p).displayName, 'Nickname');
  });

  test('uses the banner, bio and links persisted on the account', () => {
    const p = joinP(fakeSocket(`u-${Math.random()}`, {
      banner: 'https://example.com/banner.png',
      bio: 'Persisted bio',
      profileLinks: ['https://youtube.com/@fulana'],
    }), {})!;
    createdIds.push(p.id);

    assert.equal(publicParticipant(p).banner, 'https://example.com/banner.png');
    assert.equal(publicParticipant(p).bio, 'Persisted bio');
    assert.deepEqual(publicParticipant(p).profileLinks, ['https://youtube.com/@fulana']);
  });

  test('an empty display name (an account that never picked one) falls back to the username', () => {
    const userId = `u-${Math.random()}`;
    const p = joinP(fakeSocket(userId, { username: 'Fulana', displayName: '' }), {})!;
    createdIds.push(p.id);

    assert.equal(p.displayName, 'Fulana');
  });

  test('an account\'s first connection becomes "online"; a second tab of the SAME account does not duplicate the status', () => {
    const userId = `u-${Math.random()}`;
    assert.equal(isUserOnline(userId), false);

    const p1 = joinP(fakeSocket(userId), {});
    createdIds.push(p1!.id);
    assert.equal(isUserOnline(userId), true);

    // second tab, without a resume token — creates a SECOND participant (a
    // different connection id), but the account is still only ONE "online".
    const p2 = joinP(fakeSocket(userId), {});
    createdIds.push(p2!.id);
    assert.notEqual(p1!.id, p2!.id);
    assert.equal(isUserOnline(userId), true);
  });

  test('a full room (MAX_PARTICIPANTS) rejects a new join', () => {
    const original = config.MAX_PARTICIPANTS;
    config.MAX_PARTICIPANTS = participants.size + 1;
    try {
      const p1 = joinP(fakeSocket(`u-${Math.random()}`), {});
      createdIds.push(p1!.id);
      const p2 = joinP(fakeSocket(`u-${Math.random()}`), {});
      assert.equal(p2, null);
    } finally {
      config.MAX_PARTICIPANTS = original;
    }
  });
});

describe('reconnection (handleClose + resume by id/token)', () => {
  test('resumes the SAME identity with a valid id/token, clearing the graceTimer', () => {
    const userId = `u-${Math.random()}`;
    const socket1 = fakeSocket(userId);
    const original = joinP(socket1, {});
    createdIds.push(original!.id);

    handleClose(socket1); // "tab closed" — enters the grace window
    assert.equal(original!.socket, null);
    assert.ok(original!.graceTimer);

    const socket2 = fakeSocket(userId);
    const resumed = joinP(socket2, { id: original!.id, token: original!.token });

    assert.equal(resumed!.id, original!.id); // same identity, not a new participant
    assert.equal(resumed!.socket, socket2);
    assert.equal(resumed!.graceTimer, null);
  });

  test('a wrong token does not resume the old identity (but evicting the ghost frees up a new join)', () => {
    const userId = `u-${Math.random()}`;
    const socket1 = fakeSocket(userId);
    const original = joinP(socket1, {});
    createdIds.push(original!.id);

    handleClose(socket1);

    const socket2 = fakeSocket(userId);
    const fresh = joinP(socket2, { id: original!.id, token: 'wrong-token' });
    createdIds.push(fresh!.id);

    assert.notEqual(fresh!.id, original!.id); // did NOT reuse the old identity
    // the ghost from the old connection (socket null) got removed in the
    // process — only the new identity is left for this account.
    assert.equal(participants.has(original!.id), false);
  });
});

describe('removeParticipant', () => {
  test('removes it from the Map and marks the account offline if it was its only connection', () => {
    const userId = `u-${Math.random()}`;
    const p = joinP(fakeSocket(userId), {})!;
    assert.equal(isUserOnline(userId), true);

    removeParticipant(p);
    assert.equal(participants.has(p.id), false);
    assert.equal(isUserOnline(userId), false);
  });

  test('calling it again (already removed) is a safe no-op', () => {
    const p = joinP(fakeSocket(`u-${Math.random()}`), {})!;
    removeParticipant(p);
    assert.doesNotThrow(() => removeParticipant(p));
  });
});

describe('setCallConversationId', () => {
  test('changes the field and reflects it in publicParticipant (without leaking the token)', () => {
    const p = joinP(fakeSocket(`u-${Math.random()}`), {})!;
    createdIds.push(p.id);

    setCallConversationId(p, 'grupo-1');
    assert.equal(p.callConversationId, 'grupo-1');
    assert.equal(publicParticipant(p).callConversationId, 'grupo-1');
    assert.equal('token' in publicParticipant(p), false);

    setCallConversationId(p, null);
    assert.equal(p.callConversationId, null);
  });

  test('resets the self-reported media flags on every join/leave — no ghost left from a previous call', () => {
    const p = joinP(fakeSocket(`u-${Math.random()}`), {})!;
    createdIds.push(p.id);

    setCallConversationId(p, 'grupo-1');
    p.micActivated = true;
    p.micMuted = false;
    p.cameraOn = true;
    p.sharing = true;
    p.speaking = true;

    setCallConversationId(p, 'grupo-2');
    assert.equal(p.micActivated, false);
    assert.equal(p.micMuted, true);
    assert.equal(p.cameraOn, false);
    assert.equal(p.sharing, false);
    assert.equal(p.speaking, false);
  });
});

describe('self-reported media state (mic-state / camera / screen-share / speaking)', () => {
  test('mic-state changes micActivated/micMuted and reflects it in publicParticipant', () => {
    const socket = fakeSocket(`u-${Math.random()}`);
    const p = joinP(socket, {})!;
    createdIds.push(p.id);

    handlers['mic-state'](socket, { activated: true, muted: false });
    assert.equal(p.micActivated, true);
    assert.equal(p.micMuted, false);
    assert.equal(publicParticipant(p).micActivated, true);
    assert.equal(publicParticipant(p).micMuted, false);
  });

  test('camera and screen-share change cameraOn/sharing', () => {
    const socket = fakeSocket(`u-${Math.random()}`);
    const p = joinP(socket, {})!;
    createdIds.push(p.id);

    handlers.camera(socket, { on: true });
    assert.equal(p.cameraOn, true);

    handlers['screen-share'](socket, { on: true });
    assert.equal(p.sharing, true);
  });

  test('speaking changes the speaking field', () => {
    const socket = fakeSocket(`u-${Math.random()}`);
    const p = joinP(socket, {})!;
    createdIds.push(p.id);

    handlers.speaking(socket, { value: true });
    assert.equal(p.speaking, true);
  });

  test('a message from a socket that does not own the participant is ignored', () => {
    const socket = fakeSocket(`u-${Math.random()}`);
    const p = joinP(socket, {})!;
    createdIds.push(p.id);

    const otherSocket = fakeSocket(`u-${Math.random()}`);
    handlers.camera(otherSocket, { on: true });
    assert.equal(p.cameraOn, false);
  });
});

describe('broadcastToKnownPeers (Etapa 7 — presence scoping)', () => {
  function fakeSocketWithSpy(userId: string): { socket: AppSocket; emitted: string[] } {
    const emitted: string[] = [];
    const socket = fakeSocket(userId);
    (socket as unknown as { emit: (t: string) => void }).emit = (t: string) => { emitted.push(t); };
    return { socket, emitted };
  }

  test('delivers only to those who have the subject in their own knownPeerIds', () => {
    const subjectId = `u-${Math.random()}`;
    const strangerId = `u-${Math.random()}`;

    const subjectConn = fakeSocketWithSpy(subjectId);
    const subject = joinP(subjectConn.socket, {})!;
    createdIds.push(subject.id);

    const knowerConn = fakeSocketWithSpy(`u-${Math.random()}`);
    const knower = joinP(knowerConn.socket, {})!;
    createdIds.push(knower.id);
    knower.knownPeerIds.add(subjectId);

    const strangerConn = fakeSocketWithSpy(strangerId);
    const stranger = joinP(strangerConn.socket, {})!;
    createdIds.push(stranger.id);
    // the stranger's knownPeerIds stays empty — does not know the subject.

    knowerConn.emitted.length = 0;
    strangerConn.emitted.length = 0;
    broadcastToKnownPeers(subjectId, { t: 'participant-updated' });

    assert.ok(knowerConn.emitted.includes('participant-updated'));
    assert.equal(strangerConn.emitted.includes('participant-updated'), false);
  });

  test('a blocked pair (in either direction) does not receive presence, even while sharing a conversation', () => {
    const subjectId = `u-${Math.random()}`;
    const subjectConn = fakeSocketWithSpy(subjectId);
    createdIds.push(joinP(subjectConn.socket, {})!.id);

    const friendConn = fakeSocketWithSpy(`u-${Math.random()}`);
    const friend = joinP(friendConn.socket, {})!;
    createdIds.push(friend.id);
    friend.knownPeerIds.add(subjectId);

    const blockedConn = fakeSocketWithSpy(`u-${Math.random()}`);
    const blocked = joinP(blockedConn.socket, {})!;
    createdIds.push(blocked.id);
    blocked.knownPeerIds.add(subjectId);   // shares a conversation with the subject...
    blocked.blockedPeerIds.add(subjectId); // ...but there is a block between them

    friendConn.emitted.length = 0;
    blockedConn.emitted.length = 0;
    broadcastToKnownPeers(subjectId, { t: 'participant-updated' });

    assert.ok(friendConn.emitted.includes('participant-updated'));
    assert.equal(blockedConn.emitted.includes('participant-updated'), false);
  });

  test('always delivers to other tabs of the SAME account, even without knownPeerIds', () => {
    const userId = `u-${Math.random()}`;

    const tab1 = fakeSocketWithSpy(userId);
    const p1 = joinP(tab1.socket, {})!;
    createdIds.push(p1.id);

    // a genuine second tab (no resume — fresh id/token, a distinct
    // participant): nobody has their own userId in knownPeerIds (you're not
    // your own friend/conversation-member), but multi-tab delivery ignores that.
    const tab2 = fakeSocketWithSpy(userId);
    const p2 = joinP(tab2.socket, {})!;
    createdIds.push(p2.id);
    assert.notEqual(p2.id, p1.id);

    tab2.emitted.length = 0;
    broadcastToKnownPeers(userId, { t: 'participant-updated' });
    assert.ok(tab2.emitted.includes('participant-updated'));
  });
});
