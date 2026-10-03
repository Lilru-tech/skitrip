import { useEffect, useState } from 'react';
import { errorMessage, get, post, qs } from '../api';
import { ConfirmDialog } from '../components/Dialog';
import { Field } from '../components/Field';
import { Empty, ErrorState, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { instant, plural, RUN_STATUS_LABEL, SOURCE_STATUS_LABEL } from '../format';
import { useResource } from '../hooks';
import { Link, usePageTitle } from '../router';
import { useProfile } from '../session';

interface Health {
  runs: { id: string; pipeline: string; started_at: number; finished_at: number | null; expected: number; ok: number; failed: number; unsupported: number; rows_written: number; status: string; error_summary: string | null; runner: string | null }[];
  sources: { id: string; area_id: string; kind: string; provider: string; status: string; last_attempt_at: number | null; last_success_at: number | null; last_status: string | null; last_error: string | null; consecutive_fail: number | null }[];
  coverage: { areaId: string; lastSnow: number | null; snowFreshness: 'fresh' | 'stale' | 'never' }[];
  users: { n: number; blocked: number | null };
  maxProfiles: number;
  rows: Record<string, number>;
  quotas: { note: string };
}
interface LegacyComment { id: string; legacy_author_name: string | null; legacy_resort_id: string | null; body: string; created_at_text: string | null; reconciled_user_id: string | null; reconciled_alias: string | null; published: number }
interface LegacyPerson { person: string; days: number; first_day: string; last_day: string; unmapped: number; reconciled_user_id: string | null; reconciled_alias: string | null }
interface UserHit { id: string; alias: string }

const PIPELINE_LABEL: Record<string, string> = { snow: 'Nieve', offers: 'Ofertas', prices: 'Precios' };
const RUN_LABEL: Record<string, string> = { ...RUN_STATUS_LABEL, running: 'en curso', partial: 'parcial' };
const IDENTITY_WARNING = 'Un nombre parecido no prueba identidad. Asigna solo si has confirmado con esa persona que es ella.';

export function AdminPage() {
  usePageTitle('Administración');
  const me = useProfile();
  const [rev, setRev] = useState(0);
  if (me.role !== 'admin') {
    return (
      <div className="page">
        <h1>Página no disponible</h1>
        <p>Esta sección no existe o no tienes acceso.</p>
        <Link to="/viajes" className="btn btn-primary">Ir a mis viajes</Link>
      </div>
    );
  }
  return (
    <div className="page page-wide">
      <h1>Administración</h1>
      <p className="lead-s">Estado de las capturas, cuentas y datos heredados de la hoja antigua. Cada acción queda registrada.</p>
      <HealthPanel />
      <UsersPanel />
      <SheetImportPanel onImported={() => setRev((n) => n + 1)} />
      <LegacyCommentsPanel rev={rev} />
      <LegacyAvailabilityPanel rev={rev} />
    </div>
  );
}

function HealthPanel() {
  const r = useResource(() => get<Health>('/api/admin/health'), []);
  if (r.loading && !r.data) return <section className="panel"><Loading /></section>;
  if (r.error && !r.data) return <section className="panel"><ErrorState message={r.error} onRetry={r.reload} /></section>;
  const h = r.data!;
  const bad = h.sources.filter((s) => s.last_status && s.last_status !== 'ok');
  return (
    <>
      <section className="panel stack" aria-labelledby="adm-health">
        <h2 id="adm-health">Salud de las fuentes</h2>
        <p>{plural(h.users.n, 'cuenta', 'cuentas')} de {h.maxProfiles} permitidas · {plural(h.users.blocked ?? 0, 'bloqueada', 'bloqueadas')} · {plural(bad.length, 'fuente con problemas', 'fuentes con problemas')}</p>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Tabla de fuentes">
          <table className="data-table compact">
            <caption className="visually-hidden">Estado de cada fuente</caption>
            <thead><tr><th scope="col">Fuente</th><th scope="col">Estado</th><th scope="col">Último éxito</th><th scope="col">Último intento</th><th scope="col">Error</th></tr></thead>
            <tbody>
              {h.sources.map((s) => (
                <tr key={s.id}>
                  <th scope="row">{s.area_id} · {s.kind} · {s.provider}</th>
                  <td>{SOURCE_STATUS_LABEL[s.status] ?? s.status}{s.last_status && ` / ${RUN_LABEL[s.last_status] ?? s.last_status}`}{s.consecutive_fail ? ` (${s.consecutive_fail} fallos seguidos)` : ''}</td>
                  <td>{s.last_success_at ? instant(s.last_success_at) : 'nunca'}</td>
                  <td>{s.last_attempt_at ? instant(s.last_attempt_at) : 'nunca'}</td>
                  <td className="mono">{s.last_error ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel stack" aria-labelledby="adm-runs">
        <h2 id="adm-runs">Últimas capturas</h2>
        {h.runs.length === 0 ? <p className="muted">Aún no se ha registrado ninguna captura.</p> : (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Tabla de capturas">
            <table className="data-table compact">
              <thead><tr><th scope="col">Inicio</th><th scope="col">Tipo</th><th scope="col">Resultado</th><th scope="col">Correctas / esperadas</th><th scope="col">Filas</th></tr></thead>
              <tbody>
                {h.runs.map((run) => (
                  <tr key={run.id}>
                    <td>{instant(run.started_at)}</td>
                    <td>{PIPELINE_LABEL[run.pipeline] ?? run.pipeline}</td>
                    <td>{RUN_LABEL[run.status] ?? run.status}{run.error_summary && ` · ${run.error_summary}`}</td>
                    <td>{run.ok} / {run.expected}{run.failed ? ` · ${run.failed} fallidas` : ''}{run.unsupported ? ` · ${run.unsupported} no soportadas` : ''}</td>
                    <td>{run.rows_written}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <h3>Nieve por estación</h3>
        <ul className="inline-list">
          {h.coverage.map((c) => (
            <li key={c.areaId}>{c.areaId}: {c.snowFreshness === 'fresh' ? 'al día' : c.snowFreshness === 'stale' ? 'desactualizada' : 'sin datos'}{c.lastSnow ? ` (${instant(c.lastSnow)})` : ''}</li>
          ))}
        </ul>
        <h3>Volumen de datos</h3>
        <p className="small">Nieve {h.rows.snow} · ofertas {h.rows.offers} · precios {h.rows.prices} · hotel legacy {h.rows.legacy_hotel} · nieve legacy {h.rows.legacy_snow} · búsquedas activas {h.rows.active_scenarios}</p>
        <p className="small muted">{h.quotas.note}</p>
      </section>
    </>
  );
}

/** Buscador de cuentas por alias (solo muestra alias, nunca correo). */
function UserPicker({ id, label, onPick }: { id: string; label: string; onPick: (u: UserHit) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<UserHit[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setHits([]); return; }
    let alive = true;
    const h = setTimeout(() => {
      get<{ users: UserHit[] }>(`/api/friends/search?${qs({ q: t })}`).then((r) => { if (alive) { setHits(r.users); setErr(null); } }, (e) => { if (alive) setErr(errorMessage(e)); });
    }, 250);
    return () => { alive = false; clearTimeout(h); };
  }, [q]);
  return (
    <div className="stack-s">
      <Field id={id} label={label} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" maxLength={24} hint="Escribe al menos 2 letras del alias. Las cuentas bloqueadas no aparecen." />
      {err && <p className="form-error" role="alert">{err}</p>}
      {hits.length > 0 && (
        <ul className="list" aria-label="Cuentas encontradas">
          {hits.map((u) => (
            <li key={u.id} className="row-between">
              <span>{u.alias}</span>
              <button type="button" className="btn btn-secondary btn-small" onClick={() => { onPick(u); setQ(''); setHits([]); }}>Elegir</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UsersPanel() {
  const toast = useToast();
  const me = useProfile();
  const [pending, setPending] = useState<{ user: UserHit; action: 'block' | 'unblock' } | null>(null);
  const [blocked, setBlocked] = useState<UserHit[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    get<{ users: UserHit[] }>('/api/admin/users?status=blocked').then((r) => setBlocked(r.users)).catch(() => undefined);
  }, []);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (!pending) return;
    setBusy(true); setError(null);
    try {
      await post(`/api/admin/users/${pending.user.id}/${pending.action}`);
      toast.show(pending.action === 'block' ? `${pending.user.alias} está bloqueada y su sesión se ha cerrado.` : `${pending.user.alias} puede volver a entrar.`);
      setBlocked((b) => (pending.action === 'block' ? [...b.filter((x) => x.id !== pending.user.id), pending.user] : b.filter((x) => x.id !== pending.user.id)));
      setPending(null);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <section className="panel stack" aria-labelledby="adm-users">
      <h2 id="adm-users">Cuentas</h2>
      <p className="small">Bloquear cierra la sesión de la cuenta y le impide entrar. No borra sus datos.</p>
      <UserPicker id="adm-user-q" label="Buscar cuenta para bloquear" onPick={(u) => (u.id === me.id ? toast.show('No puedes bloquearte a ti mismo.', 'error') : setPending({ user: u, action: 'block' }))} />
      {blocked.length > 0 && (
        <>
          <h3>Cuentas bloqueadas</h3>
          <ul className="list" aria-label="Cuentas bloqueadas en esta sesión">
            {blocked.map((u) => (
              <li key={u.id} className="row-between">
                <span>{u.alias}</span>
                <button type="button" className="btn btn-secondary btn-small" onClick={() => setPending({ user: u, action: 'unblock' })}>Desbloquear</button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="small muted">Por ahora solo se pueden desbloquear desde aquí las cuentas bloqueadas en esta sesión: falta un listado de cuentas bloqueadas en el servidor.</p>
      <ConfirmDialog open={pending != null} busy={busy} error={error} danger={pending?.action === 'block'}
        title={pending?.action === 'block' ? `¿Bloquear a ${pending.user.alias}?` : `¿Desbloquear a ${pending?.user.alias ?? ''}?`}
        confirmLabel={pending?.action === 'block' ? 'Bloquear' : 'Desbloquear'}
        body={<p>{pending?.action === 'block' ? 'Se cerrará su sesión en todos sus dispositivos y no podrá entrar hasta que la desbloquees.' : 'Podrá volver a iniciar sesión.'}</p>}
        onConfirm={() => void confirm()} onClose={() => { setPending(null); setError(null); }} />
    </section>
  );
}

type SheetKind = 'availability' | 'comments' | 'shopping';
const SHEET_LABEL: Record<SheetKind, string> = { availability: 'Disponibilidad', comments: 'Comentarios', shopping: 'Compra' };
const STATUS_LABEL: Record<string, string> = { busy: 'ocupado', free: 'libre', maybe: 'quizá', sin_equivalencia: 'sin equivalencia' };
interface SheetReport {
  kind: SheetKind; file: string; sha256: string; bytes: number; headers: string[]; valid: number; errorCount: number; warningCount: number; duplicates: number;
  errors: { line: number; message: string }[]; warnings: { line: number; message: string }[]; alreadyImported: { file: boolean; rows: number };
  byStatus?: Record<string, number>; sample: Record<string, unknown>[];
}
const MAX_CSV_BYTES = 450_000;

// Importación de la hoja antigua: el CSV se lee en el navegador y va a la API (nunca al repositorio ni a Pages).
function SheetImportPanel({ onImported }: { onImported: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<SheetKind>('availability');
  const [file, setFile] = useState<{ name: string; csv: string } | null>(null);
  const [report, setReport] = useState<SheetReport | null>(null);
  const [partial, setPartial] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reset = () => { setReport(null); setPartial(false); setError(null); };

  const pick = async (f: File | undefined) => {
    reset(); setFile(null);
    if (!f) return;
    if (f.size > MAX_CSV_BYTES) { setError('El CSV supera 450 KB: exporta solo la pestaña que toca.'); return; }
    setFile({ name: f.name, csv: await f.text() });
  };
  const send = async (dryRun: boolean) => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const r = await post<{ report: SheetReport; inserted?: number; alreadyPresent?: number; skippedErrors?: number }>('/api/admin/legacy/sheets/import',
        { kind, fileName: file.name, csv: file.csv, dryRun, allowPartial: partial });
      setReport(r.report);
      if (!dryRun) {
        toast.show(`Hoja importada: ${plural(r.inserted ?? 0, 'fila nueva', 'filas nuevas')}${r.alreadyPresent ? `, ${r.alreadyPresent} ya estaban` : ''}${r.skippedErrors ? `, ${r.skippedErrors} omitidas por errores` : ''}.`);
        setFile(null); setReport(null);
        onImported();
      }
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <section className="panel stack" aria-labelledby="adm-sheets">
      <h2 id="adm-sheets">Importar la hoja antigua (CSV)</h2>
      <p className="small">Exporta cada pestaña con Archivo › Descargar › CSV y súbela aquí. Primero verás una vista previa con recuentos y errores; importar dos veces el mismo archivo no duplica nada. Lo importado no se publica ni se asigna a nadie: eso se hace abajo, persona a persona.</p>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="sheet-kind">Pestaña</label>
          <select id="sheet-kind" className="select" value={kind} onChange={(e) => { setKind(e.target.value as SheetKind); reset(); }}>
            {(Object.keys(SHEET_LABEL) as SheetKind[]).map((k) => <option key={k} value={k}>{SHEET_LABEL[k]}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="sheet-file">Archivo CSV</label>
          <input id="sheet-file" type="file" accept=".csv,text/csv" onChange={(e) => void pick(e.target.files?.[0])} disabled={busy} />
        </div>
      </div>
      {error && <p className="notice notice-warn" role="alert">{error}</p>}
      {report && (
        <div className="stack-s" data-testid="sheet-report" aria-label="Vista previa de la hoja">
          <p><strong>{SHEET_LABEL[report.kind]} · {report.file}</strong>: {plural(report.valid, 'fila válida', 'filas válidas')} · {plural(report.errorCount, 'error', 'errores')} · {plural(report.warningCount, 'aviso', 'avisos')}{report.duplicates ? ` · ${plural(report.duplicates, 'duplicada', 'duplicadas')}` : ''}</p>
          {report.byStatus && <p className="small">{Object.entries(report.byStatus).map(([k, n]) => `${STATUS_LABEL[k] ?? k}: ${n}`).join(' · ')}</p>}
          {report.alreadyImported.file && <p className="notice small" role="status">Este archivo ya se importó ({plural(report.alreadyImported.rows, 'fila', 'filas')}); volver a importarlo no duplica nada.</p>}
          {report.errors.length > 0 && <ul className="warnings small" aria-label="Errores">{report.errors.map((e) => <li key={`e${e.line}${e.message}`}>Línea {e.line}: {e.message}</li>)}</ul>}
          {report.warnings.length > 0 && <ul className="small muted" aria-label="Avisos">{report.warnings.map((w) => <li key={`w${w.line}${w.message}`}>Línea {w.line}: {w.message}</li>)}</ul>}
          {report.sample.length > 0 && <details className="small"><summary>Primeras filas</summary><pre className="mono">{report.sample.map((r) => JSON.stringify(r)).join('\n')}</pre></details>}
          <p className="small muted">SHA-256 {report.sha256.slice(0, 16)}… · {report.bytes} bytes · columnas: {report.headers.join(', ')}</p>
          {report.errorCount > 0 && <div className="check"><input id="sheet-partial" type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} /><label htmlFor="sheet-partial">Importar omitiendo solo las filas con errores</label></div>}
        </div>
      )}
      <div className="row-wrap">
        <button type="button" className="btn btn-secondary" disabled={!file || busy} onClick={() => void send(true)}>Previsualizar</button>
        <button type="button" className="btn btn-primary" disabled={!file || !report || busy || report.valid === 0 || (report.errorCount > 0 && !partial)} onClick={() => void send(false)}>{busy ? 'Importando…' : 'Importar'}</button>
      </div>
    </section>
  );
}

function LegacyCommentsPanel({ rev }: { rev: number }) {
  const toast = useToast();
  const r = useResource(() => get<{ comments: LegacyComment[]; note: string }>('/api/admin/legacy/comments'), [rev]);
  const [target, setTarget] = useState<{ c: LegacyComment; user: UserHit | null; publish: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);

  const confirm = async () => {
    if (!target) return;
    setBusy(true); setError(null);
    try {
      await post(`/api/admin/legacy/comments/${target.c.id}/reconcile`, { userId: target.user?.id ?? null, publish: target.publish });
      toast.show(target.user ? 'Comentario asignado.' : 'Asignación retirada.');
      setTarget(null); setPicking(null);
      void r.reload();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <section className="panel stack" aria-labelledby="adm-legacy-c">
      <h2 id="adm-legacy-c">Comentarios de la hoja antigua</h2>
      {r.data && <p className="small">{r.data.note}</p>}
      {r.loading && !r.data && <Loading />}
      {r.error && !r.data && <ErrorState message={r.error} onRetry={r.reload} />}
      {r.data && (r.data.comments.length === 0 ? <Empty title="No hay comentarios heredados" /> : (
        <ul className="card-list" aria-label="Comentarios heredados">
          {r.data.comments.map((c) => (
            <li key={c.id} className="card">
              <p className="small muted">Firmado como «{c.legacy_author_name ?? 'sin nombre'}»{c.legacy_resort_id && ` · ${c.legacy_resort_id}`}{c.created_at_text && ` · ${c.created_at_text}`}</p>
              <p className="comment-body">{c.body}</p>
              <p className="small">{c.reconciled_alias ? `Asignado a ${c.reconciled_alias}` : 'Sin asignar'} · {c.published ? 'publicado' : 'no publicado'}</p>
              <div className="row-wrap">
                <button type="button" className="btn btn-secondary btn-small" onClick={() => setPicking(picking === c.id ? null : c.id)} aria-expanded={picking === c.id}>Asignar a una cuenta</button>
                {c.reconciled_user_id && (
                  <button type="button" className="btn btn-link btn-small" onClick={() => setTarget({ c, user: null, publish: false })}>Quitar asignación</button>
                )}
              </div>
              {picking === c.id && <UserPicker id={`lc-${c.id}`} label="Alias de la cuenta" onPick={(u) => setTarget({ c, user: u, publish: false })} />}
            </li>
          ))}
        </ul>
      ))}
      <ConfirmDialog open={target != null} busy={busy} error={error}
        title={target?.user ? `¿Asignar a ${target.user.alias}?` : '¿Quitar la asignación?'}
        confirmLabel={target?.user ? 'Asignar' : 'Quitar'}
        body={<>
          <p><strong>{IDENTITY_WARNING}</strong></p>
          {target && <p>Firmado en la hoja como «{target.c.legacy_author_name ?? 'sin nombre'}».</p>}
          {target?.user && (
            <label className="check">
              <input type="checkbox" checked={target.publish} onChange={(e) => setTarget({ ...target, publish: e.target.checked })} />
              <span>Publicar el comentario en la página de la estación</span>
            </label>
          )}
        </>}
        onConfirm={() => void confirm()} onClose={() => { setTarget(null); setError(null); }} />
    </section>
  );
}

function LegacyAvailabilityPanel({ rev }: { rev: number }) {
  const toast = useToast();
  const r = useResource(() => get<{ people: LegacyPerson[]; note: string }>('/api/admin/legacy/availability'), [rev]);
  const [target, setTarget] = useState<{ p: LegacyPerson; user: UserHit | null } | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (!target) return;
    setBusy(true); setError(null);
    try {
      const res = await post<{ days: number }>('/api/admin/legacy/availability/reconcile', { person: target.p.person, userId: target.user?.id ?? null });
      toast.show(target.user ? `${plural(res.days, 'día asignado', 'días asignados')}.` : 'Asignación retirada.');
      setTarget(null); setPicking(null);
      void r.reload();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <section className="panel stack" aria-labelledby="adm-legacy-a">
      <h2 id="adm-legacy-a">Disponibilidad de la hoja antigua</h2>
      {r.data && <p className="small">{r.data.note} Asignar no copia nada al calendario nuevo: la persona solo lo verá como referencia.</p>}
      {r.loading && !r.data && <Loading />}
      {r.error && !r.data && <ErrorState message={r.error} onRetry={r.reload} />}
      {r.data && (r.data.people.length === 0 ? <Empty title="No hay disponibilidad heredada" /> : (
        <ul className="card-list" aria-label="Personas de la hoja antigua">
          {r.data.people.map((p, i) => {
            const key = `${p.person}|${p.reconciled_user_id ?? ''}`;
            return (
              <li key={key} className="card">
                <div className="card-head"><h3>«{p.person}»</h3><span className={`tag ${p.reconciled_alias ? 'tag-ok' : 'tag-quiet'}`}>{p.reconciled_alias ? `Asignado a ${p.reconciled_alias}` : 'Sin asignar'}</span></div>
                <p className="small">{plural(p.days, 'día marcado', 'días marcados')} entre {p.first_day} y {p.last_day}{p.unmapped ? ` · ${p.unmapped} con valor no reconocido` : ''}</p>
                <div className="row-wrap">
                  <button type="button" className="btn btn-secondary btn-small" onClick={() => setPicking(picking === key ? null : key)} aria-expanded={picking === key}>Asignar a una cuenta</button>
                  {p.reconciled_user_id && <button type="button" className="btn btn-link btn-small" onClick={() => setTarget({ p, user: null })}>Quitar asignación</button>}
                </div>
                {picking === key && <UserPicker id={`la-${i}`} label="Alias de la cuenta" onPick={(u) => setTarget({ p, user: u })} />}
              </li>
            );
          })}
        </ul>
      ))}
      <ConfirmDialog open={target != null} busy={busy} error={error}
        title={target?.user ? `¿Asignar «${target.p.person}» a ${target.user.alias}?` : '¿Quitar la asignación?'}
        confirmLabel={target?.user ? 'Asignar' : 'Quitar'}
        body={<><p><strong>{IDENTITY_WARNING}</strong></p>{target && <p>Afecta a {plural(target.p.days, 'día', 'días')} de la hoja.</p>}</>}
        onConfirm={() => void confirm()} onClose={() => { setTarget(null); setError(null); }} />
    </section>
  );
}
