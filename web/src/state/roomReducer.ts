import type { Participant } from '../types/protocol';

export interface Me {
  id: string | null;
  userId: string | null;
  name: string;
  displayName: string;
  avatar: string;
  avatarColor: string;
  banner: string;
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
  shareError: string | null;
}

export const initialRoomState: RoomState = {
  me: {
    id: null, userId: null, name: '', displayName: '', avatar: '', avatarColor: '',
    banner: '', bio: '', profileLinks: [], role: 'user', sharing: false, cameraOn: false, sharingSince: null,
  },
  participants: new Map(),
  focusedId: null,
  reconnecting: false,
  joined: false,
  roomError: null,
  shareError: null,
};

export type RoomAction =
  | {
      type: 'WELCOME'; id: string; userId: string; name: string; displayName: string;
      avatar: string; avatarColor: string; banner: string; bio: string; profileLinks: string[];
      role: 'user' | 'admin'; participants: Participant[];
    }
  | { type: 'PARTICIPANT_JOINED'; participant: Participant }
  | { type: 'PARTICIPANT_UPDATED'; participant: Participant }
  | { type: 'PARTICIPANT_LEFT'; id: string }
  | { type: 'SET_RECONNECTING'; value: boolean }
  | { type: 'SET_LOCAL_AVATAR'; avatar: string }
  | { type: 'SET_LOCAL_PROFILE'; avatar: string; avatarColor: string; displayName: string; banner: string; bio: string; profileLinks: string[] }
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
        me: {
          ...state.me,
          id: action.id,
          userId: action.userId,
          name: action.name,
          displayName: action.displayName,
          avatar: action.avatar,
          avatarColor: action.avatarColor,
          banner: action.banner,
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
          avatarColor: action.avatarColor,
          displayName: action.displayName,
          banner: action.banner,
          bio: action.bio,
          profileLinks: action.profileLinks,
        },
      };
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
