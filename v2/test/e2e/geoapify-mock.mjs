// Geoapify simulado para los E2E (sin red ni clave real). Responde con la forma de la API pública:
// /v1/geocode/search y /v1/routematrix. Distancia = línea recta × 1,25 a 80 km/h. «error» en el texto → 500.
import { createServer } from 'node:http';

const PORT = Number(process.env.GEO_MOCK_PORT || 8790);
const PLACES = {
  reus: { formatted: 'Reus, Baix Camp, Tarragona, España', lat: 41.1561, lon: 1.1069, result_type: 'city' },
  tarragona: { formatted: 'Tarragona, España', lat: 41.1189, lon: 1.2445, result_type: 'city' },
};
const rad = (d) => (d * Math.PI) / 180;
function km([lon1, lat1], [lon2, lat2]) {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}
const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

// Open-Meteo simulado: previsión horaria de 8 días con 3 modelos (MF solo 4 días, ICON 7,5) y meta.json de cada modelo.
const H = { ecmwf_ifs: 192, icon_seamless: 180, meteofrance_seamless: 96 };
function meteo(url, res) {
  if (url.pathname.endsWith('/meta.json')) return json(res, 200, { last_run_initialisation_time: Math.floor(Date.now() / 1000 / 21600) * 21600 - 21600 });
  if (url.pathname !== '/meteo/v1/forecast') return json(res, 404, { error: 'not found' });
  const lats = (url.searchParams.get('latitude') || '').split(',');
  const elev = (url.searchParams.get('elevation') || '').split(',');
  const t0 = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) / 1000 - 3600;
  const time = Array.from({ length: 193 }, (_, i) => t0 + i * 3600);
  const loc = (i) => {
    const hourly = { time };
    for (const [m, n] of Object.entries(H)) {
      const v = (f) => time.map((_, h) => (h < n ? f(h) : null));
      Object.assign(hourly, {
        [`temperature_2m_${m}`]: v((h) => -4 + (h % 24) / 4), [`precipitation_${m}`]: v((h) => (m === 'icon_seamless' && h % 24 === 12 ? 2 : 0)),
        [`rain_${m}`]: v(() => 0), [`snowfall_${m}`]: v((h) => (m === 'icon_seamless' && h % 24 === 12 ? 1.4 : 0)),
        [`wind_speed_10m_${m}`]: v(() => 15), [`wind_gusts_10m_${m}`]: v((h) => (m === 'ecmwf_ifs' && h % 24 === 13 ? 65 : 35)),
      });
    }
    return { latitude: Number(lats[i]), longitude: 1.6, elevation: Number(elev[i]), hourly };
  };
  return json(res, 200, lats.length === 1 ? loc(0) : lats.map((_, i) => loc(i)));
}

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/health') return json(res, 200, { ok: true });
  if (url.pathname.startsWith('/meteo/')) return meteo(url, res);
  if (url.searchParams.get('apiKey') !== 'e2e-geo-key-not-a-secret') return json(res, 401, { error: 'key' });
  if (url.pathname === '/v1/geocode/search') {
    const text = (url.searchParams.get('text') || '').toLowerCase();
    if (text.includes('error')) return json(res, 500, { error: 'simulado' });
    const hit = Object.entries(PLACES).find(([k]) => text.includes(k));
    return json(res, 200, { results: hit ? [hit[1]] : [] });
  }
  if (url.pathname === '/v1/routematrix' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const b = JSON.parse(raw);
      const src = b.sources[0].location;
      const row = b.targets.map((t, i) => {
        const d = km(src, t.location) * 1.25;
        return { source_index: 0, target_index: i, distance: Math.round(d * 1000), time: Math.round((d / 80) * 3600) };
      });
      json(res, 200, { sources_to_targets: [row] });
    });
    return;
  }
  json(res, 404, { error: 'not found' });
}).listen(PORT, () => console.log(`geoapify mock on ${PORT}`));
