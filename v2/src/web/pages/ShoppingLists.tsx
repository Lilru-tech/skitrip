// Listas generales de la compra: reutilizables, sin viaje y privadas. Base para preparar viajes: se revisa la hoja
// antigua, se completa cada artículo (producto exacto, cantidad) y se copia a uno o varios viajes con vista previa de
// coincidencias. Las copias son independientes: lo que se cambie en un viaje no toca la lista ni otros viajes.
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, del, errorMessage, get, patch, post } from '../api';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { Field, SelectField } from '../components/Field';
import { Empty, ErrorState, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { euros, numDate, PRICE_ORIGIN_LABEL } from '../format';
import { useResource } from '../hooks';
import { Link, setQuery, useLocation } from '../router';
import type { Trip } from '../types';
import { MISSING_LABEL, type CopyAction, type CopyPlanRow, type Missing } from '../../core/shopping-lists';
import { ProductPicker } from './ShoppingExtras';
import { ProductPrices, type Product } from './Shopping';

interface ListSummary { id: string; name: string; version: number; items: number; withoutProduct: number }
interface GItem {
  id: string; name: string; qty: number; perDay: boolean; qtyUnclear: boolean; note: string | null; version: number;
  product: Product | null;
  legacy: { itemId: string; name: string; quantityText: string | null; priceText: string | null } | null;
  lastPrice: { amountCents: number; observedOn: string; priceType: string; storeLabel: string; postalCode: string | null; channel: string; observations: number } | null;
  missing: Missing[];
}
interface ListDetail { list: { id: string; name: string; version: number }; items: GItem[]; note: string }

export function GeneralLists() {
  const toast = useToast();
  const { query } = useLocation();
  const lists = useResource(() => get<{ lists: ListSummary[] }>('/api/shopping-lists'), []);
  const [name, setName] = useState('Lista general');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const all = lists.data?.lists ?? [];
  const selected = all.find((l) => l.id === query.get('lista')) ?? all[0] ?? null;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErr('Ponle un nombre a la lista.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await post<{ list: { id: string } }>('/api/shopping-lists', { name: name.trim() });
      toast.show('Lista creada.');
      setCreating(false); setName('Lista general');
      await lists.reload();
      setQuery('lista', r.list.id);
    } catch (e2) { setErr(errorMessage(e2)); } finally { setBusy(false); }
  };

  const form = (
    <form className="form-row form-row-end" onSubmit={create} noValidate>
      <Field label="Nombre de la lista" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Creando…' : 'Crear lista general'}</button>
    </form>
  );

  if (lists.loading && !lists.data) return <Loading label="Cargando tus listas…" />;
  if (lists.error && !lists.data) return <ErrorState message={lists.error} onRetry={() => void lists.reload()} />;
  return (
    <>
      {all.length === 0 ? (
        <section className="panel stack" aria-labelledby="gl-empty-h">
          <h2 id="gl-empty-h">Tu lista general</h2>
          <Empty title="Aún no tienes ninguna lista general">
            <p>Una lista general es tu compra de siempre (desayunos, básicos de nieve…). No necesita viaje: la preparas una vez y la copias a cada viaje. Es privada: solo la ves tú.</p>
          </Empty>
          {form}
          {err && <p className="form-error" role="alert">{err}</p>}
        </section>
      ) : (
        <>
          <div className="cluster-s gl-picker">
            {all.length > 1 && (
              <SelectField label="Lista general" value={selected?.id ?? ''} onChange={(e) => setQuery('lista', e.target.value)}>
                {all.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.items})</option>)}
              </SelectField>
            )}
            <button type="button" className="btn btn-small btn-secondary" onClick={() => { setErr(null); setCreating(true); }}>Nueva lista general</button>
          </div>
          {selected && <GeneralListView key={selected.id} listId={selected.id} onChanged={() => void lists.reload()} onDeleted={async () => { setQuery('lista', null); await lists.reload(); }} />}
          <Dialog open={creating} title="Nueva lista general" onClose={() => setCreating(false)} busy={busy}>
            {form}
            {err && <p className="form-error" role="alert">{err}</p>}
          </Dialog>
        </>
      )}
    </>
  );
}

const missingText = (m: Missing[]) => m.map((x) => MISSING_LABEL[x]).join('; ');

function GeneralListView({ listId, onChanged, onDeleted }: { listId: string; onChanged: () => void; onDeleted: () => Promise<void> }) {
  const toast = useToast();
  const d = useResource(() => get<ListDetail>(`/api/shopping-lists/${listId}`), [listId]);
  const trips = useResource(() => get<{ trips: Trip[] }>('/api/trips'), []);
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [perDay, setPerDay] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<(GItem & { qtyText: string }) | null>(null);
  const [editErr, setEditErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<GItem | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deletingList, setDeletingList] = useState(false);
  const [prices, setPrices] = useState<Product | null>(null);
  const [copyTrip, setCopyTrip] = useState('');
  const [copyOpen, setCopyOpen] = useState(false);
  const reload = async () => { await d.reload(); onChanged(); };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setAddErr('Escribe qué hay que comprar.'); return; }
    const q = Number(qty);
    if (!Number.isInteger(q) || q < 1 || q > 999) { setAddErr('Cantidad: número entero entre 1 y 999.'); return; }
    setBusy('add'); setAddErr(null);
    try {
      await post(`/api/shopping-lists/${listId}/items`, { name: name.trim(), qty: q, perDay });
      setName(''); setQty('1'); setPerDay(false);
      toast.show('Artículo añadido a la lista general.');
      await reload();
    } catch (err) { setAddErr(errorMessage(err)); } finally { setBusy(null); }
  };

  const saveEdit = async () => {
    if (!editing) return;
    const q = Number(editing.qtyText);
    if (!editing.name.trim()) { setEditErr('El nombre no puede quedar vacío.'); return; }
    if (!Number.isInteger(q) || q < 1 || q > 999) { setEditErr('Cantidad: número entero entre 1 y 999.'); return; }
    setBusy('edit'); setEditErr(null);
    try {
      const orig = d.data?.items.find((i) => i.id === editing.id);
      await patch(`/api/shopping-lists/${listId}/items/${editing.id}`, {
        name: editing.name.trim(), note: editing.note?.trim() || null, perDay: editing.perDay, productId: editing.product?.id ?? null,
        // La cantidad solo se envía si cambia o estaba en duda: enviarla confirma la cantidad de la hoja.
        ...(orig && (orig.qty !== q || orig.qtyUnclear) ? { qty: q } : {}), version: editing.version,
      });
      toast.show('Artículo guardado.');
      setEditing(null);
      await reload();
    } catch (err) {
      setEditErr(err instanceof ApiError && err.isConflict ? 'Este artículo ha cambiado en otra pestaña. Cierra y vuelve a abrirlo.' : errorMessage(err));
    } finally { setBusy(null); }
  };

  const doDelete = async () => {
    if (!deleting) return;
    setBusy('del');
    try { await del(`/api/shopping-lists/${listId}/items/${deleting.id}`); setDeleting(null); toast.show('Artículo eliminado de la lista general.'); await reload(); }
    catch (err) { toast.show(errorMessage(err), 'error'); } finally { setBusy(null); }
  };

  const rename = async () => {
    if (renaming === null || !d.data) return;
    if (!renaming.trim()) { setEditErr('Ponle un nombre.'); return; }
    setBusy('ren'); setEditErr(null);
    try { await patch(`/api/shopping-lists/${listId}`, { name: renaming.trim(), version: d.data.list.version }); setRenaming(null); toast.show('Lista renombrada.'); await reload(); }
    catch (err) { setEditErr(errorMessage(err)); } finally { setBusy(null); }
  };

  const deleteList = async () => {
    setBusy('dl');
    try { await del(`/api/shopping-lists/${listId}`); setDeletingList(false); toast.show('Lista general eliminada. Las copias de tus viajes siguen igual.'); await onDeleted(); }
    catch (err) { toast.show(errorMessage(err), 'error'); } finally { setBusy(null); }
  };

  useEffect(() => { if (!copyTrip && trips.data?.trips[0]) setCopyTrip(trips.data.trips[0].id); }, [trips.data, copyTrip]);

  if (d.loading && !d.data) return <Loading />;
  if (d.error && !d.data) return <ErrorState message={d.error} onRetry={() => void d.reload()} />;
  const { list, items, note } = d.data!;
  const incomplete = items.filter((i) => i.missing.includes('product') || i.missing.includes('qty')).length;
  const tripList = trips.data?.trips ?? [];

  return (
    <>
      <section className="panel stack" aria-labelledby="gl-h">
        <div className="toolbar">
          <h2 id="gl-h">{list.name} <span className="count">{items.length}</span></h2>
          <div className="cluster-s">
            <LegacyToGeneral listId={listId} onDone={() => void reload()} />
            <button type="button" className="btn btn-small btn-ghost" onClick={() => { setEditErr(null); setRenaming(list.name); }}>Renombrar<span className="visually-hidden"> {list.name}</span></button>
            <button type="button" className="btn btn-small btn-ghost" onClick={() => setDeletingList(true)}>Eliminar lista<span className="visually-hidden"> {list.name}</span></button>
          </div>
        </div>
        <p className="small muted"><span className="tag tag-quiet">Privada</span> Solo la ves tú. Copiarla a un viaje crea artículos nuevos en ese viaje; lo que cambie allí no modifica esta lista.</p>
        <form className="form-row form-row-end" onSubmit={add} noValidate>
          <Field label="Artículo" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Por ejemplo: leche" />
          <Field label="Cantidad" type="number" min={1} max={999} value={qty} onChange={(e) => setQty(e.target.value)} />
          <div className="check"><input id="gl-perday" type="checkbox" checked={perDay} onChange={(e) => setPerDay(e.target.checked)} /><label htmlFor="gl-perday">Por día de esquí</label></div>
          <button type="submit" className="btn btn-primary" disabled={busy !== null}>{busy === 'add' ? 'Añadiendo…' : 'Añadir'}</button>
        </form>
        {addErr && <p className="form-error" role="alert">{addErr}</p>}
        {incomplete > 0 && <p className="notice notice-warn small" data-testid="gl-incomplete">{incomplete} artículo(s) incompletos: asocia un producto exacto (y revisa la cantidad) para tener precio con historial.</p>}
        {items.length === 0 ? (
          <Empty title="La lista está vacía"><p>Añade artículos arriba o recupera los de la hoja antigua.</p></Empty>
        ) : (
          <ul className="list" aria-label="Artículos de la lista general">
            {items.map((it) => (
              <li key={it.id} className="shop-row stack-s" data-item={it.id}>
                <div className="cluster-s">
                  <span><span className="shop-name">{it.name}</span> × {it.qty}{it.perDay && ' por día de esquí'}</span>
                  {it.legacy && <span className="tag legacy-tag">de la hoja antigua</span>}
                </div>
                <p className="small muted">
                  {it.product ? <>Producto: {it.product.name}{it.product.format && ` · ${it.product.format}`}</> : 'Sin producto exacto'}
                  {it.lastPrice && <> · Último precio registrado: <strong>{euros(it.lastPrice.amountCents)}</strong> <span className="price-origin">({PRICE_ORIGIN_LABEL[it.lastPrice.priceType] ?? it.lastPrice.priceType} · {numDate(it.lastPrice.observedOn)} · {it.lastPrice.storeLabel}{it.lastPrice.postalCode && ` ${it.lastPrice.postalCode}`})</span></>}
                  {it.note && ` · ${it.note}`}
                </p>
                {it.legacy?.priceText && <p className="small muted">Precio antiguo de la hoja: {it.legacy.priceText} € <span className="tag tag-quiet">antiguo</span> sin fecha ni tienda; no es un precio actual.</p>}
                {it.legacy?.quantityText && it.qtyUnclear && <p className="small muted">Cantidad en la hoja: «{it.legacy.quantityText}»</p>}
                {it.missing.length > 0 && <p className="small gl-missing"><strong>Falta:</strong> {missingText(it.missing)}</p>}
                <div className="cluster-s">
                  <button type="button" className="btn btn-small btn-ghost" onClick={() => { setEditErr(null); setEditing({ ...it, qtyText: String(it.qty) }); }}>Editar<span className="visually-hidden"> {it.name}</span></button>
                  {it.product && <button type="button" className="btn btn-small btn-ghost" onClick={() => setPrices(it.product)}>Ver precios<span className="visually-hidden"> de {it.name}</span></button>}
                  <button type="button" className="btn btn-small btn-ghost" onClick={() => setDeleting(it)}>Eliminar<span className="visually-hidden"> {it.name}</span></button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {prices && <ProductPrices key={prices.id} product={prices} onClose={() => { setPrices(null); void d.reload(); }} />}
        <p className="small muted">{note}</p>
      </section>

      <section className="panel stack" aria-labelledby="gl-copy-h">
        <h2 id="gl-copy-h">Copiar a un viaje</h2>
        {trips.loading && !trips.data ? <Loading /> : tripList.length === 0 ? (
          <p className="muted">Cuando tengas un viaje podrás copiar esta lista a su compra. <Link to="/viajes">Ir a mis viajes</Link></p>
        ) : items.length === 0 ? <p className="muted">Añade artículos a la lista para poder copiarla.</p> : (
          <>
            <p className="small muted">Antes de copiar verás qué artículos coinciden con lo que ya tiene el viaje y decidirás qué hacer con cada uno. No se copia el estado de comprado ni el responsable.</p>
            <div className="form-row form-row-end">
              <SelectField label="Viaje de destino" value={copyTrip} onChange={(e) => setCopyTrip(e.target.value)}>
                {tripList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </SelectField>
              <button type="button" className="btn btn-primary" onClick={() => setCopyOpen(true)} disabled={!copyTrip}>Revisar y copiar…</button>
            </div>
          </>
        )}
        {copyOpen && copyTrip && <CopyToTripDialog listId={listId} tripId={copyTrip} onClose={() => setCopyOpen(false)} onDone={() => setCopyOpen(false)} />}
      </section>

      <Dialog open={editing !== null} title="Editar artículo de la lista general" size="wide" onClose={() => setEditing(null)} busy={busy === 'edit'}
        footer={<>
          <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)} disabled={busy === 'edit'}>Cancelar</button>
          <button type="submit" form="gl-item-form" className="btn btn-primary" disabled={busy === 'edit'}>{busy === 'edit' ? 'Guardando…' : 'Guardar'}</button>
        </>}>
        {editing && (
          <form id="gl-item-form" className="form-grid" onSubmit={(e) => { e.preventDefault(); void saveEdit(); }} noValidate>
            <Field label="Nombre" value={editing.name} maxLength={120} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <Field label="Cantidad" type="number" min={1} max={999} value={editing.qtyText} onChange={(e) => setEditing({ ...editing, qtyText: e.target.value })}
              hint={editing.qtyUnclear && editing.legacy?.quantityText ? `En la hoja ponía «${editing.legacy.quantityText}». Guarda para confirmarla.` : 'Nº de envases del producto'} />
            <div className="check span-2"><input id="gl-edit-perday" type="checkbox" checked={editing.perDay} onChange={(e) => setEditing({ ...editing, perDay: e.target.checked })} /><label htmlFor="gl-edit-perday">Por día de esquí (al copiar se multiplica por los días de esquí del viaje)</label></div>
            <Field className="span-2" label="Nota" value={editing.note ?? ''} maxLength={300} onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
            <div className="span-2">
              <ProductPicker id="gl-edit-product" label="Producto exacto" value={editing.product} onChange={(p) => setEditing({ ...editing, product: p as Product | null })} />
              <p className="small muted">Un producto es un formato exacto (marca, envase, cantidad neta). Si no existe, créalo en «Productos y precios».</p>
            </div>
          </form>
        )}
        {editErr && <p className="form-error" role="alert">{editErr}</p>}
      </Dialog>
      <Dialog open={renaming !== null} title="Renombrar lista" onClose={() => setRenaming(null)} busy={busy === 'ren'}
        footer={<>
          <button type="button" className="btn btn-secondary" onClick={() => setRenaming(null)} disabled={busy === 'ren'}>Cancelar</button>
          <button type="submit" form="gl-ren-form" className="btn btn-primary" disabled={busy === 'ren'}>Guardar</button>
        </>}>
        {renaming !== null && (
          <form id="gl-ren-form" onSubmit={(e) => { e.preventDefault(); void rename(); }} noValidate>
            <Field label="Nombre de la lista" value={renaming} maxLength={80} onChange={(e) => setRenaming(e.target.value)} />
          </form>
        )}
        {editErr && <p className="form-error" role="alert">{editErr}</p>}
      </Dialog>
      <ConfirmDialog open={deleting !== null} title={`¿Eliminar «${deleting?.name ?? ''}»?`} body={<p>Se quita de la lista general. Las copias que ya estén en tus viajes no cambian.</p>} confirmLabel="Eliminar" danger busy={busy === 'del'}
        onConfirm={() => void doDelete()} onClose={() => setDeleting(null)} />
      <ConfirmDialog open={deletingList} title={`¿Eliminar la lista «${list.name}»?`} body={<p>Se borran sus {items.length} artículo(s). Las listas de tus viajes no cambian.</p>} confirmLabel="Eliminar lista" danger busy={busy === 'dl'}
        onConfirm={() => void deleteList()} onClose={() => setDeletingList(false)} />
    </>
  );
}

interface LegacyRow { id: string; name: string; quantityText: string | null; priceText: string | null; perDay: boolean; qty: number; qtyUnclear: boolean; importedHere: boolean; missing: Missing[] }

/** Vista previa de la hoja antigua e importación idempotente a la lista general (incluidos los incompletos). */
function LegacyToGeneral({ listId, onDone }: { listId: string; onDone: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const legacy = useResource(() => (open ? get<{ items: LegacyRow[]; note: string }>(`/api/shopping-lists/${listId}/legacy`) : Promise.resolve(null)), [listId, open]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rows = legacy.data?.items ?? [];
  const pending = rows.filter((r) => !r.importedHere);

  useEffect(() => { if (legacy.data) setChosen(new Set(legacy.data.items.filter((r) => !r.importedHere).map((r) => r.id))); }, [legacy.data]);

  const doImport = async () => {
    const ids = pending.filter((r) => chosen.has(r.id)).map((r) => r.id);
    if (!ids.length) { setErr('Marca al menos un artículo.'); return; }
    setBusy(true); setErr(null);
    try {
      let created = 0, already = 0;
      for (let i = 0; i < ids.length; i += 200) {
        const r = await post<{ created: number; alreadyImported: number }>(`/api/shopping-lists/${listId}/legacy-import`, { legacyIds: ids.slice(i, i + 200) });
        created += r.created; already += r.alreadyImported;
      }
      toast.show(`${created} artículo(s) importado(s) de la hoja antigua${already ? `; ${already} ya estaban y no se han duplicado` : ''}.`);
      setOpen(false);
      onDone();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <>
      <button type="button" className="btn btn-small btn-secondary" onClick={() => { setErr(null); setOpen(true); }}>Revisar la hoja antigua</button>
      <Dialog open={open} title="Compra de la hoja antigua" size="wide" onClose={() => setOpen(false)} busy={busy}
        footer={<>
          <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} disabled={busy}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={() => void doImport()} disabled={busy || !pending.some((r) => chosen.has(r.id))}>
            {busy ? 'Importando…' : `Importar ${pending.filter((r) => chosen.has(r.id)).length} a la lista`}</button>
        </>}>
        {legacy.loading && !legacy.data ? <Loading /> : legacy.error ? <ErrorState message={legacy.error} onRetry={() => void legacy.reload()} /> : rows.length === 0 ? (
          <Empty title="No hay compra de la hoja antigua"><p>No se importó ninguna fila de compra de la hoja.</p></Empty>
        ) : (
          <div className="stack">
            <p className="small muted">{legacy.data?.note}</p>
            {pending.length > 0 ? (
              <div className="cluster-s">
                <button type="button" className="btn btn-small btn-ghost" onClick={() => setChosen(new Set(pending.map((r) => r.id)))}>Marcar todos</button>
                <button type="button" className="btn btn-small btn-ghost" onClick={() => setChosen(new Set())}>Desmarcar todos</button>
              </div>
            ) : <p className="notice notice-ok small">Todos los artículos de la hoja ya están en esta lista.</p>}
            <ul className="list" aria-label="Artículos de la hoja antigua">
              {rows.map((r) => (
                <li key={r.id} className="legacy-row stack-s">
                  <div className="check">
                    <input id={`glg-${r.id}`} type="checkbox" checked={r.importedHere || chosen.has(r.id)} disabled={r.importedHere}
                      onChange={(e) => { const n = new Set(chosen); if (e.target.checked) n.add(r.id); else n.delete(r.id); setChosen(n); }} />
                    <label htmlFor={`glg-${r.id}`}><strong>{r.name}</strong>{r.importedHere && <span className="visually-hidden"> (ya en la lista)</span>}</label>
                    {r.importedHere && <span className="tag tag-quiet" aria-hidden="true">ya en la lista</span>}
                  </div>
                  <p className="small muted">
                    {r.quantityText ? `Cantidad en la hoja: ${r.quantityText}` : 'Sin cantidad en la hoja'}{r.perDay && ' (por día)'}
                    {r.priceText && <> · precio antiguo: {r.priceText} € <span className="tag tag-quiet">antiguo</span></>}
                  </p>
                  {!r.importedHere && <p className="small gl-missing"><strong>Falta:</strong> {missingText(r.missing)}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {err && <p className="form-error" role="alert">{err}</p>}
      </Dialog>
    </>
  );
}

interface CopyPreview { trip: { id: string; name: string; skiDays: number | null; items: number; maxItems: number }; rows: CopyPlanRow[]; matches: number; note: string }
const REASON: Record<string, string> = { already_copied: 'ya copiado de esta lista', same_product: 'mismo producto', same_name: 'mismo nombre' };
const actionLabel = (a: CopyAction, r: CopyPlanRow) => a === 'skip' ? (r.match ? 'Dejar lo que hay' : 'No añadir') : a === 'sum' ? `Sumar ${r.qty} a lo que hay` : r.match ? 'Añadir aparte' : 'Añadir';

/** Vista previa de la copia a un viaje: se decide qué hacer con cada coincidencia antes de escribir nada. */
export function CopyToTripDialog({ listId, tripId, onClose, onDone }: { listId: string; tripId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const prev = useResource(() => post<CopyPreview>(`/api/shopping-lists/${listId}/copy/preview`, { tripId }), [listId, tripId]);
  const [choice, setChoice] = useState<Record<string, CopyAction>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (prev.data) setChoice(Object.fromEntries(prev.data.rows.map((r) => [r.itemId, r.actions[0]]))); }, [prev.data]);
  const rows = prev.data?.rows ?? [];
  const adds = rows.filter((r) => choice[r.itemId] === 'add').length;
  const sums = rows.filter((r) => choice[r.itemId] === 'sum').length;

  const confirm = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await post<{ added: number; summed: number; skipped: number; notSummed: number }>(`/api/shopping-lists/${listId}/copy`, {
        tripId, items: rows.map((x) => ({ itemId: x.itemId, action: choice[x.itemId] ?? x.actions[0] })),
      });
      toast.show(`Copiado a «${prev.data!.trip.name}»: ${r.added} añadido(s), ${r.summed} sumado(s), ${r.skipped} sin tocar${r.notSummed ? `; ${r.notSummed} no se sumaron porque ya estaban comprados` : ''}.`);
      onDone();
    } catch (e) { setErr(errorMessage(e)); void prev.reload(); } finally { setBusy(false); }
  };

  return (
    <Dialog open title={prev.data ? `Copiar a «${prev.data.trip.name}»` : 'Copiar a un viaje'} size="wide" onClose={onClose} busy={busy}
      footer={<>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancelar</button>
        <button type="button" className="btn btn-primary" onClick={() => void confirm()} disabled={busy || !prev.data || adds + sums === 0}>{busy ? 'Copiando…' : `Copiar al viaje (${adds} nuevos${sums ? `, ${sums} sumas` : ''})`}</button>
      </>}>
      {prev.loading && !prev.data ? <Loading label="Comparando con la lista del viaje…" /> : prev.error && !prev.data ? <ErrorState message={prev.error} onRetry={() => void prev.reload()} /> : prev.data && (
        <div className="stack">
          <p className="small muted">{prev.data.note}</p>
          <p data-testid="copy-summary">{prev.data.trip.items === 0 ? 'La lista del viaje está vacía.' : `El viaje ya tiene ${prev.data.trip.items} artículo(s); ${prev.data.matches} coinciden con esta lista.`}</p>
          <ul className="list" aria-label="Artículos a copiar">
            {rows.map((r) => (
              <li key={r.itemId} className="stack-s copy-row">
                <fieldset className="copy-choice">
                  <legend><strong>{r.name}</strong> × {r.qty}{r.qtyNote && <span className="small muted"> ({r.qtyNote})</span>}</legend>
                  {r.match && (
                    <p className="small">Coincide ({REASON[r.match.reason]}): en el viaje ya hay «{r.match.name}» × {r.match.qty}{r.match.bought && <span className="tag tag-ok">comprado</span>}</p>
                  )}
                  <div className="cluster-s">
                    {r.actions.map((a) => (
                      <div key={a} className="radio">
                        <input type="radio" id={`cp-${r.itemId}-${a}`} name={`cp-${r.itemId}`} checked={choice[r.itemId] === a} onChange={() => setChoice({ ...choice, [r.itemId]: a })} />
                        <label htmlFor={`cp-${r.itemId}-${a}`}>{actionLabel(a, r)}<span className="visually-hidden"> «{r.name}»</span></label>
                      </div>
                    ))}
                  </div>
                </fieldset>
              </li>
            ))}
          </ul>
        </div>
      )}
      {err && <p className="form-error" role="alert">{err}</p>}
    </Dialog>
  );
}

/** Desde la compra de un viaje: elegir una lista general y copiarla con vista previa. */
export function AddFromGeneral({ tripId, onDone }: { tripId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const lists = useResource(() => (open ? get<{ lists: ListSummary[] }>('/api/shopping-lists') : Promise.resolve(null)), [open]);
  const [listId, setListId] = useState('');
  const [step, setStep] = useState<'pick' | 'preview'>('pick');
  const all = (lists.data?.lists ?? []).filter((l) => l.items > 0);
  useEffect(() => { if (all.length && !all.some((l) => l.id === listId)) setListId(all[0].id); }, [lists.data]);
  const close = () => { setOpen(false); setStep('pick'); };
  return (
    <>
      <button type="button" className="btn btn-small btn-secondary" onClick={() => setOpen(true)}>Añadir desde mi lista general</button>
      {open && step === 'pick' && (
        <Dialog open title="Añadir desde una lista general" onClose={close}
          footer={<>
            <button type="button" className="btn btn-secondary" onClick={close}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={() => setStep('preview')} disabled={!listId || !all.length}>Revisar coincidencias</button>
          </>}>
          {lists.loading && !lists.data ? <Loading /> : lists.error ? <ErrorState message={lists.error} onRetry={() => void lists.reload()} /> : all.length === 0 ? (
            <Empty title="No tienes listas generales con artículos"><p><Link to="/compra?vista=general">Prepara tu lista general</Link> y vuelve para copiarla a este viaje.</p></Empty>
          ) : (
            <SelectField label="Lista general" value={listId} onChange={(e) => setListId(e.target.value)}>
              {all.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.items} artículos)</option>)}
            </SelectField>
          )}
        </Dialog>
      )}
      {open && step === 'preview' && listId && <CopyToTripDialog listId={listId} tripId={tripId} onClose={close} onDone={() => { close(); onDone(); }} />}
    </>
  );
}
