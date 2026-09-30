import { Hono } from 'hono';
import { z } from 'zod';
import { balances, splitEqual, suggestTransfers, sumShares } from '../../core/split';
import type { AppEnv } from '../env';
import { requireTripMember } from '../access';
import { ApiError, conflict, forbidden, newId, notFound, now, parseBody } from '../http';
import { rateLimit } from '../ratelimit';
import { zDate, zId } from '../schemas';

// Gastos reales: céntimos, reparto exacto, saldos verificables, transferencias registradas a mano
// (no se ejecutan pagos) y trazabilidad de cada cambio.
export const expenseRoutes = new Hono<AppEnv>();

const zExpense = z.object({
  concept: z.string().trim().min(1).max(200),
  spentOn: zDate,
  payerId: zId,
  amountCents: z.number().int().min(1).max(10_000_000),
  category: z.string().max(40).nullable().optional(),
  split: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('equal'), participants: z.array(zId).min(1).max(60) }),
    z.object({ mode: z.literal('custom'), shares: z.array(z.object({ userId: zId, shareCents: z.number().int().min(0).max(10_000_000) })).min(1).max(60) }),
  ]),
});

async function memberSet(db: D1Database, tripId: string) {
  const { results } = await db.prepare('SELECT user_id FROM trip_members WHERE trip_id = ?1').bind(tripId).all<{ user_id: string }>();
  return new Set(results.map((r) => r.user_id));
}

function computeShares(b: z.infer<typeof zExpense>, members: Set<string>): Map<string, number> {
  if (!members.has(b.payerId)) throw new ApiError(422, 'validation', 'Quien paga debe ser miembro del viaje.');
  let shares: Map<string, number>;
  if (b.split.mode === 'equal') {
    shares = splitEqual(b.amountCents, b.split.participants);
  } else {
    shares = new Map();
    for (const s of b.split.shares) {
      if (shares.has(s.userId)) throw new ApiError(422, 'validation', 'Participante repetido en el reparto.');
      shares.set(s.userId, s.shareCents);
    }
    const sum = sumShares(shares.values());
    if (sum !== b.amountCents) throw new ApiError(422, 'split_mismatch', `El reparto suma ${(sum / 100).toFixed(2)} € y el gasto es de ${(b.amountCents / 100).toFixed(2)} €.`);
  }
  for (const id of shares.keys()) if (!members.has(id)) throw new ApiError(422, 'validation', 'Todos los beneficiarios deben ser miembros del viaje.');
  return shares;
}

async function summary(db: D1Database, tripId: string) {
  const [exp, sh, st] = await db.batch([
    db.prepare(`SELECT e.*, u.alias AS payer_alias FROM expenses e JOIN users u ON u.id = e.payer_id WHERE e.trip_id = ?1 AND e.deleted_at IS NULL ORDER BY e.spent_on DESC, e.created_at DESC`).bind(tripId),
    db.prepare(`SELECT s.* FROM expense_shares s JOIN expenses e ON e.id = s.expense_id WHERE e.trip_id = ?1 AND e.deleted_at IS NULL`).bind(tripId),
    db.prepare(`SELECT s.*, f.alias AS from_alias, t.alias AS to_alias FROM settlements s JOIN users f ON f.id = s.from_user JOIN users t ON t.id = s.to_user
                WHERE s.trip_id = ?1 AND s.deleted_at IS NULL ORDER BY s.paid_on DESC`).bind(tripId),
  ]);
  const sharesBy = new Map<string, Record<string, number>>();
  for (const s of sh.results as any[]) (sharesBy.get(s.expense_id) ?? sharesBy.set(s.expense_id, {}).get(s.expense_id)!)[s.user_id] = s.share_cents;
  const expenses = (exp.results as any[]).map((e) => ({
    id: e.id, concept: e.concept, spentOn: e.spent_on, payerId: e.payer_id, payerAlias: e.payer_alias, amountCents: e.amount_cents, currency: e.currency,
    splitMode: e.split_mode, category: e.category, receiptId: e.receipt_id, version: e.version, shares: sharesBy.get(e.id) ?? {},
  }));
  const settlements = (st.results as any[]).map((s) => ({ id: s.id, fromUser: s.from_user, fromAlias: s.from_alias, toUser: s.to_user, toAlias: s.to_alias, amountCents: s.amount_cents, paidOn: s.paid_on, note: s.note }));
  const bal = balances(expenses.map((e) => ({ payerId: e.payerId, amountCents: e.amountCents, shares: e.shares })), settlements);
  return {
    expenses, settlements,
    totalSpentCents: expenses.reduce((s, e) => s + e.amountCents, 0),
    balances: Object.fromEntries(bal),
    balanceCheckCents: sumShares(bal.values()), // siempre 0
    suggestedTransfers: suggestTransfers(bal),
  };
}

expenseRoutes.get('/:id/expenses', async (c) => {
  const tripId = c.req.param('id');
  await requireTripMember(c.env.DB, tripId, c.get('user').id);
  return c.json({ ...(await summary(c.env.DB, tripId)), note: 'Gasto real registrado. El presupuesto estimado está aparte y no cambia estos importes.' });
});

expenseRoutes.post('/:id/expenses', async (c) => {
  const me = c.get('user').id;
  const tripId = c.req.param('id');
  await requireTripMember(c.env.DB, tripId, me);
  const b = await parseBody(c, zExpense);
  await rateLimit(c.env.DB, `expense:${me}`, 200, 86400);
  const shares = computeShares(b, await memberSet(c.env.DB, tripId));
  const id = newId();
  const t = now();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO expenses (id, trip_id, concept, spent_on, payer_id, amount_cents, split_mode, category, created_by, created_at, updated_at)
                      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)`).bind(id, tripId, b.concept, b.spentOn, b.payerId, b.amountCents, b.split.mode, b.category ?? null, me, t),
    ...[...shares].map(([u, s]) => c.env.DB.prepare('INSERT INTO expense_shares (expense_id, user_id, share_cents) VALUES (?1, ?2, ?3)').bind(id, u, s)),
    c.env.DB.prepare(`INSERT INTO expense_history (id, expense_id, trip_id, actor_id, action, after_json, at) VALUES (?1, ?2, ?3, ?4, 'create', ?5, ?6)`)
      .bind(newId(), id, tripId, me, JSON.stringify({ ...b, shares: Object.fromEntries(shares) }), t),
  ]);
  return c.json({ id, version: 1 }, 201);
});

async function loadExpense(db: D1Database, tripId: string, id: string) {
  const e = await db.prepare('SELECT * FROM expenses WHERE id = ?1 AND trip_id = ?2 AND deleted_at IS NULL').bind(id, tripId).first<any>();
  if (!e) throw notFound('Gasto');
  return e;
}

/** Puede editar/borrar: quien lo creó, quien pagó, o propietario/editor del viaje. */
function canEdit(e: any, me: string, role: string) {
  return e.created_by === me || e.payer_id === me || role !== 'member';
}

expenseRoutes.put('/:id/expenses/:eid', async (c) => {
  const me = c.get('user').id;
  const tripId = c.req.param('id');
  const role = await requireTripMember(c.env.DB, tripId, me);
  const e = await loadExpense(c.env.DB, tripId, c.req.param('eid'));
  if (!canEdit(e, me, role)) throw forbidden('Solo quien creó o pagó el gasto, o un editor, puede modificarlo.');
  const b = await parseBody(c, zExpense.extend({ version: z.number().int().positive() }));
  if (e.receipt_id && b.amountCents !== e.amount_cents) throw new ApiError(422, 'validation', 'El importe de un gasto vinculado a un ticket no se cambia: es el total del ticket.');
  const shares = computeShares(b, await memberSet(c.env.DB, tripId));
  const t = now();
  const before = { ...(await summary(c.env.DB, tripId)).expenses.find((x) => x.id === e.id) };
  // Actualización condicionada a la versión; si otra persona guardó antes, 409 y no se toca nada.
  const upd = await c.env.DB.prepare(
    `UPDATE expenses SET concept = ?1, spent_on = ?2, payer_id = ?3, amount_cents = ?4, split_mode = ?5, category = ?6, version = version + 1, updated_at = ?7
     WHERE id = ?8 AND version = ?9 AND deleted_at IS NULL`,
  ).bind(b.concept, b.spentOn, b.payerId, b.amountCents, b.split.mode, b.category ?? null, t, e.id, b.version).run();
  if (!upd.meta.changes) throw conflict('Otra persona ha modificado este gasto. Recarga para ver la versión actual.', 'version_conflict');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM expense_shares WHERE expense_id = ?1').bind(e.id),
    ...[...shares].map(([u, s]) => c.env.DB.prepare('INSERT INTO expense_shares (expense_id, user_id, share_cents) VALUES (?1, ?2, ?3)').bind(e.id, u, s)),
    c.env.DB.prepare(`INSERT INTO expense_history (id, expense_id, trip_id, actor_id, action, before_json, after_json, at) VALUES (?1, ?2, ?3, ?4, 'update', ?5, ?6, ?7)`)
      .bind(newId(), e.id, tripId, me, JSON.stringify(before), JSON.stringify({ ...b, shares: Object.fromEntries(shares) }), t),
  ]);
  return c.json({ ok: true, version: b.version + 1 });
});

expenseRoutes.delete('/:id/expenses/:eid', async (c) => {
  const me = c.get('user').id;
  const tripId = c.req.param('id');
  const role = await requireTripMember(c.env.DB, tripId, me);
  const e = await loadExpense(c.env.DB, tripId, c.req.param('eid'));
  if (!canEdit(e, me, role)) throw forbidden();
  const t = now();
  await c.env.DB.batch([
    // Borrado lógico: se conserva para la trazabilidad y se libera el vínculo con el ticket.
    c.env.DB.prepare('UPDATE expenses SET deleted_at = ?1, receipt_id = NULL, version = version + 1 WHERE id = ?2').bind(t, e.id),
    c.env.DB.prepare(`INSERT INTO expense_history (id, expense_id, trip_id, actor_id, action, before_json, at) VALUES (?1, ?2, ?3, ?4, 'delete', ?5, ?6)`)
      .bind(newId(), e.id, tripId, me, JSON.stringify({ concept: e.concept, amountCents: e.amount_cents, receiptId: e.receipt_id }), t),
  ]);
  return c.json({ ok: true });
});

expenseRoutes.post('/:id/settlements', async (c) => {
  const me = c.get('user').id;
  const tripId = c.req.param('id');
  await requireTripMember(c.env.DB, tripId, me);
  const b = await parseBody(c, z.object({ fromUser: zId, toUser: zId, amountCents: z.number().int().min(1).max(10_000_000), paidOn: zDate, note: z.string().max(200).nullable().optional() }));
  if (b.fromUser === b.toUser) throw new ApiError(422, 'validation', 'Origen y destino deben ser distintos.');
  const members = await memberSet(c.env.DB, tripId);
  if (!members.has(b.fromUser) || !members.has(b.toUser)) throw new ApiError(422, 'validation', 'Ambas personas deben ser miembros del viaje.');
  if (me !== b.fromUser && me !== b.toUser) throw forbidden('Registra la transferencia quien la hizo o quien la recibió.');
  const id = newId();
  const t = now();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO settlements (id, trip_id, from_user, to_user, amount_cents, paid_on, note, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)')
      .bind(id, tripId, b.fromUser, b.toUser, b.amountCents, b.paidOn, b.note ?? null, me, t),
    c.env.DB.prepare(`INSERT INTO expense_history (id, expense_id, trip_id, actor_id, action, after_json, at) VALUES (?1, ?2, ?3, ?4, 'settle', ?5, ?6)`)
      .bind(newId(), id, tripId, me, JSON.stringify(b), t),
  ]);
  return c.json({ id }, 201);
});

expenseRoutes.delete('/:id/settlements/:sid', async (c) => {
  const me = c.get('user').id;
  const tripId = c.req.param('id');
  await requireTripMember(c.env.DB, tripId, me);
  const s = await c.env.DB.prepare('SELECT * FROM settlements WHERE id = ?1 AND trip_id = ?2 AND deleted_at IS NULL').bind(c.req.param('sid'), tripId).first<any>();
  if (!s) throw notFound('Transferencia');
  if (s.created_by !== me) throw forbidden();
  const t = now();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE settlements SET deleted_at = ?1 WHERE id = ?2').bind(t, s.id),
    c.env.DB.prepare(`INSERT INTO expense_history (id, expense_id, trip_id, actor_id, action, before_json, at) VALUES (?1, ?2, ?3, ?4, 'unsettle', ?5, ?6)`)
      .bind(newId(), s.id, tripId, me, JSON.stringify(s), t),
  ]);
  return c.json({ ok: true });
});

expenseRoutes.get('/:id/expenses/history', async (c) => {
  const tripId = c.req.param('id');
  await requireTripMember(c.env.DB, tripId, c.get('user').id);
  const { results } = await c.env.DB.prepare(
    `SELECT h.id, h.expense_id, h.action, h.before_json, h.after_json, h.at, u.alias AS actor_alias FROM expense_history h JOIN users u ON u.id = h.actor_id
     WHERE h.trip_id = ?1 ORDER BY h.at DESC LIMIT 200`,
  ).bind(tripId).all();
  return c.json({ history: results });
});
