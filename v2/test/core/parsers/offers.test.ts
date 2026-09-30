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
  adults: 2, cancellation: null, priceText: '100 €', amount: { cents: 10000, currency: 'EUR' }, unit: 'per_person',
  priceKind: 'quoted_for_search', strikethroughIgnored: false, url: null, warnings: [], ...over,
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
    expect(cards[2]).toMatchObject({ amount: { cents: 12900 }, unit: 'per_person', nights: 1, forfaitDays: 1, strikethroughIgnored: true, priceKind: 'quoted_for_search' });
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
