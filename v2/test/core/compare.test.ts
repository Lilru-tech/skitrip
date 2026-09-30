import { describe, expect, it } from 'vitest';
import { pickSnow, rankCosts, snowForRanking, type SnowCandidate } from '../../src/core/compare';
import type { BudgetResult } from '../../src/core/budget';

const NOW = Date.UTC(2027, 0, 15, 12);
const s = (over: Partial<SnowCandidate>): SnowCandidate => ({ sourceId: 'a', priority: 100, observedAt: NOW - 3600_000, opStatus: 'open', openKm: 50, quality: 'ok', ...over });

describe('selección de nieve', () => {
  it('determinista: misma entrada en distinto orden → misma fuente (prioridad, luego fecha, luego id)', () => {
    const c = [s({ sourceId: 'b', priority: 10 }), s({ sourceId: 'a', priority: 10 }), s({ sourceId: 'c', priority: 5, observedAt: NOW - 7200_000 })];
    expect(pickSnow(c, NOW)!.sourceId).toBe('c');
    expect(pickSnow([c[1], c[0]], NOW)!.sourceId).toBe('a');
    expect(pickSnow([c[0], c[1]], NOW)!.sourceId).toBe('a');
  });
  it('una fuente preferente pero antigua o dudosa no gana a una reciente y fiable', () => {
    const old = s({ sourceId: 'oficial', priority: 1, observedAt: NOW - 40 * 3600_000 });
    const dud = s({ sourceId: 'dudosa', priority: 2, quality: 'total_mismatch' });
    const ok = s({ sourceId: 'agregador', priority: 50 });
    expect(pickSnow([old, dud, ok], NOW)!.sourceId).toBe('agregador');
    expect(pickSnow([old], NOW)!.sourceId).toBe('oficial'); // se muestra, pero…
    expect(snowForRanking(old, NOW)).toEqual({ openKm: null, excluded: 'antiguo' }); // …no puntúa
  });
  it('excluye del criterio datos dudosos, sin estado o sin km; cerrado confirmado cuenta como 0', () => {
    expect(snowForRanking(s({ quality: 'suspicious' }), NOW).excluded).toBe('dudoso');
    expect(snowForRanking(s({ opStatus: 'unknown' }), NOW).excluded).toBe('estado_desconocido');
    expect(snowForRanking(s({ openKm: null }), NOW).excluded).toBe('sin_km');
    expect(snowForRanking(s({ openKm: null, opStatus: 'closed_confirmed' }), NOW)).toEqual({ openKm: 0, excluded: null });
    expect(snowForRanking(null, NOW).excluded).toBe('sin_dato');
  });
});

const budget = (over: Partial<BudgetResult>): BudgetResult => ({ components: [], knownSubtotalCents: 0, estimatedSubtotalCents: 0, pending: [], complete: true,
  perPersonCents: 0, knownPerPersonCents: 0, warnings: [], ...over });

describe('comparación de coste', () => {
  it('un presupuesto incompleto nunca aparece como el más barato ni tiene posición', () => {
    const r = rankCosts([
      { id: '1', title: 'Hotel caro', areaId: 'x', roadKm: 300, roadValidated: true, budget: budget({ perPersonCents: 40000, knownSubtotalCents: 80000, knownPerPersonCents: 40000 }) },
      { id: '2', title: 'Apartamento sin forfait', areaId: 'y', roadKm: 200, roadValidated: false, budget: budget({ complete: false, perPersonCents: null, knownSubtotalCents: 10000, knownPerPersonCents: 5000, pending: ['Forfait'] }) },
      { id: '3', title: 'Hotel barato', areaId: 'x', roadKm: 300, roadValidated: true, budget: budget({ perPersonCents: 30000, knownSubtotalCents: 60000, knownPerPersonCents: 30000 }) },
    ]);
    expect(r.map((x) => [x.id, x.rank])).toEqual([['3', 1], ['1', 2], ['2', null]]);
    expect(r[2]).toMatchObject({ perPersonCents: null, totalCents: null, pending: ['Forfait'], knownPerPersonCents: 5000 });
  });
});
