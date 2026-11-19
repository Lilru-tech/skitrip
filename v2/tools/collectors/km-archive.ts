#!/usr/bin/env -S npx tsx
/**
 * Km de partes archivados por la Wayback Machine (Internet Archive) para el comparador de km entre temporadas
 * (docs/KM-HISTORICO.md). Ejecución manual y única por temporada; no forma parte de la captura diaria.
 *   SKITRIP_API_URL=… SKITRIP_INGEST_TOKEN=… npx tsx tools/collectors/km-archive.ts            (solo muestra lo que encontraría)
 *   … --send                                                                                  (además lo guarda)
 * Lee las mismas fuentes de nieve que el recolector diario y, para cada página, las copias archivadas de noviembre a
 * mayo con el índice público CDX. Cada copia se analiza con el MISMO adaptador que la página viva (Esquiades u oficial);
 * si no da una fila reconocible, ese día queda sin dato. Nada se estima.
 * Fecha: la publicada en el parte (como mucho 3 días antes de la copia); si la copia no la trae, la de la copia en hora
 * de Madrid y solo si la copia es de las 09:00 o más tarde (antes podría seguir mostrando el parte del día anterior).
 */
import { esquiadesAdapter, type StatusRow } from '../../src/core/parsers/snow.ts';
import { aggregatorSnowOutcome } from '../../src/core/snow-outcome.ts';
import { OFFICIAL_ADAPTERS } from '../../src/core/parsers/official-snow.ts';
import { madridDate } from '../../src/core/dates.ts';
import { archiveDayOf as dayOf } from '../../src/core/km-history.ts';
import { apiGet, apiPost, requireConfig, robotsCheck } from './lib.ts';

type Source = { id: string; area_id: string; scope_area_id: string; provider: string; url: string; adapter: string; match_aliases: string | null; area_name: string };
export interface ArchiveRow {
  areaId: string; obsDate: string; dateBasis: 'report' | 'copy'; opStatus: string; openKm: number | null; totalKm: number | null;
  provider: string; originalUrl: string; archiveUrl: string; capturedAt: number; extractor: string;
}

const UA = 'SkiTripBot/2 (consulta puntual del archivo; +https://github.com/Lilru-tech/skitrip)';
const send = process.argv.includes('--send');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tsToMs = (ts: string) => Date.UTC(+ts.slice(0, 4), +ts.slice(4, 6) - 1, +ts.slice(6, 8), +ts.slice(8, 10), +ts.slice(10, 12), +ts.slice(12, 14));
const inSeason = (ts: string) => { const m = Number(ts.slice(4, 6)); return m >= 11 || m <= 5; };

async function get(url: string, timeoutMs = 60_000): Promise<Response> {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
      if (r.status === 429 || r.status >= 500) { await sleep(10_000 * (i + 1)); continue; }
      return r;
    } catch { await sleep(5000 * (i + 1)); }
  }
  throw new Error(`sin respuesta: ${url}`);
}

/** Marcas de las copias válidas (HTTP 200) de temporada, la más tardía de cada día primero. */
async function captures(url: string): Promise<string[]> {
  const q = new URLSearchParams({ url, output: 'json', fl: 'timestamp', filter: 'statuscode:200', from: '2010' });
  const r = await get(`https://web.archive.org/cdx/search/cdx?${q}`);
  if (!r.ok) throw new Error(`CDX ${r.status}`);
  const t = await r.text();
  const rows = (t.trim() ? JSON.parse(t) : []) as string[][];
  return rows.slice(1).map((x) => x[0]).filter(inSeason).sort().reverse();
}

/** Motivos de descarte, para el registro. */
const skipped = new Map<string, number>();
const skip = (why: string) => { skipped.set(why, (skipped.get(why) ?? 0) + 1); return null; };

function rowOf(base: Omit<ArchiveRow, 'obsDate' | 'dateBasis' | 'opStatus' | 'openKm' | 'totalKm'>, d: { opStatus: string; openKm: number | null; totalKm: number | null; sourceDate?: string | null }): ArchiveRow | null {
  const day = dayOf(d.sourceDate, base.capturedAt);
  if (!day) return skip(d.sourceDate ? 'fecha del parte fuera de los 3 días anteriores a la copia' : 'copia sin fecha de parte hecha antes de las 09:00');
  const closed = d.opStatus === 'closed_confirmed' || d.opStatus === 'out_of_season';
  if (!closed && d.openKm == null) return skip('sin km abiertos');
  if (d.openKm != null && d.totalKm != null && d.openKm > d.totalKm) return skip('abiertos > totales');
  // Las copias antiguas de Esquiades no traen el texto de estado: con km abiertos publicados (> 0) la estación estaba
  // abierta; con 0 y estado desconocido no se sabe si era cierre o «sin dato», y se descarta.
  let opStatus = d.opStatus;
  if (opStatus === 'unknown') { if (!(d.openKm! > 0)) return skip('0 km sin estado'); opStatus = 'open'; }
  return { ...base, ...day, opStatus, openKm: closed ? null : d.openKm, totalKm: d.totalKm };
}

if (!requireConfig()) process.exit(0);
const { sources } = await apiGet<{ sources: Source[] }>('/api/ingest/snow-sources');
const groups = new Map<string, Source[]>();
for (const s of sources) (groups.get(`${s.adapter}|${s.url}`) ?? groups.set(`${s.adapter}|${s.url}`, []).get(`${s.adapter}|${s.url}`)!).push(s);

const robots = await robotsCheck('https://web.archive.org/web/2020/https://example.com/');
if (robots.verdict !== 'allowed') { console.log(`::error::robots.txt de web.archive.org: ${robots.verdict}`); process.exit(1); }

const out: ArchiveRow[] = [];
for (const [key, group] of groups) {
  const [adapterId, url] = key.split('|');
  const official = OFFICIAL_ADAPTERS[adapterId];
  if (!official && adapterId !== 'esquiades-status') continue;
  let stamps: string[];
  try { stamps = await captures(url); } catch (e) { console.log(`## ${url}: ${(e as Error).message}`); continue; }
  await sleep(2000);
  const days = new Set<string>();
  let read = 0, unreadable = 0;
  for (const ts of stamps) {
    const at = tsToMs(ts);
    if (days.has(madridDate(at))) continue; // ya hay una copia más tardía de ese día
    const archiveUrl = `https://web.archive.org/web/${ts}/${url}`;
    let html: string;
    try {
      const r = await get(`https://web.archive.org/web/${ts}id_/${url}`);
      if (!r.ok) { unreadable++; continue; }
      html = await r.text();
    } catch { unreadable++; continue; }
    await sleep(2000);
    read++;
    let found = 0;
    if (official) {
      const d = official.parse(html);
      if (!d) skip(`${adapterId}: la copia no tiene un parte reconocible`);
      if (d) for (const s of group) {
        const row = rowOf({ areaId: s.scope_area_id, provider: s.provider, originalUrl: url, archiveUrl, capturedAt: at, extractor: `${adapterId}@${official.version}+wayback` }, d);
        if (row) { out.push(row); found++; }
      }
    } else {
      const rows: StatusRow[] = esquiadesAdapter.parse(html);
      for (const s of group) {
        const aliases: string[] = s.match_aliases ? JSON.parse(s.match_aliases) : [s.area_name];
        const o = aggregatorSnowOutcome(rows, aliases);
        const hit = o.data;
        if (!hit) skip(`esquiades: ${o.reason ?? o.status}`);
        const row = hit && rowOf({ areaId: s.scope_area_id, provider: s.provider, originalUrl: url, archiveUrl, capturedAt: at, extractor: `${esquiadesAdapter.id}@${esquiadesAdapter.version}+wayback` }, hit);
        if (row) { out.push(row); found++; }
      }
    }
    if (found) days.add(madridDate(at));
    console.log(`   ${ts}: ${found} estaciones`);
  }
  console.log(`## ${url} (${adapterId}): ${stamps.length} copias de temporada, ${read} leídas, ${unreadable} sin cargar, ${days.size} días con datos`);
}

// Resumen por estación y temporada.
const by = new Map<string, number>();
for (const r of out) { const k = `${r.areaId} ${r.obsDate.slice(0, 4)}`; by.set(k, (by.get(k) ?? 0) + 1); }
for (const [k, n] of [...skipped].sort((a, b) => b[1] - a[1])) console.log(`   descartadas · ${k}: ${n}`);
console.log(`Filas: ${out.length} · fecha publicada ${out.filter((r) => r.dateBasis === 'report').length} · fecha de copia ${out.filter((r) => r.dateBasis === 'copy').length}`);
for (const [k, n] of [...by].sort()) console.log(`   ${k}: ${n}`);
for (const r of out.slice(0, 15)) console.log(`   ej. ${r.areaId} ${r.obsDate} (${r.dateBasis}) ${r.openKm ?? r.opStatus}/${r.totalKm ?? '–'} ${r.archiveUrl}`);
if (!send) { console.log('Sin --send: no se guarda nada.'); process.exit(0); }
let written = 0;
for (let i = 0; i < out.length; i += 400) written += (await apiPost<{ written: number }>('/api/ingest/km-archive', { rows: out.slice(i, i + 400) })).written;
console.log(`Guardadas ${written} filas nuevas (las repetidas se ignoran).`);
