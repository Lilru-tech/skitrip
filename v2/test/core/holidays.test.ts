// Reparto de OpenHolidays entre los calendarios de SkiTrip y cruce con las fechas. Elementos con la forma real de la API
// (consultada el 19/11/2026: /PublicHolidays y /SchoolHolidays de ES, FR y AD); sin red.
import { describe, expect, it } from 'vitest';
import { calendarDays, HOLIDAY_CALENDARS, periodsFromOpenHolidays, type HolidayPeriod, type OpenHolidayItem } from '../../src/core/holidays';

const it_ = (startDate: string, endDate: string, text: string, nationwide: boolean, codes: string[] = []): OpenHolidayItem =>
  ({ startDate, endDate, name: [{ language: 'ES', text }], nationwide, temporalScope: 'FullDay', ...(codes.length ? { subdivisions: codes.map((code) => ({ code, shortName: code.replace(/^[A-Z]{2}-/, '') })) } : {}) });

describe('reparto entre calendarios', () => {
  it('nacional para todas las comunidades; regional solo para la suya; provincia como «solo en parte»', () => {
    const p = periodsFromOpenHolidays('ES', 'public', [
      it_('2026-12-08', '2026-12-08', 'Inmaculada Concepción', true),
      it_('2026-12-07', '2026-12-07', 'Lunes siguiente al Día de la Constitución Española', false, ['ES-AR', 'ES-MD', 'ES-RI']),
      it_('2026-12-26', '2026-12-26', 'San Esteban', false, ['ES-CT', 'ES-IB']),
      it_('2026-02-02', '2026-02-02', 'Virgen de la Candelaria', false, ['ES-CN-SC-TE']),
    ]);
    const of = (cal: string) => p.filter((x) => x.calendarId === cal).map((x) => `${x.start} ${x.scope}`);
    expect(of('es-ct')).toEqual(['2026-12-08 all', '2026-12-26 all']);
    expect(of('es-md')).toEqual(['2026-12-07 all', '2026-12-08 all']);
    expect(of('es-vc')).toEqual(['2026-12-08 all']);
    expect(p.some((x) => x.name === 'Virgen de la Candelaria')).toBe(false);
    expect(p.every((x) => !x.calendarId.startsWith('fr') && x.calendarId !== 'ad')).toBe(true);
    const sch = periodsFromOpenHolidays('ES', 'school', [it_('2026-02-19', '2026-02-20', 'Día no lectivo', false, ['ES-AR-TE', 'ES-AR-HU'])]);
    expect(sch).toEqual([{ calendarId: 'es-ar', kind: 'school', start: '2026-02-19', end: '2026-02-20', name: 'Día no lectivo', scope: 'part', parts: 'AR-TE, AR-HU' }]);
  });
  it('Francia: vacaciones por zona y festivos nacionales en las tres zonas; Andorra sin subdivisiones', () => {
    const sch = periodsFromOpenHolidays('FR', 'school', [
      it_('2026-02-08', '2026-02-22', "Vacances d'hiver", false, ['FR-BF', 'FR-NA', 'FR-AR', 'FR-ZA']),
      it_('2026-02-22', '2026-03-08', "Vacances d'hiver", false, ['FR-IF', 'FR-OC', 'FR-ZC']),
    ]);
    expect(sch.map((x) => `${x.calendarId} ${x.start}`)).toEqual(['fr-za 2026-02-08', 'fr-zc 2026-02-22']);
    const pub = periodsFromOpenHolidays('FR', 'public', [it_('2026-05-01', '2026-05-01', 'Fête du Travail', true)]);
    expect(pub.map((x) => x.calendarId)).toEqual(['fr-za', 'fr-zb', 'fr-zc']);
    const ad = periodsFromOpenHolidays('AD', 'school', [it_('2026-02-16', '2026-02-20', 'Vacances de Carnaval', true)]);
    expect(ad).toMatchObject([{ calendarId: 'ad', scope: 'all' }]);
  });
  it('descarta fechas mal formadas y medias jornadas', () => {
    expect(periodsFromOpenHolidays('ES', 'public', [{ ...it_('2026-12-24', '2026-12-24', 'Nochebuena', true), temporalScope: 'HalfDay' }, it_('2026-13-01', '2026-13-01', 'Mal', true), it_('2026-05-02', '2026-05-01', 'Al revés', true)])).toEqual([]);
  });
});

describe('cruce con las fechas', () => {
  const P = (calendarId: string, kind: 'public' | 'school', start: string, end: string, name: string, scope: 'all' | 'part' = 'all'): HolidayPeriod => ({ calendarId, kind, start, end, name, scope, parts: null });
  const days = ['2027-02-27', '2027-02-28', '2027-03-01'];
  const known = new Map(HOLIDAY_CALENDARS.map((c) => [c.id, { public: '2027-12-26', school: '2027-06-30' }]));
  it('recorta los periodos a las fechas y ordena', () => {
    const r = calendarDays(days, [P('fr-zc', 'school', '2027-02-20', '2027-03-07', "Vacances d'hiver"), P('es-ct', 'school', '2027-03-20', '2027-03-28', 'Semana Santa')], known);
    const zc = r.find((c) => c.calendarId === 'fr-zc')!;
    expect(zc.periods).toMatchObject([{ from: '2027-02-27', to: '2027-03-01', start: '2027-02-20', end: '2027-03-07' }]);
    expect(r.find((c) => c.calendarId === 'es-ct')!.periods).toEqual([]);
    expect(r.every((c) => c.unknownDays.length === 0)).toBe(true);
  });
  it('sin calendario publicado para esos días: «sin calendario», nunca «sin fiesta»', () => {
    const k = new Map(known);
    k.set('es-ct', { public: '2027-12-26', school: '2027-02-27' });
    k.delete('ad');
    const r = calendarDays(days, [], k);
    expect(r.find((c) => c.calendarId === 'es-ct')!.unknownDays).toEqual(['2027-02-28', '2027-03-01']);
    expect(r.find((c) => c.calendarId === 'ad')!.unknownDays).toEqual(days);
    expect(r.find((c) => c.calendarId === 'es-ar')!.unknownDays).toEqual([]);
  });
});
