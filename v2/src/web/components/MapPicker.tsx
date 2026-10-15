// Mapa para marcar un punto de salida (Leaflet + teselas de OpenStreetMap, cargado solo al pedirlo). Marcar o mover el
// mapa no consulta nada: el punto solo se envía al pulsar «Calcular distancias desde aquí».
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export default function MapPicker({ value, onPick }: { value: { lat: number; lon: number } | null; onPick: (lat: number, lon: number) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.CircleMarker | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { center: value ? [value.lat, value.lon] : [41.6, 1.5], zoom: value ? 11 : 7, minZoom: 5, maxZoom: 17 });
    L.tileLayer(TILES, { attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19 }).addTo(m);
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
      <div ref={el} className="map-box" role="application" aria-label="Mapa para elegir el punto de salida" aria-describedby="map-help" data-testid="origin-map" />
    </div>
  );
}
