import { config } from '../config/env.js';
import { participants as participantsMap, broadcast } from '../modules/presence/participants.js';
import { createApp } from '../http/app.js';
import { createWsServer } from '../realtime/socket.js';
import { runMigrations } from '../db/migrate.js';
import { sweepExpiredSessions } from '../modules/auth/session.js';
import { ensureUploadDir, sweepStaleUploads } from '../modules/attachments/uploadSession.js';
import { sweepExpiredInvitations } from '../modules/conversations/invitationsRepository.js';
import { sweepOrphans } from '../modules/attachments/orphanSweeper.js';
import { drainOutbox, pruneNotifications } from '../modules/notifications/outboxWorker.js';
import { OUTBOX_POLL_MS } from '../modules/notifications/notificationsPolicy.js';

// backstop behind the try/catch in each handler in realtime/socket.ts —
// covers any async error escaping the normal message cycle (a timer, a
// stray promise) that would otherwise kill the process (Node exits on
// unhandledRejection/uncaughtException by default), disconnecting the room.
process.on('unhandledRejection', (err) => {
  console.error('[process] unhandledRejection:', err instanceof Error ? err.stack : err);
});
process.on('uncaughtException', (err) => {
  console.error('[process] uncaughtException:', err instanceof Error ? err.stack : err);
});

export async function bootstrap(): Promise<void> {
  // neither the Docker CMD nor systemd ExecStart go through an npm script —
  // without migrating here, nobody applies migrations in production. Fail
  // loud and exit: booting with a stale schema is worse than not booting
  // (systemd's Restart=always will keep retrying, visibly in the logs).
  if (config.MIGRATE_ON_BOOT) {
    try {
      await runMigrations();
      console.log('[db] migrations up to date.');
    } catch (err) {
      console.error('[db] failed to apply migrations:', err instanceof Error ? err.stack : err);
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
    console.error('[attachments] failed to prepare the uploads folder:', err instanceof Error ? err.stack : err);
    process.exit(1);
  }

  const fastify = createApp();
  // fastify.server (the underlying http.Server) already exists once
  // Fastify() is called, before listen() — Socket.IO attaches to it the
  // same way it would to a plain http.Server, no change needed in
  // realtime/socket.ts.
  const io = createWsServer(fastify.server);

  await fastify.listen({ port: config.PORT, host: config.HOST_BIND });
  console.log(`Linkord listening on http://${config.HOST_BIND}:${config.PORT}`);
  console.log('Single room, any participant can share. Camera/screen via WebRTC (LiveKit).');
  if (!config.LIVEKIT_URL || !config.LIVEKIT_API_KEY || !config.LIVEKIT_API_SECRET) {
    console.warn('Warning: LIVEKIT_URL/LIVEKIT_API_KEY/LIVEKIT_API_SECRET not configured — screen/camera sharing will fail.');
  }

  // periodic cleanup of expired sessions — doesn't need to run per
  // request, just enough to keep the table from growing forever.
  const sessionSweepTimer = setInterval(() => {
    sweepExpiredSessions().catch((err) => console.error('[auth] failed to clean up expired sessions:', err instanceof Error ? err.stack : err));
  }, 60 * 60 * 1000);
  sessionSweepTimer.unref();

  // same cadence — upload session TTL is 24h (config.UPLOAD_SESSION_TTL_MS),
  // checking hourly is enough to avoid orphaned chunks piling up on disk.
  const uploadSweepTimer = setInterval(() => {
    sweepStaleUploads().catch((err) => console.error('[attachments] failed to clean up abandoned uploads:', err instanceof Error ? err.stack : err));
  }, 60 * 60 * 1000);
  uploadSweepTimer.unref();

  // Pending invitations past their deadline already READ as expired
  // (effectiveStatus); this persists it and updates the cards on screen.
  // Once now, then every 5 minutes — short, because a card that outlives its
  // deadline for long looks broken to whoever is watching it.
  const sweepInvitations = () => sweepExpiredInvitations()
    .catch((err) => console.error('[invitations] failed to expire old invitations:', err instanceof Error ? err.stack : err));
  void sweepInvitations();
  const invitationSweepTimer = setInterval(sweepInvitations, 5 * 60 * 1000);
  invitationSweepTimer.unref();

  // Transactional outbox: drain the events written with each social change
  // (safety net for a lost live emit), and prune what no longer needs to live.
  const pumpOutbox = () => drainOutbox()
    .catch((err) => console.error('[outbox] failed to drain:', err instanceof Error ? err.stack : err));
  const outboxTimer = setInterval(pumpOutbox, OUTBOX_POLL_MS);
  outboxTimer.unref();
  const pruneTimer = setInterval(() => {
    pruneNotifications().catch((err) => console.error('[notifications] failed to prune:', err instanceof Error ? err.stack : err));
  }, 24 * 60 * 60 * 1000);
  pruneTimer.unref();

  // Files on disk with no row behind them (a failed unlink, a crash mid-commit).
  // The scheduled run only reports unless ORPHAN_SWEEP_DRY_RUN=0; an admin can
  // run a real one from /admin/system.
  const sweepOrphanFiles = () => sweepOrphans({ dryRun: config.ORPHAN_SWEEP_DRY_RUN, actor: null })
    .then((r) => { if (r.orphanCount > 0) console.log(`[storage] orphan files: ${r.orphanCount} (${r.orphanBytes} bytes)${r.dryRun ? ' — report only' : `, deleted ${r.deleted}`}`); })
    .catch((err) => console.error('[storage] orphan sweep failed:', err instanceof Error ? err.stack : err));
  setTimeout(sweepOrphanFiles, 60_000).unref();
  const orphanTimer = setInterval(sweepOrphanFiles, 24 * 60 * 60 * 1000);
  orphanTimer.unref();

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      console.log(`\n${sig} received, shutting down...`);
      broadcast({ t: 'server-restart' });
      for (const p of participantsMap.values()) { try { p.socket && p.socket.disconnect(true); } catch { /* socket already dying */ } }
      io.close();
      fastify.close().then(() => process.exit(0)).catch(() => process.exit(1));
      setTimeout(() => process.exit(0), 3000).unref();
    });
  }
}
