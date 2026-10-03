// Cesta fija y estimación de la compra. Reglas:
//  - Las filas repetidas de un mismo producto se agrupan ANTES de calcular cobertura y coste (1 + 2 envases = 3).
//  - Una serie es tienda + código postal + canal + tipo de precio. Nunca se mezclan series.
//  - Sin observación en una fecha = sin dato: no se interpola ni se arrastra el precio anterior.
//  - Promociones y descuentos personales son series propias, etiquetadas; nunca entran en el precio de estantería.

export type PriceType = 'shelf' | 'promo' | 'personal_discount' | 'receipt_effective';
export type Channel = 'online' | 'store' | 'unknown';

export interface Criterion { storeLabel: string; postalCode: string | null; channel: Channel; priceType: PriceType }
export interface BasketItem { productId: string; qty: number }
export interface PriceObs {
  productId: string; observedOn: string; amountCents: number; storeLabel: string; postalCode: string | null;
  channel: Channel; priceType: PriceType; source: string; createdAt: number; promoNote?: string | null;
}

const normStore = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
export const seriesKey = (o: { storeLabel: string; postalCode: string | null; channel: Channel; priceType: PriceType }) =>
  JSON.stringify([normStore(o.storeLabel), o.postalCode ?? null, o.channel, o.priceType]);
export const inSeries = (o: PriceObs, c: Criterion) => seriesKey(o) === seriesKey(c);

/** Agrupa filas por producto sumando envases. El orden es el de primera aparición. */
export function groupItems(items: readonly BasketItem[]): BasketItem[] {
  const m = new Map<string, number>();
  for (const i of items) m.set(i.productId, (m.get(i.productId) ?? 0) + i.qty);
  return [...m].map(([productId, qty]) => ({ productId, qty }));
}

/** Observación vigente de un producto en una fecha y serie: la última registrada ese día (no el mínimo). */
function byDateProduct(obs: readonly PriceObs[]) {
  const m = new Map<string, Map<string, PriceObs>>();
  for (const o of obs) {
    const d = m.get(o.observedOn) ?? m.set(o.observedOn, new Map()).get(o.observedOn)!;
    const cur = d.get(o.productId);
    if (!cur || o.createdAt > cur.createdAt) d.set(o.productId, o);
  }
  return m;
}

const pct = (now: number, prev: number) => (prev > 0 ? Math.round(((now - prev) / prev) * 1000) / 10 : null);

export interface BasketPoint {
  date: string; coverage: number; pricedProducts: number; totalCents: number | null; knownCents: number;
  /** Diferencia con el punto anterior COMPLETO de la misma serie (null si este o no hay anterior completo). */
  diffCents: number | null; diffPct: number | null; previousDate: string | null;
}
export interface ProductHistory {
  productId: string; qty: number;
  points: { date: string; amountCents: number; source: string; diffCents: number | null; diffPct: number | null; previousDate: string | null }[];
}

export function basketEvolution(items: readonly BasketItem[], observations: readonly PriceObs[], criterion: Criterion) {
  const basket = groupItems(items);
  const ids = new Set(basket.map((b) => b.productId));
  const obs = observations.filter((o) => ids.has(o.productId) && inSeries(o, criterion));
  const grid = byDateProduct(obs);
  const dates = [...grid.keys()].sort();
  const points: BasketPoint[] = [];
  let prevFull: BasketPoint | null = null;
  for (const date of dates) {
    const day = grid.get(date)!;
    const priced = basket.filter((b) => day.has(b.productId));
    const knownCents = priced.reduce((s, b) => s + day.get(b.productId)!.amountCents * b.qty, 0);
    const full = basket.length > 0 && priced.length === basket.length;
    const p: BasketPoint = {
      date, coverage: basket.length ? priced.length / basket.length : 0, pricedProducts: priced.length,
      totalCents: full ? knownCents : null, knownCents, diffCents: null, diffPct: null, previousDate: null,
    };
    if (full && prevFull) { p.diffCents = knownCents - prevFull.totalCents!; p.diffPct = pct(knownCents, prevFull.totalCents!); p.previousDate = prevFull.date; }
    if (full) prevFull = p;
    points.push(p);
  }
  const products: ProductHistory[] = basket.map((b) => {
    const pts: ProductHistory['points'] = [];
    for (const date of dates) {
      const o = grid.get(date)!.get(b.productId);
      if (!o) continue;
      const prev = pts[pts.length - 1];
      pts.push({ date, amountCents: o.amountCents, source: o.source, diffCents: prev ? o.amountCents - prev.amountCents : null,
        diffPct: prev ? pct(o.amountCents, prev.amountCents) : null, previousDate: prev?.date ?? null });
    }
    return { productId: b.productId, qty: b.qty, points: pts };
  });
  const last = points[points.length - 1] ?? null;
  return { criterion, products, points, latest: last, productsInBasket: basket.length };
}

/** Series disponibles para los productos de la cesta, con cuántos productos cubre y la última fecha. */
export function availableSeries(items: readonly BasketItem[], observations: readonly PriceObs[]) {
  const ids = new Set(items.map((i) => i.productId));
  const m = new Map<string, { criterion: Criterion; products: Set<string>; observations: number; lastDate: string }>();
  for (const o of observations) {
    if (!ids.has(o.productId)) continue;
    const k = seriesKey(o);
    const e = m.get(k) ?? m.set(k, { criterion: { storeLabel: o.storeLabel, postalCode: o.postalCode, channel: o.channel, priceType: o.priceType }, products: new Set(), observations: 0, lastDate: o.observedOn }).get(k)!;
    e.products.add(o.productId); e.observations++;
    if (o.observedOn > e.lastDate) e.lastDate = o.observedOn;
  }
  return [...m.values()].map((e) => ({ ...e.criterion, products: e.products.size, observations: e.observations, lastDate: e.lastDate }))
    .sort((a, b) => b.products - a.products || b.lastDate.localeCompare(a.lastDate));
}

/**
 * Estimación para el presupuesto: por producto agrupado, el último precio de ESTANTERÍA de la tienda/CP/canal de la
 * lista; si no hay, el último coste efectivo de ticket de esa misma tienda/CP/canal (etiquetado). Nunca otra tienda.
 */
export function estimate(items: readonly (BasketItem | { productId: null; qty: number })[], observations: readonly PriceObs[], list: Omit<Criterion, 'priceType'>) {
  const withProduct = items.filter((i): i is BasketItem => i.productId !== null);
  const generic = items.length - withProduct.length;
  const basket = groupItems(withProduct);
  const pick = (pid: string, t: PriceType) => observations
    .filter((o) => o.productId === pid && inSeries(o, { ...list, priceType: t }))
    .sort((a, b) => b.observedOn.localeCompare(a.observedOn) || b.createdAt - a.createdAt)[0] ?? null;
  const byProduct = new Map(basket.map((b) => {
    const o = pick(b.productId, 'shelf') ?? pick(b.productId, 'receipt_effective');
    return [b.productId, o ? { amountCents: o.amountCents, observedOn: o.observedOn, priceType: o.priceType, source: o.source } : null] as const;
  }));
  const priced = basket.filter((b) => byProduct.get(b.productId));
  const knownCents = priced.reduce((s, b) => s + byProduct.get(b.productId)!.amountCents * b.qty, 0);
  return {
    products: basket.length, priced: priced.length, unpriced: basket.length - priced.length + generic, genericItems: generic, knownCents,
    complete: items.length > 0 && generic === 0 && priced.length === basket.length,
    oldestPriceOn: priced.map((b) => byProduct.get(b.productId)!.observedOn).sort()[0] ?? null,
    byProduct,
  };
}
