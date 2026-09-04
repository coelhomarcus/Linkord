import type { Participant } from '../types/protocol';

export interface Me {
  id: string | null; // per CONNECTION (= LiveKit identity) — not the same as userId
  userId: string | null; // per ACCOUNT — stable across tabs/reconnects
  name: string;
  avatar: string;
  role: 'user' | 'admin';
  sharing: boolean;
  cameraOn: boolean;
  // mic does NOT live here — "activated"/"muted" are read straight from
  // LiveKit (see useParticipantMedia in useLiveKitTrack.ts), the same
  // source of truth used for remote participants. No duplication, no risk
  // of drift.
  sharingSince: number | null; // Date.now() when screen share started
}

export interface RoomState {
  me: Me;
  participants: Map<string, Participant>; // never includes "me"
  // composite tile key (`${participantId}:${kind}`, see useCallTiles.ts) —
  // no longer just the participant id, since one person's screen and
  // camera can now be focused independently.
  focusedId: string | null;
  reconnecting: boolean;
  joined: boolean; // welcome already received (enables sharing)
  // ROOM-level error (e.g. room full) — identity/login is AuthContext's
  // job; this is only what can go wrong AFTER authenticating.
  roomError: string | null;
  shareError: string | null;
}

export const initialRoomState: RoomState = {
  me: { id: null, userId: null, name: '', avatar: '', role: 'user', sharing: false, cameraOn: false, sharingSince: null },
  participants: new Map(),
  focusedId: null,
  reconnecting: false,
  joined: false,
  roomError: null,
  shareError: null,
};

export type RoomAction =
  | { type: 'WELCOME'; id: string; userId: string; name: string; avatar: string; role: 'user' | 'admin'; participants: Participant[] }
  | { type: 'PARTICIPANT_JOINED'; participant: Participant }
  | { type: 'PARTICIPANT_UPDATED'; participant: Participant }
  | { type: 'PARTICIPANT_LEFT'; id: string }
  | { type: 'SET_RECONNECTING'; value: boolean }
  | { type: 'SET_LOCAL_AVATAR'; avatar: string }
  | { type: 'SET_ROOM_ERROR'; message: string | null }
  | { type: 'SET_LOCAL_SHARING'; sharing: boolean }
  | { type: 'SET_LOCAL_CAMERA'; on: boolean }
  | { type: 'SET_FOCUSED'; id: string | null }
  | { type: 'SET_SHARE_ERROR'; message: string | null };

export function roomReducer(state: RoomState, action: RoomAction): RoomState {
  switch (action.type) {
    case 'WELCOME': {
      const participants = new Map<string, Participant>();
      for (const p of action.participants) participants.set(p.id, p);
      return {
        ...state,
        me: { ...state.me, id: action.id, userId: action.userId, name: action.name, avatar: action.avatar, role: action.role },
        participants,
        reconnecting: false,
        joined: true,
        roomError: null,
      };
    }
    case 'PARTICIPANT_JOINED': {
      const participants = new Map(state.participants);
      participants.set(action.participant.id, action.participant);
      return { ...state, participants };
    }
    case 'PARTICIPANT_UPDATED': {
      if (!state.participants.has(action.participant.id)) return state;
      const participants = new Map(state.participants);
      participants.set(action.participant.id, action.participant);
      return { ...state, participants };
    }
    case 'PARTICIPANT_LEFT': {
      if (!state.participants.has(action.id)) return state;
      const participants = new Map(state.participants);
      participants.delete(action.id);
      return {
        ...state,
        participants,
        // focusedId is a tile key (`${id}:kind`) — compares by prefix, not
        // direct equality, to unfocus both that person's screen and camera
        // if they leave while either was focused.
        focusedId: state.focusedId?.startsWith(`${action.id}:`) ? null : state.focusedId,
      };
    }
    case 'SET_RECONNECTING':
      return { ...state, reconnecting: action.value };
    case 'SET_LOCAL_AVATAR':
      return { ...state, me: { ...state.me, avatar: action.avatar } };
    case 'SET_ROOM_ERROR':
      return { ...state, roomError: action.message };
    case 'SET_LOCAL_SHARING':
      return {
        ...state,
        me: {
          ...state.me,
          sharing: action.sharing,
          sharingSince: action.sharing ? (state.me.sharingSince ?? Date.now()) : null,
        },
      };
    case 'SET_LOCAL_CAMERA':
      return { ...state, me: { ...state.me, cameraOn: action.on } };
    case 'SET_FOCUSED':
      return { ...state, focusedId: action.id };
    case 'SET_SHARE_ERROR':
      return { ...state, shareError: action.message };
    default:
      return state;
  }
}
