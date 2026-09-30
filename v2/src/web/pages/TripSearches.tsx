// Búsquedas por fechas (escenarios) y su panel de ofertas. «No observada» no es «agotada».
import { useState } from 'react';
import { del, errorMessage, get, post } from '../api';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { Field, SelectField } from '../components/Field';
import { Empty, ErrorState, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { TripShell } from '../components/TripTabs';
import { AVAILABILITY_LABEL, euros, instant, MODALITY_LABEL, PRICE_KIND_LABEL, signedEuros, UNIT_LABEL } from '../format';
import { useResource } from '../hooks';
import type { Catalog } from '../catalog';
import type { TripDetail } from '../types';
import type { OfferPanel } from '../../core/analytics';

interface ScenarioOffer { offerId: string; hotelName: string | null; board: string | null; cancellation: string | null; nights: number | null; forfaitDays: number | null; adults: number | null; url: string | null; availability: string; panel: OfferPanel }
interface Scenario {
  id: string; providerId: string; areaId: string; modality: string; checkIn: string; checkOut: string; nights: number; adults: number; childrenAges: number[]; rooms: number | null; forfaitDays: number | null;
  active: boolean; lastRun: { observed_at: number; outcome: string; offers_found: number; error: string | null } | null; offers: ScenarioOffer[];
  distribution: { n: number; minCents: number | null; medianCents: number | null; maxCents: number | null; compositionChanged: boolean; added: string[]; removed: string[] };
}
const OUTCOME: Record<string, string> = {
  results: 'con resultados', empty: 'sin resultados para esas fechas', error: 'error al buscar', blocked: 'el proveedor bloqueó la búsqueda',
  unsupported: 'este proveedor aún no permite búsqueda por fechas',
};
const MAX = 4;

export function TripSearchesPage({ tripId }: { tripId: string }) {
  return <TripShell tripId={tripId} tab="busquedas" title="Búsquedas">{(d) => <Searches tripId={tripId} detail={d} />}</TripShell>;
}

function Searches({ tripId, detail }: { tripId: string; detail: TripDetail }) {
  const toast = useToast();
  const r = useResource(() => get<{ scenarios: Scenario[]; note: string }>(`/api/trips/${tripId}/scenarios`), [tripId]);
  const catalog = useResource(() => get<Catalog>('/api/public/catalog'), []);
  const [form, setForm] = useState<null | Record<string, string>>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Scenario | null>(null);
  const canEdit = detail.trip.role !== 'member';
  const areaName = (id: string) => catalog.data?.areas.find((a) => a.id === id)?.name ?? id;

  const create = async () => {
    if (!form) return;
    setErr(null);
    if (!form.areaId || !form.checkIn || !form.checkOut) { setErr('Elige estación y fechas.'); return; }
    const ages = form.children.trim() ? form.children.split(/[,\s]+/).filter(Boolean).map(Number) : [];
    if (ages.some((a) => !Number.isInteger(a) || a < 0 || a > 17)) { setErr('Edades de menores: números de 0 a 17 separados por comas.'); return; }
    setBusy('create');
    try {
      const res = await post<{ reused: boolean }>(`/api/trips/${tripId}/scenarios`, {
        providerId: form.providerId, areaId: form.areaId, modality: form.modality, checkIn: form.checkIn, checkOut: form.checkOut, adults: Number(form.adults) || 1,
        childrenAges: ages, rooms: form.rooms ? Number(form.rooms) : null, forfaitDays: form.modality === 'lodging_forfait' ? Number(form.forfaitDays) || null : null,
      });
      setForm(null);
      toast.show(res.reused ? 'Búsqueda añadida (ya existía y se comparte con otros viajes).' : 'Búsqueda creada. Los recolectores la ejecutarán en la próxima pasada.');
      await r.reload();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(null); }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy('rm');
    try { await del(`/api/trips/${tripId}/scenarios/${removing.id}`); setRemoving(null); toast.show('Búsqueda quitada del viaje.'); await r.reload(); }
    catch (e) { toast.show(errorMessage(e), 'error'); } finally { setBusy(null); }
  };

  const propose = async (s: Scenario, o: ScenarioOffer) => {
    setBusy(`c:${o.offerId}`);
    try {
      await post(`/api/trips/${tripId}/candidates`, { title: `${o.hotelName ?? 'Alojamiento'} (${s.checkIn} → ${s.checkOut})`, offerId: o.offerId, modality: s.modality });
      toast.show('Añadida a candidaturas.');
    } catch (e) { toast.show(errorMessage(e), 'error'); } finally { setBusy(null); }
  };

  if (r.loading && !r.data) return <Loading />;
  if (r.error && !r.data) return <ErrorState message={r.error} onRetry={r.reload} />;
  const list = r.data!.scenarios;

  return (
    <div className="stack">
      <div className="toolbar">
        <p className="muted small">{r.data!.note} Máximo {MAX} búsquedas por viaje para mantener el coste en 0 €.</p>
        {canEdit && <button type="button" className="btn btn-primary" disabled={list.length >= MAX} onClick={() => {
          setErr(null);
          setForm({ providerId: 'esquiades', areaId: detail.trip.areaId ?? '', modality: 'lodging', checkIn: detail.trip.startDate ?? '', checkOut: detail.trip.endDate ?? '', adults: String(detail.trip.participantsPlanned ?? detail.members.length), rooms: '', forfaitDays: '', children: '' });
        }}>Nueva búsqueda</button>}
      </div>
      {list.length === 0 ? <Empty title="Sin búsquedas"><p>Crea una búsqueda con fechas y personas concretas para seguir sus precios.</p></Empty> : list.map((s) => (
        <section key={s.id} className="panel stack" aria-label={`Búsqueda ${areaName(s.areaId)} ${s.checkIn}`}>
          <div className="toolbar">
            <h2>{areaName(s.areaId)} · {s.checkIn} → {s.checkOut}</h2>
            {canEdit && <button type="button" className="btn btn-small btn-ghost" onClick={() => setRemoving(s)}>Quitar<span className="visually-hidden"> búsqueda</span></button>}
          </div>
          <p className="small">{s.providerId} · {MODALITY_LABEL[s.modality]} · {s.nights} noches · {s.adults} adultos{s.childrenAges.length > 0 && ` · menores de ${s.childrenAges.join(', ')} años`}{s.rooms != null && ` · ${s.rooms} hab.`}{s.forfaitDays != null && ` · ${s.forfaitDays} días de forfait`}</p>
          <p className="small">{s.lastRun ? <>Última búsqueda {instant(s.lastRun.observed_at)}: <strong className={s.lastRun.outcome === 'results' ? '' : 'text-bad'}>{OUTCOME[s.lastRun.outcome] ?? s.lastRun.outcome}</strong>{s.lastRun.error && ` (${s.lastRun.error})`}</> : 'Aún no se ha ejecutado.'}</p>
          {s.distribution.n > 0 && (
            <p className="small">Precios en la última búsqueda: mínimo {euros(s.distribution.minCents!)}, mediana {euros(s.distribution.medianCents!)}, máximo {euros(s.distribution.maxCents!)} ({s.distribution.n} ofertas).
              {s.distribution.compositionChanged && ' Las ofertas encontradas no son las mismas que en la búsqueda anterior: una bajada del mínimo no implica que un alojamiento haya bajado.'}</p>
          )}
          {s.offers.length > 0 && (
            <ul className="list">
              {s.offers.map((o) => {
                const p = o.panel;
                return (
                  <li key={o.offerId} className="offer-row">
                    <p><strong>{o.hotelName ?? 'Alojamiento'}</strong>{o.board && <span className="muted"> · {o.board}</span>} · <span className={o.availability === 'not_observed' ? 'muted' : ''}>{AVAILABILITY_LABEL[o.availability] ?? o.availability}</span></p>
                    {p.lastValid ? (
                      <p>{euros(p.lastValid.amountCents!)} {UNIT_LABEL[p.lastValid.unit] ?? p.lastValid.unit} <span className="tag tag-quiet">{PRICE_KIND_LABEL[p.lastValid.priceKind] ?? p.lastValid.priceKind}</span> <span className="small muted">visto {instant(p.lastValid.observedAt)}</span></p>
                    ) : <p className="muted">Sin precio válido observado.</p>}
                    <p className="small">{p.change ? <>Cambio frente a la observación comparable anterior ({instant(p.change.sinceObservedAt)}): <strong>{signedEuros(p.change.cents)}</strong>{p.change.pct != null && ` (${p.change.pct > 0 ? '+' : ''}${p.change.pct.toLocaleString('es-ES')} %)`}</> : 'Sin observación comparable anterior.'}</p>
                    <table className="data-table compact">
                      <caption className="visually-hidden">Estadísticas de precio de {o.hotelName}</caption>
                      <thead><tr><th scope="col">Periodo</th><th scope="col">Obs.</th><th scope="col">Mín.</th><th scope="col">Mediana</th><th scope="col">Máx.</th></tr></thead>
                      <tbody>{p.windows.map((w) => (
                        <tr key={w.days}><th scope="row">{w.days} días</th><td>{w.n}</td><td>{w.minCents != null ? euros(w.minCents) : '—'}</td><td>{w.medianCents != null ? euros(w.medianCents) : '—'}</td><td>{w.maxCents != null ? euros(w.maxCents) : '—'}</td></tr>
                      ))}</tbody>
                    </table>
                    {p.warnings.length > 0 && <ul className="warnings small">{p.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
                    <div className="cluster-s">
                      {o.url && <a className="small" href={o.url} target="_blank" rel="noopener noreferrer nofollow">Consultar en el proveedor<span className="visually-hidden"> (otra pestaña)</span></a>}
                      <button type="button" className="btn btn-small btn-secondary" disabled={busy !== null} onClick={() => void propose(s, o)}>Proponer como candidatura</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}

      <Dialog open={form !== null} title="Nueva búsqueda" size="wide" onClose={() => setForm(null)} busy={busy === 'create'}
        footer={<>
          <button type="button" className="btn btn-secondary" onClick={() => setForm(null)} disabled={busy === 'create'}>Cancelar</button>
          <button type="submit" form="sc-form" className="btn btn-primary" disabled={busy === 'create'}>{busy === 'create' ? 'Creando…' : 'Crear búsqueda'}</button>
        </>}>
        {form && (
          <form id="sc-form" className="form-grid" onSubmit={(e) => { e.preventDefault(); void create(); }} noValidate>
            <SelectField label="Proveedor" value={form.providerId} onChange={(e) => setForm({ ...form, providerId: e.target.value })}>
              <option value="esquiades">Esquiades</option><option value="estiber">Estiber</option>
            </SelectField>
            <SelectField label="Estación" value={form.areaId} onChange={(e) => setForm({ ...form, areaId: e.target.value })}>
              <option value="">Elige estación</option>
              {(catalog.data?.areas ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </SelectField>
            <SelectField label="Modalidad" value={form.modality} onChange={(e) => setForm({ ...form, modality: e.target.value })}>
              <option value="lodging">Solo alojamiento</option><option value="lodging_forfait">Alojamiento + forfait</option>
            </SelectField>
            {form.modality === 'lodging_forfait' && <Field label="Días de forfait" type="number" min={1} max={14} value={form.forfaitDays} onChange={(e) => setForm({ ...form, forfaitDays: e.target.value })} />}
            <Field label="Entrada" type="date" value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} hint="Entre hoy y 8 meses" />
            <Field label="Salida" type="date" value={form.checkOut} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} hint="1 a 14 noches" />
            <Field label="Adultos" type="number" min={1} max={30} value={form.adults} onChange={(e) => setForm({ ...form, adults: e.target.value })} />
            <Field label="Habitaciones" type="number" min={1} max={15} value={form.rooms} onChange={(e) => setForm({ ...form, rooms: e.target.value })} hint="Opcional" />
            <Field className="span-2" label="Edades de menores" value={form.children} onChange={(e) => setForm({ ...form, children: e.target.value })} hint="Separadas por comas, p. ej. 8, 12" />
          </form>
        )}
        {err && <p className="form-error" role="alert">{err}</p>}
      </Dialog>
      <ConfirmDialog open={removing !== null} title="¿Quitar esta búsqueda?" body={<p>El histórico de precios se conserva. Si ningún otro viaje la usa, deja de ejecutarse.</p>}
        confirmLabel="Quitar" busy={busy === 'rm'} onConfirm={() => void remove()} onClose={() => setRemoving(null)} />
    </div>
  );
}
