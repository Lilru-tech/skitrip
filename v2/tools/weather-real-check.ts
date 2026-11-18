/**
 * Comprobación real y de solo lectura de la previsión (docs/METEO-AFLUENCIA.md): hace a Open-Meteo la MISMA petición
 * que el Worker para 2 puntos (La Molina y Formigal) y la agrega con el mismo código, y comprueba la serie de clima de
 * una temporada (tools/climate-prepare.ts --probe). Imprime en el registro; no escribe en ningún sitio ni usa claves.
 * Consumo: 2 × 1,8 + 14,5 ≈ 18 llamadas ponderadas.   npx tsx tools/weather-real-check.ts
 */
import { forecastQuery, WEATHER_POINTS } from '../src/worker/weather';
import { dailyFromHourly, FORECAST_MODELS, forecastDays, splitModels, tripSummary, type StoredForecast } from '../src/core/weather';
import { todayMadrid } from '../src/core/dates';
import { addDaysIso } from '../src/core/weather';

const pts = ['la-molina', 'formigal'].map((id) => WEATHER_POINTS.get(id)!);
const res = await fetch(`https://api.open-meteo.com/v1/forecast?${forecastQuery(pts)}`, { headers: { 'user-agent': 'SkiTrip (private non-commercial trip planner)' } });
console.log(`Previsión (2 puntos, 3 modelos): HTTP ${res.status}`);
if (!res.ok) { console.log(await res.text()); process.exit(1); }
const list = await res.json() as any[];
const today = todayMadrid();
for (const [i, p] of pts.entries()) {
  const per = splitModels(list[i].hourly ?? {});
  const f: StoredForecast = { areaId: p.areaId, fetchedAt: Date.now(), lat: list[i].latitude, lon: list[i].longitude, elevation: list[i].elevation, runs: {},
    days: Object.fromEntries(FORECAST_MODELS.map((m) => [m.id, dailyFromHourly(per[m.id])])) };
  console.log(`\n${p.areaId}: pedida ${p.elevation} m → celda ${f.lat},${f.lon} a ${f.elevation} m`);
  for (const m of FORECAST_MODELS) {
    const d = f.days[m.id] ?? [];
    console.log(`  ${m.id}: ${d.filter((x) => x.covered).length} días completos (${d.filter((x) => x.covered).map((x) => x.date).join(', ')})`);
  }
  const days = forecastDays(f, today, addDaysIso(today, 7), today);
  for (const d of days) console.log(`  ${d.date} ${d.horizon}: ${d.models.map((m) => m.id).join('+') || '—'} · nieve ${JSON.stringify(d.range.snow)} cm · lluvia ${JSON.stringify(d.range.rain)} mm · ${JSON.stringify(d.range.tMin)}/${JSON.stringify(d.range.tMax)} °C · rachas ${JSON.stringify(d.range.gustMax)} km/h`);
  console.log(`  Resumen D0–D3: ${JSON.stringify(tripSummary(days.slice(0, 4)))}`);
}
for (const m of FORECAST_MODELS) {
  const r = await fetch(`https://api.open-meteo.com/data/${m.meta}/static/meta.json`);
  const j = r.ok ? await r.json() as any : null;
  console.log(`meta ${m.id}: HTTP ${r.status} · pasada ${j?.last_run_initialisation_time ? new Date(j.last_run_initialisation_time * 1000).toISOString() : 'sin dato'}`);
}
