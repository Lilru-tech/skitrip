import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, befriend, signup } from './helpers';

// Listas generales de la compra (migración 0010): privadas, importación idempotente de la hoja antigua, copias
// independientes en cada viaje y vista previa de coincidencias.

type U = Awaited<ReturnType<typeof signup>>;
const L = '/api/shopping-lists';

beforeAll(async () => {
  const db = env.DB;
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO legacy_import_files (id, kind, file_name, sha256, bytes, records, imported_at) VALUES ('gl-lf','sheets_shopping','compra.csv','gl-sha',0,0,0)`),
    db.prepare(`INSERT OR IGNORE INTO legacy_shopping_items (id, file_id, row_hash, name, quantity_text, price_text, legacy_person_name, extra_json) VALUES
      ('gl-ls1','gl-lf','gl-h1','Leche semidesnatada (Hacendado)','3','0.88','Pepe','{"perDay":"TRUE"}'),
      ('gl-ls2','gl-lf','gl-h2','Cerveza (Hacendado)','24','0.8',NULL,'{"perDay":"FALSE"}'),
      ('gl-ls3','gl-lf','gl-h3','Fruta variada','unos cuantos',NULL,NULL,NULL)`),
  ]);
});

async function newList(u: U, name = 'Básicos') {
  const r = await api(u.token, 'POST', L, { name });
  expect(r.status).toBe(201);
  return r.json.list.id as string;
}
async function product(u: U, name: string, format: string | null = '1 L') {
  return (await api(u.token, 'POST', '/api/products', { name, format })).json.product.id as string;
}
const tripItems = async (u: U, tripId: string) => (await api(u.token, 'GET', `/api/trips/${tripId}/shopping`)).json.items as any[];
const listItems = async (u: U, lid: string) => (await api(u.token, 'GET', `${L}/${lid}`)).json.items as any[];

describe('lista general: privacidad', () => {
  it('se crea y edita sin viaje; otra cuenta recibe 404 al leer, editar, borrar, importar o copiar', async () => {
    const owner = await signup();
    const other = await signup();
    // Ni siquiera la amistad o compartir viaje da acceso: la lista es privada.
    await befriend(owner, other);
    expect((await api(owner.token, 'GET', '/api/trips')).json.trips).toEqual([]);
    const lid = await newList(owner);
    const item = (await api(owner.token, 'POST', `${L}/${lid}/items`, { name: 'Leche', qty: 2, note: 'sin lactosa' })).json;
    expect((await api(owner.token, 'PATCH', `${L}/${lid}/items/${item.id}`, { qty: 3, version: 1 })).status).toBe(200);
    expect((await api(owner.token, 'PATCH', `${L}/${lid}`, { name: 'Básicos de nieve', version: 1 })).status).toBe(200);
    const mine = await api(owner.token, 'GET', `${L}/${lid}`);
    expect(mine.json.list.name).toBe('Básicos de nieve');
    expect(mine.json.items).toMatchObject([{ name: 'Leche', qty: 3, note: 'sin lactosa', missing: ['product'] }]);

    const otherTrip = (await api(other.token, 'POST', '/api/trips', { name: 'Viaje ajeno' })).json.trip;
    const attempts: [string, string, unknown?][] = [
      ['GET', `${L}/${lid}`],
      ['PATCH', `${L}/${lid}`, { name: 'Robada', version: 2 }],
      ['DELETE', `${L}/${lid}`],
      ['POST', `${L}/${lid}/items`, { name: 'Intruso' }],
      ['PATCH', `${L}/${lid}/items/${item.id}`, { qty: 9, version: 2 }],
      ['DELETE', `${L}/${lid}/items/${item.id}`],
      ['GET', `${L}/${lid}/legacy`],
      ['POST', `${L}/${lid}/legacy-import`, { legacyIds: ['gl-ls1'] }],
      ['POST', `${L}/${lid}/copy/preview`, { tripId: otherTrip.id }],
      ['POST', `${L}/${lid}/copy`, { tripId: otherTrip.id, items: [{ itemId: item.id, action: 'add' }] }],
    ];
    for (const [method, path, body] of attempts) {
      const r = await api(other.token, method, path, body);
      expect(r.status, `${method} ${path}`).toBe(404);
      expect(JSON.stringify(r.json)).not.toContain('Leche');
    }
    expect((await api(other.token, 'GET', L)).json.lists).toEqual([]);
    // Nada ha cambiado y el intruso no ha conseguido copiar a su viaje.
    expect(await listItems(owner, lid)).toMatchObject([{ name: 'Leche', qty: 3, version: 2 }]);
    expect(await tripItems(other, otherTrip.id)).toEqual([]);
    expect((await api(owner.token, 'GET', L)).json.lists).toMatchObject([{ id: lid, name: 'Básicos de nieve', items: 1, withoutProduct: 1 }]);
  });

  it('copiar exige ser miembro del viaje de destino (404 sin revelar el viaje)', async () => {
    const owner = await signup();
    const stranger = await signup();
    const lid = await newList(owner);
    const item = (await api(owner.token, 'POST', `${L}/${lid}/items`, { name: 'Pan' })).json;
    const strangerTrip = (await api(stranger.token, 'POST', '/api/trips', { name: 'No es mío' })).json.trip;
    expect((await api(owner.token, 'POST', `${L}/${lid}/copy/preview`, { tripId: strangerTrip.id })).status).toBe(404);
    expect((await api(owner.token, 'POST', `${L}/${lid}/copy`, { tripId: strangerTrip.id, items: [{ itemId: item.id, action: 'add' }] })).status).toBe(404);
    expect(await tripItems(stranger, strangerTrip.id)).toEqual([]);
  });

  it('un PATCH con versión antigua da 409 y el límite de listas se respeta', async () => {
    const u = await signup();
    const lid = await newList(u);
    const it = (await api(u.token, 'POST', `${L}/${lid}/items`, { name: 'Café' })).json;
    expect((await api(u.token, 'PATCH', `${L}/${lid}/items/${it.id}`, { note: 'molido', version: 1 })).status).toBe(200);
    expect((await api(u.token, 'PATCH', `${L}/${lid}/items/${it.id}`, { note: 'en grano', version: 1 })).json.error.code).toBe('version_conflict');
    // Un PATCH parcial no reinicia la cantidad ni «por día».
    await api(u.token, 'PATCH', `${L}/${lid}/items/${it.id}`, { qty: 4, perDay: true, version: 2 });
    await api(u.token, 'PATCH', `${L}/${lid}/items/${it.id}`, { name: 'Café molido', version: 3 });
    expect(await listItems(u, lid)).toMatchObject([{ name: 'Café molido', qty: 4, perDay: true, note: 'molido' }]);
    for (let i = 1; i < 20; i++) await newList(u, `Lista ${i}`);
    expect((await api(u.token, 'POST', L, { name: 'Una más' })).json.error.code).toBe('limit');
  });
});

describe('lista general: hoja antigua', () => {
  it('vista previa sin nombres de personas, importación idempotente y artículos incompletos con lo que falta', async () => {
    const u = await signup();
    const lid = await newList(u);
    const prev = await api(u.token, 'GET', `${L}/${lid}/legacy`);
    expect(prev.status).toBe(200);
    expect(JSON.stringify(prev.json)).not.toContain('Pepe');
    const byId = Object.fromEntries(prev.json.items.map((i: any) => [i.id, i]));
    expect(byId['gl-ls1']).toMatchObject({ qty: 3, qtyUnclear: false, perDay: true, priceText: '0.88', importedHere: false, missing: ['product'] });
    expect(byId['gl-ls2']).toMatchObject({ qty: 24, perDay: false });
    expect(byId['gl-ls3']).toMatchObject({ qty: 1, qtyUnclear: true, missing: ['product', 'qty'] });
    expect(prev.json.note).toMatch(/nunca como precio actual/);

    const ids = ['gl-ls1', 'gl-ls2', 'gl-ls3'];
    const obsBefore = (await env.DB.prepare('SELECT COUNT(*) AS n FROM price_observations').first<{ n: number }>())!.n;
    expect((await api(u.token, 'POST', `${L}/${lid}/legacy-import`, { legacyIds: ids })).json).toEqual({ created: 3, alreadyImported: 0 });
    // Repetir (todo o en parte) no duplica.
    expect((await api(u.token, 'POST', `${L}/${lid}/legacy-import`, { legacyIds: ids })).json).toEqual({ created: 0, alreadyImported: 3 });
    expect((await api(u.token, 'POST', `${L}/${lid}/legacy-import`, { legacyIds: ['gl-ls2'] })).json).toEqual({ created: 0, alreadyImported: 1 });
    const items = await listItems(u, lid);
    expect(items).toHaveLength(3);
    const fruit = items.find((i) => i.legacy?.itemId === 'gl-ls3');
    expect(fruit).toMatchObject({ name: 'Fruta variada', qty: 1, qtyUnclear: true, product: null, lastPrice: null, missing: ['product', 'qty'],
      legacy: { quantityText: 'unos cuantos', priceText: null } });
    const milk = items.find((i) => i.legacy?.itemId === 'gl-ls1');
    expect(milk).toMatchObject({ qty: 3, perDay: true, legacy: { priceText: '0.88' }, lastPrice: null });
    // El precio de la hoja nunca se convierte en observación de precio.
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM price_observations').first<{ n: number }>())!.n).toBe(obsBefore);
    expect((await api(u.token, 'GET', `${L}/${lid}/legacy`)).json.items.filter((i: any) => i.importedHere)).toHaveLength(3);

    // Revisar: fijar la cantidad resuelve la duda; asociar producto deja pendiente solo el precio (o el formato).
    const pid = await product(u, `Fruta bolsa ${Math.random()}`, null);
    await api(u.token, 'PATCH', `${L}/${lid}/items/${fruit.id}`, { qty: 2, productId: pid, version: fruit.version });
    expect((await listItems(u, lid)).find((i) => i.id === fruit.id).missing).toEqual(['format', 'price']);
    // Otra cuenta importa en su propia lista sin interferir.
    const v = await signup();
    const vl = await newList(v);
    expect((await api(v.token, 'POST', `${L}/${vl}/legacy-import`, { legacyIds: ids })).json.created).toBe(3);
    expect(await listItems(u, lid)).toHaveLength(3);
    expect((await api(u.token, 'POST', `${L}/${lid}/legacy-import`, { legacyIds: ['no-existe'] })).status).toBe(404);
  });
});

describe('lista general → viajes', () => {
  async function setup() {
    const a = await signup();
    const b = await signup();
    await befriend(a, b);
    const tripA = (await api(a.token, 'POST', '/api/trips', { name: 'Viaje A', skiDays: 3 })).json.trip;
    const tripB = (await api(a.token, 'POST', '/api/trips', { name: 'Viaje B' })).json.trip;
    const inv = (await api(a.token, 'POST', `/api/trips/${tripA.id}/invitations`, { userId: b.id })).json.invitation;
    await api(b.token, 'POST', `/api/trips/invitations/${inv.id}/accept`);
    const lid = await newList(a);
    const pid = await product(a, `Leche entera ${Math.random()}`);
    const milk = (await api(a.token, 'POST', `${L}/${lid}/items`, { name: 'Leche', productId: pid, qty: 2, perDay: true, note: 'brick' })).json.id as string;
    const bread = (await api(a.token, 'POST', `${L}/${lid}/items`, { name: 'Pan de molde', qty: 1 })).json.id as string;
    return { a, b, tripA, tripB, lid, pid, milk, bread };
  }
  const all = (ids: string[], action = 'add') => ids.map((itemId) => ({ itemId, action }));

  it('las copias son independientes: editar el viaje A no cambia el viaje B ni la lista general; «comprado» no se copia', async () => {
    const { a, b, tripA, tripB, lid, pid, milk, bread } = await setup();
    const general0 = await listItems(a, lid);
    expect((await api(a.token, 'POST', `${L}/${lid}/copy`, { tripId: tripA.id, items: all([milk, bread]) })).json).toEqual({ added: 2, summed: 0, skipped: 0, notSummed: 0 });
    const inA = await tripItems(a, tripA.id);
    // «Por día» × 3 días de esquí; nota copiada; sin comprado ni responsable; mismo producto para ver su precio.
    expect(inA.find((i) => i.name === 'Leche')).toMatchObject({ qty: 6, note: 'brick', bought: false, assigneeId: null, product: { id: pid }, fromGeneralList: true });

    // En A: otro miembro marca comprado, cambia cantidad, nota y responsable.
    const milkA = inA.find((i) => i.name === 'Leche');
    expect((await api(b.token, 'PATCH', `/api/trips/${tripA.id}/shopping/items/${milkA.id}`, { bought: true, qty: 9, note: 'solo A', assigneeId: b.id, version: milkA.version })).status).toBe(200);

    // Copiar después a B: sin «comprado», con la cantidad y nota de la lista general (B no tiene días de esquí: tal cual).
    expect((await api(a.token, 'POST', `${L}/${lid}/copy`, { tripId: tripB.id, items: all([milk, bread]) })).json.added).toBe(2);
    const inB = await tripItems(a, tripB.id);
    expect(inB.find((i) => i.name === 'Leche')).toMatchObject({ qty: 2, note: 'brick', bought: false, assigneeId: null, product: { id: pid } });
    // Editar B tampoco toca A.
    const breadB = inB.find((i) => i.name === 'Pan de molde');
    await api(a.token, 'PATCH', `/api/trips/${tripB.id}/shopping/items/${breadB.id}`, { qty: 5, version: breadB.version });
    await api(a.token, 'DELETE', `/api/trips/${tripB.id}/shopping/items/${inB.find((i) => i.name === 'Leche').id}`);
    const inA2 = await tripItems(a, tripA.id);
    expect(inA2.find((i) => i.name === 'Leche')).toMatchObject({ qty: 9, bought: true, note: 'solo A', assigneeId: b.id });
    expect(inA2.find((i) => i.name === 'Pan de molde')).toMatchObject({ qty: 1, bought: false });
    // La lista general sigue exactamente igual.
    expect(await listItems(a, lid)).toEqual(general0);

    // Borrar la lista general no borra las copias de los viajes.
    expect((await api(a.token, 'DELETE', `${L}/${lid}`)).status).toBe(200);
    expect((await api(a.token, 'GET', `${L}/${lid}`)).status).toBe(404);
    expect(await tripItems(a, tripA.id)).toHaveLength(2);
    expect((await tripItems(a, tripB.id)).map((i) => [i.name, i.qty])).toEqual([['Pan de molde', 5]]);
  });

  it('el precio sigue al producto exacto y el precio de la hoja antigua no se usa', async () => {
    const { a, tripA, lid, pid, milk } = await setup();
    await api(a.token, 'POST', `${L}/${lid}/copy`, { tripId: tripA.id, items: all([milk]) });
    await api(a.token, 'POST', '/api/prices', { productId: pid, amountCents: 95, priceType: 'shelf', storeLabel: 'Mercadona online', postalCode: '43007', channel: 'online', observedOn: '2026-09-01' });
    await api(a.token, 'POST', '/api/prices', { productId: pid, amountCents: 99, priceType: 'shelf', storeLabel: 'Mercadona online', postalCode: '43007', channel: 'online', observedOn: '2026-09-20' });
    const g = (await listItems(a, lid))[0];
    expect(g.lastPrice).toMatchObject({ amountCents: 99, observedOn: '2026-09-20', priceType: 'shelf', observations: 2 });
    expect(g.missing).toEqual([]);
    const trip = (await api(a.token, 'GET', `/api/trips/${tripA.id}/shopping`)).json;
    expect(trip.items[0].price).toMatchObject({ amountCents: 99, observedOn: '2026-09-20' });
    expect(trip.estimate.knownCents).toBe(6 * 99);
    const hist = (await api(a.token, 'GET', `/api/products/${pid}/prices`)).json;
    expect(Object.values(hist.series).flat().map((r: any) => r.amount_cents)).toEqual([95, 99]);
  });

  it('vista previa de coincidencias: mismo producto, mismo nombre y copia previa; sumar solo si hay coincidencia pendiente', async () => {
    const { a, tripA, lid, pid, milk, bread } = await setup();
    const extra = (await api(a.token, 'POST', `${L}/${lid}/items`, { name: 'Huevos', qty: 12 })).json.id as string;
    // El viaje ya tiene: el mismo producto (con otro nombre), «pan  de MOLDE» sin producto y ya comprado.
    const t = `/api/trips/${tripA.id}/shopping/items`;
    await api(a.token, 'POST', t, { name: 'Leche del súper', productId: pid, qty: 1 });
    const breadT = (await api(a.token, 'POST', t, { name: 'pan  de MOLDE', qty: 1 })).json;
    await api(a.token, 'PATCH', `${t}/${breadT.id}`, { bought: true, version: 1 });

    const prev = (await api(a.token, 'POST', `${L}/${lid}/copy/preview`, { tripId: tripA.id })).json;
    expect(prev.trip).toMatchObject({ id: tripA.id, name: 'Viaje A', skiDays: 3, items: 2 });
    expect(prev.matches).toBe(2);
    const row = (id: string) => prev.rows.find((r: any) => r.itemId === id);
    expect(row(milk)).toMatchObject({ qty: 6, qtyNote: '2 por día × 3 días de esquí', match: { reason: 'same_product', name: 'Leche del súper', qty: 1, bought: false }, actions: ['skip', 'sum', 'add'] });
    expect(row(bread)).toMatchObject({ match: { reason: 'same_name', bought: true }, actions: ['skip', 'add'] });
    expect(row(extra)).toMatchObject({ match: null, actions: ['add', 'skip'] });
    // La vista previa no escribe nada.
    expect(await tripItems(a, tripA.id)).toHaveLength(2);

    // Sumar a algo comprado o sin coincidencia se rechaza sin escribir nada.
    const bad = await api(a.token, 'POST', `${L}/${lid}/copy`, { tripId: tripA.id, items: [{ itemId: extra, action: 'add' }, { itemId: bread, action: 'sum' }] });
    expect(bad.json.error.code).toBe('invalid_action');
    expect(await tripItems(a, tripA.id)).toHaveLength(2);

    const ok = await api(a.token, 'POST', `${L}/${lid}/copy`, { tripId: tripA.id, items: [{ itemId: milk, action: 'sum' }, { itemId: bread, action: 'skip' }, { itemId: extra, action: 'add' }] });
    expect(ok.json).toEqual({ added: 1, summed: 1, skipped: 1, notSummed: 0 });
    const after = await tripItems(a, tripA.id);
    expect(after.map((i) => [i.name, i.qty, i.bought]).sort()).toEqual([['Huevos', 12, false], ['Leche del súper', 7, false], ['pan  de MOLDE', 1, true]]);

    // Repetir: lo ya copiado aparece como copia previa y la propuesta es no tocarlo.
    const again = (await api(a.token, 'POST', `${L}/${lid}/copy/preview`, { tripId: tripA.id })).json;
    expect(again.rows.find((r: any) => r.itemId === extra)).toMatchObject({ match: { reason: 'already_copied' }, actions: ['skip', 'sum', 'add'] });
    expect((await api(a.token, 'POST', `${L}/${lid}/copy`, { tripId: tripA.id, items: [{ itemId: 'no-existe', action: 'add' }] })).status).toBe(404);
  });
});
