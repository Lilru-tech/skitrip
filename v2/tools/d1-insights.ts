// Consultas de D1 que más filas leen (wrangler d1 insights, analítica gratuita de Cloudflare) para saber de dónde salen
// las «filas leídas en 24 h» de la vigilancia. El texto de cada consulta se imprime con los literales sustituidos por
// «?»: las sentencias lanzadas con `wrangler d1 execute` (importaciones, limpieza) llevan valores dentro y el registro
// de Actions es público.
//   npx tsx tools/d1-insights.ts [periodo=1d] [límite=12]
import { execFileSync } from 'node:child_process';

export interface Insight { query: string; totalRowsRead: number; avgRowsRead: number; numberOfTimesRun: number; totalRowsWritten?: number }

/** Quita literales (cadenas, blobs y números) y comprime espacios. */
export function redactSql(sql: string): string {
  return sql
    .replace(/\bX'[0-9a-f]*'/gi, '?')
    .replace(/'(?:[^']|'')*'/g, '?')
    .replace(/(?<![\w?.])-?\d+(?:\.\d+)?\b/g, '?')
    .replace(/\s+/g, ' ')
    .trim();
}

export function insightsTable(rows: Insight[], limit: number): string[] {
  const total = rows.reduce((s, r) => s + (r.totalRowsRead ?? 0), 0);
  const top = [...rows].sort((a, b) => b.totalRowsRead - a.totalRowsRead).slice(0, limit);
  const out = [`Filas leídas por las consultas listadas: ${total.toLocaleString('es-ES')} (${rows.length} consultas distintas)`, '',
    '| Filas leídas | % | Ejecuciones | Media por ejecución | Consulta (sin literales) |', '|---|---|---|---|---|'];
  for (const r of top) {
    const q = redactSql(r.query);
    out.push(`| ${r.totalRowsRead.toLocaleString('es-ES')} | ${total ? ((100 * r.totalRowsRead) / total).toFixed(1) : '0'} | ${r.numberOfTimesRun} | ${Math.round(r.avgRowsRead).toLocaleString('es-ES')} | \`${(q.length > 160 ? `${q.slice(0, 157)}…` : q).replace(/\|/g, '\\|').replace(/`/g, "'")}\` |`);
  }
  return out;
}

if (process.argv[1]?.endsWith('d1-insights.ts')) {
  const period = process.argv[2] ?? '1d';
  const limit = Number(process.argv[3] ?? 12);
  if (!/^\d{1,2}[dh]$/.test(period) || !(limit > 0 && limit <= 50)) { console.error('Uso: d1-insights.ts [1d|24h|…] [1-50]'); process.exit(2); }
  try {
    // Pedimos más de las que se muestran para que el total y los porcentajes cubran casi todo el consumo.
    const raw = execFileSync('npx', ['wrangler', 'd1', 'insights', 'skitrip', '--time-period', period, '--sort-by', 'reads', '--limit', '100', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const rows = JSON.parse(raw.slice(raw.indexOf('['))) as Insight[];
    console.log(`Consultas de D1 con más filas leídas (últimas ${period}):`);
    for (const l of insightsTable(rows, limit)) console.log(l);
  } catch (e) {
    // Sin estos datos la medición sigue siendo válida: se avisa y no se inventa nada.
    console.log(`::warning::No se pudieron obtener las consultas de D1 (wrangler d1 insights): ${String((e as Error).message).split('\n')[0].slice(0, 160)}`);
  }
}
