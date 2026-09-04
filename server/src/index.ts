import { config } from './config/env.js';
import { participants as participantsMap, broadcast } from './realtime/participants.js';
import { createHttpServer } from './http/server.js';
import { createWsServer } from './realtime/socket.js';
import { runMigrations } from './db/migrate.js';
import { sweepExpiredSessions } from './modules/auth/session.js';
import { ensureSeeded, ensureVoiceChannelExists } from './modules/channels.js';
import { ensureUploadDir, sweepStaleUploads } from './modules/attachments.js';

// rede de seguranca por tras do try/catch de cada handler em realtime/socket.ts
// — cobre qualquer erro assincrono que escape do ciclo normal de mensagens
// (ex.: um timer, uma promise solta) e que de outro jeito derrubaria o
// processo inteiro (Node mata o processo em unhandledRejection/
// uncaughtException por padrao), desconectando toda a sala.
process.on('unhandledRejection', (err) => {
  console.error('[process] unhandledRejection:', err instanceof Error ? err.stack : err);
});
process.on('uncaughtException', (err) => {
  console.error('[process] uncaughtException:', err instanceof Error ? err.stack : err);
});

async function bootstrap(): Promise<void> {
  // Nem o CMD do Docker nem o ExecStart do systemd passam por npm script —
  // sem migrar aqui, ninguem aplica migration nenhuma em producao. Falha
  // alto e sai: subir com o schema desatualizado e pior que nao subir (o
  // systemd com Restart=always vai ficar tentando de novo, visivel nos logs).
  if (config.MIGRATE_ON_BOOT) {
    try {
      await runMigrations();
      console.log('[db] migrations em dia.');
    } catch (err) {
      console.error('[db] falha ao aplicar migrations:', err instanceof Error ? err.stack : err);
      process.exit(1);
    }
  }

  // categoria+canal padrao ("Geral"/"geral") na primeira vez que o banco
  // esta vazio — cobre instalacao nova e upgrade de quem tinha o chat
  // unico antigo (em memoria, ja removido).
  try {
    await ensureSeeded();
    await ensureVoiceChannelExists();
  } catch (err) {
    console.error('[channels] falha ao semear categoria/canal padrao:', err instanceof Error ? err.stack : err);
    process.exit(1);
  }

  // pasta dos anexos (config.UPLOAD_DIR, normalmente um bind mount) — cria
  // se vier vazia, senao o primeiro upload falharia com ENOENT. Aproveita
  // pra limpar sessoes de upload em pedacos abandonadas (aba fechada/crash
  // antes do server cair da ultima vez).
  try {
    await ensureUploadDir();
    await sweepStaleUploads();
  } catch (err) {
    console.error('[attachments] falha ao preparar a pasta de uploads:', err instanceof Error ? err.stack : err);
    process.exit(1);
  }

  const server = createHttpServer();
  const io = createWsServer(server);

  server.listen(config.PORT, config.HOST_BIND, () => {
    console.log(`Linkord ouvindo em http://${config.HOST_BIND}:${config.PORT}`);
    console.log('Sala unica, qualquer participante pode compartilhar. Camera/tela via WebRTC (LiveKit).');
    if (!config.LIVEKIT_URL || !config.LIVEKIT_API_KEY || !config.LIVEKIT_API_SECRET) {
      console.warn('Aviso: LIVEKIT_URL/LIVEKIT_API_KEY/LIVEKIT_API_SECRET nao configurados — compartilhar tela/camera vai falhar.');
    }
  });

  // limpeza periodica de sessoes vencidas — nao precisa ser a cada request,
  // so pra nao deixar a tabela crescer pra sempre.
  const sessionSweepTimer = setInterval(() => {
    sweepExpiredSessions().catch((err) => console.error('[auth] falha ao limpar sessoes vencidas:', err instanceof Error ? err.stack : err));
  }, 60 * 60 * 1000);
  sessionSweepTimer.unref();

  // mesma cadencia — TTL de sessao de upload e 24h (config.UPLOAD_SESSION_TTL_MS),
  // checar a cada hora sobra pra nao deixar chunk orfao acumulando disco.
  const uploadSweepTimer = setInterval(() => {
    sweepStaleUploads().catch((err) => console.error('[attachments] falha ao limpar uploads abandonados:', err instanceof Error ? err.stack : err));
  }, 60 * 60 * 1000);
  uploadSweepTimer.unref();

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      console.log(`\n${sig} recebido, encerrando...`);
      broadcast({ t: 'server-restart' });
      for (const p of participantsMap.values()) { try { p.socket && p.socket.disconnect(true); } catch { /* socket ja morrendo */ } }
      io.close();
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000).unref();
    });
  }
}

bootstrap();
