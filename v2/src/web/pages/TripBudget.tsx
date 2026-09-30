// Presupuesto honesto: cada parte es conocida, estimada a mano, pendiente o no aplicable. Solo se suman las conocidas;
// las estimaciones manuales se suman aparte y una cotización que no vale se muestra solo como referencia.
import { useState } from 'react';
import { ApiError, errorMessage, get, put } from '../api';
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
interface BudgetResponse { params: BudgetParams; result: BudgetResult; input: { people: number | null; nights: number | null; skiDays: number | null; cars: number | null; roadKmOneWay: number | null } }

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
  const cands = useResource(() => get<{ candidates: { id: string; title: string }[] }>(`/api/trips/${tripId}/candidates`), [tripId]);
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

      <CostComparison tripId={tripId} version={params.version} />

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
            <Field label="Forfait por día y persona (€)" inputMode="decimal" value={form.forfait} onChange={(e) => setForm({ ...form, forfait: e.target.value })} />
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
                  <div className="card-head"><h3><span className="rank">{o.rank}.</span> {o.title}</h3><strong className="cost-figure">{euros(o.perPersonCents!)}/persona</strong></div>
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
                    <div className="card-head"><h3>{o.title}</h3><span className="tag tag-warn">incompleto</span></div>
                    <p className="small"><strong>Incompleto: falta {o.pending.length ? o.pending.join(', ') : 'confirmar partidas estimadas'}.</strong>{' '}
                      {o.knownPerPersonCents != null ? `Conocido hasta ahora: ${euros(o.knownPerPersonCents)}/persona` : `Conocido hasta ahora: ${euros(o.knownSubtotalCents)}`} (el total real será mayor).</p>
                    {facts(o)}
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
