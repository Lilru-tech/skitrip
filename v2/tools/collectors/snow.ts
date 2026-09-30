#!/usr/bin/env -S npx tsx
/**
 * Recolector de nieve. Uso:
 *   SKITRIP_API_URL=… SKITRIP_INGEST_TOKEN=… npx tsx tools/collectors/snow.ts
 *   … --fixture test/fixtures/parsers/esquiades-estado-pistas.html   (sin red: analiza un fichero local)
 *   … --dry-run                                                       (no envía nada)
 * Una fuente que falla no cancela las demás; cada fuente informa su estado.
 */
import { readFileSync } from 'node:fs';
import { esquiadesAdapter, matchResortRow, type StatusRow } from '../../src/core/parsers/snow.ts';
import { allowedByRobots, apiGet, apiPost, BlockedError, requireConfig, runId, withBrowser, withRetry } from './lib.ts';

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
const health: { sourceId: string; status: string; error: string | null; attemptedAt: number }[] = [];
let ok = 0, failed = 0, unsupported = 0;

async function processGroup(load: ((url: string) => Promise<string>) | null, key: string, group: Source[]) {
  const [adapterId, url] = key.split('|');
  const adapter = ADAPTERS[adapterId];
  const attemptedAt = Date.now();
  const mark = (s: Source, status: string, error: string | null) => health.push({ sourceId: s.id, status, error, attemptedAt });
  if (!adapter) { group.forEach((s) => mark(s, 'unsupported', `sin adaptador ${adapterId}`)); unsupported += group.length; return; }
  let rows: StatusRow[];
  try {
    if (!fixture && !(await allowedByRobots(url))) { group.forEach((s) => mark(s, 'unsupported', 'robots.txt no lo permite')); unsupported += group.length; return; }
    const html = fixture ? readFileSync(fixture, 'utf8') : await withRetry(() => load!(url));
    rows = adapter.parse(html);
  } catch (e) {
    const blocked = e instanceof BlockedError;
    group.forEach((s) => mark(s, blocked ? 'blocked' : 'error', String((e as Error).message).slice(0, 300)));
    failed += group.length;
    return;
  }
  if (!rows.length) { group.forEach((s) => mark(s, 'empty', 'la página no devolvió filas reconocibles')); failed += group.length; return; }
  for (const s of group) {
    const aliases: string[] = s.match_aliases ? JSON.parse(s.match_aliases) : [s.area_name];
    // Alias en orden de prioridad, coincidencia exacta; nunca subcadenas.
    let hit: StatusRow | null = null, reason = 'no_match';
    for (const a of aliases) {
      const m = matchResortRow(rows, [a]);
      if (m.match) { hit = m.match; break; }
      if (m.reason === 'ambiguous') { reason = 'ambiguous'; break; }
    }
    if (!hit) { mark(s, 'error', `sin fila (${reason})`); failed++; continue; }
    observations.push({
      sourceId: s.id, areaId: s.scope_area_id, observedAt: Date.now(), sourceDate: null, opStatus: hit.opStatus,
      openKm: hit.openKm, totalKm: hit.totalKm, openRuns: hit.openRuns, totalRuns: hit.totalRuns, extractor: `${adapter.id}@${adapter.version}`,
    });
    mark(s, 'ok', null);
    ok++;
  }
}

try {
  if (fixture) for (const [k, g] of byUrl) await processGroup(null, k, g);
  else await withBrowser(async (load) => { for (const [k, g] of byUrl) await processGroup(load, k, g); }); // concurrencia 1
} catch (e) {
  console.error('Fallo general del navegador:', (e as Error).message);
}

const run = { id: runId('snow'), pipeline: 'snow', startedAt: started, finishedAt: Date.now(), expected: sources.length, ok, failed, unsupported,
  runner: process.env.GITHUB_RUN_ID ? `github-actions#${process.env.GITHUB_RUN_ID}` : 'local', errorSummary: failed ? health.filter((h) => h.status !== 'ok').slice(0, 10).map((h) => `${h.sourceId}: ${h.error}`).join(' | ') : null };
console.log(`Fuentes: ${sources.length} · válidas ${ok} · fallidas ${failed} · no soportadas ${unsupported}`);
if (dry) { console.log(JSON.stringify({ run, observations, health }, null, 2)); process.exit(0); }
const res = await apiPost<{ written: number; rejected: unknown[]; runStatus: string }>('/api/ingest/snow', { run, observations, health });
console.log(`Escritas ${res.written}, rechazadas ${res.rejected.length}, estado ${res.runStatus}`);
if (res.runStatus === 'error' || res.runStatus === 'empty') { console.log('::error::La captura de nieve no produjo datos válidos.'); process.exit(1); }
