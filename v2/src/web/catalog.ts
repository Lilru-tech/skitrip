// Contratos del catálogo público (src/worker/routes/catalog.ts).
export interface Snow {
  observedAt: number; sourceDate: string | null; opStatus: string; openKm: number | null; totalKm: number | null;
  openRuns: number | null; totalRuns: number | null; openLifts: number | null; totalLifts: number | null;
  depthMinCm: number | null; depthMaxCm: number | null; quality: string; qualityNote: string | null; sourceId: string;
  freshness: 'fresh' | 'stale' | 'never';
  /** Lo que puede puntuar en «Nieve abierta ahora»; un dato excluido se sigue mostrando con su fecha. */
  rank?: { openKm: number | null; excluded: null | 'sin_dato' | 'antiguo' | 'dudoso' | 'estado_desconocido' | 'sin_km'; label: string | null };
  sources?: number;
}
export interface Route { accessName: string; roadKm: number | null; durationMin: number | null; tollCents: number | null; source: string; checkedOn: string | null; validated: boolean; notes: string | null }
export interface CatalogArea {
  id: string; name: string; kind: 'resort' | 'sector' | 'domain'; country: string; region: string | null; lat: number | null; lon: number | null;
  officialTotalKm: number | null; totalKmSource: string | null; vibe: number | null; apres: number | null; notes: string | null; officialUrl: string | null;
  route: Route | null; snow: Snow | null;
  legacySnow: { date: string; openKm: number | null; totalKm: number | null; anomalies: string[]; note: string } | null;
}
export interface Catalog { origin: string; origins: { id: string; name: string }[]; links: { parent_id: string; child_id: string; relation: string }[]; areas: CatalogArea[] }

export interface SourceRow {
  id: string; area_id: string; area_name?: string; scope_area_id: string; kind: string; provider: string; url: string; method: string; fields: string[];
  priority: number; status: string; checked_on: string | null; limitations: string | null; adapter: string | null;
  last_attempt_at: number | null; last_success_at: number | null; last_status: string | null; last_error?: string | null;
}
export interface AreaOffer {
  id: string; provider_id: string; hotel_name_raw: string | null; modality: 'lodging' | 'lodging_forfait'; board: string | null; nights: number | null; forfait_days: number | null;
  adults: number | null; check_in: string | null; check_out: string | null; url: string | null; observed_at: number; amount_cents: number | null; unit: string; price_kind: string; availability: string;
}
export interface LegacyComment { id: string; body: string; legacyAuthorName: string | null; dateText: string | null; linkedAlias: string | null }
export interface AreaComment { id: string; body: string; created_at: number; updated_at: number; author_id: string; author_alias: string }
export interface AreaDetail {
  area: { id: string; name: string; kind: string; country: string; region: string | null; official_total_km: number | null; total_km_source: string | null; official_url: string | null; notes: string | null; vibe_score: number | null; apres_score: number | null };
  links: { parent_id: string; parent_name: string; child_id: string; child_name: string; relation: string }[];
  sources: SourceRow[];
  snow: Snow[];
  legacy: { warning: string; snow: { obs_date: string; open_km: number | null; total_km: number | null; anomalies: string[] }[]; hotel: { obs_date: string; provider: string; url: string | null; cheapest_unit_cents: number | null; top10_avg_unit_cents: number | null; sample_count: number }[] };
  comments: AreaComment[];
  legacyComments?: LegacyComment[];
  legacyCommentsNote?: string;
  offers: { note: string; items: AreaOffer[] };
}

/** Entradas de primer nivel: dominios y estaciones que no pertenecen a un dominio (nunca se cuenta dos veces). */
export function topLevel(c: Catalog) {
  const childOf = new Map<string, string>();
  for (const l of c.links) childOf.set(l.child_id, l.parent_id);
  const byId = new Map(c.areas.map((a) => [a.id, a]));
  const members = (id: string) => c.links.filter((l) => l.parent_id === id).map((l) => byId.get(l.child_id)).filter((a): a is CatalogArea => !!a);
  return c.areas.filter((a) => !childOf.has(a.id) || !byId.has(childOf.get(a.id)!)).map((a) => ({ area: a, members: members(a.id) }));
}
