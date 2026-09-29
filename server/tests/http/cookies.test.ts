import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { parseCookies, serializeCookie, clearCookie, isSecureRequest } from '../../src/http/cookies.js';

describe('parseCookies', () => {
  test('no header, returns an empty object', () => {
    assert.deepEqual(parseCookies(''), {});
  });

  test('several cookies separated by ; become separate keys', () => {
    assert.deepEqual(parseCookies('a=1; b=2'), { a: '1', b: '2' });
  });

  test('extra = in the value stays in everything after the first = (e.g. JWT/base64)', () => {
    assert.deepEqual(parseCookies('token=abc=def'), { token: 'abc=def' });
  });

  test('empty name (cookie that is just "=value") is ignored', () => {
    assert.deepEqual(parseCookies('=noName; a=1'), { a: '1' });
  });

  test('a part with no = at all is ignored', () => {
    assert.deepEqual(parseCookies('garbage; a=1'), { a: '1' });
  });

  test('URL-decodes the value — falls back to the raw value if not valid URI-encoding', () => {
    assert.deepEqual(parseCookies('a=ol%C3%A1'), { a: 'olá' });
    assert.deepEqual(parseCookies('a=%'), { a: '%' });
  });
});

describe('serializeCookie / clearCookie', () => {
  test('default attributes: Path=/, HttpOnly, SameSite=Lax', () => {
    const cookie = serializeCookie('ss_session', 'tok123', { secure: false });
    assert.match(cookie, /^ss_session=tok123; Path=\/; HttpOnly; SameSite=Lax$/);
  });

  test('maxAgeSec becomes an integer Max-Age, never negative', () => {
    assert.match(serializeCookie('a', 'v', { maxAgeSec: 60.9, secure: false }), /Max-Age=60(?!\d)/);
    assert.match(serializeCookie('a', 'v', { maxAgeSec: -10, secure: false }), /Max-Age=0(?!\d)/);
  });

  test('secure:true appends the Secure attribute', () => {
    assert.match(serializeCookie('a', 'v', { secure: true }), /; Secure$/);
  });

  test('the value is URL-encoded', () => {
    assert.match(serializeCookie('a', 'valor com espaço', { secure: false }), /a=valor%20com%20espa%C3%A7o/);
  });

  test('clearCookie zeroes the value and Max-Age=0, preserving the requested secure attribute', () => {
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

  test('a direct TLS connection (req.socket.encrypted) is always secure', () => {
    assert.equal(isSecureRequest(fakeReq({ encrypted: true })), true);
  });

  test('with no direct TLS and no trusted proxy, it is not secure', () => {
    assert.equal(isSecureRequest(fakeReq()), false);
  });

  // config.TRUST_PROXY comes from the test environment (.env.test), which
  // doesn't set TRUST_PROXY — so X-Forwarded-Proto:https alone, without
  // TRUST_PROXY=1, should NOT be enough (otherwise any client could forge
  // that header and earn a Secure cookie behind a proxy that doesn't
  // actually exist).
  test('X-Forwarded-Proto alone is not enough without TRUST_PROXY on', () => {
    assert.equal(isSecureRequest(fakeReq({ forwardedProto: 'https' })), false);
  });
});
