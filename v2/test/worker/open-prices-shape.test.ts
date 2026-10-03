// Forma real de la API de Open Prices, contrastada el 01/10/2026 con
// https://prices.openfoodfacts.org/api/v1/prices (respuesta con items, total, page, size, pages).
// El item reproduce los nombres de campo y tipos observados; los valores de tienda son los de un precio público.
import { describe, expect, it } from 'vitest';
import { normalizeOpenPrices } from '../../src/worker/open-prices';

const item = (over: Record<string, unknown>) => ({
  id: 32946, product_id: 1, location_id: 1, proof_id: 1, type: 'PRODUCT', product_code: '4260229231067', product_name: null,
  price: 1.89, price_is_discounted: false, price_without_discount: null, discount_type: null, price_per: null, currency: 'EUR',
  location_osm_id: 1, location_osm_type: 'NODE', date: '2026-09-28', receipt_quantity: null, owner_comment: null, owner: 'x', source: 'web',
  proof: { type: 'PRICE_TAG' },
  location: { osm_name: 'Rossmann', osm_address_city: 'Chemnitz', osm_address_postcode: '09111', osm_address_country: 'Deutschland' },
  ...over,
});

describe('Open Prices · forma real de la respuesta (01/10/2026)', () => {
  it('normaliza los campos observados', () => {
    expect(normalizeOpenPrices({ items: [item({})], total: 1, page: 1, size: 1, pages: 1 })).toEqual([{
      externalId: 32946, amountCents: 189, currency: 'EUR', date: '2026-09-28', discounted: false,
      store: 'Rossmann', city: 'Chemnitz', postalCode: '09111', country: 'Deutschland', proofType: 'PRICE_TAG',
    }]);
  });
  it('la API real devuelve precios con date null: se descartan, no se inventa la fecha', () => {
    expect(normalizeOpenPrices({ items: [item({ date: null })] })).toEqual([]);
  });
  it('otra moneda o respuesta vacía real ({ items: [], total: 0 }) no producen precios', () => {
    expect(normalizeOpenPrices({ items: [item({ currency: 'PLN' })] })).toEqual([]);
    expect(normalizeOpenPrices({ items: [], page: 1, pages: 1, size: 3, total: 0 })).toEqual([]);
  });
});
