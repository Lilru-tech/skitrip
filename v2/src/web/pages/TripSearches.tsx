// Búsquedas por fechas (escenarios) y su panel de ofertas. «No observada» no es «agotada».
// Antes de crear una búsqueda se muestra la capacidad REAL del proveedor y la modalidad (src/core/capabilities.ts):
// no hay búsqueda automática por fechas (el robots.txt de ambos proveedores prohíbe su buscador): se consulta a mano y se guarda la cotización.
import { useState } from 'react';
import { del, errorMessage, get, post } from '../api';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { Field, SelectField } from '../components/Field';
import { Empty, ErrorState, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { TripShell } from '../components/TripTabs';
import { AVAILABILITY_LABEL, agesText, euros, humanDates, instant, MODALITY_LABEL, parseAges, PRICE_KIND_LABEL, signedEuros, UNIT_LABEL } from '../format';
import { CandidateDialog, candidateFormFor } from './TripCandidates';
import { useResource } from '../hooks';
import type { Catalog } from '../catalog';
import type { TripDetail } from '../types';
import type { OfferPanel } from '../../core/analytics';
import type { CapabilityState, ProviderCapability } from '../../core/capabilities';

interface ScenarioOffer { offerId: string; hotelName: string | null; board: string | null; cancellation: string | null; nights: number | null; forfaitDays: number | null; adults: number | null; url: string | null; availability: string; panel: OfferPanel }
interface Scenario {
  id: string; providerId: string; areaId: string; modality: string; checkIn: string; checkOut: string; nights: number; adults: number; childrenAges: number[]; rooms: number | null; forfaitDays: number | null;
  active: boolean; lastRun: { observed_at: number; outcome: string; offers_found: number; error: string | null } | null; offers: ScenarioOffer[];
  distribution: { groups: DistGroup[]; mixedUnits: boolean };
}
interface DistGroup { unit: string; priceKind: string; n: number; minCents: number | null; medianCents: number | null; maxCents: number | null; compositionChanged: boolean; added: string[]; removed: string[] }
type CreateResponse = { scenarioId: string; reused: boolean; dateSearch: 'automatic' | 'not_implemented'; note: string | null };

/** Enlaces públicos de los proveedores para consultar a mano (sin integración). */
const PROVIDER_URL: Record<string, string> = { esquiades: 'https://www.esquiades.com/', estiber: 'https://www.estiber.com/' };
const PROVIDER_LABEL: Record<string, string> = { esquiades: 'Esquiades', estiber: 'Estiber' };
const STATE_LABEL: Record<CapabilityState, string> = {
  implemented_verified: 'Disponible (verificada)', implemented_unverified: 'Disponible, sin verificar todavía', not_implemented: 'No implementada', available: 'Disponible',
};
const isOn = (s: CapabilityState) => s === 'implemented_verified' || s === 'implemented_unverified' || s === 'available';
const OUTCOME: Record<string, string> = {
  results: 'con resultados', empty: 'sin resultados para esas fechas', error: 'no se pudo completar la búsqueda', blocked: 'no se pudo completar la búsqueda (acceso rechazado)',
  unsupported: 'sin búsqueda automática por fechas implementada',
};

/** Capacidad real del proveedor y la modalidad elegidos, mostrada ANTES de crear la búsqueda. */
function CapabilityPanel({ cap, providerId, onManual }: { cap: ProviderCapability | undefined; providerId: string; onManual: () => void }) {
  if (!cap) return <p className="notice" role="status">No hay información de capacidades para este proveedor y modalidad.</p>;
  const auto = isOn(cap.dateSearch);
  return (
    <section className={`notice ${auto ? 'notice-ok' : 'notice-warn'} capability stack-s span-2`} aria-label="Qué puede hacer la aplicación con este proveedor" data-testid="capability">
      <p><strong>{cap.label} · {MODALITY_LABEL[cap.modality]}</strong></p>
      <dl className="capability-facts">
        <div><dt>Búsqueda automática por fechas</dt><dd>{STATE_LABEL[cap.dateSearch]}</dd></div>
        <div><dt>Precios de catálogo</dt><dd>{isOn(cap.catalogPrices) ? `${STATE_LABEL[cap.catalogPrices]} · orientativos («desde»), no son para vuestras fechas` : STATE_LABEL[cap.catalogPrices]}</dd></div>
        <div><dt>Cotización manual</dt><dd>{STATE_LABEL[cap.manualQuote]}</dd></div>
      </dl>
      <p>{cap.note}</p>
      {!auto && (
        <div className="cluster-s">
          {PROVIDER_URL[providerId] && <a className="btn btn-small btn-secondary" href={PROVIDER_URL[providerId]} target="_blank" rel="noopener noreferrer nofollow">Consultar en {PROVIDER_LABEL[providerId] ?? providerId}<span className="visually-hidden"> (otra pestaña)</span></a>}
          <button type="button" className="btn btn-small btn-primary" onClick={onManual}>Guardar cotización manual</button>
        </div>
      )}
    </section>
  );
}
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
  const caps = useResource(() => get<{ capabilities: ProviderCapability[] }>('/api/public/capabilities'), []);
  const [manual, setManual] = useState<ReturnType<typeof candidateFormFor> | null>(null);
  const [lastCreated, setLastCreated] = useState<(CreateResponse & { providerId: string }) | null>(null);
  const capFor = (provider: string, modality: string) => caps.data?.capabilities.find((c) => c.provider === provider && c.modality === modality);
  const noAutoAnywhere = !!caps.data && !caps.data.capabilities.some((c) => c.provider !== 'manual' && isOn(c.dateSearch));

  /** Abre la cotización manual con las condiciones de la búsqueda (o del viaje si no hay formulario). */
  const openManual = (f: Record<string, string> | null) => {
    const ages = f ? parseAges(f.children) ?? [] : detail.trip.childrenAges ?? [];
    setManual(candidateFormFor(detail, f ? {
      title: `${PROVIDER_LABEL[f.providerId] ?? f.providerId}${f.areaId ? ` · ${areaName(f.areaId)}` : ''}`, modality: f.modality, url: PROVIDER_URL[f.providerId] ?? '',
      areaId: f.areaId, checkIn: f.checkIn, checkOut: f.checkOut, adults: f.adults, children: ages.join(', '), rooms: f.rooms,
      forfaitIncluded: f.modality === 'lodging_forfait' ? 'yes' : 'no', forfaitDays: f.forfaitDays,
    } : {}));
    setForm(null);
  };
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
      const res = await post<CreateResponse>(`/api/trips/${tripId}/scenarios`, {
        providerId: form.providerId, areaId: form.areaId, modality: form.modality, checkIn: form.checkIn, checkOut: form.checkOut, adults: Number(form.adults) || 1,
        childrenAges: ages, rooms: form.rooms ? Number(form.rooms) : null, forfaitDays: form.modality === 'lodging_forfait' ? Number(form.forfaitDays) || null : null,
      });
      const providerId = form.providerId;
      setForm(null);
      setLastCreated({ ...res, providerId });
      toast.show(res.dateSearch === 'automatic'
        ? (res.reused ? 'Búsqueda añadida (ya existía y se comparte con otros viajes).' : 'Búsqueda creada.')
        : 'Búsqueda guardada, sin ejecución automática.');
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
        <div className="cluster-s">
          <button type="button" className="btn btn-secondary" onClick={() => openManual(null)}>Guardar cotización manual</button>
          {canEdit && <button type="button" className="btn btn-primary" disabled={list.length >= MAX} onClick={() => {
            setErr(null);
            const kids = detail.trip.childrenAges ?? [];
            const people = detail.trip.participantsPlanned ?? detail.members.length;
            setForm({ providerId: 'esquiades', areaId: detail.trip.areaId ?? '', modality: 'lodging', checkIn: detail.trip.startDate ?? '', checkOut: detail.trip.endDate ?? '',
              adults: String(Math.max(1, people - kids.length)), rooms: detail.trip.rooms?.toString() ?? '', forfaitDays: '', children: kids.join(', ') });
          }}>Nueva búsqueda</button>}
        </div>
      </div>
      {noAutoAnywhere && (
        <p className="notice notice-warn" data-testid="no-auto-search"><strong>Hoy no hay búsqueda automática por fechas en ningún proveedor.</strong> Una búsqueda guardada no se ejecuta sola: consulta en la web del proveedor y guarda la cotización a mano con sus condiciones exactas.</p>
      )}
      {lastCreated && lastCreated.dateSearch === 'not_implemented' && (
        <div className="notice notice-warn stack-s" role="status" data-testid="created-note">
          <p><strong>Búsqueda guardada, pero no se ejecutará automáticamente.</strong> {lastCreated.note}</p>
          <div className="cluster-s">
            {PROVIDER_URL[lastCreated.providerId] && <a className="btn btn-small btn-secondary" href={PROVIDER_URL[lastCreated.providerId]} target="_blank" rel="noopener noreferrer nofollow">Consultar en {PROVIDER_LABEL[lastCreated.providerId]}<span className="visually-hidden"> (otra pestaña)</span></a>}
            <button type="button" className="btn btn-small btn-primary" onClick={() => openManual(null)}>Guardar cotización manual</button>
          </div>
        </div>
      )}
      {list.length === 0 ? <Empty title="Sin búsquedas"><p>Guarda las fechas y personas concretas que queréis consultar. Los precios para esas condiciones se añaden como cotización manual.</p></Empty> : list.map((s) => (
        <section key={s.id} className="panel stack" aria-label={`Búsqueda ${areaName(s.areaId)} ${s.checkIn}`}>
          <div className="toolbar">
            <h2>{areaName(s.areaId)} · {humanDates(s.checkIn)} → {humanDates(s.checkOut)}</h2>
            {canEdit && <button type="button" className="btn btn-small btn-ghost" onClick={() => setRemoving(s)}>Quitar<span className="visually-hidden"> búsqueda</span></button>}
          </div>
          <p className="small">{PROVIDER_LABEL[s.providerId] ?? s.providerId} · {MODALITY_LABEL[s.modality]} · {s.nights} noches · {s.adults} adultos{s.childrenAges.length > 0 && ` · menores de ${agesText(s.childrenAges)}`}{s.rooms != null && ` · ${s.rooms} hab.`}{s.forfaitDays != null && ` · ${s.forfaitDays} días de forfait`}</p>
          <p className="small">{s.lastRun ? <>Última búsqueda {instant(s.lastRun.observed_at)}: <strong className={s.lastRun.outcome === 'results' ? '' : 'text-bad'}>{OUTCOME[s.lastRun.outcome] ?? s.lastRun.outcome}</strong>{s.lastRun.error && ` (${s.lastRun.error})`}</>
            : capFor(s.providerId, s.modality) && !isOn(capFor(s.providerId, s.modality)!.dateSearch) ? 'Sin ejecuciones: este proveedor no permite automatizar la búsqueda por fechas (lo prohíbe su robots.txt). Guarda la cotización a mano.' : 'Sin ejecuciones todavía.'}</p>
          <Distribution d={s.distribution} />
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
          {form && capFor(form.providerId, form.modality) && !isOn(capFor(form.providerId, form.modality)!.dateSearch)
            ? <button type="submit" form="sc-form" className="btn btn-secondary" disabled={busy === 'create'}>{busy === 'create' ? 'Guardando…' : 'Guardar búsqueda sin ejecución'}</button>
            : <button type="submit" form="sc-form" className="btn btn-primary" disabled={busy === 'create' || !caps.data}>{busy === 'create' ? 'Creando…' : 'Crear búsqueda'}</button>}
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
            {caps.loading && !caps.data ? <p className="span-2 small muted" role="status">Comprobando qué permite este proveedor…</p>
              : caps.error && !caps.data ? <p className="span-2 notice notice-warn" role="alert">No se han podido cargar las capacidades del proveedor. <button type="button" className="btn btn-small btn-secondary" onClick={() => void caps.reload()}>Reintentar</button></p>
              : <CapabilityPanel cap={capFor(form.providerId, form.modality)} providerId={form.providerId} onManual={() => openManual(form)} />}
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
      <CandidateDialog tripId={tripId} initial={manual} title="Guardar cotización manual" onClose={() => setManual(null)}
        onSaved={() => { setManual(null); setLastCreated(null); }} />
      <ConfirmDialog open={removing !== null} title="¿Quitar esta búsqueda?" body={<p>El histórico de precios se conserva.</p>}
        confirmLabel="Quitar" busy={busy === 'rm'} onConfirm={() => void remove()} onClose={() => setRemoving(null)} />
    </div>
  );
}

/** Distribución de la última búsqueda: una fila por unidad y tipo de precio, nunca una mediana conjunta. */
function Distribution({ d }: { d: Scenario['distribution'] }) {
  const groups = (d?.groups ?? []).filter((g) => g.n > 0);
  if (!groups.length) return null;
  return (
    <div className="stack-s">
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Precios en la última búsqueda">
        <table className="data-table compact">
          <caption className="visually-hidden">Precios en la última búsqueda por unidad y tipo de precio</caption>
          <thead><tr><th scope="col">Unidad y tipo</th><th scope="col">Ofertas</th><th scope="col">Mín.</th><th scope="col">Mediana</th><th scope="col">Máx.</th></tr></thead>
          <tbody>{groups.map((g) => (
            <tr key={`${g.unit}|${g.priceKind}`}>
              <th scope="row">{UNIT_LABEL[g.unit] ?? g.unit}<br /><span className="small muted">{PRICE_KIND_LABEL[g.priceKind] ?? g.priceKind}</span></th>
              <td>{g.n}</td><td>{g.minCents != null ? euros(g.minCents) : '—'}</td><td>{g.medianCents != null ? euros(g.medianCents) : '—'}</td><td>{g.maxCents != null ? euros(g.maxCents) : '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {d.mixedUnits && <p className="small muted">Hay precios en unidades distintas (por persona, por habitación, por estancia…): cada fila se resume por separado y no se comparan entre sí.</p>}
      {groups.some((g) => g.compositionChanged) && <p className="small muted">Las ofertas encontradas no son las mismas que en la búsqueda anterior: una bajada del mínimo no implica que un alojamiento haya bajado.</p>}
    </div>
  );
}
