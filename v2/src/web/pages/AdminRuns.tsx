// Administración › Pistas: aportaciones manuales al total y a los colores del catálogo de pistas. Solo eso: no cambia
// el parte diario (abiertas, apertura, nieve, km), ni rutas, precios o cierres. Antes de guardar se ve lo que verá el
// usuario, si puntuará y si la aportación no se aplicará porque prevalece el catálogo importado. El servidor repite la
// validación y los permisos; el historial y el motivo solo se ven aquí.
import { useMemo, useState, type FormEvent } from 'react';
import { errorMessage, get, post, put, ApiError } from '../api';
import { ConfirmDialog } from '../components/Dialog';
import { Empty, ErrorState, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { CatalogRunsText, RunsProvenance } from '../components/Runs';
import { instant, numDate, plural } from '../format';
import { useResource } from '../hooks';
import { Link, setQuery, useLocation } from '../router';
import { entryCatalogRuns, runCatalogView, RUN_CATALOG_ISSUE_LABEL, type RunCatalogEntry, type RunCatalogIssue } from '../../core/runs';
import {
  importedNeedsResolution, MANUAL_NOTE_LABEL, MANUAL_STATE_LABEL, MIN_RESOLUTION, resolveRunCatalog, RUN_FIELD_LABEL, RUN_FIELDS, validateManualDraft,
  type ManualDraft, type ManualRunContribution, type ResolvedRuns, type RunField,
} from '../../core/runs-manual';
import type { RunCatalog } from '../catalog';

interface Contribution extends ManualRunContribution { reason: string; createdAt: number; updatedAt: number; updatedByAlias: string | null }
interface AdminRunArea {
  id: string; name: string; kind: string; parentId: string | null;
  imported: RunCatalogEntry | null; contribution: Contribution | null; resolved: ResolvedRuns; history: { count: number; lastAt: number | null };
}
interface AdminRuns { today: string; areas: AdminRunArea[] }
interface HistoryRow { id: number; action: string; at: number; actor: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null; sourceRef: string | null; reason: string | null; version: number | null }

type Filter = 'todas' | 'faltan' | 'revisar' | 'manuales';
const FILTER_LABEL: Record<Filter, string> = { todas: 'Todas', faltan: 'Faltan datos', revisar: 'Datos por revisar', manuales: 'Con aportaciones manuales' };
const ORIGIN_LABEL = { catalog: 'Catálogo importado', manual: 'Aportación manual', mixed: 'Catálogo importado + aportación manual' } as const;
const ACTION_LABEL: Record<string, string> = { create: 'Aportación creada', update: 'Aportación editada', withdraw: 'Aportación retirada', restore: 'Aportación restaurada', import_change: 'Cambio en el catálogo importado' };
const REVIEW_ISSUES = new Set<RunCatalogIssue>(['no_entero', 'desglose_no_cuadra', 'desglose_supera_total', 'no_comparable']);
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** RunCatalog público a partir de la resolución (lo mismo que sirve el Worker). */
const toPublic = (r: ResolvedRuns): RunCatalog | null => (r.entry ? { ...r.entry } : null);
const flagsOf = (a: AdminRunArea) => {
  const v = runCatalogView(a.resolved.entry);
  return {
    faltan: !v || v.total == null || !v.breakdownComplete,
    revisar: !!v?.issues.some((i) => REVIEW_ISSUES.has(i)) || a.resolved.state === 'not_applied' || a.resolved.state === 'partial',
    manuales: a.contribution != null,
  };
};

export function RunsAdmin() {
  const { query } = useLocation();
  const r = useResource(() => get<AdminRuns>('/api/admin/runs'), []);
  const areaId = query.get('area');
  if (r.loading && !r.data) return <section className="panel"><Loading label="Cargando pistas…" /></section>;
  if (r.error && !r.data) return <section className="panel"><ErrorState message={r.error} onRetry={r.reload} /></section>;
  const data = r.data!;
  const area = areaId ? data.areas.find((a) => a.id === areaId) : null;
  if (areaId && area) return <RunEditor key={`${area.id}:${area.contribution?.version ?? 0}`} area={area} all={data.areas} today={data.today} onSaved={() => void r.reload()} />;
  return <RunsList data={data} missing={areaId} />;
}

function RunsList({ data, missing }: { data: AdminRuns; missing: string | null }) {
  const { query } = useLocation();
  const [text, setText] = useState(query.get('q') ?? '');
  const filter = (query.get('filtro') as Filter | null) ?? 'todas';
  const names = useMemo(() => new Map(data.areas.map((a) => [a.id, a.name])), [data.areas]);
  const rows = data.areas.map((a) => ({ a, f: flagsOf(a) }));
  const counts = { todas: rows.length, faltan: rows.filter((x) => x.f.faltan).length, revisar: rows.filter((x) => x.f.revisar).length, manuales: rows.filter((x) => x.f.manuales).length };
  const q = norm(text.trim());
  const shown = rows.filter(({ a, f }) => (filter === 'todas' || f[filter]) && (!q || norm(a.name).includes(q) || norm(a.id).includes(q) || (a.parentId && norm(names.get(a.parentId) ?? '').includes(q))));
  return (
    <section className="panel stack" aria-labelledby="adm-runs-h">
      <h2 id="adm-runs-h">Pistas</h2>
      <p className="small">Total de pistas y colores del catálogo, para planificar. Una aportación manual completa o sustituye el catálogo importado según la prioridad de abajo; no cambia las pistas abiertas del parte, la apertura, la nieve ni los kilómetros.</p>
      <details className="small">
        <summary>Cómo se decide qué cifra vale</summary>
        <ul>
          <li>Si el catálogo importado tiene una cifra válida de la misma temporada que tu aportación, prevalece. Tu aportación solo completa lo que falta, si cuadra.</li>
          <li>Si el catálogo importado no tiene cifra, no es fiable, es de una temporada anterior o no indica temporada frente a tu aportación documentada de la temporada actual, tu aportación lo sustituye entera, sin mezclar fuentes.</li>
          <li>Si no consta que las dos sean de la misma temporada (en otro caso), prevalece el importado y no se mezclan sus cifras. La temporada no se deduce de la fecha del documento.</li>
          <li>Las aportaciones que no se aplican se conservan con su historial. Si llega un dato automático válido, prevalece el automático.</li>
        </ul>
      </details>
      {missing && <p className="notice notice-warn" role="alert">No existe la estación «{missing}». <Link to="/admin?seccion=pistas">Ver todas</Link></p>}
      <div className="filters">
        <div className="field field-inline">
          <label htmlFor="runs-q">Buscar estación o dominio</label>
          <input id="runs-q" type="search" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        </div>
        <fieldset className="radio-group">
          <legend>Mostrar</legend>
          {(Object.keys(FILTER_LABEL) as Filter[]).map((k) => (
            <label key={k} className="radio"><input type="radio" name="runs-filter" checked={filter === k} onChange={() => setQuery('filtro', k === 'todas' ? null : k)} /> {FILTER_LABEL[k]} <span className="muted">({counts[k]})</span></label>
          ))}
        </fieldset>
      </div>
      <p className="small muted" role="status">{plural(shown.length, 'estación o dominio', 'estaciones o dominios')}</p>
      {shown.length === 0 ? <Empty title="Ninguna estación con esos criterios" /> : (
        <ul className="card-list" aria-label="Estaciones y dominios">
          {shown.map(({ a, f }) => {
            const e = a.resolved.entry;
            const v = runCatalogView(e);
            return (
              <li key={a.id} className="card run-admin-card">
                <div className="card-head">
                  <h3>{a.name}</h3>
                  <span className="muted small">{a.kind === 'domain' ? 'Dominio' : a.parentId ? `Estación de ${names.get(a.parentId) ?? a.parentId}` : 'Estación'}</span>
                </div>
                <p>{v?.total != null ? plural(v.total, 'pista', 'pistas') : 'Sin total'}{v && Object.values(v.byColour).some((n) => n != null) && <span className="muted"> · {RUN_FIELDS.slice(1).map((c) => `${v.byColour[c as Exclude<RunField, 'total'>] ?? '–'} ${RUN_FIELD_LABEL[c]}`).join(' · ')}</span>}</p>
                <p className="row-wrap small">
                  {e && <span className="tag tag-quiet">{ORIGIN_LABEL[e.origin]}</span>}
                  {f.faltan && <span className="tag tag-warn">Faltan datos</span>}
                  {f.revisar && <span className="tag tag-warn">Por revisar</span>}
                  {a.contribution && <span className={`tag ${a.resolved.state === 'applied' ? 'tag-ok' : 'tag-quiet'}`}>{MANUAL_STATE_LABEL[a.resolved.state]}</span>}
                </p>
                <Link className="btn btn-secondary btn-small" to={`/admin?seccion=pistas&area=${encodeURIComponent(a.id)}`}>Editar pistas<span className="visually-hidden"> de {a.name}</span></Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

type FormState = Record<RunField, string> & { comparable: boolean; resolution: string; season: string; sourceDate: string; sourceRef: string; reason: string };
const fromContribution = (c: Contribution | null): FormState => ({
  total: c?.total?.toString() ?? '', green: c?.green?.toString() ?? '', blue: c?.blue?.toString() ?? '', red: c?.red?.toString() ?? '', black: c?.black?.toString() ?? '',
  comparable: c?.comparable ?? true, resolution: c?.resolution ?? '', season: c?.season ?? '', sourceDate: c?.sourceDate ?? '', sourceRef: c?.sourceRef ?? '', reason: '',
});
/** '' = sin dato; un entero se guarda tal cual; cualquier otra cosa no es válida (NaN, lo rechaza la validación). */
const parseCount = (s: string) => (s.trim() === '' ? null : /^\d+$/.test(s.trim()) ? Number(s.trim()) : Number.NaN);
const toDraft = (f: FormState): ManualDraft => ({
  ...Object.fromEntries(RUN_FIELDS.map((k) => [k, parseCount(f[k])])) as Record<RunField, number | null>,
  comparable: f.comparable, resolution: f.resolution.trim() || null, season: f.season.trim() || null, sourceDate: f.sourceDate || null, sourceRef: f.sourceRef.trim(), reason: f.reason.trim(),
});

function RunEditor({ area, all, today, onSaved }: { area: AdminRunArea; all: AdminRunArea[]; today: string; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<FormState>(() => fromContribution(area.contribution));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; conflict: boolean } | null>(null);
  const [action, setAction] = useState<'withdraw' | 'restore' | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const draft = toDraft(form);
  const errors = validateManualDraft(draft, { imported: area.imported, today });
  const needsResolution = importedNeedsResolution(area.imported);
  const preview = resolveRunCatalog(area.imported, { ...draft, areaId: area.id, enteredOn: today, status: 'active', version: area.contribution?.version ?? 0 }, today);
  const c = area.contribution;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (errors.length) return;
    setBusy(true); setError(null);
    try {
      await put(`/api/admin/runs/${encodeURIComponent(area.id)}`, { ...draft, expectedVersion: c?.version ?? null });
      toast.show(`Pistas de ${area.name} guardadas.`);
      onSaved();
    } catch (err) {
      setError({ text: errorMessage(err), conflict: err instanceof ApiError && err.status === 409 });
    } finally { setBusy(false); }
  };

  return (
    <section className="panel stack" aria-labelledby="run-ed-h">
      <p className="breadcrumb"><Link to="/admin?seccion=pistas">Pistas</Link></p>
      <h2 id="run-ed-h">Pistas de {area.name}</h2>
      <p className="small muted">Solo el total y los colores del catálogo, para planificar. No cambia las pistas abiertas del parte, la apertura, la nieve ni los kilómetros.</p>

      <CurrentValues area={area} />

      <form className="stack" onSubmit={(e) => void save(e)} noValidate aria-describedby="run-ed-rules">
        <h3>{c ? 'Editar la aportación manual' : 'Nueva aportación manual'}</h3>
        <p id="run-ed-rules" className="small">Vacío = sin dato. 0 = cero confirmado. No rellenes los colores que no conoces y no deduzcas pistas de los kilómetros ni de porcentajes.</p>
        <div className="form-grid run-fields">
          {RUN_FIELDS.map((k) => (
            <div key={k} className="field">
              <label htmlFor={`run-${k}`}>{k === 'total' ? 'Total de pistas' : `Pistas ${RUN_FIELD_LABEL[k]}`}{k !== 'total' && <span className={`run-colour run-${k} run-label-dot`} aria-hidden="true"><span className="run-dot" /></span>}</label>
              <input id={`run-${k}`} type="text" inputMode="numeric" autoComplete="off" value={form[k]} onChange={(e) => set(k, e.target.value)} aria-describedby={`run-${k}-hint`} />
              <p className="field-hint" id={`run-${k}-hint`}>Catálogo importado: {area.imported?.[k] ?? 'sin dato'}</p>
            </div>
          ))}
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="run-ref">Fuente o referencia comprobable</label>
            <input id="run-ref" type="text" value={form.sourceRef} onChange={(e) => set('sourceRef', e.target.value)} aria-describedby="run-ref-hint" maxLength={500} />
            <p className="field-hint" id="run-ref-hint">Enlace https a la ficha o al parte, o cita del documento (p. ej. «Folleto 2026-27, página 4»). Se muestra en los detalles públicos.</p>
          </div>
          <div className="field">
            <label htmlFor="run-season">Temporada (si se conoce)</label>
            <input id="run-season" type="text" placeholder="2026-27" value={form.season} onChange={(e) => set('season', e.target.value)} maxLength={7} aria-describedby="run-season-hint" />
            <p className="field-hint" id="run-season-hint">La que declara la fuente («2026-27»), no la deducida de su fecha. Solo con la misma temporada se combinan tu aportación y el dato automático.</p>
          </div>
          <div className="field">
            <label htmlFor="run-date">Fecha de la fuente (si la publica)</label>
            <input id="run-date" type="date" max={today} value={form.sourceDate} onChange={(e) => set('sourceDate', e.target.value)} aria-describedby="run-date-hint" />
            <p className="field-hint" id="run-date-hint">La del documento, no la de hoy. Hoy ({numDate(today)}) se guarda aparte como fecha en que introduces el dato.</p>
          </div>
          <div className="field">
            <label htmlFor="run-reason">Motivo (solo administración)</label>
            <input id="run-reason" type="text" value={form.reason} onChange={(e) => set('reason', e.target.value)} maxLength={300} aria-describedby="run-reason-hint" />
            <p className="field-hint" id="run-reason-hint">Breve: por qué se añade o cambia. Queda en el historial.</p>
          </div>
        </div>
        {needsResolution && (
          <p className="notice notice-warn small">El catálogo importado tiene una discrepancia pendiente ({issueText(area.imported)}). Para que tu cifra sea comparable y pueda puntuar, explica con evidencia por qué la resuelve; si no, guárdala como no comparable.</p>
        )}
        <div className="check">
          <input id="run-comparable" type="checkbox" checked={form.comparable} onChange={(e) => set('comparable', e.target.checked)} aria-describedby="run-comparable-hint" />
          <label htmlFor="run-comparable">Cifra comparable (puede puntuar en «Variedad de pistas»)</label>
        </div>
        <p className="field-hint" id="run-comparable-hint">Desmárcala si la fuente mezcla otras zonas o usa otro criterio de recuento.</p>
        {(needsResolution || form.resolution) && (
          <div className="field">
            <label htmlFor="run-resolution">Explicación con evidencia (se publica en los detalles)</label>
            <textarea id="run-resolution" rows={3} value={form.resolution} onChange={(e) => set('resolution', e.target.value)} maxLength={1000} aria-describedby="run-resolution-hint" />
            <p className="field-hint" id="run-resolution-hint">{needsResolution ? `Obligatoria para marcarla como comparable: al menos ${MIN_RESOLUTION} caracteres.` : 'Opcional.'}</p>
          </div>
        )}

        <Preview area={area} all={all} preview={preview} />

        {errors.length > 0 && (
          <div className={tried ? 'notice notice-warn' : 'small'} role={tried ? 'alert' : undefined} data-testid="run-errors">
            <p><strong>{tried ? 'Revisa antes de guardar:' : 'Para poder guardar falta:'}</strong></p>
            <ul className="small">{errors.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
        )}
        {error && (
          <p className="notice notice-warn" role="alert">{error.text} {error.conflict && <button type="button" className="btn btn-link btn-small" onClick={onSaved}>Recargar</button>}</p>
        )}
        <div className="row-wrap">
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy || undefined}>{busy ? 'Guardando…' : 'Guardar aportación'}</button>
          {c?.status === 'active' && <button type="button" className="btn btn-secondary" onClick={() => setAction('withdraw')}>Retirar aportación</button>}
          {c?.status === 'withdrawn' && <button type="button" className="btn btn-secondary" onClick={() => setAction('restore')}>Restaurar aportación</button>}
        </div>
      </form>

      <History areaId={area.id} count={area.history.count} />
      {c && <StatusAction area={area} action={action} onClose={() => setAction(null)} onDone={onSaved} />}
    </section>
  );
}

const issueText = (e: RunCatalogEntry | null) => runCatalogView(e)?.issues.filter((i) => REVIEW_ISSUES.has(i)).map((i) => RUN_CATALOG_ISSUE_LABEL[i]).join('; ') ?? '';

/** Valores importados, aportados y vigentes, campo a campo, con su procedencia. */
function CurrentValues({ area }: { area: AdminRunArea }) {
  const imp = area.imported, c = area.contribution, eff = area.resolved;
  return (
    <div className="stack-s">
      <h3>Valores actuales</h3>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Valores actuales de pistas">
        <table className="data-table compact run-values">
          <caption className="visually-hidden">Total y colores: catálogo importado, aportación manual y valor vigente</caption>
          <thead><tr><th scope="col">Campo</th><th scope="col">Catálogo importado</th><th scope="col">Aportación manual</th><th scope="col">Vigente</th></tr></thead>
          <tbody>
            {RUN_FIELDS.map((k) => (
              <tr key={k}>
                <th scope="row">{k === 'total' ? 'Total' : RUN_FIELD_LABEL[k]}</th>
                <td>{imp?.[k] ?? 'sin dato'}</td>
                <td>{c ? `${c[k] ?? 'sin dato'}${c.status === 'withdrawn' ? ' (retirada)' : ''}` : '—'}</td>
                <td>{eff.entry?.[k] ?? 'sin dato'}{eff.fieldOrigin[k] && <span className="muted small"> · {eff.fieldOrigin[k] === 'manual' ? 'manual' : 'importado'}</span>}{eff.overridden.includes(k) && <span className="small text-warn"> · prevalece el importado</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="small">
        <li>Catálogo importado: {imp ? <><RunsProvenance r={{ ...imp, origin: 'catalog', manual: null }} withLimits />{!imp.comparable && <span className="text-warn"> · no comparable</span>}</> : 'sin fila importada'}</li>
        {c && <li>Aportación manual ({c.status === 'active' ? 'activa' : 'retirada'}, versión {c.version}): {c.sourceRef}{c.season && ` · temporada ${c.season}`}{c.sourceDate && ` · fuente del ${numDate(c.sourceDate)}`} · introducida el {numDate(c.enteredOn)}{c.updatedByAlias && ` por ${c.updatedByAlias}`} · motivo: {c.reason}{!c.comparable && ' · marcada como no comparable'}</li>}
        <li>Estado: <strong>{MANUAL_STATE_LABEL[eff.state]}</strong>{eff.notes.map((n) => <span key={n}> {MANUAL_NOTE_LABEL[n]}</span>)}</li>
      </ul>
    </div>
  );
}

/** Lo que verá el usuario con lo escrito en el formulario y si podrá puntuar. */
function Preview({ area, all, preview }: { area: AdminRunArea; all: AdminRunArea[]; preview: ResolvedRuns }) {
  const parent = area.parentId ? all.find((a) => a.id === area.parentId) ?? null : null;
  const membersOf = (id: string) => all.filter((a) => a.parentId === id);
  const effective = (a: AdminRunArea) => (a.id === area.id ? preview.entry : a.resolved.entry);
  const cat = entryCatalogRuns(preview.entry, membersOf(area.id).map(effective));
  const parentCat = parent ? entryCatalogRuns(effective(parent), membersOf(parent.id).map(effective)) : null;
  const before = parent ? entryCatalogRuns(parent.resolved.entry, membersOf(parent.id).map((a) => a.resolved.entry)) : null;
  const pub = toPublic(preview);
  const willApply = preview.state === 'applied' || preview.state === 'partial';
  return (
    <section className="notice stack-s" aria-live="polite" aria-labelledby="run-prev-h">
      <h3 id="run-prev-h">Antes de guardar: lo que verá el usuario</h3>
      <div>Número de pistas: <CatalogRunsText cat={cat} name={area.name} /></div>
      {pub && <p className="small">Procedencia: <RunsProvenance r={pub} withLimits /></p>}
      {!willApply && preview.notes.length > 0 && <p className="text-warn small"><strong>Esta aportación no se aplicará:</strong> {preview.notes.map((n) => MANUAL_NOTE_LABEL[n]).join(' ')}</p>}
      {willApply && preview.overridden.length > 0 && <p className="text-warn small">En {preview.overridden.map((f) => RUN_FIELD_LABEL[f]).join(', ')} prevalece el catálogo importado; solo se aplica lo que completa.</p>}
      {willApply && preview.notes.length > 0 && <p className="small">{preview.notes.map((n) => MANUAL_NOTE_LABEL[n]).join(' ')}</p>}
      <p className="small">
        {parent
          ? <>Es una estación de {parent.name}: se ve en la ficha del dominio y no puntúa como destino aparte. {parentCat?.comparableTotal != null
            ? `${parent.name} puntuaría con ${plural(parentCat.comparableTotal, 'pista', 'pistas')}${parentCat.via === 'members' ? ' (suma de sus estaciones)' : ''}.`
            : `${parent.name} seguiría sin total que puntúe${parentCat?.pendingDiscrepancy ? ' (discrepancia pendiente en su cifra propia)' : ''}.`}
            {before && before.comparableTotal !== parentCat?.comparableTotal && ' (cambia respecto a ahora)'}</>
          : cat.comparableTotal != null
            ? <>Puede puntuar en «Variedad de pistas» al planificar con {plural(cat.comparableTotal, 'pista', 'pistas')} (el peso empieza en 0).</>
            : <>No puntuará en «Variedad de pistas»: {cat.pendingDiscrepancy ? 'discrepancia pendiente' : 'no hay un total comparable'}.</>}
      </p>
      <p className="small muted">«Esquiar ahora» sigue usando solo las pistas abiertas del parte vigente.</p>
    </section>
  );
}

function History({ areaId, count }: { areaId: string; count: number }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="fold" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Historial <span className="muted">· {plural(count, 'cambio', 'cambios')}</span></summary>
      <div className="fold-body">{open && <HistoryList areaId={areaId} />}</div>
    </details>
  );
}
const valuesText = (v: Record<string, unknown> | null) => (v ? RUN_FIELDS.map((k) => `${k === 'total' ? 'total' : RUN_FIELD_LABEL[k]} ${v[k] ?? '–'}`).join(' · ') : '—');
function HistoryList({ areaId }: { areaId: string }) {
  const r = useResource(() => get<{ history: HistoryRow[] }>(`/api/admin/runs/${encodeURIComponent(areaId)}/history`), [areaId]);
  if (r.loading && !r.data) return <Loading />;
  if (r.error && !r.data) return <ErrorState message={r.error} onRetry={r.reload} />;
  if (!r.data!.history.length) return <p className="muted small">Sin cambios registrados.</p>;
  return (
    <ol className="list small" aria-label="Historial de cambios">
      {r.data!.history.map((h) => (
        <li key={h.id} className="list-row list-row-wrap">
          <span className="list-main"><strong>{ACTION_LABEL[h.action] ?? h.action}</strong> · {instant(h.at)} · {h.actor ?? 'publicación (importación)'}</span>
          <span>Antes: {valuesText(h.before)}{h.before?.status === 'withdrawn' ? ' (retirada)' : ''}</span>
          <span>Después: {valuesText(h.after)}{h.after?.status === 'withdrawn' ? ' (retirada)' : ''}</span>
          {h.sourceRef && <span className="muted">Fuente: {h.sourceRef}</span>}
          {h.reason && <span className="muted">Motivo: {h.reason}</span>}
        </li>
      ))}
    </ol>
  );
}

function StatusAction({ area, action, onClose, onDone }: { area: AdminRunArea; action: 'withdraw' | 'restore' | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    if (!action || !area.contribution) return;
    if (reason.trim().length < 5) { setError('Explica brevemente el motivo.'); return; }
    setBusy(true); setError(null);
    try {
      await post(`/api/admin/runs/${encodeURIComponent(area.id)}/${action}`, { expectedVersion: area.contribution.version, reason: reason.trim() });
      toast.show(action === 'withdraw' ? 'Aportación retirada: se conserva en el historial.' : 'Aportación restaurada.');
      setReason(''); onClose(); onDone();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <ConfirmDialog open={action != null} busy={busy} error={error} danger={action === 'withdraw'}
      title={action === 'withdraw' ? `¿Retirar la aportación de ${area.name}?` : `¿Restaurar la aportación de ${area.name}?`}
      confirmLabel={action === 'withdraw' ? 'Retirar' : 'Restaurar'}
      body={<>
        <p>{action === 'withdraw' ? 'Dejará de contar. No se borra: queda en el historial y se puede restaurar.' : 'Volverá a contar con la misma prioridad: si el catálogo importado tiene un dato válido, prevalece el importado.'}</p>
        <div className="field">
          <label htmlFor="run-action-reason">Motivo</label>
          <input id="run-action-reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        </div>
      </>}
      onConfirm={() => void confirm()} onClose={() => { setError(null); onClose(); }} />
  );
}
