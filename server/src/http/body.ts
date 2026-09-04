import type { IncomingMessage } from 'node:http';
import { config } from '../config/env.js';

interface HttpError extends Error {
  status: number;
  code: string;
}

function httpError(message: string, status: number, code: string): HttpError {
  return Object.assign(new Error(message), { status, code });
}

/** Le e faz parse do corpo JSON de uma requisicao, com teto de tamanho — sem
 * isso um POST poderia mandar um corpo gigante e segurar memoria/tempo do
 * processo indefinidamente. Independente de MAX_MSG_BYTES (esse e o teto do
 * transporte do Socket.IO pra imagem colada no quadro, nada a ver com HTTP).
 * Resolve com o objeto parseado, ou rejeita com um erro `.status`/`.code`
 * pronto pra virar resposta (o router so precisa formatar). */
export function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const contentType = String(req.headers['content-type'] || '');
    if (!contentType.startsWith('application/json')) {
      return reject(httpError('Content-Type deve ser application/json.', 415, 'invalid_content_type'));
    }

    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    function fail(err: HttpError) {
      if (settled) return;
      settled = true;
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      req.removeListener('aborted', onAborted);
      reject(err);
    }

    function onData(chunk: Buffer) {
      total += chunk.length;
      if (total > config.MAX_BODY_BYTES) {
        req.destroy();
        return fail(httpError('Corpo da requisicao muito grande.', 413, 'payload_too_large'));
      }
      chunks.push(chunk);
    }

    function onEnd() {
      if (settled) return;
      settled = true;
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        return reject(httpError('JSON invalido.', 400, 'invalid_json'));
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return reject(httpError('Corpo deve ser um objeto JSON.', 400, 'invalid_json'));
      }
      resolve(parsed as Record<string, unknown>);
    }

    function onError(err: Error) {
      fail(Object.assign(err, { status: 400, code: 'invalid_body' }));
    }

    function onAborted() {
      fail(httpError('Requisicao abortada.', 400, 'aborted'));
    }

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onAborted);
  });
}

/** Le o corpo cru (Buffer) de uma requisicao, com teto de bytes explicito —
 * usado pelo upload de anexo (server/src/modules/attachments.ts), onde o
 * corpo E o arquivo (sem Content-Type fixo nem JSON). Mesmo padrao de
 * acumular/abortar de readJsonBody, so sem parse nenhum no final. */
export function readRawBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    function fail(err: HttpError) {
      if (settled) return;
      settled = true;
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      req.removeListener('aborted', onAborted);
      reject(err);
    }

    function onData(chunk: Buffer) {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        return fail(httpError('Arquivo muito grande.', 413, 'payload_too_large'));
      }
      chunks.push(chunk);
    }

    function onEnd() {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    }

    function onError(err: Error) {
      fail(Object.assign(err, { status: 400, code: 'invalid_body' }));
    }

    function onAborted() {
      fail(httpError('Requisicao abortada.', 400, 'aborted'));
    }

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onAborted);
  });
}
