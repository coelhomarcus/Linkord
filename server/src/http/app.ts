import path from 'node:path';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCompress from '@fastify/compress';
import { config } from '../config/env.js';
import { participants } from '../modules/presence/participants.js';
import { sendError } from './respond.js';
import { originGuard } from './originGuard.js';
import { registerAuthRoutes } from '../modules/auth/routes.js';
import { registerAttachmentRoutes } from '../modules/attachments/attachments.js';
import { registerProfileRoutes } from '../modules/profile/profile.js';
import { registerMediaRoutes } from '../modules/attachments/media.js';
import { registerLinkPreviewRoutes } from '../modules/link-preview/linkPreview.js';
import { registerFriendshipRoutes } from '../modules/friendships/friendships.js';
import { registerBlockRoutes } from '../modules/blocks/blocks.js';
import { registerUserRoutes } from '../modules/users/usersRoutes.js';
import { registerInvitationRoutes } from '../modules/conversations/invitations.js';
import { registerNotificationRoutes } from '../modules/notifications/notificationsRoutes.js';
import { registerLimitsRoutes } from '../modules/limits/limitsRoutes.js';
import { registerReportRoutes } from '../modules/reports/reports.js';
import { registerAdminRoutes } from '../modules/admin/adminRoutes.js';
import { registerGroupMemberRoutes } from '../modules/conversations/groupMembers.js';

// compiled, this file becomes server/dist/http/app.js, hence the three
// '..' up to the repo root, then into web/dist.
const PUBLIC_DIR = path.join(import.meta.dirname, '..', '..', '..', 'web', 'dist');
const ASSETS_DIR = path.join(PUBLIC_DIR, 'assets'); // Vite's hashed filenames: safe for long caching

/** Creates the Fastify instance with all routes registered, but WITHOUT
 * calling listen() — whoever boots the server (src/index.ts) needs
 * `fastify.server` (the underlying http.Server) to attach Socket.IO before
 * actually listening. */
export function createApp(): FastifyInstance {
  const fastify = Fastify({ bodyLimit: config.MAX_BODY_BYTES });

  // any unhandled route error becomes JSON (never crashes the process —
  // Fastify already catches sync exceptions and rejected promises from
  // async handlers natively, no per-route try/catch needed). Fastify's own
  // errors (invalid JSON, body too large) land here too, just with `.code`
  // in FST_ERR_* format instead of the app's own codes — nothing in the
  // frontend depends on the old codes (invalid_json etc.), so accepting
  // Fastify's native ones going forward is safe.
  fastify.setErrorHandler((err: FastifyError, _request: FastifyRequest, reply: FastifyReply) => {
    const status = err.statusCode ?? 500;
    const code = err.code || 'internal_error';
    if (status >= 500) console.error('[http] error in a route:', err.stack ?? err);
    sendError(reply, status, code, err.message || 'Erro interno.');
  });

  // Registered once, applies fastify-wide (it self-wraps with fastify-plugin,
  // same as @fastify/static below — nesting it wouldn't actually scope it).
  // Safe for the attachment range-request streaming in serveUpload: it
  // skips 206/Content-Range responses and non-compressible mimes
  // (video/audio/image) on its own — this is really here for the self-
  // hosted emoji dataset (public/emoji-data, ~770KB of JSON) and other
  // static/JSON responses, which previously relied on a CDN's own gzip.
  fastify.register(fastifyCompress);

  fastify.addHook('onRequest', originGuard);

  fastify.get('/healthz', async () => ({ ok: true, participants: participants.size, uptime: process.uptime() }));

  registerAuthRoutes(fastify);
  registerAttachmentRoutes(fastify);
  registerProfileRoutes(fastify);
  registerMediaRoutes(fastify);
  registerLinkPreviewRoutes(fastify);
  registerFriendshipRoutes(fastify);
  registerBlockRoutes(fastify);
  registerUserRoutes(fastify);
  registerInvitationRoutes(fastify);
  registerGroupMemberRoutes(fastify);
  registerReportRoutes(fastify);
  registerLimitsRoutes(fastify);
  registerNotificationRoutes(fastify);
  registerAdminRoutes(fastify);

  // static files from the frontend build (web/dist) — wildcard:false so it
  // doesn't compete with setNotFoundHandler below for the same catch-all.
  fastify.register(fastifyStatic, {
    root: PUBLIC_DIR,
    wildcard: false,
    index: ['index.html'],
    setHeaders(reply, filePath) {
      const isHashedAsset = filePath.startsWith(ASSETS_DIR);
      const isHtml = path.extname(filePath) === '.html';
      reply.header('Cache-Control', isHashedAsset ? 'public, max-age=31536000, immutable' : isHtml ? 'no-cache' : 'public, max-age=3600');
      reply.header('X-Content-Type-Options', 'nosniff');
      // 'same-origin' made the browser send no Referer to the YouTube
      // iframe — its player uses that to validate the embed's origin, so
      // it fell back to a generic "player configuration error". This value
      // still only reveals the origin (not the full URL) to third parties.
      reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    },
  });

  // any unmatched GET (that isn't /api/* or /uploads/*) falls through to
  // index.html — SPA fallback, otherwise a hard refresh on a deep frontend
  // route (client-side routing) would 404 instead of loading the page.
  fastify.setNotFoundHandler((request, reply) => {
    if (request.method !== 'GET' || request.url.startsWith('/api/') || request.url.startsWith('/uploads/')) {
      return sendError(reply, 404, 'not_found', 'Rota não encontrada.');
    }
    return reply.sendFile('index.html');
  });

  return fastify;
}
