#!/usr/bin/env -S npx tsx
/**
 * Importador de exportaciones CSV de Google Sheets → tablas legacy_* de D1.
 *
 *   npx tsx tools/import-sheets.ts --kind comments|availability|shopping --file exports/sheets/comentarios.csv --dry-run
 *   npx tsx tools/import-sheets.ts --kind availability --file … --apply local      # D1 local
 *   npx tsx tools/import-sheets.ts --kind availability --file … --apply remote     # D1 remoto (wrangler login previo)
 *
 * - No lee Sheets ni Apps Script: trabaja sobre un CSV exportado a mano (Archivo › Descargar › CSV). No modifica el original.
 * - Guarda hash SHA-256, bytes, recuento y copia íntegra del fichero; reejecutable (INSERT OR IGNORE por hash de fila).
 * - Si hay errores de validación no genera SQL (salvo --allow-partial, que omite solo las filas erróneas).
 * - Los nombres legacy no prueban identidad: nada se asigna a una cuenta ni se publica; eso es una acción de administración.
 * - Disponibilidad: solo se importan los días presentes en la hoja; los ausentes quedan sin indicar, nunca libres.
 * Plantillas: docs/templates/sheets-*.csv. El CSV contiene datos personales: guárdalo en exports/ (ignorado por git).
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mapAvailability, mapComments, mapShopping, type SheetKind } from '../src/core/sheets.ts';

const args = process.argv.slice(2);
const opt = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const kind = opt('kind') as SheetKind | undefined;
const file = opt('file');
const APPLY = opt('apply');
const DRY = args.includes('--dry-run');
const PARTIAL = args.includes('--allow-partial');
if (!kind || !['comments', 'availability', 'shopping'].includes(kind) || !file) {
  console.error('Uso: --kind comments|availability|shopping --file <csv> [--dry-run | --apply local|remote] [--allow-partial]');
  process.exit(2);
}
if (APPLY && !['local', 'remote'].includes(APPLY)) { console.error('--apply debe ser local o remote'); process.exit(2); }

const V2 = path.resolve(import.meta.dirname, '..');
const content = readFileSync(path.resolve(file), 'utf8');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const q = (v: unknown) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

const catalog = JSON.parse(readFileSync(path.join(V2, 'data/catalog.json'), 'utf8')) as { areas: { legacy_id: string | null }[] };
const legacyIds = new Set(catalog.areas.map((a) => a.legacy_id).filter(Boolean) as string[]);
const mapped = kind === 'comments' ? mapComments(content, legacyIds) : kind === 'availability' ? mapAvailability(content) : mapShopping(content);

const report = {
  kind, file: path.basename(file), sha256: sha(content), bytes: Buffer.byteLength(content), headers: mapped.headers,
  valid: mapped.rows.length, errors: mapped.errors, warnings: mapped.warnings, duplicates: mapped.duplicates,
  ...(kind === 'availability' ? { byStatus: (mapped.rows as any[]).reduce((m, r) => ({ ...m, [r.mapped ?? 'sin_equivalencia']: (m[r.mapped ?? 'sin_equivalencia'] ?? 0) + 1 }), {} as Record<string, number>) } : {}),
};
mkdirSync(path.join(V2, 'exports'), { recursive: true });
const base = path.join(V2, 'exports', `sheets-${kind}`);
writeFileSync(`${base}-report.json`, JSON.stringify(report, null, 2));
console.log(`${kind}: ${mapped.rows.length} filas válidas · ${mapped.errors.length} errores · ${mapped.warnings.length} avisos · ${mapped.duplicates} duplicadas`);
for (const e of mapped.errors.slice(0, 20)) console.log(`  error línea ${e.line}: ${e.message}`);
console.log(`Informe: ${path.relative(V2, base)}-report.json`);
if (mapped.errors.length && !PARTIAL) { console.log('Hay errores: no se genera SQL. Corrige el CSV o usa --allow-partial.'); process.exit(1); }
if (DRY) { console.log('Dry-run: no se ha escrito nada en D1.'); process.exit(0); }

const fileId = `legacy-sheets_${kind}-${report.sha256.slice(0, 16)}`;
const sql: string[] = [
  `INSERT OR IGNORE INTO legacy_import_files (id, kind, file_name, sha256, bytes, records, source_ref, imported_at, report_json) VALUES (${[fileId, `sheets_${kind}`, report.file, report.sha256, report.bytes, mapped.rows.length, 'csv-export', Date.now(), JSON.stringify({ ...report, errors: report.errors.length, warnings: report.warnings.length })].map(q).join(', ')});`,
];
for (let i = 0, n = 0; i < content.length; i += 40_000, n++) sql.push(`INSERT OR IGNORE INTO legacy_raw_chunks (file_id, idx, data) VALUES (${q(fileId)}, ${n}, ${q(content.slice(i, i + 40_000))});`);
for (const r of mapped.rows as any[]) {
  const rowHash = sha(r.key);
  if (kind === 'comments') sql.push(`INSERT OR IGNORE INTO legacy_comments (id, file_id, row_hash, legacy_author_name, legacy_resort_id, body, created_at_text, published) VALUES (${[randomUUID(), fileId, rowHash, r.author, r.resortId, r.body, r.createdText].map(q).join(', ')}, 0);`);
  if (kind === 'availability') sql.push(`INSERT OR IGNORE INTO legacy_availability (id, file_id, row_hash, legacy_person_name, day, legacy_status, mapped_status) VALUES (${[randomUUID(), fileId, rowHash, r.person, r.day, r.legacyStatus, r.mapped].map(q).join(', ')});`);
  if (kind === 'shopping') sql.push(`INSERT OR IGNORE INTO legacy_shopping_items (id, file_id, row_hash, name, quantity_text, price_text, legacy_person_name, extra_json) VALUES (${[randomUUID(), fileId, rowHash, r.name, r.quantityText, r.priceText, r.person, Object.keys(r.extra).length ? JSON.stringify(r.extra) : null].map(q).join(', ')});`);
}
writeFileSync(`${base}.sql`, sql.join('\n') + '\n');
console.log(`SQL: ${path.relative(V2, base)}.sql (${sql.length} sentencias)`);
if (APPLY) execFileSync('npx', ['wrangler', 'd1', 'execute', 'skitrip', `--${APPLY}`, '--file', `${base}.sql`, '--yes'], { cwd: V2, stdio: 'inherit' });
