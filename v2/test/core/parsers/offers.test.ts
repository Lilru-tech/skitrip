import { describe, it, expect } from 'vitest';
import {
  dedupeCards,
  parseOfferCardsHtml,
  perNightFromStay,
  summarize,
  type OfferCard,
} from '../../../src/core/parsers/offers';
import esqHtml from '../../fixtures/parsers/esquiades-offers.html?raw';
import estHtml from '../../fixtures/parsers/estiber-offers.html?raw';

const card = (over: Partial<OfferCard>): OfferCard => ({
  provider: 'esquiades', providerOfferId: null, hotelName: 'Hotel X', board: 'half_board', nights: 2, forfaitDays: 1,
  adults: 2, childrenAges: null, rooms: null, checkIn: null, checkOut: null, forfaitIncluded: 'yes', cancellation: null, priceText: '100 €',
  amount: { cents: 10000, currency: 'EUR' }, unit: 'per_person', priceKind: 'advertised_from', saysFrom: false, ambiguousPrice: false, strikethroughIgnored: false, url: null, warnings: [], ...over,
});

describe('parseOfferCardsHtml (esquiades)', () => {
  const cards = parseOfferCardsHtml(esqHtml, 'esquiades');

  it('one card per card element; page banner outside cards is ignored', () => {
    expect(cards).toHaveLength(4);
    expect(cards.map((c) => c.providerOfferId)).toEqual(['ESQ-1001', 'ESQ-1002', 'ESQ-1003', 'ESQ-1003']);
  });
  it('thousands + decimals, strikethrough ignored, "desde" → advertised_from, total estancia → per_stay', () => {
    expect(cards[0]).toMatchObject({
      hotelName: 'Hotel Grau Roig', board: 'half_board', nights: 2, forfaitDays: 1, adults: 2, cancellation: 'free',
      priceText: '1.234,56 €', amount: { cents: 123456, currency: 'EUR' }, unit: 'per_stay',
      priceKind: 'advertised_from', strikethroughIgnored: true, url: '/viajes-esqui/hotel-grau-roig-1001',
    });
  });
  it('a card without price gets null — neighbour prices never leak', () => {
    expect(cards[1]).toMatchObject({ hotelName: 'Apartamentos Sin Precio', amount: null, priceText: null, forfaitDays: 1, board: 'room_only' });
    expect(cards[1].warnings).toContain('Sin precio en la tarjeta.');
  });
  it('<del> old price ignored; "precio por persona" → per_person; 1 día forfait accepted', () => {
    expect(cards[2]).toMatchObject({ amount: { cents: 12900 }, unit: 'per_person', nights: 1, forfaitDays: 1, strikethroughIgnored: true, priceKind: 'advertised_from' }); // revisión 30/09: sin «desde» NO basta para ser cotización
  });
  it('does not leak a strikethrough price when it is the only one', () => {
    const html = '<article class="hotel-card"><h3>H</h3><span class="price old-price">200 €</span><s>180 €</s><span style="text-decoration: line-through">170 €</span><span class="precio-tachado">160 €</span></article>'
      + '<article class="hotel-card"><h3>J</h3><span class="price">99 €</span></article>';
    const [a, b] = parseOfferCardsHtml(html, 'esquiades');
    expect(a.amount).toBeNull();
    expect(a.strikethroughIgnored).toBe(true);
    expect(b.amount?.cents).toBe(9900);
  });
});

describe('parseOfferCardsHtml (estiber)', () => {
  const cards = parseOfferCardsHtml(estHtml, 'estiber');
  it('parses each .oferta; "precio-antes" treated as old price; forfait 1 día', () => {
    expect(cards).toHaveLength(4);
    expect(cards[0]).toMatchObject({
      providerOfferId: 'EST-77', hotelName: 'Hotel Formigal', amount: { cents: 21000 }, unit: 'per_person',
      nights: 2, forfaitDays: 1, board: 'half_board', cancellation: 'free', strikethroughIgnored: true,
      url: 'https://www.estiber.com/es_ES/hotel-formigal?id=77&n=2',
    });
    expect(cards[3]).toMatchObject({ unit: 'per_person_night', adults: 3, amount: { cents: 9500 }, forfaitDays: null });
  });
  it('same hotel with different cancellation / board is not deduped', () => {
    expect(dedupeCards(cards)).toHaveLength(4);
  });
});

describe('dedupeCards', () => {
  it('dedupes by identity + conditions, never by price', () => {
    const esq = parseOfferCardsHtml(esqHtml, 'esquiades');
    const d = dedupeCards(esq);
    expect(d).toHaveLength(3); // ESQ-1003 twice (129 € y 131 €) → uno
    expect(d[2].amount?.cents).toBe(12900);
  });
  it('same price, different hotels → both kept', () => {
    expect(dedupeCards([card({ hotelName: 'A' }), card({ hotelName: 'B' })])).toHaveLength(2);
  });
  it('same hotel, different nights/unit/adults → kept', () => {
    expect(dedupeCards([card({}), card({ nights: 3 }), card({ unit: 'per_room' }), card({ adults: 3 }), card({})])).toHaveLength(4);
  });
  it('cards without identity are never merged', () => {
    expect(dedupeCards([card({ hotelName: null }), card({ hotelName: null })])).toHaveLength(2);
  });
});

describe('perNightFromStay', () => {
  it('1.234,56 € / 2 noches = 617,28 €', () => {
    expect(perNightFromStay(123456, 2)).toBe(61728);
    expect(perNightFromStay(1000, 3)).toBe(333);
    expect(perNightFromStay(1000, 0)).toBeNull();
    expect(perNightFromStay(1000, 1.5)).toBeNull();
  });
});

describe('summarize', () => {
  it('single offer → n=1', () => {
    expect(summarize([card({})])).toEqual({ n: 1, minCents: 10000, medianCents: 10000, maxCents: 10000, unit: 'per_person', adults: 2, mixed: false });
  });
  it('min/median/max with odd and even n; unknown amounts excluded', () => {
    const s = summarize([card({ amount: { cents: 300, currency: 'EUR' } }), card({ amount: { cents: 100, currency: 'EUR' } }), card({ amount: { cents: 200, currency: 'EUR' } }), card({ amount: null })]);
    expect(s).toMatchObject({ n: 3, minCents: 100, medianCents: 200, maxCents: 300 });
    expect(summarize([card({ amount: { cents: 100, currency: 'EUR' } }), card({ amount: { cents: 201, currency: 'EUR' } })]).medianCents).toBe(151);
  });
  it('different units or occupancy are never mixed', () => {
    const cards = [card({}), card({ unit: 'per_stay', amount: { cents: 50000, currency: 'EUR' } }), card({ adults: 3, amount: { cents: 9000, currency: 'EUR' } })];
    expect(summarize(cards)).toMatchObject({ n: 0, mixed: true, minCents: null });
    expect(summarize(cards, { unit: 'per_stay' })).toMatchObject({ n: 1, minCents: 50000, mixed: true });
    expect(summarize(cards, { unit: 'per_person', adults: 3 })).toMatchObject({ n: 1, minCents: 9000 });
    expect(summarize(cards, { unit: 'per_person' })).toMatchObject({ n: 0, mixed: true }); // 2 y 3 adultos
  });
  it('unknown unit only when explicitly requested', () => {
    expect(summarize([card({ unit: 'unknown' })]).n).toBe(0);
    expect(summarize([card({ unit: 'unknown' })], { unit: 'unknown' }).n).toBe(1);
  });
});

describe('revisión 5 · tipo de precio y modalidad', () => {
  it('una tarjeta de catálogo sin «desde» sigue siendo orientativa si no declara fechas y ocupación completas', () => {
    const cards = parseOfferCardsHtml(esqHtml, 'esquiades');
    expect(cards[2]).toMatchObject({ priceKind: 'advertised_from', saysFrom: false, checkIn: null, checkOut: null });
    expect(cards[2].warnings.join(' ')).toMatch(/orientativo/);
    expect(cards.every((c) => c.priceKind === 'advertised_from')).toBe(true);
  });
  it('solo con fechas, adultos y menores declarados en la tarjeta y sin «desde» se marca como cotización candidata', () => {
    const html = '<article class="hotel-card" data-offer-id="Q1"><h3>Hotel Q</h3><p>Del 10/12/2026 al 12/12/2026 · 2 adultos · sin niños · 1 habitación · forfait 2 días incluido</p><span class="price">300 €</span><span>por persona</span></article>';
    const [c] = parseOfferCardsHtml(html, 'esquiades');
    expect(c).toMatchObject({ checkIn: '2026-12-10', checkOut: '2026-12-12', adults: 2, childrenAges: [], rooms: 1, forfaitDays: 2, forfaitIncluded: 'yes', priceKind: 'quoted_for_search' });
    const [d] = parseOfferCardsHtml(html.replace('sin niños · ', ''), 'esquiades');
    expect(d).toMatchObject({ childrenAges: null, priceKind: 'advertised_from' }); // menores desconocidos
    const [e] = parseOfferCardsHtml(html.replace('2 adultos · sin niños', '2 adultos y 2 niños de 6 y 9 años'), 'esquiades');
    expect(e.childrenAges).toEqual([6, 9]);
  });
  it('forfait: sin mención es desconocido (no «solo alojamiento»); contradicciones quedan desconocidas con aviso', () => {
    const est = parseOfferCardsHtml(estHtml, 'estiber');
    expect(est[0].forfaitIncluded).toBe('yes');
    expect(est[3]).toMatchObject({ forfaitDays: null, forfaitIncluded: 'unknown' });
    const esq = parseOfferCardsHtml(esqHtml, 'esquiades');
    expect(esq[1].forfaitIncluded).toBe('unknown'); // «forfait 1 día» y «Solo alojamiento» a la vez
    expect(esq[1].warnings.join(' ')).toMatch(/forfait/i);
    const [solo] = parseOfferCardsHtml('<article class="hotel-card"><h3>H</h3><p>Sin forfait · 2 noches</p><span class="price">80 €</span></article>', 'esquiades');
    expect(solo.forfaitIncluded).toBe('no');
  });
  it('varios precios distintos: no se elige el primero; importe nulo, precio ambiguo y aviso conservado', () => {
    const [c] = parseOfferCardsHtml('<article class="hotel-card"><h3>H</h3><span class="price">120 €</span><span class="price">240 €</span></article>', 'esquiades');
    expect(c).toMatchObject({ amount: null, ambiguousPrice: true });
    expect(c.warnings.join(' ')).toMatch(/Varios precios/);
    expect(c.warnings.join(' ')).toMatch(/120/);
  });
});
