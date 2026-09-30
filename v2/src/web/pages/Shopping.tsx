// Compra: lista del viaje (con versión), productos exactos, precios manuales, CSV y tickets con
// revisión previa, estimación de la cesta y capa colaborativa Open Prices (ODbL), separada.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ApiError, del, errorMessage, get, patch, post } from '../api';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { Field, SelectField } from '../components/Field';
import { Empty, ErrorState, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { euros, humanDates, numDate, parseEuros, PRICE_ORIGIN_LABEL } from '../format';
import { BasketPanel, CriterionEditor, LegacyImport } from './ShoppingExtras';
import { useProfile } from '../session';
import { useResource } from '../hooks';
import { Link, setQuery, useLocation, usePageTitle } from '../router';
import type { Trip, TripDetail } from '../types';
import { parseFormat, unitPrice, type NetUnit } from '../../core/parsers/unit-price';
import { todayMadrid } from '../../core/dates';

interface Product { id: string; name: string; brand: string | null; format: string | null; netQty: number | null; netUnit: NetUnit | null; ean: string | null; replacedBy?: string | null }
interface Item {
  id: string; name: string; qty: number; note: string | null; bought: boolean; assigneeId: string | null; assigneeAlias: string | null; legacyName: string | null; legacyItemId?: string | null; version: number;
  product: Product | null; price: { amountCents: number; observedOn: string; priceType?: string; source?: string; unitPrice: { perKgOrL_cents: number | null; perUnit_cents: number | null; label: string } | null } | null;
}
interface ListResponse {
  list: { id: string; storeLabel: string; postalCode: string | null; channel: string }; items: Item[];
  estimate: { items: number; products?: number; genericItems?: number; priced: number; unpriced: number; knownCents: number; complete: boolean; oldestPriceOn: string | null;
    criterion?: { storeLabel: string; postalCode: string | null; channel: string } | null };
  note: string;
}

const upText = (u: { perKgOrL_cents: number | null; perUnit_cents: number | null; label: string } | null) =>
  !u ? null : u.perKgOrL_cents != null ? `${euros(u.perKgOrL_cents)} ${u.label.replace('€', '').trim()}` : u.perUnit_cents != null ? `${euros(u.perUnit_cents)}/ud` : null;

export function ShoppingPage() {
  usePageTitle('Compra');
  const { query } = useLocation();
  const trips = useResource(() => get<{ trips: Trip[] }>('/api/trips'), []);
  const tripId = query.get('viaje') ?? trips.data?.trips[0]?.id ?? null;

  return (
    <div className="page page-wide">
      <h1>Compra</h1>
      <p className="notice notice-warn"><strong>No hay precios automáticos de Mercadona:</strong> la cadena no ha autorizado su uso. Los precios los introducís vosotros (a mano, por CSV o pegando un ticket). Por defecto se registran como «Mercadona online, CP 43007».</p>
      {trips.loading && !trips.data && <Loading />}
      {trips.error && !trips.data && <ErrorState message={trips.error} onRetry={trips.reload} />}
      {trips.data && (trips.data.trips.length === 0 ? (
        <Empty title="Necesitas un viaje"><p>La lista de la compra pertenece a un viaje. <Link to="/viajes">Crea uno</Link> primero.</p></Empty>
      ) : (
        <>
          <div className="field field-inline">
            <label htmlFor="shop-trip">Viaje</label>
            <select id="shop-trip" value={tripId ?? ''} onChange={(e) => setQuery('viaje', e.target.value)}>
              {trips.data.trips.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          {tripId && <TripShopping key={tripId} tripId={tripId} />}
        </>
      ))}
      <ProductsPanel />
      <CsvImport />
    </div>
  );
}

function TripShopping({ tripId }: { tripId: string }) {
  const toast = useToast();
  const list = useResource(() => get<ListResponse>(`/api/trips/${tripId}/shopping`), [tripId]);
  const detail = useResource(() => get<TripDetail>(`/api/trips/${tripId}`), [tripId]);
  const receipts = useResource(() => get<{ receipts: ReceiptRow[] }>('/api/receipts'), []);
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [addErr, setAddErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<(Item & { qtyText: string; productQuery: string }) | null>(null);
  const [editErr, setEditErr] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [deleting, setDeleting] = useState<Item | null>(null);
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    if (!editing) return;
    const q = editing.productQuery.trim();
    if (q.length < 2) { setProducts([]); return; }
    const t = window.setTimeout(() => { get<{ products: Product[] }>(`/api/products?q=${encodeURIComponent(q)}`).then((r) => setProducts(r.products)).catch(() => setProducts([])); }, 250);
    return () => window.clearTimeout(t);
  }, [editing?.productQuery]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setAddErr('Escribe qué hay que comprar.'); return; }
    const q = Number(qty);
    if (!Number.isInteger(q) || q < 1 || q > 999) { setAddErr('Cantidad: número entero entre 1 y 999.'); return; }
    setBusy('add'); setAddErr(null);
    try { await post(`/api/trips/${tripId}/shopping/items`, { name: name.trim(), qty: q }); setName(''); setQty('1'); toast.show('Artículo añadido.'); await list.reload(); }
    catch (err) { setAddErr(errorMessage(err)); } finally { setBusy(null); }
  };

  const toggle = async (it: Item) => {
    setBusy(`t:${it.id}`);
    // Marca al instante (optimista); si el servidor rechaza, se recarga la lista real.
    list.setData((d) => d && ({ ...d, items: d.items.map((x) => (x.id === it.id ? { ...x, bought: !it.bought } : x)) }));
    try { await patch(`/api/trips/${tripId}/shopping/items/${it.id}`, { bought: !it.bought, qty: it.qty, version: it.version }); await list.reload(); }
    catch (err) {
      toast.show(err instanceof ApiError && err.isConflict ? 'Otra persona cambió este artículo; se ha recargado la lista.' : errorMessage(err), 'error');
      await list.reload();
    } finally { setBusy(null); }
  };

  const saveEdit = async () => {
    if (!editing) return;
    const q = Number(editing.qtyText);
    if (!editing.name.trim()) { setEditErr('El nombre no puede quedar vacío.'); return; }
    if (!Number.isInteger(q) || q < 1 || q > 999) { setEditErr('Cantidad: número entero entre 1 y 999.'); return; }
    setBusy('edit'); setEditErr(null);
    try {
      await patch(`/api/trips/${tripId}/shopping/items/${editing.id}`, { name: editing.name.trim(), qty: q, note: editing.note || null, assigneeId: editing.assigneeId || null, productId: editing.product?.id ?? null, version: editing.version });
      toast.show('Artículo guardado.');
      setEditing(null);
      await list.reload();
    } catch (err) {
      if (err instanceof ApiError && err.isConflict) setConflict(true);
      else setEditErr(errorMessage(err));
    } finally { setBusy(null); }
  };

  const reloadConflict = async () => {
    if (!editing) return;
    await list.reload();
    const fresh = (await get<ListResponse>(`/api/trips/${tripId}/shopping`).catch(() => null))?.items.find((i) => i.id === editing.id);
    setConflict(false);
    if (!fresh) { setEditErr('Otra persona ha borrado este artículo.'); return; }
    setEditing({ ...editing, version: fresh.version });
    setEditErr(`Versión actual: «${fresh.name}» × ${fresh.qty}${fresh.bought ? ', comprado' : ''}. Tus cambios siguen en el formulario.`);
  };

  const doDelete = async () => {
    if (!deleting) return;
    setBusy('del');
    try { await del(`/api/trips/${tripId}/shopping/items/${deleting.id}`); setDeleting(null); toast.show('Artículo eliminado.'); await list.reload(); }
    catch (err) { toast.show(errorMessage(err), 'error'); } finally { setBusy(null); }
  };

  if (list.loading && !list.data) return <Loading />;
  if (list.error && !list.data) return <ErrorState message={list.error} onRetry={list.reload} />;
  const { items, estimate, note } = list.data!;

  return (
    <>
      <section className="panel stack" aria-labelledby="sl-h">
        <div className="toolbar"><h2 id="sl-h">Lista de la compra <span className="count">{items.length}</span></h2>
          {detail.data && detail.data.trip.role !== 'member' && <LegacyImport tripId={tripId} onDone={() => void list.reload()} />}</div>
        <form className="form-row form-row-end" onSubmit={add} noValidate>
          <Field label="Artículo" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Por ejemplo: leche" />
          <Field label="Cantidad" type="number" min={1} max={999} value={qty} onChange={(e) => setQty(e.target.value)} />
          <button type="submit" className="btn btn-primary" disabled={busy !== null}>{busy === 'add' ? 'Añadiendo…' : 'Añadir'}</button>
        </form>
        {addErr && <p className="form-error" role="alert">{addErr}</p>}
        {items.length === 0 ? <p className="muted">La lista está vacía.</p> : (
          <ul className="list" aria-label="Artículos">
            {items.map((it) => (
              <li key={it.id} className={`shop-row ${it.bought ? 'is-bought' : ''}`}>
                <div className="check">
                  <input id={`b-${it.id}`} type="checkbox" checked={it.bought} disabled={busy !== null} onChange={() => void toggle(it)} />
                  <label htmlFor={`b-${it.id}`}><span className="shop-name">{it.name}</span> × {it.qty}{it.bought && <span className="visually-hidden"> (comprado)</span>}</label>
                  {it.legacyItemId && <span className="tag legacy-tag">de la hoja antigua</span>}
                </div>
                <p className="small muted">
                  {it.product ? <>Producto: {it.product.name}{it.product.format && ` · ${it.product.format}`}</> : 'Sin producto exacto'}
                  {' · '}{it.price ? <>{euros(it.price.amountCents)} por envase · <span className="price-origin">{PRICE_ORIGIN_LABEL[it.price.priceType ?? ''] ?? it.price.priceType ?? 'origen sin indicar'} · {numDate(it.price.observedOn)}</span>{upText(it.price.unitPrice) && ` · ${upText(it.price.unitPrice)}`}</> : <strong>precio pendiente</strong>}
                  {it.assigneeAlias && ` · se encarga ${it.assigneeAlias}`}{it.note && ` · ${it.note}`}
                </p>
                <div className="cluster-s">
                  <button type="button" className="btn btn-small btn-ghost" onClick={() => { setEditErr(null); setConflict(false); setEditing({ ...it, qtyText: String(it.qty), productQuery: '' }); }}>Editar<span className="visually-hidden"> {it.name}</span></button>
                  <button type="button" className="btn btn-small btn-ghost" onClick={() => setDeleting(it)}>Eliminar<span className="visually-hidden"> {it.name}</span></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel stack" aria-labelledby="est-h">
        <h2 id="est-h">Estimación de la cesta</h2>
        <CriterionEditor tripId={tripId} list={list.data!.list} onSaved={() => void list.reload()} />
        <p>Conocido: <strong>{euros(estimate.knownCents)}</strong> ({estimate.priced} de {estimate.products ?? estimate.items} productos exactos con precio{(estimate.genericItems ?? 0) > 0 && `; ${estimate.genericItems} artículo(s) sin producto exacto`})</p>
        {estimate.products != null && estimate.products < estimate.items - (estimate.genericItems ?? 0) && <p className="small muted">Las filas repetidas de un mismo producto se agrupan: cuentan como un producto con la suma de envases.</p>}
        {estimate.unpriced > 0 ? <p className="notice notice-warn">{estimate.unpriced} artículo(s) sin precio: la estimación está <strong>pendiente</strong> y no se cuentan como 0.</p>
          : estimate.items > 0 ? <p className="notice notice-ok">Todos los artículos tienen precio.</p> : null}
        {estimate.oldestPriceOn && <p className="small muted">Precio más antiguo usado: {numDate(estimate.oldestPriceOn)}.</p>}
        <p className="small muted">{note}</p>
        <ReceiptImport tripId={tripId} members={detail.data?.members ?? []} onDone={() => { void list.reload(); void receipts.reload(); }} />
      </section>

      <BasketPanel tripId={tripId} listVersion={items.map((i) => `${i.id}:${i.qty}:${i.product?.id ?? ''}`).join('|')} />

      <ReceiptsPanel tripId={tripId} tripName={detail.data?.trip.name ?? 'este viaje'} members={detail.data?.members ?? []} receipts={receipts} />

      <Dialog open={editing !== null} title="Editar artículo" size="wide" onClose={() => setEditing(null)} busy={busy === 'edit'}
        footer={<>
          <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)} disabled={busy === 'edit'}>Cancelar</button>
          {conflict ? <button type="button" className="btn btn-primary" onClick={() => void reloadConflict()}>Ver la versión actual</button>
            : <button type="submit" form="item-form" className="btn btn-primary" disabled={busy === 'edit'}>{busy === 'edit' ? 'Guardando…' : 'Guardar'}</button>}
        </>}>
        {conflict && <p className="notice notice-warn" role="alert"><strong>Otra persona ha cambiado este artículo.</strong> No se ha guardado nada.</p>}
        {editing && (
          <form id="item-form" className="form-grid" onSubmit={(e) => { e.preventDefault(); void saveEdit(); }} noValidate>
            <Field label="Nombre" value={editing.name} maxLength={120} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <Field label="Cantidad" type="number" min={1} max={999} value={editing.qtyText} onChange={(e) => setEditing({ ...editing, qtyText: e.target.value })} hint="Nº de envases del producto" />
            <Field className="span-2" label="Nota" value={editing.note ?? ''} maxLength={300} onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
            <SelectField label="Se encarga" value={editing.assigneeId ?? ''} onChange={(e) => setEditing({ ...editing, assigneeId: e.target.value || null })}>
              <option value="">Nadie</option>
              {(detail.data?.members ?? []).map((m) => <option key={m.id} value={m.id}>{m.alias}</option>)}
            </SelectField>
            <div className="field span-2">
              <p className="field-label">Producto exacto: {editing.product ? `${editing.product.name}${editing.product.format ? ` · ${editing.product.format}` : ''}` : 'ninguno'}</p>
              {editing.product && <button type="button" className="btn btn-small btn-ghost" onClick={() => setEditing({ ...editing, product: null })}>Quitar producto</button>}
              <label htmlFor="item-prod-q">Buscar producto</label>
              <input id="item-prod-q" type="search" value={editing.productQuery} onChange={(e) => setEditing({ ...editing, productQuery: e.target.value })} placeholder="Nombre o EAN" />
              {products.length > 0 && (
                <ul className="list">
                  {products.map((p) => (
                    <li key={p.id} className="list-row"><span className="list-main">{p.name}{p.format && ` · ${p.format}`}{p.replacedBy && ' (sustituido)'}</span>
                      <button type="button" className="btn btn-small btn-secondary" onClick={() => setEditing({ ...editing, product: p, productQuery: '' })}>Elegir</button></li>
                  ))}
                </ul>
              )}
            </div>
          </form>
        )}
        {editErr && <p className="form-error" role="alert">{editErr}</p>}
      </Dialog>
      <ConfirmDialog open={deleting !== null} title={`¿Eliminar «${deleting?.name ?? ''}»?`} body={<p>Se quita de la lista del viaje.</p>} confirmLabel="Eliminar" danger busy={busy === 'del'}
        onConfirm={() => void doDelete()} onClose={() => setDeleting(null)} />
    </>
  );
}

interface PriceRow { id: string; source: string; price_type: string; amount_cents: number; promo_note: string | null; store_label: string; postal_code: string | null; channel: string; observed_on: string; visibility: string; mine: number; unitPrice: { perKgOrL_cents: number | null; perUnit_cents: number | null; label: string } | null }
const PRICE_TYPE: Record<string, string> = { shelf: 'precio de estantería', promo: 'promoción', personal_discount: 'descuento personal', receipt_effective: 'coste efectivo de ticket' };
const CHANNEL: Record<string, string> = { online: 'online', store: 'tienda', unknown: 'canal desconocido' };

function ProductsPanel() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Product[] | null>(null);
  const [selected, setSelected] = useState<Product | null>(null);
  const [creating, setCreating] = useState<null | { name: string; brand: string; format: string; netQty: string; netUnit: '' | NetUnit; ean: string }>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (q.trim().length < 2) { setResults(null); return; }
      get<{ products: Product[] }>(`/api/products?q=${encodeURIComponent(q.trim())}`).then((r) => setResults(r.products)).catch((e) => toast.show(errorMessage(e), 'error'));
    }, 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const parsed = creating ? (creating.netQty ? null : parseFormat(creating.format)) : null;

  const create = async () => {
    if (!creating) return;
    if (creating.name.trim().length < 2) { setErr('Nombre demasiado corto.'); return; }
    if ((creating.netQty === '') !== (creating.netUnit === '')) { setErr('Indica cantidad neta y unidad juntas (o ninguna).'); return; }
    if (creating.ean && !/^\d{8,14}$/.test(creating.ean)) { setErr('El EAN son 8 a 14 dígitos.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await post<{ product: Product }>('/api/products', {
        name: creating.name.trim(), brand: creating.brand.trim() || null, format: creating.format.trim() || null,
        netQty: creating.netQty ? Number(creating.netQty) : null, netUnit: creating.netUnit || null, ean: creating.ean || null,
      });
      toast.show('Producto creado.');
      setCreating(null);
      setSelected(r.product);
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <section className="panel stack" aria-labelledby="pr-h">
      <div className="toolbar"><h2 id="pr-h">Productos y precios</h2>
        <button type="button" className="btn btn-secondary" onClick={() => { setErr(null); setCreating({ name: '', brand: '', format: '', netQty: '', netUnit: '', ean: '' }); }}>Nuevo producto</button></div>
      <p className="muted small">Un producto es un formato exacto (marca, envase y cantidad neta). Si cambia el formato, se crea otro: las series de precios no se mezclan.</p>
      <div className="field">
        <label htmlFor="prod-q">Buscar producto</label>
        <input id="prod-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre o EAN" />
      </div>
      {results && (results.length === 0 ? <p className="muted">Sin resultados.</p> : (
        <ul className="list" aria-label="Productos encontrados">
          {results.map((p) => (
            <li key={p.id} className="list-row"><span className="list-main">{p.name}{p.brand && ` · ${p.brand}`}{p.format && ` · ${p.format}`}{p.replacedBy && ' (sustituido)'}</span>
              <button type="button" className="btn btn-small btn-secondary" onClick={() => setSelected(p)}>Ver precios<span className="visually-hidden"> de {p.name}</span></button></li>
          ))}
        </ul>
      ))}
      {selected && <ProductPrices key={selected.id} product={selected} onClose={() => setSelected(null)} />}

      <Dialog open={creating !== null} title="Nuevo producto" size="wide" onClose={() => setCreating(null)} busy={busy}
        footer={<>
          <button type="button" className="btn btn-secondary" onClick={() => setCreating(null)} disabled={busy}>Cancelar</button>
          <button type="submit" form="prod-form" className="btn btn-primary" disabled={busy}>{busy ? 'Creando…' : 'Crear producto'}</button>
        </>}>
        {creating && (
          <form id="prod-form" className="form-grid" onSubmit={(e) => { e.preventDefault(); void create(); }} noValidate>
            <Field className="span-2" label="Nombre" value={creating.name} maxLength={160} onChange={(e) => setCreating({ ...creating, name: e.target.value })} />
            <Field label="Marca" value={creating.brand} maxLength={80} onChange={(e) => setCreating({ ...creating, brand: e.target.value })} />
            <Field label="Formato" value={creating.format} maxLength={80} onChange={(e) => setCreating({ ...creating, format: e.target.value })}
              hint={parsed ? `Se interpreta como ${parsed.netQty} ${parsed.netUnit === 'unit' ? 'ud' : parsed.netUnit}.` : 'Por ejemplo: «Paquete 6 x 125 g» o «Brick 1 L»'} />
            <Field label="Cantidad neta" type="number" min={1} value={creating.netQty} onChange={(e) => setCreating({ ...creating, netQty: e.target.value })} hint="Opcional si el formato ya la indica" />
            <SelectField label="Unidad" value={creating.netUnit} onChange={(e) => setCreating({ ...creating, netUnit: e.target.value as '' | NetUnit })}>
              <option value="">—</option><option value="g">gramos</option><option value="ml">mililitros</option><option value="unit">unidades</option>
            </SelectField>
            <Field label="EAN" inputMode="numeric" value={creating.ean} onChange={(e) => setCreating({ ...creating, ean: e.target.value.trim() })} hint="Código de barras; permite consultar Open Prices" />
          </form>
        )}
        {err && <p className="form-error" role="alert">{err}</p>}
      </Dialog>
    </section>
  );
}

function ProductPrices({ product, onClose }: { product: Product; onClose: () => void }) {
  const toast = useToast();
  const r = useResource(() => get<{ product: Product; series: Record<string, PriceRow[]>; replacedBy: { id: string; name: string; format: string | null }[]; note: string }>(`/api/products/${product.id}/prices`), [product.id]);
  const [form, setForm] = useState({ amount: '', priceType: 'shelf', promoNote: '', storeLabel: 'Mercadona online', postalCode: '43007', channel: 'online', observedOn: todayMadrid(), visibility: 'shared_trips' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [op, setOp] = useState<null | { status: string; items: { externalId: number; amountCents: number; date: string; store: string | null; city: string | null; discounted: boolean }[]; attribution?: string; note?: string; fetchedAt?: number | null }>(null);
  const [opBusy, setOpBusy] = useState(false);
  const amountCents = parseEuros(form.amount);
  const preview = amountCents != null && !Number.isNaN(amountCents) && product.netQty && product.netUnit ? unitPrice(amountCents, product.netQty, product.netUnit) : null;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (amountCents == null || Number.isNaN(amountCents)) { setErr('Importe no válido.'); return; }
    if (form.postalCode && !/^\d{5}$/.test(form.postalCode)) { setErr('Código postal: 5 dígitos.'); return; }
    setBusy(true); setErr(null);
    try {
      const res = await post<{ created: boolean }>('/api/prices', { productId: product.id, amountCents, priceType: form.priceType, promoNote: form.promoNote || null, storeLabel: form.storeLabel,
        postalCode: form.postalCode || null, channel: form.channel, observedOn: form.observedOn, visibility: form.visibility });
      toast.show(res.created ? 'Precio guardado.' : 'Ese precio ya estaba registrado.');
      setForm({ ...form, amount: '' });
      await r.reload();
    } catch (e2) { setErr(errorMessage(e2)); } finally { setBusy(false); }
  };

  const loadOpenPrices = async () => {
    setOpBusy(true);
    try { setOp(await get(`/api/products/${product.id}/open-prices`)); } catch (e) { toast.show(errorMessage(e), 'error'); } finally { setOpBusy(false); }
  };

  return (
    <div className="detail-panel">
      <div className="detail-head"><h3>{product.name}{product.format && ` · ${product.format}`}</h3><button type="button" className="btn btn-small btn-ghost" onClick={onClose}>Cerrar</button></div>
      <p className="small muted">{product.netQty && product.netUnit ? `Cantidad neta: ${product.netQty} ${product.netUnit === 'unit' ? 'ud' : product.netUnit}` : 'Sin cantidad neta: no se calcula precio por kg/L.'}{product.ean && ` · EAN ${product.ean}`}</p>
      {r.loading && !r.data ? <Loading /> : r.error ? <ErrorState message={r.error} onRetry={r.reload} /> : r.data && (
        <>
          {r.data.replacedBy.length > 0 && <p className="notice notice-info small">Sustituido por: {r.data.replacedBy.map((p) => `${p.name}${p.format ? ` (${p.format})` : ''}`).join(' → ')}</p>}
          {Object.keys(r.data.series).length === 0 ? <p className="muted">Sin precios registrados.</p> : Object.entries(r.data.series).map(([key, rows]) => {
            const [origin, type, channel] = key.split(':');
            return (
              <div key={key} className="table-scroll">
                <table className="data-table compact">
                  <caption>{origin === 'colaborativo' ? 'Colaborativo' : 'Propio del grupo'} · {PRICE_TYPE[type] ?? type} · {CHANNEL[channel] ?? channel}</caption>
                  <thead><tr><th scope="col">Fecha</th><th scope="col">Precio</th><th scope="col">Por kg/L/ud</th><th scope="col">Tienda</th></tr></thead>
                  <tbody>{rows.map((p) => (
                    <tr key={p.id}><th scope="row">{p.observed_on}</th><td>{euros(p.amount_cents)}{p.promo_note && ` (${p.promo_note})`}</td><td>{upText(p.unitPrice) ?? '—'}</td><td>{p.store_label}{p.postal_code && ` ${p.postal_code}`}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            );
          })}
          <p className="small muted">{r.data.note}</p>
        </>
      )}
      <form className="stack-s" onSubmit={save} noValidate>
        <h4>Añadir precio a mano</h4>
        <div className="form-grid">
          <Field label="Precio por envase (€)" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
            hint={preview ? `Equivale a ${upText(preview)}` : undefined} />
          <SelectField label="Tipo" value={form.priceType} onChange={(e) => setForm({ ...form, priceType: e.target.value })}>
            <option value="shelf">Precio de estantería</option><option value="promo">Promoción</option><option value="personal_discount">Descuento personal</option>
          </SelectField>
          {form.priceType === 'promo' && <Field label="Detalle de la promoción" value={form.promoNote} onChange={(e) => setForm({ ...form, promoNote: e.target.value })} />}
          <Field label="Tienda" value={form.storeLabel} onChange={(e) => setForm({ ...form, storeLabel: e.target.value })} />
          <Field label="Código postal" inputMode="numeric" value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} />
          <SelectField label="Canal" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
            <option value="online">Online</option><option value="store">Tienda física</option><option value="unknown">Desconocido</option>
          </SelectField>
          <Field label="Fecha" type="date" value={form.observedOn} onChange={(e) => setForm({ ...form, observedOn: e.target.value })} />
          <SelectField label="Visible para" value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}>
            <option value="shared_trips">Miembros de mis viajes</option><option value="private">Solo yo</option>
          </SelectField>
        </div>
        {err && <p className="form-error" role="alert">{err}</p>}
        <div><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar precio'}</button></div>
      </form>
      <div className="stack-s openprices">
        <h4>Open Prices (capa colaborativa)</h4>
        <p className="small">Capa colaborativa, puede estar incompleta. No son precios de Mercadona Tarragona salvo que la tienda lo indique. Datos de <a href="https://prices.openfoodfacts.org" target="_blank" rel="noopener noreferrer">Open Prices (Open Food Facts)<span className="visually-hidden"> (otra pestaña)</span></a>, licencia <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener noreferrer">ODbL<span className="visually-hidden"> (otra pestaña)</span></a>.</p>
        {!product.ean ? <p className="muted small">Sin EAN no se puede consultar.</p> : (
          <div><button type="button" className="btn btn-small btn-secondary" onClick={() => void loadOpenPrices()} disabled={opBusy}>{opBusy ? 'Consultando…' : 'Consultar Open Prices'}</button></div>
        )}
        {op && (
          op.items.length === 0 ? <p className="muted small">{op.status === 'error' ? 'No se ha podido consultar ahora.' : 'Sin precios colaborativos para este EAN.'}</p> : (
            <ul className="list small">
              {op.items.slice(0, 15).map((i) => <li key={i.externalId} className="list-row"><span className="list-main">{i.date} · {i.store ?? 'tienda sin nombre'}{i.city && `, ${i.city}`}{i.discounted && ' · con descuento'}</span><span>{euros(i.amountCents)}</span></li>)}
            </ul>
          )
        )}
        {op?.attribution && <p className="small muted">{op.attribution}</p>}
      </div>
    </div>
  );
}

interface CsvRow { line: number; product: { id: string; name: string; format: string | null } | null; amountCents: number | null; observedOn: string; priceType: string; channel: string; storeLabel: string; postalCode: string | null; errors: string[] }

function CsvImport() {
  const toast = useToast();
  const [csv, setCsv] = useState('');
  const [rows, setRows] = useState<CsvRow[] | null>(null);
  const [previewed, setPreviewed] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const preview = async () => {
    if (!csv.trim()) { setErr('Pega el contenido CSV.'); return; }
    setBusy(true); setErr(null);
    try { const r = await post<{ rows: CsvRow[] }>('/api/prices/import/preview', { csv }); setRows(r.rows); setPreviewed(csv); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  const confirm = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await post<{ created: number; duplicates: number; skippedInvalid: number }>('/api/prices/import/confirm', { csv: previewed });
      toast.show(`Importados ${r.created} precios (${r.duplicates} repetidos, ${r.skippedInvalid} filas con errores omitidas).`);
      setRows(null); setCsv(''); setPreviewed('');
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <section className="panel stack" aria-labelledby="csv-h">
      <h2 id="csv-h">Importar precios desde CSV</h2>
      <p className="small muted">Columnas: <code>product_id</code> o <code>ean</code>, <code>amount</code>, <code>price_type</code> (shelf, promo, personal_discount), <code>store</code>, <code>postal_code</code>, <code>channel</code> (online, store, unknown), <code>date</code>, <code>promo_note</code>. Primero se previsualiza; nada se guarda hasta confirmar.</p>
      <div className="field">
        <label htmlFor="csv-text">Contenido CSV</label>
        <textarea id="csv-text" className="textarea mono" rows={5} value={csv} onChange={(e) => { setCsv(e.target.value); if (e.target.value !== previewed) setRows(null); }} />
      </div>
      {err && <p className="form-error" role="alert">{err}</p>}
      <div className="cluster-s">
        <button type="button" className="btn btn-secondary" onClick={() => void preview()} disabled={busy}>Previsualizar</button>
        {rows && rows.some((r) => !r.errors.length) && <button type="button" className="btn btn-primary" onClick={() => void confirm()} disabled={busy}>Confirmar {rows.filter((r) => !r.errors.length).length} filas válidas</button>}
      </div>
      {rows && (
        <div className="table-scroll">
          <table className="data-table compact">
            <caption>Previsualización: {rows.filter((r) => !r.errors.length).length} válidas, {rows.filter((r) => r.errors.length).length} con errores</caption>
            <thead><tr><th scope="col">Línea</th><th scope="col">Producto</th><th scope="col">Importe</th><th scope="col">Fecha</th><th scope="col">Tienda</th><th scope="col">Estado</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.line}><th scope="row">{r.line}</th><td>{r.product?.name ?? '—'}</td><td>{r.amountCents != null ? euros(r.amountCents) : '—'}</td><td>{r.observedOn}</td><td>{r.storeLabel}</td>
                <td>{r.errors.length ? <span className="text-bad">{r.errors.join('; ')}</span> : 'Correcta'}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

interface ReceiptPreview {
  parsed: { purchasedOn: string | null; totalCents: number | null; sumMatchesTotal: boolean; warnings: string[]; lines: { lineNo: number; rawText: string; description: string; qty: number; unitCents: number | null; amountCents: number; weightGrams: number | null }[] };
  duplicate: { id: string; expense_id: string | null; expense_trip_id: string | null } | null; suggestions: { lineNo: number; candidates: { id: string; name: string; format: string | null }[] }[]; note: string;
}

function ReceiptImport({ tripId, members, onDone }: { tripId: string; members: { id: string; alias: string }[]; onDone: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [meta, setMeta] = useState({ text: '', storeLabel: 'Mercadona', channel: 'store', postalCode: '43007' });
  const [prev, setPrev] = useState<ReceiptPreview | null>(null);
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [asExpense, setAsExpense] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const body = useMemo(() => ({ text: meta.text, storeLabel: meta.storeLabel, channel: meta.channel, postalCode: meta.postalCode || null }), [meta]);

  const preview = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await post<ReceiptPreview>('/api/receipts/preview', body);
      setPrev(r);
      setMapping(Object.fromEntries(r.suggestions.filter((s) => s.candidates.length === 1).map((s) => [s.lineNo, s.candidates[0].id])));
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  const confirm = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await post<{ receiptId: string; alreadyImported: boolean; expenseId: string | null; lines: number; prices?: number }>('/api/receipts/confirm', {
        ...body, tripId, mapping: prev!.parsed.lines.map((l) => ({ lineNo: l.lineNo, productId: mapping[l.lineNo] || null })),
      });
      // El ticket ya está guardado: a partir de aquí un fallo del gasto no obliga a reimportar (se completa desde «Tus tickets»).
      setOpen(false); setPrev(null); setMeta({ ...meta, text: '' });
      onDone();
      let expense = '';
      if (asExpense && !r.expenseId) {
        try {
          await post(`/api/receipts/${r.receiptId}/expense`, { tripId, concept: `Compra ${meta.storeLabel}`, participants: members.map((m) => m.id) });
          expense = ' y gasto añadido al viaje';
          onDone();
        } catch (e) {
          toast.show(`Ticket guardado, pero no se ha podido crear el gasto: ${errorMessage(e)} Puedes crearlo desde «Tus tickets» sin volver a importarlo.`, 'error');
          return;
        }
      }
      toast.show(r.alreadyImported
        ? `Este ticket ya estaba importado; no se ha duplicado${r.expenseId ? ' y ya tiene su gasto' : expense}.`
        : `Ticket guardado: ${r.lines} líneas, ${r.prices ?? 0} precios${expense}.`);
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <>
      <div><button type="button" className="btn btn-secondary" onClick={() => { setErr(null); setOpen(true); }}>Pegar un ticket…</button></div>
      <Dialog open={open} title="Importar ticket" size="wide" onClose={() => setOpen(false)} busy={busy}
        footer={<>
          <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} disabled={busy}>Cancelar</button>
          {!prev ? <button type="button" className="btn btn-primary" onClick={() => void preview()} disabled={busy || meta.text.trim().length < 10}>Previsualizar</button>
            : <button type="button" className="btn btn-primary" onClick={() => void confirm()} disabled={busy || !!prev.duplicate}>{busy ? 'Guardando…' : 'Confirmar ticket'}</button>}
        </>}>
        {!prev ? (
          <div className="stack">
            <div className="field"><label htmlFor="rc-text">Texto del ticket</label><textarea id="rc-text" className="textarea mono" rows={8} value={meta.text} onChange={(e) => setMeta({ ...meta, text: e.target.value })} /></div>
            <div className="form-grid">
              <Field label="Tienda" value={meta.storeLabel} onChange={(e) => setMeta({ ...meta, storeLabel: e.target.value })} />
              <SelectField label="Canal" value={meta.channel} onChange={(e) => setMeta({ ...meta, channel: e.target.value })}><option value="store">Tienda física</option><option value="online">Online</option></SelectField>
              <Field label="Código postal" value={meta.postalCode} onChange={(e) => setMeta({ ...meta, postalCode: e.target.value })} />
            </div>
          </div>
        ) : (
          <div className="stack">
            {prev.duplicate && <p className="notice notice-warn" role="alert">Este ticket ya estaba importado.{prev.duplicate.expense_id ? ' Ya tiene su gasto.' : ' Aún no tiene gasto: créalo desde «Tus tickets», sin volver a importarlo.'}</p>}
            <p>Fecha: {prev.parsed.purchasedOn ?? 'no encontrada'} · Total: {prev.parsed.totalCents != null ? euros(prev.parsed.totalCents) : 'no encontrado'} · {prev.parsed.sumMatchesTotal ? 'las líneas suman el total' : <strong className="text-bad">las líneas no suman el total</strong>}</p>
            {prev.parsed.warnings.length > 0 && <ul className="warnings small">{prev.parsed.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
            {prev.note && <p className="small muted">{prev.note}</p>}
            <ul className="list">
              {prev.parsed.lines.map((l) => {
                const sug = prev.suggestions.find((s) => s.lineNo === l.lineNo)?.candidates ?? [];
                return (
                  <li key={l.lineNo} className="list-row list-row-wrap">
                    <span className="list-main small">{l.qty} × {l.description} · {euros(l.amountCents)}{l.weightGrams && ` (${l.weightGrams} g)`}</span>
                    <span>
                      <label className="visually-hidden" htmlFor={`map-${l.lineNo}`}>Producto para la línea {l.lineNo}</label>
                      <select id={`map-${l.lineNo}`} className="select-small" value={mapping[l.lineNo] ?? ''} onChange={(e) => setMapping({ ...mapping, [l.lineNo]: e.target.value })}>
                        <option value="">Sin asociar</option>
                        {sug.map((c) => <option key={c.id} value={c.id}>{c.name}{c.format && ` · ${c.format}`}</option>)}
                      </select>
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="check"><input id="rc-exp" type="checkbox" checked={asExpense} onChange={(e) => setAsExpense(e.target.checked)} /><label htmlFor="rc-exp">Añadir el total como gasto del viaje, a partes iguales entre todos</label></div>
          </div>
        )}
        {err && <p className="form-error" role="alert">{err}</p>}
      </Dialog>
    </>
  );
}

interface ReceiptRow {
  id: string; trip_id: string | null; store_label: string; postal_code: string | null; channel: string; purchased_on: string; total_cents: number; created_at: number;
  lines: number; expense_id: string | null; expense_trip_id: string | null;
}

/**
 * Tickets propios y su gasto. Un ticket sin gasto (p. ej. porque falló la red al crearlo) se completa aquí con
 * «Crear gasto», sin reimportarlo. Repetirlo es inofensivo: el servidor devuelve el gasto ya vinculado.
 */
function ReceiptsPanel({ tripId, tripName, members, receipts }: {
  tripId: string; tripName: string; members: { id: string; alias: string }[];
  receipts: { data: { receipts: ReceiptRow[] } | null; loading: boolean; error: string | null; reload: () => Promise<void> };
}) {
  const toast = useToast();
  const me = useProfile();
  const [target, setTarget] = useState<ReceiptRow | null>(null);
  const [concept, setConcept] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const open = (r: ReceiptRow) => {
    setTarget(r); setConcept(`Compra ${r.store_label}`); setChosen(new Set(members.map((m) => m.id))); setErr(null);
  };
  const createExpense = async () => {
    if (!target) return;
    if (!concept.trim()) { setErr('Pon un concepto.'); return; }
    if (chosen.size === 0) { setErr('Elige al menos una persona para repartir.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await post<{ expenseId: string; alreadyLinked: boolean }>(`/api/receipts/${target.id}/expense`, { tripId, concept: concept.trim(), participants: [...chosen] });
      toast.show(r.alreadyLinked ? 'Este ticket ya tenía su gasto en este viaje; no se ha duplicado.' : 'Gasto creado a partir del ticket.');
      setTarget(null);
      await receipts.reload();
    } catch (e) {
      setErr(e instanceof ApiError && e.code === 'receipt_already_linked' ? `${e.message} No se ha creado otro.` : errorMessage(e));
      void receipts.reload();
    } finally { setBusy(false); }
  };

  const rows = receipts.data?.receipts ?? [];
  return (
    <section className="panel stack" aria-labelledby="rc-list-h">
      <h2 id="rc-list-h">Tus tickets <span className="count">{rows.length}</span></h2>
      <p className="small muted">Solo ves los tickets que has importado tú. Si uno se quedó sin gasto, créalo aquí: no hace falta volver a importarlo.</p>
      {receipts.loading && !receipts.data && <Loading label="Cargando tickets…" />}
      {receipts.error && !receipts.data && <ErrorState message={receipts.error} onRetry={() => void receipts.reload()} />}
      {receipts.data && (rows.length === 0 ? <p className="muted">Aún no has importado tickets.</p> : (
        <ul className="list" aria-label="Tickets importados">
          {rows.map((r) => {
            const here = r.expense_id && r.expense_trip_id === tripId;
            const label = `${r.store_label} del ${humanDates(r.purchased_on)}`;
            return (
              <li key={r.id} className="receipt-row" data-receipt={r.id}>
                <span className="list-main">
                  <strong>{r.store_label}</strong> <span className="muted">· {humanDates(r.purchased_on)} · {euros(r.total_cents)} · {r.lines} línea(s)</span>
                  {r.trip_id && r.trip_id !== tripId && <span className="small muted"> · importado en otro viaje</span>}
                </span>
                <span className="cluster-s">
                  {here ? <><span className="tag tag-ok">Gasto creado</span><Link className="small" to={`/viajes/${tripId}/gastos`}>Ver gastos<span className="visually-hidden"> de {tripName}</span></Link></>
                    : r.expense_id ? <span className="tag tag-quiet">Gasto en otro viaje</span>
                    : <><span className="tag tag-warn">Sin gasto</span>
                      <button type="button" className="btn btn-small btn-secondary" onClick={() => open(r)} disabled={members.length === 0}>Crear gasto<span className="visually-hidden"> del ticket {label}</span></button></>}
                </span>
              </li>
            );
          })}
        </ul>
      ))}
      <Dialog open={target !== null} title="Crear gasto del ticket" onClose={() => setTarget(null)} busy={busy}
        footer={<>
          <button type="button" className="btn btn-secondary" onClick={() => setTarget(null)} disabled={busy}>Cancelar</button>
          <button type="submit" form="rc-exp-form" className="btn btn-primary" disabled={busy} aria-busy={busy || undefined}>{busy ? 'Creando…' : 'Crear gasto'}</button>
        </>}>
        {target && (
          <form id="rc-exp-form" className="stack" onSubmit={(e) => { e.preventDefault(); void createExpense(); }} noValidate>
            <p>{target.store_label} · {humanDates(target.purchased_on)} · <strong>{euros(target.total_cents)}</strong>. Se añade a «{tripName}», pagado por {me.alias}, a partes iguales.</p>
            <Field label="Concepto" value={concept} maxLength={200} onChange={(e) => setConcept(e.target.value)} />
            <fieldset className="participants">
              <legend>Repartir entre</legend>
              {members.map((m) => (
                <div key={m.id} className="check">
                  <input id={`rcp-${m.id}`} type="checkbox" checked={chosen.has(m.id)}
                    onChange={(e) => { const n = new Set(chosen); if (e.target.checked) n.add(m.id); else n.delete(m.id); setChosen(n); }} />
                  <label htmlFor={`rcp-${m.id}`}>{m.alias}</label>
                </div>
              ))}
            </fieldset>
          </form>
        )}
        {err && <p className="form-error" role="alert">{err}</p>}
      </Dialog>
    </section>
  );
}
