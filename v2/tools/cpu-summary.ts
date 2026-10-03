// Resumen de CPU del Worker (workflow «v2 · medir CPU» y «v2 · vigilar»).
//
//   npx tsx tools/cpu-summary.ts probe cpu-windows.json [tail.jsonl]   # ventanas de la medición controlada
//   npx tsx tools/cpu-summary.ts history 48                            # minutos con más CPU en las últimas N horas
//
// Fuentes gratuitas: `wrangler tail --format json` (CPU y tiempo real de cada petición, si el runtime los incluye) y la
// analítica GraphQL de Cloudflare (workersInvocationsAdaptive: percentiles de CPU y estados, sin ruta). Solo imprime
// métodos, rutas normalizadas y cifras: nunca cabeceras, cuerpos ni registros completos.
import { readFileSync, existsSync } from 'node:fs';

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? '';
const [mode, ...rest] = process.argv.slice(2);

export async function graphql(query: string, variables: Record<string, unknown>) {
  const r = await fetch('https://api.cloudflare.com/client/v4/graphql', { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  const j: any = await r.json();
  if (j.errors?.length) throw new Error(`analítica de Cloudflare: ${j.errors[0].message}`);
  return j.data.viewer.accounts[0];
}

const Q_WINDOW = `query($a:String!,$s:Time!,$u:Time!){viewer{accounts(filter:{accountTag:$a}){workersInvocationsAdaptive(limit:20,filter:{scriptName:"skitrip",datetime_geq:$s,datetime_leq:$u}){sum{requests errors} quantiles{cpuTimeP50 cpuTimeP99 cpuTimeP999} dimensions{status}}}}}`;
const Q_MINUTES = `query($a:String!,$s:Time!,$u:Time!){viewer{accounts(filter:{accountTag:$a}){workersInvocationsAdaptive(limit:10000,filter:{scriptName:"skitrip",datetime_geq:$s,datetime_leq:$u}){sum{requests errors} quantiles{cpuTimeP50 cpuTimeP99 cpuTimeP999} dimensions{datetimeMinute status}}}}}`;

const ms = (us: number | undefined) => (us == null ? '—' : (us / 1000).toFixed(1));
const pct = (xs: number[], p: number) => { if (!xs.length) return undefined; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
export const normPath = (url: string) => {
  const u = new URL(url);
  return u.pathname.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '/:id').replace(/\/[A-Za-z0-9_-]{20,}/g, '/:id');
};

/** Lee la salida de `wrangler tail --format json` (objetos JSON seguidos, con o sin saltos de línea). */
export function parseTail(text: string): any[] {
  const out: any[] = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') { if (depth++ === 0) start = i; }
    else if (ch === '}' && depth > 0 && --depth === 0) { try { out.push(JSON.parse(text.slice(start, i + 1))); } catch { /* línea ajena */ } }
  }
  return out;
}

async function probe(windowsFile: string, tailFile?: string) {
  const windows: { label: string; method: string; path: string; n: number; start: string; end: string; statuses: number[] }[] = JSON.parse(readFileSync(windowsFile, 'utf8'));
  const events = tailFile && existsSync(tailFile) ? parseTail(readFileSync(tailFile, 'utf8')).filter((e) => e?.event?.request?.url) : [];
  const withCpu = events.filter((e) => typeof e.cpuTime === 'number');
  console.log(`Eventos de wrangler tail: ${events.length} (con cpuTime: ${withCpu.length})`);
  console.log('\n| Grupo | Ruta | n | HTTP | CPU tail p50 / máx (ms) | Real tail p50 (ms) | CPU analítica p50 / p99 / p99.9 (ms) | Estados |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const w of windows) {
    const t0 = Date.parse(w.start) - 500, t1 = Date.parse(w.end) + 1500;
    const evs = events.filter((e) => e.eventTimestamp >= t0 && e.eventTimestamp <= t1 && e.event.request.method === w.method && normPath(e.event.request.url) === normPath(`https://x${w.path.split('?')[0]}`));
    const cpu = evs.map((e) => e.cpuTime).filter((x) => typeof x === 'number');
    const wall = evs.map((e) => e.wallTime).filter((x) => typeof x === 'number');
    let an = '—', st = '—';
    if (TOKEN && ACCOUNT) {
      try {
        const rows = (await graphql(Q_WINDOW, { a: ACCOUNT, s: new Date(t0 - 1000).toISOString().replace(/\.\d+Z$/, 'Z'), u: new Date(t1 + 1000).toISOString().replace(/\.\d+Z$/, 'Z') })).workersInvocationsAdaptive as any[];
        const req = rows.reduce((s, r) => s + r.sum.requests, 0);
        const top = rows.sort((a, b) => b.sum.requests - a.sum.requests)[0];
        if (top) an = `${ms(top.quantiles.cpuTimeP50)} / ${ms(top.quantiles.cpuTimeP99)} / ${ms(top.quantiles.cpuTimeP999)} (${req} pet.)`;
        st = rows.map((r) => `${r.dimensions.status}×${r.sum.requests}`).join(' ') || '—';
      } catch (e) { an = String((e as Error).message).slice(0, 60); }
    }
    const http = [...new Set(w.statuses)].join('/');
    console.log(`| ${w.label} | ${w.method} ${w.path.split('?')[0]} | ${w.n} | ${http} | ${cpu.length ? `${pct(cpu, 50)} / ${Math.max(...cpu)}` : '—'} | ${wall.length ? pct(wall, 50) : '—'} | ${an} | ${st} |`);
  }
  // Peticiones del tail fuera de las ventanas (p. ej. recolectores lanzados durante la medición).
  if (withCpu.length) {
    const by = new Map<string, number[]>();
    for (const e of withCpu) { const k = `${e.event.request.method} ${normPath(e.event.request.url)}`; (by.get(k) ?? by.set(k, []).get(k)!).push(e.cpuTime); }
    console.log('\nCPU por ruta en todo el tail (ms): ruta · n · p50 · p99 · máx · >10 ms');
    for (const [k, xs] of [...by].sort((a, b) => Math.max(...b[1]) - Math.max(...a[1]))) console.log(`${k} · ${xs.length} · ${pct(xs, 50)} · ${pct(xs, 99)} · ${Math.max(...xs)} · ${xs.filter((x) => x > 10).length}`);
    const outcomes = new Map<string, number>();
    for (const e of events) outcomes.set(e.outcome, (outcomes.get(e.outcome) ?? 0) + 1);
    console.log(`Resultados (outcome): ${[...outcomes].map(([k, v]) => `${k}×${v}`).join(' ')}`);
  }
}

async function history(hours: number) {
  const u = new Date(), s = new Date(u.getTime() - hours * 3600e3);
  const rows = (await graphql(Q_MINUTES, { a: ACCOUNT, s: s.toISOString().replace(/\.\d+Z$/, 'Z'), u: u.toISOString().replace(/\.\d+Z$/, 'Z') })).workersInvocationsAdaptive as any[];
  const status = new Map<string, number>();
  for (const r of rows) status.set(r.dimensions.status, (status.get(r.dimensions.status) ?? 0) + r.sum.requests);
  console.log(`Últimas ${hours} h: ${rows.reduce((a, r) => a + r.sum.requests, 0)} peticiones · estados: ${[...status].map(([k, v]) => `${k}×${v}`).join(' ')}`);
  console.log('\nMinutos con más CPU (UTC) · peticiones · p50 · p99 · p99.9 (ms) · estado');
  for (const r of rows.sort((a, b) => b.quantiles.cpuTimeP999 - a.quantiles.cpuTimeP999).slice(0, 20)) {
    console.log(`${r.dimensions.datetimeMinute} · ${r.sum.requests} · ${ms(r.quantiles.cpuTimeP50)} · ${ms(r.quantiles.cpuTimeP99)} · ${ms(r.quantiles.cpuTimeP999)} · ${r.dimensions.status}`);
  }
}

if (mode === 'probe') await probe(rest[0] ?? 'cpu-windows.json', rest[1]);
else if (mode === 'history') await history(Number(rest[0] ?? 48));
else if (mode) { console.error('Uso: cpu-summary.ts probe <ventanas> [tail] | history <horas>'); process.exit(2); }
