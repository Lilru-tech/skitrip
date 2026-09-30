// Tarjetas de oferta (hotel / paquete hotel+forfait). Sustituye el escaneo de texto de página completa
// del scraper legado (tools/update-esquiades-prices.js), que mezclaba precios de tarjetas vecinas,
// leía precios tachados, exigía «2 días» de forfait, dividía mal por noches y promediaba un «top 10».
import { classes, findAll, findOutermost, parseHtml, textContent, type El } from './html';
import { findMoney, parseAmount, type Money } from './money';

export type Provider = 'esquiades' | 'estiber';
export type PriceUnit = 'per_person' | 'per_room' | 'per_night' | 'per_person_night' | 'per_stay' | 'unknown';
export type PriceKind = 'advertised_from' | 'quoted_for_search';
export type Board = 'room_only' | 'breakfast' | 'half_board' | 'full_board' | 'all_inclusive';
export type Cancellation = 'free' | 'non_refundable';

export interface OfferCard {
  provider: Provider;
  providerOfferId: string | null;
  hotelName: string | null;
  board: Board | null;
  nights: number | null;
  forfaitDays: number | null;
  adults: number | null;
  cancellation: Cancellation | null;
  priceText: string | null;
  amount: Money | null;
  unit: PriceUnit;
  priceKind: PriceKind;
  strikethroughIgnored: boolean;
  url: string | null;
  warnings: string[];
}

// ---------- detección de elementos ----------

const CARD_CLASSES: Record<Provider, RegExp> = {
  esquiades: /^(hotel-card|offer-card|product-card|card-hotel|card-offer|result-item|hotel-item)$/i,
  estiber: /^(oferta|oferta-card|card-oferta|oferta-item|offer-card|offer)$/i,
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

function detectCancellation(t: string): Cancellation | null {
  if (/no reembolsable|sin (posibilidad de )?cancelaci[oó]n|non.?refundable/.test(t)) return 'non_refundable';
  if (/cancelaci[oó]n (gratuita|gratis|sin coste|sin gastos)|free cancellation/.test(t)) return 'free';
  return null;
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
  return h ? textContent(h, isStrikethrough) || null : null;
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
    if (distinct.size > 1) warnings.push('Varios precios en la tarjeta; se usa el primero.');
  } else {
    const hits = findMoney(cardText);
    if (hits.length) {
      priceText = hits[0].text;
      amount = parseAmount(priceText);
      before = lower.slice(Math.max(0, hits[0].index - 40), hits[0].index + priceText.length + 40);
      context = before;
      if (new Set(hits.map((h) => h.cents)).size > 1) warnings.push('Varios precios en la tarjeta; se usa el primero.');
    } else {
      warnings.push('Sin precio en la tarjeta.');
    }
  }

  let unit = detectUnit(context);
  if (unit === 'unknown' && context !== lower) unit = detectUnit(lower);

  return {
    provider,
    providerOfferId: offerIdOf(card),
    hotelName: hotelNameOf(card),
    board: detectBoard(lower),
    nights: int(/(\d{1,2})\s*(?:noches?|nits|nights?)\b/, lower),
    forfaitDays: detectForfaitDays(lower),
    adults: int(/(\d{1,2})\s*(?:adultos?|adults?)\b/, lower),
    cancellation: detectCancellation(lower),
    priceText,
    amount,
    unit,
    priceKind: /\b(desde|a partir de|from)\b/.test(before) ? 'advertised_from' : 'quoted_for_search',
    strikethroughIgnored: strikeHasMoney(card),
    url: urlOf(card),
    warnings,
  };
}

function isAncestor(anc: El, el: El): boolean {
  for (let e = el.parent; e; e = e.parent) if (e === anc) return true;
  return false;
}

/** Cada tarjeta se analiza SOLO dentro de su propio elemento. */
export function parseOfferCardsHtml(html: string, provider: Provider): OfferCard[] {
  const doc = parseHtml(html);
  let cards = findOutermost(doc, isCard(provider));
  if (!cards.length) cards = findOutermost(doc, (e) => e.tag === 'article');
  return cards.map((c) => parseCard(c, provider));
}

// ---------- deduplicado y resumen ----------

const norm = (s: string | null) =>
  s === null ? null : s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Clave de identidad + condiciones. El precio NUNCA forma parte de la clave. null = no deduplicable. */
export function cardKey(c: OfferCard): string | null {
  const who = c.providerOfferId ? `id:${c.provider}:${c.providerOfferId}` : c.hotelName ? `h:${norm(c.hotelName)}` : null;
  if (!who) return null;
  return JSON.stringify([who, c.board, c.nights, c.forfaitDays, c.unit, c.adults, c.cancellation]);
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
