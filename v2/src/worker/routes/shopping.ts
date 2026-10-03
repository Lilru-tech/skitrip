import { Hono } from 'hono';
import { parseCsv } from '../../core/csv';
import { z } from 'zod';
import { parseReceiptText, receiptHash } from '../../core/parsers/receipt';
import { parseAmount } from '../../core/parsers/money';
import { parseFormat, unitPrice } from '../../core/parsers/unit-price';
import { splitEqual } from '../../core/split';
import { insertShares } from './expenses';
import type { AppEnv } from '../env';
import { requireTripEditor, requireTripMember } from '../access';
import { sha256Hex } from '../crypto';
import { ApiError, conflict, forbidden, newId, notFound, now, parseBody, parseQuery } from '../http';
import { rateLimit } from '../ratelimit';
import { zDate, zId } from '../schemas';
import { fetchOpenPrices } from '../open-prices';
import { availableSeries, basketEvolution, estimate, type Criterion, type PriceObs } from '../../core/basket';

// Compra: productos exactos, lista por viaje, precios manuales/CSV/ticket y capa colaborativa separada.
// El adaptador directo de Mercadona está deshabilitado: ver src/worker/price-providers.ts.
export const shoppingRoutes = new Hono<AppEnv>();

/** Observaciones que `me` puede ver: propias, compartidas por alguien con quien comparte viaje, o colaborativas públicas. */
export const VISIBLE = `(po.owner_id = ?1 OR po.visibility = 'public_collab' OR (po.visibility = 'shared_trips' AND EXISTS (
  SELECT 1 FROM trip_members a JOIN trip_members b ON a.trip_id = b.trip_id WHERE a.user_id = po.owner_id AND b.user_id = ?1)))`;

const productOut = (p: any) => p && ({
  id: p.id, retailer: p.retailer, retailerRef: p.retailer_ref, ean: p.ean, name: p.name, brand: p.brand, format: p.format,
  netQty: p.net_qty, netUnit: p.net_unit, refUrl: p.ref_url, replacedBy: p.replaced_by,
});

export async function ensureList(db: D1Database, tripId: string) {
  let l = await db.prepare('SELECT * FROM shopping_lists WHERE trip_id = ?1').bind(tripId).first<any>();
  if (!l) {
    await db.prepare('INSERT OR IGNORE INTO shopping_lists (id, trip_id, created_at) VALUES (?1, ?2, ?3)').bind(newId(), tripId, now()).run();
    l = await db.prepare('SELECT * FROM shopping_lists WHERE trip_id = ?1').bind(tripId).first<any>();
  }
  return l;
}

const obsOut = (r: any): PriceObs => ({ productId: r.product_id, observedOn: r.observed_on, amountCents: r.amount_cents, storeLabel: r.store_label, postalCode: r.postal_code,
  channel: r.channel, priceType: r.price_type, source: r.source, createdAt: r.created_at, promoNote: r.promo_note });
const OBS_COLS = 'po.product_id, po.observed_on, po.amount_cents, po.store_label, po.postal_code, po.channel, po.price_type, po.source, po.created_at, po.promo_note';

/**
 * Estimación de la lista para el presupuesto (2 consultas): productos agrupados, último precio de estantería (o coste
 * efectivo de ticket) COMPARTIDO por un miembro del viaje EN LA TIENDA, CP Y CANAL DE LA LISTA. Otras tiendas y los datos
 * colaborativos no entran. Artículos sin producto exacto quedan pendientes.
 */
export async function estimateList(db: D1Database, tripId: string) {
  const [{ results }, { results: obs }] = await db.batch([
    db.prepare(`SELECT i.id, i.qty, i.product_id, l.store_label, l.postal_code, l.channel FROM shopping_items i JOIN shopping_lists l ON l.id = i.list_id WHERE l.trip_id = ?1`).bind(tripId),
    db.prepare(`SELECT ${OBS_COLS} FROM price_observations po
       WHERE po.product_id IN (SELECT i.product_id FROM shopping_items i JOIN shopping_lists l ON l.id = i.list_id WHERE l.trip_id = ?1 AND i.product_id IS NOT NULL)
         AND po.visibility = 'shared_trips' AND po.price_type IN ('shelf','receipt_effective')
         AND po.owner_id IN (SELECT user_id FROM trip_members WHERE trip_id = ?1)
       ORDER BY po.observed_on DESC LIMIT 5000`).bind(tripId),
  ]) as [D1Result<{ id: string; qty: number; product_id: string | null; store_label: string; postal_code: string; channel: 'online' | 'store' }>, D1Result<any>];
  const list = results[0] ? { storeLabel: results[0].store_label, postalCode: results[0].postal_code, channel: results[0].channel } : null;
  const e = estimate(results.map((r) => ({ productId: r.product_id, qty: r.qty })), obs.map(obsOut), list ?? { storeLabel: '', postalCode: null, channel: 'online' });
  return {
    items: results.length, products: e.products, priced: e.priced, unpriced: e.unpriced, genericItems: e.genericItems,
    knownCents: e.knownCents, complete: e.complete, oldestPriceOn: e.oldestPriceOn, criterion: list, byProduct: e.byProduct,
  };
}

// ---------- Lista ----------

shoppingRoutes.get('/trips/:id/shopping', async (c) => {
  const me = c.get('user').id;
  const tripId = c.req.param('id');
  await requireTripMember(c.env.DB, tripId, me);
  const list = await ensureList(c.env.DB, tripId);
  const { results } = await c.env.DB.prepare(
    `SELECT i.*, u.alias AS assignee_alias, p.name AS p_name, p.brand AS p_brand, p.format AS p_format, p.net_qty AS p_net_qty, p.net_unit AS p_net_unit, p.ean AS p_ean
     FROM shopping_items i LEFT JOIN users u ON u.id = i.assignee_id LEFT JOIN products p ON p.id = i.product_id WHERE i.list_id = ?1 ORDER BY i.bought, i.created_at`,
  ).bind(list.id).all<any>();
  const est = await estimateList(c.env.DB, tripId);
  const priceOf = (pid: string | null) => (pid ? est.byProduct.get(pid) ?? null : null);
  return c.json({
    list: { id: list.id, storeLabel: list.store_label, postalCode: list.postal_code, channel: list.channel },
    items: results.map((i) => {
      const e = priceOf(i.product_id);
      const up = e && i.p_net_qty ? unitPrice(e.amountCents, i.p_net_qty, i.p_net_unit) : null;
      return {
        id: i.id, name: i.name, qty: i.qty, note: i.note, bought: !!i.bought, assigneeId: i.assignee_id, assigneeAlias: i.assignee_alias, legacyName: i.legacy_name,
        legacyItemId: i.legacy_item_id ?? null, fromGeneralList: !!i.source_list_item_id, version: i.version,
        product: i.product_id ? { id: i.product_id, name: i.p_name, brand: i.p_brand, format: i.p_format, netQty: i.p_net_qty, netUnit: i.p_net_unit, ean: i.p_ean } : null,
        // Origen y fecha visibles: tipo de precio (estantería o coste efectivo de ticket) y procedencia.
        price: e ? { amountCents: e.amountCents, observedOn: e.observedOn, priceType: e.priceType, source: e.source, unitPrice: up } : null,
      };
    }),
    estimate: { items: est.items, products: est.products, priced: est.priced, unpriced: est.unpriced, genericItems: est.genericItems, knownCents: est.knownCents,
      complete: est.complete, oldestPriceOn: est.oldestPriceOn, criterion: est.criterion },
    note: 'Estimación con precios compartidos por miembros del viaje (manuales o de tickets) en la tienda, código postal y canal de la lista. No es la tarifa actual de Mercadona online.',
  });
});

// Criterio explícito de la lista (tienda, CP, canal): define qué serie de precios estima la compra y sigue la cesta.
shoppingRoutes.put('/trips/:id/shopping/list', async (c) => {
  const me = c.get('user').id;
  const tripId = c.req.param('id');
  await requireTripMember(c.env.DB, tripId, me);
  const b = await parseBody(c, z.object({ storeLabel: z.string().trim().min(2).max(80), postalCode: z.string().regex(/^\d{5}$/), channel: z.enum(['online', 'store']) }));
  const list = await ensureList(c.env.DB, tripId);
  await c.env.DB.prepare('UPDATE shopping_lists SET store_label = ?1, postal_code = ?2, channel = ?3 WHERE id = ?4').bind(b.storeLabel, b.postalCode, b.channel, list.id).run();
  return c.json({ list: { id: list.id, ...b } });
});

const zItem = z.object({
  name: z.string().trim().min(1).max(120),
  productId: zId.nullable().optional(),
  qty: z.number().int().min(1).max(999).default(1),
  note: z.string().max(300).nullable().optional(),
  assigneeId: zId.nullable().optional(),
});
// En zod 4 `.partial()` conserva los valores por defecto: un PATCH sin qty la reiniciaría a 1. Esquema propio sin defaults.
const zItemPatch = zItem.extend({ qty: z.number().int().min(1).max(999) }).partial();

async function checkAssignee(db: D1Database, tripId: string, assigneeId: string | null | undefined) {
  if (!assigneeId) return;
  const ok = await db.prepare('SELECT 1 FROM trip_members WHERE trip_id = ?1 AND user_id = ?2').bind(tripId, assigneeId).first();
  if (!ok) throw new ApiError(422, 'validation', 'El responsable debe ser miembro del viaje.');
}

shoppingRoutes.post('/trips/:id/shopping/items', async (c) => {
  const me = c.get('user').id;
  const tripId = c.req.param('id');
  await requireTripMember(c.env.DB, tripId, me);
  const b = await parseBody(c, zItem);
  await checkAssignee(c.env.DB, tripId, b.assigneeId);
  if (b.productId && !(await c.env.DB.prepare('SELECT 1 FROM products WHERE id = ?1').bind(b.productId).first())) throw notFound('Producto');
  const list = await ensureList(c.env.DB, tripId);
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM shopping_items WHERE list_id = ?1').bind(list.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= 300) throw new ApiError(422, 'limit', 'La lista ha alcanzado el máximo de 300 artículos.');
  const id = newId();
  const t = now();
  await c.env.DB.prepare(
    `INSERT INTO shopping_items (id, list_id, name, product_id, qty, note, assignee_id, created_by, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
  ).bind(id, list.id, b.name, b.productId ?? null, b.qty, b.note ?? null, b.assigneeId ?? null, me, t).run();
  return c.json({ id, version: 1 }, 201);
});

async function loadItem(db: D1Database, tripId: string, itemId: string) {
  const it = await db.prepare(`SELECT i.* FROM shopping_items i JOIN shopping_lists l ON l.id = i.list_id WHERE i.id = ?1 AND l.trip_id = ?2`).bind(itemId, tripId).first<any>();
  if (!it) throw notFound('Artículo');
  return it;
}

// Edición con versión: dos personas marcando/editando a la vez no se pisan en silencio.
shoppingRoutes.patch('/trips/:id/shopping/items/:itemId', async (c) => {
  const me = c.get('user').id;
  const tripId = c.req.param('id');
  await requireTripMember(c.env.DB, tripId, me);
  await loadItem(c.env.DB, tripId, c.req.param('itemId'));
  const b = await parseBody(c, zItemPatch.extend({ bought: z.boolean().optional(), version: z.number().int().positive() }));
  await checkAssignee(c.env.DB, tripId, b.assigneeId);
  if (b.productId && !(await c.env.DB.prepare('SELECT 1 FROM products WHERE id = ?1').bind(b.productId).first())) throw notFound('Producto');
  const map: Record<string, string> = { name: 'name', productId: 'product_id', qty: 'qty', note: 'note', assigneeId: 'assignee_id', bought: 'bought' };
  const sets: string[] = []; const args: unknown[] = [];
  for (const [k, col] of Object.entries(map)) if ((b as any)[k] !== undefined) { sets.push(`${col} = ?`); args.push(k === 'bought' ? ((b as any)[k] ? 1 : 0) : (b as any)[k]); }
  if (!sets.length) return c.json({ ok: true });
  const r = await c.env.DB.prepare(`UPDATE shopping_items SET ${sets.join(', ')}, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`).bind(...args, now(), c.req.param('itemId'), b.version).run();
  if (!r.meta.changes) throw conflict('Otra persona ha cambiado este artículo. Recarga para ver la versión actual.', 'version_conflict');
  return c.json({ ok: true, version: b.version + 1 });
});

shoppingRoutes.delete('/trips/:id/shopping/items/:itemId', async (c) => {
  const tripId = c.req.param('id');
  await requireTripMember(c.env.DB, tripId, c.get('user').id);
  await loadItem(c.env.DB, tripId, c.req.param('itemId'));
  await c.env.DB.prepare('DELETE FROM shopping_items WHERE id = ?1').bind(c.req.param('itemId')).run();
  return c.json({ ok: true });
});

/** Asistente para artículos genéricos (legacy o nuevos): propone productos exactos, nunca elige solo. */
shoppingRoutes.get('/trips/:id/shopping/suggestions/:itemId', async (c) => {
  const tripId = c.req.param('id');
  await requireTripMember(c.env.DB, tripId, c.get('user').id);
  const it = await loadItem(c.env.DB, tripId, c.req.param('itemId'));
  const words = String(it.legacy_name ?? it.name).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().split(/\s+/).filter((w: string) => w.length >= 3).slice(0, 3);
  if (!words.length) return c.json({ suggestions: [] });
  const where = words.map((_: string, i: number) => `lower(name) LIKE ?${i + 1}`).join(' AND ');
  const { results } = await c.env.DB.prepare(`SELECT * FROM products WHERE replaced_by IS NULL AND ${where} LIMIT 10`).bind(...words.map((w: string) => `%${w}%`)).all();
  return c.json({ suggestions: results.map(productOut), note: 'Elige el formato exacto. Si ninguno coincide, crea el producto.' });
});

// ---------- Productos ----------

const zProduct = z.object({
  name: z.string().trim().min(2).max(160),
  brand: z.string().trim().max(80).nullable().optional(),
  format: z.string().trim().max(80).nullable().optional(),
  netQty: z.number().int().positive().max(1_000_000).nullable().optional(),
  netUnit: z.enum(['g', 'ml', 'unit']).nullable().optional(),
  ean: z.string().regex(/^\d{8,14}$/).nullable().optional(),
  retailer: z.string().max(40).default('mercadona'),
  retailerRef: z.string().max(40).nullable().optional(),
  refUrl: z.string().url().max(500).nullable().optional(),
});

shoppingRoutes.get('/products', async (c) => {
  const { q } = parseQuery(c, z.object({ q: z.string().max(60).default('') }));
  const term = `%${q.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[%_]/g, '')}%`;
  const { results } = await c.env.DB.prepare(`SELECT * FROM products WHERE (lower(name) LIKE ?1 OR ean = ?2) ORDER BY replaced_by IS NOT NULL, name LIMIT 30`).bind(term, q).all();
  return c.json({ products: results.map(productOut) });
});

shoppingRoutes.post('/products', async (c) => {
  const me = c.get('user').id;
  const b = await parseBody(c, zProduct);
  await rateLimit(c.env.DB, `product:${me}`, 100, 86400);
  let { netQty, netUnit } = b;
  if ((netQty == null) !== (netUnit == null)) throw new ApiError(422, 'validation', 'Indica cantidad y unidad juntas.');
  if (netQty == null && b.format) {
    const f = parseFormat(b.format);
    if (f) ({ netQty, netUnit } = f);
  }
  const id = newId();
  try {
    await c.env.DB.prepare(
      `INSERT INTO products (id, retailer, retailer_ref, ean, name, brand, format, net_qty, net_unit, ref_url, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
    ).bind(id, b.retailer, b.retailerRef ?? null, b.ean ?? null, b.name, b.brand ?? null, b.format ?? null, netQty ?? null, netUnit ?? null, b.refUrl ?? null, me, now()).run();
  } catch (e) {
    if (/UNIQUE/.test(String(e))) throw conflict('Ya existe un producto con esa referencia del comercio.');
    throw e;
  }
  return c.json({ product: productOut(await c.env.DB.prepare('SELECT * FROM products WHERE id = ?1').bind(id).first()) }, 201);
});

// Cambio de formato: se crea un producto nuevo y el anterior queda enlazado. Las series no se mezclan.
shoppingRoutes.post('/products/:pid/replace', async (c) => {
  const me = c.get('user').id;
  const old = await c.env.DB.prepare('SELECT * FROM products WHERE id = ?1').bind(c.req.param('pid')).first<any>();
  if (!old) throw notFound('Producto');
  if (old.replaced_by) throw conflict('Este producto ya fue sustituido.');
  const b = await parseBody(c, zProduct);
  const id = newId();
  const f = b.netQty == null && b.format ? parseFormat(b.format) : null;
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO products (id, retailer, retailer_ref, ean, name, brand, format, net_qty, net_unit, ref_url, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`)
      .bind(id, b.retailer, b.retailerRef ?? null, b.ean ?? null, b.name, b.brand ?? null, b.format ?? null, b.netQty ?? f?.netQty ?? null, b.netUnit ?? f?.netUnit ?? null, b.refUrl ?? null, me, now()),
    c.env.DB.prepare('UPDATE products SET replaced_by = ?1, retailer_ref = NULL WHERE id = ?2').bind(id, old.id),
  ]);
  return c.json({ id }, 201);
});

// ---------- Compra de la hoja antigua ----------
// Vista previa sin nombres de personas (texto libre de la hoja, no identifica cuentas) y recuperación explícita a un
// viaje eligiendo producto exacto y cantidad. La procedencia se guarda; repetir no duplica.
shoppingRoutes.get('/trips/:id/shopping/legacy', async (c) => {
  const tripId = c.req.param('id');
  await requireTripEditor(c.env.DB, tripId, c.get('user').id);
  const list = await ensureList(c.env.DB, tripId);
  const { results } = await c.env.DB.prepare(
    `SELECT l.id, l.name, l.quantity_text, l.price_text, f.file_name, EXISTS(SELECT 1 FROM shopping_items i WHERE i.list_id = ?1 AND i.legacy_item_id = l.id) AS here
     FROM legacy_shopping_items l JOIN legacy_import_files f ON f.id = l.file_id ORDER BY l.name LIMIT 1000`,
  ).bind(list.id).all<any>();
  return c.json({
    items: results.map((r) => ({ id: r.id, name: r.name, quantityText: r.quantity_text, priceText: r.price_text, file: r.file_name, importedHere: !!r.here })),
    note: 'Artículos de la hoja antigua. Elige el producto exacto y la cantidad; el precio de la hoja no tiene fecha ni tienda y no se usa como precio.',
  });
});

shoppingRoutes.post('/trips/:id/shopping/legacy-import', async (c) => {
  const me = c.get('user').id;
  const tripId = c.req.param('id');
  await requireTripEditor(c.env.DB, tripId, me);
  const b = await parseBody(c, z.object({ items: z.array(z.object({ legacyId: zId, productId: zId.nullable(), qty: z.number().int().min(1).max(999) })).min(1).max(200) }));
  const db = c.env.DB;
  const list = await ensureList(db, tripId);
  const ids = [...new Set(b.items.map((i) => i.legacyId))];
  if (ids.length !== b.items.length) throw new ApiError(422, 'validation', 'Un artículo legacy aparece dos veces.');
  const pids = [...new Set(b.items.map((i) => i.productId).filter((x): x is string => !!x))];
  const [{ results: legacy }, { results: prods }, { results: here }, count] = await db.batch([
    db.prepare('SELECT id, name, quantity_text, price_text FROM legacy_shopping_items WHERE id IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(ids)),
    db.prepare('SELECT id, name FROM products WHERE id IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(pids)),
    db.prepare('SELECT legacy_item_id FROM shopping_items WHERE list_id = ?1 AND legacy_item_id IN (SELECT value FROM json_each(?2))').bind(list.id, JSON.stringify(ids)),
    db.prepare('SELECT COUNT(*) AS n FROM shopping_items WHERE list_id = ?1').bind(list.id),
  ]) as D1Result<any>[];
  const L = new Map(legacy.map((l: any) => [l.id, l]));
  const P = new Map(prods.map((p: any) => [p.id, p]));
  if (ids.some((id) => !L.has(id))) throw notFound('Artículo legacy');
  if (pids.some((id) => !P.has(id))) throw new ApiError(422, 'unknown_product', 'Algún producto elegido no existe; no se ha guardado nada.');
  const done = new Set(here.map((h: any) => h.legacy_item_id));
  const t = now();
  const rows = b.items.filter((i) => !done.has(i.legacyId)).map((i) => {
    const l = L.get(i.legacyId);
    const note = [l.quantity_text && `Cantidad en la hoja: ${l.quantity_text}`, l.price_text && `Precio en la hoja (sin fecha ni tienda): ${l.price_text}`].filter(Boolean).join(' · ') || null;
    return { id: newId(), name: i.productId ? P.get(i.productId).name : l.name, productId: i.productId, qty: i.qty, note, legacyName: l.name, legacyId: i.legacyId };
  });
  if (((count.results[0] as any)?.n ?? 0) + rows.length > 300) throw new ApiError(422, 'limit', 'La lista superaría el máximo de 300 artículos.');
  let created = 0;
  if (rows.length) {
    const J = (k: string) => `json_extract(value, '$.${k}')`;
    const r = await db.prepare(`INSERT OR IGNORE INTO shopping_items (id, list_id, name, product_id, qty, note, legacy_name, legacy_item_id, created_by, created_at, updated_at)
      SELECT ${J('id')}, ?1, ${J('name')}, ${J('productId')}, ${J('qty')}, ${J('note')}, ${J('legacyName')}, ${J('legacyId')}, ?2, ?3, ?3 FROM json_each(?4)`)
      .bind(list.id, me, t, JSON.stringify(rows)).run();
    created = r.meta.changes ?? 0;
  }
  return c.json({ created, alreadyImported: b.items.length - created });
});

// ---------- Precios ----------

const zPrice = z.object({
  productId: zId,
  amountCents: z.number().int().min(0).max(10_000_00),
  priceType: z.enum(['shelf', 'promo', 'personal_discount']),
  promoNote: z.string().max(200).nullable().optional(),
  storeLabel: z.string().trim().min(2).max(80),
  postalCode: z.string().regex(/^\d{5}$/).nullable().optional(),
  channel: z.enum(['online', 'store', 'unknown']),
  observedOn: zDate,
  visibility: z.enum(['private', 'shared_trips']).default('shared_trips'),
});

async function insertPrice(db: D1Database, me: string, p: z.infer<typeof zPrice>, source: 'manual' | 'csv') {
  const dedupe = await sha256Hex(JSON.stringify([me, p.productId, p.priceType, p.amountCents, p.storeLabel, p.postalCode ?? null, p.channel, p.observedOn]));
  const r = await db.prepare(
    `INSERT OR IGNORE INTO price_observations (id, product_id, source, price_type, amount_cents, promo_note, store_label, postal_code, channel, observed_on, owner_id, visibility, dedupe_hash, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
  ).bind(newId(), p.productId, source, p.priceType, p.amountCents, p.promoNote ?? null, p.storeLabel, p.postalCode ?? null, p.channel, p.observedOn, me, p.visibility, dedupe, now()).run();
  return (r.meta.changes ?? 0) > 0;
}

shoppingRoutes.post('/prices', async (c) => {
  const me = c.get('user').id;
  const b = await parseBody(c, zPrice);
  if (!(await c.env.DB.prepare('SELECT 1 FROM products WHERE id = ?1').bind(b.productId).first())) throw notFound('Producto');
  await rateLimit(c.env.DB, `price:${me}`, 300, 86400);
  const created = await insertPrice(c.env.DB, me, b, 'manual');
  return c.json({ created, duplicate: !created }, created ? 201 : 200);
});

shoppingRoutes.get('/products/:pid/prices', async (c) => {
  const me = c.get('user').id;
  const p = await c.env.DB.prepare('SELECT * FROM products WHERE id = ?1').bind(c.req.param('pid')).first<any>();
  if (!p) throw notFound('Producto');
  const { results } = await c.env.DB.prepare(
    `SELECT po.id, po.source, po.price_type, po.amount_cents, po.promo_note, po.store_label, po.postal_code, po.channel, po.observed_on, po.visibility, po.external_ref,
            po.owner_id = ?1 AS mine
     FROM price_observations po WHERE po.product_id = ?2 AND ${VISIBLE} ORDER BY po.observed_on`,
  ).bind(me, p.id).all<any>();
  // Series separadas por tipo de precio y canal: nunca se mezclan catálogo, promoción, descuento personal y coste efectivo de ticket.
  const series: Record<string, any[]> = {};
  for (const r of results) {
    const key = `${r.source === 'open_prices' ? 'colaborativo' : 'propio'}:${r.price_type}:${r.channel}`;
    (series[key] ??= []).push({ ...r, unitPrice: p.net_qty ? unitPrice(r.amount_cents, p.net_qty, p.net_unit) : null });
  }
  // Cadena de sustituciones (máx. 10) en una sola sentencia recursiva. Antes era una consulta por salto y, además,
  // se cortaba tras el primero porque no leía replaced_by.
  const { results: chain } = p.replaced_by ? await c.env.DB.prepare(
    `WITH RECURSIVE ch(id, name, format, replaced_by, depth) AS (
       SELECT id, name, format, replaced_by, 1 FROM products WHERE id = ?1
       UNION ALL SELECT n.id, n.name, n.format, n.replaced_by, ch.depth + 1 FROM products n JOIN ch ON n.id = ch.replaced_by WHERE ch.depth < 10)
     SELECT id, name, format FROM ch ORDER BY depth`,
  ).bind(p.replaced_by).all<any>() : { results: [] as any[] };
  return c.json({ product: productOut(p), series, replacedBy: chain, note: 'Sin observación un día = sin dato; no se rellena con el precio anterior.' });
});

// CSV: previsualizar y confirmar. Columnas: product_id|ean, amount, price_type, store, postal_code, channel, date (YYYY-MM-DD o DD/MM/YYYY), promo_note
// Consultas fijas para cualquier tamaño (≤ 500 filas): 1 lectura de productos al previsualizar; al confirmar,
// + límite de uso + 1 batch de inserción por conjuntos. Antes eran 1–2 consultas por fila.
async function previewCsv(db: D1Database, csv: string) {
  const rows = parseCsv(csv);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const body = rows.slice(1, 501);
  const getter = (r: string[]) => (name: string) => (col(name) >= 0 ? (r[col(name)] ?? '').trim() : '');
  const ids = [...new Set(body.map((r) => getter(r)('product_id')).filter(Boolean))];
  const eans = [...new Set(body.map((r) => getter(r)('ean')).filter(Boolean))];
  const { results: prods } = await db.prepare(
    `SELECT id, name, format, ean, replaced_by FROM products WHERE id IN (SELECT value FROM json_each(?1)) OR (ean IN (SELECT value FROM json_each(?2)) AND replaced_by IS NULL)`,
  ).bind(JSON.stringify(ids), JSON.stringify(eans)).all<any>();
  const byId = new Map(prods.map((p) => [p.id, p]));
  const byEan = new Map(prods.filter((p) => p.ean && !p.replaced_by).map((p) => [p.ean, p]));
  return body.map((r, i) => {
    const get = getter(r);
    const errors: string[] = [];
    const pid = get('product_id');
    const product = pid ? byId.get(pid) ?? null : get('ean') ? byEan.get(get('ean')) ?? null : null;
    if (!product) errors.push('producto no encontrado (usa product_id o EAN de un producto existente)');
    const amount = parseAmount(get('amount'));
    if (!amount) errors.push('importe no válido');
    let date = get('date');
    const dm = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date);
    if (dm) date = `${dm[3]}-${dm[2]}-${dm[1]}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('fecha no válida');
    const priceType = get('price_type') || 'shelf';
    if (!['shelf', 'promo', 'personal_discount'].includes(priceType)) errors.push('price_type debe ser shelf, promo o personal_discount');
    const channel = get('channel') || 'unknown';
    if (!['online', 'store', 'unknown'].includes(channel)) errors.push('channel debe ser online, store o unknown');
    const store = get('store');
    if (store.length < 2) errors.push('falta la tienda');
    const postal = get('postal_code') || null;
    if (postal && !/^\d{5}$/.test(postal)) errors.push('código postal no válido');
    return { line: i + 2, product: product ? { id: product.id, name: product.name, format: product.format } : null, amountCents: amount?.cents ?? null, observedOn: date,
      priceType, channel, storeLabel: store, postalCode: postal, promoNote: get('promo_note') || null, errors };
  });
}

shoppingRoutes.post('/prices/import/preview', async (c) => {
  const { csv } = await parseBody(c, z.object({ csv: z.string().min(1).max(100_000) }));
  const rows = await previewCsv(c.env.DB, csv);
  return c.json({ rows, valid: rows.filter((r) => !r.errors.length).length, invalid: rows.filter((r) => r.errors.length).length });
});

// La confirmación vuelve a analizar el CSV en el servidor: no se confía en filas editadas por el navegador.
shoppingRoutes.post('/prices/import/confirm', async (c) => {
  const me = c.get('user').id;
  const { csv, visibility } = await parseBody(c, z.object({ csv: z.string().min(1).max(100_000), visibility: z.enum(['private', 'shared_trips']).default('shared_trips') }));
  await rateLimit(c.env.DB, `csv:${me}`, 20, 86400);
  const rows = await previewCsv(c.env.DB, csv);
  const valid = rows.filter((x) => !x.errors.length);
  const t = now();
  const payload = await Promise.all(valid.map(async (r) => ({
    id: newId(), productId: r.product!.id, priceType: r.priceType, amount: r.amountCents, promo: r.promoNote, store: r.storeLabel, postal: r.postalCode, channel: r.channel, on: r.observedOn,
    dedupe: await sha256Hex(JSON.stringify([me, r.product!.id, r.priceType, r.amountCents, r.storeLabel, r.postalCode ?? null, r.channel, r.observedOn])),
  })));
  const J = (k: string) => `json_extract(value, '$.${k}')`;
  const ins = (chunk: typeof payload) => c.env.DB.prepare(
    `INSERT OR IGNORE INTO price_observations (id, product_id, source, price_type, amount_cents, promo_note, store_label, postal_code, channel, observed_on, owner_id, visibility, dedupe_hash, created_at)
     SELECT ${J('id')}, ${J('productId')}, 'csv', ${J('priceType')}, ${J('amount')}, ${J('promo')}, ${J('store')}, ${J('postal')}, ${J('channel')}, ${J('on')}, ?1, ?2, ${J('dedupe')}, ?3 FROM json_each(?4)`,
  ).bind(me, visibility, t, JSON.stringify(chunk));
  let created = 0;
  if (payload.length) {
    const res = await c.env.DB.batch([ins(payload.slice(0, 250)), ...(payload.length > 250 ? [ins(payload.slice(250))] : [])]);
    created = res.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  }
  return c.json({ created, duplicates: valid.length - created, skippedInvalid: rows.length - valid.length });
});

// ---------- Tickets ----------

const zReceiptMeta = z.object({
  text: z.string().min(10).max(30_000),
  storeLabel: z.string().trim().min(2).max(80),
  channel: z.enum(['online', 'store']),
  postalCode: z.string().regex(/^\d{5}$/).nullable().optional(),
});

type ProductLite = { id: string; name: string; brand: string | null; format: string | null; net_qty: number | null; net_unit: string | null };
const words = (t: string) => t.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !/^\d+$/.test(w));

/**
 * Sugerencias de producto para una línea: solo si TODAS las palabras significativas coinciden, y marcando si el
 * formato de la línea contradice el del producto. Son sugerencias: nada se asocia sin elección explícita.
 */
function suggestFor(desc: string, products: ProductLite[]) {
  const w = words(desc);
  if (!w.length) return [];
  const lineFormat = parseFormat(desc);
  return products
    .filter((p) => { const pw = new Set(words(`${p.name} ${p.brand ?? ''}`)); return w.every((x) => pw.has(x)); })
    .slice(0, 5)
    .map((p) => ({ id: p.id, name: p.name, brand: p.brand, format: p.format,
      formatMismatch: !!(lineFormat && p.net_qty != null && (lineFormat.netQty !== p.net_qty || lineFormat.netUnit !== p.net_unit)) }));
}

async function receiptState(db: D1Database, ownerId: string, hash: string) {
  return db.prepare(
    `SELECT r.id, r.created_at, r.trip_id, e.id AS expense_id, e.trip_id AS expense_trip_id FROM receipts r
     LEFT JOIN expenses e ON e.receipt_id = r.id AND e.deleted_at IS NULL WHERE r.owner_id = ?1 AND r.content_hash = ?2`,
  ).bind(ownerId, hash).first<{ id: string; created_at: number; trip_id: string | null; expense_id: string | null; expense_trip_id: string | null }>();
}

shoppingRoutes.post('/receipts/preview', async (c) => {
  const me = c.get('user').id;
  const b = await parseBody(c, zReceiptMeta);
  const parsed = parseReceiptText(b.text);
  const hash = await receiptHash(parsed);
  // 2 consultas, sea cual sea el nº de líneas.
  const [dup, { results: products }] = await Promise.all([
    receiptState(c.env.DB, me, hash),
    c.env.DB.prepare('SELECT id, name, brand, format, net_qty, net_unit FROM products WHERE replaced_by IS NULL ORDER BY name LIMIT 3000').all<ProductLite>(),
  ]);
  const suggestions = parsed.lines.map((l) => ({ lineNo: l.lineNo, candidates: suggestFor(l.description, products) }));
  const other = b.postalCode && b.postalCode !== '43007';
  return c.json({ parsed, hash, duplicate: dup ?? null, suggestions,
    note: `Revisa y corrige el texto si hace falta, y asocia el producto exacto de cada línea (las sugerencias no se aplican solas).${other || b.channel === 'store' ? ' Es un ticket de tienda física u otro código postal: no se presentará como precio online actual de Mercadona 43007.' : ''}` });
});

shoppingRoutes.post('/receipts/confirm', async (c) => {
  const me = c.get('user').id;
  const b = await parseBody(c, zReceiptMeta.extend({
    tripId: zId.nullable().optional(),
    mapping: z.array(z.object({ lineNo: z.number().int().min(1), productId: zId.nullable() })).max(300),
    visibility: z.enum(['private', 'shared_trips']).default('shared_trips'),
  }));
  // 1) Validación COMPLETA antes de escribir nada.
  if (b.tripId) await requireTripMember(c.env.DB, b.tripId, me);
  // Se vuelve a analizar el texto revisado en el servidor: los importes no vienen del navegador.
  const parsed = parseReceiptText(b.text);
  if (!parsed.purchasedOn) throw new ApiError(422, 'validation', 'No se encuentra la fecha del ticket.');
  if (parsed.totalCents == null) throw new ApiError(422, 'validation', 'No se encuentra el total del ticket.');
  if (!parsed.lines.length) throw new ApiError(422, 'validation', 'El ticket no tiene líneas reconocibles.');
  const hash = await receiptHash(parsed);
  // Doble confirmación / reintento: se devuelve el ticket ya importado (y su gasto, si lo tiene) sin duplicar nada.
  const existing = await receiptState(c.env.DB, me, hash);
  if (existing) return c.json({ receiptId: existing.id, alreadyImported: true, expenseId: existing.expense_id, lines: parsed.lines.length }, 200);
  const lineNos = new Set(parsed.lines.map((l) => l.lineNo));
  const map = new Map<number, string | null>();
  for (const m of b.mapping) {
    if (!lineNos.has(m.lineNo)) throw new ApiError(422, 'validation', `La línea ${m.lineNo} no existe en el ticket revisado.`);
    if (map.has(m.lineNo)) throw new ApiError(422, 'validation', `La línea ${m.lineNo} está asociada dos veces.`);
    map.set(m.lineNo, m.productId);
  }
  const productIds = [...new Set([...map.values()].filter((x): x is string => !!x))];
  if (productIds.length) {
    const { results } = await c.env.DB.prepare('SELECT id FROM products WHERE id IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(productIds)).all<{ id: string }>();
    const found = new Set(results.map((r) => r.id));
    const missing = productIds.filter((id) => !found.has(id));
    if (missing.length) throw new ApiError(422, 'unknown_product', 'Algún producto asociado no existe. Revisa las asociaciones; no se ha guardado nada.');
  }
  await rateLimit(c.env.DB, `receipt:${me}`, 30, 86400);
  const receiptId = newId();
  const t = now();
  const postal = b.postalCode ?? parsed.postalCode ?? null;
  const lines = parsed.lines.map((l) => {
    const productId = map.get(l.lineNo) ?? null;
    // Precio por envase solo si es inequívoco (unidades enteras, sin peso variable).
    const per = productId && !l.weightGrams && l.qty >= 1 ? l.unitCents ?? (l.qty === 1 ? l.amountCents : null) : null;
    return { id: newId(), lineNo: l.lineNo, raw: l.rawText, productId, qty: l.weightGrams ? l.weightGrams / 1000 : l.qty, unit: l.unitCents, amount: l.amountCents,
      price: per, priceId: newId(), dedupe: `${hash}:${l.lineNo}` };
  });
  // 2) Una sola transacción: cabecera, líneas y precios. Un fallo no deja cabecera ni hash que bloquee el reintento.
  const J = (k: string) => `json_extract(value, '$.${k}')`;
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO receipts (id, owner_id, trip_id, store_label, postal_code, channel, purchased_on, total_cents, content_hash, created_at, reviewed_text)
                        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`)
        .bind(receiptId, me, b.tripId ?? null, b.storeLabel, postal, b.channel, parsed.purchasedOn, parsed.totalCents, hash, t, b.text),
      c.env.DB.prepare(`INSERT INTO receipt_lines (id, receipt_id, line_no, raw_text, product_id, qty, unit_cents, amount_cents)
                        SELECT ${J('id')}, ?1, ${J('lineNo')}, ${J('raw')}, ${J('productId')}, ${J('qty')}, ${J('unit')}, ${J('amount')} FROM json_each(?2)`)
        .bind(receiptId, JSON.stringify(lines)),
      c.env.DB.prepare(`INSERT OR IGNORE INTO price_observations (id, product_id, source, price_type, amount_cents, store_label, postal_code, channel, observed_on, receipt_line_id, owner_id, visibility, dedupe_hash, created_at)
                        SELECT ${J('priceId')}, ${J('productId')}, 'receipt', 'receipt_effective', ${J('price')}, ?1, ?2, ?3, ?4, ${J('id')}, ?5, ?6, ${J('dedupe')}, ?7
                        FROM json_each(?8) WHERE ${J('price')} IS NOT NULL`)
        .bind(b.storeLabel, postal, b.channel, parsed.purchasedOn, me, b.visibility, t, JSON.stringify(lines)),
    ]);
  } catch (e) {
    // Carrera con otra confirmación simultánea del mismo ticket: se devuelve el que ganó.
    if (/UNIQUE/.test(String(e))) {
      const won = await receiptState(c.env.DB, me, hash);
      if (won) return c.json({ receiptId: won.id, alreadyImported: true, expenseId: won.expense_id, lines: parsed.lines.length }, 200);
    }
    throw e;
  }
  return c.json({ receiptId, alreadyImported: false, expenseId: null, lines: parsed.lines.length, prices: lines.filter((l) => l.price != null).length,
    warnings: parsed.warnings, sumMatchesTotal: parsed.sumMatchesTotal }, 201);
});

/** Tickets propios con su estado de vinculación: permite completar un gasto que falló sin volver a importar. */
shoppingRoutes.get('/receipts', async (c) => {
  const me = c.get('user').id;
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.trip_id, r.store_label, r.postal_code, r.channel, r.purchased_on, r.total_cents, r.created_at,
            (SELECT COUNT(*) FROM receipt_lines l WHERE l.receipt_id = r.id) AS lines, e.id AS expense_id, e.trip_id AS expense_trip_id
     FROM receipts r LEFT JOIN expenses e ON e.receipt_id = r.id AND e.deleted_at IS NULL
     WHERE r.owner_id = ?1 ORDER BY r.created_at DESC LIMIT 50`,
  ).bind(me).all();
  return c.json({ receipts: results });
});

// Añadir un ticket como gasto: acción explícita, atómica e idempotente (receipt_id es UNIQUE en expenses).
shoppingRoutes.post('/receipts/:rid/expense', async (c) => {
  const me = c.get('user').id;
  const r = await c.env.DB.prepare(
    `SELECT r.*, e.id AS expense_id, e.trip_id AS expense_trip_id FROM receipts r LEFT JOIN expenses e ON e.receipt_id = r.id AND e.deleted_at IS NULL WHERE r.id = ?1`,
  ).bind(c.req.param('rid')).first<any>();
  if (!r || r.owner_id !== me) throw notFound('Ticket');
  const b = await parseBody(c, z.object({ tripId: zId, concept: z.string().trim().min(1).max(200).default('Compra'), participants: z.array(zId).min(1).max(60) }));
  if (r.expense_id) {
    // Reintento tras un fallo de red: si ya quedó vinculado a este viaje, se devuelve el gasto existente.
    if (r.expense_trip_id === b.tripId) return c.json({ expenseId: r.expense_id, alreadyLinked: true }, 200);
    throw conflict('Este ticket ya está vinculado a un gasto de otro viaje.', 'receipt_already_linked');
  }
  await requireTripMember(c.env.DB, b.tripId, me);
  const { results: members } = await c.env.DB.prepare('SELECT user_id FROM trip_members WHERE trip_id = ?1').bind(b.tripId).all<{ user_id: string }>();
  const set = new Set(members.map((m) => m.user_id));
  if (!b.participants.every((p) => set.has(p))) throw new ApiError(422, 'validation', 'Todos los participantes deben ser miembros del viaje.');
  const shares = splitEqual(r.total_cents, b.participants);
  const id = newId();
  const t = now();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO expenses (id, trip_id, concept, spent_on, payer_id, amount_cents, split_mode, category, receipt_id, created_by, created_at, updated_at)
                        VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'equal', 'compra', ?7, ?5, ?8, ?8)`).bind(id, b.tripId, b.concept, r.purchased_on, me, r.total_cents, r.id, t),
      insertShares(c.env.DB, id, shares),
      c.env.DB.prepare(`INSERT INTO expense_history (id, expense_id, trip_id, actor_id, action, after_json, at) VALUES (?1, ?2, ?3, ?4, 'create', ?5, ?6)`)
        .bind(newId(), id, b.tripId, me, JSON.stringify({ receiptId: r.id, amountCents: r.total_cents }), t),
    ]);
  } catch (e) {
    if (/UNIQUE/.test(String(e))) {
      const won = await c.env.DB.prepare('SELECT id, trip_id FROM expenses WHERE receipt_id = ?1 AND deleted_at IS NULL').bind(r.id).first<{ id: string; trip_id: string }>();
      if (won?.trip_id === b.tripId) return c.json({ expenseId: won.id, alreadyLinked: true }, 200);
      throw conflict('Este ticket ya está vinculado a un gasto.', 'receipt_already_linked');
    }
    throw e;
  }
  return c.json({ expenseId: id, alreadyLinked: false }, 201);
});

// ---------- Cesta fija ----------

shoppingRoutes.get('/trips/:id/shopping/basket', async (c) => {
  const me = c.get('user').id;
  const tripId = c.req.param('id');
  await requireTripMember(c.env.DB, tripId, me);
  const q = parseQuery(c, z.object({
    store: z.string().trim().min(2).max(80).optional(), postalCode: z.string().regex(/^\d{5}$/).optional(), channel: z.enum(['online', 'store', 'unknown']).optional(),
    priceType: z.enum(['shelf', 'promo', 'personal_discount', 'receipt_effective']).optional(),
  }));
  const list = await ensureList(c.env.DB, tripId);
  const [{ results: items }, { results: obs }] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT i.product_id, i.qty, p.name, p.format, p.replaced_by FROM shopping_items i JOIN products p ON p.id = i.product_id WHERE i.list_id = ?1 ORDER BY i.created_at`).bind(list.id),
    c.env.DB.prepare(`SELECT ${OBS_COLS} FROM price_observations po
       WHERE po.product_id IN (SELECT product_id FROM shopping_items WHERE list_id = ?2 AND product_id IS NOT NULL) AND ${VISIBLE}
       ORDER BY po.observed_on DESC LIMIT 5000`).bind(me, list.id),
  ]) as [D1Result<{ product_id: string; qty: number; name: string; format: string | null; replaced_by: string | null }>, D1Result<any>];
  const fromQuery = q.store !== undefined || q.postalCode !== undefined || q.channel !== undefined || q.priceType !== undefined;
  const criterion: Criterion = { storeLabel: q.store ?? list.store_label, postalCode: q.postalCode ?? list.postal_code, channel: q.channel ?? list.channel, priceType: q.priceType ?? 'shelf' };
  const basketItems = items.map((i) => ({ productId: i.product_id, qty: i.qty }));
  const observations = obs.map(obsOut);
  const evo = basketEvolution(basketItems, observations, criterion);
  const meta = new Map(items.map((i) => [i.product_id, i]));
  return c.json({
    criterion: { ...criterion, origin: fromQuery ? 'query' : 'list' },
    products: evo.products.map((p) => ({ ...p, name: meta.get(p.productId)?.name ?? null, format: meta.get(p.productId)?.format ?? null,
      replacedBy: meta.get(p.productId)?.replaced_by ?? null })),
    points: evo.points,
    latest: evo.latest,
    availableSeries: availableSeries(basketItems, observations),
    note: items.length
      ? 'Serie única: tienda, código postal, canal y tipo de precio. Solo hay total en fechas con precio de todos los productos; sin dato no se interpola. Promociones y descuentos personales son series aparte.'
      : 'Asocia productos exactos a la lista para seguir una cesta fija.',
  });
});

// ---------- Open Prices (colaborativo, ODbL) ----------

shoppingRoutes.get('/products/:pid/open-prices', async (c) => {
  const me = c.get('user').id;
  const p = await c.env.DB.prepare('SELECT ean FROM products WHERE id = ?1').bind(c.req.param('pid')).first<{ ean: string | null }>();
  if (!p) throw notFound('Producto');
  if (!p.ean) return c.json({ status: 'no_ean', items: [], note: 'Sin EAN no se puede consultar Open Prices.' });
  await rateLimit(c.env.DB, `openprices:${me}`, 60, 3600);
  const r = await fetchOpenPrices(c.env.DB, p.ean);
  return c.json({ ...r, attribution: 'Datos colaborativos de Open Prices (Open Food Facts), licencia ODbL. No son precios de Mercadona Tarragona salvo que la tienda lo indique.' });
});

