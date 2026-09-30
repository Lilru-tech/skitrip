import { Hono } from 'hono';
import { z } from 'zod';
import { parseReceiptText, receiptHash } from '../../core/parsers/receipt';
import { parseAmount } from '../../core/parsers/money';
import { parseFormat, unitPrice } from '../../core/parsers/unit-price';
import { splitEqual } from '../../core/split';
import type { AppEnv } from '../env';
import { requireTripMember } from '../access';
import { sha256Hex } from '../crypto';
import { ApiError, conflict, forbidden, newId, notFound, now, parseBody, parseQuery } from '../http';
import { rateLimit } from '../ratelimit';
import { zDate, zId } from '../schemas';
import { fetchOpenPrices } from '../open-prices';

// Compra: productos exactos, lista por viaje, precios manuales/CSV/ticket y capa colaborativa separada.
// El adaptador directo de Mercadona está deshabilitado: ver src/worker/price-providers.ts.
export const shoppingRoutes = new Hono<AppEnv>();

/** Observaciones que `me` puede ver: propias, compartidas por alguien con quien comparte viaje, o colaborativas públicas. */
const VISIBLE = `(po.owner_id = ?1 OR po.visibility = 'public_collab' OR (po.visibility = 'shared_trips' AND EXISTS (
  SELECT 1 FROM trip_members a JOIN trip_members b ON a.trip_id = b.trip_id WHERE a.user_id = po.owner_id AND b.user_id = ?1)))`;

const productOut = (p: any) => p && ({
  id: p.id, retailer: p.retailer, retailerRef: p.retailer_ref, ean: p.ean, name: p.name, brand: p.brand, format: p.format,
  netQty: p.net_qty, netUnit: p.net_unit, refUrl: p.ref_url, replacedBy: p.replaced_by,
});

async function ensureList(db: D1Database, tripId: string) {
  let l = await db.prepare('SELECT * FROM shopping_lists WHERE trip_id = ?1').bind(tripId).first<any>();
  if (!l) {
    await db.prepare('INSERT OR IGNORE INTO shopping_lists (id, trip_id, created_at) VALUES (?1, ?2, ?3)').bind(newId(), tripId, now()).run();
    l = await db.prepare('SELECT * FROM shopping_lists WHERE trip_id = ?1').bind(tripId).first<any>();
  }
  return l;
}

/**
 * Estimación de la lista para el presupuesto: último precio de estantería o de ticket COMPARTIDO por un
 * miembro del viaje. Los datos colaborativos (otras tiendas) no entran en la estimación.
 */
export async function estimateList(db: D1Database, tripId: string) {
  const { results } = await db.prepare(
    `SELECT i.id, i.qty, i.product_id,
       (SELECT po.amount_cents FROM price_observations po WHERE po.product_id = i.product_id AND po.visibility = 'shared_trips' AND po.price_type IN ('shelf','receipt_effective')
          AND po.owner_id IN (SELECT user_id FROM trip_members WHERE trip_id = ?1) ORDER BY po.observed_on DESC, po.created_at DESC LIMIT 1) AS amount_cents,
       (SELECT po.observed_on FROM price_observations po WHERE po.product_id = i.product_id AND po.visibility = 'shared_trips' AND po.price_type IN ('shelf','receipt_effective')
          AND po.owner_id IN (SELECT user_id FROM trip_members WHERE trip_id = ?1) ORDER BY po.observed_on DESC, po.created_at DESC LIMIT 1) AS observed_on
     FROM shopping_items i JOIN shopping_lists l ON l.id = i.list_id WHERE l.trip_id = ?1`,
  ).bind(tripId).all<{ id: string; qty: number; product_id: string | null; amount_cents: number | null; observed_on: string | null }>();
  const priced = results.filter((r) => r.amount_cents != null);
  return {
    items: results.length,
    priced: priced.length,
    unpriced: results.length - priced.length,
    knownCents: priced.reduce((s, r) => s + r.amount_cents! * r.qty, 0),
    complete: results.length > 0 && priced.length === results.length,
    oldestPriceOn: priced.map((r) => r.observed_on!).sort()[0] ?? null,
    byItem: new Map(results.map((r) => [r.id, r])),
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
  return c.json({
    list: { id: list.id, storeLabel: list.store_label, postalCode: list.postal_code, channel: list.channel },
    items: results.map((i) => {
      const e = est.byItem.get(i.id);
      const up = e?.amount_cents != null && i.p_net_qty ? unitPrice(e.amount_cents, i.p_net_qty, i.p_net_unit) : null;
      return {
        id: i.id, name: i.name, qty: i.qty, note: i.note, bought: !!i.bought, assigneeId: i.assignee_id, assigneeAlias: i.assignee_alias, legacyName: i.legacy_name, version: i.version,
        product: i.product_id ? { id: i.product_id, name: i.p_name, brand: i.p_brand, format: i.p_format, netQty: i.p_net_qty, netUnit: i.p_net_unit, ean: i.p_ean } : null,
        price: e?.amount_cents != null ? { amountCents: e.amount_cents, observedOn: e.observed_on, unitPrice: up } : null,
      };
    }),
    estimate: { items: est.items, priced: est.priced, unpriced: est.unpriced, knownCents: est.knownCents, complete: est.complete, oldestPriceOn: est.oldestPriceOn },
    note: 'Estimación con precios compartidos por miembros del viaje (manuales o de tickets). No es la tarifa actual de Mercadona online.',
  });
});

const zItem = z.object({
  name: z.string().trim().min(1).max(120),
  productId: zId.nullable().optional(),
  qty: z.number().int().min(1).max(999).default(1),
  note: z.string().max(300).nullable().optional(),
  assigneeId: zId.nullable().optional(),
});

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
  const b = await parseBody(c, zItem.partial().extend({ bought: z.boolean().optional(), version: z.number().int().positive() }));
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
  const chain: any[] = [];
  let cur = p;
  while (cur?.replaced_by && chain.length < 10) { cur = await c.env.DB.prepare('SELECT id, name, format FROM products WHERE id = ?1').bind(cur.replaced_by).first(); chain.push(cur); }
  return c.json({ product: productOut(p), series, replacedBy: chain, note: 'Sin observación un día = sin dato; no se rellena con el precio anterior.' });
});

// CSV: previsualizar y confirmar. Columnas: product_id|ean, amount, price_type, store, postal_code, channel, date (YYYY-MM-DD o DD/MM/YYYY), promo_note
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',' || ch === ';') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

async function previewCsv(db: D1Database, csv: string) {
  const rows = parseCsv(csv);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const out = [];
  for (let n = 1; n < rows.length && n <= 500; n++) {
    const r = rows[n];
    const get = (name: string) => (col(name) >= 0 ? (r[col(name)] ?? '').trim() : '');
    const errors: string[] = [];
    let productId = get('product_id') || null;
    const ean = get('ean') || null;
    if (!productId && ean) productId = (await db.prepare('SELECT id FROM products WHERE ean = ?1 AND replaced_by IS NULL').bind(ean).first<{ id: string }>())?.id ?? null;
    const product = productId ? await db.prepare('SELECT id, name, format FROM products WHERE id = ?1').bind(productId).first<any>() : null;
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
    out.push({ line: n + 1, product: product ? { id: product.id, name: product.name, format: product.format } : null, amountCents: amount?.cents ?? null, observedOn: date,
      priceType, channel, storeLabel: store, postalCode: postal, promoNote: get('promo_note') || null, errors });
  }
  return out;
}

shoppingRoutes.post('/prices/import/preview', async (c) => {
  const { csv } = await parseBody(c, z.object({ csv: z.string().min(1).max(60_000) }));
  const rows = await previewCsv(c.env.DB, csv);
  return c.json({ rows, valid: rows.filter((r) => !r.errors.length).length, invalid: rows.filter((r) => r.errors.length).length });
});

// La confirmación vuelve a analizar el CSV en el servidor: no se confía en filas editadas por el navegador.
shoppingRoutes.post('/prices/import/confirm', async (c) => {
  const me = c.get('user').id;
  const { csv, visibility } = await parseBody(c, z.object({ csv: z.string().min(1).max(60_000), visibility: z.enum(['private', 'shared_trips']).default('shared_trips') }));
  await rateLimit(c.env.DB, `csv:${me}`, 20, 86400);
  const rows = await previewCsv(c.env.DB, csv);
  let created = 0, duplicates = 0;
  for (const r of rows.filter((x) => !x.errors.length)) {
    const ok = await insertPrice(c.env.DB, me, { productId: r.product!.id, amountCents: r.amountCents!, priceType: r.priceType as any, promoNote: r.promoNote, storeLabel: r.storeLabel,
      postalCode: r.postalCode, channel: r.channel as any, observedOn: r.observedOn, visibility }, 'csv');
    ok ? created++ : duplicates++;
  }
  return c.json({ created, duplicates, skippedInvalid: rows.filter((x) => x.errors.length).length });
});

// ---------- Tickets ----------

const zReceiptMeta = z.object({
  text: z.string().min(10).max(30_000),
  storeLabel: z.string().trim().min(2).max(80),
  channel: z.enum(['online', 'store']),
  postalCode: z.string().regex(/^\d{5}$/).nullable().optional(),
});

shoppingRoutes.post('/receipts/preview', async (c) => {
  const me = c.get('user').id;
  const b = await parseBody(c, zReceiptMeta);
  const parsed = parseReceiptText(b.text);
  const hash = await receiptHash(parsed);
  const dup = await c.env.DB.prepare('SELECT id, created_at FROM receipts WHERE owner_id = ?1 AND content_hash = ?2').bind(me, hash).first();
  const suggestions = [];
  for (const l of parsed.lines) {
    const words = l.description.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().split(/\s+/).filter((w) => w.length >= 3).slice(0, 2);
    const { results } = words.length
      ? await c.env.DB.prepare(`SELECT id, name, brand, format FROM products WHERE replaced_by IS NULL AND ${words.map((_, i) => `lower(name) LIKE ?${i + 1}`).join(' AND ')} LIMIT 5`).bind(...words.map((w) => `%${w}%`)).all()
      : { results: [] };
    suggestions.push({ lineNo: l.lineNo, candidates: results });
  }
  return c.json({ parsed, hash, duplicate: dup ?? null, suggestions,
    note: `Revisa cada línea y asocia el producto exacto. ${b.postalCode && b.postalCode !== '43007' ? 'Este ticket es de otra tienda: no se presentará como precio actual de Mercadona online 43007.' : ''}`.trim() });
});

shoppingRoutes.post('/receipts/confirm', async (c) => {
  const me = c.get('user').id;
  const b = await parseBody(c, zReceiptMeta.extend({
    tripId: zId.nullable().optional(),
    mapping: z.array(z.object({ lineNo: z.number().int().min(1), productId: zId.nullable() })).max(300),
    visibility: z.enum(['private', 'shared_trips']).default('shared_trips'),
  }));
  if (b.tripId) await requireTripMember(c.env.DB, b.tripId, me);
  await rateLimit(c.env.DB, `receipt:${me}`, 30, 86400);
  // Se vuelve a analizar el texto en el servidor: los importes no vienen del navegador.
  const parsed = parseReceiptText(b.text);
  if (!parsed.purchasedOn) throw new ApiError(422, 'validation', 'No se encuentra la fecha del ticket.');
  if (parsed.totalCents == null) throw new ApiError(422, 'validation', 'No se encuentra el total del ticket.');
  const hash = await receiptHash(parsed);
  const receiptId = newId();
  const t = now();
  try {
    await c.env.DB.prepare(
      `INSERT INTO receipts (id, owner_id, trip_id, store_label, postal_code, channel, purchased_on, total_cents, content_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    ).bind(receiptId, me, b.tripId ?? null, b.storeLabel, b.postalCode ?? parsed.postalCode ?? null, b.channel, parsed.purchasedOn, parsed.totalCents, hash, t).run();
  } catch (e) {
    if (/UNIQUE/.test(String(e))) throw conflict('Este ticket ya estaba importado.', 'receipt_duplicate');
    throw e;
  }
  const map = new Map(b.mapping.map((m) => [m.lineNo, m.productId]));
  const stmts: D1PreparedStatement[] = [];
  let prices = 0;
  for (const l of parsed.lines) {
    const lineId = newId();
    const productId = map.get(l.lineNo) ?? null;
    if (productId && !(await c.env.DB.prepare('SELECT 1 FROM products WHERE id = ?1').bind(productId).first())) throw notFound('Producto');
    stmts.push(c.env.DB.prepare(`INSERT INTO receipt_lines (id, receipt_id, line_no, raw_text, product_id, qty, unit_cents, amount_cents) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`)
      .bind(lineId, receiptId, l.lineNo, l.rawText, productId, l.weightGrams ? l.weightGrams / 1000 : l.qty, l.unitCents, l.amountCents));
    // Precio por envase solo si es inequívoco (unidades enteras, sin peso variable).
    if (productId && !l.weightGrams && l.qty >= 1) {
      const per = l.unitCents ?? (l.qty === 1 ? l.amountCents : null);
      if (per != null) {
        prices++;
        stmts.push(c.env.DB.prepare(
          `INSERT OR IGNORE INTO price_observations (id, product_id, source, price_type, amount_cents, store_label, postal_code, channel, observed_on, receipt_line_id, owner_id, visibility, dedupe_hash, created_at)
           VALUES (?1, ?2, 'receipt', 'receipt_effective', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
        ).bind(newId(), productId, per, b.storeLabel, b.postalCode ?? parsed.postalCode ?? null, b.channel, parsed.purchasedOn, lineId, me, b.visibility, `${hash}:${l.lineNo}`, t));
      }
    }
  }
  for (let i = 0; i < stmts.length; i += 50) await c.env.DB.batch(stmts.slice(i, i + 50));
  return c.json({ receiptId, lines: parsed.lines.length, prices, warnings: parsed.warnings, sumMatchesTotal: parsed.sumMatchesTotal }, 201);
});

// Añadir un ticket como gasto: acción explícita y vínculo único (receipt_id es UNIQUE en expenses).
shoppingRoutes.post('/receipts/:rid/expense', async (c) => {
  const me = c.get('user').id;
  const r = await c.env.DB.prepare('SELECT * FROM receipts WHERE id = ?1').bind(c.req.param('rid')).first<any>();
  if (!r || r.owner_id !== me) throw notFound('Ticket');
  const b = await parseBody(c, z.object({ tripId: zId, concept: z.string().trim().min(1).max(200).default('Compra'), participants: z.array(zId).min(1).max(60) }));
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
      ...[...shares].map(([u, s]) => c.env.DB.prepare('INSERT INTO expense_shares (expense_id, user_id, share_cents) VALUES (?1, ?2, ?3)').bind(id, u, s)),
      c.env.DB.prepare(`INSERT INTO expense_history (id, expense_id, trip_id, actor_id, action, after_json, at) VALUES (?1, ?2, ?3, ?4, 'create', ?5, ?6)`)
        .bind(newId(), id, b.tripId, me, JSON.stringify({ receiptId: r.id, amountCents: r.total_cents }), t),
    ]);
  } catch (e) {
    if (/UNIQUE/.test(String(e))) throw conflict('Este ticket ya está vinculado a un gasto.', 'receipt_already_linked');
    throw e;
  }
  return c.json({ expenseId: id }, 201);
});

// ---------- Cesta fija ----------

shoppingRoutes.get('/trips/:id/shopping/basket', async (c) => {
  const me = c.get('user').id;
  const tripId = c.req.param('id');
  await requireTripMember(c.env.DB, tripId, me);
  const { results: items } = await c.env.DB.prepare(
    `SELECT i.product_id, i.qty, p.name FROM shopping_items i JOIN shopping_lists l ON l.id = i.list_id JOIN products p ON p.id = i.product_id WHERE l.trip_id = ?1`,
  ).bind(tripId).all<{ product_id: string; qty: number; name: string }>();
  if (!items.length) return c.json({ products: [], points: [], note: 'Asocia productos exactos a la lista para seguir una cesta fija.' });
  const ids = items.map((i) => i.product_id);
  const ph = ids.map((_, i) => `?${i + 2}`).join(',');
  const { results: obs } = await c.env.DB.prepare(
    `SELECT po.product_id, po.observed_on, MIN(po.amount_cents) AS amount_cents FROM price_observations po
     WHERE po.product_id IN (${ph}) AND po.price_type IN ('shelf','receipt_effective') AND ${VISIBLE.replaceAll('?1', '?1')}
     GROUP BY po.product_id, po.observed_on ORDER BY po.observed_on`,
  ).bind(me, ...ids).all<{ product_id: string; observed_on: string; amount_cents: number }>();
  // Un punto de cesta solo existe en fechas con precio observado de TODOS los productos: sin arrastrar precios.
  const byDate = new Map<string, Map<string, number>>();
  for (const o of obs) (byDate.get(o.observed_on) ?? byDate.set(o.observed_on, new Map()).get(o.observed_on)!).set(o.product_id, o.amount_cents);
  const points = [...byDate].map(([date, m]) => ({
    date, coverage: m.size / ids.length,
    totalCents: m.size === ids.length ? items.reduce((s, i) => s + m.get(i.product_id)! * i.qty, 0) : null,
  }));
  return c.json({ products: items, points, note: 'Solo hay total en fechas con precio de todos los productos. El resto muestra la cobertura.' });
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

