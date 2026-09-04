import type { IncomingMessage, ServerResponse } from 'node:http';

interface HttpError extends Error {
  status: number;
  code: string;
}

export type RouteHandler = (req: IncomingMessage, res: ServerResponse) => unknown | Promise<unknown>;
export type RouteTable = Record<string, RouteHandler>;

/** Escreve uma resposta JSON com Cache-Control: no-store — nenhuma resposta
 * de /api/* deve ser cacheada (sessao, dados de conta). */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

export function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { error: { code, message } });
}

/** Roda uma rota isolada de erro — mesma logica do safeHandle do socket.ts:
 * uma excecao ou promise rejeitada de UMA rota nao pode derrubar o processo
 * (e todo mundo conectado por WebSocket junto). Erros com `.status`/`.code`
 * (ex.: readJsonBody) viram a resposta correspondente; qualquer outro erro
 * vira 500 generico. */
export function safeRoute(handler: RouteHandler, req: IncomingMessage, res: ServerResponse): void {
  Promise.resolve()
    .then(() => handler(req, res))
    .catch((err: unknown) => {
      if (res.headersSent) return; // handler ja respondeu e falhou depois (ex.: log)
      const httpErr = err as Partial<HttpError> | undefined;
      if (httpErr && httpErr.status) return sendError(res, httpErr.status, httpErr.code || 'error', httpErr.message || 'Erro.');
      console.error('[http] erro numa rota:', err instanceof Error ? err.stack : err);
      sendError(res, 500, 'internal_error', 'Erro interno.');
    });
}

/** Cria um dispatcher a partir de uma tabela { 'METODO /caminho': handler }.
 * Devolve false se a pathname nao comeca com o prefixo dado (deixa o
 * chamador decidir o que fazer — ex.: cair pro arquivo estatico). */
export function createRouter(routes: RouteTable, prefix: string) {
  return function dispatch(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
    if (!pathname.startsWith(prefix)) return false;
    const handler = routes[`${req.method} ${pathname}`];
    if (!handler) { sendError(res, 404, 'not_found', 'Rota nao encontrada.'); return true; }
    safeRoute(handler, req, res);
    return true;
  };
}
