import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isOriginAllowed } from '../../src/http/originGuard.js';

const base = { requestHost: 'app.example.com', appUrl: 'https://app.example.com', allowedOrigins: [] as string[], isDev: false };

describe('isOriginAllowed', () => {
  it('no Origin (curl, scripts) passes: not a browser cross-site request', () => {
    assert.equal(isOriginAllowed({ ...base, origin: undefined }), true);
  });

  it('the request\'s own origin and APP_URL pass', () => {
    assert.equal(isOriginAllowed({ ...base, origin: 'https://app.example.com' }), true);
    assert.equal(isOriginAllowed({ ...base, requestHost: 'internal:3000', origin: 'https://app.example.com' }), true);
  });

  it('origin from another site is rejected', () => {
    assert.equal(isOriginAllowed({ ...base, origin: 'https://evil.example.net' }), false);
    assert.equal(isOriginAllowed({ ...base, origin: 'https://app.example.com.evil.net' }), false);
  });

  it('"null" origin (iframe sandbox, file://) and garbage do not pass', () => {
    assert.equal(isOriginAllowed({ ...base, origin: 'null' }), false);
    assert.equal(isOriginAllowed({ ...base, origin: 'not-a-url' }), false);
  });

  it('ALLOWED_ORIGINS adds origins; the port is part of the host', () => {
    const allowed = { ...base, allowedOrigins: ['https://staging.example.com', 'http://localhost:8080'] };
    assert.equal(isOriginAllowed({ ...allowed, origin: 'https://staging.example.com' }), true);
    assert.equal(isOriginAllowed({ ...allowed, origin: 'http://localhost:8080' }), true);
    assert.equal(isOriginAllowed({ ...allowed, origin: 'http://localhost:9090' }), false);
  });

  it('the dev Vite origin only passes in dev', () => {
    assert.equal(isOriginAllowed({ ...base, origin: 'http://localhost:5173' }), false);
    assert.equal(isOriginAllowed({ ...base, isDev: true, origin: 'http://localhost:5173' }), true);
  });

  it('empty APP_URL does not become "accept everything"', () => {
    assert.equal(isOriginAllowed({ ...base, appUrl: '', origin: 'https://evil.example.net' }), false);
  });
});
