import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { parseCookies, serializeCookie, clearCookie, isSecureRequest } from './cookies.js';

describe('parseCookies', () => {
  test('sem header, devolve objeto vazio', () => {
    assert.deepEqual(parseCookies(''), {});
  });

  test('varios cookies separados por ; viram chaves separadas', () => {
    assert.deepEqual(parseCookies('a=1; b=2'), { a: '1', b: '2' });
  });

  test('valor com = sobrando fica tudo depois do primeiro = (ex: JWT/base64)', () => {
    assert.deepEqual(parseCookies('token=abc=def'), { token: 'abc=def' });
  });

  test('nome vazio (cookie so com "=valor") e ignorado', () => {
    assert.deepEqual(parseCookies('=semNome; a=1'), { a: '1' });
  });

  test('parte sem = nenhum e ignorada', () => {
    assert.deepEqual(parseCookies('lixo; a=1'), { a: '1' });
  });

  test('URL-decode do valor — cai pro valor cru se nao for URI-encoding valido', () => {
    assert.deepEqual(parseCookies('a=ol%C3%A1'), { a: 'olá' });
    assert.deepEqual(parseCookies('a=%'), { a: '%' });
  });
});

describe('serializeCookie / clearCookie', () => {
  test('atributos padrao: Path=/, HttpOnly, SameSite=Lax', () => {
    const cookie = serializeCookie('ss_session', 'tok123', { secure: false });
    assert.match(cookie, /^ss_session=tok123; Path=\/; HttpOnly; SameSite=Lax$/);
  });

  test('maxAgeSec vira Max-Age inteiro, nunca negativo', () => {
    assert.match(serializeCookie('a', 'v', { maxAgeSec: 60.9, secure: false }), /Max-Age=60(?!\d)/);
    assert.match(serializeCookie('a', 'v', { maxAgeSec: -10, secure: false }), /Max-Age=0(?!\d)/);
  });

  test('secure:true acrescenta o atributo Secure', () => {
    assert.match(serializeCookie('a', 'v', { secure: true }), /; Secure$/);
  });

  test('valor e URL-encoded', () => {
    assert.match(serializeCookie('a', 'valor com espaço', { secure: false }), /a=valor%20com%20espa%C3%A7o/);
  });

  test('clearCookie zera o valor e Max-Age=0, preservando o atributo secure pedido', () => {
    const cookie = clearCookie('ss_session', { secure: true });
    assert.match(cookie, /^ss_session=; Path=\/; HttpOnly; SameSite=Lax; Max-Age=0; Secure$/);
  });
});

describe('isSecureRequest', () => {
  function fakeReq(overrides: { encrypted?: boolean; forwardedProto?: string } = {}): IncomingMessage {
    return {
      socket: { encrypted: overrides.encrypted ?? false },
      headers: overrides.forwardedProto ? { 'x-forwarded-proto': overrides.forwardedProto } : {},
    } as unknown as IncomingMessage;
  }

  test('conexao TLS direta (req.socket.encrypted) e sempre segura', () => {
    assert.equal(isSecureRequest(fakeReq({ encrypted: true })), true);
  });

  test('sem TLS direto nem proxy confiavel, nao e segura', () => {
    assert.equal(isSecureRequest(fakeReq()), false);
  });

  // config.TRUST_PROXY vem do ambiente de teste (.env.test), que nao liga
  // TRUST_PROXY — entao X-Forwarded-Proto:https sozinho, sem TRUST_PROXY=1,
  // NAO deveria bastar (senao qualquer cliente forjaria esse header e
  // ganharia cookie Secure atras de um proxy que nao existe de verdade).
  test('X-Forwarded-Proto sozinho nao basta sem TRUST_PROXY ligado', () => {
    assert.equal(isSecureRequest(fakeReq({ forwardedProto: 'https' })), false);
  });
});
