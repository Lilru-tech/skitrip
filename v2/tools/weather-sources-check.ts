#!/usr/bin/env -S npx tsx
/**
 * Comprobación externa pequeña y de solo lectura de las fuentes candidatas para previsión, clima habitual y afluencia
 * (docs/METEO-AFLUENCIA.md). Imprime en el registro lo que devuelve cada servicio real: modelos, variables con dato,
 * horizonte, altitud de la celda, metadatos de actualización y conjuntos de datos abiertos. No usa claves ni secretos,
 * no escribe en la API ni en D1 y hace como mucho ~20 peticiones (unas 15 unidades de Open-Meteo).
 *
 *   npx tsx tools/weather-sources-check.ts
 */
export {};
const UA = 'SkiTrip-v2-source-check (read-only; private non-commercial trip planner)';
const out = (s: string) => console.log(s);

async function get(url: string): Promise<{ status: number; text: string }> {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json,text/plain,*/*' } });
    return { status: r.status, text: await r.text() };
  } catch (e) {
    return { status: 0, text: String((e as Error).message) };
  }
}
const json = (t: string) => { try { return JSON.parse(t); } catch { return null; } };

// Punto de prueba: Tosa d'Alp (zona alta de La Molina / Alp 2500). Solo para comprobar la API, no es el punto elegido.
const LAT = 42.3283, LON = 1.8936;
const HOURLY = ['temperature_2m', 'precipitation', 'rain', 'snowfall', 'wind_speed_10m', 'wind_gusts_10m'];

/** Resumen de una serie horaria: número de valores, nulos y último instante con dato. */
function series(times: string[], vals: (number | null)[]) {
  const n = vals.length, nulls = vals.filter((v) => v == null).length;
  let last = -1; vals.forEach((v, i) => { if (v != null) last = i; });
  return `${n - nulls}/${n} con dato, último ${last >= 0 ? times[last] : '—'}`;
}

async function forecast(models: string) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&elevation=nan&hourly=${HOURLY.join(',')}&models=${models}&forecast_days=16&timezone=Europe%2FMadrid`;
  const r = await get(url);
  out(`\n## Previsión · models=${models} · HTTP ${r.status}`);
  const j = json(r.text);
  if (!j || r.status !== 200) { out(r.text.slice(0, 400)); return; }
  out(`celda: lat ${j.latitude} lon ${j.longitude} · elevation ${j.elevation} m · tz ${j.timezone} ${j.utc_offset_seconds}s · unidades ${JSON.stringify(j.hourly_units)}`);
  for (const k of Object.keys(j.hourly).filter((k) => k !== 'time')) out(`  ${k}: ${series(j.hourly.time, j.hourly[k])}`);
}

async function meta(model: string) {
  const r = await get(`https://api.open-meteo.com/data/${model}/static/meta.json`);
  const j = json(r.text);
  const iso = (s?: number) => (s ? new Date(s * 1000).toISOString() : '—');
  out(`meta ${model}: HTTP ${r.status}${j ? ` · init ${iso(j.last_run_initialisation_time)} · disponible ${iso(j.last_run_availability_time)} · intervalo ${j.update_interval_seconds}s · resolución temporal ${j.temporal_resolution_seconds}s` : ` · ${r.text.slice(0, 120)}`}`);
}

async function archive(model: string) {
  const daily = ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'rain_sum', 'snowfall_sum', 'wind_speed_10m_max', 'wind_gusts_10m_max'];
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${LAT}&longitude=${LON}&elevation=nan&start_date=2025-02-01&end_date=2025-02-14&daily=${daily.join(',')}&models=${model}&timezone=Europe%2FMadrid`;
  const r = await get(url);
  out(`\n## Histórico · models=${model} · HTTP ${r.status}`);
  const j = json(r.text);
  if (!j || r.status !== 200) { out(r.text.slice(0, 400)); return; }
  out(`celda: lat ${j.latitude} lon ${j.longitude} · elevation ${j.elevation} m · unidades ${JSON.stringify(j.daily_units)}`);
  for (const k of Object.keys(j.daily).filter((k) => k !== 'time')) out(`  ${k}: ${series(j.daily.time, j.daily[k])} · ${JSON.stringify(j.daily[k].slice(0, 4))}`);
}

out(`# Comprobación de fuentes · ${new Date().toISOString()}`);
// ¿Qué cambia la «elevation» de Open-Meteo? Misma consulta con la altitud de la celda (nan) y con la del punto (2478 m).
for (const m of ['ecmwf_ifs', 'icon_seamless', 'meteofrance_seamless']) {
  const sums: string[] = [];
  for (const el of ['nan', '2478']) {
    const r = await get(`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&elevation=${el}&hourly=${HOURLY.join(',')}&models=${m}&forecast_days=3&timezone=Europe%2FMadrid`);
    const j = json(r.text);
    if (!j?.hourly) { sums.push(`elevation=${el}: HTTP ${r.status}`); continue; }
    const agg = (k: string, f: 'sum' | 'max' | 'mean') => { const v = (j.hourly[k] as (number | null)[]).filter((x): x is number => x != null); const s = v.reduce((a, b) => a + b, 0); return (f === 'sum' ? s : f === 'max' ? Math.max(...v) : s / v.length).toFixed(2); };
    sums.push(`elevation=${el} → usada ${j.elevation} m · T media ${agg('temperature_2m', 'mean')} · precip ${agg('precipitation', 'sum')} · lluvia ${agg('rain', 'sum')} · nieve ${agg('snowfall', 'sum')} cm · viento máx ${agg('wind_speed_10m', 'max')} · racha máx ${agg('wind_gusts_10m', 'max')}`);
  }
  out(`elevation · ${m}: ${sums.join(' || ')}`);
}
// Previsión: varios modelos identificados del mismo proveedor (Open-Meteo redistribuye datos de ECMWF, DWD, Météo-France, NOAA).
for (const m of ['ecmwf_ifs', 'ecmwf_ifs025', 'icon_seamless', 'icon_eu', 'meteofrance_seamless', 'meteofrance_arome_france_hd', 'meteofrance_arome_france', 'gfs_seamless']) await forecast(m);
out('\n## Metadatos de actualización');
for (const m of ['ecmwf_ifs', 'ecmwf_ifs025', 'dwd_icon', 'dwd_icon_eu', 'dwd_icon_d2', 'meteofrance_arome_france_hd', 'meteofrance_arome_france0025', 'meteofrance_arpege_europe', 'ncep_gfs013', 'ncep_gfs025']) await meta(m);
// Clima habitual: reconstrucciones (reanálisis) disponibles.
for (const m of ['era5', 'era5_land', 'era5_seamless', 'cerra', 'ecmwf_ifs']) await archive(m);
// Ensembles: miembros por modelo (solo se cuenta; no se usa como probabilidad).
{
  const r = await get(`https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${LAT}&longitude=${LON}&hourly=snowfall&models=ecmwf_ifs025&forecast_days=3`);
  const j = json(r.text);
  out(`\n## Ensemble ecmwf_ifs025 · HTTP ${r.status} · series ${j?.hourly ? Object.keys(j.hourly).length - 1 : r.text.slice(0, 200)}`);
}

// Observaciones medidas: estaciones automáticas XEMA (Meteocat) en el portal de datos abiertos de la Generalitat.
{
  const r = await get('https://analisi.transparenciacatalunya.cat/resource/yqwd-vj5e.json?$limit=1000');
  const rows = json(r.text);
  out(`\n## XEMA metadatos de estaciones (yqwd-vj5e) · HTTP ${r.status} · ${Array.isArray(rows) ? rows.length : 0} filas`);
  if (Array.isArray(rows) && rows.length) {
    out(`campos: ${Object.keys(rows[0]).join(', ')}`);
    const alt = (x: any) => Number(x.altitud ?? x.altitude ?? x.alt ?? NaN);
    for (const x of rows.filter((x: any) => alt(x) >= 1400).sort((a: any, b: any) => alt(b) - alt(a)))
      out(`  ${x.codi_estacio ?? x.codi} · ${x.nom_estacio ?? x.nom} · ${alt(x)} m · ${x.latitud},${x.longitud} · ${x.nom_estat_ema ?? x.estat ?? ''} · alta ${x.data_inici ?? ''} baja ${x.data_fi ?? ''} · ${x.nom_comarca ?? ''}`);
  } else out(r.text.slice(0, 300));
  for (const id of ['yqwd-vj5e', '7bvh-jvq2']) {
    const v = json((await get(`https://analisi.transparenciacatalunya.cat/api/views/${id}.json`)).text);
    out(`licencia ${id}: ${JSON.stringify(v?.license ?? v?.metadata?.license ?? null)} · ${v?.licenseId ?? ''} · atribución ${v?.attribution ?? ''} ${v?.attributionLink ?? ''}`);
  }
  const vars = await get("https://analisi.transparenciacatalunya.cat/resource/7bvh-jvq2.json?$select=codi_variable,nom_variable,unitat,count(*),min(data_lectura),max(data_lectura)&$where=codi_estacio='ZD'&$group=codi_variable,nom_variable,unitat&$limit=100");
  out(`XEMA diarios (7bvh-jvq2) variables de la Tosa d'Alp (ZD) · HTTP ${vars.status}`);
  for (const x of json(vars.text) ?? []) out(`  ${x.codi_variable} · ${x.nom_variable} · ${x.unitat} · ${x.count} días · ${x.min_data_lectura?.slice(0, 10)} → ${x.max_data_lectura?.slice(0, 10)}`);
  const cover = await get("https://analisi.transparenciacatalunya.cat/resource/7bvh-jvq2.json?$select=codi_estacio,count(*),min(data_lectura),max(data_lectura)&$where=codi_estacio in('ZD','DG','Z2','Z7','Z1','ZE','Z8','ZC')&$group=codi_estacio&$limit=20");
  out(`XEMA diarios · cobertura por estación · HTTP ${cover.status} · ${cover.text.replace(/\s+/g, ' ').slice(0, 1200)}`);
}

// Afluencia: catálogo de datos abiertos de FGC (no se descarga ningún conjunto, solo la lista).
{
  const robots = await get('https://fgc.opendatasoft.com/robots.txt');
  out(`\n## FGC opendatasoft robots.txt · HTTP ${robots.status}\n${robots.text.slice(0, 400)}`);
  const r = await get('https://fgc.opendatasoft.com/api/explore/v2.1/catalog/datasets?limit=100&select=dataset_id');
  const j = json(r.text);
  out(`catálogo · HTTP ${r.status} · ${j?.results ? j.results.map((x: any) => x.dataset_id).join(', ') : r.text.slice(0, 300)}`);
  const q = await get('https://fgc.opendatasoft.com/api/explore/v2.1/catalog/datasets?limit=50&where=search(%22esqui%22)%20or%20search(%22neu%22)%20or%20search(%22estacio%22)&select=dataset_id');
  out(`búsqueda esquí/neu/estació · HTTP ${q.status} · ${q.text.slice(0, 600)}`);
}
