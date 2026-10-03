import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractMetaTags, extractFavicon, safeResolve, decodeHtmlEntities, emptyResult, isRateLimited, RATE_LIMIT_MAX } from '../../../src/modules/link-preview/linkPreview.js';

describe('extractMetaTags / extractFavicon', () => {
  const html = `<html><head>
    <title>Fallback title</title>
    <meta property="og:title" content="Real title">
    <meta name="description" content="A description">
    <meta property="og:image" content="/img/thumb.png">
    <meta property="og:video:url" content="https://cdn.example.com/v.mp4">
    <meta name="theme-color" content="#ff8800">
    <link rel="icon" href="/favicon-32.png">
  </head><body></body></html>`;

  test('reads the relevant meta tags (property and name, first occurrence wins)', () => {
    const metas = extractMetaTags(html);
    assert.equal(metas['og:title'], 'Real title');
    assert.equal(metas['description'], 'A description');
    assert.equal(metas['og:image'], '/img/thumb.png');
    assert.equal(metas['theme-color'], '#ff8800');
  });

  test('finds the declared favicon', () => {
    assert.equal(extractFavicon(html), '/favicon-32.png');
  });

  test('with no favicon declared, returns null', () => {
    assert.equal(extractFavicon('<html><head></head></html>'), null);
  });
});

describe('safeResolve', () => {
  test('resolves a relative URL against the base', () => {
    assert.equal(safeResolve('/img/thumb.png', 'https://example.com/pagina'), 'https://example.com/img/thumb.png');
  });

  test('keeps an absolute http(s) URL as-is', () => {
    assert.equal(safeResolve('https://cdn.example.com/v.mp4', 'https://example.com'), 'https://cdn.example.com/v.mp4');
  });

  test('rejects dangerous schemes (javascript:, data:) — never lets this become an img/video src', () => {
    assert.equal(safeResolve('javascript:alert(1)', 'https://example.com'), null);
    assert.equal(safeResolve('data:text/html,<script>', 'https://example.com'), null);
  });

  test('null/empty return null without trying to resolve', () => {
    assert.equal(safeResolve(null, 'https://example.com'), null);
    assert.equal(safeResolve('', 'https://example.com'), null);
  });

  test('an invalid base (no http/https protocol to anchor on) returns null', () => {
    assert.equal(safeResolve('/img.png', 'not-a-valid-base'), null);
  });
});

describe('decodeHtmlEntities', () => {
  test('decodes common named entities', () => {
    assert.equal(decodeHtmlEntities('Tom &amp; Jerry'), 'Tom & Jerry');
    assert.equal(decodeHtmlEntities('it&#39;s'), "it's");
    assert.equal(decodeHtmlEntities('it&apos;s'), "it's");
  });

  test('decodes decimal and hexadecimal numeric entities', () => {
    assert.equal(decodeHtmlEntities('&#65;&#66;&#67;'), 'ABC');
    assert.equal(decodeHtmlEntities('&#x41;&#x42;'), 'AB');
  });

  test('text with no entity at all passes through unchanged', () => {
    assert.equal(decodeHtmlEntities('no entities here'), 'no entities here');
  });
});

describe('isRateLimited', () => {
  test(`allows exactly ${RATE_LIMIT_MAX} calls in the window, blocks the next one`, () => {
    const userId = `user-${Math.random()}`;
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      assert.equal(isRateLimited(userId), false, `call ${i + 1} should pass`);
    }
    assert.equal(isRateLimited(userId), true);
  });

  test('each user has their own counter — one flooding does not affect the other', () => {
    const userA = `user-a-${Math.random()}`;
    const userB = `user-b-${Math.random()}`;
    for (let i = 0; i < RATE_LIMIT_MAX; i++) isRateLimited(userA);
    assert.equal(isRateLimited(userA), true); // A tripped the limit
    assert.equal(isRateLimited(userB), false); // B was unaffected
  });
});

describe('emptyResult', () => {
  test('uses the hostname (without www.) as the fallback siteName', () => {
    assert.equal(emptyResult('https://www.example.com/pagina').siteName, 'example.com');
  });

  test('a URL that fails to parse still returns a usable object', () => {
    const r = emptyResult('not-a-valid-url');
    assert.equal(r.siteName, 'not-a-valid-url');
    assert.equal(r.title, null);
  });
});
