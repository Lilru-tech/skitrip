import { describe, expect, it } from 'vitest';
import { legacyPerDay, legacyQty, missingOf, normName, planCopy, tripQty } from '../../src/core/shopping-lists';

describe('hoja antigua', () => {
  it('solo un entero limpio es cantidad; lo demás queda en 1 y marcado como dudoso', () => {
    expect(legacyQty('3')).toEqual({ qty: 3, unclear: false });
    expect(legacyQty(' 24 ')).toEqual({ qty: 24, unclear: false });
    for (const t of ['0', '1,5', '2 packs', '', null, '1000']) expect(legacyQty(t)).toEqual({ qty: 1, unclear: true });
  });
  it('«perDay» solo cuenta si es verdadero explícito', () => {
    expect(legacyPerDay('{"perDay":"TRUE"}')).toBe(true);
    expect(legacyPerDay('{"per_day":"1"}')).toBe(true);
    expect(legacyPerDay('{"perDay":"FALSE"}')).toBe(false);
    expect(legacyPerDay(null)).toBe(false);
    expect(legacyPerDay('no es json')).toBe(false);
  });
});

describe('qué falta', () => {
  it('sin producto no se pide precio ni formato; con producto, formato y precio', () => {
    expect(missingOf({ productId: null, qtyUnclear: true })).toEqual(['product', 'qty']);
    expect(missingOf({ productId: 'p', productFormat: null, productNetQty: null, qtyUnclear: false, priceCount: 0 })).toEqual(['format', 'price']);
    expect(missingOf({ productId: 'p', productFormat: '1 L', qtyUnclear: false, priceCount: 2 })).toEqual([]);
  });
});

describe('copia a un viaje', () => {
  it('«por día» se multiplica por los días de esquí (con tope) y sin días se copia tal cual con aviso', () => {
    expect(tripQty({ qty: 2, perDay: true }, 3)).toEqual({ qty: 6, note: '2 por día × 3 días de esquí' });
    expect(tripQty({ qty: 2, perDay: true }, null).qty).toBe(2);
    expect(tripQty({ qty: 2, perDay: true }, null).note).toMatch(/no tiene días de esquí/);
    expect(tripQty({ qty: 500, perDay: true }, 3).qty).toBe(999);
    expect(tripQty({ qty: 4, perDay: false }, 3)).toEqual({ qty: 4, note: null });
  });

  it('coincidencias por copia previa, producto o nombre (sin tildes ni mayúsculas); cada artículo del viaje se usa una vez', () => {
    expect(normName('  Pán  de MOLDE ')).toBe('pan de molde');
    const general = [
      { id: 'g1', name: 'Leche', productId: 'p1', qty: 1, perDay: false },
      { id: 'g2', name: 'Leche', productId: 'p1', qty: 1, perDay: false },
      { id: 'g3', name: 'Pan de molde', productId: null, qty: 1, perDay: false },
      { id: 'g4', name: 'Huevos', productId: null, qty: 12, perDay: false },
      { id: 'g5', name: 'Agua', productId: 'p9', qty: 1, perDay: false },
    ];
    const trip = [
      { id: 't1', name: 'Leche', productId: 'p1', qty: 2, bought: true, sourceListItemId: null },
      { id: 't2', name: 'pán de molde', productId: null, qty: 1, bought: false, sourceListItemId: null },
      { id: 't3', name: 'Huevos camperos', productId: null, qty: 6, bought: false, sourceListItemId: 'g4' },
      { id: 't4', name: 'Agua', productId: null, qty: 1, bought: false, sourceListItemId: null },
    ];
    const rows = planCopy(general, trip, null);
    expect(rows.map((r) => [r.itemId, r.match?.tripItemId ?? null, r.match?.reason ?? null, r.actions])).toEqual([
      ['g1', 't1', 'same_product', ['skip', 'add']],
      ['g2', null, null, ['add', 'skip']],
      ['g3', 't2', 'same_name', ['skip', 'sum', 'add']],
      ['g4', 't3', 'already_copied', ['skip', 'sum', 'add']],
      // Con producto exacto no se empareja por nombre con un artículo genérico.
      ['g5', null, null, ['add', 'skip']],
    ]);
  });
});
