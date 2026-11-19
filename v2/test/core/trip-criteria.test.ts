// Pesos «Condiciones meteorológicas» y «Afluencia histórica» (fórmula aprobada, docs/METEO-AFLUENCIA.md §4).
import { describe, expect, it } from 'vitest';
import { weatherCriterion, type CriterionEntry, type SkiForecast } from '../../src/core/trip-criteria';
import { DEFAULT_WEIGHTS, scoreRows, type ScoreRow } from '../../src/core/score';

const today = '2027-01-10';
const m = (id: string, rain: number | null, strong: number | null, hours = 8) => ({ id, rain, strong, hours });
const fc = (days: Record<string, ReturnType<typeof m>[]>, freshness: SkiForecast['freshness'] = 'fresh'): SkiForecast => ({ freshness, days: Object.entries(days).map(([date, models]) => ({ date, models })) });
const E = (id: string, points = [id]): CriterionEntry => ({ id, name: id.toUpperCase(), points: points.map((p) => ({ id: p, name: p })) });

describe('condiciones meteorológicas', () => {
  const good = fc({ '2027-01-11': [m('ecmwf_ifs', 0, 0), m('icon_seamless', 1, 0), m('meteofrance_seamless', 0, 0)], '2027-01-12': [m('ecmwf_ifs', 0, 0), m('icon_seamless', 0, 0)] });
  const bad = fc({ '2027-01-11': [m('ecmwf_ifs', 5, 2), m('icon_seamless', 20, 0)], '2027-01-12': [m('ecmwf_ifs', 0, 8), m('icon_seamless', 0, 0)] });
  it('fórmula: el modelo más desfavorable de cada día, media de los días, 1 − índice', () => {
    const c = weatherCriterion('2027-01-11', '2027-01-12', today, [E('a'), E('b')], new Map([['a', good], ['b', bad]]));
    if (!c.active) throw new Error(c.reason);
    // a: día 1 máx(0, 0,05) = 0,05; día 2 0 → 0,025. b: día 1 máx(0,25 + 0,125; 0,5) = 0,5; día 2 máx(0,5; 0) = 0,5 → 0,5.
    expect(c.value.get('a')).toBeCloseTo(0.975);
    expect(c.value.get('b')).toBeCloseTo(0.5);
  });
  it('solo modelos comunes a todas: Météo-France no cuenta si una estación no lo tiene', () => {
    const onlyA = fc({ '2027-01-11': [m('ecmwf_ifs', 0, 0), m('icon_seamless', 0, 0), m('meteofrance_seamless', 30, 8)] });
    const b = fc({ '2027-01-11': [m('ecmwf_ifs', 0, 0), m('icon_seamless', 0, 0)] });
    const c = weatherCriterion('2027-01-11', '2027-01-11', today, [E('a'), E('b')], new Map([['a', onlyA], ['b', b]]));
    expect(c.active && c.value.get('a')).toBe(1);
  });
  it('un dominio toma su estación más desfavorable', () => {
    const c = weatherCriterion('2027-01-11', '2027-01-12', today, [E('dom', ['n', 's'])], new Map([['n', good], ['s', bad]]));
    expect(c.active && c.value.get('dom')).toBeCloseTo(0.5);
  });
  it('inactivo para todas, con motivo: fuera de D0–D3, sin previsión vigente, menos de 2 modelos comunes, sin fechas', () => {
    const map = new Map([['a', good], ['b', bad]]);
    expect(weatherCriterion('2027-01-14', '2027-01-15', today, [E('a')], map)).toMatchObject({ active: false, reason: expect.stringMatching(/empieza dentro de 4 días/) });
    expect(weatherCriterion('2027-01-12', '2027-01-14', today, [E('a')], map)).toMatchObject({ active: false, reason: expect.stringMatching(/acaba dentro de 4 días/) });
    expect(weatherCriterion('2027-01-09', '2027-01-11', today, [E('a')], map)).toMatchObject({ active: false, reason: expect.stringMatching(/ya ha empezado/) });
    expect(weatherCriterion('2027-01-11', '2027-01-11', today, [E('a'), E('c')], map)).toMatchObject({ active: false, reason: expect.stringMatching(/Falta previsión vigente de C/) });
    expect(weatherCriterion('2027-01-11', '2027-01-11', today, [E('a')], new Map([['a', fc({ '2027-01-11': [m('ecmwf_ifs', 0, 0), m('icon_seamless', 0, 0)] }, 'stale')]]))).toMatchObject({ active: false });
    expect(weatherCriterion('2027-01-11', '2027-01-11', today, [E('a')], new Map([['a', fc({ '2027-01-11': [m('ecmwf_ifs', 0, 0), m('icon_seamless', null, 0)] })]]))).toMatchObject({ active: false, reason: expect.stringMatching(/2 modelos comunes/) });
    expect(weatherCriterion(null, null, today, [E('a')], map)).toMatchObject({ active: false, reason: expect.stringMatching(/viaje con fechas/) });
  });
});

describe('puntuación', () => {
  const rows: ScoreRow[] = [
    { id: 'a', costPerPersonCents: 30000, roadKm: 200, totalKm: 100, openKmNow: 50, vibe: 5, runs: 40 },
    { id: 'b', costPerPersonCents: 25000, roadKm: 250, totalKm: 140, openKmNow: null, vibe: 8, runs: 90 },
    { id: 'c', costPerPersonCents: null, roadKm: 150, totalKm: 60, openKmNow: 20, vibe: 6, runs: null },
  ];
  const strip = (r: ReturnType<typeof scoreRows>) => r.map(({ id, score, coverage, missing }) => ({ id, score, coverage, missing }));
  it('con los pesos opcionales a 0 la clasificación es exactamente la de antes, tengan o no dato', () => {
    const before = strip(scoreRows(rows, { cost: 0.4, distance: 0.2, size: 0.15, snowNow: 0.15, vibe: 0.1, runs: 0 }));
    expect(strip(scoreRows(rows.map((r, i) => ({ ...r, weather: [0.2, 1, null][i] })), DEFAULT_WEIGHTS))).toEqual(before);
    expect(DEFAULT_WEIGHTS.weather).toBe(0);
    expect(Object.keys(DEFAULT_WEIGHTS)).not.toContain('crowd');
  });
  const only = (key: 'weather', vals: (number | null)[]) => scoreRows(vals.map((v, i) => ({ id: `r${i}`, costPerPersonCents: null, roadKm: null, totalKm: null, openKmNow: null, vibe: null, [key]: v })),
    { cost: 0, distance: 0, size: 0, snowNow: 0, vibe: 0, runs: 0, [key]: 1 });
  it('tiempo en escala absoluta: 0,97 y 0,95 quedan casi iguales; sin dato puntúa 0 y se indica', () => {
    const r = only('weather', [0.97, 0.95, null]);
    expect(r.map((x) => x.score)).toEqual([97, 95, 0]);
    expect(r[2].missing).toEqual(['weather']);
  });
});
