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
 *  - Escenarios de viaje (fechas + ocupación concretas): hasta verificar el formato de URL de búsqueda de cada
 *    proveedor se informan como «unsupported». Nunca se reinterpreta un precio de catálogo como precio de un escenario.
 */
import { readFileSync } from 'node:fs';
import { dedupeCards, parseOfferCardsHtml, type OfferCard, type Provider } from '../../src/core/parsers/offers.ts';
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

/** Solo búsquedas cuyo formato de URL por fechas/ocupación se ha verificado a mano. Vacío a propósito. */
const SCENARIO_SEARCH: Partial<Record<string, (s: Scenario) => string>> = {};

export function cardToOffer(c: OfferCard, extractor: string) {
  return {
    providerOfferId: c.providerOfferId, hotelName: c.hotelName, board: c.board, nights: c.nights, forfaitDays: c.forfaitDays, adults: c.adults,
    cancellation: c.cancellation, unit: c.unit, priceKind: c.priceKind, amountCents: c.amount?.cents ?? null,
    availability: c.amount ? 'available' as const : 'unknown' as const, url: c.url && /^https?:\/\//.test(c.url) ? c.url.slice(0, 500) : null, extractor,
  };
}

if (!requireConfig()) process.exit(0);
const started = Date.now();
const [{ sources }, { scenarios }] = await Promise.all([
  apiGet<{ sources: Source[] }>('/api/ingest/offer-sources'),
  apiGet<{ scenarios: Scenario[] }>('/api/ingest/scenarios'),
]);

const catalog: { sourceId: string; outcome: Outcome; offers: ReturnType<typeof cardToOffer>[] }[] = [];
const health: { sourceId: string; status: Exclude<Outcome, 'results'> | 'ok'; error: string | null; attemptedAt: number }[] = [];
let ok = 0, failed = 0, unsupported = 0;

async function processSource(load: ((url: string) => Promise<string>) | null, s: Source) {
  const attemptedAt = Date.now();
  const ad = ADAPTERS[s.adapter];
  const done = (outcome: Outcome, offers: ReturnType<typeof cardToOffer>[], error: string | null) => {
    catalog.push({ sourceId: s.id, outcome, offers });
    health.push({ sourceId: s.id, status: outcome === 'results' ? 'ok' : outcome, error, attemptedAt });
    if (outcome === 'results') ok++; else if (outcome === 'unsupported') unsupported++; else failed++;
  };
  if (!ad) return done('unsupported', [], `sin adaptador ${s.adapter}`);
  if (useFixtures && !fixtures[ad.provider]) return done('unsupported', [], 'sin fixture para este proveedor');
  try {
    if (!useFixtures && !(await allowedByRobots(s.url))) return done('unsupported', [], 'robots.txt no lo permite');
    const html = useFixtures ? readFileSync(fixtures[ad.provider]!, 'utf8') : await withRetry(() => load!(s.url));
    const cards = dedupeCards(parseOfferCardsHtml(html, ad.provider)).filter((c) => c.amount);
    if (!cards.length) return done('empty', [], 'la página no devolvió ofertas con precio reconocible');
    const extractor = `${s.adapter}@${ad.version}`;
    done('results', cards.slice(0, MAX_OFFERS_PER_SOURCE).map((c) => cardToOffer(c, extractor)), null);
  } catch (e) {
    done(e instanceof BlockedError ? 'blocked' : 'error', [], String((e as Error).message).slice(0, 300));
  }
}

try {
  if (useFixtures) for (const s of sources) await processSource(null, s);
  else await withBrowser(async (load) => { for (const s of sources) await processSource(load, s); }); // concurrencia 1
} catch (e) {
  console.error('Fallo general del navegador:', (e as Error).message);
  for (const s of sources) if (!catalog.some((c) => c.sourceId === s.id)) { catalog.push({ sourceId: s.id, outcome: 'error', offers: [] }); failed++; }
}

const results = scenarios.map((sc) => {
  const build = SCENARIO_SEARCH[sc.provider_id];
  unsupported++;
  return { scenarioId: sc.id, outcome: 'unsupported' as const, error: build ? 'búsqueda pendiente de implementar' : `sin formato de búsqueda verificado para ${sc.provider_id}`, offers: [] };
});

const run = { id: runId('offers'), pipeline: 'offers', startedAt: started, finishedAt: Date.now(), expected: sources.length + scenarios.length, ok, failed, unsupported,
  runner: process.env.GITHUB_RUN_ID ? `github-actions#${process.env.GITHUB_RUN_ID}` : 'local',
  errorSummary: failed ? health.filter((h) => h.status !== 'ok' && h.status !== 'unsupported').slice(0, 10).map((h) => `${h.sourceId}: ${h.error}`).join(' | ') : null };
console.log(`Fuentes de catálogo: ${sources.length} · válidas ${ok} · fallidas ${failed} · escenarios ${scenarios.length} (no soportados aún)`);
const payload = { run, observedAt: Date.now(), results, catalog, health };
if (dry) { console.log(JSON.stringify(payload, null, 2)); process.exit(0); }
const res = await apiPost<{ written: number; runStatus: string }>('/api/ingest/offers', payload);
console.log(`Observaciones escritas ${res.written}, estado ${res.runStatus}`);
if (sources.length && ok === 0) { console.log('::error::Ninguna fuente de ofertas devolvió datos válidos.'); process.exit(1); }
