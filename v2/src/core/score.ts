// Puntuación explicable con pesos editables. Un dato ausente NO puntúa (0 en ese criterio) y se
// declara como ausente: nunca se premia la falta de datos ni se cuenta dos veces el mismo precio.

export interface ScoreRow {
  id: string;
  costPerPersonCents: number | null; // solo presupuestos completos; si es incompleto, null
  roadKm: number | null;
  totalKm: number | null;
  openKmNow: number | null;          // condiciones actuales; no predicen un viaje futuro
  vibe: number | null;               // 0–10 subjetivo
}
export type Weights = { cost: number; distance: number; size: number; snowNow: number; vibe: number };
export const DEFAULT_WEIGHTS: Weights = { cost: 0.4, distance: 0.2, size: 0.15, snowNow: 0.15, vibe: 0.1 };

export interface ScoreDetail { key: keyof Weights; weight: number; value: number | null; normalized: number | null; points: number }
export interface Scored { id: string; score: number; coverage: number; details: ScoreDetail[]; missing: (keyof Weights)[] }

function norm(v: number | null, min: number, max: number, higherBetter: boolean): number | null {
  if (v == null) return null;
  if (max === min) return 1;
  const x = (v - min) / (max - min);
  return higherBetter ? x : 1 - x;
}

export function scoreRows(rows: readonly ScoreRow[], weights: Weights = DEFAULT_WEIGHTS): Scored[] {
  const range = (f: (r: ScoreRow) => number | null) => {
    const v = rows.map(f).filter((x): x is number => x != null);
    return v.length ? [Math.min(...v), Math.max(...v)] : [0, 0];
  };
  const rc = range((r) => r.costPerPersonCents), rd = range((r) => r.roadKm), rs = range((r) => r.totalKm), rn = range((r) => r.openKmNow), rv = range((r) => r.vibe);
  const totalW = Object.values(weights).reduce((a, b) => a + Math.max(0, b), 0) || 1;
  return rows.map((r) => {
    const parts: [keyof Weights, number | null, number | null][] = [
      ['cost', r.costPerPersonCents, norm(r.costPerPersonCents, rc[0], rc[1], false)],
      ['distance', r.roadKm, norm(r.roadKm, rd[0], rd[1], false)],
      ['size', r.totalKm, norm(r.totalKm, rs[0], rs[1], true)],
      ['snowNow', r.openKmNow, norm(r.openKmNow, rn[0], rn[1], true)],
      ['vibe', r.vibe, norm(r.vibe, rv[0], rv[1], true)],
    ];
    const details = parts.map(([key, value, n]) => {
      const w = Math.max(0, weights[key]) / totalW;
      return { key, weight: w, value, normalized: n, points: n == null ? 0 : n * w * 100 };
    });
    const missing = details.filter((d) => d.normalized == null && d.weight > 0).map((d) => d.key);
    const coverage = details.filter((d) => d.normalized != null).reduce((s, d) => s + d.weight, 0);
    return { id: r.id, score: Math.round(details.reduce((s, d) => s + d.points, 0) * 10) / 10, coverage: Math.round(coverage * 100) / 100, details, missing };
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
