// Catálogo de pistas efectivo para la API pública: cifra importada (area_runs) y aportación manual activa
// (area_run_contributions) resueltas con la única regla de src/core/runs-manual.ts. Fichas, Comparar, dominios y
// puntuación reciben ya la cifra efectiva; el historial y la autoría no salen de administración.
import type { RunCatalogEntry } from '../core/runs';
import { resolveRunCatalog, type ManualRunContribution, type ResolvedRuns } from '../core/runs-manual';

export const importedFromRow = (r: any): RunCatalogEntry | null => r && ({
  areaId: r.area_id, total: r.total, green: r.green, blue: r.blue, red: r.red, black: r.black, basis: r.basis, comparable: !!r.comparable, season: r.season,
  sourceDate: r.source_date, checkedOn: r.checked_on, sourceUrl: r.source_url, mapUrl: r.map_url, limitations: r.limitations,
});

export const manualFromRow = (c: any): ManualRunContribution | null => c && ({
  areaId: c.area_id, total: c.total, green: c.green, blue: c.blue, red: c.red, black: c.black, comparable: !!c.comparable, resolution: c.resolution,
  season: c.season, sourceDate: c.source_date, sourceRef: c.source_ref, enteredOn: c.entered_on, status: c.status, version: c.version,
});

export const resolveRows = (importedRow: any, contributionRow: any): ResolvedRuns => resolveRunCatalog(importedFromRow(importedRow), manualFromRow(contributionRow));

/** Contrato público de la cifra efectiva; null si no hay ninguna. `superseded` = cifra importada que la aportación sustituye. */
export function publicRuns(importedRow: any, contributionRow: any) {
  const res = resolveRows(importedRow, contributionRow);
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
