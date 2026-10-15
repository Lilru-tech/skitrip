// Coste por persona por estación para los pesos de Comparar: la más barata entre las completas, el dominio agrupa a
// sus estaciones y una estación sin presupuesto completo queda pendiente (nunca 0 € ni la más barata).
import { describe, expect, it } from 'vitest';
import { costsByArea, tripCostMissing } from '../../src/core/compare';
import { scoreRows } from '../../src/core/score';

const row = (o: Partial<Parameters<typeof costsByArea>[0][number]>) => ({ id: 'x', title: 'X', areaId: 'a', complete: true, perPersonCents: 10000, pending: [], ...o });

describe('costsByArea', () => {
  it('usa la más barata de las completas y dice de cuál sale', () => {
    const m = costsByArea([
      row({ id: 'c1', title: 'Hotel caro', perPersonCents: 38000, modality: 'lodging', forfaitIncluded: 'no' }),
      row({ id: 'c2', title: 'Paquete', perPersonCents: 28000, modality: 'lodging_forfait', forfaitIncluded: 'yes', hypothetical: true }),
      row({ id: 'c3', title: 'Más barato pero incompleto', complete: false, perPersonCents: null, pending: ['Forfait'] }),
    ]);
    expect(m.get('a')).toEqual({ perPersonCents: 28000, via: { id: 'c2', title: 'Paquete', package: true, hypothetical: true }, completeCount: 2, candidateCount: 3, pending: ['Forfait'] });
  });

  it('sin completas: coste pendiente con lo que falta; el dominio agrupa a sus miembros', () => {
    const m = costsByArea([
      row({ id: 'n1', areaId: 'norte', complete: false, perPersonCents: null, pending: ['Forfait', 'Peajes'] }),
      row({ id: 'n2', areaId: 'sur', complete: false, perPersonCents: null, pending: ['Forfait'] }),
      row({ id: 'n3', areaId: null }),
    ], (id) => (id === 'norte' || id === 'sur' ? 'dominio' : id));
    expect(m.get('dominio')).toMatchObject({ perPersonCents: null, via: null, completeCount: 0, candidateCount: 2, pending: ['Forfait', 'Peajes'] });
    expect(m.size).toBe(1);
  });

  it('una estación pendiente nunca puntúa como la más barata', () => {
    const m = costsByArea([row({ id: 'a1', areaId: 'a', perPersonCents: 30000 }), row({ id: 'b1', areaId: 'b', complete: false, perPersonCents: null, pending: ['Alojamiento'] })]);
    const s = scoreRows(['a', 'b'].map((id) => ({ id, costPerPersonCents: m.get(id)?.perPersonCents ?? null, roadKm: 100, totalKm: 50, openKmNow: null, vibe: 5 })),
      { cost: 1, distance: 0, size: 0, snowNow: 0, vibe: 0 });
    expect(s.map((x) => [x.id, x.score])).toEqual([['a', 100], ['b', 0]]);
    expect(s.find((x) => x.id === 'b')!.missing).toEqual(['cost']);
  });
});

describe('tripCostMissing', () => {
  it('pide fechas, noches y días de esquí', () => {
    expect(tripCostMissing({ startDate: null, endDate: null, nights: null, skiDays: null })).toEqual(['fechas de llegada y salida', 'noches', 'días de esquí']);
    expect(tripCostMissing({ startDate: '2027-02-12', endDate: '2027-02-14', nights: 2, skiDays: 2 })).toEqual([]);
  });
});
