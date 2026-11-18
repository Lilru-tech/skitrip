import { describe, expect, it } from 'vitest';
import {
  addDaysIso, dailyFromHourly, forecastDays, freshnessOf, horizonOf, hoursInMadridDay, madridLocal, madridOffsetHours, splitModels, tripSummary,
  FORECAST_STALE_MS, FORECAST_TTL_MS, UNITS_PER_POINT, type StoredForecast,
} from '../../src/core/weather';

const H = 3600;
/** Serie horaria sintética en segundos UTC desde `startIso` 00:00 UTC, con valores por hora calculados por `f`. */
function series(startIso: string, hours: number, f: (localHour: number, i: number) => Partial<Record<string, number | null>> = () => ({})) {
  const t0 = Date.parse(`${startIso}T00:00:00Z`) / 1000;
  const time = Array.from({ length: hours }, (_, i) => t0 + i * H);
  const vals = time.map((t, i) => ({ temperature_2m: 0, precipitation: 0, rain: 0, snowfall: 0, wind_speed_10m: 10, wind_gusts_10m: 20, ...f(madridLocal(t * 1000).hour, i) }));
  const col = (k: string) => vals.map((v: any) => v[k]);
  return { time, temperature_2m: col('temperature_2m'), precipitation: col('precipitation'), rain: col('rain'), snowfall: col('snowfall'), wind_speed_10m: col('wind_speed_10m'), wind_gusts_10m: col('wind_gusts_10m') };
}

describe('zona horaria de Madrid', () => {
  it('cambio de hora de marzo y octubre (UE): 23 y 25 horas', () => {
    expect(madridOffsetHours(Date.parse('2027-01-15T12:00:00Z'))).toBe(1);
    expect(madridOffsetHours(Date.parse('2027-07-15T12:00:00Z'))).toBe(2);
    expect(madridOffsetHours(Date.parse('2027-03-28T00:59:00Z'))).toBe(1);
    expect(madridOffsetHours(Date.parse('2027-03-28T01:00:00Z'))).toBe(2);
    expect(hoursInMadridDay('2027-03-28')).toBe(23);
    expect(hoursInMadridDay('2026-10-25')).toBe(25);
    expect(hoursInMadridDay('2027-02-15')).toBe(24);
    expect(madridLocal(Date.parse('2027-01-31T23:30:00Z'))).toEqual({ date: '2027-02-01', hour: 0 });
  });
  it('cambio de año', () => expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01'));
});

describe('agregación diaria por modelo', () => {
  it('suma lluvia y nieve del día local completo; 0 es cero, no ausencia', () => {
    const days = dailyFromHourly(series('2027-01-10', 72, (h) => ({ rain: h === 12 ? 2 : 0, snowfall: h === 3 ? 1.5 : 0, temperature_2m: h - 10 })));
    const d = days.find((x) => x.date === '2027-01-10')!;
    expect(d.covered).toBe(true);
    expect(d).toMatchObject({ rain: 2, snow: 1.5, precip: 0, tMin: -10, tMax: 13 });
    const day2 = days.find((x) => x.date === '2027-01-11')!;
    expect(day2.covered).toBe(true);
  });
  it('un día sin todas sus horas locales no está cubierto: sin datos en lugar de ceros', () => {
    // 00:00 UTC = 01:00 local: el primer valor acumula de 00:00 a 01:00 local. Con 20 horas el día 10 queda incompleto.
    const days = dailyFromHourly(series('2027-01-10', 20));
    const first = days[0];
    expect(first.date).toBe('2027-01-10');
    expect(first.hours).toBe(20);
    expect(first.covered).toBe(false);
    expect(first).toMatchObject({ rain: null, snow: null, tMin: null, gustMax: null });
  });
  it('un hueco en cualquier variable deja el día sin cubrir (no se rellena)', () => {
    const days = dailyFromHourly(series('2027-01-09', 72, (_h, i) => (i === 40 ? { wind_gusts_10m: null } : {})));
    expect(days.find((x) => x.date === '2027-01-10')!.covered).toBe(false);
  });
  it('franja de esquí 09–17 h local: lluvia, nieve y horas con racha ≥ 60 km/h (8 horas)', () => {
    const days = dailyFromHourly(series('2027-01-09', 72, (h) => ({ rain: h === 10 ? 1 : h === 20 ? 5 : 0, wind_gusts_10m: h >= 12 && h <= 14 ? 75 : 30, snowfall: h === 17 ? 2 : 0 })));
    const d = days.find((x) => x.date === '2027-01-10')!;
    expect(d.ski).toEqual({ hours: 8, rain: 1, snow: 2, gustMax: 75, strongGustHours: 3 });
    expect(d.rain).toBe(6);
  });
  it('separa las series de cada modelo (variable_modelo)', () => {
    const per = splitModels({ time: [1, 2], rain_ecmwf_ifs: [1, 2], rain_icon_seamless: [3, null] }, ['ecmwf_ifs', 'icon_seamless']);
    expect(per.ecmwf_ifs.rain).toEqual([1, 2]);
    expect(per.icon_seamless.rain).toEqual([3, null]);
  });
});

const today = '2027-01-10';
const stored = (): StoredForecast => {
  const s = series('2027-01-09', 8 * 24 + 24);
  const icon = series('2027-01-09', 5 * 24, () => ({ rain: 4, wind_gusts_10m: 90 }));
  const mf = series('2027-01-09', 3 * 24);
  return { areaId: 'x', fetchedAt: 0, lat: 0, lon: 0, elevation: 2000, runs: {}, days: { ecmwf_ifs: dailyFromHourly(s), icon_seamless: dailyFromHourly(icon), meteofrance_seamless: dailyFromHourly(mf) } };
};

describe('horizonte, días cubiertos y resumen', () => {
  it('D0–D3 próxima, D4–D7 tendencia, más allá sin previsión, pasado sin previsión', () => {
    expect(horizonOf('2027-01-10', today)).toEqual({ lead: 0, horizon: 'near' });
    expect(horizonOf('2027-01-13', today).horizon).toBe('near');
    expect(horizonOf('2027-01-14', today).horizon).toBe('trend');
    expect(horizonOf('2027-01-17', today).horizon).toBe('trend');
    expect(horizonOf('2027-01-18', today).horizon).toBe('beyond');
    expect(horizonOf('2027-01-09', today).horizon).toBe('past');
  });
  it('cada día lista solo los modelos que lo cubren; los rangos no promedian', () => {
    const days = forecastDays(stored(), '2027-01-10', '2027-01-12', today);
    expect(days[0].models.map((m) => m.id)).toEqual(['ecmwf_ifs', 'icon_seamless', 'meteofrance_seamless']);
    expect(days[0].range.rain).toEqual([0, 96]);
    expect(days[0].range.gustMax).toEqual([20, 90]);
    expect(days[2].models.map((m) => m.id)).toEqual(['ecmwf_ifs', 'icon_seamless']);
  });
  it('fuera de horizonte no se muestra ningún modelo aunque el proveedor diera datos', () => {
    const days = forecastDays(stored(), '2027-01-17', '2027-01-19', today);
    expect(days.map((d) => [d.horizon, d.models.length])).toEqual([['trend', 1], ['beyond', 0], ['beyond', 0]]);
  });
  it('viaje cubierto en parte: días cubiertos y sin cubrir, sin acumulado del viaje', () => {
    const s = tripSummary(forecastDays(stored(), '2027-01-16', '2027-01-20', today));
    expect(s).toMatchObject({ days: 5, coveredDays: 2, state: 'partial', uncoveredDays: ['2027-01-18', '2027-01-19', '2027-01-20'], modelCount: 1 });
    expect(Object.keys(s.range)).not.toContain('total');
  });
  it('sin previsión guardada: ningún día cubierto (no es buen tiempo)', () => {
    const s = tripSummary(forecastDays(null, '2027-01-10', '2027-01-11', today));
    expect(s).toMatchObject({ state: 'none', coveredDays: 0, modelCount: 0 });
    expect(s.range.rain).toBeNull();
  });
  it('en tendencia no hay datos de la franja de esquí', () => {
    const d = forecastDays(stored(), '2027-01-14', '2027-01-14', today)[0];
    expect(d.range.skiRain).toBeNull();
    expect(d.range.rain).not.toBeNull();
  });
  it('caducidad y consumo', () => {
    expect(freshnessOf(0, FORECAST_TTL_MS)).toBe('fresh');
    expect(freshnessOf(0, FORECAST_TTL_MS + 1)).toBe('aging');
    expect(freshnessOf(0, FORECAST_STALE_MS + 1)).toBe('stale');
    expect(UNITS_PER_POINT).toBeCloseTo(1.8);
  });
});
