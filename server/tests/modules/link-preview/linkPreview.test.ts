import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractMetaTags, extractFavicon, safeResolve, decodeHtmlEntities, emptyResult, isRateLimited, RATE_LIMIT_MAX } from '../../../src/modules/link-preview/linkPreview.js';

describe('extractMetaTags / extractFavicon', () => {
  const html = `<html><head>
    <title>Titulo de fallback</title>
    <meta property="og:title" content="Titulo real">
    <meta name="description" content="Uma descricao">
    <meta property="og:image" content="/img/thumb.png">
    <meta property="og:video:url" content="https://cdn.example.com/v.mp4">
    <meta name="theme-color" content="#ff8800">
    <link rel="icon" href="/favicon-32.png">
  </head><body></body></html>`;

  test('le as meta tags relevantes (property e name, primeira ocorrencia vence)', () => {
    const metas = extractMetaTags(html);
    assert.equal(metas['og:title'], 'Titulo real');
    assert.equal(metas['description'], 'Uma descricao');
    assert.equal(metas['og:image'], '/img/thumb.png');
    assert.equal(metas['theme-color'], '#ff8800');
  });

  test('acha o favicon declarado', () => {
    assert.equal(extractFavicon(html), '/favicon-32.png');
  });

  test('sem favicon declarado, devolve null', () => {
    assert.equal(extractFavicon('<html><head></head></html>'), null);
  });
});

describe('safeResolve', () => {
  test('resolve URL relativa contra a base', () => {
    assert.equal(safeResolve('/img/thumb.png', 'https://example.com/pagina'), 'https://example.com/img/thumb.png');
  });

  test('mantem URL absoluta http(s) como esta', () => {
    assert.equal(safeResolve('https://cdn.example.com/v.mp4', 'https://example.com'), 'https://cdn.example.com/v.mp4');
  });

  test('rejeita esquemas perigosos (javascript:, data:) — nunca deixa isso virar src de img/video', () => {
    assert.equal(safeResolve('javascript:alert(1)', 'https://example.com'), null);
    assert.equal(safeResolve('data:text/html,<script>', 'https://example.com'), null);
  });

  test('null/vazio devolvem null sem tentar resolver', () => {
    assert.equal(safeResolve(null, 'https://example.com'), null);
    assert.equal(safeResolve('', 'https://example.com'), null);
  });

  test('base invalida (sem protocolo http/https pra ancorar) devolve null', () => {
    assert.equal(safeResolve('/img.png', 'not-a-valid-base'), null);
  });
});

describe('decodeHtmlEntities', () => {
  test('decodifica entidades nomeadas comuns', () => {
    assert.equal(decodeHtmlEntities('Tom &amp; Jerry'), 'Tom & Jerry');
    assert.equal(decodeHtmlEntities('it&#39;s'), "it's");
    assert.equal(decodeHtmlEntities('it&apos;s'), "it's");
  });

  test('decodifica entidades numericas decimais e hexadecimais', () => {
    assert.equal(decodeHtmlEntities('&#65;&#66;&#67;'), 'ABC');
    assert.equal(decodeHtmlEntities('&#x41;&#x42;'), 'AB');
  });

  test('texto sem entidade nenhuma passa direto', () => {
    assert.equal(decodeHtmlEntities('sem entidades aqui'), 'sem entidades aqui');
  });
});

describe('isRateLimited', () => {
  test(`permite exatamente ${RATE_LIMIT_MAX} chamadas na janela, bloqueia a seguinte`, () => {
    const userId = `user-${Math.random()}`;
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      assert.equal(isRateLimited(userId), false, `chamada ${i + 1} deveria passar`);
    }
    assert.equal(isRateLimited(userId), true);
  });

  test('cada usuario tem seu proprio contador — um flood de um nao afeta o outro', () => {
    const userA = `user-a-${Math.random()}`;
    const userB = `user-b-${Math.random()}`;
    for (let i = 0; i < RATE_LIMIT_MAX; i++) isRateLimited(userA);
    assert.equal(isRateLimited(userA), true); // A tripped the limit
    assert.equal(isRateLimited(userB), false); // B was unaffected
  });
});

describe('emptyResult', () => {
  test('usa o hostname (sem www.) como siteName de fallback', () => {
    assert.equal(emptyResult('https://www.example.com/pagina').siteName, 'example.com');
  });

  test('URL sem conseguir parsear ainda assim devolve um objeto usavel', () => {
    const r = emptyResult('nao-e-uma-url');
    assert.equal(r.siteName, 'nao-e-uma-url');
    assert.equal(r.title, null);
  });
});
