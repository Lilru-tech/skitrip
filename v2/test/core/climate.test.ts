import { describe, expect, it } from 'vitest';
import { CLIMATE_SEASONS, climateSeasonUnits, climateSummary, climateWindows, seasonLength, seasonOf, seriesFromDaily, type ClimateSeries } from '../../src/core/climate';
import { addDays } from '../../src/core/dates';

const series = (season: number, f: (date: string, i: number) => Partial<Record<'tmax' | 'tmin' | 'precip' | 'rain' | 'snow' | 'gust', number | null>> = () => ({})): ClimateSeries => {
  const n = seasonLength(season);
  const start = `${season}-10-20`;
  const days = Array.from({ length: n }, (_, i) => ({ tmax: 2, tmin: -5, precip: 0, rain: 0, snow: 0, gust: 30, ...f(addDays(start, i), i) }));
  const col = (k: keyof (typeof days)[number]) => days.map((d) => d[k] ?? null);
  return { start, tmax: col('tmax'), tmin: col('tmin'), precip: col('precip'), rain: col('rain'), snow: col('snow'), gust: col('gust') };
};

describe('ventanas de ±7 días', () => {
  it('30 años (1996–2025), 15 días con un solo día; un viaje de 3 días da una sola ventana de 17', () => {
    const one = climateWindows('2027-01-15', '2027-01-15');
    expect(one.ok && one.windows.length).toBe(30);
    expect(one.ok && one.windows[0]).toEqual({ year: 1996, season: 1995, from: '1996-01-08', to: '1996-01-22' });
    const trip = climateWindows('2027-02-10', '2027-02-12');
    expect(trip.ok && trip.windows[29]).toEqual({ year: 2025, season: 2024, from: '2025-02-03', to: '2025-02-19' });
  });
  it('cruce de año: 28/12 ±7 llega a enero del año siguiente, en la misma temporada', () => {
    const w = climateWindows('2026-12-28', '2026-12-28');
    expect(w.ok && w.windows.at(-1)).toEqual({ year: 2025, season: 2025, from: '2025-12-21', to: '2026-01-04' });
  });
  it('29/02: solo en bisiestos; en los demás, del 28/02 al 01/03 sin inventar el día', () => {
    const w = climateWindows('2028-02-29', '2028-02-29');
    if (!w.ok) throw new Error('debería valer');
    expect(w.windows.find((x) => x.year === 2024)).toMatchObject({ from: '2024-02-22', to: '2024-03-07' });
    expect(w.windows.find((x) => x.year === 2025)).toMatchObject({ from: '2025-02-21', to: '2025-03-08' });
  });
  it('fuera de la temporada guardada se dice (no se resume con menos días)', () => {
    expect(climateWindows('2027-10-22', '2027-10-23')).toEqual({ ok: false, reason: 'out_of_season' });
    expect(climateWindows('2027-05-01', '2027-05-05')).toEqual({ ok: false, reason: 'out_of_season' });
    expect(climateWindows('2027-07-01', '2027-07-01')).toEqual({ ok: false, reason: 'out_of_season' });
    expect(climateWindows('2027-10-27', '2027-10-27').ok).toBe(true);
    expect(climateWindows('2027-05-03', '2027-05-03').ok).toBe(true);
    expect(climateWindows('2027-02-10', '2027-02-01')).toEqual({ ok: false, reason: 'invalid' });
  });
  it('temporadas 1995–2025 y su coste en unidades', () => {
    expect(CLIMATE_SEASONS[0]).toBe(1995);
    expect(CLIMATE_SEASONS.at(-1)).toBe(2025);
    expect(seasonOf('2026-01-10')).toBe(2025);
    expect(seasonOf('2026-06-10')).toBeNull();
    expect(seasonLength(2023)).toBe(204); // 2024 es bisiesto
    expect(climateSeasonUnits(203)).toBeCloseTo(14.5);
  });
});

describe('resumen', () => {
  const w = climateWindows('2027-01-15', '2027-01-15');
  if (!w.ok) throw new Error('debería valer');
  it('medianas y percentiles, frecuencias «X de Y días» con su denominador', () => {
    const seasons = new Map(CLIMATE_SEASONS.map((y) => [y, series(y, (d) => ({ snow: d.endsWith('-01-15') ? 5 : 0, tmax: d.endsWith('-01-15') ? 10 : 2 }))]));
    const s = climateSummary(w.windows, seasons);
    expect(s.years).toBe(30);
    expect(s.tmax).toMatchObject({ median: 2, n: 450 });
    expect(s.snowDays).toEqual({ days: 30, of: 450 });
    expect(s.precipDays).toEqual({ days: 0, of: 450 });
  });
  it('un día sin dato no cuenta en el denominador ni se rellena con 0; temporadas que faltan no cuentan', () => {
    const seasons = new Map([[2010, series(2010, (d) => (d === '2011-01-15' ? { snow: null, precip: null } : {}))]]);
    const s = climateSummary(w.windows, seasons);
    expect(s.years).toBe(1);
    expect(s.expectedYears).toBe(30);
    expect(s.snowDays).toEqual({ days: 0, of: 14 });
    expect(s.tmax.n).toBe(15);
  });
  it('sin temporadas: sin dato, nunca ceros', () => {
    const s = climateSummary(w.windows, new Map());
    expect(s).toMatchObject({ years: 0, tmax: { median: null }, snowDays: { days: 0, of: 0 }, precipMedian: null });
  });
});

describe('respuesta del proveedor', () => {
  it('exige la temporada completa y redondea; null se queda en null', () => {
    const n = seasonLength(2020);
    const time = Array.from({ length: n }, (_, i) => addDays('2020-10-20', i));
    const col = (v: number | null) => Array.from({ length: n }, (_, i) => (i === 3 ? null : v));
    const daily = { time, temperature_2m_max: col(1.234), temperature_2m_min: col(-3), precipitation_sum: col(0), rain_sum: col(0), snowfall_sum: col(2.06), wind_gusts_10m_max: col(40) };
    const s = seriesFromDaily(daily, 2020);
    expect(s.tmax[0]).toBe(1.2);
    expect(s.snow[0]).toBe(2.1);
    expect(s.tmax[3]).toBeNull();
    expect(() => seriesFromDaily({ ...daily, time: time.slice(1) }, 2020)).toThrow(/incompleta/);
    expect(() => seriesFromDaily({ ...daily, snowfall_sum: undefined }, 2020)).toThrow(/snowfall_sum/);
  });
});
