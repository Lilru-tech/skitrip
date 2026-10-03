// Primeros pasos: añadir amigos, compartir disponibilidad y crear el primer viaje. Cada paso se marca hecho con los
// datos reales de la cuenta (no con una casilla), y el panel desaparece cuando los tres están hechos.
import { get } from '../api';
import { useResource } from '../hooks';
import { Link } from '../router';
import { useProfile } from '../session';
import { plural } from '../format';
import type { FriendsResponse, SharesResponse } from '../types';

export interface LegacySummary {
  comments: { total: number; published: number; pending: number; general: number; linked: number };
  availability: { days: number; people: number; linkedDays: number; unlinkedDays: number; incorporated: number; pastDays: number; firstDay: string | null; lastDay: string | null };
  shopping: { total: number };
  names: { name: string; days: number; comments: number; state: 'linked' | 'unlinked' | 'partial'; userId: string | null; alias: string | null }[];
  note: string;
}

export function GettingStarted({ tripCount, onCreateTrip }: { tripCount: number; onCreateTrip: () => void }) {
  const friends = useResource(() => get<FriendsResponse>('/api/friends'), []);
  const shares = useResource(() => get<SharesResponse>('/api/availability/shares'), []);
  if (!friends.data || !shares.data) return null; // sin datos no se afirma nada; el resto de la página sigue
  const nFriends = friends.data.friends.length;
  const waiting = friends.data.outgoing.length;
  const incoming = friends.data.incoming.length;
  const shared = shares.data.friends || shares.data.trips.length > 0;
  const steps = [
    {
      key: 'amigos', done: nFriends > 0, title: 'Añade a tu grupo como amigos',
      text: nFriends > 0 ? `${plural(nFriends, 'amistad', 'amistades')} en SkiTrip.`
        : incoming > 0 ? `${plural(incoming, 'solicitud recibida', 'solicitudes recibidas')} esperando tu respuesta.`
          : waiting > 0 ? `${plural(waiting, 'solicitud enviada', 'solicitudes enviadas')}; falta que la acepten.`
            : 'Búscalos por su alias. Así podrán invitarte a viajes.',
      action: <Link to="/amigos" className="btn btn-small btn-secondary">{incoming > 0 ? 'Responder solicitudes' : 'Buscar amigos'}</Link>,
    },
    {
      key: 'disponibilidad', done: shared, title: 'Marca y comparte tu disponibilidad',
      text: shared ? 'Tu disponibilidad está compartida.' : 'Marca los días libres de la temporada y elige quién los ve. Sin compartir, nadie cuenta contigo al buscar fechas.',
      action: <span className="cluster-s"><Link to="/calendario" className="btn btn-small btn-secondary">Marcar días</Link><Link to="/calendario?vista=compartir" className="btn btn-small btn-ghost">Compartir</Link></span>,
    },
    {
      key: 'viaje', done: tripCount > 0, title: 'Crea vuestro primer viaje',
      text: tripCount > 0 ? 'Ya tienes un viaje.' : 'Ponle nombre; fechas, estación y presupuesto se pueden decidir después con el grupo.',
      action: <button type="button" className="btn btn-small btn-primary" onClick={onCreateTrip}>Crear un viaje</button>,
    },
  ];
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  return (
    <section className="panel panel-accent stack" aria-labelledby="start-h">
      <div className="panel-head">
        <h2 id="start-h">Primeros pasos</h2>
        <span className="small muted" aria-live="polite">{done} de {steps.length} hechos</span>
      </div>
      <ol className="steps" aria-label="Pasos para empezar">
        {steps.map((s, i) => (
          <li key={s.key} className={`step ${s.done ? 'is-done' : ''}`}>
            <span className="step-mark" aria-hidden="true">{s.done ? '✓' : i + 1}</span>
            <span className="step-title">{s.title}{s.done && <span className="visually-hidden"> (hecho)</span>}</span>
            <div className="step-body"><p>{s.text}</p>{!s.done && s.action}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Aviso para administración: lo que queda por revisar de la hoja antigua, con enlace al recorrido guiado. */
export function LegacyPendingNotice() {
  const me = useProfile();
  const r = useResource(() => (me.role === 'admin' ? get<LegacySummary>('/api/admin/legacy/summary') : Promise.resolve(null)), [me.role]);
  const s = r.data;
  if (!s) return null;
  const unlinked = s.names.filter((n) => n.state !== 'linked').length;
  if (!s.comments.pending && !unlinked) return null;
  return (
    <section className="notice notice-info cluster" aria-labelledby="legacy-pending-h">
      <p><strong id="legacy-pending-h">Datos de la hoja antigua por revisar:</strong>{' '}
        {[s.comments.pending ? plural(s.comments.pending, 'comentario sin publicar', 'comentarios sin publicar') : null,
          unlinked ? plural(unlinked, 'nombre sin vincular', 'nombres sin vincular') : null].filter(Boolean).join(' · ')}.
        {' '}Nada se publica ni se asigna sin tu elección.</p>
      <Link to="/admin" className="btn btn-small btn-secondary">Revisar la hoja antigua</Link>
    </section>
  );
}
