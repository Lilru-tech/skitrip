import { describe, expect, it } from 'vitest';
import { dailyIntensity, sameDaySummary, validateCrowdDraft, validDate, validMmdd, weekdayOf, yearsChecked, type CrowdDraft, type CrowdObservation, type SameDayKm } from '../../src/core/crowds';

const o = (p: Partial<CrowdObservation>): CrowdObservation => ({
  id: 1, areaId: 'la-molina', date: '2026-02-15', measure: 'daily_skiers', status: 'value', value: 1000, sample: 'regular',
  sourceRef: 'https://example.invalid', sourceTitle: null, sourcePublished: null, note: null, ...p,
});
const km = (p: Partial<SameDayKm>): SameDayKm => ({ areaId: 'la-molina', date: '2026-02-15', sourceDate: '2026-02-15', openKm: 50, opStatus: 'open', quality: 'ok', sourceId: 's1', ...p });
const draft = (p: Partial<CrowdDraft> = {}): CrowdDraft => ({
  areaId: 'la-molina', date: '2026-02-15', measure: 'daily_skiers', status: 'value', value: 100, sample: 'regular',
  sourceRef: 'https://example.invalid/n', sourceTitle: null, sourcePublished: null, note: null, reason: 'Noticia verificada', ...p,
});

describe('fechas', () => {
  it('29 de febrero solo en bisiestos; día y mes existentes', () => {
    expect(validDate('2024-02-29')).toBe(true);
    expect(validDate('2026-02-29')).toBe(false);
    expect(validDate('1900-02-29')).toBe(false);
    expect(validDate('2000-02-29')).toBe(true);
    expect(validMmdd('02-29')).toBe(true);
    expect(validMmdd('02-30')).toBe(false);
    expect(validMmdd('04-31')).toBe(false);
    expect(validMmdd('2-15')).toBe(false);
    expect(weekdayOf('2026-02-21')).toBe('sábado');
    expect(weekdayOf('2026-02-15')).toBe('domingo');
  });
  it('años revisados: el 29/02 no se sustituye en años no bisiestos y el día de este año cuenta solo si ya pasó', () => {
    expect(yearsChecked('02-29', 2019, '2026-11-18')).toEqual([2020, 2024]);
    expect(yearsChecked('02-15', 2024, '2026-11-18')).toEqual([2024, 2025, 2026]);
    expect(yearsChecked('12-20', 2024, '2026-11-18')).toEqual([2024, 2025]);
    expect(yearsChecked('11-18', 2025, '2026-11-18')).toEqual([2025, 2026]);
    expect(yearsChecked('02-15', null, '2026-11-18')).toEqual([]);
  });
});

describe('resumen del mismo día y mes', () => {
  const list = [
    o({ id: 1, date: '2024-02-15', value: 800 }),
    o({ id: 2, date: '2025-02-15', value: 1200 }),
    o({ id: 3, date: '2023-02-15', status: 'closed', value: null }),
    o({ id: 4, date: '2025-02-15', measure: 'visitors', value: 5000 }),
    o({ id: 5, date: '2025-02-16', value: 99999 }),
    o({ id: 6, areaId: 'alp-2500', date: '2022-02-15', value: 7000 }),
  ];
  it('media solo entre cifras de la misma medida y ámbito; cierre fuera de la media; otros días y ámbitos fuera', () => {
    const s = sameDaySummary(list, 'la-molina', '02-15', [2022, 2023, 2024, 2025, 2026]);
    const skiers = s.find((x) => x.measure === 'daily_skiers')!;
    expect(skiers).toMatchObject({ yearsWithValue: [2024, 2025], yearsClosed: [2023], yearsWithout: [2022, 2026], observations: 3, mean: 1000, min: 800, max: 1200, selectedSample: false });
    const visitors = s.find((x) => x.measure === 'visitors')!;
    expect(visitors).toMatchObject({ yearsWithValue: [2025], mean: null, observations: 1 });
    expect(sameDaySummary(list, 'alp-2500', '02-15', [2022])[0]).toMatchObject({ yearsWithValue: [2022], mean: null });
  });
  it('un cero confirmado cuenta en la media; un cierre no es cero', () => {
    const s = sameDaySummary([o({ date: '2024-02-15', value: 0 }), o({ id: 2, date: '2025-02-15', value: 1000 }), o({ id: 3, date: '2023-02-15', status: 'closed', value: null })], 'la-molina', '02-15', [2023, 2024, 2025]);
    expect(s[0]).toMatchObject({ mean: 500, min: 0, yearsClosed: [2023] });
  });
  it('muestras de récord: se marcan y la media no es afluencia habitual', () => {
    const s = sameDaySummary([o({ date: '2024-02-15', sample: 'record' }), o({ id: 2, date: '2025-02-15' })], 'la-molina', '02-15', [2024, 2025]);
    expect(s[0].selectedSample).toBe(true);
  });
  it('sin observaciones: ningún resumen (no se rellena con ceros)', () => {
    expect(sameDaySummary([], 'la-molina', '02-15', [2024, 2025])).toEqual([]);
  });
});

describe('intensidad diaria', () => {
  it('esquiadores / km abiertos del parte del mismo día y ámbito', () => {
    expect(dailyIntensity(o({ value: 1000 }), [km({ openKm: 40 })])).toEqual({ value: 25, openKm: 40, sourceId: 's1' });
  });
  it('sin parte del mismo día, de otro ámbito o de otra fecha publicada: no calculable', () => {
    expect(dailyIntensity(o({}), [])).toMatchObject({ value: null, missing: 'no_report' });
    expect(dailyIntensity(o({}), [km({ areaId: 'alp-2500' })])).toMatchObject({ value: null, missing: 'no_report' });
    expect(dailyIntensity(o({}), [km({ sourceDate: '2026-02-14' })])).toMatchObject({ value: null, missing: 'no_report' });
    expect(dailyIntensity(o({}), [km({ quality: 'suspicious' })])).toMatchObject({ value: null, missing: 'no_report' });
  });
  it('km ausentes, cero o discrepantes entre partes válidos: no calculable', () => {
    expect(dailyIntensity(o({}), [km({ openKm: null })])).toMatchObject({ value: null, missing: 'no_km' });
    expect(dailyIntensity(o({}), [km({ openKm: 0 })])).toMatchObject({ value: null, missing: 'zero_km', openKm: 0 });
    expect(dailyIntensity(o({}), [km({ openKm: 40 }), km({ openKm: 45, sourceId: 's2' })])).toMatchObject({ value: null, missing: 'no_report' });
  });
  it('otras medidas no dan intensidad (unidades incompatibles), pero se muestran sus km del día', () => {
    expect(dailyIntensity(o({ measure: 'visitors' }), [km({})])).toEqual({ value: null, missing: 'not_daily_skiers', openKm: 50 });
    expect(dailyIntensity(o({ measure: 'skier_days_sold' }), [km({})])).toMatchObject({ value: null, missing: 'not_daily_skiers' });
    expect(dailyIntensity(o({ status: 'closed', value: null }), [km({})])).toMatchObject({ value: null, missing: 'closed' });
  });
});

describe('validación de aportaciones', () => {
  const today = '2026-11-18';
  it('válida', () => expect(validateCrowdDraft(draft(), today)).toEqual([]));
  it('fechas imposibles o futuras', () => {
    expect(validateCrowdDraft(draft({ date: '2026-02-29' }), today).join()).toMatch(/bisiestos/);
    expect(validateCrowdDraft(draft({ date: '2026-12-01' }), today).join()).toMatch(/futura/);
  });
  it('cifra obligatoria con «value», prohibida con cierre; cero permitido', () => {
    expect(validateCrowdDraft(draft({ value: null }), today).join()).toMatch(/cifra/);
    expect(validateCrowdDraft(draft({ value: 0 }), today)).toEqual([]);
    expect(validateCrowdDraft(draft({ status: 'closed', value: 0 }), today).join()).toMatch(/cierre/);
    expect(validateCrowdDraft(draft({ status: 'closed', value: null }), today)).toEqual([]);
  });
  it('fuente https y fechas de publicación coherentes; motivo obligatorio', () => {
    expect(validateCrowdDraft(draft({ sourceRef: 'nota de prensa' }), today).join()).toMatch(/https/);
    expect(validateCrowdDraft(draft({ sourcePublished: '2026-02-01' }), today).join()).toMatch(/anterior/);
    expect(validateCrowdDraft(draft({ reason: 'x' }), today).join()).toMatch(/motivo/);
  });
});
