// Adaptador de Open Prices (Open Food Facts). Host fijo en el código: el servidor nunca visita URLs
// proporcionadas por el navegador (sin SSRF). Caché en D1 de 7 días para no depender de un tercero.
// Estado: implementado y probado con respuestas simuladas; NO verificado online desde el entorno de desarrollo.
export const OPEN_PRICES_BASE = 'https://prices.openfoodfacts.org/api/v1/prices';
const TTL_MS = 7 * 86400_000;

export interface OpenPriceItem {
  externalId: number;
  amountCents: number;
  currency: string;
  date: string;
  discounted: boolean;
  store: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
  proofType: string | null;
}

export function normalizeOpenPrices(json: any): OpenPriceItem[] {
  const items = Array.isArray(json?.items) ? json.items : [];
  return items
    .filter((i: any) => typeof i?.price === 'number' && Number.isFinite(i.price) && typeof i?.date === 'string')
    .map((i: any) => ({
      externalId: i.id,
      amountCents: Math.round(i.price * 100),
      currency: String(i.currency ?? ''),
      date: i.date,
      discounted: !!i.price_is_discounted,
      store: i.location?.osm_name ?? null,
      city: i.location?.osm_address_city ?? null,
      postalCode: i.location?.osm_address_postcode ?? null,
      country: i.location?.osm_address_country ?? null,
      proofType: i.proof?.type ?? null,
    }))
    .filter((i: OpenPriceItem) => i.currency === 'EUR');
}

export async function fetchOpenPrices(db: D1Database, ean: string, fetcher: typeof fetch = fetch, nowMs = Date.now()) {
  if (!/^\d{8,14}$/.test(ean)) return { status: 'error' as const, items: [], cached: false, fetchedAt: null };
  const cached = await db.prepare('SELECT fetched_at, status, payload FROM open_prices_cache WHERE ean = ?1').bind(ean).first<{ fetched_at: number; status: string; payload: string }>();
  if (cached && nowMs - cached.fetched_at < TTL_MS) {
    return { status: cached.status as 'ok' | 'empty' | 'error', items: JSON.parse(cached.payload) as OpenPriceItem[], cached: true, fetchedAt: cached.fetched_at };
  }
  let status: 'ok' | 'empty' | 'error' = 'error';
  let items: OpenPriceItem[] = [];
  try {
    const url = `${OPEN_PRICES_BASE}?product_code=${ean}&size=50&order_by=-date`;
    const res = await fetcher(url, { headers: { 'User-Agent': 'SkiTrip/2 (uso privado de un grupo; contacto en el repositorio)', Accept: 'application/json' }, signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      items = normalizeOpenPrices(await res.json());
      status = items.length ? 'ok' : 'empty';
    }
  } catch {
    status = 'error';
  }
  // Un error no borra un resultado previo válido: se sirve el anterior marcado con su fecha.
  if (status === 'error' && cached) {
    return { status: cached.status as 'ok' | 'empty' | 'error', items: JSON.parse(cached.payload) as OpenPriceItem[], cached: true, fetchedAt: cached.fetched_at, refreshFailed: true };
  }
  await db.prepare(`INSERT INTO open_prices_cache (ean, fetched_at, status, payload) VALUES (?1, ?2, ?3, ?4)
                    ON CONFLICT (ean) DO UPDATE SET fetched_at = excluded.fetched_at, status = excluded.status, payload = excluded.payload`)
    .bind(ean, nowMs, status, JSON.stringify(items)).run();
  return { status, items, cached: false, fetchedAt: nowMs };
}
