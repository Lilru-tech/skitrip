// Lectura de los días de D1 sin JSON.parse (disponibilidad del viaje y fechas comunes con grupos grandes):
// debe dar exactamente lo mismo que analizar el objeto y consultarlo día a día, y rendirse ante cualquier forma rara.
import { describe, expect, it } from 'vitest';
import { codesFromDayObject, recordLookup, summarize, type DayStatus, type PersonDays } from '../../src/core/calendar';
import { addDays, eachDay } from '../../src/core/dates';

const CODE = { free: 1, maybe: 2, busy: 3 } as const;
const viaParse = (raw: string, days: string[]) => { const o = JSON.parse(raw) as Record<string, DayStatus>; return Uint8Array.from(days, (d) => (o[d] ? CODE[o[d]] : 0)); };
/** Mismo texto que json_group_object(day, status) sobre filas ordenadas por día. */
const groupObject = (entries: [string, DayStatus][]) => JSON.stringify(Object.fromEntries([...entries].sort(([a], [b]) => (a < b ? -1 : 1))));
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

describe('codesFromDayObject', () => {
  it('coincide con JSON.parse + consulta por día en calendarios pseudoaleatorios (años bisiestos, cambio de año, días fuera del rango)', () => {
    for (let c = 0; c < 400; c++) {
      const from = addDays('2023-11-15', Math.floor(rnd() * 1500));
      const days = eachDay(from, addDays(from, Math.floor(rnd() * 366)));
      // Filas también antes y después del rango pedido (la consulta real no las trae, pero no deben contar).
      const entries: [string, DayStatus][] = [];
      for (let d = addDays(from, -5); d <= addDays(days.at(-1)!, 5); d = addDays(d, 1)) if (rnd() < 0.7) entries.push([d, (['free', 'maybe', 'busy'] as const)[Math.floor(rnd() * 3)]]);
      const raw = groupObject(entries);
      expect(codesFromDayObject(raw, days)).toEqual(viaParse(raw, days));
    }
  });

  it('persona que comparte pero no ha indicado nada: todo «sin indicar»', () => {
    expect(codesFromDayObject('{}', eachDay('2026-12-01', '2026-12-03'))).toEqual(new Uint8Array(3));
  });

  it('ante una forma inesperada devuelve null (quien llama usa JSON.parse)', () => {
    const days = eachDay('2026-12-01', '2026-12-05');
    for (const raw of [
      '{"2026-12-02":"free","2026-12-01":"busy"}', // fuera de orden
      '{"2026-12-01":"free","2026-12-01":"busy"}', // repetida
      '{"2026-12-32":"free"}', '{"2027-02-29":"free"}', // no son fechas reales
      '{"2026-12-01":"libre"}', '{"2026-12-01":"freee"}', '{"2026-12-01":1}',
      '{ "2026-12-01":"free"}', '{"2026-12-01": "free"}', '{"2026-12-01":"free",}', '{"2026-12-01":"free"} ', '[]', '', '{',
      '{"2026\\u002d12-01":"free"}',
    ]) expect(codesFromDayObject(raw, days), raw).toBeNull();
  });

  it('summarize con los códigos ya leídos da lo mismo que con el objeto (recuento diario e intervalos)', () => {
    const days = eachDay('2026-12-01', '2027-04-29');
    const raws = Array.from({ length: 16 }, (_, k) => groupObject(days.filter((_, i) => (i + k) % 11 !== 0).map((d, i) => [d, (['busy', 'maybe', 'busy', 'free', 'free', 'free', 'free'] as const)[(i + k * 3) % 7]])));
    for (const [nights, min] of [[2, undefined], [0, 3], [1, 8], [5, 1]] as const) {
      const o = { from: days[0], to: days.at(-1)!, nights, minPeople: min ?? 15, limit: 30 };
      const viaObj: PersonDays[] = raws.map((r, k) => ({ id: `p${k}`, days: k === 3 ? null : recordLookup(JSON.parse(r)) }));
      const viaCodes: PersonDays[] = raws.map((r, k) => (k === 3 ? { id: `p${k}`, days: null } : { id: `p${k}`, days: { get: () => undefined }, codes: codesFromDayObject(r, days)! }));
      expect(summarize(viaCodes, o, days)).toEqual(summarize(viaObj, o));
    }
  });
});

describe('eachDay', () => {
  const ref = (a: string, b: string) => { const o: string[] = []; for (let d = a; d <= b; d = addDays(d, 1)) o.push(d); return o; };
  it('misma lista que avanzar día a día con addDays (bisiestos, fin de siglo, cambios de horario, rangos vacíos)', () => {
    for (let t = Date.UTC(1999, 0, 1); t < Date.UTC(2101, 0, 1); t += 86400_000 * 37) {
      const a = new Date(t).toISOString().slice(0, 10);
      for (const len of [-3, 0, 1, 28, 59, 150, 366]) expect(eachDay(a, addDays(a, len))).toEqual(ref(a, addDays(a, len)));
    }
  });
});
