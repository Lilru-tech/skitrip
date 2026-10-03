// Reparto de gastos en céntimos enteros. Suma exacta y residuo determinista.

/**
 * Reparte `total` entre `ids` a partes iguales. El residuo (0..n-1 céntimos) se asigna, 1 céntimo
 * cada uno, a los primeros participantes en orden lexicográfico de id: el resultado no depende del
 * orden en que llegan los datos.
 */
export function splitEqual(total: number, ids: readonly string[]): Map<string, number> {
  if (!Number.isInteger(total) || total < 0) throw new Error('total inválido');
  const sorted = [...new Set(ids)].sort();
  if (!sorted.length) throw new Error('sin participantes');
  const base = Math.floor(total / sorted.length);
  let rest = total - base * sorted.length;
  const out = new Map<string, number>();
  for (const id of sorted) {
    out.set(id, base + (rest > 0 ? 1 : 0));
    if (rest > 0) rest--;
  }
  return out;
}

export function sumShares(shares: Iterable<number>): number {
  let s = 0;
  for (const v of shares) s += v;
  return s;
}

export interface ExpenseLike { payerId: string; amountCents: number; shares: Map<string, number> | Record<string, number> }
export interface SettlementLike { fromUser: string; toUser: string; amountCents: number }

/**
 * Saldo neto por persona: positivo = le deben, negativo = debe.
 * Pagar un gasto suma su importe; beneficiarse resta la cuota; una transferencia registrada
 * suma a quien paga la transferencia y resta a quien la recibe. La suma de saldos es siempre 0.
 */
export function balances(expenses: readonly ExpenseLike[], settlements: readonly SettlementLike[] = []): Map<string, number> {
  const b = new Map<string, number>();
  const add = (id: string, v: number) => b.set(id, (b.get(id) ?? 0) + v);
  for (const e of expenses) {
    add(e.payerId, e.amountCents);
    const entries = e.shares instanceof Map ? [...e.shares] : Object.entries(e.shares);
    for (const [id, share] of entries) add(id, -share);
  }
  for (const s of settlements) {
    add(s.fromUser, s.amountCents);
    add(s.toUser, -s.amountCents);
  }
  return b;
}

/** Propuesta de transferencias para saldar (voraz, determinista). Solo sugiere; no ejecuta pagos. */
export function suggestTransfers(bal: Map<string, number>): SettlementLike[] {
  const debtors = [...bal].filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v })).sort((a, b) => b.v - a.v || a.id.localeCompare(b.id));
  const creditors = [...bal].filter(([, v]) => v > 0).map(([id, v]) => ({ id, v })).sort((a, b) => b.v - a.v || a.id.localeCompare(b.id));
  const out: SettlementLike[] = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amt = Math.min(debtors[i].v, creditors[j].v);
    if (amt > 0) out.push({ fromUser: debtors[i].id, toUser: creditors[j].id, amountCents: amt });
    debtors[i].v -= amt;
    creditors[j].v -= amt;
    if (debtors[i].v === 0) i++;
    if (creditors[j].v === 0) j++;
  }
  return out;
}
