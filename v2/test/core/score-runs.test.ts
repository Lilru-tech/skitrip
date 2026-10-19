// Peso opcional «Variedad de pistas»: a 0 conserva la puntuación anterior; ausente no es cero ni ventaja; cero pistas
// nunca puntúa como variedad.
import { describe, expect, it } from 'vitest';
import { DEFAULT_WEIGHTS, scoreRows, type ScoreRow } from '../../src/core/score';

describe('peso «Variedad de pistas»', () => {
  const rows: ScoreRow[] = [
    { id: 'a', costPerPersonCents: 30000, roadKm: 200, totalKm: 100, openKmNow: 50, vibe: 5 },
    { id: 'b', costPerPersonCents: 25000, roadKm: 250, totalKm: 140, openKmNow: null, vibe: 8 },
    { id: 'c', costPerPersonCents: null, roadKm: 150, totalKm: 60, openKmNow: 20, vibe: 6 },
  ];
  const strip = (r: ReturnType<typeof scoreRows>) => r.map(({ id, score, coverage, missing }) => ({ id, score, coverage, missing }));
  it('con el peso a 0 la puntuación es exactamente la anterior, tenga o no datos de pistas', () => {
    const old = { cost: 0.4, distance: 0.2, size: 0.15, snowNow: 0.15, vibe: 0.1 };
    const before = strip(scoreRows(rows, old));
    expect(strip(scoreRows(rows.map((r, i) => ({ ...r, runs: [140, null, 0][i] })), DEFAULT_WEIGHTS))).toEqual(before);
    expect(DEFAULT_WEIGHTS.runs).toBe(0);
  });
  const only = (runs: (number | null)[]) => scoreRows(runs.map((n, i) => ({ id: `r${i}`, costPerPersonCents: null, roadKm: null, totalKm: null, openKmNow: null, vibe: null, runs: n })),
    { cost: 0, distance: 0, size: 0, snowNow: 0, vibe: 0, runs: 1 });
  it('más pistas, más puntos; el dato ausente figura como ausente y no da ventaja', () => {
    const r = only([66, 22, null]);
    expect(r.map((x) => x.id)).toEqual(['r0', 'r1', 'r2']);
    expect(r[0].score).toBe(100);
    expect(r[1].score).toBe(0);
    expect(r[2]).toMatchObject({ score: 0, coverage: 0, missing: ['runs'] });
  });
  it('sin datos, una sola estación con dato y todos iguales', () => {
    expect(only([null, null]).every((x) => x.score === 0 && x.missing.includes('runs'))).toBe(true);
    expect(only([40, null])[0].score).toBe(100);
    expect(only([30, 30]).map((x) => x.score)).toEqual([100, 100]);
  });
  it('cero pistas abiertas nunca puntúa como variedad disponible, aunque todas tengan 0', () => {
    expect(only([0, 0]).map((x) => x.score)).toEqual([0, 0]);
    expect(only([0, null])[0]).toMatchObject({ score: 0, coverage: 1 });
  });
});
