import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { requireTripMember } from '../access';
import { ApiError, conflict, newId, notFound, now, parseBody } from '../http';
import { zId } from '../schemas';
import { ensureList, VISIBLE } from './shopping';
import { legacyPerDay, legacyQty, MAX_QTY, missingOf, planCopy, type CopyAction, type GeneralItemLite, type TripItemLite } from '../../core/shopping-lists';

// Listas generales de la compra: reutilizables, sin viaje y PRIVADAS de su propietario (otra cuenta recibe 404, sin
// revelar si existen). Sirven de base para preparar viajes: copiar crea artículos independientes en la lista del viaje
// (sin estado de comprado, responsable ni cambios compartidos); solo se conserva el producto exacto para ver su precio.
export const shoppingListRoutes = new Hono<AppEnv>();

const MAX_LISTS = 20;
const MAX_ITEMS = 300;
const J = (k: string) => `json_extract(value, '$.${k}')`;

async function ownList(db: D1Database, listId: string, me: string) {
  const l = await db.prepare('SELECT * FROM general_lists WHERE id = ?1 AND owner_id = ?2').bind(listId, me).first<any>();
  if (!l) throw notFound('Lista');
  return l;
}

const listOut = (l: any) => ({ id: l.id, name: l.name, version: l.version, createdAt: l.created_at, updatedAt: l.updated_at });

// ---------- Listas ----------

shoppingListRoutes.get('/shopping-lists', async (c) => {
  const me = c.get('user').id;
  const { results } = await c.env.DB.prepare(
    `SELECT l.*, (SELECT COUNT(*) FROM general_list_items i WHERE i.list_id = l.id) AS items,
            (SELECT COUNT(*) FROM general_list_items i WHERE i.list_id = l.id AND i.product_id IS NULL) AS without_product
     FROM general_lists l WHERE l.owner_id = ?1 ORDER BY l.created_at LIMIT ${MAX_LISTS}`,
  ).bind(me).all<any>();
  return c.json({ lists: results.map((l) => ({ ...listOut(l), items: l.items, withoutProduct: l.without_product })) });
});

const zListName = z.string().trim().min(1).max(80);

shoppingListRoutes.post('/shopping-lists', async (c) => {
  const me = c.get('user').id;
  const b = await parseBody(c, z.object({ name: zListName.default('Lista general') }));
  const id = newId();
  const t = now();
  // Alta y límite en una sola sentencia.
  const r = await c.env.DB.prepare(
    `INSERT INTO general_lists (id, owner_id, name, created_at, updated_at) SELECT ?1, ?2, ?3, ?4, ?4
     WHERE (SELECT COUNT(*) FROM general_lists WHERE owner_id = ?2) < ${MAX_LISTS}`,
  ).bind(id, me, b.name, t).run();
  if (!r.meta.changes) throw new ApiError(422, 'limit', `Puedes tener como máximo ${MAX_LISTS} listas generales.`);
  return c.json({ list: { id, name: b.name, version: 1, createdAt: t, updatedAt: t } }, 201);
});

shoppingListRoutes.get('/shopping-lists/:lid', async (c) => {
  const me = c.get('user').id;
  const db = c.env.DB;
  const list = await ownList(db, c.req.param('lid'), me);
  const [{ results: items }, { results: prices }] = await db.batch([
    db.prepare(`SELECT i.*, p.name AS p_name, p.brand AS p_brand, p.format AS p_format, p.net_qty AS p_net_qty, p.net_unit AS p_net_unit, p.ean AS p_ean, p.replaced_by AS p_replaced_by
       FROM general_list_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.list_id = ?1 ORDER BY i.created_at, i.id`).bind(list.id),
    // Último precio registrado (estantería o coste efectivo de ticket) que la persona puede ver, con su fecha y tienda.
    // Es una observación con fecha, no «el precio actual».
    db.prepare(`SELECT * FROM (
         SELECT po.product_id, po.amount_cents, po.observed_on, po.price_type, po.source, po.store_label, po.postal_code, po.channel,
                COUNT(*) OVER (PARTITION BY po.product_id) AS n,
                ROW_NUMBER() OVER (PARTITION BY po.product_id ORDER BY po.observed_on DESC, po.created_at DESC) AS rn
         FROM price_observations po
         WHERE po.product_id IN (SELECT product_id FROM general_list_items WHERE list_id = ?2 AND product_id IS NOT NULL)
           AND po.price_type IN ('shelf','receipt_effective') AND ${VISIBLE})
       WHERE rn = 1`).bind(me, list.id),
  ]) as D1Result<any>[];
  const P = new Map(prices.map((p: any) => [p.product_id, p]));
  return c.json({
    list: listOut(list),
    items: items.map((i: any) => {
      const p = i.product_id ? P.get(i.product_id) : null;
      return {
        id: i.id, name: i.name, qty: i.qty, perDay: !!i.per_day, qtyUnclear: !!i.qty_unclear, note: i.note, version: i.version,
        product: i.product_id ? { id: i.product_id, name: i.p_name, brand: i.p_brand, format: i.p_format, netQty: i.p_net_qty, netUnit: i.p_net_unit, ean: i.p_ean, replacedBy: i.p_replaced_by } : null,
        legacy: i.legacy_item_id ? { itemId: i.legacy_item_id, name: i.legacy_name, quantityText: i.legacy_qty_text, priceText: i.legacy_price_text } : null,
        lastPrice: p ? { amountCents: p.amount_cents, observedOn: p.observed_on, priceType: p.price_type, source: p.source, storeLabel: p.store_label, postalCode: p.postal_code, channel: p.channel, observations: p.n } : null,
        missing: missingOf({ productId: i.product_id, productFormat: i.p_format, productNetQty: i.p_net_qty, qtyUnclear: !!i.qty_unclear, priceCount: p?.n ?? 0 }),
      };
    }),
    note: 'Lista privada: solo la ves tú. Los precios son observaciones registradas con fecha y tienda, no la tarifa actual de Mercadona online. El precio de la hoja antigua no tiene fecha ni tienda y no se usa como precio.',
  });
});

shoppingListRoutes.patch('/shopping-lists/:lid', async (c) => {
  const me = c.get('user').id;
  const b = await parseBody(c, z.object({ name: zListName, version: z.number().int().positive() }));
  const list = await ownList(c.env.DB, c.req.param('lid'), me);
  const r = await c.env.DB.prepare('UPDATE general_lists SET name = ?1, version = version + 1, updated_at = ?2 WHERE id = ?3 AND version = ?4')
    .bind(b.name, now(), list.id, b.version).run();
  if (!r.meta.changes) throw conflict('La lista ha cambiado en otra pestaña. Recarga para ver la versión actual.', 'version_conflict');
  return c.json({ ok: true, version: b.version + 1 });
});

// Borrar la lista general no toca los viajes: sus copias son independientes (solo pierden la referencia de origen).
shoppingListRoutes.delete('/shopping-lists/:lid', async (c) => {
  const list = await ownList(c.env.DB, c.req.param('lid'), c.get('user').id);
  await c.env.DB.prepare('DELETE FROM general_lists WHERE id = ?1').bind(list.id).run();
  return c.json({ ok: true });
});

// ---------- Artículos ----------

const zItem = z.object({
  name: z.string().trim().min(1).max(120),
  productId: zId.nullable().optional(),
  qty: z.number().int().min(1).max(MAX_QTY).default(1),
  perDay: z.boolean().default(false),
  note: z.string().trim().max(300).nullable().optional(),
});
// Sin valores por defecto: un PATCH parcial no debe reiniciar cantidad ni «por día».
const zItemPatch = z.object({
  name: z.string().trim().min(1).max(120), productId: zId.nullable(), qty: z.number().int().min(1).max(MAX_QTY), perDay: z.boolean(), note: z.string().trim().max(300).nullable(),
}).partial().extend({ version: z.number().int().positive() });

async function checkProduct(db: D1Database, productId: string | null | undefined) {
  if (productId && !(await db.prepare('SELECT 1 FROM products WHERE id = ?1').bind(productId).first())) throw notFound('Producto');
}

shoppingListRoutes.post('/shopping-lists/:lid/items', async (c) => {
  const me = c.get('user').id;
  const db = c.env.DB;
  const list = await ownList(db, c.req.param('lid'), me);
  const b = await parseBody(c, zItem);
  await checkProduct(db, b.productId);
  const id = newId();
  const t = now();
  const r = await db.prepare(
    `INSERT INTO general_list_items (id, list_id, name, product_id, qty, per_day, note, created_at, updated_at) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8
     WHERE (SELECT COUNT(*) FROM general_list_items WHERE list_id = ?2) < ${MAX_ITEMS}`,
  ).bind(id, list.id, b.name, b.productId ?? null, b.qty, b.perDay ? 1 : 0, b.note || null, t).run();
  if (!r.meta.changes) throw new ApiError(422, 'limit', `La lista ha alcanzado el máximo de ${MAX_ITEMS} artículos.`);
  return c.json({ id, version: 1 }, 201);
});

async function loadItem(db: D1Database, listId: string, itemId: string) {
  const it = await db.prepare('SELECT * FROM general_list_items WHERE id = ?1 AND list_id = ?2').bind(itemId, listId).first<any>();
  if (!it) throw notFound('Artículo');
  return it;
}

shoppingListRoutes.patch('/shopping-lists/:lid/items/:itemId', async (c) => {
  const me = c.get('user').id;
  const db = c.env.DB;
  const list = await ownList(db, c.req.param('lid'), me);
  const it = await loadItem(db, list.id, c.req.param('itemId'));
  const b = await parseBody(c, zItemPatch);
  await checkProduct(db, b.productId);
  const map: Record<string, string> = { name: 'name', productId: 'product_id', qty: 'qty', perDay: 'per_day', note: 'note' };
  const sets: string[] = []; const args: unknown[] = [];
  for (const [k, col] of Object.entries(map)) {
    const v = (b as any)[k];
    if (v === undefined) continue;
    sets.push(`${col} = ?`);
    args.push(k === 'perDay' ? (v ? 1 : 0) : k === 'note' ? (v || null) : v);
  }
  // Fijar la cantidad a mano resuelve la duda de la hoja antigua.
  if (b.qty !== undefined) sets.push('qty_unclear = 0');
  if (!sets.length) return c.json({ ok: true, version: it.version });
  const r = await db.prepare(`UPDATE general_list_items SET ${sets.join(', ')}, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`)
    .bind(...args, now(), it.id, b.version).run();
  if (!r.meta.changes) throw conflict('Este artículo ha cambiado en otra pestaña. Recarga para ver la versión actual.', 'version_conflict');
  return c.json({ ok: true, version: b.version + 1 });
});

shoppingListRoutes.delete('/shopping-lists/:lid/items/:itemId', async (c) => {
  const db = c.env.DB;
  const list = await ownList(db, c.req.param('lid'), c.get('user').id);
  const r = await db.prepare('DELETE FROM general_list_items WHERE id = ?1 AND list_id = ?2').bind(c.req.param('itemId'), list.id).run();
  if (!r.meta.changes) throw notFound('Artículo');
  return c.json({ ok: true });
});

// ---------- Hoja antigua ----------
// Vista previa sin nombres de personas e importación idempotente (índice único por lista y fila legacy). Los artículos
// incompletos se conservan: la lista indica qué falta para asociarlos a un producto y tener historial de precios.

shoppingListRoutes.get('/shopping-lists/:lid/legacy', async (c) => {
  const db = c.env.DB;
  const list = await ownList(db, c.req.param('lid'), c.get('user').id);
  const { results } = await db.prepare(
    `SELECT l.id, l.name, l.quantity_text, l.price_text, l.extra_json, f.file_name,
            EXISTS(SELECT 1 FROM general_list_items i WHERE i.list_id = ?1 AND i.legacy_item_id = l.id) AS here
     FROM legacy_shopping_items l JOIN legacy_import_files f ON f.id = l.file_id ORDER BY l.name, l.id LIMIT 1000`,
  ).bind(list.id).all<any>();
  return c.json({
    items: results.map((r) => {
      const q = legacyQty(r.quantity_text);
      return { id: r.id, name: r.name, quantityText: r.quantity_text, priceText: r.price_text, perDay: legacyPerDay(r.extra_json), qty: q.qty, qtyUnclear: q.unclear,
        file: r.file_name, importedHere: !!r.here, missing: missingOf({ productId: null, qtyUnclear: q.unclear }) };
    }),
    note: 'Artículos de la hoja antigua. Se importan tal cual, aunque estén incompletos; después puedes asociar cada uno a un producto exacto. El precio de la hoja es antiguo, sin fecha ni tienda: se muestra como referencia y nunca como precio actual.',
  });
});

shoppingListRoutes.post('/shopping-lists/:lid/legacy-import', async (c) => {
  const db = c.env.DB;
  const list = await ownList(db, c.req.param('lid'), c.get('user').id);
  const b = await parseBody(c, z.object({ legacyIds: z.array(zId).min(1).max(200) }));
  const ids = [...new Set(b.legacyIds)];
  if (ids.length !== b.legacyIds.length) throw new ApiError(422, 'validation', 'Un artículo de la hoja aparece dos veces.');
  const [{ results: legacy }, { results: here }, count] = await db.batch([
    db.prepare('SELECT id, name, quantity_text, price_text, extra_json FROM legacy_shopping_items WHERE id IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(ids)),
    db.prepare('SELECT legacy_item_id FROM general_list_items WHERE list_id = ?1 AND legacy_item_id IN (SELECT value FROM json_each(?2))').bind(list.id, JSON.stringify(ids)),
    db.prepare('SELECT COUNT(*) AS n FROM general_list_items WHERE list_id = ?1').bind(list.id),
  ]) as D1Result<any>[];
  const L = new Map(legacy.map((l: any) => [l.id, l]));
  if (ids.some((id) => !L.has(id))) throw notFound('Artículo de la hoja antigua');
  const done = new Set(here.map((h: any) => h.legacy_item_id));
  const t = now();
  const rows = ids.filter((id) => !done.has(id)).map((id) => {
    const l = L.get(id);
    const q = legacyQty(l.quantity_text);
    return { id: newId(), legacyId: id, name: String(l.name).slice(0, 120), qty: q.qty, unclear: q.unclear ? 1 : 0, perDay: legacyPerDay(l.extra_json) ? 1 : 0,
      qtyText: l.quantity_text, priceText: l.price_text, legacyName: l.name };
  });
  if (((count.results[0] as any)?.n ?? 0) + rows.length > MAX_ITEMS) throw new ApiError(422, 'limit', `La lista superaría el máximo de ${MAX_ITEMS} artículos.`);
  let created = 0;
  if (rows.length) {
    const r = await db.prepare(`INSERT OR IGNORE INTO general_list_items (id, list_id, name, qty, per_day, qty_unclear, legacy_item_id, legacy_name, legacy_qty_text, legacy_price_text, created_at, updated_at)
      SELECT ${J('id')}, ?1, ${J('name')}, ${J('qty')}, ${J('perDay')}, ${J('unclear')}, ${J('legacyId')}, ${J('legacyName')}, ${J('qtyText')}, ${J('priceText')}, ?2, ?2 FROM json_each(?3)`)
      .bind(list.id, t, JSON.stringify(rows)).run();
    created = r.meta.changes ?? 0;
  }
  return c.json({ created, alreadyImported: ids.length - created });
});

// ---------- Copiar a un viaje ----------
// Vista previa obligatoria de coincidencias con lo que ya tiene el viaje; la confirmación recalcula todo en el servidor
// (no se confía en el emparejamiento que mande el navegador) y escribe en un único batch.

async function copyContext(db: D1Database, listId: string, tripId: string) {
  const [{ results: general }, { results: tripItems }, { results: trip }] = await db.batch([
    db.prepare('SELECT id, name, product_id, qty, per_day, note FROM general_list_items WHERE list_id = ?1 ORDER BY created_at, id').bind(listId),
    db.prepare(`SELECT i.id, i.name, i.product_id, i.qty, i.bought, i.source_list_item_id FROM shopping_items i JOIN shopping_lists l ON l.id = i.list_id
       WHERE l.trip_id = ?1 ORDER BY i.created_at, i.id`).bind(tripId),
    db.prepare('SELECT id, name, ski_days FROM trips WHERE id = ?1').bind(tripId),
  ]) as D1Result<any>[];
  const g: GeneralItemLite[] = general.map((x: any) => ({ id: x.id, name: x.name, productId: x.product_id, qty: x.qty, perDay: !!x.per_day }));
  const t: TripItemLite[] = tripItems.map((x: any) => ({ id: x.id, name: x.name, productId: x.product_id, qty: x.qty, bought: !!x.bought, sourceListItemId: x.source_list_item_id }));
  const notes = new Map<string, string | null>(general.map((x: any) => [x.id, x.note]));
  return { general: g, notes, tripItems: t, trip: trip[0] as { id: string; name: string; ski_days: number | null } };
}

const zCopyTarget = z.object({ tripId: zId });

shoppingListRoutes.post('/shopping-lists/:lid/copy/preview', async (c) => {
  const me = c.get('user').id;
  const db = c.env.DB;
  const list = await ownList(db, c.req.param('lid'), me);
  const { tripId } = await parseBody(c, zCopyTarget);
  await requireTripMember(db, tripId, me);
  const ctx = await copyContext(db, list.id, tripId);
  const rows = planCopy(ctx.general, ctx.tripItems, ctx.trip.ski_days);
  return c.json({
    trip: { id: ctx.trip.id, name: ctx.trip.name, skiDays: ctx.trip.ski_days, items: ctx.tripItems.length, maxItems: MAX_ITEMS },
    rows,
    matches: rows.filter((r) => r.match).length,
    note: 'Cada copia es un artículo nuevo del viaje: se copia nombre, producto, cantidad y nota, pero no el estado de comprado ni el responsable. Cambiarla no modifica tu lista general ni otros viajes.',
  });
});

shoppingListRoutes.post('/shopping-lists/:lid/copy', async (c) => {
  const me = c.get('user').id;
  const db = c.env.DB;
  const list = await ownList(db, c.req.param('lid'), me);
  const b = await parseBody(c, zCopyTarget.extend({ items: z.array(z.object({ itemId: zId, action: z.enum(['add', 'sum', 'skip']) })).min(1).max(MAX_ITEMS) }));
  await requireTripMember(db, b.tripId, me);
  if (new Set(b.items.map((i) => i.itemId)).size !== b.items.length) throw new ApiError(422, 'validation', 'Un artículo aparece dos veces.');
  const tripList = await ensureList(db, b.tripId);
  const ctx = await copyContext(db, list.id, b.tripId);
  const plan = new Map(planCopy(ctx.general, ctx.tripItems, ctx.trip.ski_days).map((r) => [r.itemId, r]));
  const add: unknown[] = []; const sum: { id: string; add: number }[] = [];
  let skipped = 0;
  for (const { itemId, action } of b.items) {
    const row = plan.get(itemId);
    if (!row) throw notFound('Artículo de la lista');
    if (!row.actions.includes(action as CopyAction)) {
      throw new ApiError(422, 'invalid_action', action === 'sum' ? `«${row.name}» no se puede sumar: no hay un artículo pendiente equivalente en el viaje.` : `Acción no válida para «${row.name}».`);
    }
    if (action === 'skip') skipped++;
    else if (action === 'sum') sum.push({ id: row.match!.tripItemId, add: row.qty });
    else add.push({ id: newId(), name: row.name, productId: row.productId, qty: row.qty, note: ctx.notes.get(itemId) ?? null, source: itemId });
  }
  if (ctx.tripItems.length + add.length > MAX_ITEMS) throw new ApiError(422, 'limit', `La lista del viaje superaría el máximo de ${MAX_ITEMS} artículos.`);
  const t = now();
  const stmts: D1PreparedStatement[] = [];
  // Copias independientes: nunca se copia «comprado» ni el responsable; la procedencia solo sirve para avisar de coincidencias.
  if (add.length) stmts.push(db.prepare(`INSERT INTO shopping_items (id, list_id, name, product_id, qty, note, bought, assignee_id, source_list_item_id, created_by, created_at, updated_at)
      SELECT ${J('id')}, ?1, ${J('name')}, ${J('productId')}, ${J('qty')}, ${J('note')}, 0, NULL, ${J('source')}, ?2, ?3, ?3 FROM json_each(?4)`)
    .bind(tripList.id, me, t, JSON.stringify(add)));
  // Sumar solo a artículos que siguen pendientes; si alguien lo marcó como comprado entretanto, no se toca.
  if (sum.length) stmts.push(db.prepare(`UPDATE shopping_items SET qty = MIN(${MAX_QTY}, qty + (SELECT ${J('add')} FROM json_each(?1) WHERE ${J('id')} = shopping_items.id)),
      version = version + 1, updated_at = ?2 WHERE list_id = ?3 AND bought = 0 AND id IN (SELECT ${J('id')} FROM json_each(?1))`)
    .bind(JSON.stringify(sum), t, tripList.id));
  const res = stmts.length ? await db.batch(stmts) : [];
  const added = add.length ? res[0].meta.changes ?? 0 : 0;
  const summed = sum.length ? res[res.length - 1].meta.changes ?? 0 : 0;
  return c.json({ added, summed, skipped, notSummed: sum.length - summed });
});
