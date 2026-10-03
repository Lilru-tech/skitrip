// Limpia de D1 los perfiles de una prueba de producción (y todo lo suyo) por identidades exactas.
//
//   npx tsx tools/prod-cleanup.ts --manifest test-results-prod/cleanup-manifest.json --remote
//   npx tsx tools/prod-cleanup.ts --run 37124136929 --letters a,b,c --remote    # residuo de una ejecución anterior
//
// Lo ejecuta un workflow con el token de Cloudflare; no hay endpoint. Comprueba antes (viajes con gente ajena → no borra
// nada), borra y comprueba después. Solo imprime recuentos: nunca datos personales ni credenciales.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { blockingQuery, cleanupStatements, selectedCountQuery, testEmail, validateManifest, type CleanupManifest } from './prod-cleanup-sql';

const V2 = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const where = args.includes('--remote') ? ['--remote'] : args.includes('--local') ? ['--local'] : null;
if (!where) { console.error('Indica --remote o --local'); process.exit(2); }

let m: CleanupManifest;
if (opt('--manifest')) m = JSON.parse(readFileSync(opt('--manifest')!, 'utf8'));
else if (opt('--run')) m = { runId: opt('--run')!, users: (opt('--letters') ?? 'a,b,c').split(',').map((k) => ({ email: testEmail(opt('--run')!, k.trim()) })) };
else { console.error('Indica --manifest <fichero> o --run <id>'); process.exit(2); }
const errors = validateManifest(m);
if (errors.length) { console.error(`Manifiesto rechazado: ${errors.join('; ')}`); process.exit(2); }

function d1(sqlText: string): any[] {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'skitrip', ...where!, '--json', '--command', sqlText], { cwd: V2, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] }).toString();
  return JSON.parse(out).flatMap((r: any) => r.results ?? []);
}
const n = (sql: string) => Number(d1(sql)[0]?.n ?? NaN);
const totals = () => ({ perfiles: n('SELECT COUNT(*) AS n FROM users'), administradores: n(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin'`) });

const before = totals();
const selected = n(selectedCountQuery(m));
console.log(`Ejecución ${m.runId}: ${m.users.length} cuentas en el manifiesto (${m.users.every((u) => u.uid) ? 'con UID' : 'solo correo exacto'}); perfiles seleccionados: ${selected}`);
console.log(`Antes: ${before.perfiles} perfiles, ${before.administradores} administradores`);
if (selected === 0) { console.log('Nada que limpiar (ya estaba limpio).'); process.exit(0); }

const blocking = d1(blockingQuery(m));
if (blocking.length) {
  console.error(`::error::No se borra nada: ${blocking.length} viaje(s) de la prueba con personas ajenas a ella.`);
  process.exit(1);
}
for (const s of cleanupStatements(m)) d1(s);

const after = totals();
const left = n(selectedCountQuery(m));
console.log(`Después: ${after.perfiles} perfiles, ${after.administradores} administradores; perfiles de la prueba restantes: ${left}`);
if (left !== 0) { console.error('::error::Quedan perfiles de la prueba'); process.exit(1); }
if (after.administradores !== before.administradores) { console.error('::error::Ha cambiado el número de administradores'); process.exit(1); }
if (before.perfiles - after.perfiles !== selected) { console.error('::error::Se han borrado perfiles distintos de los seleccionados'); process.exit(1); }
