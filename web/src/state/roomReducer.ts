import type { Participant } from '@/shared/types/protocol';

export interface Me {
  id: string | null;
  userId: string | null;
  name: string;
  displayName: string;
  avatar: string;
  avatarPoster: string;
  avatarColor: string;
  banner: string;
  bannerPoster: string;
  bio: string;
  profileLinks: string[];
  role: 'user' | 'admin';
  sharing: boolean;
  cameraOn: boolean;
  sharingSince: number | null;
}

export interface RoomState {
  me: Me;
  participants: Map<string, Participant>;
  focusedId: string | null;
  reconnecting: boolean;
  joined: boolean;
  roomError: string | null;
  // the server told this build it speaks an old protocol (client_outdated): only a reload fixes it
  clientOutdated: boolean;
  shareError: string | null;
  // why the mic isn't published, kept as state (not a one-off shareError) so
  // the call UI can keep saying so until a mic actually shows up
  micProblem: MicProblem;
  // a call that never started — shown next to that conversation's call
  // button, since the call UI (and its shareError notice) never opened
  callJoinError: { conversationId: string; message: string } | null;
}

// 'unavailable': a device exists but couldn't be started (in use by another
// app, driver error)
export type MicProblem = 'not-found' | 'denied' | 'unavailable' | null;

export const initialRoomState: RoomState = {
  me: {
    id: null, userId: null, name: '', displayName: '', avatar: '', avatarPoster: '', avatarColor: '',
    banner: '', bannerPoster: '', bio: '', profileLinks: [], role: 'user',
    sharing: false, cameraOn: false, sharingSince: null,
  },
  participants: new Map(),
  focusedId: null,
  reconnecting: false,
  joined: false,
  roomError: null,
  clientOutdated: false,
  shareError: null,
  micProblem: null,
  callJoinError: null,
};

export type RoomAction =
  | {
      type: 'WELCOME'; id: string; userId: string; name: string; displayName: string;
      avatar: string; avatarPoster: string; avatarColor: string; banner: string; bannerPoster: string; bio: string; profileLinks: string[];
      role: 'user' | 'admin'; participants: Participant[];
    }
  // replaces the whole map — the server re-scoped who this connection may see
  | { type: 'PARTICIPANTS_SYNC'; participants: Participant[] }
  | { type: 'PARTICIPANT_JOINED'; participant: Participant }
  | { type: 'PARTICIPANT_UPDATED'; participant: Participant }
  | { type: 'PARTICIPANT_LEFT'; id: string }
  | { type: 'SET_RECONNECTING'; value: boolean }
  | { type: 'SET_LOCAL_AVATAR'; avatar: string }
  | { type: 'SET_LOCAL_PROFILE'; avatar: string; avatarPoster: string; avatarColor: string; displayName: string; banner: string; bannerPoster: string; bio: string; profileLinks: string[] }
  | { type: 'SET_ROOM_ERROR'; message: string | null }
  | { type: 'SET_LOCAL_SHARING'; sharing: boolean }
  | { type: 'SET_ROLE'; role: 'user' | 'admin' }
  | { type: 'SET_CLIENT_OUTDATED' }
  | { type: 'SET_LOCAL_CAMERA'; on: boolean }
  | { type: 'SET_FOCUSED'; id: string | null }
  | { type: 'SET_SHARE_ERROR'; message: string | null }
  | { type: 'SET_MIC_PROBLEM'; problem: MicProblem }
  | { type: 'SET_CALL_JOIN_ERROR'; error: RoomState['callJoinError'] };

export function roomReducer(state: RoomState, action: RoomAction): RoomState {
  switch (action.type) {
    case 'WELCOME': {
      const participants = new Map<string, Participant>();
      for (const p of action.participants) participants.set(p.id, p);
      return {
        ...state,
        me: {
          ...state.me,
          id: action.id,
          userId: action.userId,
          name: action.name,
          displayName: action.displayName,
          avatar: action.avatar,
          avatarPoster: action.avatarPoster,
          avatarColor: action.avatarColor,
          banner: action.banner,
          bannerPoster: action.bannerPoster,
          bio: action.bio,
          profileLinks: action.profileLinks,
          role: action.role,
        },
        participants,
        reconnecting: false,
        joined: true,
        roomError: null,
      };
    }
    case 'PARTICIPANTS_SYNC': {
      const participants = new Map<string, Participant>();
      for (const p of action.participants) participants.set(p.id, p);
      const focusedOwner = state.focusedId?.split(':')[0];
      const stillThere = focusedOwner ? participants.has(focusedOwner) || focusedOwner === state.me.id : true;
      return { ...state, participants, focusedId: stillThere ? state.focusedId : null };
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
        focusedId: state.focusedId?.startsWith(`${action.id}:`) ? null : state.focusedId,
      };
    }
    case 'SET_RECONNECTING':
      return { ...state, reconnecting: action.value };
    case 'SET_LOCAL_AVATAR':
      return { ...state, me: { ...state.me, avatar: action.avatar } };
    case 'SET_LOCAL_PROFILE':
      return {
        ...state,
        me: {
          ...state.me,
          avatar: action.avatar,
          avatarPoster: action.avatarPoster,
          avatarColor: action.avatarColor,
          displayName: action.displayName,
          banner: action.banner,
          bannerPoster: action.bannerPoster,
          bio: action.bio,
          profileLinks: action.profileLinks,
        },
      };
    case 'SET_ROOM_ERROR':
      return { ...state, roomError: action.message };
    case 'SET_CLIENT_OUTDATED':
      return { ...state, clientOutdated: true };
    case 'SET_ROLE':
      return { ...state, me: { ...state.me, role: action.role } };
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
    case 'SET_MIC_PROBLEM':
      return { ...state, micProblem: action.problem };
    case 'SET_CALL_JOIN_ERROR':
      return { ...state, callJoinError: action.error };
    default:
      return state;
  }
}
