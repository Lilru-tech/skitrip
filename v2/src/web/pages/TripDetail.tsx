import { useState } from 'react';
import { ApiError, del, errorMessage, get, patch, post } from '../api';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { SelectField } from '../components/Field';
import { Copy } from '../components/Icons';
import { ErrorState, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { dayLong, euros, instant, plural, ROLE_LABEL, TRIP_STATUS_LABEL } from '../format';
import { useBusy, useResource } from '../hooks';
import { Link, navigate, usePageTitle } from '../router';
import { useProfile } from '../session';
import type { FriendsResponse, Trip, TripDetail, TripMember } from '../types';
import { diffForms, formToPayload, TripForm, tripToForm, validateTripForm, type TripFormValues } from './TripForm';

type Confirm =
  | { kind: 'remove'; member: TripMember }
  | { kind: 'transfer'; member: TripMember }
  | { kind: 'leave' }
  | { kind: 'delete' }
  | null;

export function TripDetailPage({ tripId }: { tripId: string }) {
  const me = useProfile();
  const toast = useToast();
  const detail = useResource(() => get<TripDetail>(`/api/trips/${tripId}`), [tripId]);
  const friends = useResource(() => get<FriendsResponse>('/api/friends'), []);
  const { busy, run } = useBusy();
  usePageTitle(detail.data?.trip.name ?? 'Viaje');

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<TripFormValues | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ reloaded: boolean; mine: string[] } | null>(null);
  const [baseVersion, setBaseVersion] = useState(0);

  const [confirm, setConfirm] = useState<Confirm>(null);
  const [confirmErr, setConfirmErr] = useState<string | null>(null);

  const [inviteId, setInviteId] = useState('');
  const [linkHours, setLinkHours] = useState('72');
  const [linkUses, setLinkUses] = useState('5');
  const [link, setLink] = useState<{ url: string; expiresAt: number } | null>(null);

  if (detail.loading && !detail.data) return <div className="page"><Loading /></div>;
  if (detail.error && !detail.data) {
    return (
      <div className="page">
        <h1>Viaje</h1>
        <ErrorState message={detail.error} onRetry={detail.reload} />
        <p><Link to="/viajes">Volver a mis viajes</Link></p>
      </div>
    );
  }
  const { trip, members, invitations } = detail.data!;
  const role = trip.role;
  const canEdit = role !== 'member';
  const isOwner = role === 'owner';
  const canInvite = role !== 'member' || trip.membersCanInvite;
  const memberIds = new Set(members.map((m) => m.id));
  const pendingIds = new Set(invitations.map((i) => i.invitee_id).filter(Boolean));
  const invitable = (friends.data?.friends ?? []).filter((f) => !memberIds.has(f.id) && !pendingIds.has(f.id));

  const openEdit = () => {
    setForm(tripToForm(trip));
    setBaseVersion(trip.version);
    setFormErr(null);
    setConflict(null);
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!form) return;
    const v = validateTripForm(form);
    if (v) { setFormErr(v); return; }
    setFormErr(null);
    try {
      await run('edit', () => patch<{ trip: Trip }>(`/api/trips/${tripId}`, { ...formToPayload(form, isOwner), version: baseVersion }));
      toast.show('Cambios guardados.');
      setEditing(false);
      await detail.reload();
    } catch (e) {
      if (e instanceof ApiError && e.isConflict) setConflict({ reloaded: false, mine: [] });
      else setFormErr(errorMessage(e));
    }
  };

  // Conflicto de versión: cargar la última versión y mostrar lo que el usuario había escrito, sin sobrescribir nada.
  const reloadAfterConflict = async () => {
    if (!form) return;
    try {
      const fresh = await run('reload', () => get<TripDetail>(`/api/trips/${tripId}`));
      if (!fresh) return;
      detail.setData(fresh);
      const latest = tripToForm(fresh.trip);
      setConflict({ reloaded: true, mine: diffForms(form, latest) });
      setForm(latest);
      setBaseVersion(fresh.trip.version);
    } catch (e) {
      setFormErr(errorMessage(e));
    }
  };

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    try {
      await run(key, fn);
      toast.show(ok);
      await detail.reload();
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  const doConfirm = async () => {
    if (!confirm) return;
    setConfirmErr(null);
    try {
      if (confirm.kind === 'remove') {
        await run('confirm', () => del(`/api/trips/${tripId}/members/${confirm.member.id}`));
        toast.show(`${confirm.member.alias} ya no es miembro del viaje.`);
      } else if (confirm.kind === 'transfer') {
        await run('confirm', () => post(`/api/trips/${tripId}/transfer`, { userId: confirm.member.id }));
        toast.show(`${confirm.member.alias} es ahora propietario. Tú pasas a editor.`);
      } else if (confirm.kind === 'leave') {
        await run('confirm', () => del(`/api/trips/${tripId}/members/${me.id}`));
        toast.show('Has abandonado el viaje.');
        setConfirm(null);
        navigate('/viajes');
        return;
      } else {
        await run('confirm', () => del(`/api/trips/${tripId}`));
        toast.show('Viaje eliminado.');
        setConfirm(null);
        navigate('/viajes');
        return;
      }
      setConfirm(null);
      await detail.reload();
    } catch (e) {
      setConfirmErr(errorMessage(e));
    }
  };

  const createLink = async () => {
    try {
      const r = await run('link', () => post<{ invitation: { token: string; expiresAt: number } }>(`/api/trips/${tripId}/invitations`, {
        link: true, expiresInHours: Number(linkHours), maxUses: Number(linkUses),
      }));
      if (!r) return;
      // El token va en el fragmento (#): no llega al servidor ni a registros de acceso.
      setLink({ url: `${location.origin}/unirse#${r.invitation.token}`, expiresAt: r.invitation.expiresAt });
      await detail.reload();
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  const copyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      toast.show('Enlace copiado.');
    } catch {
      const el = document.getElementById('invite-link') as HTMLInputElement | null;
      el?.select();
      toast.show('No se pudo copiar automáticamente: el enlace está seleccionado, cópialo con Ctrl+C o mantén pulsado.', 'info');
    }
  };

  const confirmText = (): { title: string; body: string; label: string } => {
    switch (confirm?.kind) {
      case 'remove': return { title: `¿Quitar a ${confirm.member.alias}?`, body: 'Dejará de ver el viaje y su disponibilidad compartida con este viaje se retirará.', label: 'Quitar del viaje' };
      case 'transfer': return { title: `¿Transferir la propiedad a ${confirm.member.alias}?`, body: 'Pasará a ser propietario del viaje y tú quedarás como editor. Solo el nuevo propietario podrá deshacerlo.', label: 'Transferir' };
      case 'leave': return { title: '¿Abandonar el viaje?', body: 'Dejarás de ver el viaje. Para volver necesitarás una nueva invitación.', label: 'Abandonar' };
      case 'delete': return { title: `¿Eliminar «${trip.name}»?`, body: 'Se borrará el viaje para todos sus miembros, con sus propuestas de fechas. No se puede deshacer.', label: 'Eliminar viaje' };
      default: return { title: '', body: '', label: '' };
    }
  };
  const ct = confirmText();

  return (
    <div className="page">
      <p className="breadcrumb"><Link to="/viajes">Mis viajes</Link></p>
      <div className="page-head">
        <div>
          <h1>{trip.name}</h1>
          <p className="cluster-s"><span className="tag">{TRIP_STATUS_LABEL[trip.status]}</span><span className="tag tag-quiet">Tu rol: {ROLE_LABEL[role]}</span></p>
        </div>
        <div className="cluster-s">
          <Link to={`/viajes/${trip.id}/calendario`} className="btn btn-primary">Calendario del viaje</Link>
          {canEdit && <button type="button" className="btn btn-secondary" onClick={openEdit}>Editar</button>}
        </div>
      </div>

      <section className="panel" aria-labelledby="info-h">
        <h2 id="info-h" className="visually-hidden">Datos del viaje</h2>
        <dl className="facts facts-grid">
          <div><dt>Ida</dt><dd>{trip.startDate ? dayLong(trip.startDate) : 'Por decidir'}</dd></div>
          <div><dt>Vuelta</dt><dd>{trip.endDate ? dayLong(trip.endDate) : 'Por decidir'}</dd></div>
          <div><dt>Noches</dt><dd>{trip.nights ?? '—'}</dd></div>
          <div><dt>Personas previstas</dt><dd>{trip.participantsPlanned ?? '—'}</dd></div>
          <div><dt>Presupuesto por persona</dt><dd>{trip.budgetCents != null ? euros(trip.budgetCents) : '—'}</dd></div>
          <div><dt>Última modificación</dt><dd>{instant(trip.updatedAt)}</dd></div>
        </dl>
      </section>

      <section className="panel stack" aria-labelledby="mem-h">
        <h2 id="mem-h">Miembros <span className="count">{members.length}</span></h2>
        <ul className="list">
          {members.map((m) => (
            <li key={m.id} className="list-row list-row-wrap">
              <span className="list-main"><strong>{m.alias}</strong>{m.id === me.id && <span className="muted"> (tú)</span>} <span className="tag tag-quiet">{ROLE_LABEL[m.role]}</span></span>
              <span className="cluster-s">
                {isOwner && m.role !== 'owner' && (
                  <>
                    <label className="visually-hidden" htmlFor={`role-${m.id}`}>Rol de {m.alias}</label>
                    <select id={`role-${m.id}`} className="select-small" value={m.role} disabled={busy !== null}
                      onChange={(e) => void act(`role:${m.id}`, () => patch(`/api/trips/${tripId}/members/${m.id}`, { role: e.target.value }), `Rol de ${m.alias} actualizado.`)}>
                      <option value="editor">Editor</option>
                      <option value="member">Miembro</option>
                    </select>
                    <button type="button" className="btn btn-small btn-secondary" onClick={() => { setConfirmErr(null); setConfirm({ kind: 'transfer', member: m }); }}>
                      Hacer propietario<span className="visually-hidden"> a {m.alias}</span>
                    </button>
                    <button type="button" className="btn btn-small btn-ghost" onClick={() => { setConfirmErr(null); setConfirm({ kind: 'remove', member: m }); }}>
                      Quitar<span className="visually-hidden"> a {m.alias}</span>
                    </button>
                  </>
                )}
                {m.id === me.id && !isOwner && (
                  <button type="button" className="btn btn-small btn-danger-outline" onClick={() => { setConfirmErr(null); setConfirm({ kind: 'leave' }); }}>Abandonar viaje</button>
                )}
              </span>
            </li>
          ))}
        </ul>
        {isOwner && <p className="muted small">Como propietario, para abandonar el viaje primero transfiere la propiedad a otro miembro.</p>}
      </section>

      {canInvite && (
        <section className="panel stack" aria-labelledby="invite-h">
          <h2 id="invite-h">Invitar</h2>
          <div className="invite-grid">
            <form className="stack-s" onSubmit={(e) => {
              e.preventDefault();
              if (!inviteId) return;
              const f = invitable.find((x) => x.id === inviteId);
              void act('invite', () => post(`/api/trips/${tripId}/invitations`, { userId: inviteId }), `Invitación enviada a ${f?.alias ?? 'tu amigo'}.`).then(() => setInviteId(''));
            }}>
              <h3>A una amistad</h3>
              {friends.loading && !friends.data ? <p className="muted">Cargando amigos…</p> : invitable.length === 0 ? (
                <p className="muted">No hay amistades por invitar. <Link to="/amigos">Añade amigos</Link> o usa un enlace.</p>
              ) : (
                <>
                  <SelectField label="Amigo" value={inviteId} onChange={(e) => setInviteId(e.target.value)}>
                    <option value="">Elige a quién invitar</option>
                    {invitable.map((f) => <option key={f.id} value={f.id}>{f.alias}</option>)}
                  </SelectField>
                  <div><button type="submit" className="btn btn-primary" disabled={!inviteId || busy !== null}>{busy === 'invite' ? 'Enviando…' : 'Enviar invitación'}</button></div>
                </>
              )}
            </form>
            <form className="stack-s" onSubmit={(e) => { e.preventDefault(); void createLink(); }}>
              <h3>Con un enlace</h3>
              <div className="form-row">
                <SelectField label="Caduca en" value={linkHours} onChange={(e) => setLinkHours(e.target.value)}>
                  <option value="24">1 día</option>
                  <option value="72">3 días</option>
                  <option value="168">7 días</option>
                  <option value="336">14 días</option>
                </SelectField>
                <SelectField label="Usos máximos" value={linkUses} onChange={(e) => setLinkUses(e.target.value)}>
                  {[1, 2, 3, 5, 10, 20].map((n) => <option key={n} value={n}>{n}</option>)}
                </SelectField>
              </div>
              <div><button type="submit" className="btn btn-secondary" disabled={busy !== null}>{busy === 'link' ? 'Creando…' : 'Crear enlace'}</button></div>
              {link && (
                <div className="stack-s link-box">
                  <label htmlFor="invite-link">Enlace de invitación</label>
                  <div className="input-with-btn">
                    <input id="invite-link" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
                    <button type="button" className="btn btn-primary" onClick={() => void copyLink()}><Copy /> Copiar</button>
                  </div>
                  <p className="field-hint">Solo se muestra ahora: guárdalo o compártelo. Caduca el {instant(link.expiresAt)}. Quien lo abra necesitará una cuenta de SkiTrip.</p>
                </div>
              )}
            </form>
          </div>
          {invitations.length > 0 && (
            <>
              <h3>Invitaciones pendientes</h3>
              <ul className="list">
                {invitations.map((i) => (
                  <li key={i.id} className="list-row list-row-wrap">
                    <span className="list-main">
                      {i.is_link ? <>Enlace · {i.uses}/{i.max_uses} usos</> : <>{i.invitee_alias}</>}
                      <span className="muted"> · caduca {instant(i.expires_at)}</span>
                    </span>
                    <button type="button" className="btn btn-small btn-ghost" disabled={busy !== null}
                      onClick={() => void act(`rev:${i.id}`, () => post(`/api/trips/${tripId}/invitations/${i.id}/revoke`), 'Invitación retirada.')}>
                      Retirar<span className="visually-hidden"> invitación {i.is_link ? 'por enlace' : `a ${i.invitee_alias}`}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {isOwner && (
        <section className="panel stack" aria-labelledby="danger-h">
          <h2 id="danger-h">Eliminar viaje</h2>
          <p className="muted">Borra el viaje para todos. No se puede deshacer.</p>
          <div><button type="button" className="btn btn-danger-outline" onClick={() => { setConfirmErr(null); setConfirm({ kind: 'delete' }); }}>Eliminar viaje</button></div>
        </section>
      )}

      <Dialog open={editing} title="Editar viaje" size="wide" onClose={() => setEditing(false)} busy={busy === 'edit'}
        footer={conflict ? <>
          <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)}>Cerrar</button>
          {!conflict.reloaded && <button type="button" className="btn btn-primary" onClick={() => void reloadAfterConflict()} disabled={busy !== null}>{busy === 'reload' ? 'Cargando…' : 'Cargar la versión actual'}</button>}
          {conflict.reloaded && <button type="submit" form="trip-edit" className="btn btn-primary" disabled={busy !== null}>Guardar sobre la versión actual</button>}
        </> : <>
          <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)} disabled={busy === 'edit'}>Cancelar</button>
          <button type="submit" form="trip-edit" className="btn btn-primary" disabled={busy === 'edit'} aria-busy={busy === 'edit' || undefined}>{busy === 'edit' ? 'Guardando…' : 'Guardar cambios'}</button>
        </>}>
        {conflict && (
          <div className="notice notice-warn stack-s" role="alert">
            <p><strong>Otra persona ha modificado el viaje mientras editabas.</strong> No hemos guardado tus cambios para no sobrescribir los suyos.</p>
            {!conflict.reloaded ? <p>Carga la versión actual para revisarla.</p> : conflict.mine.length === 0 ? <p>La versión actual ya coincide con lo que habías escrito.</p> : (
              <>
                <p>El formulario muestra ahora la versión actual. Esto es lo que tú habías escrito, por si quieres volver a aplicarlo:</p>
                <ul>{conflict.mine.map((c) => <li key={c}>{c}</li>)}</ul>
              </>
            )}
          </div>
        )}
        {form && <TripForm id="trip-edit" values={form} onChange={(v) => { setForm(v); }} onSubmit={() => void saveEdit()} showStatus showOwnerFields={isOwner} />}
        {formErr && <p className="form-error" role="alert">{formErr}</p>}
      </Dialog>

      <ConfirmDialog open={confirm !== null} title={ct.title} body={<p>{ct.body}</p>} confirmLabel={ct.label}
        danger={confirm?.kind !== 'transfer'} busy={busy === 'confirm'} error={confirmErr}
        onConfirm={() => void doConfirm()} onClose={() => setConfirm(null)} />
      <p className="muted small">{plural(members.length, 'miembro', 'miembros')} · creado el {instant(trip.createdAt)}</p>
    </div>
  );
}
