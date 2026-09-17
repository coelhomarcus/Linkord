import type { FastifyInstance } from 'fastify';
import { config } from '../../config/env.js';
import { handleAvatarUpload } from './avatarUpload.js';

export function registerProfileRoutes(fastify: FastifyInstance): void {
  // raw Buffer body, not JSON — scoped plugin so a wildcard/JSON override
  // here doesn't affect any other /api/* route.
  fastify.register(async (scoped) => {
    scoped.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));
    // Fastify's own built-in default parser for the EXACT type
    // 'application/json' takes precedence over a wildcard parser, even one
    // registered in a child scope — so /api/avatar's `{ url }` JSON body (see
    // avatarUpload.ts, the "usar URL" flow) was arriving already parsed into
    // an object, and that handler's `(request.body as Buffer).toString('utf8')`
    // was silently producing "[object Object]" instead of the real JSON,
    // always failing with 'invalid_body'. Registering 'application/json'
    // explicitly (not just '*') here overrides the built-in default within
    // this scope only — nothing else needs it, only this route accepts a
    // JSON body alongside raw image bytes.
    scoped.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));
    scoped.post('/api/avatar', { bodyLimit: config.MAX_AVATAR_BYTES }, handleAvatarUpload);
  });
}
