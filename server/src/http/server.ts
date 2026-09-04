import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { participants } from '../realtime/participants.js';
import { createRouter, safeRoute } from './router.js';
import { routes as authRoutes } from '../modules/auth/routes.js';
import * as attachments from '../modules/attachments.js';
import * as media from '../modules/media.js';
import * as linkPreview from '../modules/link-preview/linkPreview.js';

const dispatchApi = createRouter({ ...authRoutes, ...attachments.routes, ...media.routes, ...linkPreview.routes }, '/api/');

// Upload de anexo em pedacos: init (POST /api/attachments/init) e string
// exata, ja passa por dispatchApi acima. Estas 3 tem segmento variavel na
// URL (uploadId/index), que o router generico nao suporta (so faz match
// exato de string) — mesmo motivo de /uploads/<id> ser tratado a parte mais
// abaixo. Precisam ser checadas ANTES de dispatchApi: qualquer coisa sob
// /api/ sem match exato no router generico leva um 404 dele direto.
const ATTACHMENT_CHUNK_RE = /^\/api\/attachments\/([0-9a-f]{32})\/chunk\/(\d+)$/;
const ATTACHMENT_COMPLETE_RE = /^\/api\/attachments\/([0-9a-f]{32})\/complete$/;
const ATTACHMENT_CANCEL_RE = /^\/api\/attachments\/([0-9a-f]{32})$/;

// ---------------------------------------------------------------------------
// HTTP: arquivos estaticos do build do frontend (web/dist) + healthz.
// ---------------------------------------------------------------------------
// compilado, este arquivo vira server/dist/http/server.js, daí os tres '..'
// pra sair de dist/http ate a raiz do repo, e entrar em web/dist.
const PUBLIC_DIR = path.join(import.meta.dirname, '..', '..', '..', 'web', 'dist');
const ASSETS_DIR = path.join(PUBLIC_DIR, 'assets'); // nomes com hash do Vite: seguros pra cache longo
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  // sem o content-type certo aqui, alguns navegadores ignoram o manifest e
  // o site nunca fica instalavel.
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  // efeitos sonoros (web/public/sounds) — sem isso caem no fallback
  // application/octet-stream, e o Safari em particular se recusa a tocar
  // audio servido com esse content-type.
  '.mp3': 'audio/mpeg',
};

function serveFile(res: http.ServerResponse, filePath: string): void {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 - nao encontrado');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const isHashedAsset = filePath.startsWith(ASSETS_DIR);
    let cacheControl = 'public, max-age=3600';
    if (isHashedAsset) cacheControl = 'public, max-age=31536000, immutable';
    else if (ext === '.html') cacheControl = 'no-cache';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
      // 'same-origin' fazia o navegador nao mandar Referer nenhum pro
      // iframe do YouTube — e o player dele usa isso pra validar a origem
      // do embed, entao caia num "erro de configuracao do player" generico.
      // Esse valor ainda so revela a origem (nao a URL inteira) pra terceiros.
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
    res.end(data);
  });
}

export function createHttpServer(): http.Server {
  return http.createServer((req, res) => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url || '', 'http://x').pathname);
    } catch {
      res.writeHead(400).end('bad request');
      return;
    }

    // /api/* nunca pode cair no serveFile abaixo — ele responde texto puro
    // em erro ("404 - nao encontrado"), e o cliente sempre espera JSON aqui.
    let m: RegExpExecArray | null;
    if (req.method === 'POST' && (m = ATTACHMENT_CHUNK_RE.exec(pathname))) {
      safeRoute((rq, rs) => attachments.handleAttachmentChunk(rq, rs, m![1]!, Number(m![2])), req, res);
      return;
    }
    if (req.method === 'POST' && (m = ATTACHMENT_COMPLETE_RE.exec(pathname))) {
      safeRoute((rq, rs) => attachments.handleAttachmentComplete(rq, rs, m![1]!), req, res);
      return;
    }
    if (req.method === 'DELETE' && (m = ATTACHMENT_CANCEL_RE.exec(pathname))) {
      safeRoute((rq, rs) => attachments.handleAttachmentCancel(rq, rs, m![1]!), req, res);
      return;
    }

    if (dispatchApi(req, res, pathname)) return;

    // /uploads/<id>: arquivo anexado no chat. Fora do router de /api/ de
    // proposito (esse so faz match exato de string, sem parametro de id na
    // URL, ver http/router.ts) — igual /healthz e o fallback estatico
    // abaixo, e um caso especial resolvido direto aqui. .catch() proprio
    // (nao passa pelo safeRoute do router) — sem isso um erro de banco aqui
    // vira unhandledRejection e a requisicao fica pendurada sem resposta.
    if (pathname.startsWith('/uploads/')) {
      attachments.serveUpload(req, res, pathname).catch((err) => {
        console.error('[http] erro servindo anexo:', err instanceof Error ? err.stack : err);
        if (!res.headersSent) res.writeHead(500).end('erro interno');
      });
      return;
    }

    if (pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': MIME['.json']! });
      res.end(JSON.stringify({ ok: true, participants: participants.size, uptime: process.uptime() }));
      return;
    }

    if (pathname === '/') return serveFile(res, path.join(PUBLIC_DIR, 'index.html'));

    const safe = path.normalize(path.join(PUBLIC_DIR, pathname));
    if (!safe.startsWith(PUBLIC_DIR)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    serveFile(res, safe);
  });
}
