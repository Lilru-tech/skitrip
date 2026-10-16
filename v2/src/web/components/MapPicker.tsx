// Mapa para marcar un punto de salida (Leaflet + teselas de OpenStreetMap, cargado solo al pedirlo). Marcar o mover el
// mapa no consulta nada: el punto solo se envía al pulsar «Calcular distancias desde aquí».
//
// Política de teselas de OpenStreetMap (https://operations.osmfoundation.org/policies/tiles/): las peticiones deben
// llevar un Referer válido y atribución visible, y respetar la caché HTTP. La página entera usa referrer=no-referrer
// (index.html) para no filtrar rutas con datos del viaje; solo las teselas usan `strict-origin`, que envía únicamente el
// origen del sitio (https://lilru-tech.github.io/), sin ruta ni fragmento (#/comparar…), y nada si se bajara a http.
// Las teselas no llevan parámetros propios: el navegador las cachea según las cabeceras de OSM.
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_REFERRER_POLICY = 'strict-origin' as const;

export default function MapPicker({ value, onPick }: { value: { lat: number; lon: number } | null; onPick: (lat: number, lon: number) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.CircleMarker | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  // Teselas: 'ok' en cuanto carga una; 'error' si fallan sin haber cargado ninguna (bloqueo, red o límite de OSM).
  const [tiles, setTiles] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { center: value ? [value.lat, value.lon] : [41.6, 1.5], zoom: value ? 11 : 7, minZoom: 5, maxZoom: 17 });
    const layer = L.tileLayer(TILES, {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19, referrerPolicy: TILE_REFERRER_POLICY,
    });
    let loaded = 0;
    layer.on('tileload', () => { loaded++; setTiles('ok'); });
    layer.on('tileerror', () => { if (!loaded) setTiles('error'); });
    layer.addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => pick.current(Math.round(e.latlng.lat * 1e5) / 1e5, Math.round(e.latlng.lng * 1e5) / 1e5));
    map.current = m;
    return () => { m.remove(); map.current = null; marker.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!value) { marker.current?.remove(); marker.current = null; return; }
    if (marker.current) marker.current.setLatLng([value.lat, value.lon]);
    else marker.current = L.circleMarker([value.lat, value.lon], { radius: 9, color: '#1f5f4a', weight: 3, fillOpacity: 0.5 }).addTo(m);
  }, [value?.lat, value?.lon]);

  return (
    <div className="map-picker stack-s">
      <p className="small muted" id="map-help">Toca o haz clic en el mapa para marcar la salida. Puedes acercar con los botones + y −.</p>
      {tiles === 'error' && (
        <p className="small text-warn" role="alert">
          No se han podido cargar las imágenes del mapa de OpenStreetMap (sin conexión, bloqueadas por el navegador o una extensión, o el servicio no responde).
          Puedes seguir marcando el punto sobre el mapa en blanco o, mejor, buscar la dirección o el municipio arriba.
        </p>
      )}
      <div ref={el} className="map-box" role="application" aria-label="Mapa para elegir el punto de salida" aria-describedby="map-help" data-testid="origin-map" />
    </div>
  );
}
