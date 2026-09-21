import { config } from '../config/env.js';
import { participants as participantsMap, broadcast } from '../modules/presence/participants.js';
import { createApp } from '../http/app.js';
import { createWsServer } from '../realtime/socket.js';
import { describeBlockedMigration, runMigrations } from '../db/migrate.js';
import { sweepExpiredSessions } from '../modules/auth/session.js';
import { ensureUploadDir, sweepStaleUploads } from '../modules/attachments/uploadSession.js';
import { sweepOrphans } from '../modules/attachments/orphanSweeper.js';
import { drainOutbox, pruneNotifications } from '../modules/notifications/outboxWorker.js';
import { OUTBOX_POLL_MS } from '../modules/notifications/notificationsPolicy.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ component: 'process' });

// backstop behind the try/catch in each handler in realtime/socket.ts —
// covers any async error escaping the normal message cycle (a timer, a
// stray promise) that would otherwise kill the process (Node exits on
// unhandledRejection/uncaughtException by default), disconnecting the room.
process.on('unhandledRejection', (err) => {
  log.error('unhandledRejection', err);
});
process.on('uncaughtException', (err) => {
  log.error('uncaughtException', err);
});

export async function bootstrap(): Promise<void> {
  // neither the Docker CMD nor systemd ExecStart go through an npm script —
  // without migrating here, nobody applies migrations in production. Fail
  // loud and exit: booting with a stale schema is worse than not booting
  // (systemd's Restart=always will keep retrying, visibly in the logs).
  if (config.MIGRATE_ON_BOOT) {
    try {
      await runMigrations();
      log.info('migrations up to date');
    } catch (err) {
      log.error(describeBlockedMigration(err) ?? 'failed to apply migrations', describeBlockedMigration(err) ? undefined : err);
      process.exit(1);
    }
  }

  // attachments folder (config.UPLOAD_DIR, usually a bind mount) — create
  // it if empty, otherwise the first upload would fail with ENOENT. Also
  // cleans up abandoned chunked-upload sessions (tab closed/browser crash
  // before the server's last shutdown).
  try {
    await ensureUploadDir();
    await sweepStaleUploads();
  } catch (err) {
    log.error('failed to prepare the uploads folder', err);
    process.exit(1);
  }

  const fastify = createApp();
  // fastify.server (the underlying http.Server) already exists once
  // Fastify() is called, before listen() — Socket.IO attaches to it the
  // same way it would to a plain http.Server, no change needed in
  // realtime/socket.ts.
  const io = createWsServer(fastify.server);

  await fastify.listen({ port: config.PORT, host: config.HOST_BIND });
  log.info('listening', { host: config.HOST_BIND, port: config.PORT });
  if (!config.LIVEKIT_URL || !config.LIVEKIT_API_KEY || !config.LIVEKIT_API_SECRET) {
    log.warn('LiveKit is not configured: calls, camera and screen sharing will fail');
  }

  // periodic cleanup of expired sessions — doesn't need to run per
  // request, just enough to keep the table from growing forever.
  const sessionSweepTimer = setInterval(() => {
    sweepExpiredSessions().catch((err) => log.error('failed to clean up expired sessions', err));
  }, 60 * 60 * 1000);
  sessionSweepTimer.unref();

  // same cadence — upload session TTL is 24h (config.UPLOAD_SESSION_TTL_MS),
  // checking hourly is enough to avoid orphaned chunks piling up on disk.
  const uploadSweepTimer = setInterval(() => {
    sweepStaleUploads().catch((err) => log.error('failed to clean up abandoned uploads', err));
  }, 60 * 60 * 1000);
  uploadSweepTimer.unref();

  // Transactional outbox: drain the events written with each social change
  // (safety net for a lost live emit), and prune what no longer needs to live.
  const pumpOutbox = () => drainOutbox()
    .then((r) => { if (r.failed > 0) log.warn('outbox events failed to deliver', r); else if (r.processed > 0) log.debug('outbox drained', r); })
    .catch((err) => log.error('failed to drain', err));
  const outboxTimer = setInterval(pumpOutbox, OUTBOX_POLL_MS);
  outboxTimer.unref();
  const pruneTimer = setInterval(() => {
    pruneNotifications().catch((err) => log.error('failed to prune', err));
  }, 24 * 60 * 60 * 1000);
  pruneTimer.unref();

  // Files on disk with no row behind them (a failed unlink, a crash mid-commit).
  // The scheduled run only reports unless ORPHAN_SWEEP_DRY_RUN=0; an admin can
  // run a real one from /admin/system.
  const sweepOrphanFiles = () => sweepOrphans({ dryRun: config.ORPHAN_SWEEP_DRY_RUN, actor: null })
    .then((r) => { if (r.orphanCount > 0) log.info('orphan files found', { count: r.orphanCount, bytes: r.orphanBytes, dryRun: r.dryRun, deleted: r.deleted }); })
    .catch((err) => log.error('orphan sweep failed', err));
  setTimeout(sweepOrphanFiles, 60_000).unref();
  const orphanTimer = setInterval(sweepOrphanFiles, 24 * 60 * 60 * 1000);
  orphanTimer.unref();

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      log.info('shutting down', { signal: sig });
      broadcast({ t: 'server-restart' });
      for (const p of participantsMap.values()) { try { p.socket && p.socket.disconnect(true); } catch { /* socket already dying */ } }
      io.close();
      fastify.close().then(() => process.exit(0)).catch(() => process.exit(1));
      setTimeout(() => process.exit(0), 3000).unref();
    });
  }
}
