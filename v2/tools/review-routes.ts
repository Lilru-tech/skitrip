#!/usr/bin/env -S npx tsx
/**
 * Revisión de rutas y km totales con los datos del repositorio (sin red): compara las distancias heredadas del
 * SkiTrip antiguo (app.js, ROAD_DISTANCE_KM) con las rutas del catálogo (OSRM con fecha o heredadas), la línea recta
 * y los km totales del catálogo antiguo (data/resorts.json) con la serie antigua de nieve (data/open_km_history.json).
 * No valida nada: solo señala discrepancias para que una persona las revise.
 *
 *   npx tsx tools/review-routes.ts            # tablas en Markdown por la salida estándar
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { haversineKm, validateRoutes } from '../src/core/geo.ts';

const V2 = path.resolve(import.meta.dirname, '..');
const REPO = path.resolve(V2, '..');
const catalog = JSON.parse(readFileSync(path.join(V2, 'data/catalog.json'), 'utf8')) as {
  areas: { id: string; name: string; lat: number; lon: number; official_total_km: number | null; legacy_id: string | null }[];
  origins: { id: string; lat: number; lon: number }[];
  routes: { origin: string; area: string; road_km: number | null; source: string; checked_on: string | null }[];
};
const appJs = readFileSync(path.join(REPO, 'app.js'), 'utf8');
const block = /const ROAD_DISTANCE_KM = (\{[\s\S]*?\n\});/.exec(appJs)?.[1];
if (!block) throw new Error('No se encuentra ROAD_DISTANCE_KM en app.js');
// Objeto literal JS del código antiguo (claves con y sin comillas): se evalúa como expresión, sin ejecutar nada más.
const legacyKm = new Function(`return (${block});`)() as Record<string, Record<string, number>>;

const area = new Map(catalog.areas.map((a) => [a.id, a]));
const origin = new Map(catalog.origins.map((o) => [o.id, o]));
const issues = validateRoutes(catalog.routes.map((r) => ({ originId: r.origin, areaId: r.area, roadKm: r.road_km, origin: origin.get(r.origin)!, area: area.get(r.area) ?? null })));

console.log('## Rutas: estimación heredada frente a ruta calculada\n');
console.log('| Origen | Estación | Heredada (app.js) | Catálogo | Procedencia | Línea recta | Diferencia | Avisos |');
console.log('|---|---|---|---|---|---|---|---|');
for (const r of catalog.routes) {
  const a = area.get(r.area)!;
  const o = origin.get(r.origin)!;
  const old = legacyKm[r.origin]?.[r.area] ?? null;
  const straight = Math.round(haversineKm(o, a));
  const diff = old != null && r.road_km != null ? r.road_km - old : null;
  const prov = r.source === 'legacy_hardcode' ? 'heredada' : `${r.source.split(',')[0]} ${r.checked_on ?? ''}`.trim();
  const warn = issues.filter((i) => i.originId === r.origin && i.areaId === r.area).map((i) => i.issue).join('; ');
  const flag = diff != null && Math.abs(diff) >= 40 ? ' **⚠**' : '';
  console.log(`| ${r.origin} | ${a.name} | ${old ?? '—'} | ${r.road_km ?? '—'} | ${prov} | ${straight} | ${diff == null ? '—' : (diff > 0 ? '+' : '') + diff}${flag} | ${warn || '—'} |`);
}

console.log('\n## Km totales: catálogo antiguo frente a la serie antigua de nieve\n');
const resorts = JSON.parse(readFileSync(path.join(REPO, 'data/resorts.json'), 'utf8')) as { id: string; name: string; kmTotal: number | null }[];
const history = JSON.parse(readFileSync(path.join(REPO, 'data/open_km_history.json'), 'utf8')).byResortId as Record<string, { date: string; totalKm: number | null }[]>;
console.log('| Estación | Catálogo antiguo | Serie de nieve (filas) | Catálogo v2 |');
console.log('|---|---|---|---|');
for (const r of resorts) {
  const totals = new Map<number | null, number>();
  for (const p of history[r.id] ?? []) totals.set(p.totalKm, (totals.get(p.totalKm) ?? 0) + 1);
  const differs = [...totals.keys()].some((t) => t !== r.kmTotal);
  if (!differs) continue;
  const v2 = catalog.areas.find((a) => a.legacy_id === r.id)?.official_total_km ?? null;
  console.log(`| ${r.name} | ${r.kmTotal ?? '—'} | ${[...totals].map(([t, n]) => `${t ?? '—'} (${n})`).join(', ')} | ${v2 ?? '—'} |`);
}
