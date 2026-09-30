// Ticket de supermercado pegado como texto (estilo «FACTURA SIMPLIFICADA» de Mercadona).
// Nunca inventa precios: una línea que no encaja va a `warnings`.
import { formatEuros } from './money';

export interface ReceiptLine {
  lineNo: number;
  rawText: string;
  description: string;
  qty: number;
  unitCents: number | null;
  amountCents: number;
  weightGrams: number | null;
}

export interface ParsedReceipt {
  purchasedOn: string | null;
  purchasedTime: string | null;
  postalCode: string | null;
  lines: ReceiptLine[];
  totalCents: number | null;
  sumMatchesTotal: boolean;
  warnings: string[];
}

const AMT = '(\\d{1,5}[.,]\\d{2})';
const KG = '(\\d{1,3}[.,]\\d{3})';
const RE_WEIGHT_TAIL = new RegExp(`^${KG}\\s*kg\\s+${AMT}\\s*€?\\s*/\\s*kg\\s+${AMT}$`, 'i');
const RE_WEIGHT_ONE = new RegExp(`^(?:(\\d{1,3})\\s+)?(.+?)\\s+${KG}\\s*kg\\s+${AMT}\\s*€?\\s*/\\s*kg\\s+${AMT}$`, 'i');
const RE_MULTI = new RegExp(`^(\\d{1,3})\\s+(.+?)\\s+${AMT}\\s+${AMT}$`);
const RE_SINGLE = new RegExp(`^(\\d{1,3})\\s+(.+?)\\s+${AMT}$`);
const RE_PENDING = /^(\d{1,3})\s+(\D.*)$/;
const RE_TOTAL = new RegExp(`^TOTAL\\s*(?:\\(€\\))?\\s*:?\\s*${AMT}\\s*€?$`, 'i');
const RE_DATE = /\b(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/;

const cents = (s: string) => {
  const [i, d] = s.replace('.', ',').split(',');
  return Number(i) * 100 + Number(d);
};
const grams = (s: string) => {
  const [i, d] = s.replace('.', ',').split(',');
  return Number(i) * 1000 + Number(d);
};
const clean = (s: string) => s.replace(/[    \t]/g, ' ').replace(/\s+/g, ' ').trim();

function validDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function parseReceiptText(text: string): ParsedReceipt {
  const warnings: string[] = [];
  const raw = text.replace(/\r\n?/g, '\n').split('\n').map(clean);

  let purchasedOn: string | null = null;
  let purchasedTime: string | null = null;
  let dateIdx = -1;
  for (let i = 0; i < raw.length && dateIdx < 0; i++) {
    const m = RE_DATE.exec(raw[i]);
    if (m && validDate(+m[3], +m[2], +m[1])) {
      purchasedOn = `${m[3]}-${m[2]}-${m[1]}`;
      if (m[4] && +m[4] < 24 && +m[5] < 60) purchasedTime = `${m[4]}:${m[5]}`;
      dateIdx = i;
    }
  }

  // Inicio de artículos: tras la cabecera de columnas, o tras «FACTURA SIMPLIFICADA», o tras la fecha.
  let start = raw.findIndex((l) => /descripci[oó]n|p\.\s*unit/i.test(l));
  if (start < 0) start = raw.findIndex((l) => /factura simplificada/i.test(l));
  if (start < 0) start = dateIdx;
  const totalIdx = raw.findIndex((l, i) => i > start && RE_TOTAL.test(l));
  const end = totalIdx >= 0 ? totalIdx : raw.length;

  let postalCode: string | null = null;
  for (const l of raw.slice(0, start < 0 ? end : start + 1)) {
    const m = /^(\d{5})\s+\p{L}/u.exec(l);
    if (m && +m[1] >= 1000 && +m[1] <= 52999) {
      postalCode = m[1];
      break;
    }
  }

  const lines: ReceiptLine[] = [];
  let pending: { idx: number; qty: number; description: string } | null = null;
  const flushPending = () => {
    if (pending) warnings.push(`Línea ${pending.idx + 1} sin importe: «${raw[pending.idx]}».`);
    pending = null;
  };
  const addWeighted = (idx: number, rawText: string, qty: number, description: string, kg: string, perKg: string, amt: string) => {
    const w = grams(kg);
    const unit = cents(perKg);
    const amount = cents(amt);
    const expected = Math.round((w * unit) / 1000);
    if (Math.abs(expected - amount) > 1) {
      warnings.push(`Línea ${idx + 1}: ${kg} kg × ${formatEuros(unit)}/kg no da ${formatEuros(amount)}.`);
    }
    lines.push({ lineNo: idx + 1, rawText, description, qty, unitCents: unit, amountCents: amount, weightGrams: w });
  };

  for (let i = start + 1; i < end; i++) {
    const l = raw[i];
    if (!l) continue;
    let m: RegExpExecArray | null;
    if (pending && (m = RE_WEIGHT_TAIL.exec(l))) {
      const p: { idx: number; qty: number; description: string } = pending;
      addWeighted(p.idx, `${raw[p.idx]}\n${l}`, p.qty, p.description, m[1], m[2], m[3]);
      pending = null;
      continue;
    }
    flushPending();
    if ((m = RE_WEIGHT_ONE.exec(l))) {
      addWeighted(i, l, m[1] ? +m[1] : 1, m[2], m[3], m[4], m[5]);
    } else if ((m = RE_MULTI.exec(l))) {
      const qty = +m[1];
      const unit = cents(m[3]);
      const amount = cents(m[4]);
      if (qty * unit !== amount) warnings.push(`Línea ${i + 1}: ${qty} × ${formatEuros(unit)} no da ${formatEuros(amount)}.`);
      lines.push({ lineNo: i + 1, rawText: l, description: m[2], qty, unitCents: unit, amountCents: amount, weightGrams: null });
    } else if ((m = RE_SINGLE.exec(l))) {
      const qty = +m[1];
      const amount = cents(m[3]);
      // Con cantidad > 1 y sin precio unitario impreso no se deduce.
      lines.push({ lineNo: i + 1, rawText: l, description: m[2], qty, unitCents: qty === 1 ? amount : null, amountCents: amount, weightGrams: null });
    } else if ((m = RE_PENDING.exec(l))) {
      pending = { idx: i, qty: +m[1], description: m[2] };
    } else {
      warnings.push(`Línea ${i + 1} no reconocida: «${l}».`);
    }
  }
  flushPending();

  const totalCents = totalIdx >= 0 ? cents(RE_TOTAL.exec(raw[totalIdx])![1]) : null;
  const sum = lines.reduce((a, l) => a + l.amountCents, 0);
  const sumMatchesTotal = totalCents !== null && sum === totalCents;
  if (totalCents === null) warnings.push('No se encontró el TOTAL del ticket.');
  else if (!sumMatchesTotal) warnings.push(`La suma de líneas (${formatEuros(sum)}) no coincide con el total (${formatEuros(totalCents)}).`);
  if (!purchasedOn) warnings.push('No se encontró la fecha de compra.');

  return { purchasedOn, purchasedTime, postalCode, lines, totalCents, sumMatchesTotal, warnings };
}

/** SHA-256 hex estable sobre fecha, hora, total y líneas (no depende de espacios ni del texto de cabecera). */
export async function receiptHash(parsed: ParsedReceipt): Promise<string> {
  const canonical = JSON.stringify({
    d: parsed.purchasedOn,
    h: parsed.purchasedTime,
    t: parsed.totalCents,
    l: parsed.lines.map((l) => [l.description.toUpperCase().replace(/\s+/g, ' ').trim(), l.qty, l.unitCents, l.amountCents, l.weightGrams]),
  });
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
