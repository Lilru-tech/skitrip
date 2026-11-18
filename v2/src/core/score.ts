// Puntuación explicable con pesos editables. Un dato ausente NO puntúa (0 en ese criterio) y se
// declara como ausente: nunca se premia la falta de datos ni se cuenta dos veces el mismo precio.

export interface ScoreRow {
  id: string;
  costPerPersonCents: number | null; // solo presupuestos completos; si es incompleto, null
  roadKm: number | null;
  totalKm: number | null;
  openKmNow: number | null;          // condiciones actuales; no predicen un viaje futuro
  vibe: number | null;               // 0–10 subjetivo
  /** Número de pistas: total comparable del catálogo (Planificar) o abiertas con parte vigente (Esquiar ahora). */
  runs?: number | null;
  /** Condiciones meteorológicas: 1 − índice desfavorable medio del viaje (escala absoluta 0–1, no min–max). */
  weather?: number | null;
  /** Afluencia histórica: mediana de la intensidad diaria (esquiadores por km abierto); menos es mejor. */
  crowd?: number | null;
}
// «runs» (Variedad de pistas) empieza a 0: con ese peso la puntuación es exactamente la de antes.
// «weather» y «crowd» también empiezan a 0 (docs/METEO-AFLUENCIA.md §4): con los tres a 0 la puntuación es la de antes.
export type Weights = { cost: number; distance: number; size: number; snowNow: number; vibe: number; runs: number; weather: number; crowd: number };
export const DEFAULT_WEIGHTS: Weights = { cost: 0.4, distance: 0.2, size: 0.15, snowNow: 0.15, vibe: 0.1, runs: 0, weather: 0, crowd: 0 };
type OptionalWeights = 'runs' | 'weather' | 'crowd';

export interface ScoreDetail { key: keyof Weights; weight: number; value: number | null; normalized: number | null; points: number }
export interface Scored { id: string; score: number; coverage: number; details: ScoreDetail[]; missing: (keyof Weights)[] }

function norm(v: number | null, min: number, max: number, higherBetter: boolean, zeroScoresNothing = false): number | null {
  if (v == null) return null;
  // Cero pistas no es variedad disponible: aunque todas tengan 0 (o sea la única con dato), no suma puntos.
  if (zeroScoresNothing && v === 0) return 0;
  if (max === min) return 1;
  const x = (v - min) / (max - min);
  return higherBetter ? x : 1 - x;
}

export function scoreRows(rows: readonly ScoreRow[], weights: Omit<Weights, OptionalWeights> & Partial<Pick<Weights, OptionalWeights>> = DEFAULT_WEIGHTS): Scored[] {
  const range = (f: (r: ScoreRow) => number | null) => {
    const v = rows.map(f).filter((x): x is number => x != null);
    return v.length ? [Math.min(...v), Math.max(...v)] : [0, 0];
  };
  const rc = range((r) => r.costPerPersonCents), rd = range((r) => r.roadKm), rs = range((r) => r.totalKm), rn = range((r) => r.openKmNow), rv = range((r) => r.vibe), rr = range((r) => r.runs ?? null), ra = range((r) => r.crowd ?? null);
  const totalW = Object.values(weights).reduce((a, b) => a + Math.max(0, b), 0) || 1;
  return rows.map((r) => {
    const parts: [keyof Weights, number | null, number | null][] = [
      ['cost', r.costPerPersonCents, norm(r.costPerPersonCents, rc[0], rc[1], false)],
      ['distance', r.roadKm, norm(r.roadKm, rd[0], rd[1], false)],
      ['size', r.totalKm, norm(r.totalKm, rs[0], rs[1], true)],
      ['snowNow', r.openKmNow, norm(r.openKmNow, rn[0], rn[1], true)],
      ['vibe', r.vibe, norm(r.vibe, rv[0], rv[1], true)],
      ['runs', r.runs ?? null, norm(r.runs ?? null, rr[0], rr[1], true, true)],
      // Absoluta: dos estaciones con casi el mismo tiempo no quedan a 0 y 100 por una diferencia pequeña.
      ['weather', r.weather ?? null, r.weather == null ? null : Math.min(1, Math.max(0, r.weather))],
      ['crowd', r.crowd ?? null, norm(r.crowd ?? null, ra[0], ra[1], false)],
    ];
    const details = parts.map(([key, value, n]) => {
      const w = Math.max(0, (weights as Partial<Weights>)[key] ?? 0) / totalW;
      return { key, weight: w, value, normalized: n, points: n == null ? 0 : n * w * 100 };
    });
    const missing = details.filter((d) => d.normalized == null && d.weight > 0).map((d) => d.key);
    const coverage = details.filter((d) => d.normalized != null).reduce((s, d) => s + d.weight, 0);
    return { id: r.id, score: Math.round(details.reduce((s, d) => s + d.points, 0) * 10) / 10, coverage: Math.round(coverage * 100) / 100, details, missing };
  // Empate de puntos: primero la que tiene más criterios con dato. Así la más cara de las completas (0 puntos de coste
  // por la normalización) nunca queda detrás de una con el coste pendiente.
  }).sort((a, b) => b.score - a.score || b.coverage - a.coverage || a.id.localeCompare(b.id));
}
