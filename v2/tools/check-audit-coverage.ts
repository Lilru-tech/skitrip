// Comprueba que la auditoría de consultas D1 mide TODAS las rutas del Worker.
// Uso: npx tsx tools/check-audit-coverage.ts   (sale con código 1 si falta alguna ruta)
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { coverage, definedRoutes, measuredLabels } from './audit-coverage';

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');
const routesDir = 'src/worker/routes';
const files = Object.fromEntries(readdirSync(path.join(root, routesDir)).filter((f) => f.endsWith('.ts')).map((f) => [f.replace(/\.ts$/, ''), read(`${routesDir}/${f}`)]));
const AUDITS = ['test/worker/quota-audit.test.ts', 'test/worker/quota-audit-all.test.ts'];

const defined = definedRoutes(read('src/worker/index.ts'), files);
const r = coverage(defined, AUDITS.flatMap((f) => measuredLabels(read(f))));
console.log(`Rutas definidas: ${r.defined} · medidas: ${r.measured}`);
if (r.unknown.length) console.log(`Etiquetas que no corresponden a ninguna ruta:\n  ${r.unknown.join('\n  ')}`);
if (r.missing.length) {
  console.error(`Rutas sin medir (${r.missing.length}):\n  ${r.missing.join('\n  ')}`);
  process.exit(1);
}
if (r.unknown.length) process.exit(1);
console.log('OK: todas las rutas están medidas.');
