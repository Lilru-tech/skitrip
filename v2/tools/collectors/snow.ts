#!/usr/bin/env -S npx tsx
/**
 * Recolector de nieve. Uso:
 *   SKITRIP_API_URL=… SKITRIP_INGEST_TOKEN=… npx tsx tools/collectors/snow.ts
 *   … --fixture test/fixtures/parsers/esquiades-estado-pistas.html   (sin red: analiza un fichero local)
 *   … --dry-run                                                       (no envía nada)
 * Una fuente que falla no cancela las demás; cada fuente informa su estado.
 */
import { readFileSync } from 'node:fs';
import { esquiadesAdapter, type StatusRow } from '../../src/core/parsers/snow.ts';
import { aggregatorSnowOutcome, officialSnowOutcome, snowFailure, type SnowReason } from '../../src/core/snow-outcome.ts';
import { chunkBy } from '../../src/core/chunk.ts';
import { OFFICIAL_ADAPTERS } from '../../src/core/parsers/official-snow.ts';
import { apiGet, apiPost, BlockedError, requireConfig, robotsCheck, runId, withBrowser, withRetry } from './lib.ts';

type Source = { id: string; area_id: string; scope_area_id: string; provider: string; url: string; adapter: string; match_aliases: string | null; area_name: string };
const args = process.argv.slice(2);
const fixture = args.includes('--fixture') ? args[args.indexOf('--fixture') + 1] : null;
const dry = args.includes('--dry-run');
const ADAPTERS: Record<string, typeof esquiadesAdapter> = { 'esquiades-status': esquiadesAdapter };

if (!requireConfig()) process.exit(0);
const started = Date.now();
const { sources } = await apiGet<{ sources: Source[] }>('/api/ingest/snow-sources');
const byUrl = new Map<string, Source[]>();
for (const s of sources) (byUrl.get(`${s.adapter}|${s.url}`) ?? byUrl.set(`${s.adapter}|${s.url}`, []).get(`${s.adapter}|${s.url}`)!).push(s);

const observations: unknown[] = [];
const health: { sourceId: string; status: string; reason: SnowReason | null; error: string | null; attemptedAt: number }[] = [];
let ok = 0, failed = 0, unsupported = 0;

async function processGroup(load: ((url: string) => Promise<string>) | null, key: string, group: Source[]) {
  const [adapterId, url] = key.split('|');
  const adapter = ADAPTERS[adapterId];
  const attemptedAt = Date.now();
  // Mismo criterio que la comprobación online y las vistas (core/snow-outcome.ts).
  const mark = (s: Source, o: { status: string; reason: SnowReason | null; error: string | null }) => {
    health.push({ sourceId: s.id, status: o.status, reason: o.status === 'ok' ? null : o.reason, error: o.error, attemptedAt });
    if (o.status === 'ok') ok++; else if (o.status === 'unsupported') unsupported++; else failed++;
  };
  const official = OFFICIAL_ADAPTERS[adapterId];
  if (!official && !adapter) { group.forEach((s) => mark(s, { status: 'unsupported', reason: null, error: `sin adaptador ${adapterId}` })); return; }
  let html: string;
  try {
    const robots = fixture ? null : await robotsCheck(url);
    if (robots?.verdict === 'denied') { group.forEach((s) => mark(s, { status: 'unsupported', reason: null, error: 'robots.txt no lo permite' })); return; }
    if (robots?.verdict === 'unavailable') { group.forEach((s) => mark(s, { status: 'error', reason: 'transport', error: `${robots.detail}: no se carga la página` })); return; }
    html = fixture ? readFileSync(fixture, 'utf8') : await withRetry(() => load!(url));
  } catch (e) {
    const o = snowFailure(e, e instanceof BlockedError);
    group.forEach((s) => mark(s, o));
    return;
  }
  if (official) {
    // Web oficial de una sola estación: una fila por página, sin emparejar nombres.
    let o;
    try { o = officialSnowOutcome(html, official.parse); } catch (e) { o = snowFailure(e, false); }
    for (const s of group) {
      if (o.data) observations.push({ sourceId: s.id, areaId: s.scope_area_id, observedAt: Date.now(), ...o.data, extractor: `${adapterId}@${official.version}` });
      mark(s, o);
    }
    return;
  }
  const rows: StatusRow[] = adapter.parse(html);
  for (const s of group) {
    const aliases: string[] = s.match_aliases ? JSON.parse(s.match_aliases) : [s.area_name];
    const o = aggregatorSnowOutcome(rows, aliases);
    const hit = o.data;
    if (hit) observations.push({
      sourceId: s.id, areaId: s.scope_area_id, observedAt: Date.now(), sourceDate: hit.sourceDate ?? null, opStatus: hit.opStatus,
      openKm: hit.openKm, totalKm: hit.totalKm, openRuns: hit.openRuns, totalRuns: hit.totalRuns, extractor: `${adapter.id}@${adapter.version}`,
    });
    mark(s, o);
  }
}

try {
  if (fixture) for (const [k, g] of byUrl) await processGroup(null, k, g);
  else await withBrowser(async (load) => { for (const [k, g] of byUrl) await processGroup(load, k, g); }); // concurrencia 1
} catch (e) {
  console.error('Fallo general del navegador:', (e as Error).message);
}

// Partes de ≤ 200 fuentes, cada una con su observación y su salud; los recuentos son por parte.
type Obs = { sourceId: string };
const parts = chunkBy(health, () => 1, 200);
const id = runId('snow');
const runner = process.env.GITHUB_RUN_ID ? `github-actions#${process.env.GITHUB_RUN_ID}` : 'local';
const errorSummary = failed ? health.filter((h) => h.status !== 'ok').slice(0, 10).map((h) => `${h.sourceId}: ${h.error}`).join(' | ') : null;
console.log(`Fuentes: ${sources.length} · válidas ${ok} · fallidas ${failed} · no soportadas ${unsupported} · partes ${parts.length}`);
let status = 'ok';
for (const [i, hs] of parts.entries()) {
  const ids = new Set(hs.map((h) => h.sourceId));
  const obs = (observations as Obs[]).filter((o) => ids.has(o.sourceId));
  const n = (st: string) => hs.filter((h) => h.status === st).length;
  const run = { id, pipeline: 'snow', startedAt: started, finishedAt: Date.now(), expected: sources.length, part: i, parts: parts.length,
    ok: n('ok'), failed: hs.length - n('ok') - n('unsupported'), unsupported: n('unsupported'), runner, errorSummary };
  if (dry) { console.log(JSON.stringify({ run, observations: obs, health: hs }, null, 2)); continue; }
  const res = await apiPost<{ written: number; rejected: unknown[]; runStatus: string }>('/api/ingest/snow', { run, observations: obs, health: hs });
  console.log(`Parte ${i + 1}/${parts.length}: escritas ${res.written}, rechazadas ${res.rejected.length}, estado ${res.runStatus}`);
  status = res.runStatus;
}
if (dry) process.exit(0);
if (status === 'error' || status === 'empty') { console.log('::error::La captura de nieve no produjo datos válidos.'); process.exit(1); }
