#!/usr/bin/env -S npx tsx
/**
 * Recolector de ofertas. Uso:
 *   SKITRIP_API_URL=… SKITRIP_INGEST_TOKEN=… npx tsx tools/collectors/offers.ts
 *   … --fixture-esquiades test/fixtures/parsers/esquiades-offers.html --fixture-estiber test/fixtures/parsers/estiber-offers.html
 *   … --dry-run
 *
 * Dos tipos de captura:
 *  - Páginas de catálogo (fuentes kind=offers): precios «desde» con las fechas y ocupación que elige el proveedor.
 *    Se guardan como orientativos, sin escenario.
 *  - Escenarios de viaje (fechas + ocupación concretas): se informan como «unsupported» porque el buscador de cada
 *    proveedor está prohibido en su robots.txt. Nunca se reinterpreta un precio de catálogo como precio de un escenario.
 */
import { readFileSync } from 'node:fs';
import { dedupeCards, forfaitMatchesArea, parseOfferCardsHtml, type OfferCard, type Provider } from '../../src/core/parsers/offers.ts';
import { chunkBy } from '../../src/core/chunk.ts';
import { classifyEmptyOffersPage, EMPTY_REASON_LABEL, EMPTY_REASON_STATUS, type EmptyReason } from '../../src/core/page-outcome.ts';
import { cardToOffer } from './offer-payload.ts';
import { allowedByRobots, apiGet, apiPost, BlockedError, requireConfig, runId, withBrowser, withRetry } from './lib.ts';

type Source = { id: string; area_id: string; scope_area_id: string; provider: string; url: string; adapter: string };
type Scenario = { id: string; provider_id: string; area_id: string; check_in: string; check_out: string; adults: number; source_url: string | null };
type Outcome = 'results' | 'empty' | 'error' | 'blocked' | 'unsupported';

const args = process.argv.slice(2);
const arg = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const fixtures: Partial<Record<Provider, string>> = { esquiades: arg('--fixture-esquiades') ?? undefined, estiber: arg('--fixture-estiber') ?? undefined };
const useFixtures = !!(fixtures.esquiades || fixtures.estiber);
const dry = args.includes('--dry-run');
const ADAPTERS: Record<string, { provider: Provider; version: string }> = {
  'esquiades-cards': { provider: 'esquiades', version: '1' },
  'estiber-cards': { provider: 'estiber', version: '1' },
};
const MAX_OFFERS_PER_SOURCE = 60;

/** Búsquedas por fechas/ocupación automatizables. Vacío a propósito: el buscador de Esquiades (/book/) y el de Estiber
 *  (/csp/online/) están prohibidos en su robots.txt (comprobado el 01/10/2026, docs/SOURCES.md). No se eluden. */
const SCENARIO_SEARCH: Partial<Record<string, (s: Scenario) => string>> = {};
const SEARCH_DISALLOWED: Record<string, string> = { esquiades: '/book/', estiber: '/csp/online/' };

if (!requireConfig()) process.exit(0);
const started = Date.now();
const [{ sources }, { scenarios }] = await Promise.all([
  apiGet<{ sources: Source[] }>('/api/ingest/offer-sources'),
  apiGet<{ scenarios: Scenario[] }>('/api/ingest/scenarios'),
]);

const catalog: { sourceId: string; outcome: Outcome; offers: ReturnType<typeof cardToOffer>[] }[] = [];
const health: { sourceId: string; status: Exclude<Outcome, 'results'> | 'ok'; reason?: EmptyReason; error: string | null; attemptedAt: number }[] = [];
let ok = 0, failed = 0, unsupported = 0;

let confirmedEmpty = 0;
async function processSource(load: ((url: string) => Promise<string>) | null, s: Source, refused: () => string[] = () => []) {
  const attemptedAt = Date.now();
  const ad = ADAPTERS[s.adapter];
  const done = (outcome: Outcome, offers: ReturnType<typeof cardToOffer>[], error: string | null, reason?: EmptyReason) => {
    catalog.push({ sourceId: s.id, outcome, offers });
    health.push({ sourceId: s.id, status: outcome === 'results' ? 'ok' : outcome, ...(reason ? { reason } : {}), error, attemptedAt });
    // Ausencia confirmada o fuera de temporada: ni éxito ni fallo del analizador (cero nunca cuenta como «válida»).
    if (outcome === 'results') ok++; else if (outcome === 'unsupported') unsupported++; else if (outcome === 'empty') confirmedEmpty++; else failed++;
  };
  if (!ad) return done('unsupported', [], `sin adaptador ${s.adapter}`);
  if (useFixtures && !fixtures[ad.provider]) return done('unsupported', [], 'sin fixture para este proveedor');
  try {
    if (!useFixtures && !(await allowedByRobots(s.url))) return done('unsupported', [], 'robots.txt no lo permite');
    const html = useFixtures ? readFileSync(fixtures[ad.provider]!, 'utf8') : await withRetry(() => load!(s.url));
    const priced = dedupeCards(parseOfferCardsHtml(html, ad.provider)).filter((c) => c.amount);
    // Destino: si la tarjeta nombra la estación del forfait y no es la de la fuente, no se guarda (otra estación).
    const cards = priced.filter((c) => forfaitMatchesArea(c, [s.area_id, s.scope_area_id]) !== false);
    if (priced.length && !cards.length) return done('error', [], `las ${priced.length} tarjetas son de otra estación (forfait en «${priced[0].forfaitArea}»)`);
    if (priced.length > cards.length) console.error(`${s.id}: ${priced.length - cards.length} tarjetas descartadas por ser de otra estación`);
    if (!cards.length) {
      const reason = classifyEmptyOffersPage(html, useFixtures ? [] : refused());
      return done(EMPTY_REASON_STATUS[reason], [], EMPTY_REASON_LABEL[reason], reason);
    }
    const extractor = `${s.adapter}@${ad.version}`;
    done('results', cards.slice(0, MAX_OFFERS_PER_SOURCE).map((c) => cardToOffer(c, extractor)), null);
  } catch (e) {
    done(e instanceof BlockedError ? 'blocked' : 'error', [], String((e as Error).message).slice(0, 300));
  }
}

try {
  if (useFixtures) for (const s of sources) await processSource(null, s);
  else await withBrowser(async (load, refused) => { for (const s of sources) await processSource(load, s, refused); }); // concurrencia 1
} catch (e) {
  console.error('Fallo general del navegador:', (e as Error).message);
  for (const s of sources) if (!catalog.some((c) => c.sourceId === s.id)) { catalog.push({ sourceId: s.id, outcome: 'error', offers: [] }); failed++; }
}

const results = scenarios.map((sc) => {
  const build = SCENARIO_SEARCH[sc.provider_id];
  unsupported++;
  return { scenarioId: sc.id, outcome: 'unsupported' as const, error: build ? 'búsqueda pendiente de implementar' : SEARCH_DISALLOWED[sc.provider_id] ? `robots.txt de ${sc.provider_id} prohíbe su buscador (${SEARCH_DISALLOWED[sc.provider_id]}); cotización manual` : `sin búsqueda automatizable para ${sc.provider_id}`, offers: [] };
});

// Partes de ≤ 200 ofertas (límite de la ingesta, que mantiene cada POST por debajo de 50 consultas D1).
// Cada fuente va entera a una parte, con su salud; los recuentos ok/failed/unsupported son por parte.
type Unit = { kind: 'catalog'; c: (typeof catalog)[number] } | { kind: 'scenario'; r: (typeof results)[number] };
const units: Unit[] = [...catalog.map((c) => ({ kind: 'catalog' as const, c })), ...results.map((r) => ({ kind: 'scenario' as const, r }))];
const parts = chunkBy(units, (u) => (u.kind === 'catalog' ? u.c.offers.length : u.r.offers.length), 200, 60);
const id = runId('offers');
const runner = process.env.GITHUB_RUN_ID ? `github-actions#${process.env.GITHUB_RUN_ID}` : 'local';
const errorSummary = failed ? health.filter((h) => h.status === 'error' || h.status === 'blocked').slice(0, 10).map((h) => `${h.sourceId}: ${h.error}`).join(' | ') : null;
console.log(`Fuentes de catálogo: ${sources.length} · válidas ${ok} · sin ofertas confirmado ${confirmedEmpty} · fallidas ${failed} · escenarios ${scenarios.length} (no soportados aún) · partes ${parts.length}`);
const observedAt = Date.now();
let last: { written: number; runStatus: string } | null = null;
for (const [i, part] of parts.entries()) {
  const cat = part.flatMap((u) => (u.kind === 'catalog' ? [u.c] : []));
  const res = part.flatMap((u) => (u.kind === 'scenario' ? [u.r] : []));
  const ids = new Set(cat.map((c) => c.sourceId));
  const count = (o: Outcome) => cat.filter((c) => c.outcome === o).length + res.filter((r) => r.outcome === o).length;
  const run = { id, pipeline: 'offers', startedAt: started, finishedAt: Date.now(), expected: sources.length + scenarios.length, part: i, parts: parts.length,
    ok: count('results'), failed: count('error') + count('blocked'), unsupported: count('unsupported'), runner, errorSummary };
  const payload = { run, observedAt, results: res, catalog: cat, health: health.filter((h) => ids.has(h.sourceId)) };
  if (dry) { console.log(JSON.stringify(payload, null, 2)); continue; }
  last = await apiPost<{ written: number; runStatus: string }>('/api/ingest/offers', payload); // reintentable: idempotente por parte
  console.log(`Parte ${i + 1}/${parts.length}: observaciones escritas ${last.written}, estado ${last.runStatus}`);
}
if (dry) process.exit(0);
if (sources.length && ok === 0) { console.log('::error::Ninguna fuente de ofertas devolvió datos válidos.'); process.exit(1); }
