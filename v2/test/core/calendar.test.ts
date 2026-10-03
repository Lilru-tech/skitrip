import { describe, expect, it } from 'vitest';
import { dailyCounts, findCandidateWindows, windowStatus, type DayStatus } from '../../src/core/calendar';
import { addDays, daysBetween, eachDay, isValidDate, seasonFor, weekdayMon0 } from '../../src/core/dates';

const m = (o: Record<string, DayStatus>) => new Map(Object.entries(o));

describe('calendario', () => {
  it('sin indicar NO es libre', () => {
    expect(windowStatus(m({ '2026-12-30': 'free' }), '2026-12-30', '2026-12-31')).toBe('unknown');
  });
  it('cruza el cambio de año y el cambio de horario sin perder días', () => {
    expect(eachDay('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
    expect(daysBetween('2027-03-27', '2027-03-29')).toBe(2); // cambio de hora 28/03/2027
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
    expect(weekdayMon0('2027-01-01')).toBe(4); // viernes
  });
  it('temporada diciembre–abril configurable y sin años fijos', () => {
    expect(seasonFor('2027-02-10')).toEqual({ start: '2026-12-01', end: '2027-04-30' });
    expect(seasonFor('2026-12-05')).toEqual({ start: '2026-12-01', end: '2027-04-30' });
    expect(seasonFor('2026-09-30')).toEqual({ start: '2026-12-01', end: '2027-04-30' });
    expect(isValidDate('2027-02-29')).toBe(false);
  });
  const people = [
    { id: 'ana', days: m({ '2026-12-30': 'free', '2026-12-31': 'free', '2027-01-01': 'free', '2027-01-02': 'free' }) },
    { id: 'bru', days: m({ '2026-12-30': 'free', '2026-12-31': 'maybe', '2027-01-01': 'free', '2027-01-02': 'busy' }) },
    { id: 'car', days: m({ '2026-12-30': 'free' }) },
    { id: 'dan', days: null },
  ];
  it('las ventanas incluyen llegada y salida', () => {
    const w = findCandidateWindows(people, { from: '2026-12-30', to: '2027-01-02', nights: 2, minPeople: 1 });
    const first = w.find((x) => x.start === '2026-12-30')!;
    expect(first.end).toBe('2027-01-01');
    expect(first.free).toEqual(['ana']);
    expect(first.maybe).toEqual(['bru']);
    expect(first.unknown).toEqual(['car']);
    expect(first.hidden).toEqual(['dan']);
  });
  it('«todos» exige a todos libres; quizá no se convierte en confirmación', () => {
    expect(findCandidateWindows(people.slice(0, 2), { from: '2026-12-30', to: '2027-01-02', nights: 1 }).filter((w) => w.meetsWithFree).map((w) => w.start)).toEqual([]);
    const withMaybe = findCandidateWindows(people.slice(0, 2), { from: '2026-12-30', to: '2027-01-02', nights: 1 });
    expect(withMaybe.map((w) => w.start)).toContain('2026-12-30');
    expect(withMaybe.every((w) => !w.meetsWithFree || w.maybe.length === 0)).toBe(true);
  });
  it('mínimo de participantes', () => {
    const w = findCandidateWindows(people, { from: '2026-12-30', to: '2027-01-02', nights: 0, minPeople: 3 });
    expect(w.filter((x) => x.meetsWithFree).map((x) => x.start)).toEqual(['2026-12-30']);
  });
  it('recuentos diarios distinguen sin indicar y no compartido', () => {
    const d = dailyCounts(people, '2027-01-02', '2027-01-02')[0];
    expect(d).toMatchObject({ free: 1, busy: 1, unknown: 1, hidden: 1 });
  });
});

describe('búsqueda de intervalos con sumas acumuladas', () => {
  // Referencia: la definición directa, intervalo a intervalo con windowStatus.
  const reference = (people: { id: string; days: Map<string, DayStatus> | null }[], from: string, to: string, nights: number, need: number) => {
    const out = [];
    for (let s = from; daysBetween(s, to) >= nights; s = addDays(s, 1)) {
      const e = addDays(s, nights);
      const w = { start: s, end: e, free: [] as string[], maybe: [] as string[], unknown: [] as string[], busy: [] as string[], hidden: [] as string[] };
      for (const p of people) w[windowStatus(p.days, s, e)].push(p.id);
      if (w.free.length + w.maybe.length >= need && need > 0) out.push(w);
    }
    return out;
  };
  it('coincide con la definición directa en calendarios pseudoaleatorios (con cambio de año y de horario)', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const days = eachDay('2026-10-20', '2027-04-05');
    for (let round = 0; round < 25; round++) {
      const people = Array.from({ length: 1 + Math.floor(rnd() * 8) }, (_, k) => ({
        id: `p${k}`,
        days: rnd() < 0.15 ? null : new Map(days.flatMap((d): [string, DayStatus][] => { const r = rnd(); return r < 0.2 ? [] : [[d, r < 0.75 ? 'free' : r < 0.9 ? 'maybe' : 'busy']]; })),
      }));
      const nights = Math.floor(rnd() * 6);
      const need = 1 + Math.floor(rnd() * people.length);
      const got = findCandidateWindows(people, { from: days[0], to: days.at(-1)!, nights, minPeople: need });
      const ref = reference(people, days[0], days.at(-1)!, nights, need);
      const key = (w: { start: string }) => w.start;
      expect(got.map((w) => ({ start: w.start, end: w.end, free: w.free, maybe: w.maybe, unknown: w.unknown, busy: w.busy, hidden: w.hidden })).sort((a, b) => key(a).localeCompare(key(b)))).toEqual(ref);
    }
  });
});
