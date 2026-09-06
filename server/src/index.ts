import { config } from './config/env.js';
import { participants as participantsMap, broadcast } from './realtime/participants.js';
import { createApp } from './http/app.js';
import { createWsServer } from './realtime/socket.js';
import { runMigrations } from './db/migrate.js';
import { sweepExpiredSessions } from './modules/auth/session.js';
import { ensureSeeded, ensureVoiceChannelExists } from './modules/channels.js';
import { ensureUploadDir, sweepStaleUploads } from './modules/attachments.js';

async function bootstrap(): Promise<void> {
  // neither the Docker CMD nor systemd ExecStart go through an npm script —
  // without migrating here, nobody applies migrations in production. Fail
  // loud and exit: booting with a stale schema is worse than not booting
  // (systemd's Restart=always will keep retrying, visibly in the logs).
  if (config.MIGRATE_ON_BOOT) {
    try {
      await runMigrations();
      console.log('[db] migrations em dia.');
    } catch (err) {
      console.error('[db] falha ao aplicar migrations:', err instanceof Error ? err.stack : err);
      process.exit(1);
    }
  }

  // default category+channel ("General"/"general") the first time the DB
  // is empty — covers both a fresh install and upgrading from the old
  // single in-memory chat.
  try {
    await ensureSeeded();
    await ensureVoiceChannelExists();
  } catch (err) {
    console.error('[channels] falha ao semear categoria/canal padrao:', err instanceof Error ? err.stack : err);
    process.exit(1);
  }

  // attachments folder (config.UPLOAD_DIR, usually a bind mount) — create
  // it if empty, otherwise the first upload would fail with ENOENT. Also
  // cleans up abandoned chunked-upload sessions (tab closed/browser crash
  // before the server's last shutdown).
  try {
    await ensureUploadDir();
    await sweepStaleUploads();
  } catch (err) {
    console.error('[attachments] falha ao preparar a pasta de uploads:', err instanceof Error ? err.stack : err);
    process.exit(1);
  }

  const fastify = createApp();
  // fastify.server (the underlying http.Server) already exists once
  // Fastify() is called, before listen() — Socket.IO attaches to it the
  // same way it would to a plain http.Server, no change needed in
  // realtime/socket.ts.
  const io = createWsServer(fastify.server);

  await fastify.listen({ port: config.PORT, host: config.HOST_BIND });
  console.log(`Linkord ouvindo em http://${config.HOST_BIND}:${config.PORT}`);
  console.log('Sala unica, qualquer participante pode compartilhar. Camera/tela via WebRTC (LiveKit).');
  if (!config.LIVEKIT_URL || !config.LIVEKIT_API_KEY || !config.LIVEKIT_API_SECRET) {
    console.warn('Aviso: LIVEKIT_URL/LIVEKIT_API_KEY/LIVEKIT_API_SECRET nao configurados — compartilhar tela/camera vai falhar.');
  }

  // periodic cleanup of expired sessions — doesn't need to run per
  // request, just enough to keep the table from growing forever.
  const sessionSweepTimer = setInterval(() => {
    sweepExpiredSessions().catch((err) => console.error('[auth] falha ao limpar sessoes vencidas:', err instanceof Error ? err.stack : err));
  }, 60 * 60 * 1000);
  sessionSweepTimer.unref();

  // same cadence — upload session TTL is 24h (config.UPLOAD_SESSION_TTL_MS),
  // checking hourly is enough to avoid orphaned chunks piling up on disk.
  const uploadSweepTimer = setInterval(() => {
    sweepStaleUploads().catch((err) => console.error('[attachments] falha ao limpar uploads abandonados:', err instanceof Error ? err.stack : err));
  }, 60 * 60 * 1000);
  uploadSweepTimer.unref();

  let shuttingDown = false;
  async function shutdown(exitCode: number, reason: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${reason}, encerrando...`);
    const forceTimer = setTimeout(() => process.exit(exitCode), 3000);
    forceTimer.unref();
    try {
      broadcast({ t: 'server-restart' });
      for (const p of participantsMap.values()) {
        try { p.socket?.disconnect(true); } catch { /* socket ja morrendo */ }
      }
      io.close();
      await fastify.close();
    } catch (err) {
      console.error('[process] falha durante encerramento:', err instanceof Error ? err.stack : err);
      exitCode = 1;
    } finally {
      clearTimeout(forceTimer);
      process.exit(exitCode);
    }
  }

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => { void shutdown(0, `${sig} recebido`); });
  }

  // Continuing after an uncaught exception can leave in-memory presence,
  // locks or upload state inconsistent. Drain briefly and let the service
  // manager restart a clean process instead.
  process.on('unhandledRejection', (err) => {
    console.error('[process] unhandledRejection:', err instanceof Error ? err.stack : err);
    void shutdown(1, 'Falha fatal');
  });
  process.on('uncaughtException', (err) => {
    console.error('[process] uncaughtException:', err instanceof Error ? err.stack : err);
    void shutdown(1, 'Falha fatal');
  });
}

bootstrap().catch((err) => {
  console.error('[bootstrap] falha fatal:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
