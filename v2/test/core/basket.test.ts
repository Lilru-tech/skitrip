import { describe, expect, it } from 'vitest';
import { availableSeries, basketEvolution, estimate, groupItems, type Criterion, type PriceObs } from '../../src/core/basket';

const C: Criterion = { storeLabel: 'Mercadona online', postalCode: '43007', channel: 'online', priceType: 'shelf' };
let t = 0;
const o = (productId: string, observedOn: string, amountCents: number, over: Partial<PriceObs> = {}): PriceObs =>
  ({ productId, observedOn, amountCents, storeLabel: 'Mercadona online', postalCode: '43007', channel: 'online', priceType: 'shelf', source: 'manual', createdAt: ++t, ...over });

describe('cesta fija', () => {
  it('producto repetido (1 + 2 envases) se agrupa: cobertura 1 y total = 3 × precio', () => {
    expect(groupItems([{ productId: 'a', qty: 1 }, { productId: 'a', qty: 2 }])).toEqual([{ productId: 'a', qty: 3 }]);
    const e = basketEvolution([{ productId: 'a', qty: 1 }, { productId: 'a', qty: 2 }], [o('a', '2026-10-01', 150)], C);
    expect(e.points[0]).toMatchObject({ coverage: 1, totalCents: 450 });
  });
  it('otras tiendas, CP, canal o tipo de precio no entran en la serie', () => {
    const obs = [o('a', '2026-10-01', 100), o('a', '2026-10-02', 90, { storeLabel: 'Mercadona Rambla' }), o('a', '2026-10-03', 80, { channel: 'store' }),
      o('a', '2026-10-04', 70, { postalCode: '08001' }), o('a', '2026-10-05', 60, { priceType: 'promo', promoNote: '2ª unidad -50%' }), o('a', '2026-10-06', 50, { postalCode: null })];
    const e = basketEvolution([{ productId: 'a', qty: 1 }], obs, C);
    expect(e.points.map((p) => p.date)).toEqual(['2026-10-01']);
    expect(availableSeries([{ productId: 'a', qty: 1 }], obs)).toHaveLength(6);
  });
  it('diferencias en € y % contra el punto anterior completo; sin interpolar los huecos', () => {
    const items = [{ productId: 'a', qty: 1 }, { productId: 'b', qty: 2 }];
    const obs = [o('a', '2026-10-01', 100), o('b', '2026-10-01', 200), o('a', '2026-10-08', 110), o('a', '2026-10-15', 120), o('b', '2026-10-15', 190)];
    const e = basketEvolution(items, obs, C);
    expect(e.points).toEqual([
      expect.objectContaining({ date: '2026-10-01', coverage: 1, totalCents: 500, diffCents: null }),
      expect.objectContaining({ date: '2026-10-08', coverage: 0.5, totalCents: null, knownCents: 110, diffCents: null }), // parcial: sin total
      expect.objectContaining({ date: '2026-10-15', coverage: 1, totalCents: 500, diffCents: 0, diffPct: 0, previousDate: '2026-10-01' }),
    ]);
    const a = e.products.find((p) => p.productId === 'a')!;
    expect(a.points.map((p) => [p.date, p.diffCents, p.diffPct])).toEqual([['2026-10-01', null, null], ['2026-10-08', 10, 10], ['2026-10-15', 10, 9.1]]);
  });
  it('cambio de formato: el producto sustituto es otro producto; no se mezcla con el anterior', () => {
    const e = basketEvolution([{ productId: 'leche-1l', qty: 6 }], [o('leche-1l', '2026-10-01', 95), o('leche-1-5l', '2026-10-08', 130)], C);
    expect(e.points).toHaveLength(1);
    expect(e.products[0].points).toHaveLength(1);
  });
  it('dos observaciones el mismo día en la misma serie: vale la última registrada, no la mínima', () => {
    const e = basketEvolution([{ productId: 'a', qty: 1 }], [o('a', '2026-10-01', 120), o('a', '2026-10-01', 100, { createdAt: 0 })], C);
    expect(e.points[0].totalCents).toBe(120);
  });
});

describe('estimación de la lista', () => {
  it('agrupa repetidos, usa la tienda/CP/canal de la lista y marca pendientes los genéricos', () => {
    const r = estimate([{ productId: 'a', qty: 1 }, { productId: 'a', qty: 2 }, { productId: null, qty: 1 }],
      [o('a', '2026-10-01', 150), o('a', '2026-10-05', 99, { storeLabel: 'Otra tienda' })], { storeLabel: 'Mercadona online', postalCode: '43007', channel: 'online' });
    expect(r).toMatchObject({ products: 1, priced: 1, unpriced: 1, knownCents: 450, complete: false, oldestPriceOn: '2026-10-01' });
  });
  it('sin precio de estantería usa el coste efectivo de ticket de la misma tienda, etiquetado', () => {
    const r = estimate([{ productId: 'a', qty: 1 }], [o('a', '2026-10-01', 140, { priceType: 'receipt_effective', source: 'receipt' })], { storeLabel: 'mercadona  ONLINE', postalCode: '43007', channel: 'online' });
    expect(r.byProduct.get('a')).toMatchObject({ amountCents: 140, priceType: 'receipt_effective' });
    expect(r.complete).toBe(true);
  });
});
