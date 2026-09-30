// Importes en euros → céntimos enteros (sin aritmética en coma flotante).
//
// Reglas deterministas (documentadas y probadas):
//  - Espacios normales, no separables (U+00A0), finos (U+2009, U+202F) y de cifra (U+2007) valen igual.
//  - Símbolo «€» o «EUR» delante o detrás, o sin moneda («0,99»). Otras monedas → null.
//  - Separador de miles con espacio: «1 234,56», «1 234.56».
//  - Punto de miles: «1.234», «1.234,56», «12.345.678». UN solo punto seguido de EXACTAMENTE 3 dígitos
//    se interpreta como miles («1.234» = 1234 €); seguido de 1–2 dígitos es decimal («12.50», «12.5»).
//  - Coma de miles solo si también hay punto decimal («1,234.56»). Una coma seguida de 3 dígitos
//    sin más («1,234») es ambigua (decimal ES / miles EN) → null.
//  - Coma decimal con 1–2 dígitos: «1234,56», «0,99», «12,5» (= 12,50).
//  - Negativos, ceros a la izquierda («0099»), basura y valores > 1.000.000 € → null. 0 € es válido.

export interface Money {
  cents: number;
  currency: 'EUR';
}

export const MAX_EUROS = 1_000_000;

const SPACES = /[    ]/g;

// Alternativas numéricas en orden de prioridad (todas ancladas por quien las use).
const NUM_SRC =
  '\\d{1,3}(?: \\d{3})+(?:[.,]\\d{1,2})?' + // 1 234,56
  '|\\d{1,3}(?:\\.\\d{3})+(?:,\\d{1,2})?' + // 1.234 / 1.234,56
  '|\\d{1,3}(?:,\\d{3})+\\.\\d{1,2}' + // 1,234.56
  '|\\d+(?:[.,]\\d{1,2})?'; // 1234,56 / 1234.56 / 99

const STRICT_RE = new RegExp(`^(?:(?:€|EUR)\\s?)?(${NUM_SRC})(?:\\s?(?:€|EUR))?$`, 'i');

function toCents(num: string): number | null {
  const s = num.replace(/ /g, '');
  let intPart: string;
  let dec = '';
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(s)) {
    const [i, d = ''] = s.split(',');
    intPart = i.replace(/\./g, '');
    dec = d;
  } else if (/^\d{1,3}(?:,\d{3})+\.\d{1,2}$/.test(s)) {
    const [i, d] = s.split('.');
    intPart = i.replace(/,/g, '');
    dec = d;
  } else {
    const m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(s);
    if (!m) return null;
    intPart = m[1];
    dec = m[2] ?? '';
  }
  if (intPart.length > 1 && intPart[0] === '0') return null;
  if (intPart.length > 7) return null;
  const cents = Number(intPart) * 100 + Number((dec + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents > MAX_EUROS * 100) return null;
  return cents;
}

export function parseAmount(text: string): Money | null {
  if (typeof text !== 'string') return null;
  const s = text.replace(SPACES, ' ').replace(/\s+/g, ' ').trim();
  if (!s || /[-−]/.test(s)) return null;
  const m = STRICT_RE.exec(s);
  if (!m) return null;
  // «1,234» (coma + 3 dígitos, sin punto) es ambiguo.
  if (/^\d{1,3},\d{3}$/.test(m[1])) return null;
  const cents = toCents(m[1]);
  return cents === null ? null : { cents, currency: 'EUR' };
}

export interface MoneyHit {
  text: string;
  index: number;
  cents: number;
}

const FIND_RE = new RegExp(
  `(?:€|\\bEUR)\\s?(?<![\\d.,])(${NUM_SRC})(?![\\d])|(?<![\\d.,])(${NUM_SRC})(?![\\d.,]?\\d)\\s?(?:€|EUR\\b)`,
  'gi',
);

/** Importes con símbolo de moneda dentro de un texto libre (los números sin «€» se ignoran). */
export function findMoney(text: string): MoneyHit[] {
  const s = text.replace(SPACES, ' ');
  const out: MoneyHit[] = [];
  FIND_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FIND_RE.exec(s))) {
    const before = s.slice(Math.max(0, m.index - 1), m.index);
    if (/[-−]/.test(before)) continue;
    const parsed = parseAmount(m[0]);
    if (parsed) out.push({ text: m[0].trim(), index: m.index, cents: parsed.cents });
  }
  return out;
}

/** Formato español para mensajes: 123456 → «1.234,56 €». */
export function formatEuros(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(cents));
  const euros = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${euros},${String(abs % 100).padStart(2, '0')} €`;
}
