import { describe, expect, it } from 'vitest';
import { offerPanel, searchDistribution } from '../../src/core/analytics';

const D = 86400_000;
const now = Date.UTC(2027, 0, 20);
const p = (daysAgo: number, amountCents: number | null, extra: Partial<{ priceKind: string; unit: string }> = {}) => ({ observedAt: now - daysAgo * D, amountCents, priceKind: 'quoted_for_search', unit: 'per_person', ...extra });

describe('analítica de precios', () => {
  it('null no es cero: una captura sin precio no se convierte en 0 ni rompe el mínimo', () => {
    const r = offerPanel([p(3, 10000), p(1, null)], now);
    expect(r.lastValid!.amountCents).toBe(10000);
    expect(r.windows[0].minCents).toBe(10000);
    expect(r.warnings.join()).toMatch(/no tiene precio/);
  });
  it('un hueco no es «ayer»: el cambio indica la fecha real de la observación anterior', () => {
    const r = offerPanel([p(10, 10000), p(0, 9000)], now);
    expect(r.change).toMatchObject({ cents: -1000, pct: -10, gapDays: 10 });
    expect(r.warnings.join()).toMatch(/10 días/);
  });
  it('no compara tipos de precio distintos', () => {
    const r = offerPanel([p(2, 5000, { priceKind: 'advertised_from' }), p(1, 9000)], now);
    expect(r.change).toBeNull();
    expect(r.samples).toBe(1);
  });
  it('evita dividir por cero', () => {
    const r = offerPanel([p(2, 0), p(1, 100)], now);
    expect(r.change!.pct).toBeNull();
  });
  it('un cambio de composición de la búsqueda se marca: no es un descuento del mismo producto', () => {
    const r = searchDistribution([{ offerId: 'b', amountCents: 8000 }], [{ offerId: 'a', amountCents: 10000 }]);
    expect(r.compositionChanged).toBe(true);
    expect(r.added).toEqual(['b']);
  });
  it('con una sola oferta muestra n=1', () => {
    expect(searchDistribution([{ offerId: 'a', amountCents: 8000 }]).n).toBe(1);
  });
});
