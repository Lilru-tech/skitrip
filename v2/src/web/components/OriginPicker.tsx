// Elegir un origen personalizado: buscar una dirección o marcar un punto en el mapa y, al confirmar, calcular las
// distancias por carretera hasta el acceso de cada estación (Geoapify). Solo se consulta al pulsar «Buscar» o
// «Calcular distancias»: nunca al escribir ni al mover el mapa.
import { lazy, Suspense, useState, type FormEvent } from 'react';
import { ApiError, errorMessage, get, post } from '../api';
import { useResource } from '../hooks';
import { setQuery } from '../router';
import { pointLabel, setCustomOrigin, type CustomOrigin, type CustomRoute } from '../origin';

const MapPicker = lazy(() => import('./MapPicker'));

interface GeoStatus { enabled: boolean; attribution: string; user: { used: number; cap: number }; global: { used: number; cap: number } }
interface Place { label: string; lat: number; lon: number; kind: string | null }

/** Vuelve a un origen fijo (sus distancias son las suyas, no las del origen personalizado). */
function FixedOrigins() {
  return (
    <span className="origin-fixed">
      <button type="button" className="btn btn-secondary btn-small" onClick={() => setQuery('origen', null)}>Usar Tarragona</button>
      <button type="button" className="btn btn-secondary btn-small" onClick={() => setQuery('origen', 'sabadell')}>Usar Sabadell</button>
    </span>
  );
}

export function OriginPicker({ origin }: { origin: CustomOrigin | null }) {
  const status = useResource(() => get<GeoStatus>('/api/geo/status'), []);
  const [editing, setEditing] = useState(!origin || origin.routes.length === 0);
  const [text, setText] = useState('');
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [chosen, setChosen] = useState<Place | null>(origin ? { label: origin.label, lat: origin.lat, lon: origin.lon, kind: null } : null);
  const [showMap, setShowMap] = useState(false);
  const [remember, setRemember] = useState(origin?.remembered ?? false);
  const [busy, setBusy] = useState<'search' | 'routes' | null>(null);
  const [error, setError] = useState<{ message: string; limit: boolean } | null>(null);

  const fail = (e: unknown) => setError({ message: errorMessage(e), limit: e instanceof ApiError && (e.status === 429 || e.status === 503) });

  async function search(ev: FormEvent) {
    ev.preventDefault();
    if (text.trim().length < 3) { setError({ message: 'Escribe al menos 3 letras de la dirección o el municipio.', limit: false }); return; }
    setBusy('search'); setError(null); setPlaces(null);
    try {
      const r = await post<{ results: Place[] }>('/api/geo/search', { text: text.trim() });
      setPlaces(r.results);
      if (r.results.length === 1) setChosen(r.results[0]);
    } catch (e) { fail(e); } finally { setBusy(null); void status.reload(); }
  }

  async function computeRoutes() {
    if (!chosen) return;
    setBusy('routes'); setError(null);
    try {
      const r = await post<{ routes: CustomRoute[]; checkedOn: string; attribution: string }>('/api/geo/routes', { lat: chosen.lat, lon: chosen.lon });
      setCustomOrigin({ label: chosen.label, lat: chosen.lat, lon: chosen.lon, routes: r.routes, checkedOn: r.checkedOn, attribution: r.attribution,
        tollsCentsPerCar: origin && origin.lat === chosen.lat && origin.lon === chosen.lon ? origin.tollsCentsPerCar : null, remembered: remember });
      setEditing(false); setPlaces(null); setShowMap(false);
    } catch (e) { fail(e); } finally { setBusy(null); void status.reload(); }
  }

  const st = status.data;
  const left = st ? Math.max(0, Math.min(st.user.cap - st.user.used, st.global.cap - st.global.used)) : null;
  return (
    <section className="notice stack-s origin-picker" aria-label="Origen personalizado">
      <p className="small">
        <strong>Privado:</strong> la dirección o el punto se envían a Geoapify, el proveedor de mapas, para buscarlo y calcular las rutas.
        SkiTrip no lo guarda, no lo publica y no lo pone en la dirección de la página. Solo queda en esta pestaña, salvo que marques «Recordar en este navegador».
      </p>
      {status.error && <p className="small text-warn">No se pudo comprobar el servicio de mapas: {status.error}</p>}
      {st && !st.enabled && (
        <div className="stack-s">
          <p className="small text-warn">El origen personalizado aún no está activado en SkiTrip. Mientras tanto, compara desde un origen fijo.</p>
          <FixedOrigins />
        </div>
      )}

      {origin && !editing && (
        <div className="stack-s">
          <p><strong>Salida desde: {origin.label}</strong></p>
          <p className="small muted">Distancias y tiempos aproximados en coche hasta el acceso de cada estación, calculados el {new Date(origin.checkedOn).toLocaleDateString('es-ES')}. Sin tráfico ni estado de las carreteras en invierno. Los peajes desde aquí no están confirmados.</p>
          <div className="actions-row">
            <button type="button" className="btn btn-secondary btn-small" onClick={() => setEditing(true)}>Cambiar origen</button>
            <label className="check small"><input type="checkbox" checked={origin.remembered} onChange={(e) => setCustomOrigin({ ...origin, remembered: e.target.checked })} /> Recordar en este navegador</label>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => { setCustomOrigin(null); setChosen(null); setEditing(true); }}>Olvidar este origen</button>
          </div>
        </div>
      )}

      {st?.enabled && editing && (
        <div className="stack-s">
          <form className="origin-search" onSubmit={search} role="search" aria-label="Buscar dirección de salida">
            <label htmlFor="origin-q">Dirección o municipio de salida</label>
            <div className="origin-search-row">
              <input id="origin-q" type="text" autoComplete="off" value={text} maxLength={200} placeholder="p. ej. Reus o una calle con número" onChange={(e) => setText(e.target.value)} />
              <button type="submit" className="btn btn-secondary btn-small" disabled={busy !== null}>{busy === 'search' ? 'Buscando…' : 'Buscar'}</button>
            </div>
          </form>
          {places && places.length === 0 && <p className="small text-warn">No se ha encontrado esa dirección en España, Andorra o Francia. Prueba con el municipio o marca el punto en el mapa.</p>}
          {places && places.length > 0 && (
            <fieldset className="origin-results">
              <legend className="small">Resultados</legend>
              {places.map((p, i) => (
                <label key={i} className="radio"><input type="radio" name="origin-place" checked={chosen?.lat === p.lat && chosen?.lon === p.lon} onChange={() => setChosen(p)} /> {p.label}</label>
              ))}
            </fieldset>
          )}
          {!showMap
            ? <button type="button" className="btn btn-ghost btn-small" onClick={() => setShowMap(true)}>Elegir un punto en el mapa</button>
            : (
              <Suspense fallback={<p className="small muted">Cargando mapa…</p>}>
                <MapPicker value={chosen} onPick={(lat, lon) => setChosen({ label: pointLabel(lat, lon), lat, lon, kind: 'point' })} />
              </Suspense>
            )}
          {chosen && <p className="small">Elegido: <strong>{chosen.label}</strong></p>}
          <label className="check small"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Recordar en este navegador (si no, se olvida al cerrar la pestaña)</label>
          <div className="actions-row">
            <button type="button" className="btn btn-primary btn-small" disabled={!chosen || busy !== null} onClick={computeRoutes}>{busy === 'routes' ? 'Calculando…' : 'Calcular distancias desde aquí'}</button>
            {origin && origin.routes.length > 0 && <button type="button" className="btn btn-ghost btn-small" onClick={() => setEditing(false)}>Cancelar</button>}
          </div>
          {left != null && <p className="small muted">Consultas de mapa que te quedan hoy: {left} (una búsqueda gasta 1; calcular distancias, una por estación). Se renuevan cada día.</p>}
        </div>
      )}

      {error && (
        <div className="stack-s" role="alert">
          <p className="small text-warn">{error.message}</p>
          {error.limit && <FixedOrigins />}
        </div>
      )}
      <p className="tiny muted">{st?.attribution ?? 'Powered by Geoapify · © OpenStreetMap contributors'}</p>
    </section>
  );
}
