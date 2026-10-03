import type { ReactNode } from 'react';
import { get } from '../api';
import { useResource } from '../hooks';
import { Link, usePageTitle } from '../router';
import { ErrorState, Loading } from './States';
import type { TripDetail } from '../types';

export const TRIP_TABS = [
  { id: 'resumen', label: 'Resumen', path: '' },
  { id: 'calendario', label: 'Calendario', path: '/calendario' },
  { id: 'presupuesto', label: 'Presupuesto', path: '/presupuesto' },
  { id: 'candidaturas', label: 'Candidaturas', path: '/candidaturas' },
  { id: 'busquedas', label: 'Búsquedas', path: '/busquedas' },
  { id: 'gastos', label: 'Gastos', path: '/gastos' },
  { id: 'comentarios', label: 'Comentarios', path: '/comentarios' },
] as const;
export type TripTabId = (typeof TRIP_TABS)[number]['id'];

export function TripTabs({ tripId, current }: { tripId: string; current: TripTabId }) {
  return (
    <nav className="trip-tabs" aria-label="Secciones del viaje">
      {TRIP_TABS.map((t) => (
        <Link key={t.id} to={`/viajes/${tripId}${t.path}`} className="trip-tab" aria-current={current === t.id ? 'page' : undefined}>{t.label}</Link>
      ))}
      <Link to={`/compra?viaje=${tripId}`} className="trip-tab">Compra</Link>
    </nav>
  );
}

/** Cabecera común de las pestañas del viaje: carga el viaje, muestra nombre y pestañas. */
export function TripShell({ tripId, tab, title, children }: { tripId: string; tab: TripTabId; title: string; children: (d: TripDetail, reload: () => Promise<void>) => ReactNode }) {
  const detail = useResource(() => get<TripDetail>(`/api/trips/${tripId}`), [tripId]);
  usePageTitle(detail.data ? `${title} · ${detail.data.trip.name}` : title);
  if (detail.loading && !detail.data) return <div className="page"><Loading /></div>;
  if (detail.error && !detail.data) return <div className="page"><h1>{title}</h1><ErrorState message={detail.error} onRetry={detail.reload} /><p><Link to="/viajes">Volver a mis viajes</Link></p></div>;
  const d = detail.data!;
  return (
    <div className="page page-wide">
      <p className="breadcrumb"><Link to="/viajes">Mis viajes</Link> <span aria-hidden="true">/</span> <Link to={`/viajes/${tripId}`}>{d.trip.name}</Link></p>
      <h1>{title}</h1>
      <TripTabs tripId={tripId} current={tab} />
      {children(d, detail.reload)}
    </div>
  );
}
