// Shared by every module that fetches a URL the server didn't choose itself
// (link-preview's Open Graph fetch, the avatar/banner "usar URL" download)
// — kept as a leaf module, zero dependency on anything else, so both can
// import it without risking a cycle. Used as the `lookup` override passed
// to http/https.request in each caller, so it's checked at CONNECTION
// time (on every hop, including redirects), not just an upfront DNS
// lookup — which DNS rebinding would bypass.

/** True = private/reserved address, never safe to connect to from the
 * server (RFC1918, loopback, link-local, CGNAT, IPv4 test/multicast
 * ranges; loopback/link-local/ULA in IPv6, including IPv4-mapped). */
export function isBlockedIp(address: string, family: number): boolean {
  if (family === 6) {
    const a = address.toLowerCase();
    if (a === '::1' || a === '::') return true;
    if (a.startsWith('fe80:') || a.startsWith('fc') || a.startsWith('fd')) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(a);
    if (mapped) return isBlockedIp(mapped[1]!, 4);
    return false;
  }
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  // these test/benchmark ranges are all /24s (one specific 3rd octet) — the
  // rest of the /16 is real public space (e.g. 192.0.66.0/24 is NASA's).
  // Checking only a/b without c would block a whole /16 by mistake.
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 (IETF Protocol Assignments)
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 (TEST-NET-1)
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 (benchmark) — this one really is the whole /15
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 (TEST-NET-2)
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 (TEST-NET-3)
  if (a >= 224) return true; // multicast + reserved
  return false;
}
