/**
 * Protocolo do WebSocket (canal /ws). Mantido manualmente em espelho a
 * server.js — o servidor continua em JS puro, sem geracao automatica.
 */

export interface Participant {
  id: string;
  // da CONTA (nao muda entre reconexoes/abas) — usado pra manter o diretorio
  // de usuarios (allUsers, PublicUser) sincronizado quando avatar/role mudam
  // em sessao, sem precisar recarregar a pagina pra ver o `welcome` de novo.
  userId: string;
  name: string; // username da conta — unico, imutavel
  avatar: string; // '' quando nao tem
  role: 'user' | 'admin';
  // "ensurdecido" (parou de ouvir todo mundo) — diferente de micMuted (que
  // vem do LiveKit): isso nao tem equivalente de track, e so um flag que o
  // proprio cliente anuncia (ver ClientMessage 'deafened') pra quem mais
  // puder mostrar o icone, igual o Discord mostra nos outros da call.
  deafened: boolean;
}

// Lista curta e fixa — evita aceitar texto arbitrario como "reacao".
export const ALLOWED_REACTIONS = ['👍', '❤️', '😂', '😮', '👏', '🎉'] as const;
export type ReactionEmoji = (typeof ALLOWED_REACTIONS)[number];

// Referencia congelada da mensagem original no momento da resposta (nome +
// preview do texto) — igual ao nome/avatar da propria ChatMessage, nao
// depende da original continuar existindo depois.
export interface ChatReplyRef {
  msgId: number;
  name: string;
  text: string;
}

// Chat de texto, agora POR CANAL e persistido no banco (antes era um unico
// chat em memoria) — nome/avatar vao junto na mensagem pra ficarem
// congelados no momento do envio, mesmo que a pessoa edite o perfil ou saia
// depois. `id` aqui e o USERID da conta (nao o id de conexao) — sobrevive a
// reconexao/reload, ja que a mensagem em si tambem sobrevive agora.
export interface ChatMessage {
  msgId: number;
  channelId: string;
  // null quando a CONTA de quem mandou foi apagada (ver server/moderation.js
  // — messages.author_id vira NULL, ON DELETE SET NULL). name/avatar acima
  // continuam validos (congelados na propria linha desde o envio); so a
  // referencia a conta em si deixa de existir. Todo consumidor que compara
  // contra state.me.userId ja funciona sozinho com null (nunca "e minha"),
  // mas quem usa `id` como semente de cor (Avatar/colorFor) precisa de um
  // fallback pra nao passar null adiante — ver ChatMessageList.
  id: string | null;
  name: string;
  avatar: string;
  text: string;
  ts: number;
  replyTo?: ChatReplyRef;
  editedAt?: number;
  // emoji -> userIds de quem reagiu com ele; chave some da lista quando o
  // ultimo reagiu de novo (toggle), nunca fica um array vazio guardado.
  reactions?: Partial<Record<ReactionEmoji, string[]>>;
  attachment?: ChatAttachment;
}

// Anexo no chat (imagem ou qualquer outro arquivo) — no maximo UM por
// mensagem, ver server/attachments.js. `id` tambem e o caminho de download/
// exibicao: `/uploads/${id}`.
export interface ChatAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
}
export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024 * 1024; // so pra UI, servidor revalida sempre
// foto de perfil — teto menor, mesma pasta/rota dos anexos (ver
// server/attachments.js#handleAvatarUpload). So pra UI, servidor revalida.
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export const AVATAR_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

export interface StorageUsage {
  totalBytes: number;
  totalFiles: number;
  maxBytes: number;
}

// Categorias/canais — 'text' (chat, o admin cria/apaga/reordena a vontade) ou
// 'voice' (a Chamada — sempre existe exatamente UM, servidor garante isso;
// criar outro/apagar o unico fica pro futuro). Quadro continua fixo, fora
// desse sistema (nao foi mencionado quando a Chamada entrou pra arvore).
export interface Channel {
  id: string;
  name: string;
  type: 'text' | 'voice';
}
export interface Category {
  id: string;
  name: string;
  channels: Channel[];
}

export interface PublicUser {
  id: string;
  username: string;
  avatar: string;
  role: 'user' | 'admin';
}

export type ClientMessage =
  // identidade vem da sessao (cookie) resolvida no handshake — id/token aqui
  // sao so o resume de RECONEXAO por aba (ver useIdentitySession.ts), nunca
  // afirmam quem a pessoa e.
  | { t: 'join'; id?: string; token?: string }
  // nome nao e mais editavel (e o username da conta, imutavel) — so avatar.
  | { t: 'profile'; avatar: string }
  | { t: 'reaction'; emoji: ReactionEmoji }
  | { t: 'deafened'; value: boolean }
  | { t: 'channel-open'; channelId: string }
  | { t: 'chat'; channelId: string; text: string; replyTo?: number }
  | { t: 'chat-delete'; msgId: number }
  | { t: 'chat-edit'; msgId: number; text: string }
  | { t: 'chat-react'; msgId: number; emoji: ReactionEmoji }
  // gerenciamento de categorias/canais — todos admin-only, servidor revalida
  // role sempre (nunca confia em botao escondido na UI).
  | { t: 'category-create'; name: string }
  | { t: 'category-delete'; categoryId: string }
  | { t: 'category-rename'; categoryId: string; name: string }
  | { t: 'channel-create'; categoryId: string; name: string }
  | { t: 'channel-delete'; channelId: string }
  | { t: 'channel-rename'; channelId: string; name: string }
  // apagar conta — aba Moderacao dos Ajustes, admin-only (servidor
  // revalida role sempre, mesmo padrao das mutacoes de canal acima).
  | { t: 'user-delete'; userId: string }
  | { t: 'categories-reorder'; orderedIds: string[] }
  // tambem cobre mover um canal pra OUTRA categoria: manda a lista final
  // inteira da categoria de destino (o canal movido entra nela).
  | { t: 'channels-reorder'; categoryId: string; orderedIds: string[] }
  // webhook do Discord (opcional, ver server/discordWebhook.js) — o cliente
  // reporta a PROPRIA acao (nunca em nome de outro participante), porque o
  // servidor nao tem visibilidade de quem esta na chamada/compartilhando
  // tela (isso vive so no LiveKit, ver useParticipantMedia.ts).
  | { t: 'call-event'; kind: 'joined' | 'screenshare' }
  | { t: 'leave' }
  | { t: 'ping' };

export type ServerMessage =
  | {
      t: 'welcome'; id: string; token: string;
      // identidade da conta (autoritativa — vem da sessao, nao do cliente)
      userId: string; name: string; avatar: string; role: 'user' | 'admin';
      maxParticipants: number; participants: Participant[];
      categories: Category[]; users: PublicUser[]; onlineUserIds: string[];
      storageUsage: StorageUsage;
      // credenciais pra conectar na Room unica do LiveKit (camera/tela) —
      // mesma identidade (id) do participante no Socket.IO. null quando o
      // servidor nao tem LIVEKIT_API_KEY/SECRET configurados — o resto da
      // sala (chat, quadro, presenca) continua funcionando sem video.
      livekitToken: string | null; livekitUrl: string; livekitRoomName: string;
    }
  | { t: 'participant-joined'; participant: Participant }
  | { t: 'participant-updated'; participant: Participant }
  | { t: 'participant-left'; id: string }
  | { t: 'reaction'; id: string; emoji: ReactionEmoji }
  | { t: 'channel-history'; channelId: string; messages: ChatMessage[] }
  | { t: 'chat'; message: ChatMessage }
  | { t: 'chat-deleted'; channelId: string; msgId: number }
  | { t: 'chat-edited'; message: ChatMessage }
  | { t: 'chat-reaction-updated'; channelId: string; msgId: number; emoji: ReactionEmoji; userIds: string[] }
  // arvore inteira fresca apos qualquer mutacao de categoria/canal — mais
  // simples e mais dificil de dessincronizar do que eventos incrementais,
  // a estrutura e pequena (so o admin mexe nela).
  | { t: 'channels-tree'; categories: Category[] }
  | { t: 'channel-deleted'; channelId: string }
  | { t: 'user-online'; userId: string }
  | { t: 'user-offline'; userId: string }
  | { t: 'user-registered'; user: PublicUser }
  | { t: 'user-deleted'; userId: string }
  | ({ t: 'storage-usage' } & StorageUsage)
  | { t: 'error'; code: string; message: string }
  | { t: 'pong' }
  | { t: 'server-restart' };
