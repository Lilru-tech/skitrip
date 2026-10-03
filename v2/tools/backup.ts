#!/usr/bin/env -S npx tsx
/**
 * Copias de seguridad y prueba de restauración de D1.
 *
 *   npx tsx tools/backup.ts export --local            # SQL (wrangler d1 export) + JSON + CSV por tabla en exports/backup-<fecha>/
 *   npx tsx tools/backup.ts export --remote           # igual contra producción (solo lectura)
 *   npx tsx tools/backup.ts restore-test <dir>        # restaura el SQL en una D1 local nueva y compara recuentos y hashes
 *
 * Las exportaciones contienen datos privados: se escriben en exports/ (ignorado por git). No se suben al repositorio
 * ni se guardan como artefacto temporal de GitHub. Guárdalas en un almacenamiento propio.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const V2 = path.resolve(import.meta.dirname, '..');
const [cmd, ...rest] = process.argv.slice(2);

function d1(where: string[], sqlText: string): any[] {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'skitrip', ...where, '--json', '--command', sqlText], { cwd: V2, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  return JSON.parse(out)[0].results;
}

function tables(where: string[]): string[] {
  return d1(where, `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations' ORDER BY name`).map((r) => r.name);
}

function counts(where: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of tables(where)) out[t] = d1(where, `SELECT COUNT(*) AS n FROM "${t}"`)[0].n;
  return out;
}

const csvCell = (v: unknown) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

function legacyHashes(where: string[]) {
  const files = d1(where, 'SELECT id, sha256 FROM legacy_import_files');
  return files.map((f) => {
    const chunks = d1(where, `SELECT data FROM legacy_raw_chunks WHERE file_id = '${f.id}' ORDER BY idx`);
    const hash = createHash('sha256').update(chunks.map((c) => c.data).join('')).digest('hex');
    return { id: f.id, expected: f.sha256, actual: hash, ok: hash === f.sha256 };
  });
}

if (cmd === 'export') {
  const where = rest.includes('--remote') ? ['--remote'] : ['--local'];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(V2, 'exports', `backup-${stamp}`);
  mkdirSync(path.join(dir, 'json'), { recursive: true });
  mkdirSync(path.join(dir, 'csv'), { recursive: true });
  execFileSync('npx', ['wrangler', 'd1', 'export', 'skitrip', ...where, '--output', path.join(dir, 'backup.sql')], { cwd: V2, stdio: 'ignore' });
  const manifest: Record<string, number> = {};
  for (const t of tables(where)) {
    const rows: any[] = [];
    for (let offset = 0; ; offset += 2000) {
      const page = d1(where, `SELECT * FROM "${t}" LIMIT 2000 OFFSET ${offset}`);
      rows.push(...page);
      if (page.length < 2000) break;
    }
    manifest[t] = rows.length;
    writeFileSync(path.join(dir, 'json', `${t}.json`), JSON.stringify(rows));
    const cols = rows.length ? Object.keys(rows[0]) : [];
    writeFileSync(path.join(dir, 'csv', `${t}.csv`), [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n'));
  }
  const sqlHash = createHash('sha256').update(readFileSync(path.join(dir, 'backup.sql'))).digest('hex');
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), source: where[0], sqlSha256: sqlHash, counts: manifest }, null, 2));
  console.log(`Copia en ${path.relative(V2, dir)} (${Object.keys(manifest).length} tablas, SHA-256 SQL ${sqlHash.slice(0, 12)}…)`);
} else if (cmd === 'restore-test') {
  const dir = path.resolve(rest[0]);
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const state = path.join(V2, 'exports', 'restore-test-state');
  rmSync(state, { recursive: true, force: true });
  const where = ['--local', '--persist-to', state];
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'skitrip', ...where, '--file', path.join(dir, 'backup.sql'), '--yes'], { cwd: V2, stdio: 'ignore' });
  const restored = counts(where);
  let ok = true;
  for (const [t, n] of Object.entries(manifest.counts as Record<string, number>)) {
    const m = restored[t] ?? -1;
    if (m !== n) ok = false;
    console.log(`${m === n ? '✔' : '✘'} ${t}: ${n} → ${m}`);
  }
  for (const h of legacyHashes(where)) {
    if (!h.ok) ok = false;
    console.log(`${h.ok ? '✔' : '✘'} original ${h.id}: SHA-256 ${h.ok ? 'coincide' : 'NO coincide'}`);
  }
  console.log(ok ? 'Restauración verificada.' : 'La restauración NO coincide.');
  process.exit(ok ? 0 : 1);
} else {
  console.log('Uso: backup.ts export [--local|--remote] | restore-test <dir>');
  process.exit(1);
}
