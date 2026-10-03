// Gastos reales en céntimos: reparto igual o a medida (suma exacta), saldos, transferencias sugeridas,
// liquidaciones registradas a mano e historial. Edición con versión (409 = otra persona guardó antes).
import { useMemo, useState } from 'react';
import { ApiError, del, errorMessage, get, post, put } from '../api';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { Field, SelectField } from '../components/Field';
import { Empty, ErrorState, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { TripShell } from '../components/TripTabs';
import { centsToInput, dayShort, euros, instant, parseEuros, signedEuros } from '../format';
import { useResource } from '../hooks';
import { useProfile } from '../session';
import type { TripDetail } from '../types';
import { splitEqual } from '../../core/split';
import { todayMadrid } from '../../core/dates';

interface Expense { id: string; concept: string; spentOn: string; payerId: string; payerAlias: string; amountCents: number; splitMode: 'equal' | 'custom'; category: string | null; receiptId: string | null; version: number; shares: Record<string, number> }
interface Settlement { id: string; fromUser: string; fromAlias: string; toUser: string; toAlias: string; amountCents: number; paidOn: string; note: string | null }
interface Summary { expenses: Expense[]; settlements: Settlement[]; totalSpentCents: number; balances: Record<string, number>; balanceCheckCents: number; suggestedTransfers: { fromUser: string; toUser: string; amountCents: number }[]; note: string }
interface History { id: string; expense_id: string; action: string; before_json: string | null; after_json: string | null; at: number; actor_alias: string }

interface Form { id: string | null; version: number; concept: string; spentOn: string; payerId: string; amount: string; category: string; mode: 'equal' | 'custom'; participants: string[]; custom: Record<string, string>; receiptLinked: boolean }

const ACTION: Record<string, string> = { create: 'creó el gasto', update: 'modificó el gasto', delete: 'borró el gasto', settle: 'registró una transferencia', unsettle: 'anuló una transferencia' };

export function TripExpensesPage({ tripId }: { tripId: string }) {
  return <TripShell tripId={tripId} tab="gastos" title="Gastos">{(d) => <Expenses tripId={tripId} detail={d} />}</TripShell>;
}

function Expenses({ tripId, detail }: { tripId: string; detail: TripDetail }) {
  const me = useProfile();
  const toast = useToast();
  const s = useResource(() => get<Summary>(`/api/trips/${tripId}/expenses`), [tripId]);
  const [showHistory, setShowHistory] = useState(false);
  const hist = useResource(() => (showHistory ? get<{ history: History[] }>(`/api/trips/${tripId}/expenses/history`) : Promise.resolve(null)), [tripId, showHistory]);
  const [form, setForm] = useState<Form | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const alias = useMemo(() => new Map(detail.members.map((m) => [m.id, m.id === me.id ? `${m.alias} (tú)` : m.alias])), [detail.members, me.id]);
  const name = (id: string) => alias.get(id) ?? 'Exmiembro';
  const memberIds = detail.members.map((m) => m.id);

  const openNew = () => {
    setFormErr(null); setConflict(false);
    setForm({ id: null, version: 1, concept: '', spentOn: todayMadrid(), payerId: me.id, amount: '', category: '', mode: 'equal', participants: memberIds, custom: {}, receiptLinked: false });
  };
  const openEdit = (e: Expense) => {
    setFormErr(null); setConflict(false);
    setForm({ id: e.id, version: e.version, concept: e.concept, spentOn: e.spentOn, payerId: e.payerId, amount: centsToInput(e.amountCents), category: e.category ?? '',
      mode: e.splitMode, participants: Object.keys(e.shares), custom: Object.fromEntries(Object.entries(e.shares).map(([k, v]) => [k, centsToInput(v)])), receiptLinked: !!e.receiptId });
  };

  const amountCents = form ? parseEuros(form.amount) : null;
  const customSum = form ? Object.entries(form.custom).reduce((acc, [, v]) => { const c = parseEuros(v); return acc + (c && !Number.isNaN(c) ? c : 0); }, 0) : 0;
  const customInvalid = form ? Object.values(form.custom).some((v) => Number.isNaN(parseEuros(v))) : false;
  const remainder = amountCents != null && !Number.isNaN(amountCents) ? amountCents - customSum : null;
  const equalPreview = form && form.mode === 'equal' && amountCents && !Number.isNaN(amountCents) && form.participants.length ? splitEqual(amountCents, form.participants) : null;

  const save = async () => {
    if (!form) return;
    if (!form.concept.trim()) { setFormErr('Indica el concepto.'); return; }
    if (amountCents == null || Number.isNaN(amountCents) || amountCents < 1) { setFormErr('Importe no válido.'); return; }
    let split: unknown;
    if (form.mode === 'equal') {
      if (!form.participants.length) { setFormErr('Elige al menos una persona para repartir.'); return; }
      split = { mode: 'equal', participants: form.participants };
    } else {
      if (customInvalid) { setFormErr('Hay importes del reparto no válidos.'); return; }
      if (remainder !== 0) { setFormErr(`El reparto debe sumar exactamente ${euros(amountCents)}.`); return; }
      split = { mode: 'custom', shares: Object.entries(form.custom).map(([userId, v]) => ({ userId, shareCents: parseEuros(v) ?? 0 })).filter((x) => x.shareCents > 0) };
    }
    const body = { concept: form.concept.trim(), spentOn: form.spentOn, payerId: form.payerId, amountCents, category: form.category.trim() || null, split };
    setBusy('save'); setFormErr(null);
    try {
      if (form.id) await put(`/api/trips/${tripId}/expenses/${form.id}`, { ...body, version: form.version });
      else await post(`/api/trips/${tripId}/expenses`, body);
      toast.show(form.id ? 'Gasto actualizado.' : 'Gasto registrado.');
      setForm(null);
      await s.reload();
      if (showHistory) void hist.reload();
    } catch (e) {
      if (e instanceof ApiError && e.isConflict) setConflict(true);
      else setFormErr(errorMessage(e));
    } finally { setBusy(null); }
  };

  const reloadConflict = async () => {
    if (!form?.id) return;
    const fresh = await get<Summary>(`/api/trips/${tripId}/expenses`).catch((e) => { setFormErr(errorMessage(e)); return null; });
    if (!fresh) return;
    s.setData(fresh);
    const latest = fresh.expenses.find((x) => x.id === form.id);
    setConflict(false);
    if (!latest) { setFormErr('Otra persona ha borrado este gasto.'); return; }
    setForm({ ...form, version: latest.version });
    setFormErr(`Versión actual: «${latest.concept}», ${euros(latest.amountCents)}, pagado por ${name(latest.payerId)}. Tus valores siguen en el formulario; guarda solo si quieres sustituirla.`);
  };

  const doDelete = async () => {
    if (!deleting) return;
    setBusy('del');
    try { await del(`/api/trips/${tripId}/expenses/${deleting.id}`); setDeleting(null); toast.show('Gasto borrado.'); await s.reload(); }
    catch (e) { toast.show(errorMessage(e), 'error'); } finally { setBusy(null); }
  };

  const settle = async (t: { fromUser: string; toUser: string; amountCents: number }) => {
    setBusy(`settle:${t.fromUser}:${t.toUser}`);
    try {
      await post(`/api/trips/${tripId}/settlements`, { ...t, paidOn: todayMadrid(), note: null });
      toast.show('Transferencia registrada.');
      await s.reload();
    } catch (e) { toast.show(errorMessage(e), 'error'); } finally { setBusy(null); }
  };

  const unsettle = async (st: Settlement) => {
    setBusy(`unsettle:${st.id}`);
    try { await del(`/api/trips/${tripId}/settlements/${st.id}`); toast.show('Transferencia anulada.'); await s.reload(); }
    catch (e) { toast.show(errorMessage(e), 'error'); } finally { setBusy(null); }
  };

  if (s.loading && !s.data) return <Loading />;
  if (s.error && !s.data) return <ErrorState message={s.error} onRetry={s.reload} />;
  const d = s.data!;
  const balanceIds = [...new Set([...memberIds, ...Object.keys(d.balances)])];

  return (
    <div className="stack">
      <div className="toolbar">
        <p className="muted small">{d.note} No se ejecutan pagos: las transferencias se registran a mano.</p>
        <button type="button" className="btn btn-primary" onClick={openNew}>Nuevo gasto</button>
      </div>

      <section className="panel stack" aria-labelledby="bal-h">
        <h2 id="bal-h">Saldos</h2>
        <p>Total gastado: <strong>{euros(d.totalSpentCents)}</strong></p>
        <ul className="list" aria-label="Saldo por persona">
          {balanceIds.map((id) => {
            const v = d.balances[id] ?? 0;
            return (
              <li key={id} className="list-row" data-balance-cents={v}>
                <span className="list-main">{name(id)}</span>
                <span className={v > 0 ? 'text-ok' : v < 0 ? 'text-bad' : ''}>{signedEuros(v)} <span className="small muted">{v > 0 ? '(le deben)' : v < 0 ? '(debe)' : '(en paz)'}</span></span>
              </li>
            );
          })}
        </ul>
        <p className="small muted" data-testid="balance-check">Comprobación: la suma de saldos es {euros(d.balanceCheckCents)}.</p>
        {d.suggestedTransfers.length > 0 && (
          <>
            <h3>Transferencias sugeridas</h3>
            <ul className="list">
              {d.suggestedTransfers.map((t) => (
                <li key={`${t.fromUser}-${t.toUser}`} className="list-row list-row-wrap">
                  <span className="list-main">{name(t.fromUser)} → {name(t.toUser)}: <strong>{euros(t.amountCents)}</strong></span>
                  {(t.fromUser === me.id || t.toUser === me.id) && (
                    <button type="button" className="btn btn-small btn-secondary" disabled={busy !== null} onClick={() => void settle(t)}>Registrar como pagada</button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="panel stack" aria-labelledby="exp-h">
        <h2 id="exp-h">Gastos <span className="count">{d.expenses.length}</span></h2>
        {d.expenses.length === 0 ? <Empty title="Sin gastos registrados" /> : (
          <ul className="list" aria-label="Gastos del viaje">
            {d.expenses.map((e) => (
              <li key={e.id} className="expense-row">
                <div className="list-row list-row-wrap">
                  <span className="list-main"><strong>{e.concept}</strong> <span className="muted small">· {dayShort(e.spentOn)} · pagó {name(e.payerId)}{e.category && ` · ${e.category}`}{e.receiptId && ' · desde ticket'}</span></span>
                  <strong>{euros(e.amountCents)}</strong>
                </div>
                <p className="small muted">{e.splitMode === 'equal' ? 'A partes iguales' : 'Reparto a medida'}: {Object.entries(e.shares).map(([u, c]) => `${name(u)} ${euros(c)}`).join(' · ')}</p>
                <div className="cluster-s">
                  <button type="button" className="btn btn-small btn-ghost" onClick={() => openEdit(e)}>Editar<span className="visually-hidden"> {e.concept}</span></button>
                  <button type="button" className="btn btn-small btn-ghost" onClick={() => setDeleting(e)}>Borrar<span className="visually-hidden"> {e.concept}</span></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {d.settlements.length > 0 && (
        <section className="panel stack" aria-labelledby="set-h">
          <h2 id="set-h">Transferencias registradas</h2>
          <ul className="list">
            {d.settlements.map((st) => (
              <li key={st.id} className="list-row list-row-wrap">
                <span className="list-main">{name(st.fromUser)} → {name(st.toUser)}: {euros(st.amountCents)} <span className="muted small">· {dayShort(st.paidOn)}{st.note && ` · ${st.note}`}</span></span>
                {(st.fromUser === me.id || st.toUser === me.id) && <button type="button" className="btn btn-small btn-ghost" disabled={busy !== null} onClick={() => void unsettle(st)}>Anular</button>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel stack" aria-labelledby="his-h">
        <div className="toolbar"><h2 id="his-h">Historial</h2>
          <button type="button" className="btn btn-small btn-secondary" aria-expanded={showHistory} onClick={() => setShowHistory((v) => !v)}>{showHistory ? 'Ocultar' : 'Ver historial'}</button></div>
        {showHistory && (hist.loading && !hist.data ? <Loading /> : hist.error ? <ErrorState message={hist.error} onRetry={hist.reload} /> : (
          <ul className="list">{(hist.data?.history ?? []).map((h) => {
            const after = h.after_json ? JSON.parse(h.after_json) : null;
            return <li key={h.id} className="small list-row list-row-wrap"><span className="list-main">{h.actor_alias} {ACTION[h.action] ?? h.action}{after?.concept && ` «${after.concept}»`}{after?.amountCents != null && ` (${euros(after.amountCents)})`}</span><span className="muted">{instant(h.at)}</span></li>;
          })}</ul>
        ))}
      </section>

      <Dialog open={form !== null} title={form?.id ? 'Editar gasto' : 'Nuevo gasto'} size="wide" onClose={() => setForm(null)} busy={busy === 'save'}
        footer={<>
          <button type="button" className="btn btn-secondary" onClick={() => setForm(null)} disabled={busy === 'save'}>Cancelar</button>
          {conflict ? <button type="button" className="btn btn-primary" onClick={() => void reloadConflict()}>Ver la versión actual</button>
            : <button type="submit" form="exp-form" className="btn btn-primary" disabled={busy === 'save' || (form?.mode === 'custom' && remainder !== 0)}>{busy === 'save' ? 'Guardando…' : 'Guardar'}</button>}
        </>}>
        {conflict && <p className="notice notice-warn" role="alert"><strong>Otra persona ha modificado este gasto.</strong> No se ha guardado nada para no sobrescribir su cambio.</p>}
        {form && (
          <form id="exp-form" className="stack" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
            <div className="form-grid">
              <Field className="span-2" label="Concepto" value={form.concept} maxLength={200} onChange={(e) => setForm({ ...form, concept: e.target.value })} />
              <Field label="Importe (€)" inputMode="decimal" value={form.amount} disabled={form.receiptLinked} onChange={(e) => setForm({ ...form, amount: e.target.value })}
                hint={form.receiptLinked ? 'Vinculado a un ticket: el importe es el total del ticket.' : undefined} />
              <Field label="Fecha" type="date" value={form.spentOn} onChange={(e) => setForm({ ...form, spentOn: e.target.value })} />
              <SelectField label="Pagó" value={form.payerId} onChange={(e) => setForm({ ...form, payerId: e.target.value })}>
                {detail.members.map((m) => <option key={m.id} value={m.id}>{name(m.id)}</option>)}
              </SelectField>
              <Field label="Categoría" value={form.category} maxLength={40} onChange={(e) => setForm({ ...form, category: e.target.value })} hint="Opcional" />
            </div>
            <fieldset className="radio-group">
              <legend>Reparto</legend>
              <label className="radio"><input type="radio" name="split-mode" checked={form.mode === 'equal'} onChange={() => setForm({ ...form, mode: 'equal' })} /> A partes iguales</label>
              <label className="radio"><input type="radio" name="split-mode" checked={form.mode === 'custom'} onChange={() => setForm({ ...form, mode: 'custom' })} /> A medida</label>
            </fieldset>
            {form.mode === 'equal' ? (
              <fieldset className="stack-s">
                <legend>Entre quiénes</legend>
                {detail.members.map((m) => (
                  <div className="check" key={m.id}>
                    <input id={`p-${m.id}`} type="checkbox" checked={form.participants.includes(m.id)}
                      onChange={(e) => setForm({ ...form, participants: e.target.checked ? [...form.participants, m.id] : form.participants.filter((x) => x !== m.id) })} />
                    <label htmlFor={`p-${m.id}`}>{name(m.id)}{equalPreview?.has(m.id) && <span className="muted"> · {euros(equalPreview.get(m.id)!)}</span>}</label>
                  </div>
                ))}
                {equalPreview && <p className="small muted">Los céntimos que no se pueden dividir se asignan uno a uno de forma fija; la suma es exacta.</p>}
              </fieldset>
            ) : (
              <fieldset className="stack-s">
                <legend>Importe de cada persona (€)</legend>
                <div className="form-grid">
                  {detail.members.map((m) => (
                    <Field key={m.id} label={name(m.id)} inputMode="decimal" value={form.custom[m.id] ?? ''} onChange={(e) => setForm({ ...form, custom: { ...form.custom, [m.id]: e.target.value } })} />
                  ))}
                </div>
                <p className={`small ${remainder === 0 ? 'text-ok' : 'text-bad'}`} aria-live="polite">
                  {remainder == null ? 'Indica primero el importe total.' : remainder === 0 ? 'El reparto suma exactamente el total.' : remainder > 0 ? `Faltan ${euros(remainder)} por repartir.` : `Sobran ${euros(-remainder)}.`}
                </p>
              </fieldset>
            )}
          </form>
        )}
        {formErr && <p className="form-error" role="alert">{formErr}</p>}
      </Dialog>
      <ConfirmDialog open={deleting !== null} title={`¿Borrar «${deleting?.concept ?? ''}»?`} body={<p>Los saldos se recalculan. Queda constancia en el historial.</p>} confirmLabel="Borrar" danger busy={busy === 'del'}
        onConfirm={() => void doDelete()} onClose={() => setDeleting(null)} />
    </div>
  );
}
