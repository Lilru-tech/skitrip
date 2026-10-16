import { useEffect, useRef, useState } from 'react';
import { errorMessage, get, post } from '../api';
import { Bell } from '../components/Icons';
import { Empty, ErrorState, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { euros, instant } from '../format';
import { useBusy, useResource } from '../hooks';
import { Link, usePageTitle } from '../router';
import { announceNotificationsChanged, PULSE, startUnreadPolling, useNotificationsPulse } from '../notifications-live';

export interface NotificationItem {
  id: string; kind: string; payload: Record<string, unknown>; created_at: number; read_at: number | null;
  /** Solicitudes e invitaciones: estado vigente leído en el servidor al listar. */
  state?: string; fromAlias?: string | null; tripId?: string | null; tripName?: string | null; inviterAlias?: string | null; expiresAt?: number | null;
}
interface NotificationsResponse { notifications: NotificationItem[]; unread: number }

/** Campana de la cabecera: número de avisos sin leer, con actualización ligera (ver notifications-live). */
export function NotificationsBell({ path }: { path: string }) {
  const [unread, setUnread] = useState(0);
  const last = useRef<number | null>(null);
  useEffect(() => startUnreadPolling(async () => {
    try {
      const r = await get<{ unread: number }>('/api/notifications/unread');
      setUnread(r.unread);
      if (last.current !== null && last.current !== r.unread) window.dispatchEvent(new Event(PULSE));
      last.current = r.unread;
    } catch { /* la campana no bloquea nada */ }
  }), []);
  // Al navegar también se recuenta (barato y sin temporizador nuevo).
  useEffect(() => { announceNotificationsChanged(); }, [path]);
  const label = unread === 0 ? 'Avisos: ninguno sin leer' : `Avisos: ${unread} sin leer`;
  return (
    <Link to="/avisos" className="bell-link" aria-label={label} aria-current={path === '/avisos' ? 'page' : undefined}>
      <Bell />
      {unread > 0 && <span className="bell-count" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
    </Link>
  );
}

const FRIEND_STATE: Record<string, string> = {
  accepted: 'Aceptada', rejected: 'Rechazada', cancelled: 'Cancelada por quien la envió', gone: 'Ya no está disponible',
};
const INVITE_STATE: Record<string, string> = {
  accepted: 'Aceptada', declined: 'Rechazada', revoked: 'Retirada por quien invitó', expired: 'Caducada', gone: 'Ya no está disponible',
};

function describe(n: NotificationItem): { title: string; body: string } {
  const p = n.payload;
  if (n.kind === 'offer_price_change' && typeof p.fromCents === 'number' && typeof p.toCents === 'number') {
    const pct = typeof p.pct === 'number' ? p.pct : null;
    const dir = p.toCents > p.fromCents ? 'Ha subido' : 'Ha bajado';
    return {
      title: `${dir} el precio de una oferta que sigues`,
      body: `De ${euros(p.fromCents)} a ${euros(p.toCents)}${pct != null ? ` (${pct > 0 ? '+' : ''}${pct.toLocaleString('es-ES')} %)` : ''}${typeof p.observedAt === 'number' ? `, observado el ${instant(p.observedAt)}` : ''}. Es un precio observado, no una reserva.`,
    };
  }
  if (n.kind === 'friend_request') {
    const who = n.fromAlias ?? 'Una persona';
    return { title: `${who} quiere ser tu amistad en SkiTrip`, body: n.state === 'pending' ? 'Puedes aceptar o rechazar la solicitud. Marcar el aviso como leído no la acepta.' : 'La solicitud ya no está pendiente: no hace falta hacer nada.' };
  }
  if (n.kind === 'trip_invitation') {
    const trip = n.tripName ? `«${n.tripName}»` : 'un viaje';
    const who = n.inviterAlias ?? 'Una persona';
    const until = n.state === 'pending' && n.expiresAt ? ` Caduca el ${instant(n.expiresAt)}.` : '';
    return { title: `${who} te invita al viaje ${trip}`, body: n.state === 'pending' ? `Puedes unirte o rechazarla. Marcar el aviso como leído no la acepta.${until}` : 'La invitación ya no está pendiente: no hace falta hacer nada.' };
  }
  return { title: 'Aviso', body: typeof p.message === 'string' ? p.message : 'Hay novedades en SkiTrip.' };
}

/** Estado de una solicitud o invitación ya resuelta, como etiqueta. */
function closedTag(n: NotificationItem): string | null {
  if (!n.state || n.state === 'pending') return null;
  return (n.kind === 'friend_request' ? FRIEND_STATE : INVITE_STATE)[n.state] ?? 'Ya no está pendiente';
}

export function NotificationsPage() {
  usePageTitle('Avisos');
  const toast = useToast();
  const { busy, run } = useBusy();
  const r = useResource(() => get<NotificationsResponse>('/api/notifications'), []);
  useNotificationsPulse(() => { void r.reload(); });

  const markRead = async (ids: string[]) => {
    if (!ids.length) return;
    try {
      await run(ids.length === 1 ? ids[0] : 'all', () => post('/api/notifications/read', { ids }));
      const at = Date.now();
      r.setData((d) => d && ({ notifications: d.notifications.map((n) => (ids.includes(n.id) ? { ...n, read_at: n.read_at ?? at } : n)), unread: d.notifications.filter((n) => !n.read_at && !ids.includes(n.id)).length }));
      announceNotificationsChanged();
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  /** Responde a una solicitud o invitación desde el aviso. Si ya no estaba pendiente, se recarga para mostrar su estado. */
  const respond = async (n: NotificationItem, accept: boolean) => {
    const p = n.payload;
    const path = n.kind === 'friend_request'
      ? `/api/friends/requests/${String(p.requestId)}/${accept ? 'accept' : 'reject'}`
      : `/api/trips/invitations/${String(p.invitationId)}/${accept ? 'accept' : 'decline'}`;
    try {
      await run(`${accept ? 'acc' : 'rej'}:${n.id}`, () => post(path));
      toast.show(n.kind === 'friend_request'
        ? (accept ? `Ahora eres amistad de ${n.fromAlias ?? 'esa persona'}.` : 'Solicitud rechazada.')
        : (accept ? `Te has unido a «${n.tripName ?? 'el viaje'}».` : 'Invitación rechazada.'));
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
    await r.reload();
    announceNotificationsChanged();
  };

  const unreadIds = r.data?.notifications.filter((n) => !n.read_at).map((n) => n.id) ?? [];
  return (
    <div className="page">
      <div className="page-head">
        <h1>Avisos</h1>
        {unreadIds.length > 0 && (
          <button type="button" className="btn btn-secondary" disabled={busy != null} onClick={() => void markRead(unreadIds)}>Marcar todos como leídos</button>
        )}
      </div>
      <p className="lead-s">Avisos dentro de SkiTrip: solicitudes de amistad, invitaciones a viajes y cambios de al menos un 3 % en el precio de ofertas que sigues. No se envían correos ni notificaciones del navegador.</p>
      {r.loading && !r.data && <Loading />}
      {r.error && !r.data && <ErrorState message={r.error} onRetry={r.reload} />}
      {r.data && (r.data.notifications.length === 0 ? (
        <Empty title="No tienes avisos">Aquí verás solicitudes de amistad, invitaciones a viajes y novedades de las ofertas que sigues. Puedes ver ofertas en <Link to="/comparar">Comparar</Link>.</Empty>
      ) : (
        <ul className="card-list" aria-label="Avisos">
          {r.data.notifications.map((n) => {
            const d = describe(n);
            const closed = closedTag(n);
            const actionable = (n.kind === 'friend_request' || n.kind === 'trip_invitation') && n.state === 'pending';
            return (
              <li key={n.id} className={`card${n.read_at ? ' is-muted' : ''}`} aria-label={d.title}>
                <div className="card-head">
                  <h2 className="h3">{d.title}</h2>
                  <span className={`tag ${n.read_at ? 'tag-quiet' : 'tag-warn'}`}>{n.read_at ? 'Leído' : 'Sin leer'}</span>
                </div>
                <p>{d.body}</p>
                {closed && <p><span className="tag tag-quiet">{closed}</span></p>}
                <p className="small muted">{instant(n.created_at)}</p>
                {actionable && (
                  <div className="cluster-s">
                    <button type="button" className="btn btn-small btn-primary" disabled={busy != null} onClick={() => void respond(n, true)}>
                      {n.kind === 'friend_request' ? 'Aceptar solicitud' : 'Unirme al viaje'}
                    </button>
                    <button type="button" className="btn btn-small btn-secondary" disabled={busy != null} onClick={() => void respond(n, false)}>
                      {n.kind === 'friend_request' ? 'Rechazar solicitud' : 'Rechazar invitación'}
                    </button>
                  </div>
                )}
                {n.kind === 'trip_invitation' && n.state === 'accepted' && n.tripId && <Link to={`/viajes/${n.tripId}`}>Ir al viaje</Link>}
                {!n.read_at && (
                  <button type="button" className="btn btn-link" disabled={busy != null} onClick={() => void markRead([n.id])}>Marcar como leído</button>
                )}
              </li>
            );
          })}
        </ul>
      ))}
    </div>
  );
}
