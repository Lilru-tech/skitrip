// Tarjetas de oferta (hotel / paquete hotel+forfait). Sustituye el escaneo de texto de página completa
// del scraper legado (tools/update-esquiades-prices.js), que mezclaba precios de tarjetas vecinas,
// leía precios tachados, exigía «2 días» de forfait, dividía mal por noches y promediaba un «top 10».
import { classes, findAll, findOutermost, parseHtml, textContent, type El } from './html';
import { findMoney, parseAmount, type Money } from './money';
import { offerConditionsKey } from '../offer-identity';

export type Provider = 'esquiades' | 'estiber';
export type PriceUnit = 'per_person' | 'per_room' | 'per_night' | 'per_person_night' | 'per_stay' | 'unknown';
export type PriceKind = 'advertised_from' | 'quoted_for_search';
export type Board = 'room_only' | 'breakfast' | 'half_board' | 'full_board' | 'all_inclusive';
export type Cancellation = 'free' | 'non_refundable';
export type ForfaitIncluded = 'yes' | 'no' | 'unknown';

export interface OfferCard {
  provider: Provider;
  providerOfferId: string | null;
  hotelName: string | null;
  board: Board | null;
  nights: number | null;
  forfaitDays: number | null;
  adults: number | null;
  /** Edades de menores declaradas en la tarjeta; [] solo si dice explícitamente que no hay; null = desconocido. */
  childrenAges: number[] | null;
  rooms: number | null;
  checkIn: string | null;
  checkOut: string | null;
  /** Forfait incluido según la tarjeta. Sin mención es 'unknown', nunca «solo alojamiento». */
  forfaitIncluded: ForfaitIncluded;
  cancellation: Cancellation | null;
  priceText: string | null;
  amount: Money | null;
  unit: PriceUnit;
  /** 'quoted_for_search' solo si la tarjeta declara fechas, adultos y menores y no dice «desde». El servidor
   *  lo vuelve a verificar contra el escenario pedido; en páginas de catálogo siempre queda orientativo. */
  priceKind: PriceKind;
  saysFrom: boolean;
  /** Varios importes distintos: no se elige ninguno. */
  ambiguousPrice: boolean;
  strikethroughIgnored: boolean;
  url: string | null;
  /** Estación del forfait tal como la nombra la tarjeta («2 días de forfait en Grandvalira»); null si no la nombra. */
  forfaitArea: string | null;
  warnings: string[];
}

// ---------- detección de elementos ----------

const CARD_CLASSES: Record<Provider, RegExp> = {
  esquiades: /^(hotel-card|offer-card|product-card|card-hotel|card-offer|result-item|hotel-item)$/i,
  // Estiber (estructura señalada por la revisión del 01/10/2026): «carousel-cell cl-offer-box cl-offer-box-type-hotel».
  // `carousel-cell` sola no basta: el carrusel puede contener otras cosas.
  estiber: /^(cl-offer-box|oferta|oferta-card|card-oferta|oferta-item|offer-card|offer)$/i,
};

function isCard(provider: Provider) {
  return (el: El) => 'data-offer-id' in el.attrs || classes(el).some((c) => CARD_CLASSES[provider].test(c));
}

/** Precio tachado/antiguo: <del>, <s>, <strike>, clase old/tachado/before/line-through/strike o style line-through. */
export function isStrikethrough(el: El): boolean {
  if (el.tag === 'del' || el.tag === 's' || el.tag === 'strike') return true;
  if (/line-through/i.test(el.attrs.style ?? '')) return true;
  return classes(el).some(
    (c) => /^old|[-_]old(?![a-z])|[a-z]Old/.test(c) || /tachad|before|line-?through|strike|antes/i.test(c),
  );
}

const PRICE_CLASS = /price|precio|importe|amount/i;
const hasPriceClass = (el: El) => classes(el).some((c) => PRICE_CLASS.test(c)) && !isStrikethrough(el);

// ---------- extracción de campos ----------

function detectBoard(t: string): Board | null {
  if (/todo incluido|all inclusive/.test(t)) return 'all_inclusive';
  if (/pensi[oó]n completa|full board/.test(t)) return 'full_board';
  if (/media pensi[oó]n|half board/.test(t)) return 'half_board';
  if (/desayuno|breakfast/.test(t)) return 'breakfast';
  if (/solo alojamiento|s[oó]lo alojamiento|room only/.test(t)) return 'room_only';
  return null;
}

function detectUnit(t: string): PriceUnit {
  if (/(por|\/)\s*(persona|pers\.?|p\.?p\.?)\s*(y|por|\/)\s*noche|per person( per|\s*\/)\s*night/.test(t)) return 'per_person_night';
  if (/total (de la )?estancia|precio total|por estancia|estancia completa|total stay|per stay/.test(t)) return 'per_stay';
  if (/(por|\/)\s*hab(?:itaci[oó]n|\.|\b)|per room/.test(t)) return 'per_room';
  if (/(por|\/)\s*(persona|pers\b\.?)|\bp\.p\.|per person/.test(t)) return 'per_person';
  if (/(por|\/)\s*noche\b|per night/.test(t)) return 'per_night';
  return 'unknown';
}

const int = (re: RegExp, t: string): number | null => {
  const m = re.exec(t);
  if (!m) return null;
  const n = Number(m[1] ?? m[2]);
  return Number.isInteger(n) && n > 0 && n < 60 ? n : null;
};

function detectForfaitDays(t: string): number | null {
  return int(/(\d{1,2})\s*d[ií]as?\s*(?:de\s+)?(?:forfait|skipass|ski pass)|(?:forfait|skipass|ski pass)\s*(?:de\s+)?(\d{1,2})\s*d[ií]as?/, t);
}

/** «… forfait en Vallnord Pal-Arinsal» → «vallnord pal-arinsal» (texto en minúsculas de la tarjeta). */
function detectForfaitArea(t: string): string | null {
  const m = /(?:forfait|skipass|ski pass)\s+(?:en|de|para)\s+([a-zà-ÿ][a-zà-ÿ' .-]{1,50}?)(?=\s*(?:$|[,.;:()|]|\s(?:solo|s[oó]lo|con|sin|desde|por|\d)))/.exec(t);
  return m ? m[1].trim() : null;
}

/** Normaliza un nombre de estación para compararlo con un id de área: sin acentos, minúsculas, guiones. */
export const areaSlug = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** ¿La estación del forfait de la tarjeta es la del área (o su ámbito)? null si la tarjeta no la nombra. */
export function forfaitMatchesArea(c: Pick<OfferCard, 'forfaitArea'>, areaIds: readonly string[]): boolean | null {
  if (!c.forfaitArea) return null;
  const slug = areaSlug(c.forfaitArea);
  return areaIds.some((id) => slug === id || slug.includes(id) || (id.includes(slug) && slug.length >= 4));
}

function detectCancellation(t: string): Cancellation | null {
  if (/no reembolsable|sin (posibilidad de )?cancelaci[oó]n|non.?refundable/.test(t)) return 'non_refundable';
  if (/cancelaci[oó]n (gratuita|gratis|sin coste|sin gastos)|free cancellation/.test(t)) return 'free';
  return null;
}

const iso = (d: string, m: string, y: string) => {
  const yy = y.length === 2 ? `20${y}` : y;
  const dt = new Date(Date.UTC(Number(yy), Number(m) - 1, Number(d)));
  return dt.getUTCDate() === Number(d) && dt.getUTCMonth() === Number(m) - 1 ? dt.toISOString().slice(0, 10) : null;
};

/** «del 10/12/2026 al 12/12/2026», «10/12/2026 - 12/12/2026» o fechas ISO. Solo si la salida es posterior. */
function detectDates(t: string): { checkIn: string | null; checkOut: string | null } {
  const dmy = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\s*(?:-|–|al|a|hasta)\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})/.exec(t);
  let a: string | null = null, b: string | null = null;
  if (dmy) { a = iso(dmy[1], dmy[2], dmy[3]); b = iso(dmy[4], dmy[5], dmy[6]); }
  else {
    const i = /(\d{4}-\d{2}-\d{2})\s*(?:-|–|al|a|hasta)\s*(\d{4}-\d{2}-\d{2})/.exec(t);
    if (i) { a = i[1]; b = i[2]; }
  }
  return a && b && b > a ? { checkIn: a, checkOut: b } : { checkIn: null, checkOut: null };
}

function detectChildren(t: string): number[] | null {
  if (/sin (niñ|menor)|\b0\s*(niñ|menor)/.test(t)) return [];
  const ages = /(?:niñ[oa]s?|menores?)\s*(?:de|\()\s*((?:\d{1,2}\s*(?:,|y|e)?\s*)+)\s*años/.exec(t);
  if (ages) return (ages[1].match(/\d{1,2}/g) ?? []).map(Number).filter((n) => n < 18);
  return null;
}

function detectForfait(t: string, days: number | null): { included: ForfaitIncluded; warning: string | null } {
  const yes = days !== null || /forfait (incluido|incl\.)|con forfait|\+\s*forfait|skipass incluido/.test(t);
  // «Solo alojamiento» es un régimen (sin comidas) cuando la tarjeta declara los días de forfait (Esquiades, 03/10/2026:
  // «2 días de forfait en Grandvalira» + insignia «Solo alojamiento», en el mismo hueco que «Con 2 desayunos»).
  // Sin días declarados sigue contando como «sin forfait» y, junto a otra mención de forfait, como contradicción.
  const no = /sin forfait|forfait no incluido|no incluye (el )?forfait/.test(t) || (days === null && /s[oó]lo alojamiento/.test(t));
  if (yes && no) return { included: 'unknown', warning: 'La tarjeta menciona forfait y «solo alojamiento/sin forfait» a la vez: forfait desconocido.' };
  return { included: yes ? 'yes' : no ? 'no' : 'unknown', warning: null };
}

function hotelNameOf(card: El): string | null {
  const byClass = findAll(
    card,
    (e) =>
      classes(e).some((c) => /(hotel[-_]?(name|nombre|title)|nombre|titulo|title|name)/i.test(c) && !PRICE_CLASS.test(c)),
    isStrikethrough,
  );
  for (const el of byClass) {
    const t = textContent(el, isStrikethrough);
    if (t) return t;
  }
  const h = findAll(card, (e) => /^h[1-4]$/.test(e.tag), isStrikethrough)[0];
  if (h) return textContent(h, isStrikethrough) || null;
  // Sin elemento de nombre (tarjeta de Estiber leída como texto): lo que precede a «N noches», sin el descuento «-10%»
  // ni la valoración «8.5 (21)». Si no hay ese patrón, no se adivina.
  const m = /^(.*?)\s*\d{1,2}\s*noches?\b/i.exec(textContent(card, isStrikethrough));
  const name = m?.[1].replace(/^-\s?\d{1,2}\s?%\s*/, '').replace(/^\d{1,2}(?:[.,]\d)?\s*\(\d+\)\s*/, '').trim();
  return name && name.length >= 3 && name.length <= 120 && !/€|\d+[.,]\d{2}/.test(name) ? name : null;
}

function offerIdOf(card: El): string | null {
  for (const a of ['data-offer-id', 'data-hotel-id', 'data-product-id', 'data-id']) {
    const v = card.attrs[a]?.trim();
    if (v) return v;
  }
  return null;
}

function urlOf(card: El): string | null {
  if (card.tag === 'a' && card.attrs.href) return card.attrs.href;
  const a = findAll(card, (e) => e.tag === 'a' && !!e.attrs.href)[0];
  return a ? a.attrs.href : null;
}

function strikeHasMoney(card: El): boolean {
  return findAll(card, isStrikethrough).some((el) => findMoney(textContent(el)).length > 0);
}

function parseCard(card: El, provider: Provider): OfferCard {
  const warnings: string[] = [];
  const cardText = textContent(card, isStrikethrough);
  const lower = cardText.toLowerCase();

  // Precio: elementos con clase de precio más internos que contienen un importe; si no hay, texto de la tarjeta.
  const priced = findAll(card, hasPriceClass, isStrikethrough).filter(
    (el) => findMoney(textContent(el, isStrikethrough)).length > 0,
  );
  const innermost = priced.filter((el) => !priced.some((o) => o !== el && isAncestor(el, o)));
  let priceText: string | null = null;
  let amount: Money | null = null;
  let context = lower;
  let before = '';
  let ambiguous: number[] | null = null;
  if (innermost.length) {
    const el = innermost[0];
    const hits = findMoney(textContent(el, isStrikethrough));
    priceText = hits[0].text;
    amount = parseAmount(priceText);
    // Bloque de precio: el antecesor más alto (dentro de la tarjeta) con clase de precio.
    let block: El = el;
    for (let e: El | null = el; e && e !== card; e = e.parent) if (hasPriceClass(e)) block = e;
    if (block === el && el.parent) block = el.parent;
    context = textContent(block, isStrikethrough).toLowerCase();
    before = context;
    const distinct = new Set(innermost.flatMap((e) => findMoney(textContent(e, isStrikethrough)).map((h) => h.cents)));
    if (distinct.size > 1) ambiguous = [...distinct];
  } else {
    const hits = findMoney(cardText);
    if (hits.length) {
      priceText = hits[0].text;
      amount = parseAmount(priceText);
      before = lower.slice(Math.max(0, hits[0].index - 40), hits[0].index + priceText.length + 40);
      context = before;
      const distinct = new Set(hits.map((h) => h.cents));
      if (distinct.size > 1) ambiguous = [...distinct];
    } else {
      warnings.push('Sin precio en la tarjeta.');
    }
  }

  let unit = detectUnit(context);
  if (unit === 'unknown' && context !== lower) unit = detectUnit(lower);

  // Precio rebajado sin marca de tachado (Estiber, 01/10/2026: «-10% … Por 222€ 199€ por persona»): solo se acepta
  // el segundo importe si hay exactamente dos, el primero es mayor y el descuento declarado los cuadra (±1 €).
  let discountResolved = false;
  if (ambiguous && ambiguous.length === 2) {
    const pct = /(?:^|\s)-\s?(\d{1,2})\s?%/.exec(lower);
    const hits = findMoney(cardText);
    if (pct && hits.length >= 2) {
      const [old, now] = [hits[0].cents, hits[1].cents];
      const expected = old * (1 - Number(pct[1]) / 100);
      if (old > now && Math.abs(expected - now) <= 100 && hits.slice(2).every((h) => h.cents === old || h.cents === now)) {
        amount = { ...parseAmount(hits[1].text)! };
        priceText = hits[1].text;
        before = lower.slice(Math.max(0, hits[1].index - 40), hits[1].index + hits[1].text.length + 40);
        ambiguous = null;
        discountResolved = true;
        warnings.push(`Precio rebajado: se toma ${hits[1].text} y se descarta el anterior ${hits[0].text} (descuento del ${pct[1]} % declarado en la tarjeta).`);
      }
    }
  }
  if (ambiguous) {
    const shown = ambiguous.slice(0, 4).map((c) => `${(c / 100).toFixed(2).replace('.', ',')} €`).join(', ');
    warnings.push(`Varios precios distintos en la tarjeta (${shown}); no se elige ninguno.`);
    amount = null;
  }
  const forfaitDays = detectForfaitDays(lower);
  const forfait = detectForfait(lower, forfaitDays);
  if (forfait.warning) warnings.push(forfait.warning);
  const { checkIn, checkOut } = detectDates(lower);
  const adults = int(/(\d{1,2})\s*(?:adultos?|adults?)\b/, lower);
  const childrenAges = detectChildren(lower);
  const saysFrom = /\b(desde|a partir de|from)\b/.test(before);
  const declared = checkIn !== null && checkOut !== null && adults !== null && childrenAges !== null;
  const priceKind: PriceKind = !saysFrom && declared && amount !== null ? 'quoted_for_search' : 'advertised_from';
  if (amount !== null && priceKind === 'advertised_from' && !saysFrom) warnings.push('Precio orientativo aunque no diga «desde»: la tarjeta no declara fechas y ocupación completas.');

  return {
    provider,
    providerOfferId: offerIdOf(card),
    hotelName: hotelNameOf(card),
    board: detectBoard(lower),
    nights: int(/(\d{1,2})\s*(?:noches?|nits|nights?)\b/, lower),
    forfaitDays,
    adults,
    childrenAges,
    rooms: int(/(\d{1,2})\s*hab(?:itaci[oó]n(?:es)?|s?\.)/, lower),
    checkIn,
    checkOut,
    forfaitIncluded: forfait.included,
    cancellation: detectCancellation(lower),
    priceText: ambiguous ? null : priceText,
    amount,
    unit,
    priceKind,
    saysFrom,
    ambiguousPrice: ambiguous !== null,
    strikethroughIgnored: discountResolved || strikeHasMoney(card),
    url: urlOf(card),
    forfaitArea: detectForfaitArea(lower),
    warnings,
  };
}

function isAncestor(anc: El, el: El): boolean {
  for (let e = el.parent; e; e = e.parent) if (e === anc) return true;
  return false;
}

/** Cada tarjeta se analiza SOLO dentro de su propio elemento. */
export function parseOfferCardsHtml(html: string, provider: Provider): OfferCard[] {
  return findOfferCards(parseHtml(html), provider).map((c) => parseCard(c, provider));
}

/** Elementos de tarjeta (los más externos que cumplen la detección); si no hay, los <article>. */
export function findOfferCards(doc: El, provider: Provider): El[] {
  const cards = findOutermost(doc, isCard(provider));
  return cards.length ? cards : findOutermost(doc, (e) => e.tag === 'article');
}

// ---------- deduplicado y resumen ----------

/** Clave de identidad + condiciones (compartida con la ingesta, ver core/offer-identity). El precio NUNCA forma parte. null = no deduplicable. */
export function cardKey(c: OfferCard): string | null {
  const k = offerConditionsKey(c);
  return k ? JSON.stringify([c.provider, ...k]) : null;
}

export function dedupeCards(cards: readonly OfferCard[]): OfferCard[] {
  const seen = new Set<string>();
  return cards.filter((c) => {
    const k = cardKey(c);
    if (k === null) return true;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 123456 céntimos / 2 noches → 61728. null si las noches no son un entero positivo. */
export function perNightFromStay(totalCents: number, nights: number): number | null {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0 || !Number.isInteger(nights) || nights <= 0) return null;
  return Math.round(totalCents / nights);
}

export interface Summary {
  n: number;
  minCents: number | null;
  medianCents: number | null;
  maxCents: number | null;
  unit: PriceUnit | null;
  adults: number | null;
  /** Hay importes con otras unidades u ocupaciones que no se han mezclado. */
  mixed: boolean;
}

/**
 * Resumen de importes conocidos con la MISMA unidad y ocupación (adultos). Sin `opts`, si hay varias
 * combinaciones devuelve n=0 y mixed=true en vez de mezclar. 'unknown' solo se resume si se pide.
 * Mediana con n par: media de los dos centrales redondeada al céntimo.
 */
export function summarize(
  cards: readonly OfferCard[],
  opts: { unit?: PriceUnit; adults?: number | null } = {},
): Summary {
  const known = cards.filter(
    (c) => c.amount !== null && (opts.unit !== undefined ? c.unit === opts.unit : c.unit !== 'unknown'),
  );
  const groups = new Map<string, OfferCard[]>();
  for (const c of known) {
    if (opts.adults !== undefined && c.adults !== opts.adults) continue;
    const k = `${c.unit}|${c.adults}`;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const empty: Summary = { n: 0, minCents: null, medianCents: null, maxCents: null, unit: opts.unit ?? null, adults: opts.adults ?? null, mixed: false };
  if (groups.size === 0) return { ...empty, mixed: known.length > 0 };
  if (groups.size > 1) return { ...empty, mixed: true };
  const [group] = groups.values();
  const v = group.map((c) => c.amount!.cents).sort((a, b) => a - b);
  const mid = v.length >> 1;
  return {
    n: v.length,
    minCents: v[0],
    medianCents: v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2),
    maxCents: v[v.length - 1],
    unit: group[0].unit,
    adults: group[0].adults,
    mixed: group.length !== cards.filter((c) => c.amount !== null).length,
  };
}
