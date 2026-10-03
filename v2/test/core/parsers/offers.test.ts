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
import estMolina from '../../fixtures/parsers/estiber-la-molina.reconstruido.html?raw';

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

describe('revisión final 1 · el deduplicado conserva las condiciones que distinguen una serie', () => {
  const art = (cond: string, id = 'hotel1') => `<article data-offer-id="${id}"><h3>Hotel Uno</h3><p>${cond}</p><span class="price">200 € por persona</span></article>`;
  const base = 'del 10/12/2026 al 12/12/2026, 2 adultos, sin menores, 1 habitación, 2 noches, sin forfait';
  const kept = (a: string, b: string) => dedupeCards(parseOfferCardsHtml(art(a) + art(b), 'esquiades')).length;
  it('reproducción de la revisión: mismas noches, otras fechas → dos ofertas', () => {
    expect(kept(base, 'del 10/02/2027 al 12/02/2027, 2 adultos, sin menores, 1 habitación, 2 noches, sin forfait')).toBe(2);
  });
  it('edades de menores distintas, habitaciones distintas y forfait desconocido frente a «sin forfait» → dos ofertas', () => {
    expect(kept('del 10/12/2026 al 12/12/2026, 2 adultos y 2 niños de 6 y 9 años, 2 noches', 'del 10/12/2026 al 12/12/2026, 2 adultos y 2 niños de 4 y 9 años, 2 noches')).toBe(2);
    expect(kept(base, base.replace('1 habitación', '2 habitaciones'))).toBe(2);
    expect(kept(base, base.replace(', sin forfait', ''))).toBe(2);
  });
  it('un duplicado real sigue sin duplicarse (también con edades en otro orden)', () => {
    expect(kept(base, base)).toBe(1);
    expect(kept('2 adultos y 2 niños de 9 y 10 años, 2 noches', '2 adultos y 2 niños de 10 y 9 años, 2 noches')).toBe(1);
  });
  it('la carga que envía el recolector conserva las dos ofertas y sus condiciones', async () => {
    const { cardToOffer } = await import('../../../tools/collectors/offer-payload');
    const cards = dedupeCards(parseOfferCardsHtml(art(base) + art(base.replace('10/12/2026 al 12/12/2026', '10/02/2027 al 12/02/2027')), 'esquiades'));
    const sent = cards.map((c) => cardToOffer(c, 't@1'));
    expect(sent.map((o) => [o.checkIn, o.checkOut, o.forfaitIncluded, o.rooms])).toEqual([['2026-12-10', '2026-12-12', 'no', 1], ['2027-02-10', '2027-02-12', 'no', 1]]);
  });
});

describe('publicación · precio rebajado sin marca de tachado (texto real de Estiber, 01/10/2026)', () => {
  // Texto de tarjeta observado con una herramienta de lectura web (no es el HTML crudo; el marcado aquí es supuesto).
  const card = (body: string) => `<div class="oferta"><h3>Hotel Sarao</h3><p>${body}</p></div>`;

  it('toma el precio rebajado cuando el descuento declarado cuadra con los dos importes', () => {
    const [c] = parseOfferCardsHtml(card('-10% 8.6 (37) Hotel Sarao 2 noches del 19/02/2027 al 21/02/2027 Forfait 2 días Por 222€ 199€ por persona'), 'estiber');
    expect(c.amount?.cents).toBe(19900);
    expect(c.unit).toBe('per_person');
    expect(c.ambiguousPrice).toBe(false);
    expect(c.strikethroughIgnored).toBe(true);
    expect(c).toMatchObject({ nights: 2, forfaitDays: 2, checkIn: '2027-02-19', checkOut: '2027-02-21', priceKind: 'advertised_from' });
    expect(c.warnings.join(' ')).toContain('se descarta el anterior 222€');
  });

  it('otro ejemplo real: -7 % de 317 € a 294 €', () => {
    const [c] = parseOfferCardsHtml(card('-7% Hotel 2 noches Forfait 2 días Por 317€ 294€ por persona'), 'estiber');
    expect(c.amount?.cents).toBe(29400);
  });

  it('sin descuento declarado, con un descuento que no cuadra o con un tercer importe, no elige ninguno', () => {
    const none = (t: string) => parseOfferCardsHtml(card(t), 'estiber')[0];
    expect(none('Hotel 2 noches Por 222€ 199€ por persona').amount).toBeNull();
    expect(none('-30% Hotel 2 noches Por 222€ 199€ por persona').amount).toBeNull();
    expect(none('-10% Hotel 2 noches Por 222€ 199€ por persona · suplemento 35€').amount).toBeNull();
    expect(none('-10% Hotel 2 noches Por 199€ 222€ por persona').amount).toBeNull();
  });

  it('una tarjeta con un solo precio no cambia', () => {
    const [c] = parseOfferCardsHtml(card('Basecamps Cerdanya 4 noches del 04/12/2026 al 08/12/2026 Forfait 3 días Por 684€ por persona'), 'estiber');
    expect(c.amount?.cents).toBe(68400);
    expect(c.strikethroughIgnored).toBe(false);
    expect(c).toMatchObject({ nights: 4, forfaitDays: 3, checkIn: '2026-12-04', checkOut: '2026-12-08', unit: 'per_person' });
  });
});

describe('Estiber · estructura «carousel-cell cl-offer-box cl-offer-box-type-hotel» (fixture reconstruido, ver su cabecera)', () => {
  it('reconoce las dos tarjetas de hotel y no el resto del carrusel', () => {
    const cards = parseOfferCardsHtml(estMolina, 'estiber');
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => [c.hotelName, c.nights, c.checkIn, c.checkOut, c.forfaitDays, c.forfaitIncluded, c.amount?.cents, c.unit, c.priceKind])).toEqual([
      ['Basecamps Cerdanya', 4, '2026-12-04', '2026-12-08', 3, 'yes', 68400, 'per_person', 'advertised_from'],
      ['Puigcerdà Park Hotel & Spa', 4, '2026-12-04', '2026-12-08', 3, 'yes', 42100, 'per_person', 'advertised_from'],
    ]);
    // La valoración «8.5 (21)» no se lee como precio ni como parte del nombre; cada tarjeta solo usa su texto.
    expect(cards.every((c) => !c.ambiguousPrice && !c.strikethroughIgnored)).toBe(true);
  });

  it('textos pegados tal como se leyeron («2026Forfait», «díasPor») dentro de un solo nodo', () => {
    const glued = '<div class="carousel-cell cl-offer-box cl-offer-box-type-hotel"><a href="/x">Basecamps Cerdanya 4 noches del 04/12/2026 al 08/12/2026Forfait 3 díasPor 684€ por persona</a></div>';
    const [c] = parseOfferCardsHtml(glued, 'estiber');
    expect(c).toMatchObject({ hotelName: 'Basecamps Cerdanya', nights: 4, checkIn: '2026-12-04', checkOut: '2026-12-08', forfaitDays: 3, unit: 'per_person' });
    expect(c.amount?.cents).toBe(68400);
  });

  it('precio rebajado dentro de la misma estructura: se toma el actual si el descuento cuadra; tarjetas vecinas no se mezclan', () => {
    const cell = (t: string) => `<div class="carousel-cell cl-offer-box cl-offer-box-type-hotel"><a href="/x">${t}</a></div>`;
    const cards = parseOfferCardsHtml(cell('-10% 8.6 (37) Hotel Sarao 2 noches del 19/02/2027 al 21/02/2027Forfait 2 díasPor 222€ 199€ por persona') + cell('Hotel Vecino 2 noches Forfait 2 días Por 150€ por persona'), 'estiber');
    expect(cards.map((c) => [c.hotelName, c.amount?.cents, c.strikethroughIgnored])).toEqual([['Hotel Sarao', 19900, true], ['Hotel Vecino', 15000, false]]);
  });

  it('`carousel-cell` sola no es una tarjeta', () => {
    expect(parseOfferCardsHtml('<div class="carousel-cell"><a href="/f">Forfaits 3 días 120€</a></div><article>x</article>', 'estiber')).toHaveLength(1);
  });

  it('el fixture saneado de una página con estas tarjetas conserva las clases y quita el enlace con parámetros', async () => {
    const { offerCardsFixture } = await import('../../../src/core/parsers/fixture');
    const out = offerCardsFixture(estMolina.replace(/Booking\.CSP/g, 'Booking.CSP?defapt=1575&adu1=2&habs=1'), 'estiber', { sourceId: 'estiber-la-molina', url: 'https://www.estiber.com/es_ES/ofertas-esqui-la-molina', capturedAt: '2026-10-01T12:00:00Z', sha256: '0'.repeat(64) })!;
    expect(out).toContain('class="carousel-cell cl-offer-box cl-offer-box-type-hotel"');
    expect(out).not.toMatch(/defapt|adu1|recaptcha|cl-banner/);
    expect(parseOfferCardsHtml(out, 'estiber').map((c) => c.amount?.cents)).toEqual([68400, 42100]);
  });
});
