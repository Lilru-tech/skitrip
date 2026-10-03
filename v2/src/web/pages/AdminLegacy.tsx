// Incorporación guiada de la hoja antigua (administración): resumen de lo conservado, lo pendiente de revisión y lo
// incorporado; vinculación explícita de nombres a cuentas; revisión y publicación de comentarios elegidos uno a uno;
// plantillas CSV. Nada se publica ni se atribuye a una cuenta sin una acción explícita, y la disponibilidad pasada
// queda como consulta histórica (no se traslada a la temporada siguiente).
import { useMemo, useState } from 'react';
import { errorMessage, get, post } from '../api';
import { ConfirmDialog } from '../components/Dialog';
import { Empty, ErrorState, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { IDENTITY_WARNING, UserPicker, type UserHit } from '../components/UserPicker';
import type { LegacySummary } from '../components/GettingStarted';
import { numDate, plural } from '../format';
import { useResource } from '../hooks';
import { Link } from '../router';
import { seasons } from '../calendar/dates';
import { SHEET_TEMPLATES as TEMPLATES } from '../../core/sheet-templates';

export interface LegacyComment {
  id: string; legacy_author_name: string | null; legacy_resort_id: string | null; area_name: string | null; body: string; created_at_text: string | null;
  reconciled_user_id: string | null; reconciled_alias: string | null; published: number;
}
const isGeneral = (c: LegacyComment) => c.legacy_resort_id === 'global';
const placeOf = (c: LegacyComment) => (isGeneral(c) ? 'Consejo general' : c.area_name ?? (c.legacy_resort_id ? `estación «${c.legacy_resort_id}» sin identificar` : 'sin estación'));

/** Resumen y vinculación de nombres, con una sola carga del resumen. */
export function LegacyOverview({ rev, onChanged }: { rev: number; onChanged: () => void }) {
  const r = useResource(() => get<LegacySummary>('/api/admin/legacy/summary'), [rev]);
  if (r.loading && !r.data) return <section className="panel"><Loading /></section>;
  if (r.error && !r.data) return <section className="panel"><ErrorState message={r.error} onRetry={r.reload} /></section>;
  return <><LegacyGuide s={r.data!} /><IdentitiesPanel s={r.data!} onChanged={() => { onChanged(); }} /></>;
}

function LegacyGuide({ s }: { s: LegacySummary }) {
  const unlinked = s.names.filter((n) => n.state !== 'linked');
  const linked = s.names.length - unlinked.length;
  const kept = s.comments.total + s.availability.days + s.shopping.total;
  const nextSeason = seasons()[0].label.replace('Temporada ', '');
  const allPast = s.availability.days > 0 && s.availability.pastDays === s.availability.days;
  const steps = [
    { done: kept > 0, title: 'Importar las pestañas de la hoja', text: kept > 0 ? `${plural(kept, 'fila conservada', 'filas conservadas')} con su copia original.` : 'Más abajo, en «Importar la hoja antigua (CSV)». Hay plantillas y ayuda.' },
    { done: s.names.length > 0 && unlinked.length === 0, title: 'Vincular cada nombre de la hoja a su cuenta',
      text: s.names.length === 0 ? 'Aparecerán los nombres de la hoja cuando la importes.' : unlinked.length ? `${plural(unlinked.length, 'nombre pendiente', 'nombres pendientes')} de ${s.names.length}. Solo si has confirmado con esa persona que es ella; si no, déjalo sin vincular.` : 'Todos los nombres están vinculados.' },
    { done: s.comments.total > 0 && s.comments.pending === 0, title: 'Revisar y elegir qué comentarios publicar',
      text: s.comments.total === 0 ? 'No hay comentarios importados.' : `${plural(s.comments.pending, 'comentario sin publicar', 'comentarios sin publicar')}. Publica solo los que elijas; los consejos generales se ven en Comparar.` },
    { done: s.availability.days > 0 && s.availability.unlinkedDays === 0, title: 'Disponibilidad: consulta histórica',
      text: s.availability.days === 0 ? 'No hay disponibilidad importada.'
        : `Cada persona vinculada ve sus días en Calendario › Hoja antigua.${allPast ? ` Son días ya pasados: se consultan, pero no se copian ni se trasladan a la temporada ${nextSeason}.` : ''}` },
  ];
  return (
    <section className="panel stack" aria-labelledby="hoja-antigua-h" id="hoja-antigua">
      <h2 id="hoja-antigua-h">Hoja antigua: incorporación guiada</h2>
      <p className="small muted">{s.note}</p>
      <dl className="tally" aria-label="Resumen de la hoja antigua">
        <div className="tally-item"><dt>Conservado</dt><dd>{kept}<span>{plural(s.comments.total, 'comentario', 'comentarios')} · {plural(s.availability.days, 'día', 'días')} de disponibilidad · {plural(s.shopping.total, 'artículo', 'artículos')} de compra</span></dd></div>
        <div className={`tally-item ${s.comments.pending + unlinked.length > 0 ? 'is-pending' : ''}`}><dt>Pendiente de revisión</dt><dd>{s.comments.pending + unlinked.length}<span>{plural(s.comments.pending, 'comentario sin publicar', 'comentarios sin publicar')} · {plural(unlinked.length, 'nombre sin vincular', 'nombres sin vincular')}</span></dd></div>
        <div className={`tally-item ${s.comments.published + s.availability.incorporated + linked > 0 ? 'is-done' : ''}`}><dt>Incorporado</dt><dd>{s.comments.published + s.availability.incorporated}<span>{plural(s.comments.published, 'comentario publicado', 'comentarios publicados')} · {plural(s.availability.incorporated, 'día incorporado', 'días incorporados')} a un calendario · {plural(linked, 'nombre vinculado', 'nombres vinculados')}</span></dd></div>
      </dl>
      {s.availability.days > 0 && s.availability.firstDay && s.availability.lastDay && (
        <p className="small" data-testid="legacy-period">Disponibilidad de la hoja: del {numDate(s.availability.firstDay)} al {numDate(s.availability.lastDay)}
          {s.availability.pastDays > 0 && <> · {plural(s.availability.pastDays, 'día ya pasado', 'días ya pasados')} (consulta histórica; no se trasladan a la temporada {nextSeason})</>}.</p>
      )}
      <ol className="steps" aria-label="Pasos de la hoja antigua">
        {steps.map((st, i) => (
          <li key={st.title} className={`step ${st.done ? 'is-done' : ''}`}>
            <span className="step-mark" aria-hidden="true">{st.done ? '✓' : i + 1}</span>
            <span className="step-title">{st.title}{st.done && <span className="visually-hidden"> (hecho)</span>}</span>
            <div className="step-body"><p>{st.text}</p></div>
          </li>
        ))}
        <li className="step">
          <span className="step-mark" aria-hidden="true">{steps.length + 1}</span>
          <span className="step-title">Compra</span>
          <div className="step-body"><p>{plural(s.shopping.total, 'artículo conservado', 'artículos conservados')}. Se recuperan desde la página Compra, eligiendo cada artículo.</p><Link to="/compra" className="btn btn-small btn-secondary">Ir a Compra</Link></div>
        </li>
      </ol>
    </section>
  );
}

const NAME_STATE: Record<LegacySummary['names'][number]['state'], string> = { linked: 'Vinculado', unlinked: 'Sin vincular', partial: 'Vinculación parcial' };

function IdentitiesPanel({ s, onChanged }: { s: LegacySummary; onChanged: () => void }) {
  const toast = useToast();
  const [picking, setPicking] = useState<string | null>(null);
  const [target, setTarget] = useState<{ n: LegacySummary['names'][number]; user: UserHit | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    if (!target) return;
    setBusy(true); setError(null);
    try {
      const r = await post<{ days: number; comments: number }>('/api/admin/legacy/identities/link', { name: target.n.name, userId: target.user?.id ?? null });
      toast.show(target.user ? `«${target.n.name}» vinculado a ${target.user.alias}: ${plural(r.days, 'día', 'días')} y ${plural(r.comments, 'comentario', 'comentarios')}.` : `«${target.n.name}» desvinculado.`);
      setTarget(null); setPicking(null);
      onChanged();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <section className="panel stack" aria-labelledby="adm-names">
      <h2 id="adm-names">Nombres de la hoja</h2>
      <p className="small">Cada nombre escrito en la hoja, con su disponibilidad y sus comentarios. Vincular uno a una cuenta asigna ambas cosas a esa persona; <strong>no publica nada</strong>. Si no estás seguro de quién es, déjalo sin vincular: sus datos se conservan igual.</p>
      {s.names.length === 0 ? <Empty title="Aún no hay nombres"><p>Aparecen al importar la disponibilidad o los comentarios.</p></Empty> : (
        <ul className="card-list" aria-label="Nombres de la hoja antigua">
          {s.names.map((n, i) => (
            <li key={n.name} className="card">
              <div className="card-head"><h3>«{n.name}»</h3><span className={`tag ${n.state === 'linked' ? 'tag-ok' : n.state === 'partial' ? 'tag-warn' : 'tag-quiet'}`}>{n.state === 'linked' ? `Vinculado a ${n.alias}` : NAME_STATE[n.state]}</span></div>
              <p className="small">{plural(n.days, 'día de disponibilidad', 'días de disponibilidad')} · {plural(n.comments, 'comentario', 'comentarios')}</p>
              <div className="row-wrap">
                <button type="button" className="btn btn-secondary btn-small" aria-expanded={picking === n.name} onClick={() => setPicking(picking === n.name ? null : n.name)}>
                  {n.state === 'unlinked' ? 'Vincular a una cuenta' : 'Cambiar cuenta'}<span className="visually-hidden"> para «{n.name}»</span></button>
                {n.state !== 'unlinked' && <button type="button" className="btn btn-link btn-small" onClick={() => setTarget({ n, user: null })}>Desvincular<span className="visually-hidden"> «{n.name}»</span></button>}
              </div>
              {picking === n.name && <UserPicker id={`ln-${i}`} label={`Cuenta para «${n.name}»`} onPick={(u) => setTarget({ n, user: u })} />}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={target != null} busy={busy} error={error}
        title={target?.user ? `¿Vincular «${target.n.name}» a ${target.user.alias}?` : `¿Desvincular «${target?.n.name ?? ''}»?`}
        confirmLabel={target?.user ? 'Vincular' : 'Desvincular'}
        body={<>
          {target?.user && <p><strong>{IDENTITY_WARNING}</strong></p>}
          {target && <p>Afecta a {plural(target.n.days, 'día', 'días')} de disponibilidad y {plural(target.n.comments, 'comentario', 'comentarios')}. No se publica ningún comentario ni se copia nada a su calendario.</p>}
        </>}
        onConfirm={() => void confirm()} onClose={() => { setTarget(null); setError(null); }} />
    </section>
  );
}

type Filter = 'pending' | 'published' | 'all';
const FILTER_LABEL: Record<Filter, string> = { pending: 'Sin publicar', published: 'Publicados', all: 'Todos' };

export function LegacyCommentsReview({ rev, onChanged }: { rev: number; onChanged: () => void }) {
  const toast = useToast();
  const r = useResource(() => get<{ comments: LegacyComment[]; note: string }>('/api/admin/legacy/comments'), [rev]);
  const [filter, setFilter] = useState<Filter>('pending');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<boolean | null>(null); // true = publicar, false = retirar
  const [target, setTarget] = useState<{ c: LegacyComment; user: UserHit | null; publish: boolean } | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const all = r.data?.comments ?? [];
  const shown = useMemo(() => all.filter((c) => filter === 'all' || (filter === 'published' ? c.published : !c.published)), [all, filter]);
  const chosen = all.filter((c) => sel.has(c.id));
  const count = (f: Filter) => all.filter((c) => f === 'all' || (f === 'published' ? c.published : !c.published)).length;
  const toggle = (id: string, on: boolean) => setSel((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const done = () => { setSel(new Set()); setBulk(null); setTarget(null); setPicking(null); onChanged(); };

  const publishChosen = async () => {
    if (bulk == null || !chosen.length) return;
    setBusy(true); setError(null);
    try {
      const res = await post<{ updated: number }>('/api/admin/legacy/comments/publish', { ids: chosen.map((c) => c.id), publish: bulk });
      toast.show(bulk ? `${plural(res.updated, 'comentario publicado', 'comentarios publicados')}.` : `${plural(res.updated, 'comentario retirado', 'comentarios retirados')} de la web.`);
      done();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const reconcile = async () => {
    if (!target) return;
    setBusy(true); setError(null);
    try {
      await post(`/api/admin/legacy/comments/${target.c.id}/reconcile`, { userId: target.user?.id ?? null, publish: target.publish });
      toast.show(target.user ? 'Comentario asignado.' : 'Asignación retirada.');
      done();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const generalChosen = chosen.filter(isGeneral).length;

  return (
    <section className="panel stack" aria-labelledby="adm-legacy-c">
      <h2 id="adm-legacy-c">Comentarios de la hoja antigua</h2>
      {r.data && <p className="small">{r.data.note} Marca los que quieras publicar: cada uno aparece en la ficha de su estación, y los «consejos generales», en Comparar › Consejos generales.</p>}
      {r.loading && !r.data && <Loading />}
      {r.error && !r.data && <ErrorState message={r.error} onRetry={r.reload} />}
      {r.data && (all.length === 0 ? <Empty title="No hay comentarios heredados" /> : (
        <>
          <fieldset className="radio-group">
            <legend>Mostrar</legend>
            {(['pending', 'published', 'all'] as Filter[]).map((f) => (
              <label key={f} className="radio"><input type="radio" name="lc-filter" checked={filter === f} onChange={() => setFilter(f)} /> {FILTER_LABEL[f]} <span className="muted">({count(f)})</span></label>
            ))}
          </fieldset>
          <div className="selection-bar cluster-s" role="region" aria-label="Acciones con los comentarios elegidos">
            <span className="small" aria-live="polite">{plural(chosen.length, 'comentario elegido', 'comentarios elegidos')}</span>
            <button type="button" className="btn btn-primary btn-small" disabled={!chosen.length} onClick={() => { setError(null); setBulk(true); }}>Publicar los elegidos</button>
            <button type="button" className="btn btn-secondary btn-small" disabled={!chosen.length} onClick={() => { setError(null); setBulk(false); }}>Retirar de la web</button>
            {chosen.length > 0 && <button type="button" className="btn btn-link btn-small" onClick={() => setSel(new Set())}>Quitar la selección</button>}
          </div>
          {shown.length === 0 ? <p className="muted">{filter === 'pending' ? 'No queda ningún comentario sin publicar.' : 'Ninguno en esta vista.'}</p> : (
            <ul className="card-list" aria-label="Comentarios heredados">
              {shown.map((c) => (
                <li key={c.id} className="card">
                  <div className="select-row">
                    <input type="checkbox" id={`lc-sel-${c.id}`} checked={sel.has(c.id)} onChange={(e) => toggle(c.id, e.target.checked)}
                      aria-label={`Elegir el comentario de «${c.legacy_author_name ?? 'sin nombre'}»: ${c.body.slice(0, 60)}`} />
                    <div className="stack-s">
                      <p className="small muted">{placeOf(c)} · firmado como «{c.legacy_author_name ?? 'sin nombre'}»{c.created_at_text && ` · ${c.created_at_text}`}</p>
                      <p className="comment-body">{c.body}</p>
                      <p className="small cluster-s">
                        <span className={`tag ${c.published ? 'tag-ok' : 'tag-warn'}`}>{c.published ? 'Publicado' : 'Sin publicar'}</span>
                        <span className="tag tag-quiet">{c.reconciled_alias ? `Vinculado a ${c.reconciled_alias}` : 'Sin vincular'}</span>
                      </p>
                      <div className="row-wrap">
                        <button type="button" className="btn btn-secondary btn-small" onClick={() => setPicking(picking === c.id ? null : c.id)} aria-expanded={picking === c.id}>Asignar a una cuenta</button>
                        {c.reconciled_user_id && <button type="button" className="btn btn-link btn-small" onClick={() => setTarget({ c, user: null, publish: false })}>Quitar asignación</button>}
                      </div>
                      {picking === c.id && <UserPicker id={`lc-${c.id}`} label="Alias de la cuenta" onPick={(u) => setTarget({ c, user: u, publish: !!c.published })} />}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ))}
      <ConfirmDialog open={bulk != null} busy={busy} error={error}
        title={bulk ? `¿Publicar ${plural(chosen.length, 'comentario', 'comentarios')}?` : `¿Retirar ${plural(chosen.length, 'comentario', 'comentarios')} de la web?`}
        confirmLabel={bulk ? 'Publicar' : 'Retirar'}
        body={bulk ? <>
          <p>Se verán con el nombre escrito en la hoja (texto libre), no como una cuenta, salvo los que ya hayas vinculado.</p>
          <p>{[chosen.length - generalChosen > 0 ? `${plural(chosen.length - generalChosen, 'comentario', 'comentarios')} en la ficha de su estación` : null,
            generalChosen > 0 ? `${plural(generalChosen, 'consejo general', 'consejos generales')} en Comparar` : null].filter(Boolean).join(' · ')}.</p>
        </> : <p>Dejarán de verse en la web. Se conservan y puedes volver a publicarlos.</p>}
        onConfirm={() => void publishChosen()} onClose={() => { setBulk(null); setError(null); }} />
      <ConfirmDialog open={target != null} busy={busy} error={error}
        title={target?.user ? `¿Asignar a ${target.user.alias}?` : '¿Quitar la asignación?'}
        confirmLabel={target?.user ? 'Asignar' : 'Quitar'}
        body={<>
          <p><strong>{IDENTITY_WARNING}</strong></p>
          {target && <p>Firmado en la hoja como «{target.c.legacy_author_name ?? 'sin nombre'}».</p>}
          {target?.user && (
            <label className="check">
              <input type="checkbox" checked={target.publish} onChange={(e) => setTarget({ ...target, publish: e.target.checked })} />
              <span>Publicar el comentario ({isGeneral(target.c) ? 'en Consejos generales' : 'en la página de la estación'})</span>
            </label>
          )}
        </>}
        onConfirm={() => void reconcile()} onClose={() => { setTarget(null); setError(null); }} />
    </section>
  );
}

// ---------- Plantillas y ayuda para el CSV ----------

function download(file: string, csv: string) {
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = file;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CsvHelp() {
  return (
    <details className="fold small">
      <summary>Plantillas CSV y ayuda <span className="muted">· qué columnas lleva cada pestaña</span></summary>
      <div className="fold-body">
        <ol className="stack-s">
          <li>En la hoja de Google, abre la pestaña y usa Archivo › Descargar › Valores separados por comas (.csv). Se descarga solo la pestaña activa.</li>
          <li>Si tus columnas tienen otros nombres, cambia la primera fila para que coincida con la plantilla (se aceptan también en inglés: date, user, status, text…).</li>
          <li>Elige la pestaña, sube el archivo y pulsa «Previsualizar». Nada se guarda hasta que pulses «Importar».</li>
        </ol>
        <ul className="list" aria-label="Plantillas CSV">
          {Object.entries(TEMPLATES).map(([k, t]) => (
            <li key={k} className="stack-s">
              <div className="row-wrap"><strong>{t.label}</strong>
                <button type="button" className="btn btn-secondary btn-small" onClick={() => download(t.file, t.csv)}>Descargar plantilla<span className="visually-hidden"> de {t.label.toLowerCase()}</span></button></div>
              <p className="muted">{t.help}</p>
              <p className="mono">{t.csv.split('\n')[0]}</p>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
