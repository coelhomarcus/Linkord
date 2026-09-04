import crypto from 'node:crypto';
import { config } from '../config/env.js';
import { updateAvatar } from '../modules/auth/users.js';
import type { AppSocket, HandlerTable, Participant, PublicParticipant } from '../types.js';

// ---------------------------------------------------------------------------
// Presenca: quem esta na sala unica e compartilhada (sem geracao de link).
// broadcast/send moram aqui (nao num util.ts separado) porque broadcast
// depende diretamente do registro de participantes pra saber pra quem mandar.
//
// Identidade vem do socket.user (resolvido pelo io.use em realtime/socket.ts
// a partir do cookie de sessao) — o cliente nunca mais afirma name/avatar no
// join. `id` continua sendo POR CONEXAO (nao por conta): e a chave usada
// pelo LiveKit como identity, e se virasse por-conta, a segunda aba do mesmo
// usuario receberia a mesma identity e o LiveKit expulsaria a primeira.
// `userId` (da conta) e o que amarra reconexao e permite duas abas da mesma
// pessoa sem uma achar a outra.
// ---------------------------------------------------------------------------
export const participants = new Map<string, Participant>(); // id -> participant

const newId = () => crypto.randomBytes(8).toString('hex');
const newToken = () => crypto.randomBytes(24).toString('hex');

// URL externa (https://...) OU um upload nosso (/uploads/<id>, ver
// modules/attachments.ts#handleAvatarUpload) — as duas formas validas de
// foto de perfil.
const UPLOADED_AVATAR_RE = /^\/uploads\/[0-9a-f]{32}$/;
function sanitizeAvatar(url: unknown): string {
  const s = String(url == null ? '' : url).trim().slice(0, config.MAX_AVATAR_LEN);
  return /^https?:\/\/\S+$/i.test(s) || UPLOADED_AVATAR_RE.test(s) ? s : '';
}

export function publicParticipant(p: Participant): PublicParticipant {
  return { id: p.id, userId: p.userId, name: p.name, avatar: p.avatar, role: p.role, deafened: p.deafened };
}

/** Endereco de quem conectou — usado so em log. Mora aqui (nao num util.ts
 * separado) pelo mesmo motivo de send/broadcast: e chamado a partir de
 * realtime/socket.ts logo na conexao, antes de haver participante. */
export function ipOf(socket: AppSocket): string {
  if (config.TRUST_PROXY) {
    const fwd = socket.handshake.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0]!.trim();
  }
  return socket.handshake.address || '?';
}

export function send(socket: AppSocket | null | undefined, obj: { t: string; [key: string]: unknown }): void {
  if (socket && socket.connected) {
    try { socket.emit(obj.t, obj); } catch { /* socket morrendo */ }
  }
}

export function broadcast(obj: { t: string; [key: string]: unknown }, exceptId?: string): void {
  for (const p of participants.values()) {
    if (p.id === exceptId) continue;
    if (p.socket && p.socket.connected) { try { p.socket.emit(obj.t, obj); } catch { /* socket morrendo */ } }
  }
}

/** true se ALGUMA conexao dessa conta esta com socket vivo agora — usado
 * pro diretorio de usuarios (online/offline). Varredura simples do Map (sem
 * contador a parte): a sala e pequena, entao o custo e irrelevante. */
export function isUserOnline(userId: string): boolean {
  for (const p of participants.values()) {
    if (p.userId === userId && p.socket) return true;
  }
  return false;
}

/** Snapshot pro `welcome` — lista de userIds distintos com socket vivo agora
 * (nao inclui quem esta so na janela de graca, ver isUserOnline). */
export function listOnlineUserIds(): string[] {
  const ids = new Set<string>();
  for (const p of participants.values()) if (p.socket) ids.add(p.userId);
  return [...ids];
}

export function removeParticipant(p: Participant): void {
  if (participants.get(p.id) !== p) return; // ja foi substituido por uma reconexao
  if (p.graceTimer) clearTimeout(p.graceTimer);
  participants.delete(p.id);
  broadcast({ t: 'participant-left', id: p.id });
  // so agora (nao em handleClose) pra respeitar a mesma janela de graca que
  // ja vale pra 'participant-left' — uma queda de rede curta nao pisca
  // offline no diretorio, igual nao pisca "saiu" no resto da sala.
  if (!isUserOnline(p.userId)) broadcast({ t: 'user-offline', userId: p.userId });
}

/** Remove fantasmas da MESMA conta (participantes com socket=null presos na
 * janela de graca de RECONNECT_GRACE_MS) antes de criar uma conexao nova.
 * Sem isso, uma aba que travou/fechou sem 'pagehide' deixa um fantasma
 * segurando o lock da chamada por ate 30s, e uma aba NOVA do mesmo usuario
 * levaria call-busy do proprio fantasma. */
function evictGhostsForUser(userId: string): void {
  for (const p of [...participants.values()]) {
    if (p.userId === userId && p.socket === null) removeParticipant(p);
  }
}

interface JoinMessage {
  id?: string;
  token?: string;
}

/** Cria/acha o participante da conexao (reconecta na mesma identidade se
 * tiver token valido da MESMA conta) e seta socket.participantId. So devolve
 * o participante — quem monta e manda o `welcome` e o realtime/socket.ts,
 * que enxerga chat/board tambem (join fica sem depender de outras features,
 * pra nao formar ciclo). Manda o erro de sala cheia e devolve null quando
 * aplicavel. */
export function join(socket: AppSocket, msg: JoinMessage): Participant | null {
  if (socket.participantId) return null;
  const u = socket.user; // garantido pelo io.use — nunca ha socket sem sessao valida
  // calculado ANTES de mexer no Map — se essa e a unica conexao dessa conta
  // (nova ou retomando de uma janela de graca sem outra aba viva), e uma
  // transicao pra "online" que o diretorio de usuarios precisa saber.
  const wasOnline = isUserOnline(u.userId);
  let p: Participant | null = null;
  if (msg.id && msg.token) {
    const existing = participants.get(String(msg.id));
    // o check de userId e o que impede um token de resume de OUTRA conta ser
    // reaproveitado — antes so o token cru (comparado com ===, nao
    // timing-safe: e um segredo aleatorio de 24 bytes por conexao, nao uma
    // senha) decidia isso sozinho.
    if (existing && existing.token === String(msg.token) && existing.userId === u.userId) p = existing;
  }
  if (p) {
    if (p.socket && p.socket !== socket) { try { p.socket.disconnect(true); } catch { /* ja desconectado */ } }
    if (p.graceTimer) clearTimeout(p.graceTimer);
    p.graceTimer = null;
    p.socket = socket;
  } else {
    if (participants.size >= config.MAX_PARTICIPANTS) {
      send(socket, { t: 'error', code: 'full', message: 'Sala cheia, tente mais tarde.' });
      return null;
    }
    evictGhostsForUser(u.userId);
    p = {
      id: newId(),
      token: newToken(),
      userId: u.userId,
      socket,
      name: u.username,
      avatar: sanitizeAvatar(u.avatar),
      role: u.role,
      // sempre comeca desensurdecido numa conexao NOVA (aba/reload de
      // verdade) — o proprio cliente tambem comeca com esse estado zerado
      // (useState local, nao persistido). Um resume (rede caiu e voltou,
      // mesma aba) reusa o `p` existente e PRESERVA o valor, ver join() acima.
      deafened: false,
      graceTimer: null,
    };
    participants.set(p.id, p);
  }
  socket.participantId = p.id;
  if (!wasOnline) broadcast({ t: 'user-online', userId: u.userId });
  return p;
}

/** So o avatar e editavel em sessao — o nome agora e o username da conta,
 * imutavel. Persiste no banco pra sobreviver a reconexao/outra aba (a sessao
 * em cache pode levar ate 60s pra refletir isso numa aba que AINDA NAO
 * conectou, ver modules/auth/session.ts — a aba que editou ja atualiza na
 * hora via participant-updated abaixo). */
function handleProfile(socket: AppSocket, msg: { avatar?: string }): void {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const oldAvatar = p.avatar;
  p.avatar = sanitizeAvatar(msg.avatar);
  broadcast({ t: 'participant-updated', participant: publicParticipant(p) });
  updateAvatar(p.userId, p.avatar).catch((err) => console.error(`[${p.id}] falha ao salvar avatar:`, err instanceof Error ? err.stack : err));
  // apaga o ARQUIVO da foto antiga se ela era um upload nosso e mudou pra
  // outra coisa — sem isso, cada troca de foto deixaria a anterior orfa no
  // disco pra sempre (so uma foto por conta de cada vez). import() dinamico
  // (nao no topo do arquivo) so pra quebrar o ciclo — modules/attachments.ts
  // ja importa `participants`/`broadcast` DESTE arquivo, um import estatico
  // no topo aqui criaria um ciclo (mesmo padrao usado em
  // modules/channels.ts#handleChannelDelete).
  if (oldAvatar && oldAvatar !== p.avatar) {
    import('../modules/attachments.js')
      .then(({ deleteAvatarFile }) => deleteAvatarFile(oldAvatar))
      .catch((err) => console.error(`[${p.id}] falha ao apagar foto de perfil antiga:`, err instanceof Error ? err.stack : err));
  }
}

/** "Ensurdecer" nao tem equivalente de track no LiveKit (diferente de
 * mic-mudo) — e so um flag que o proprio cliente anuncia, pra quem mais
 * puder mostrar o icone (sidebar, tile em foco), igual o Discord mostra
 * nos outros participantes da call. */
function handleDeafened(socket: AppSocket, msg: { value?: unknown }): void {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  p.deafened = !!msg.value;
  broadcast({ t: 'participant-updated', participant: publicParticipant(p) });
}

// ---- aba fechando/recarregando: sai da sala na hora, sem esperar a janela
// de reconexao (essa so deveria valer pra queda de rede/crash, onde esse
// evento nao chega a disparar) -----------------------------------------
function handleLeave(socket: AppSocket): void {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  removeParticipant(p);
}

/** socket.on('disconnect'): abre a janela de reconexao (RECONNECT_GRACE_MS)
 * em vez de remover na hora — cobre queda de rede/reload, onde 'leave' nao
 * chega a disparar. */
export function handleClose(socket: AppSocket): void {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return; // ja foi substituido por uma reconexao mais nova
  p.socket = null;
  p.graceTimer = setTimeout(() => removeParticipant(p), config.RECONNECT_GRACE_MS);
}

export const handlers: HandlerTable = {
  profile: handleProfile,
  deafened: handleDeafened,
  leave: handleLeave,
};
