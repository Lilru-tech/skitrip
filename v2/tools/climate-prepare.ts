/**
 * Preparación del clima habitual (docs/METEO-AFLUENCIA.md §3). Descarga UNA vez, de Open-Meteo Historical (modelo
 * ERA5, «Histórico reconstruido»), la temporada 20/10 → 10/05 de cada año para cada punto meteorológico
 * (data/weather-points.json) y la envía a la ingesta del Worker. Es reanudable: pregunta qué temporadas hay ya y solo
 * descarga las que faltan, hasta un tope de unidades por ejecución (por defecto 3.500, por debajo del límite gratuito
 * de 5.000 por hora y 10.000 por día). Se pide la altitud del punto en pistas, como en la previsión.
 *
 *   SKITRIP_API_URL=… SKITRIP_INGEST_TOKEN=… npx tsx tools/climate-prepare.ts [--max-units 3500] [--dry-run]
 *   npx tsx tools/climate-prepare.ts --probe   (comprobación real: una temporada de un punto, sin enviar nada)
 *
 * No imprime la credencial ni la URL con ella. Uso no comercial y atribución CC BY 4.0 (se muestra en la ficha).
 */
import pointsDoc from '../data/weather-points.json';
import { CLIMATE_DAILY_VARS, CLIMATE_SEASONS, climateSeasonUnits, seasonEnd, seasonLength, seasonStart, seriesFromDaily } from '../src/core/climate';

const API = (process.env.SKITRIP_API_URL ?? '').replace(/\/$/, '');
const TOKEN = process.env.SKITRIP_INGEST_TOKEN ?? '';
const ARCHIVE = (process.env.OPEN_METEO_ARCHIVE_URL ?? 'https://archive-api.open-meteo.com').replace(/\/$/, '');
const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const MAX_UNITS = Number(arg('--max-units') ?? 3500);
const DRY = process.argv.includes('--dry-run');
const PROBE = process.argv.includes('--probe');
const SPACING_MS = Number(process.env.CLIMATE_SPACING_MS ?? 2500); // ~24 peticiones/min ≈ 350 unidades/min (< 600)
const BATCH = 6;

type Point = { areaId: string; lat: number; lon: number; elevation: number };
const points = (pointsDoc.points as Point[]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(method: 'GET' | 'POST', path: string, body?: unknown) {
  const r = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => null) as any;
  if (!r.ok) throw new Error(`${method} ${path}: HTTP ${r.status} ${j?.error?.message ?? ''}`);
  return j;
}

const archiveQuery = (p: Point, season: number) => new URLSearchParams({
  latitude: String(p.lat), longitude: String(p.lon), elevation: String(p.elevation), start_date: seasonStart(season), end_date: seasonEnd(season),
  daily: CLIMATE_DAILY_VARS.join(','), models: 'era5', timezone: 'Europe/Madrid',
});

/** Comprobación real de solo lectura: la misma petición y validación que la preparación, para un punto y una temporada. */
async function probe() {
  const p = points.find((x) => x.areaId === 'la-molina') ?? points[0];
  const season = 2024;
  const r = await fetch(`${ARCHIVE}/v1/archive?${archiveQuery(p, season)}`, { headers: { 'user-agent': 'SkiTrip (private non-commercial trip planner)' } });
  console.log(`Archivo ERA5 ${p.areaId} temporada ${season}: HTTP ${r.status}`);
  if (!r.ok) { process.exitCode = 1; return; }
  const j = await r.json() as any;
  const s = seriesFromDaily(j.daily ?? {}, season);
  const nn = (a: (number | null)[]) => a.filter((v) => v != null).length;
  console.log(`Celda ${j.latitude},${j.longitude} a ${j.elevation} m (pedida ${p.elevation} m) · zona ${j.timezone} · ${s.tmax.length} días`);
  console.log(`Días con dato: tmax ${nn(s.tmax)}, tmin ${nn(s.tmin)}, precip ${nn(s.precip)}, lluvia ${nn(s.rain)}, nieve ${nn(s.snow)}, rachas ${nn(s.gust)}`);
  const i = 87; // 15/01
  console.log(`15/01/2025: máx ${s.tmax[i]} °C, mín ${s.tmin[i]} °C, precip ${s.precip[i]} mm, nieve ${s.snow[i]} cm, racha ${s.gust[i]} km/h`);
}

async function main() {
  if (PROBE) return probe();
  if (!API || TOKEN.length < 16) throw new Error('Faltan SKITRIP_API_URL o SKITRIP_INGEST_TOKEN.');
  const have = new Map<string, number | null>();
  for (const s of (await api('GET', '/api/ingest/climate-status')).seasons as { areaId: string; season: number; requestedElevation: number | null }[]) have.set(`${s.areaId}|${s.season}`, s.requestedElevation);
  // Falta la temporada o se pidió con otra altitud (si el punto cambió de cota se vuelve a preparar).
  const todo = points.flatMap((p) => CLIMATE_SEASONS.filter((y) => have.get(`${p.areaId}|${y}`) !== p.elevation).map((season) => ({ p, season })));
  const total = todo.reduce((s, t) => s + climateSeasonUnits(seasonLength(t.season)), 0);
  console.log(`Puntos: ${points.length} · temporadas por punto: ${CLIMATE_SEASONS.length} (${CLIMATE_SEASONS[0]}–${CLIMATE_SEASONS.at(-1)}) · guardadas: ${have.size} · pendientes: ${todo.length} (≈ ${Math.round(total)} unidades)`);
  console.log(`Tope de esta ejecución: ${MAX_UNITS} unidades${DRY ? ' · simulación: no se descarga ni se envía nada' : ''}`);
  if (DRY || !todo.length) return;

  let used = 0, done = 0, failed = 0;
  let pending: unknown[] = [];
  const flush = async () => {
    if (!pending.length) return;
    const r = await api('POST', '/api/ingest/climate', { rows: pending });
    console.log(`  enviadas ${r.received}, guardadas ${r.written}`);
    pending = [];
  };
  for (const { p, season } of todo) {
    const units = climateSeasonUnits(seasonLength(season));
    if (used + units > MAX_UNITS) { console.log(`Tope de unidades alcanzado (${Math.round(used)}): se sigue en la próxima ejecución.`); break; }
    const q = archiveQuery(p, season);
    used += units;
    try {
      const r = await fetch(`${ARCHIVE}/v1/archive?${q}`, { headers: { 'user-agent': 'SkiTrip (private non-commercial trip planner)' } });
      if (r.status === 429) { console.log(`Open-Meteo limita las consultas (429) en ${p.areaId} ${season}: se para y se reanuda en otra ejecución.`); break; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json() as any;
      const series = seriesFromDaily(j.daily ?? {}, season);
      const nulls = series.tmax.filter((v) => v == null).length;
      pending.push({ areaId: p.areaId, season, requestedElevation: p.elevation, cell: { lat: j.latitude, lon: j.longitude, elevation: j.elevation }, series });
      done++;
      console.log(`${p.areaId} ${season}: ${series.tmax.length} días, celda ${j.latitude},${j.longitude} a ${j.elevation} m${nulls ? ` · ${nulls} días sin temperatura` : ''}`);
      if (pending.length >= BATCH) await flush();
    } catch (e) {
      failed++;
      console.log(`${p.areaId} ${season}: FALLO ${(e as Error).message}`);
    }
    await sleep(SPACING_MS);
  }
  await flush();
  console.log(`Resumen: ${done} temporadas descargadas y enviadas, ${failed} fallidas, ≈ ${Math.round(used)} unidades usadas.`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(`Error: ${(e as Error).message}`); process.exitCode = 1; });
