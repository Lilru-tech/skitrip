// Analítica de precios sin trampas: null no es cero, un hueco no es «ayer», no se interpola
// y solo se comparan observaciones equivalentes (misma oferta, mismo tipo de precio y unidad).

export interface PricePoint {
  observedAt: number;            // epoch ms UTC
  amountCents: number | null;    // null = sin precio (p. ej., no disponible)
  priceKind: string;
  unit: string;
  availability?: 'available' | 'unavailable' | 'unknown';
}

export interface WindowStats { days: number; n: number; minCents: number | null; medianCents: number | null; maxCents: number | null }

export interface OfferPanel {
  last: PricePoint | null;
  lastValid: PricePoint | null;
  previousComparable: PricePoint | null;
  change: { cents: number; pct: number | null; sinceObservedAt: number; gapDays: number } | null;
  windows: WindowStats[];
  samples: number;
  ageHours: number | null;
  warnings: string[];
}

const DAY = 86400_000;

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export const isComparable = (a: PricePoint, b: PricePoint) => a.priceKind === b.priceKind && a.unit === b.unit;

/** Panel de una oferta FIJA (misma identidad de oferta y escenario). */
export function offerPanel(points: readonly PricePoint[], nowMs = Date.now(), windows = [7, 30, 90]): OfferPanel {
  const pts = [...points].sort((a, b) => a.observedAt - b.observedAt);
  const warnings: string[] = [];
  const last = pts.at(-1) ?? null;
  const valid = pts.filter((p) => typeof p.amountCents === 'number');
  const lastValid = valid.at(-1) ?? null;
  let previousComparable: PricePoint | null = null;
  if (lastValid) {
    for (let k = valid.length - 2; k >= 0; k--) if (isComparable(valid[k], lastValid)) { previousComparable = valid[k]; break; }
  }
  let change: OfferPanel['change'] = null;
  if (lastValid && previousComparable) {
    const cents = lastValid.amountCents! - previousComparable.amountCents!;
    const pct = previousComparable.amountCents! > 0 ? Math.round((cents / previousComparable.amountCents!) * 1000) / 10 : null;
    const gapDays = Math.round((lastValid.observedAt - previousComparable.observedAt) / DAY);
    change = { cents, pct, sinceObservedAt: previousComparable.observedAt, gapDays };
    if (gapDays > 1) warnings.push(`La observación comparable anterior es de hace ${gapDays} días, no de ayer.`);
  }
  if (last && last.amountCents == null) warnings.push('La última captura no tiene precio; se muestra el último precio válido con su fecha.');
  if (lastValid && valid.some((p) => !isComparable(p, lastValid))) warnings.push('Hay observaciones con otro tipo de precio o unidad; no se mezclan.');
  const cmp = lastValid ? valid.filter((p) => isComparable(p, lastValid)) : [];
  const ws = windows.map((days) => {
    const inW = cmp.filter((p) => p.observedAt >= nowMs - days * DAY).map((p) => p.amountCents!);
    return { days, n: inW.length, minCents: inW.length ? Math.min(...inW) : null, medianCents: median(inW), maxCents: inW.length ? Math.max(...inW) : null };
  });
  return { last, lastValid, previousComparable, change, windows: ws, samples: cmp.length, ageHours: lastValid ? Math.round((nowMs - lastValid.observedAt) / 3600_000) : null, warnings };
}

/**
 * Distribución de una BÚSQUEDA (varias ofertas a la vez). Indica si la composición cambió respecto a
 * la búsqueda anterior: entonces una bajada del mínimo NO es un descuento del mismo producto.
 */
export function searchDistribution(current: { offerId: string; amountCents: number | null }[], previous?: { offerId: string; amountCents: number | null }[]) {
  const vals = current.map((o) => o.amountCents).filter((v): v is number => typeof v === 'number');
  const res = { n: vals.length, minCents: vals.length ? Math.min(...vals) : null, medianCents: median(vals), maxCents: vals.length ? Math.max(...vals) : null, compositionChanged: false, added: [] as string[], removed: [] as string[] };
  if (previous) {
    const cur = new Set(current.filter((o) => o.amountCents != null).map((o) => o.offerId));
    const prev = new Set(previous.filter((o) => o.amountCents != null).map((o) => o.offerId));
    res.added = [...cur].filter((x) => !prev.has(x));
    res.removed = [...prev].filter((x) => !cur.has(x));
    res.compositionChanged = res.added.length > 0 || res.removed.length > 0;
  }
  return res;
}

/** Estado de frescura según umbral por tipo de dato. */
export function freshness(lastSuccessMs: number | null, thresholdHours: number, nowMs = Date.now()): 'fresh' | 'stale' | 'never' {
  if (lastSuccessMs == null) return 'never';
  return nowMs - lastSuccessMs <= thresholdHours * 3600_000 ? 'fresh' : 'stale';
}

export const STALE_HOURS = { snow: 30, offers: 48, prices: 24 * 14 } as const;
