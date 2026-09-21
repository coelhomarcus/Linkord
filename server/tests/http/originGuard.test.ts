import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isOriginAllowed } from '../../src/http/originGuard.js';

const base = { requestHost: 'app.example.com', appUrl: 'https://app.example.com', allowedOrigins: [] as string[], isDev: false };

describe('isOriginAllowed', () => {
  it('sem Origin (curl, scripts) passa: nao e uma requisicao cross-site de navegador', () => {
    assert.equal(isOriginAllowed({ ...base, origin: undefined }), true);
  });

  it('a propria origem e o APP_URL passam', () => {
    assert.equal(isOriginAllowed({ ...base, origin: 'https://app.example.com' }), true);
    assert.equal(isOriginAllowed({ ...base, requestHost: 'internal:3000', origin: 'https://app.example.com' }), true);
  });

  it('origem de outro site e recusada', () => {
    assert.equal(isOriginAllowed({ ...base, origin: 'https://evil.example.net' }), false);
    assert.equal(isOriginAllowed({ ...base, origin: 'https://app.example.com.evil.net' }), false);
  });

  it('origem "null" (iframe sandbox, file://) e lixo nao passam', () => {
    assert.equal(isOriginAllowed({ ...base, origin: 'null' }), false);
    assert.equal(isOriginAllowed({ ...base, origin: 'nao-e-url' }), false);
  });

  it('ALLOWED_ORIGINS acrescenta origens; a porta faz parte do host', () => {
    const allowed = { ...base, allowedOrigins: ['https://staging.example.com', 'http://localhost:8080'] };
    assert.equal(isOriginAllowed({ ...allowed, origin: 'https://staging.example.com' }), true);
    assert.equal(isOriginAllowed({ ...allowed, origin: 'http://localhost:8080' }), true);
    assert.equal(isOriginAllowed({ ...allowed, origin: 'http://localhost:9090' }), false);
  });

  it('o Vite de desenvolvimento so passa em dev', () => {
    assert.equal(isOriginAllowed({ ...base, origin: 'http://localhost:5173' }), false);
    assert.equal(isOriginAllowed({ ...base, isDev: true, origin: 'http://localhost:5173' }), true);
  });

  it('APP_URL vazio nao vira "aceita tudo"', () => {
    assert.equal(isOriginAllowed({ ...base, appUrl: '', origin: 'https://evil.example.net' }), false);
  });
});
