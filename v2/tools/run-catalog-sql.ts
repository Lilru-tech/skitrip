// SQL de la importación del catálogo de pistas (area_runs) desde data/catalog.json. Lo usa tools/import-legacy.ts en
// cada publicación y lo prueban los tests del Worker contra D1.
//
// Reglas:
//  - area_runs es el catálogo importado: se actualiza con UPSERT y se borran las áreas que ya no figuran.
//  - Las aportaciones manuales (area_run_contributions) NO se tocan: reimportar, con o sin cambios, nunca las borra ni
//    las modifica. Cuál vale se decide al leer (src/core/runs-manual.ts).
//  - Si la importación cambia la cifra importada de un área que tiene una aportación activa, se anota en
//    area_run_history ('import_change', sin actor) con los valores anteriores y nuevos: así consta cuándo un dato
//    automático pasó a prevalecer (o dejó de hacerlo). Reimportar sin cambios no anota nada.
import type { RunCatalogJson } from '../src/core/runs.ts';

export const sqlValue = (v: unknown): string => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  return `'${String(v).replace(/'/g, "''")}'`;
};

const RUN_JSON = (alias: string) => `json_object('total', ${alias}.total, 'green', ${alias}.green, 'blue', ${alias}.blue, 'red', ${alias}.red, 'black', ${alias}.black, 'comparable', ${alias}.comparable, 'season', ${alias}.season, 'source_date', ${alias}.source_date, 'source_url', ${alias}.source_url)`;
// Campos que cambian la cifra o su vigencia (la fecha de consulta sola no es un cambio de dato).
const SAME = ['total', 'green', 'blue', 'red', 'black', 'comparable', 'season', 'source_date'] as const;

export function runCatalogSql(entries: readonly RunCatalogJson[], opts: { at: number; label: string }): string[] {
  const q = sqlValue;
  const sql: string[] = [];
  for (const r of entries) {
    const next: Record<(typeof SAME)[number], unknown> = { total: r.total, green: r.green, blue: r.blue, red: r.red, black: r.black, comparable: r.comparable ? 1 : 0, season: r.season, source_date: r.source_date };
    const after = `json_object('total', ${q(r.total)}, 'green', ${q(r.green)}, 'blue', ${q(r.blue)}, 'red', ${q(r.red)}, 'black', ${q(r.black)}, 'comparable', ${q(r.comparable)}, 'season', ${q(r.season)}, 'source_date', ${q(r.source_date)}, 'source_url', ${q(r.source_url)})`;
    sql.push(`INSERT INTO area_run_history (area_id, action, actor_id, at, before_json, after_json, source_ref, reason, version)
SELECT c.area_id, 'import_change', NULL, ${opts.at}, (SELECT ${RUN_JSON('r')} FROM area_runs r WHERE r.area_id = c.area_id), ${after}, ${q(r.source_url)}, ${q(opts.label)}, c.version
FROM area_run_contributions c WHERE c.area_id = ${q(r.area)} AND c.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM area_runs r WHERE r.area_id = c.area_id AND ${SAME.map((k) => `r.${k} IS ${q(next[k])}`).join(' AND ')});`);
    sql.push(`INSERT INTO area_runs (area_id, total, green, blue, red, black, basis, comparable, season, source_date, checked_on, source_url, map_url, limitations)
VALUES (${[r.area, r.total, r.green, r.blue, r.red, r.black, r.basis, r.comparable, r.season, r.source_date, r.checked_on, r.source_url, r.map_url, r.limitations].map(q).join(', ')})
ON CONFLICT (area_id) DO UPDATE SET total = excluded.total, green = excluded.green, blue = excluded.blue, red = excluded.red, black = excluded.black, basis = excluded.basis,
  comparable = excluded.comparable, season = excluded.season, source_date = excluded.source_date, checked_on = excluded.checked_on, source_url = excluded.source_url,
  map_url = excluded.map_url, limitations = excluded.limitations;`);
  }
  const keep = entries.map((r) => q(r.area)).join(', ') || "''";
  sql.push(`INSERT INTO area_run_history (area_id, action, actor_id, at, before_json, after_json, source_ref, reason, version)
SELECT c.area_id, 'import_change', NULL, ${opts.at}, ${RUN_JSON('r')}, NULL, NULL, ${q(`${opts.label} (el área ya no figura en el catálogo de pistas)`)}, c.version
FROM area_run_contributions c JOIN area_runs r ON r.area_id = c.area_id WHERE c.status = 'active' AND c.area_id NOT IN (${keep});`);
  sql.push(`DELETE FROM area_runs WHERE area_id NOT IN (${keep});`);
  return sql;
}
