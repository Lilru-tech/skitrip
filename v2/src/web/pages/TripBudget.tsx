// Presupuesto honesto: cada parte es conocida, estimada a mano, pendiente o no aplicable. Solo se suman las conocidas;
// las estimaciones manuales se suman aparte y una cotización que no vale se muestra solo como referencia.
import { useState } from 'react';
import { ApiError, del, errorMessage, get, put } from '../api';
import { Dialog } from '../components/Dialog';
import { Field, SelectField } from '../components/Field';
import { ErrorState, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { TripShell } from '../components/TripTabs';
import { capitalize, centsToInput, euros, humanDates, kmText, parseEuros, plural } from '../format';
import type { Catalog } from '../catalog';
import { useResource } from '../hooks';
import { Link } from '../router';
import type { TripDetail } from '../types';
import type { BudgetComponent, BudgetResult } from '../../core/budget';

interface BudgetParams {
  version: number; fuel_cents_per_litre: number | null; litres_per_100km_x10: number | null; tolls_cents_per_car: number | null; parking_cents_per_car: number | null;
  forfait_cents_per_day: number | null; rental_cents_per_day: number | null; skiers: number | null; renters: number | null; groceries_cents: number | null; chosen_candidate_id: string | null;
}
interface DestinationCost {
  areaId: string; areaName: string; forfaitCentsPerDay: number | null; rentalCentsPerDay: number | null; tollsCentsPerCar: number | null; parkingCentsPerCar: number | null;
  kind: 'confirmed' | 'estimate'; sourceNote: string | null; checkedOn: string | null; version: number;
}
interface BudgetResponse { params: BudgetParams; destinationCosts: DestinationCost[]; result: BudgetResult; input: { people: number | null; nights: number | null; skiDays: number | null; cars: number | null; roadKmOneWay: number | null } }

const STATUS: Record<BudgetComponent['status'], { label: string; tone: string }> = {
  known: { label: 'Conocido', tone: 'tag-ok' }, estimated: { label: 'Estimación manual', tone: 'tag-estimate' },
  pending: { label: 'Pendiente', tone: 'tag-warn' }, not_applicable: { label: 'No aplica', tone: 'tag-quiet' },
};
const statusOf = (s: string) => STATUS[s as BudgetComponent['status']] ?? { label: s, tone: 'tag-quiet' };

function amountText(c: BudgetComponent) {
  if (c.status === 'known' && c.totalCents != null) return euros(c.totalCents);
  if (c.status === 'estimated' && c.totalCents != null) return `≈ ${euros(c.totalCents)}`;
  if (c.status === 'pending') return 'pendiente';
  return '—';
}

/** Comparación de la cotización con el viaje, en frases: qué no coincide y qué no se puede comprobar. */
function Comparison({ c }: { c: BudgetComponent }) {
  const cmp = c.comparison;
  const showRef = c.referenceCents != null && c.status !== 'known';
  if (!cmp && !showRef) return null;
  return (
    <div className="quote-check small">
      {showRef && (
        <p className="quote-ref"><span className="tag tag-quiet">Referencia</span> {euros(c.referenceCents!)} de la cotización guardada
          {c.status === 'estimated' ? ' (estimación, no se suma al total conocido).' : '. No se suma al total.'}</p>
      )}
      {cmp && cmp.status === 'compatible' && c.status === 'known' && <p className="text-ok">La cotización coincide con las condiciones del viaje.</p>}
      {cmp && cmp.issues.length > 0 && (
        <div><p><strong>No coincide con el viaje:</strong></p><ul>{cmp.issues.map((x) => <li key={x}>{capitalize(humanDates(x))}.</li>)}</ul></div>
      )}
      {cmp && cmp.unknown.length > 0 && (
        <p><strong>Sin comprobar:</strong> {cmp.unknown.join(', ')}.</p>
      )}
    </div>
  );
}

export function TripBudgetPage({ tripId }: { tripId: string }) {
  return <TripShell tripId={tripId} tab="presupuesto" title="Presupuesto">{(d) => <Budget tripId={tripId} detail={d} />}</TripShell>;
}

type Form = Record<'fuel' | 'litres' | 'tolls' | 'parking' | 'forfait' | 'rental' | 'skiers' | 'renters' | 'groceries' | 'candidate', string>;

function toForm(p: BudgetParams): Form {
  return {
    fuel: centsToInput(p.fuel_cents_per_litre), litres: p.litres_per_100km_x10 != null ? (p.litres_per_100km_x10 / 10).toString().replace('.', ',') : '',
    tolls: centsToInput(p.tolls_cents_per_car), parking: centsToInput(p.parking_cents_per_car), forfait: centsToInput(p.forfait_cents_per_day),
    rental: centsToInput(p.rental_cents_per_day), skiers: p.skiers?.toString() ?? '', renters: p.renters?.toString() ?? '', groceries: centsToInput(p.groceries_cents),
    candidate: p.chosen_candidate_id ?? '',
  };
}

function Budget({ tripId, detail }: { tripId: string; detail: TripDetail }) {
  const toast = useToast();
  const b = useResource(() => get<BudgetResponse>(`/api/trips/${tripId}/budget`), [tripId]);
  const cands = useResource(() => get<{ candidates: { id: string; title: string; area_id: string | null }[] }>(`/api/trips/${tripId}/candidates`), [tripId]);
  const [costsRev, setCostsRev] = useState(0);
  const [form, setForm] = useState<Form | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const canEdit = detail.trip.role !== 'member';

  if (b.loading && !b.data) return <Loading />;
  if (b.error && !b.data) return <ErrorState message={b.error} onRetry={b.reload} />;
  const { result, input, params } = b.data!;

  const save = async () => {
    if (!form) return;
    const money = (s: string, label: string) => { const v = parseEuros(s); if (Number.isNaN(v)) throw new Error(`${label}: importe no válido.`); return v; };
    const intv = (s: string, label: string) => { if (!s.trim()) return null; const n = Number(s); if (!Number.isInteger(n) || n < 0) throw new Error(`${label}: número entero no válido.`); return n; };
    let body: Record<string, unknown>;
    try {
      const litres = form.litres.trim() ? Number(form.litres.replace(',', '.')) : null;
      if (litres != null && (!Number.isFinite(litres) || litres < 1 || litres > 30)) throw new Error('Consumo: entre 1 y 30 l/100 km.');
      body = {
        version: params.version, fuelCentsPerLitre: money(form.fuel, 'Combustible'), litresPer100kmX10: litres == null ? null : Math.round(litres * 10),
        tollsCentsPerCar: money(form.tolls, 'Peajes'), parkingCentsPerCar: money(form.parking, 'Parking'), forfaitCentsPerDay: money(form.forfait, 'Forfait'),
        rentalCentsPerDay: money(form.rental, 'Alquiler'), skiers: intv(form.skiers, 'Esquiadores'), renters: intv(form.renters, 'Alquilan'),
        groceriesCents: money(form.groceries, 'Compra'), chosenCandidateId: form.candidate || null,
      };
    } catch (e) { setErr((e as Error).message); return; }
    setBusy(true); setErr(null);
    try {
      const r = await put<BudgetResponse>(`/api/trips/${tripId}/budget`, body);
      b.setData(r);
      setForm(null);
      toast.show('Presupuesto guardado.');
    } catch (e) {
      if (e instanceof ApiError && e.isConflict) setConflict(true);
      else setErr(errorMessage(e));
    } finally { setBusy(false); }
  };

  const reloadAfterConflict = async () => {
    await b.reload();
    setConflict(false);
    setErr('Se ha cargado la versión actual. Tus valores siguen en el formulario: revísalos y vuelve a guardar si procede.');
  };

  return (
    <div className="stack">
      <section className="panel stack" aria-labelledby="b-total">
        <h2 id="b-total">Resumen</h2>
        <div className="totals">
          <div><p className="muted small">Suma de lo conocido</p><p className="total-figure" data-testid="known-subtotal">{euros(result.knownSubtotalCents)}</p></div>
          {result.estimatedSubtotalCents > 0 && (
            <div><p className="muted small">Estimaciones manuales (aparte)</p><p className="total-figure total-estimate">≈ {euros(result.estimatedSubtotalCents)}</p>
              <p className="small muted">No son cotizaciones: no completan el presupuesto.</p></div>
          )}
          <div><p className="muted small">Por persona</p><p className="total-figure">{result.complete && result.perPersonCents != null ? euros(result.perPersonCents) : 'Incompleto'}</p>
            {!result.complete && result.knownPerPersonCents != null && <p className="small muted">Parcial, solo lo conocido: {euros(result.knownPerPersonCents)}</p>}</div>
        </div>
        {result.complete
          ? <p className="notice notice-ok">Todas las partes están calculadas.</p>
          : <p className="notice notice-warn" data-testid="budget-incomplete">
              {result.pending.length > 0 && <><strong>Pendiente:</strong> {result.pending.join(', ')}. No se suman como 0: el total real será mayor. </>}
              {result.estimatedSubtotalCents > 0 && <><strong>Con estimaciones manuales:</strong> el presupuesto no estará completo hasta tener cotizaciones válidas.</>}
            </p>}
        {result.warnings.length > 0 && <ul className="warnings">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        <p className="small muted">Datos del viaje usados: {input.people ?? 'sin'} personas · {input.nights ?? 'sin'} noches · {input.skiDays ?? 'sin'} días de esquí · {input.cars ?? 'sin'} coches · {input.roadKmOneWay != null ? `${input.roadKmOneWay} km por carretera (ida)` : 'sin distancia por carretera'}. Se cambian en <Link to={`/viajes/${tripId}`}>Editar viaje</Link>.</p>
      </section>

      <section className="panel stack" aria-labelledby="b-parts">
        <div className="toolbar"><h2 id="b-parts">Partes del presupuesto</h2>
          {canEdit && <button type="button" className="btn btn-secondary" onClick={() => { setForm(toForm(params)); setErr(null); setConflict(false); }}>Editar parámetros</button>}</div>
        <ul className="list" aria-label="Partes del presupuesto">
          {result.components.map((c) => (
            <li key={c.key} className="budget-row" data-component={c.key} data-status={c.status}>
              <div className="budget-row-head"><strong>{c.label}</strong> <span className={`tag ${statusOf(c.status).tone}`}>{statusOf(c.status).label}</span>
                <span className="budget-amount">{amountText(c)}</span></div>
              <p className="small muted">{humanDates(c.note)}</p>
              <Comparison c={c} />
            </li>
          ))}
        </ul>
      </section>

      <DestinationCosts tripId={tripId} canEdit={canEdit} tripAreaId={detail.trip.areaId ?? null} costs={b.data!.destinationCosts ?? []}
        candidateAreas={(cands.data?.candidates ?? []).map((c) => c.area_id).filter((x): x is string => !!x)}
        onSaved={(r) => { b.setData(r); setCostsRev((n) => n + 1); }} onRemoved={() => { void b.reload(); setCostsRev((n) => n + 1); }} />

      <CostComparison tripId={tripId} version={params.version * 1000 + costsRev} />

      <Dialog open={form !== null} title="Parámetros del presupuesto" size="wide" onClose={() => setForm(null)} busy={busy}
        footer={<>
          <button type="button" className="btn btn-secondary" onClick={() => setForm(null)} disabled={busy}>Cancelar</button>
          {conflict ? <button type="button" className="btn btn-primary" onClick={() => void reloadAfterConflict()}>Cargar la versión actual</button>
            : <button type="submit" form="budget-form" className="btn btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>}
        </>}>
        {conflict && <p className="notice notice-warn" role="alert"><strong>Otra persona ha cambiado el presupuesto.</strong> No se ha guardado nada. Carga la versión actual; tus valores se mantienen en el formulario.</p>}
        {form && (
          <form id="budget-form" className="form-grid" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
            <Field label="Combustible (€/litro)" inputMode="decimal" value={form.fuel} onChange={(e) => setForm({ ...form, fuel: e.target.value })} />
            <Field label="Consumo (l/100 km)" inputMode="decimal" value={form.litres} onChange={(e) => setForm({ ...form, litres: e.target.value })} />
            <Field label="Peajes por coche, ida y vuelta (€)" inputMode="decimal" value={form.tolls} onChange={(e) => setForm({ ...form, tolls: e.target.value })} />
            <Field label="Parking por coche, estancia (€)" inputMode="decimal" value={form.parking} onChange={(e) => setForm({ ...form, parking: e.target.value })} />
            <Field label="Forfait por día y persona (€)" inputMode="decimal" value={form.forfait} onChange={(e) => setForm({ ...form, forfait: e.target.value })} hint="Del destino del viaje. Otras estaciones: «Costes por estación»." />
            <Field label="Alquiler por día y persona (€)" inputMode="decimal" value={form.rental} onChange={(e) => setForm({ ...form, rental: e.target.value })} />
            <Field label="Esquiadores" type="number" min={0} value={form.skiers} onChange={(e) => setForm({ ...form, skiers: e.target.value })} hint="Vacío = todas las personas" />
            <Field label="Personas que alquilan" type="number" min={0} value={form.renters} onChange={(e) => setForm({ ...form, renters: e.target.value })} />
            <Field label="Compra (€)" inputMode="decimal" value={form.groceries} onChange={(e) => setForm({ ...form, groceries: e.target.value })} hint="Vacío = estimación de la lista si está completa" />
            <SelectField label="Alojamiento elegido" value={form.candidate} onChange={(e) => setForm({ ...form, candidate: e.target.value })}>
              <option value="">Ninguno</option>
              {(cands.data?.candidates ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </SelectField>
          </form>
        )}
        {err && <p className="form-error" role="alert">{err}</p>}
        <p className="small muted">{plural(detail.members.length, 'miembro', 'miembros')} en el viaje.</p>
      </Dialog>
    </div>
  );
}

interface CostRow {
  id: string; title: string; areaId: string | null; roadKm: number | null; roadValidated: boolean; rank: number | null; complete: boolean;
  perPersonCents: number | null; knownPerPersonCents: number | null; totalCents: number | null; knownSubtotalCents: number; pending: string[];
  lodging: { status: string; comparison: BudgetComponent['comparison'] | null; referenceCents: number | null } | null; warnings: string[];
  /** Calculado en el destino de la candidatura sin modificar el viaje. */
  hypothetical?: boolean;
}

function lodgingText(l: CostRow['lodging']) {
  if (!l) return 'sin alojamiento';
  if (l.status === 'known') return 'cotización válida para el viaje';
  if (l.status === 'estimated') return 'estimación manual (no es una cotización)';
  if (l.comparison?.status === 'incompatible') return `la cotización no coincide con el viaje: ${l.comparison.issues.map(humanDates).join('; ')}`;
  if (l.comparison?.status === 'incomplete') return `condiciones sin comprobar: ${l.comparison.unknown.join(', ')}`;
  if (l.referenceCents != null) return 'precio orientativo, no es una cotización';
  return 'sin precio';
}

/**
 * Coste completo por persona de cada candidatura con el resto del viaje. Solo los completos tienen posición; un
 * incompleto muestra lo que falta y lo conocido hasta ahora, nunca como el más barato.
 */
function CostComparison({ tripId, version }: { tripId: string; version: number }) {
  const r = useResource(() => get<{ options: CostRow[]; note: string }>(`/api/trips/${tripId}/cost-comparison`), [tripId, version]);
  const catalog = useResource(() => get<Catalog>('/api/public/catalog'), []);
  const areaName = (id: string | null) => (id ? catalog.data?.areas.find((a) => a.id === id)?.name ?? id : 'destino sin indicar');
  const rows = r.data?.options ?? [];
  const ranked = rows.filter((x) => x.rank != null).sort((a, b) => a.rank! - b.rank!);
  const incomplete = rows.filter((x) => x.rank == null);
  const facts = (o: CostRow) => (
    <p className="small muted">{areaName(o.areaId)} · {o.roadKm != null ? <>{kmText(o.roadKm)} por carretera{!o.roadValidated && ' (sin validar)'}</> : 'sin distancia por carretera'} · {lodgingText(o.lodging)}</p>
  );
  return (
    <section className="panel stack" aria-labelledby="cc-h">
      <h2 id="cc-h">Comparar coste por candidatura</h2>
      {r.loading && !r.data && <Loading label="Calculando…" />}
      {r.error && !r.data && <ErrorState message={r.error} onRetry={r.reload} />}
      {r.data && (rows.length === 0 ? <p className="muted">Añade candidaturas para comparar su coste completo por persona.</p> : (
        <>
          {ranked.length > 0 ? (
            <ol className="card-list" aria-label="Candidaturas completas por coste">
              {ranked.map((o) => (
                <li key={o.id} className="card cost-card" data-rank={o.rank}>
                  <div className="card-head"><h3><span className="rank">{o.rank}.</span> {o.title}</h3>{o.hypothetical && <span className="tag">hipotético</span>}<strong className="cost-figure">{euros(o.perPersonCents!)}/persona</strong></div>
                  <p className="small">Total {euros(o.totalCents!)} · completo</p>
                  {facts(o)}
                  {o.warnings.length > 0 && <ul className="warnings small">{o.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
                </li>
              ))}
            </ol>
          ) : <p className="notice notice-warn">Ninguna candidatura tiene todavía el presupuesto completo: no hay orden por coste.</p>}
          {incomplete.length > 0 && (
            <>
              <h3 className="h3">Sin posición: presupuesto incompleto</h3>
              <ul className="card-list" aria-label="Candidaturas con presupuesto incompleto">
                {incomplete.map((o) => (
                  <li key={o.id} className="card cost-card is-incomplete">
                    <div className="card-head"><h3>{o.title}</h3><span className="tag tag-warn">incompleto</span>{o.hypothetical && <span className="tag">hipotético</span>}</div>
                    <p className="small"><strong>Incompleto: falta {o.pending.length ? o.pending.join(', ') : 'confirmar partidas estimadas'}.</strong>{' '}
                      {o.knownPerPersonCents != null ? `Conocido hasta ahora: ${euros(o.knownPerPersonCents)}/persona` : `Conocido hasta ahora: ${euros(o.knownSubtotalCents)}`} (el total real será mayor).</p>
                    {facts(o)}
                    {o.warnings.length > 0 && <ul className="warnings small">{o.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="small muted">{r.data.note}</p>
        </>
      ))}
    </section>
  );
}

type CostForm = { forfait: string; rental: string; tolls: string; parking: string; kind: 'confirmed' | 'estimate'; source: string; checkedOn: string };

/**
 * Forfait, alquiler, peajes y parking por estación, con procedencia y fecha. Los del destino del viaje entran en su
 * presupuesto; los de otras estaciones sirven para comparar candidaturas allí. Nunca se usa el precio de otra estación.
 */
function DestinationCosts({ tripId, canEdit, tripAreaId, costs, candidateAreas, onSaved, onRemoved }: {
  tripId: string; canEdit: boolean; tripAreaId: string | null; costs: DestinationCost[]; candidateAreas: string[];
  onSaved: (r: BudgetResponse) => void; onRemoved: () => void;
}) {
  const toast = useToast();
  const catalog = useResource(() => get<Catalog>('/api/public/catalog'), []);
  const [edit, setEdit] = useState<{ areaId: string; version: number; form: CostForm } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = (id: string) => costs.find((c) => c.areaId === id)?.areaName ?? catalog.data?.areas.find((a) => a.id === id)?.name ?? id;
  const areas = [...new Set([...(tripAreaId ? [tripAreaId] : []), ...candidateAreas, ...costs.map((c) => c.areaId)])];
  const byArea = new Map(costs.map((c) => [c.areaId, c]));
  const value = (v: number | null, unit: string) => (v == null ? 'sin dato' : `${euros(v)} ${unit}`);

  const open = (areaId: string) => {
    const c = byArea.get(areaId);
    setErr(null);
    setEdit({ areaId, version: c?.version ?? 0, form: {
      forfait: centsToInput(c?.forfaitCentsPerDay ?? null), rental: centsToInput(c?.rentalCentsPerDay ?? null), tolls: centsToInput(c?.tollsCentsPerCar ?? null),
      parking: centsToInput(c?.parkingCentsPerCar ?? null), kind: c?.kind ?? 'confirmed', source: c?.sourceNote ?? '', checkedOn: c?.checkedOn ?? '' } });
  };
  const save = async () => {
    if (!edit) return;
    const f = edit.form;
    const money = (s: string, label: string) => { const v = parseEuros(s); if (Number.isNaN(v)) throw new Error(`${label}: importe no válido.`); return v; };
    let body: Record<string, unknown>;
    try {
      if (f.checkedOn && !/^\d{4}-\d{2}-\d{2}$/.test(f.checkedOn)) throw new Error('Fecha: usa el selector de fecha.');
      body = { version: edit.version, forfaitCentsPerDay: money(f.forfait, 'Forfait'), rentalCentsPerDay: money(f.rental, 'Alquiler'), tollsCentsPerCar: money(f.tolls, 'Peajes'),
        parkingCentsPerCar: money(f.parking, 'Parking'), kind: f.kind, sourceNote: f.source.trim() || null, checkedOn: f.checkedOn || null };
    } catch (e) { setErr((e as Error).message); return; }
    setBusy(true); setErr(null);
    try {
      onSaved(await put<BudgetResponse>(`/api/trips/${tripId}/destination-costs/${encodeURIComponent(edit.areaId)}`, body));
      setEdit(null);
      toast.show('Costes de la estación guardados.');
    } catch (e) { setErr(e instanceof ApiError && e.isConflict ? 'Otra persona cambió estos costes. Cierra y vuelve a abrir para ver la versión actual.' : errorMessage(e)); }
    finally { setBusy(false); }
  };
  const remove = async (areaId: string) => {
    try { await del(`/api/trips/${tripId}/destination-costs/${encodeURIComponent(areaId)}`); onRemoved(); toast.show('Costes de la estación quitados.'); }
    catch (e) { toast.show(errorMessage(e), 'error'); }
  };

  return (
    <section className="panel stack" aria-labelledby="dc-h">
      <h2 id="dc-h">Costes por estación</h2>
      <p className="small muted">Forfait, alquiler, peajes y parking dependen de la estación. Los del destino del viaje entran en el presupuesto; los de otras estaciones sirven para comparar candidaturas allí. Sin dato = pendiente, nunca 0.</p>
      {areas.length === 0 ? <p className="muted">Indica el destino del viaje o añade candidaturas con estación.</p> : (
        <ul className="card-list" aria-label="Costes por estación">
          {areas.map((id) => {
            const c = byArea.get(id);
            return (
              <li key={id} className="card stack-s" data-area={id}>
                <div className="card-head"><h3>{name(id)}</h3>
                  {id === tripAreaId && <span className="tag">destino del viaje</span>}
                  {c && <span className={`tag ${c.kind === 'estimate' ? 'tag-estimate' : 'tag-ok'}`}>{c.kind === 'estimate' ? 'estimación' : 'confirmado'}</span>}</div>
                {c ? (
                  <>
                    <p className="small">Forfait {value(c.forfaitCentsPerDay, 'por día y persona')} · Alquiler {value(c.rentalCentsPerDay, 'por día y persona')} · Peajes {value(c.tollsCentsPerCar, 'por coche')} · Parking {value(c.parkingCentsPerCar, 'por coche')}</p>
                    <p className="small muted">{c.sourceNote ?? 'Sin fuente'}{c.checkedOn ? ` · ${c.checkedOn.split('-').reverse().join('/')}` : ''}</p>
                  </>
                ) : <p className="small muted">{id === tripAreaId ? 'Sin costes propios: se usan los parámetros comunes del viaje.' : 'Sin costes: en la comparación quedan pendientes.'}</p>}
                {canEdit && <div className="toolbar">
                  <button type="button" className="btn btn-secondary btn-small" onClick={() => open(id)}>{c ? 'Editar' : 'Añadir costes'}<span className="visually-hidden"> de {name(id)}</span></button>
                  {c && <button type="button" className="btn btn-link" onClick={() => void remove(id)}>Quitar<span className="visually-hidden"> costes de {name(id)}</span></button>}
                </div>}
              </li>
            );
          })}
        </ul>
      )}
      <Dialog open={edit !== null} title={edit ? `Costes de ${name(edit.areaId)}` : ''} onClose={() => setEdit(null)} busy={busy}
        footer={<>
          <button type="button" className="btn btn-secondary" onClick={() => setEdit(null)} disabled={busy}>Cancelar</button>
          <button type="submit" form="dc-form" className="btn btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </>}>
        {edit && (
          <form id="dc-form" className="form-grid" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <Field label="Forfait por día y persona (€)" inputMode="decimal" value={edit.form.forfait} onChange={(e) => setEdit({ ...edit, form: { ...edit.form, forfait: e.target.value } })} />
            <Field label="Alquiler por día y persona (€)" inputMode="decimal" value={edit.form.rental} onChange={(e) => setEdit({ ...edit, form: { ...edit.form, rental: e.target.value } })} />
            <Field label="Peajes por coche, ida y vuelta (€)" inputMode="decimal" value={edit.form.tolls} onChange={(e) => setEdit({ ...edit, form: { ...edit.form, tolls: e.target.value } })} />
            <Field label="Parking por coche, estancia (€)" inputMode="decimal" value={edit.form.parking} onChange={(e) => setEdit({ ...edit, form: { ...edit.form, parking: e.target.value } })} />
            <SelectField label="Tipo de importe" value={edit.form.kind} onChange={(e) => setEdit({ ...edit, form: { ...edit.form, kind: e.target.value as CostForm['kind'] } })}>
              <option value="confirmed">Precio confirmado</option>
              <option value="estimate">Estimación (no completa el presupuesto)</option>
            </SelectField>
            <Field label="Fecha de consulta" type="date" value={edit.form.checkedOn} onChange={(e) => setEdit({ ...edit, form: { ...edit.form, checkedOn: e.target.value } })} />
            <Field className="span-2" label="Fuente" maxLength={300} value={edit.form.source} onChange={(e) => setEdit({ ...edit, form: { ...edit.form, source: e.target.value } })} hint="P. ej. «web oficial, tarifa adulto 2 días»" />
          </form>
        )}
        {err && <p className="form-error" role="alert">{err}</p>}
      </Dialog>
    </section>
  );
}
