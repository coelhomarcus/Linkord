import path from 'node:path';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { config } from '../config/env.js';
import { participants } from '../realtime/participants.js';
import { sendError } from './respond.js';
import { registerAuthRoutes } from '../modules/auth/routes.js';
import { registerAttachmentRoutes } from '../modules/attachments.js';
import { registerMediaRoutes } from '../modules/media.js';
import { registerLinkPreviewRoutes } from '../modules/link-preview/linkPreview.js';

// compilado, este arquivo vira server/dist/http/app.js, dai os tres '..' pra
// sair de dist/http ate a raiz do repo, e entrar em web/dist.
const PUBLIC_DIR = path.join(import.meta.dirname, '..', '..', '..', 'web', 'dist');
const ASSETS_DIR = path.join(PUBLIC_DIR, 'assets'); // nomes com hash do Vite: seguros pra cache longo

/** Cria a instancia do Fastify com todas as rotas registradas, mas SEM
 * chamar listen() — quem sobe o servidor (src/index.ts) precisa do
 * `fastify.server` (http.Server por baixo) pra anexar o Socket.IO antes de
 * escutar a porta de verdade. */
export function createApp(): FastifyInstance {
  const fastify = Fastify({ bodyLimit: config.MAX_BODY_BYTES });

  // erro nao tratado de qualquer rota vira JSON (nunca derruba o processo —
  // Fastify ja captura excecao sincrona e promise rejeitada de handler
  // async nativamente, sem precisar de try/catch por rota). Erros do
  // proprio Fastify (JSON invalido, corpo grande demais) tambem caem aqui,
  // so que com `.code` no formato FST_ERR_* em vez dos codigos proprios do
  // app — nada no frontend depende dos codigos antigos (invalid_json etc.),
  // entao aceitar os nativos do Fastify daqui pra frente e seguro.
  fastify.setErrorHandler((err: FastifyError, _request: FastifyRequest, reply: FastifyReply) => {
    const status = err.statusCode ?? 500;
    const code = err.code || 'internal_error';
    if (status >= 500) console.error('[http] erro numa rota:', err.stack ?? err);
    sendError(reply, status, code, err.message || 'Erro interno.');
  });

  fastify.get('/healthz', async () => ({ ok: true, participants: participants.size, uptime: process.uptime() }));

  registerAuthRoutes(fastify);
  registerAttachmentRoutes(fastify);
  registerMediaRoutes(fastify);
  registerLinkPreviewRoutes(fastify);

  // arquivos estaticos do build do frontend (web/dist) — wildcard:false pra
  // nao competir com o setNotFoundHandler abaixo pelo mesmo catch-all.
  fastify.register(fastifyStatic, {
    root: PUBLIC_DIR,
    wildcard: false,
    index: ['index.html'],
    setHeaders(reply, filePath) {
      const isHashedAsset = filePath.startsWith(ASSETS_DIR);
      const isHtml = path.extname(filePath) === '.html';
      reply.header('Cache-Control', isHashedAsset ? 'public, max-age=31536000, immutable' : isHtml ? 'no-cache' : 'public, max-age=3600');
      reply.header('X-Content-Type-Options', 'nosniff');
      // 'same-origin' fazia o navegador nao mandar Referer nenhum pro iframe
      // do YouTube — o player dele usa isso pra validar a origem do embed,
      // entao caia num "erro de configuracao do player" generico. Esse valor
      // ainda so revela a origem (nao a URL inteira) pra terceiros.
      reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    },
  });

  // qualquer GET sem match (e que nao seja /api/* nem /uploads/*) cai no
  // index.html — fallback de SPA, senao um refresh numa rota profunda do
  // frontend (roteamento client-side) voltaria 404 em vez da propria pagina.
  fastify.setNotFoundHandler((request, reply) => {
    if (request.method !== 'GET' || request.url.startsWith('/api/') || request.url.startsWith('/uploads/')) {
      return sendError(reply, 404, 'not_found', 'Rota nao encontrada.');
    }
    return reply.sendFile('index.html');
  });

  return fastify;
}
