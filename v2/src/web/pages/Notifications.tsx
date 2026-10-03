import { useEffect, useState } from 'react';
import { errorMessage, get, post } from '../api';
import { Bell } from '../components/Icons';
import { Empty, ErrorState, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { euros, instant } from '../format';
import { useBusy, useResource } from '../hooks';
import { Link, usePageTitle } from '../router';

export interface NotificationItem { id: string; kind: string; payload: Record<string, unknown>; created_at: number; read_at: number | null }
interface NotificationsResponse { notifications: NotificationItem[]; unread: number }

const CHANGED = 'skitrip:notifications-changed';
const announceChange = () => window.dispatchEvent(new Event(CHANGED));

/** Campana de la cabecera: número de avisos sin leer. Se refresca al navegar y cuando cambian. */
export function NotificationsBell({ path }: { path: string }) {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => { get<NotificationsResponse>('/api/notifications').then((r) => { if (alive) setUnread(r.unread); }, () => { /* la campana no bloquea nada */ }); };
    load();
    window.addEventListener(CHANGED, load);
    return () => { alive = false; window.removeEventListener(CHANGED, load); };
  }, [path]);
  const label = unread === 0 ? 'Avisos: ninguno sin leer' : `Avisos: ${unread} sin leer`;
  return (
    <Link to="/avisos" className="bell-link" aria-label={label} aria-current={path === '/avisos' ? 'page' : undefined}>
      <Bell />
      {unread > 0 && <span className="bell-count" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
    </Link>
  );
}

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
  return { title: 'Aviso', body: typeof p.message === 'string' ? p.message : 'Hay novedades en SkiTrip.' };
}

export function NotificationsPage() {
  usePageTitle('Avisos');
  const toast = useToast();
  const { busy, run } = useBusy();
  const r = useResource(() => get<NotificationsResponse>('/api/notifications'), []);

  const markRead = async (ids: string[]) => {
    if (!ids.length) return;
    try {
      await run(ids.length === 1 ? ids[0] : 'all', () => post('/api/notifications/read', { ids }));
      const at = Date.now();
      r.setData((d) => d && ({ notifications: d.notifications.map((n) => (ids.includes(n.id) ? { ...n, read_at: n.read_at ?? at } : n)), unread: d.notifications.filter((n) => !n.read_at && !ids.includes(n.id)).length }));
      announceChange();
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
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
      <p className="lead-s">Avisos internos de SkiTrip, por ejemplo cuando cambia al menos un 3 % el precio de una oferta guardada o propuesta en tus viajes. No se envían correos.</p>
      {r.loading && !r.data && <Loading />}
      {r.error && !r.data && <ErrorState message={r.error} onRetry={r.reload} />}
      {r.data && (r.data.notifications.length === 0 ? (
        <Empty title="No tienes avisos">Cuando haya novedades en las ofertas que sigues aparecerán aquí. Puedes ver ofertas en <Link to="/comparar">Comparar</Link>.</Empty>
      ) : (
        <ul className="card-list" aria-label="Avisos">
          {r.data.notifications.map((n) => {
            const d = describe(n);
            return (
              <li key={n.id} className={`card${n.read_at ? ' is-muted' : ''}`}>
                <div className="card-head">
                  <h2 className="h3">{d.title}</h2>
                  <span className={`tag ${n.read_at ? 'tag-quiet' : 'tag-warn'}`}>{n.read_at ? 'Leído' : 'Sin leer'}</span>
                </div>
                <p>{d.body}</p>
                <p className="small muted">{instant(n.created_at)}</p>
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
