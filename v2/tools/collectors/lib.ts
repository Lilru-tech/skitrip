// Utilidades comunes de los recolectores (se ejecutan en GitHub Actions, nunca en el Worker).
import { setTimeout as sleep } from 'node:timers/promises';
import { detectBlock } from '../../src/core/blocked.ts';
import { parseRobots, robotsAllows, type RobotsRule } from '../../src/core/robots.ts';

export const API = (process.env.SKITRIP_API_URL ?? '').replace(/\/$/, '');
export const TOKEN = process.env.SKITRIP_INGEST_TOKEN ?? '';
export const UA = 'SkiTripBot/2 (recolector privado de baja frecuencia; +https://github.com/Lilru-tech/skitrip)';

export function requireConfig(): boolean {
  if (!API || !TOKEN) {
    console.log('::warning::SKITRIP_API_URL o SKITRIP_INGEST_TOKEN no configurados: no se recolecta nada.');
    return false;
  }
  return true;
}

export async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`POST ${path} → ${r.status} ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

/** robots.txt (RFC 9309, src/core/robots.ts). Sin robots (4xx): todo permitido. Error del servidor o de red: nada permitido. */
const robotsCache = new Map<string, Promise<RobotsRule[] | 'deny-all'>>();
function robotsFor(origin: string) {
  if (!robotsCache.has(origin)) {
    robotsCache.set(origin, (async () => {
      try {
        const r = await fetch(`${origin}/robots.txt`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) });
        if (r.ok) return parseRobots(await r.text());
        return r.status >= 400 && r.status < 500 ? [] : 'deny-all';
      } catch { return 'deny-all'; }
    })());
  }
  return robotsCache.get(origin)!;
}
export async function allowedByRobots(url: string): Promise<boolean> {
  const u = new URL(url);
  const rules = await robotsFor(u.origin);
  return rules !== 'deny-all' && robotsAllows(rules, u.pathname + u.search);
}

export class BlockedError extends Error {}

/** Señales de bloqueo (src/core/blocked.ts): se para en lugar de insistir o evadir. */
export { detectBlock, looksBlocked } from '../../src/core/blocked.ts';

/** Reintentos acotados con espera progresiva. Un bloqueo no se reintenta. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 2, baseMs = 3000): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) {
      if (e instanceof BlockedError) throw e;
      last = e;
      if (i < attempts - 1) await sleep(baseMs * 2 ** i);
    }
  }
  throw last;
}

/** Carga una página con un único navegador compartido (nunca uno por usuario ni por tarjeta). */
export async function withBrowser<T>(fn: (load: (url: string) => Promise<string>) => Promise<T>): Promise<T> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    const ctx = await browser.newContext({ locale: 'es-ES', userAgent: UA });
    const page = await ctx.newPage();
    // Lo que la página pide al renderizarse (XHR, fetch, documentos) también respeta el robots.txt de su host:
    // p. ej. Esquiades prohíbe /*/hotel/offer/load, así que esas ofertas no se cargan en lugar de leerse igualmente.
    let refused: string[] = [];
    await page.route('**/*', async (route) => {
      const req = route.request();
      if (['document', 'xhr', 'fetch'].includes(req.resourceType()) && /^https?:/.test(req.url()) && !(await allowedByRobots(req.url()))) {
        refused.push(new URL(req.url()).pathname);
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });
    const load = async (url: string) => {
      refused = [];
      const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
      const html = await page.content();
      const block = detectBlock(res?.status() ?? 0, html);
      if (block.blocked) throw new BlockedError(`bloqueado o CAPTCHA en ${new URL(url).host}: ${block.reason}`);
      if (refused.length) console.log(`${url}: ${refused.length} peticiones no cargadas por robots.txt (${[...new Set(refused)].slice(0, 3).join(', ')})`);
      return html;
    };
    return await fn(load);
  } finally {
    await browser.close();
  }
}

export function runId(pipeline: string) {
  return `${pipeline}:${process.env.GITHUB_RUN_ID ?? 'local'}:${process.env.GITHUB_RUN_ATTEMPT ?? '1'}:${Date.now()}`;
}
