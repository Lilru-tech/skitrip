#!/usr/bin/env -S npx tsx
/**
 * Importador legacy → D1.
 *
 *   npx tsx tools/import-legacy.ts --dry-run                 # solo informe
 *   npx tsx tools/import-legacy.ts --apply local             # escribe en D1 local (wrangler)
 *   npx tsx tools/import-legacy.ts --apply remote            # D1 remoto (requiere wrangler login; NO lo hace este script por ti)
 *   Opciones: --ref origin/main (commit/rama de origen de los JSON, por defecto origin/main)
 *             --config wrangler.deploy.jsonc (configuración de wrangler; la usa el workflow de despliegue)
 *             --out exports/legacy-import.sql   --report exports/legacy-import-report.json
 *
 * Propiedades:
 *  - Lee los JSON del commit indicado del repositorio (históricos actuales del remoto, no la copia local).
 *  - Guarda hash SHA-256, bytes, recuentos y copia íntegra troceada del original.
 *  - Reejecutable: INSERT OR IGNORE sobre claves únicas; el catálogo curado se actualiza con UPSERT.
 *  - No mezcla legacy con series nuevas: todo va a tablas legacy_* con su ámbito deducido y anomalías.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { validateRoutes } from '../src/core/geo.ts';

const args = process.argv.slice(2);
const opt = (name: string, def?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const DRY = args.includes('--dry-run');
const APPLY = opt('apply');
const REF = opt('ref', 'origin/main')!;
const V2 = path.resolve(import.meta.dirname, '..');
const REPO = path.resolve(V2, '..');
const OUT = path.resolve(V2, opt('out', 'exports/legacy-import.sql')!);
const REPORT = path.resolve(V2, opt('report', 'exports/legacy-import-report.json')!);

const git = (...a: string[]) => execFileSync('git', ['-C', REPO, ...a], { maxBuffer: 64 * 1024 * 1024 }).toString();
const commit = git('rev-parse', REF).trim();
const readAt = (f: string) => git('show', `${commit}:${f}`);

const q = (v: unknown): string => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  return `'${String(v).replace(/'/g, "''")}'`;
};
const cents = (eur: unknown) => (typeof eur === 'number' && Number.isFinite(eur) ? Math.round(eur * 100) : null);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

type Catalog = {
  areas: { id: string; name: string; kind: string; country: string; region: string; lat: number; lon: number; official_total_km: number | null; total_km_source: string | null; vibe_score: number | null; apres_score: number | null; official_url: string | null; notes: string | null; legacy_id: string | null }[];
  links: { parent: string; child: string; relation: string }[];
  origins: { id: string; name: string; lat: number; lon: number }[];
  routes: { origin: string; area: string; access_name: string; road_km: number | null; duration_min: number | null; source: string; checked_on: string | null; notes?: string | null }[];
  sources: { id: string; area: string; scope: string; kind: string; provider: string; url: string; method: string; fields: string[]; priority: number; status: string; checked_on: string | null; limitations: string; adapter: string | null; aliases: string[] | null }[];
  legacy_scope_rules: { snow: Record<string, Record<string, string>>; hotel: Record<string, string> };
};
const catalog: Catalog = JSON.parse(readFileSync(path.join(V2, 'data/catalog.json'), 'utf8'));
const areaById = new Map(catalog.areas.map((a) => [a.id, a]));

const sql: string[] = [];
const report: Record<string, any> = { commit, ref: REF, generatedAt: new Date().toISOString(), files: {}, anomalies: {}, coverage: {}, routes: {} };
const bump = (k: string, n = 1) => (report.anomalies[k] = (report.anomalies[k] ?? 0) + n);

// ---------- Catálogo curado ----------
for (const a of catalog.areas) {
  sql.push(`INSERT INTO areas (id, name, kind, country, region, lat, lon, official_total_km, total_km_source, official_url, vibe_score, apres_score, notes)
VALUES (${[a.id, a.name, a.kind, a.country, a.region, a.lat, a.lon, a.official_total_km, a.total_km_source, a.official_url, a.vibe_score, a.apres_score, a.notes].map(q).join(', ')})
ON CONFLICT (id) DO UPDATE SET name = excluded.name, kind = excluded.kind, country = excluded.country, region = excluded.region, lat = excluded.lat, lon = excluded.lon,
  official_total_km = excluded.official_total_km, total_km_source = excluded.total_km_source, official_url = excluded.official_url, vibe_score = excluded.vibe_score,
  apres_score = excluded.apres_score, notes = excluded.notes;`);
  if (a.legacy_id) sql.push(`INSERT OR IGNORE INTO legacy_id_map (legacy_kind, legacy_id, new_kind, new_id) VALUES ('resort', ${q(a.legacy_id)}, 'area', ${q(a.id)});`);
}
for (const l of catalog.links) sql.push(`INSERT OR IGNORE INTO area_links (parent_id, child_id, relation) VALUES (${q(l.parent)}, ${q(l.child)}, ${q(l.relation)});`);
for (const o of catalog.origins) sql.push(`INSERT INTO origins (id, name, lat, lon) VALUES (${[o.id, o.name, o.lat, o.lon].map(q).join(', ')}) ON CONFLICT (id) DO UPDATE SET name = excluded.name, lat = excluded.lat, lon = excluded.lon;`);

const originById = new Map(catalog.origins.map((o) => [o.id, o]));
const routeIssues = validateRoutes(catalog.routes.map((r) => ({ originId: r.origin, areaId: r.area, roadKm: r.road_km, origin: originById.get(r.origin)!, area: areaById.get(r.area) ?? null })));
report.routes = { total: catalog.routes.length, issues: routeIssues };
for (const r of catalog.routes) {
  const issues = routeIssues.filter((i) => i.originId === r.origin && i.areaId === r.area).map((i) => i.issue);
  const notes = [r.source === 'legacy_hardcode' ? 'Distancia heredada del código legacy sin fuente ni fecha.' : null, r.notes ?? null, ...issues].filter(Boolean).join(' ');
  sql.push(`INSERT INTO routes (origin_id, area_id, access_name, road_km, duration_min, source, checked_on, validated, notes)
VALUES (${[r.origin, r.area, r.access_name, r.road_km, r.duration_min, r.source, r.checked_on, 0, notes || null].map(q).join(', ')})
ON CONFLICT (origin_id, area_id) DO UPDATE SET access_name = excluded.access_name, road_km = excluded.road_km, duration_min = excluded.duration_min, source = excluded.source, checked_on = excluded.checked_on, notes = excluded.notes
  WHERE routes.validated = 0;`);
}

const providers = [
  { id: 'esquiades', name: 'Esquiades', base: 'https://www.esquiades.com' },
  { id: 'estiber', name: 'Estiber', base: 'https://www.estiber.com' },
  { id: 'manual', name: 'Cotización manual', base: null },
];
for (const p of providers) sql.push(`INSERT OR IGNORE INTO providers (id, name, base_url, enabled) VALUES (${q(p.id)}, ${q(p.name)}, ${q(p.base)}, 0);`);

for (const x of catalog.sources) {
  sql.push(`INSERT INTO sources (id, area_id, scope_area_id, kind, provider, url, method, fields, priority, status, checked_on, limitations, adapter, match_aliases)
VALUES (${[x.id, x.area, x.scope, x.kind, x.provider, x.url, x.method, JSON.stringify(x.fields), x.priority, x.status, x.checked_on, x.limitations, x.adapter, x.aliases ? JSON.stringify(x.aliases) : null].map(q).join(', ')})
ON CONFLICT (id) DO UPDATE SET url = excluded.url, fields = excluded.fields, priority = excluded.priority, checked_on = excluded.checked_on, limitations = excluded.limitations,
  adapter = excluded.adapter, match_aliases = excluded.match_aliases, scope_area_id = excluded.scope_area_id;`);
}

// ---------- Ficheros legacy ----------
function registerFile(kind: string, file: string, content: string, records: number) {
  const hash = sha(content);
  const id = `legacy-${kind}-${hash.slice(0, 16)}`;
  report.files[file] = { id, sha256: hash, bytes: Buffer.byteLength(content), records, commit };
  sql.push(`INSERT OR IGNORE INTO legacy_import_files (id, kind, file_name, sha256, bytes, records, source_ref, imported_at)
VALUES (${[id, kind, file, hash, Buffer.byteLength(content), records, `${REF}@${commit}`, Date.now()].map(q).join(', ')});`);
  const CHUNK = 40_000;
  for (let i = 0, n = 0; i < content.length; i += CHUNK, n++) {
    sql.push(`INSERT OR IGNORE INTO legacy_raw_chunks (file_id, idx, data) VALUES (${q(id)}, ${n}, ${q(content.slice(i, i + CHUNK))});`);
  }
  return id;
}

const resortsRaw = readAt('data/resorts.json');
const resorts: any[] = JSON.parse(resortsRaw);
registerFile('resorts', 'data/resorts.json', resortsRaw, resorts.length);
const catalogKm = new Map(resorts.map((r) => [r.id, r.kmTotal as number | null]));
report.coverage.resorts = resorts.length;

// Nieve
const snowRaw = readAt('data/open_km_history.json');
const snow = JSON.parse(snowRaw).byResortId as Record<string, { date: string; openKm: number | null; totalKm: number | null }[]>;
const snowCount = Object.values(snow).reduce((n, v) => n + v.length, 0);
const snowFile = registerFile('open_km_history', 'data/open_km_history.json', snowRaw, snowCount);
const snowKey = (p: { date: string; openKm: unknown; totalKm: unknown }) => `${p.date}|${p.openKm}|${p.totalKm}`;
const astunKeys = new Set((snow['astun'] ?? []).map(snowKey));
let identicalAstunCandanchu = 0;
report.coverage.snow = {};
for (const [rid, points] of Object.entries(snow)) {
  const rules = catalog.legacy_scope_rules.snow[rid];
  for (const p of points) {
    const an: string[] = [];
    let scope: string | null = areaById.has(rid) ? rid : null;
    if (rules) {
      const mapped = rules[String(p.totalKm)];
      if (mapped) { scope = mapped; if (mapped !== rid) an.push(`scope_remapped_to_${mapped}`); }
      else { scope = null; an.push('scope_unknown'); }
    }
    if (p.openKm === 0) an.push('zero_ambiguous'); // el scraper legacy convertía «-» en 0
    if (p.openKm == null) an.push('open_null');
    const cat = catalogKm.get(rid);
    if (cat != null && p.totalKm != null && p.totalKm !== cat) an.push('total_mismatch_catalog');
    if (p.openKm != null && p.totalKm != null && p.openKm > p.totalKm) an.push('open_gt_total');
    if (rid === 'candanchu' && astunKeys.has(snowKey(p))) { an.push('duplicate_of_astun_series'); identicalAstunCandanchu++; }
    an.forEach((a) => bump(`snow.${a.startsWith('scope_remapped') ? 'scope_remapped' : a}`));
    sql.push(`INSERT OR IGNORE INTO legacy_snow_observations (file_id, legacy_resort_id, obs_date, open_km, total_km, anomalies, scope_area_id)
VALUES (${[snowFile, rid, p.date, p.openKm, p.totalKm, an.length ? JSON.stringify(an) : null, scope].map(q).join(', ')});`);
  }
  report.coverage.snow[rid] = { n: points.length, first: points[0]?.date ?? null, last: points.at(-1)?.date ?? null, totals: [...new Set(points.map((p) => p.totalKm))] };
}
report.coverage.snowIdenticalAstunCandanchu = identicalAstunCandanchu;

// Hoteles
const hotelRaw = readAt('data/hotel_price_history.json');
const hotel = JSON.parse(hotelRaw).items as any[];
const hotelFile = registerFile('hotel_price_history', 'data/hotel_price_history.json', hotelRaw, hotel.length);
report.coverage.hotel = {};
for (const it of hotel) {
  const an: string[] = [];
  if (it.nights == null) an.push('nights_missing');
  an.push('no_hotel_identity', 'no_stay_dates', 'no_occupancy');
  if (it.days === 2) an.push('forfait_days_fixed_2'); // el scraper legacy fijaba 2 días aunque la URL fuese de 1 día
  const samples: number[] = Array.isArray(it.samples) ? it.samples.filter((x: unknown) => typeof x === 'number' && Number.isFinite(x)) : [];
  if (samples.length < 10) an.push(`top10_with_n_${samples.length}`);
  if (typeof it.cheapestUnit === 'number' && typeof it.top10AvgUnit === 'number' && it.cheapestUnit > it.top10AvgUnit) an.push('cheapest_gt_avg');
  if (samples.some((x) => x <= 0)) an.push('non_positive_sample');
  const scope = catalog.legacy_scope_rules.hotel[it.resortId] ?? (areaById.has(it.resortId) ? it.resortId : null);
  if (scope !== it.resortId) an.push(`scope_remapped_to_${scope}`);
  an.forEach((a) => bump(`hotel.${a.replace(/_\d+$/, '_n').replace(/scope_remapped_to_.*/, 'scope_remapped')}`));
  sql.push(`INSERT OR IGNORE INTO legacy_hotel_observations (file_id, obs_date, ts, legacy_resort_id, provider, url, days, nights, cheapest_unit_cents, top10_avg_unit_cents, sample_count, samples_json, anomalies, scope_area_id)
VALUES (${[hotelFile, it.date, it.ts, it.resortId, it.provider, it.url, it.days, it.nights, cents(it.cheapestUnit), cents(it.top10AvgUnit), samples.length, JSON.stringify(samples.map((x) => Math.round(x * 100))), JSON.stringify(an), scope].map(q).join(', ')});`);
  const c = (report.coverage.hotel[it.resortId] ??= { n: 0, first: it.date, last: it.date, providers: [] as string[] });
  c.n++; if (it.date < c.first) c.first = it.date; if (it.date > c.last) c.last = it.date;
  if (!c.providers.includes(it.provider)) c.providers.push(it.provider);
}
for (const r of resorts) if (!report.coverage.hotel[r.id]) report.coverage.hotel[r.id] = { n: 0, note: 'sin histórico hotelero' };

report.totals = { resorts: resorts.length, snowObservations: snowCount, hotelObservations: hotel.length, sqlStatements: sql.length };

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(REPORT, JSON.stringify(report, null, 2));
console.log(`Origen: ${REF} @ ${commit}`);
console.log(`Estaciones: ${resorts.length} · Observaciones de nieve: ${snowCount} · Observaciones hoteleras: ${hotel.length}`);
console.log('Anomalías:', report.anomalies);
console.log(`Rutas con avisos: ${routeIssues.length}`);
console.log(`Informe: ${path.relative(V2, REPORT)}`);
if (DRY) { console.log('Dry-run: no se ha escrito nada en D1.'); process.exit(0); }

writeFileSync(OUT, sql.join('\n') + '\n');
console.log(`SQL: ${path.relative(V2, OUT)} (${sql.length} sentencias)`);
if (APPLY === 'local' || APPLY === 'remote') {
  const config = opt('config');
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'skitrip', `--${APPLY}`, '--file', OUT, '--yes', ...(config ? ['-c', config] : [])], { cwd: V2, stdio: 'inherit' });
}
