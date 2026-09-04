import type { Participant } from '../types/protocol';

export interface Me {
  id: string | null; // por CONEXAO (= identity do LiveKit) — nao confundir com userId
  userId: string | null; // da CONTA — estavel entre abas/reconexoes
  name: string; // username da conta, imutavel
  avatar: string;
  role: 'user' | 'admin';
  sharing: boolean; // compartilhando tela
  cameraOn: boolean;
  // mic NAO mora aqui — "ativado"/"mudo" sao lidos direto do LiveKit (ver
  // useParticipantMedia em useLiveKitTrack.ts), a mesma fonte de verdade
  // usada pra participantes remotos. Sem isso duplicado, sem risco de
  // dessincronizar.
  sharingSince: number | null; // Date.now() de quando a tela comecou (pro "no ar" das estatisticas)
}

export interface RoomState {
  me: Me;
  participants: Map<string, Participant>; // nunca inclui "me"
  // key composta de tile (`${participantId}:${kind}`, ver useCallTiles.ts) —
  // nao e mais so o id do participante, porque tela/camera da mesma pessoa
  // agora podem ser focadas separadamente.
  focusedId: string | null;
  reconnecting: boolean;
  joined: boolean; // welcome ja recebido (habilita compartilhar)
  // erro em nivel de SALA (ex.: sala cheia) — identidade/login ja e coisa do
  // AuthContext, isso aqui e so o que pode dar errado DEPOIS de autenticado.
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
        // focusedId e uma tile key (`${id}:kind`) — compara por prefixo, nao
        // igualdade direta, pra desfocar tanto a tela quanto a camera dessa
        // pessoa se ela sair enquanto uma das duas estava em foco.
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
