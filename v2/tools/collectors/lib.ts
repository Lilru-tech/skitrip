// Utilidades comunes de los recolectores (se ejecutan en GitHub Actions, nunca en el Worker).
import { setTimeout as sleep } from 'node:timers/promises';

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

/** robots.txt mínimo: respeta Disallow del grupo `*` (y del nuestro). Ante error de lectura, no bloquea. */
const robotsCache = new Map<string, string[]>();
export async function allowedByRobots(url: string): Promise<boolean> {
  const u = new URL(url);
  if (!robotsCache.has(u.origin)) {
    const rules: string[] = [];
    try {
      const r = await fetch(`${u.origin}/robots.txt`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) });
      if (r.ok) {
        let applies = false;
        for (const raw of (await r.text()).split('\n')) {
          const line = raw.replace(/#.*/, '').trim();
          const [k, ...v] = line.split(':');
          const val = v.join(':').trim();
          if (/^user-agent$/i.test(k)) applies = val === '*' || /skitrip/i.test(val);
          else if (applies && /^disallow$/i.test(k) && val) rules.push(val);
        }
      }
    } catch { /* sin robots legible */ }
    robotsCache.set(u.origin, rules);
  }
  return !robotsCache.get(u.origin)!.some((p) => u.pathname.startsWith(p.replace(/\*.*$/, '')));
}

export class BlockedError extends Error {}

/** Señales de bloqueo: se para en lugar de insistir o evadir. */
export function looksBlocked(status: number, html: string): boolean {
  return status === 403 || status === 429 || /captcha|are you a robot|access denied|cf-challenge|verifica que eres humano/i.test(html.slice(0, 20_000));
}

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
    const load = async (url: string) => {
      const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
      const html = await page.content();
      if (looksBlocked(res?.status() ?? 0, html)) throw new BlockedError(`bloqueado o CAPTCHA en ${new URL(url).host}`);
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
