import { pgTable, text, varchar, timestamp, integer, bigint, jsonb, serial, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Schema do banco (Drizzle).
// ---------------------------------------------------------------------------

/** Uma conta. `username` e o nome exibido (imutavel apos o registro) — nao ha
 * apelido separado, entao ele tambem e a chave de unicidade visivel na sala. */
export const users = pgTable('users', {
  // gerado pela app com crypto.randomUUID() em vez de gen_random_uuid() pra
  // nao depender da extensao pgcrypto estar instalada no banco.
  id: text('id').primaryKey(),
  username: varchar('username', { length: 20 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  avatar: text('avatar').notNull().default(''),
  role: varchar('role', { length: 16 }).notNull().default('user'), // 'user' | 'admin'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Unicidade CASE-INSENSITIVE: "Lune" e "lune" sao a mesma pessoa. Guardamos
  // a grafia escolhida na coluna e a unicidade vive num indice sobre
  // lower(username) — por isso toda busca por username precisa usar a MESMA
  // expressao (ver auth/users.ts), senao o Postgres nao usa esse indice.
  uniqueIndex('users_username_lower_key').on(sql`lower(${t.username})`),
]);

/** Sessao de login. A chave e o sha256 do valor que vai no cookie, nunca o
 * valor cru — um vazamento do banco entao nao vira sessao ativa reproduzivel. */
export const sessions = pgTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => [
  index('sessions_user_id_idx').on(t.userId),
]);

/** Categoria de canais de texto (estilo Discord) — so o admin cria/apaga.
 * `position` decide a ordem exibida; reordenar reindexed a lista inteira
 * (ver server/src/modules/channels.ts), nao usa indice fracionario. Apagar so
 * e permitido se estiver vazia (RESTRICT) — nao ha "o que fazer com os canais
 * orfaos" pra decidir, o admin apaga os canais primeiro. */
export const categories = pgTable('categories', {
  id: text('id').primaryKey(),
  name: varchar('name', { length: 60 }).notNull(),
  position: integer('position').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Um canal dentro de uma categoria — 'text' (chat, o admin cria/apaga
 * quantos quiser) ou 'voice' (a Chamada — sempre existe exatamente UM,
 * server/src/modules/channels.ts garante isso no boot; criar outro/apagar o
 * unico que existe fica pra depois, nao da pra fazer ainda). Apagar um canal
 * de texto e CASCADE nas mensagens dele (server/src/modules/chat.ts) — e
 * assim que "apagar o chat apaga tudo do banco pra sempre" funciona, sem
 * precisar apagar linha por linha. */
export const channels = pgTable('channels', {
  id: text('id').primaryKey(),
  categoryId: text('category_id').notNull().references(() => categories.id, { onDelete: 'restrict' }),
  name: varchar('name', { length: 60 }).notNull(),
  type: varchar('type', { length: 10 }).notNull().default('text'), // 'text' | 'voice'
  position: integer('position').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('channels_category_id_idx').on(t.categoryId),
]);

/** Mensagem de chat, agora persistida (antes vivia so em memoria, perdida a
 * cada restart). `authorId` e SET NULL se a conta for apagada no futuro —
 * authorName/authorAvatar ficam congelados na propria linha (mesmo espirito
 * de "nome/avatar no momento do envio" que ja existia em memoria), entao o
 * historico continua legivel mesmo sem o autor mais existir. `replyTo` e
 * `reactions` guardam o mesmo formato congelado que o protocolo ja usava. */
export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  channelId: text('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
  authorName: varchar('author_name', { length: 20 }).notNull(),
  authorAvatar: text('author_avatar').notNull().default(''),
  text: text('text').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  editedAt: timestamp('edited_at', { withTimezone: true }),
  replyTo: jsonb('reply_to'),
  reactions: jsonb('reactions').notNull().default({}),
}, (t) => [
  index('messages_channel_id_idx').on(t.channelId),
]);

/** Um arquivo em disco (config.UPLOAD_DIR) — anexo de mensagem OU foto de
 * perfil, os dois reaproveitam a mesma tabela/pasta/rota de servir de volta
 * (server/src/modules/attachments.ts). `messageId` NULL e o que distingue
 * uma foto de perfil de um anexo de chat: nunca é preenchido depois, e é por
 * isso que `getUsage()` (cota de 10GB dos Ajustes) filtra so `messageId IS
 * NOT NULL` — fotos de perfil nao contam nesse limite (uma por conta, sempre
 * substituindo a anterior, ver deleteAvatarFile). `id` e um uuid gerado pela
 * app, reaproveitado como nome do arquivo em disco — o Postgres nao sabe
 * disso, entao apagar essa linha (direto ou via CASCADE de messages/channels)
 * NUNCA apaga o arquivo sozinho; isso e responsabilidade do codigo que apaga
 * a linha (ver deleteForMessage/deleteForChannel/deleteAvatarFile). */
export const attachments = pgTable('attachments', {
  id: text('id').primaryKey(),
  messageId: integer('message_id').references(() => messages.id, { onDelete: 'cascade' }),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  // bigint (nao integer): teto de anexo e 2GiB (config.MAX_ATTACHMENT_BYTES),
  // que estoura um int4 do Postgres (max 2.147.483.647) por 1 byte. mode:
  // 'number' e seguro aqui — tamanho real de arquivo nunca chega perto de
  // Number.MAX_SAFE_INTEGER.
  size: bigint('size', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('attachments_message_id_idx').on(t.messageId),
]);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
