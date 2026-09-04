import type { Socket } from 'socket.io';

export type Role = 'user' | 'admin';

/** Sessao resolvida (ver modules/auth/session.ts#resolveSession) — anexada
 * como socket.user no handshake e usada por toda rota HTTP autenticada. */
export interface SessionUser {
  tokenHash: string;
  userId: string;
  username: string;
  avatar: string;
  role: Role;
}

/** Participante da sala unica (ver realtime/participants.ts). `id` e por
 * CONEXAO (nao por conta) — ver a nota em participants.ts. `socket` e null
 * durante a janela de graca de reconexao. */
export interface Participant {
  id: string;
  token: string;
  userId: string;
  socket: AppSocket | null;
  name: string;
  avatar: string;
  role: Role;
  deafened: boolean;
  graceTimer: ReturnType<typeof setTimeout> | null;
}

/** Forma publica de um Participant — o que vai pro cliente (nunca `token`). */
export interface PublicParticipant {
  id: string;
  userId: string;
  name: string;
  avatar: string;
  role: Role;
  deafened: boolean;
}

/** O `Socket` do socket.io com os campos que ws.js/socket.ts anexa
 * dinamicamente na conexao: `participantId` (setado por join()), `ip`
 * (calculado uma vez na conexao) e `user` (a sessao resolvida no io.use()
 * antes de 'connection' disparar — nunca existe socket sem ela). */
export type AppSocket = Socket & {
  participantId: string | null;
  ip: string;
  user: SessionUser;
};

/** Assinatura de um handler de mensagem do Socket.IO — cada feature exporta
 * um `handlers: HandlerTable` (ver realtime/socket.ts, que junta todos via
 * Object.assign). `T` fica solto (`any` na tabela combinada) de proposito:
 * cada handler concreto usa o tipo de payload que ele espera de verdade, e
 * `any` no parametro do tipo-alvo faz o TypeScript aceitar isso sem
 * contornar a checagem de tipo DENTRO de cada handler. */
export type SocketHandler<T = unknown> = (socket: AppSocket, msg: T) => unknown | Promise<unknown>;
export type HandlerTable = Record<string, SocketHandler<any>>;
