import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedIp, extractMetaTags, extractFavicon, safeResolve, decodeHtmlEntities, emptyResult, isRateLimited, RATE_LIMIT_MAX } from './linkPreview.js';

describe('isBlockedIp — protecao contra SSRF', () => {
  const blockedV4 = [
    '127.0.0.1', // loopback
    '10.0.0.5', // RFC1918
    '172.16.0.1', '172.31.255.255', // RFC1918 172.16.0.0/12
    '192.168.1.1', // RFC1918
    '169.254.1.1', // link-local
    '100.64.0.1', // CGNAT
    '0.0.0.0',
    '192.0.0.8', // 192.0.0.0/24 (IETF Protocol Assignments)
    '192.0.2.55', // 192.0.2.0/24 (TEST-NET-1)
    '198.51.100.5', // TEST-NET-2
    '203.0.113.5', // TEST-NET-3
    '198.18.5.5', '198.19.5.5', // benchmark 198.18.0.0/15
    '224.0.0.1', // multicast
  ];
  for (const ip of blockedV4) {
    test(`bloqueia ${ip}`, () => assert.equal(isBlockedIp(ip, 4), true));
  }

  // regressao: o bug real que derrubou nasa.gov como falso positivo — a
  // checagem de 192.0.0.0/24 e 192.0.2.0/24 (ambas /24) tinha sido escrita
  // sem olhar o terceiro octeto, bloqueando o /16 inteiro (192.0.0.0-
  // 192.0.255.255) por engano. O resto desse /16 e espaco publico de
  // verdade — 192.0.66.0/24 e da propria NASA.
  const publicV4 = [
    '8.8.8.8',
    '1.1.1.1',
    '172.32.0.1', // logo fora do /12 privado
    '192.0.3.1', // dentro do /16 mas FORA dos dois /24 reservados
    '192.0.66.47', // IP real usado por www.nasa.gov
    '198.51.101.5', // fora do /24 reservado (198.51.100.0/24)
    '203.0.114.5', // fora do /24 reservado (203.0.113.0/24)
    '198.20.5.5', // logo fora do /15 de benchmark
  ];
  for (const ip of publicV4) {
    test(`NAO bloqueia ${ip} (publico)`, () => assert.equal(isBlockedIp(ip, 4), false));
  }

  test('endereco IPv4 malformado e bloqueado por seguranca (fail closed)', () => {
    assert.equal(isBlockedIp('nao-e-um-ip', 4), true);
  });

  describe('IPv6', () => {
    test('bloqueia loopback/link-local/ULA', () => {
      assert.equal(isBlockedIp('::1', 6), true);
      assert.equal(isBlockedIp('fe80::1', 6), true);
      assert.equal(isBlockedIp('fc00::1', 6), true);
      assert.equal(isBlockedIp('fd12::1', 6), true);
    });

    test('nao bloqueia IPv6 publico', () => {
      assert.equal(isBlockedIp('2606:4700:4700::1111', 6), false);
    });

    test('desembrulha IPv4 mapeado em IPv6 (::ffff:a.b.c.d) e valida a parte v4', () => {
      assert.equal(isBlockedIp('::ffff:127.0.0.1', 6), true);
      assert.equal(isBlockedIp('::ffff:8.8.8.8', 6), false);
    });
  });
});

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
    assert.equal(isRateLimited(userA), true); // A estourou
    assert.equal(isRateLimited(userB), false); // B nao foi afetado
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
