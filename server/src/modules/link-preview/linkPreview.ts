import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import type { LookupOptions, LookupAddress } from 'node:dns';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from '../../config/env.js';
import { sendJson, sendError, type RouteTable } from '../../http/router.js';
import { parseCookies } from '../../http/cookies.js';
import { resolveSession } from '../auth/session.js';

// ---------------------------------------------------------------------------
// GET /api/link-preview?url=<url> — busca title/description/image/video via
// tags Open Graph (e fallbacks <title>/<meta name="description">) de um link
// generico colado no chat, pro card de embed (web/src/shared/GenericEmbed.tsx)
// nao depender do navegador de quem esta lendo (CORS bloquearia um fetch
// direto do cliente pra qualquer site de terceiro).
//
// Isso significa que O SERVIDOR baixa uma URL escolhida por quem manda
// mensagem no chat — risco classico de SSRF (alguem cola um link apontando
// pra rede interna tentando ler algo que so o proprio servidor enxerga). A
// defesa fica em fetchSafe/safeLookup: o IP e validado NO MOMENTO DE CADA
// CONEXAO (nao so um DNS lookup antecipado, que um dominio com DNS rebinding
// — resolve pra um IP publico na validacao e um privado na hora de conectar
// de verdade — contornaria), redirects sao seguidos manualmente (cada hop
// revalidado do zero, teto de 3) e a leitura do corpo tem teto de bytes e de
// tempo.
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 5000;
// rede de seguranca pra pagina malformada sem `</head>` (ver abaixo) — o
// corte de verdade e semantico, nao um teto de bytes: algumas paginas (o
// YouTube e a pior, ~700KB de HTML ANTES da primeira meta tag OG) tem um
// <head> legitimamente enorme, e um teto pequeno cortava a busca bem antes
// de chegar nas tags que a gente queria.
const MAX_BODY_BYTES = 1.5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — mesmo link, mesmo preview pra todo mundo
const CACHE_MAX_ENTRIES = 500;
const USER_AGENT = 'Mozilla/5.0 (compatible; LinkordBot/1.0; +link preview)';
const HEAD_CLOSE_RE = /<\/head/i;

export interface LinkPreviewResult {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  video: string | null;
  favicon: string | null;
  siteName: string;
  themeColor: string | null;
}

interface CacheEntry {
  value: LinkPreviewResult;
  expiresAtMs: number;
}

const cache = new Map<string, CacheEntry>(); // url -> { value, expiresAtMs }

function cacheGet(url: string): LinkPreviewResult | undefined {
  const entry = cache.get(url);
  if (!entry) return undefined;
  if (entry.expiresAtMs < Date.now()) { cache.delete(url); return undefined; }
  return entry.value;
}

function cacheSet(url: string, value: LinkPreviewResult): void {
  // Map preserva ordem de insercao — o primeiro a entrar e o mais velho.
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(url, { value, expiresAtMs: Date.now() + CACHE_TTL_MS });
}

// ---------------------------------------------------------------------------
// Rate limit POR USUARIO — so conta contra o limite quando de fato precisa
// SAIR pra internet buscar uma URL nova (cache HIT nao entra aqui, ver
// fetchLinkPreviewData: colar um link ja visto por outra pessoa continua
// livre). Sem isso, colar varios links diferentes rapido bastava pra fazer
// o servidor abrir dezenas de conexoes de saida por segundo. Janela fixa
// simples (nao token bucket) — o volume aqui e baixo o bastante (uma sala)
// pra precisao extra nao valer a complexidade.
// ---------------------------------------------------------------------------
export const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const rateLimitState = new Map<string, { count: number; windowStartMs: number }>(); // userId -> { count, windowStartMs }

export function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitState.get(userId);
  if (!entry || now - entry.windowStartMs >= RATE_LIMIT_WINDOW_MS) {
    rateLimitState.set(userId, { count: 1, windowStartMs: now });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
}

/** true = endereco privado/reservado, nunca deve ser conectado a partir do
 * servidor (RFC1918, loopback, link-local, CGNAT, faixas de teste/multicast
 * em IPv4; loopback/link-local/ULA em IPv6, incluindo IPv4 mapeado). */
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
  // as faixas de teste/benchmark abaixo sao TODAS /24 (so um terceiro octeto
  // especifico) — o resto do /16 em cada uma e espaco publico de verdade
  // (ex.: 192.0.66.0/24 e da NASA). Checar so a/b, sem o c, bloqueava um
  // /16 inteiro por engano.
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 (IETF Protocol Assignments)
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 (TEST-NET-1)
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 (benchmark) — esse sim e o /15 inteiro
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 (TEST-NET-2)
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 (TEST-NET-3)
  if (a >= 224) return true; // multicast + reservado
  return false;
}

/** `lookup` customizado passado pro http/https.request — chamado pelo Node
 * a CADA tentativa de conexao (inclusive apos redirect), entao valida o IP
 * de verdade sendo usado, nao so um DNS antecipado. */
function safeLookup(
  hostname: string,
  options: LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
): void {
  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err, '');
    const list = Array.isArray(addresses) ? addresses : [addresses];
    const safe = list.find((a) => !isBlockedIp(a.address, a.family));
    if (!safe) return callback(new Error('destino bloqueado (IP privado/reservado)'), '');
    if (options.all) return callback(null, [safe]);
    callback(null, safe.address, safe.family);
  });
}

function fetchSafe(targetUrl: string, redirectsLeft: number): Promise<{ html: string; finalUrl: string }> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try { parsed = new URL(targetUrl); } catch { return reject(new Error('URL invalida')); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return reject(new Error('protocolo nao suportado'));
    }

    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(parsed, {
      method: 'GET',
      lookup: safeLookup,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*;q=0.5' },
      timeout: FETCH_TIMEOUT_MS,
    }, (res: IncomingMessage) => {
      const status = res.statusCode || 0;

      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error('redirecionamentos demais'));
        let nextUrl: string;
        try { nextUrl = new URL(res.headers.location, parsed).toString(); } catch { return reject(new Error('redirect invalido')); }
        return resolve(fetchSafe(nextUrl, redirectsLeft - 1));
      }
      if (status < 200 || status >= 300) {
        res.resume();
        return reject(Object.assign(new Error(`status ${status}`), { httpStatus: status }));
      }

      const contentType = String(res.headers['content-type'] || '');
      if (!contentType.includes('text/html')) {
        res.resume();
        return resolve({ html: '', finalUrl: parsed.toString() });
      }

      let body = '';
      let bytes = 0;
      let settled = false;
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        if (settled) return;
        bytes += Buffer.byteLength(chunk);
        body += chunk;
        // para assim que o </head> fecha (todas as meta tags OG vivem ali
        // dentro, nunca no <body>) ou, se a pagina nao tiver um head normal,
        // no teto de bytes como rede de seguranca.
        if (HEAD_CLOSE_RE.test(body) || bytes >= MAX_BODY_BYTES) {
          settled = true;
          res.destroy();
          resolve({ html: body, finalUrl: parsed.toString() });
        }
      });
      res.on('end', () => { if (!settled) resolve({ html: body, finalUrl: parsed.toString() }); });
      res.on('error', (err) => { if (!settled) reject(err); });
    });

    req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
    req.on('error', reject);
    req.end();
  });
}

const HTML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** As paginas escrevem o conteudo das meta tags como HTML (ex.: og:title com
 * apostrofo vira "&#39;" ou "&apos;") — sem decodificar aqui, o card mostra
 * a entidade crua em vez do caractere de verdade. */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const codePoint = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : whole;
    }
    return HTML_ENTITIES[code.toLowerCase()] ?? whole;
  });
}

export function extractMetaTags(html: string): Record<string, string> {
  const metas: Record<string, string> = {};
  const metaRe = /<meta\s+[^>]*>/gi;
  let m;
  while ((m = metaRe.exec(html))) {
    const tag = m[0];
    const propM = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag);
    const contentM = /content\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (propM && contentM) {
      const key = propM[1]!.toLowerCase();
      if (!(key in metas)) metas[key] = decodeHtmlEntities(contentM[1]!); // primeira ocorrencia vence
    }
  }
  return metas;
}

export function extractFavicon(html: string): string | null {
  const iconRe = /<link\s+[^>]*rel\s*=\s*["'](?:shortcut icon|icon|apple-touch-icon)["'][^>]*>/i;
  const tag = iconRe.exec(html)?.[0];
  const hrefM = tag && /href\s*=\s*["']([^"']+)["']/i.exec(tag);
  return hrefM ? hrefM[1]! : null;
}

export function safeResolve(raw: string | null | undefined, base: string): string | null {
  if (!raw) return null;
  try {
    const resolved = new URL(raw, base);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

export function emptyResult(rawUrl: string): LinkPreviewResult {
  let hostname = rawUrl;
  try { hostname = new URL(rawUrl).hostname.replace(/^www\./, ''); } catch { /* mantem a url crua */ }
  return { url: rawUrl, title: null, description: null, image: null, video: null, favicon: null, siteName: hostname, themeColor: null };
}

async function fetchLinkPreviewData(rawUrl: string, userId: string): Promise<LinkPreviewResult> {
  const cached = cacheGet(rawUrl);
  if (cached !== undefined) return cached;

  if (isRateLimited(userId)) {
    throw Object.assign(new Error('Muitos links novos em pouco tempo, tenta de novo daqui a pouco.'), { status: 429, code: 'rate_limited' });
  }

  let result: LinkPreviewResult;
  try {
    const { html, finalUrl } = await fetchSafe(rawUrl, MAX_REDIRECTS);
    const metas = extractMetaTags(html);
    const titleTagM = /<title[^>]*>([^<]*)<\/title>/i.exec(html);

    const title = (metas['og:title'] || metas['twitter:title'] || (titleTagM && decodeHtmlEntities(titleTagM[1]!)) || '').trim() || null;
    const description = (metas['og:description'] || metas['twitter:description'] || metas['description'] || '').trim() || null;
    const image = safeResolve(metas['og:image'] || metas['og:image:url'] || metas['twitter:image'], finalUrl);
    const video = safeResolve(metas['og:video:secure_url'] || metas['og:video:url'] || metas['og:video'], finalUrl);
    const favicon = safeResolve(extractFavicon(html), finalUrl) || safeResolve('/favicon.ico', finalUrl);
    const siteName = (metas['og:site_name'] || '').trim() || new URL(finalUrl).hostname.replace(/^www\./, '');
    const themeColor = (metas['theme-color'] || '').trim() || null;

    result = { url: rawUrl, title, description, image, video, favicon, siteName, themeColor };
  } catch {
    // scraping falhou (bloqueado, timeout, site fora do ar, SSRF barrado) —
    // ainda assim devolve algo renderizavel: um card minimo so com o
    // dominio, igual o Discord faz quando nao consegue ler metadata.
    result = emptyResult(rawUrl);
  }

  cacheSet(rawUrl, result);
  return result;
}

async function handleLinkPreview(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const cookies = parseCookies(req.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(res, 401, 'unauthenticated', 'Nao autenticado.');

  const url = new URL(req.url || '', 'http://x');
  const target = url.searchParams.get('url');
  if (!target) return sendError(res, 400, 'missing_url', 'Parametro url obrigatorio.');

  let parsed: URL;
  try { parsed = new URL(target); } catch { return sendError(res, 400, 'invalid_url', 'URL invalida.'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return sendError(res, 400, 'invalid_url', 'So http/https e suportado.');
  }

  const data = await fetchLinkPreviewData(target, sess.userId);
  sendJson(res, 200, data);
}

export const routes: RouteTable = { 'GET /api/link-preview': handleLinkPreview };
