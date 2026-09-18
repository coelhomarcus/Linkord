import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedIp } from '../../src/net/ssrfGuard.js';

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

  // regression: the real bug that flagged nasa.gov as a false positive — the
  // check for 192.0.0.0/24 and 192.0.2.0/24 (both /24s) had been written
  // without looking at the third octet, blocking the entire /16
  // (192.0.0.0-192.0.255.255) by mistake. The rest of that /16 is genuinely
  // public space — 192.0.66.0/24 belongs to NASA itself.
  const publicV4 = [
    '8.8.8.8',
    '1.1.1.1',
    '172.32.0.1', // just outside the private /12
    '192.0.3.1', // inside the /16 but OUTSIDE both reserved /24s
    '192.0.66.47', // real IP used by www.nasa.gov
    '198.51.101.5', // outside the reserved /24 (198.51.100.0/24)
    '203.0.114.5', // outside the reserved /24 (203.0.113.0/24)
    '198.20.5.5', // just outside the benchmark /15
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
