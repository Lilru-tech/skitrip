import { useEffect, useRef, useState } from 'react';
import { errorMessage, post } from '../api';
import { ErrorState, Loading } from '../components/States';
import { currentRoute, Link, navigate, usePageTitle } from '../router';

/** Aceptar una invitación por enlace: #/unirse?t=<token>. Va en el fragmento: nunca viaja en la URL a ningún servidor. */
export function JoinPage() {
  usePageTitle('Unirse a un viaje');
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(currentRoute().split('?')[1] ?? '').get('t') ?? '';
    // Quitar el token de la barra de direcciones y del historial.
    navigate('/unirse', { replace: true });
    if (!token) { setError('El enlace no contiene una invitación. Pide a quien te invitó que te lo vuelva a enviar.'); return; }
    post<{ ok: boolean; tripId: string }>('/api/trips/invitations/accept-link', { token })
      .then((r) => navigate(`/viajes/${r.tripId}`, { replace: true }))
      .catch((e) => setError(errorMessage(e) + ' Puede que el enlace haya caducado o ya se haya usado.'));
  }, []);

  return (
    <div className="page page-narrow">
      <h1>Unirse a un viaje</h1>
      {error ? <><ErrorState message={error} /><p><Link to="/viajes">Ir a mis viajes</Link></p></> : <Loading label="Aceptando la invitación…" />}
    </div>
  );
}
