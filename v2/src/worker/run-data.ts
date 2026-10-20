// Catálogo de pistas efectivo para la API pública: cifra importada (area_runs) y aportaciones manuales del área
// (area_run_contributions, varias: la vigente y las programadas) resueltas con la única regla de src/core/runs-manual.ts. Fichas, Comparar, dominios y
// puntuación reciben ya la cifra efectiva; el historial y la autoría no salen de administración.
import type { RunCatalogEntry } from '../core/runs';
import { resolveArea, type ManualRunContribution, type ResolvedArea } from '../core/runs-manual';

export const importedFromRow = (r: any): RunCatalogEntry | null => r && ({
  areaId: r.area_id, total: r.total, green: r.green, blue: r.blue, red: r.red, black: r.black, basis: r.basis, comparable: !!r.comparable, season: r.season,
  sourceDate: r.source_date, checkedOn: r.checked_on, sourceUrl: r.source_url, mapUrl: r.map_url, limitations: r.limitations,
});

export const manualFromRow = (c: any): ManualRunContribution | null => c && ({
  id: c.id, areaId: c.area_id, total: c.total, green: c.green, blue: c.blue, red: c.red, black: c.black, comparable: !!c.comparable, resolution: c.resolution,
  season: c.season, sourceDate: c.source_date, sourceRef: c.source_ref, enteredOn: c.entered_on, status: c.status, version: c.version,
});

/** Resolución de un área a partir de su fila importada y TODAS sus filas de aportaciones (cualquier estado). */
export const resolveRows = (importedRow: any, contributionRows: readonly any[]): ResolvedArea =>
  resolveArea(importedFromRow(importedRow), contributionRows.map((r) => manualFromRow(r)!));

/** Agrupa filas de area_run_contributions por área. */
export const contributionsByArea = (rows: readonly any[]) => {
  const by = new Map<string, any[]>();
  for (const r of rows) (by.get(r.area_id) ?? by.set(r.area_id, []).get(r.area_id)!).push(r);
  return by;
};

/** Contrato público de la cifra efectiva; null si no hay ninguna. `superseded` = cifra importada que la aportación sustituye. */
export function publicRuns(importedRow: any, contributionRows: readonly any[]) {
  const res = resolveRows(importedRow, contributionRows);
  const e = res.entry;
  if (!e) return null;
  const imp = importedFromRow(importedRow);
  return {
    total: e.total, green: e.green, blue: e.blue, red: e.red, black: e.black, basis: e.basis, comparable: e.comparable, season: e.season,
    sourceDate: e.sourceDate, checkedOn: e.checkedOn, sourceUrl: e.sourceUrl, mapUrl: e.mapUrl, limitations: e.limitations,
    origin: e.origin, manual: e.manual,
    superseded: e.origin === 'manual' && imp && [imp.total, imp.green, imp.blue, imp.red, imp.black].some((v) => v != null)
      ? { total: imp.total, green: imp.green, blue: imp.blue, red: imp.red, black: imp.black, comparable: imp.comparable, sourceUrl: imp.sourceUrl, limitations: imp.limitations }
      : null,
  };
}
