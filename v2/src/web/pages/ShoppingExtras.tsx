// Compra: criterio de precio de la lista, recuperación de la hoja antigua y evolución de la cesta fija.
// La cesta sigue UNA serie (tienda + CP + canal + tipo de precio): sin dato no se interpola ni se une la línea.
import { useEffect, useMemo, useState } from 'react';
import { ApiError, errorMessage, get, post, put, qs } from '../api';
import { Dialog } from '../components/Dialog';
import { Field, SelectField } from '../components/Field';
import { ErrorState, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { criterionText, euros, numDate, pctText, PRICE_SERIES_LABEL, signedEuros } from '../format';
import { useResource } from '../hooks';

type ListCriterion = { storeLabel: string; postalCode: string | null; channel: string };

/** Criterio explícito de la lista: qué tienda, CP y canal estiman la compra y sigue la cesta. */
export function CriterionEditor({ tripId, list, onSaved }: { tripId: string; list: ListCriterion; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<{ storeLabel: string; postalCode: string; channel: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!form) return;
    if (form.storeLabel.trim().length < 2) { setErr('Indica la tienda.'); return; }
    if (!/^\d{5}$/.test(form.postalCode.trim())) { setErr('El código postal tiene 5 cifras.'); return; }
    setBusy(true); setErr(null);
    try {
      await put(`/api/trips/${tripId}/shopping/list`, { storeLabel: form.storeLabel.trim(), postalCode: form.postalCode.trim(), channel: form.channel });
      toast.show('Criterio de precio guardado.');
      setForm(null);
      onSaved();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="criterion">
      <p className="small"><span className="muted">Criterio de precio:</span> <strong data-testid="list-criterion">{criterionText(list)}</strong></p>
      <button type="button" className="btn btn-small btn-ghost" onClick={() => { setErr(null); setForm({ storeLabel: list.storeLabel, postalCode: list.postalCode ?? '', channel: list.channel === 'store' ? 'store' : 'online' }); }}>
        Cambiar<span className="visually-hidden"> criterio de precio</span></button>
      <Dialog open={form !== null} title="Criterio de precio" onClose={() => setForm(null)} busy={busy}
        footer={<>
          <button type="button" className="btn btn-secondary" onClick={() => setForm(null)} disabled={busy}>Cancelar</button>
          <button type="submit" form="crit-form" className="btn btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </>}>
        {form && (
          <form id="crit-form" className="form-grid" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
            <p className="span-2 small muted">La estimación y la cesta usan solo precios de esta tienda, código postal y canal. Otras tiendas no se mezclan.</p>
            <Field label="Tienda" value={form.storeLabel} maxLength={80} onChange={(e) => setForm({ ...form, storeLabel: e.target.value })} />
            <Field label="Código postal" inputMode="numeric" maxLength={5} value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} />
            <SelectField label="Canal" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
              <option value="online">Online</option><option value="store">Tienda física</option>
            </SelectField>
          </form>
        )}
        {err && <p className="form-error" role="alert">{err}</p>}
      </Dialog>
    </div>
  );
}

interface PickProduct { id: string; name: string; format: string | null; replacedBy?: string | null }

/** Búsqueda de producto exacto (nombre o EAN). Nada se elige solo. */
export function ProductPicker({ id, label, value, onChange }: { id: string; label: string; value: PickProduct | null; onChange: (p: PickProduct | null) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PickProduct[]>([]);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setResults([]); return; }
    const h = window.setTimeout(() => { get<{ products: PickProduct[] }>(`/api/products?q=${encodeURIComponent(t)}`).then((r) => setResults(r.products)).catch(() => setResults([])); }, 250);
    return () => window.clearTimeout(h);
  }, [q]);
  if (value) {
    return (
      <p className="small picked">Producto: <strong>{value.name}</strong>{value.format && ` · ${value.format}`}{' '}
        <button type="button" className="btn btn-small btn-ghost" onClick={() => onChange(null)}>Quitar<span className="visually-hidden"> producto de {label}</span></button></p>
    );
  }
  return (
    <div className="field picker">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre o EAN" autoComplete="off" />
      {results.length > 0 && (
        <ul className="list" aria-label={`Resultados para ${label}`}>
          {results.map((p) => (
            <li key={p.id} className="list-row"><span className="list-main small">{p.name}{p.format && ` · ${p.format}`}{p.replacedBy && ' (sustituido)'}</span>
              <button type="button" className="btn btn-small btn-secondary" onClick={() => { onChange(p); setQ(''); }}>Elegir<span className="visually-hidden"> {p.name}</span></button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface LegacyItem { id: string; name: string; quantityText: string | null; priceText: string | null; file: string; importedHere: boolean }
type LegacyRow = { include: boolean; qty: string; product: PickProduct | null };

/** Recuperación explícita de la compra de la hoja antigua. Solo aparece si hay artículos; repetir no duplica. */
export function LegacyImport({ tripId, onDone }: { tripId: string; onDone: () => void }) {
  const toast = useToast();
  const legacy = useResource(() => get<{ items: LegacyItem[]; note: string }>(`/api/trips/${tripId}/shopping/legacy`).catch((e) => {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return { items: [], note: '' };
    throw e;
  }), [tripId]);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Record<string, LegacyRow>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const items = legacy.data?.items ?? [];
  if (!items.length) return null;

  const start = () => {
    setErr(null);
    setRows(Object.fromEntries(items.map((i) => {
      const n = Number.parseInt(i.quantityText ?? '', 10);
      return [i.id, { include: false, qty: String(Number.isInteger(n) && n >= 1 && n <= 999 ? n : 1), product: null }];
    })));
    setOpen(true);
    void legacy.reload();
  };
  const chosen = items.filter((i) => rows[i.id]?.include && !i.importedHere);
  const doImport = async () => {
    if (!chosen.length) { setErr('Marca al menos un artículo.'); return; }
    const bad = chosen.find((i) => { const q = Number(rows[i.id].qty); return !Number.isInteger(q) || q < 1 || q > 999; });
    if (bad) { setErr(`Cantidad de «${bad.name}»: número entero entre 1 y 999.`); return; }
    setBusy(true); setErr(null);
    try {
      const r = await post<{ created: number; alreadyImported: number }>(`/api/trips/${tripId}/shopping/legacy-import`, {
        items: chosen.map((i) => ({ legacyId: i.id, productId: rows[i.id].product?.id ?? null, qty: Number(rows[i.id].qty) })),
      });
      toast.show(`${r.created} artículo(s) añadido(s) a la lista${r.alreadyImported ? `; ${r.alreadyImported} ya estaban y no se han duplicado` : ''}.`);
      setOpen(false);
      onDone();
      void legacy.reload();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  const setRow = (id: string, patch: Partial<LegacyRow>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));

  return (
    <>
      <button type="button" className="btn btn-small btn-secondary" onClick={start}>Recuperar de la hoja antigua</button>
      <Dialog open={open} title="Compra de la hoja antigua" size="wide" onClose={() => setOpen(false)} busy={busy}
        footer={<>
          <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} disabled={busy}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={() => void doImport()} disabled={busy || chosen.length === 0}>{busy ? 'Añadiendo…' : chosen.length ? `Añadir ${chosen.length} a la lista` : 'Añadir a la lista'}</button>
        </>}>
        <div className="stack">
          {legacy.data?.note && <p className="small muted">{legacy.data.note}</p>}
          <ul className="list" aria-label="Artículos de la hoja antigua">
            {items.map((i) => {
              const r = rows[i.id];
              if (!r) return null;
              return (
                <li key={i.id} className="legacy-row stack-s">
                  <div className="check">
                    <input id={`lg-${i.id}`} type="checkbox" checked={i.importedHere || r.include} disabled={i.importedHere} onChange={(e) => setRow(i.id, { include: e.target.checked })} />
                    <label htmlFor={`lg-${i.id}`}><strong>{i.name}</strong>{i.importedHere && <span className="visually-hidden"> (ya en la lista)</span>}</label>
                    {i.importedHere && <span className="tag tag-quiet" aria-hidden="true">ya en la lista</span>}
                  </div>
                  <p className="small muted">{i.quantityText ? `Cantidad en la hoja: ${i.quantityText}` : 'Sin cantidad en la hoja'}{i.priceText && ` · precio en la hoja: ${i.priceText} (sin fecha ni tienda, no se usa)`}</p>
                  {r.include && !i.importedHere && (
                    <div className="form-grid">
                      <ProductPicker id={`lgp-${i.id}`} label={`Producto exacto para «${i.name}»`} value={r.product} onChange={(p) => setRow(i.id, { product: p })} />
                      <Field label={`Cantidad de «${i.name}»`} type="number" min={1} max={999} value={r.qty} onChange={(e) => setRow(i.id, { qty: e.target.value })} hint="Envases" />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        {err && <p className="form-error" role="alert">{err}</p>}
      </Dialog>
    </>
  );
}

// ---------- Evolución de la cesta ----------

interface Series { storeLabel: string; postalCode: string | null; channel: string; priceType: string; products: number; observations: number; lastDate: string }
interface BasketPoint { date: string; coverage: number; pricedProducts: number; totalCents: number | null; knownCents: number; diffCents: number | null; diffPct: number | null; previousDate: string | null }
interface BasketResponse {
  criterion: { storeLabel: string; postalCode: string | null; channel: string; priceType: string; origin: 'list' | 'query' };
  products: { productId: string; name: string | null; format: string | null; qty: number; replacedBy: string | null;
    points: { date: string; amountCents: number; source: string; diffCents: number | null; diffPct: number | null; previousDate: string | null }[] }[];
  points: BasketPoint[]; latest: BasketPoint | null; availableSeries: Series[]; note: string;
}
const seriesId = (s: { storeLabel: string; postalCode: string | null; channel: string; priceType: string }) => JSON.stringify([s.storeLabel, s.postalCode, s.channel, s.priceType]);
const special = (t: string) => t === 'promo' || t === 'personal_discount';

export function BasketPanel({ tripId, listVersion }: { tripId: string; listVersion: string }) {
  const [series, setSeries] = useState<Series | null>(null);
  const query = series ? qs({ store: series.storeLabel, postalCode: series.postalCode, channel: series.channel, priceType: series.priceType }) : '';
  const b = useResource(() => get<BasketResponse>(`/api/trips/${tripId}/shopping/basket${query ? `?${query}` : ''}`), [tripId, query, listVersion]);
  const d = b.data;
  return (
    <section className="panel stack" aria-labelledby="bk-h">
      <h2 id="bk-h">Evolución de la cesta</h2>
      {b.loading && !d && <Loading label="Cargando la cesta…" />}
      {b.error && !d && <ErrorState message={b.error} onRetry={() => void b.reload()} />}
      {d && (
        <>
          {d.availableSeries.length > 0 && (
            <SelectField label="Serie de precios" value={series ? seriesId(series) : ''} onChange={(e) => setSeries(d.availableSeries.find((s) => seriesId(s) === e.target.value) ?? null)}>
              <option value="">Criterio de la lista (precio de estantería)</option>
              {d.availableSeries.map((s) => (
                <option key={seriesId(s)} value={seriesId(s)}>{criterionText(s)} · {PRICE_SERIES_LABEL[s.priceType] ?? s.priceType} · {s.products} producto(s), último {numDate(s.lastDate)}</option>
              ))}
            </SelectField>
          )}
          <p className="small">Serie: <strong data-testid="basket-series">{criterionText(d.criterion)} · {PRICE_SERIES_LABEL[d.criterion.priceType] ?? d.criterion.priceType}</strong>
            {d.criterion.origin === 'list' && <span className="muted"> (criterio de la lista)</span>}</p>
          {special(d.criterion.priceType) && (
            <p className="notice notice-warn small">{d.criterion.priceType === 'promo' ? 'Serie de promociones' : 'Serie de descuentos personales'}: no es el precio de estantería y no se usa para estimar la compra.</p>
          )}
          {d.products.length === 0 ? <p className="muted">{d.note}</p> : (
            <>
              <BasketChart points={d.points} />
              <div className="table-scroll" tabIndex={0} role="region" aria-label="Total de la cesta por fecha">
                <table className="data-table compact">
                  <caption className="visually-hidden">Total de la cesta por fecha, con cobertura y cambio</caption>
                  <thead><tr><th scope="col">Fecha</th><th scope="col">Total</th><th scope="col">Cambio</th></tr></thead>
                  <tbody>{d.points.length === 0 ? <tr><td colSpan={3} className="muted">Sin precios en esta serie.</td></tr> : d.points.map((p) => (
                    <tr key={p.date}>
                      <th scope="row">{numDate(p.date)}</th>
                      <td>{p.totalCents != null ? <strong>{euros(p.totalCents)}</strong>
                        : <span className="muted">cobertura {Math.round(p.coverage * 100)} % ({p.pricedProducts} de {d.products.length}; sin total)</span>}</td>
                      <td>{p.diffCents != null ? <>{signedEuros(p.diffCents)}{p.diffPct != null && ` (${pctText(p.diffPct)})`}{p.previousDate && <span className="muted"> vs {numDate(p.previousDate)}</span>}</> : '—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <div className="table-scroll" tabIndex={0} role="region" aria-label="Historial por producto">
                <table className="data-table compact">
                  <caption className="visually-hidden">Historial de precio por producto en esta serie</caption>
                  <thead><tr><th scope="col">Producto</th><th scope="col">Fecha</th><th scope="col">Precio</th><th scope="col">Cambio</th></tr></thead>
                  {d.products.map((p) => {
                    const name = `${p.name ?? 'Producto'}${p.format ? ` · ${p.format}` : ''} × ${p.qty}${p.replacedBy ? ' (sustituido)' : ''}`;
                    return (
                      <tbody key={p.productId}>
                        {p.points.length === 0 ? <tr><th scope="row">{name}</th><td colSpan={3} className="muted">sin precio en esta serie</td></tr>
                          : p.points.map((pt, i) => (
                            <tr key={pt.date}>
                              {i === 0 && <th scope="rowgroup" rowSpan={p.points.length}>{name}</th>}
                              <td>{numDate(pt.date)}</td><td>{euros(pt.amountCents)}</td>
                              <td>{pt.diffCents != null ? `${signedEuros(pt.diffCents)}${pt.diffPct != null ? ` (${pctText(pt.diffPct)})` : ''}` : '—'}</td>
                            </tr>
                          ))}
                      </tbody>
                    );
                  })}
                </table>
              </div>
              <p className="small muted">{d.note}</p>
            </>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Línea del total (solo fechas con total). Un punto sin total rompe la línea: nunca se une a través de huecos ni se
 * interpola. Decorativa: la tabla es la alternativa accesible.
 */
function BasketChart({ points }: { points: BasketPoint[] }) {
  const geo = useMemo(() => {
    const withTotal = points.filter((p) => p.totalCents != null);
    if (!withTotal.length) return null;
    const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
    const t0 = t(points[0].date), t1 = t(points[points.length - 1].date);
    const vals = withTotal.map((p) => p.totalCents!);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (lo === hi) { lo = lo * 0.9; hi = hi * 1.1 || 100; }
    const W = 600, H = 160, L = 8, R = 8, T = 14, B = 14;
    const x = (d: string) => (t1 === t0 ? W / 2 : L + ((t(d) - t0) / (t1 - t0)) * (W - L - R));
    const y = (c: number) => T + (1 - (c - lo) / (hi - lo)) * (H - T - B);
    const segments: { x: number; y: number }[][] = [];
    let cur: { x: number; y: number }[] = [];
    for (const p of points) {
      if (p.totalCents == null) { if (cur.length) segments.push(cur); cur = []; continue; }
      cur.push({ x: x(p.date), y: y(p.totalCents) });
    }
    if (cur.length) segments.push(cur);
    const gaps = points.filter((p) => p.totalCents == null).map((p) => x(p.date));
    return { W, H, segments, gaps, min: Math.min(...vals), max: Math.max(...vals), dots: withTotal.map((p) => ({ x: x(p.date), y: y(p.totalCents!), k: p.date })) };
  }, [points]);
  if (!geo) return <p className="small muted">Aún no hay ninguna fecha con precio de todos los productos: no se dibuja total.</p>;
  return (
    <figure className="basket-chart">
      <svg viewBox={`0 0 ${geo.W} ${geo.H}`} aria-hidden="true" focusable="false">
        {geo.gaps.map((gx, i) => <line key={`g${i}`} x1={gx} x2={gx} y1={10} y2={geo.H - 10} className="gap" />)}
        {geo.segments.map((s, i) => s.length > 1 && <polyline key={i} points={s.map((p) => `${p.x},${p.y}`).join(' ')} className="line" />)}
        {geo.dots.map((p) => <circle key={p.k} cx={p.x} cy={p.y} r={4} className="dot" />)}
      </svg>
      <figcaption className="small muted">Total de la cesta: de {euros(geo.min)} a {euros(geo.max)}. Las marcas verticales son fechas sin precio de todos los productos (sin total, no se une la línea).</figcaption>
    </figure>
  );
}

