import { describe, expect, it } from 'vitest';
import { compareSeasons, datesToRead, legacyDay, liveDay, rangeMmdds, seasonDates, seasonLabel, seasonStartOf, summarize, type KmLiveRow } from '../../src/core/km-history';

const live = (p: Partial<KmLiveRow>): KmLiveRow => ({ source_date: '2025-12-28', observed_at: 1, op_status: 'open', open_km: 100, total_km: 215, quality: 'ok', priority: 10, provider: 'official', ...p });

describe('intervalos y temporadas', () => {
  it('cruza el fin de año, incluye el 29/02 y rechaza intervalos inválidos o largos', () => {
    expect(rangeMmdds('12-30', '01-02')).toEqual(['12-30', '12-31', '01-01', '01-02']);
    expect(rangeMmdds('02-27', '03-01')).toEqual(['02-27', '02-28', '02-29', '03-01']);
    expect(rangeMmdds('02-15', '02-15')).toEqual(['02-15']);
    expect(rangeMmdds('03-10', '02-01')).toBeNull();
    expect(rangeMmdds('01-01', '02-01')).toBeNull(); // 32 días
    expect(rangeMmdds('01-01', '01-31')).toHaveLength(31);
    expect(rangeMmdds('02-30', '03-01')).toBeNull();
    expect(rangeMmdds('1-01', '01-02')).toBeNull();
  });
  it('temporada de julio a junio; el 29/02 solo en años bisiestos', () => {
    expect(seasonStartOf('2026-01-10')).toBe(2025);
    expect(seasonStartOf('2026-11-19')).toBe(2026);
    expect(seasonLabel(2025)).toBe('2025-26');
    expect(seasonLabel(2099)).toBe('2099-00');
    expect(seasonDates(2024, ['02-28', '02-29'])).toEqual(['2025-02-28']);
    expect(seasonDates(2023, ['12-31', '01-01', '02-29'])).toEqual(['2023-12-31', '2024-01-01', '2024-02-29']);
  });
});

describe('cifra de un día', () => {
  it('fuente preferente y, en ella, la última captura; cierre confirmado = 0 km esquiables', () => {
    expect(liveDay([live({ priority: 50, open_km: 90 }), live({ priority: 10, open_km: 100, observed_at: 1 }), live({ priority: 10, open_km: 105, observed_at: 2 })]))
      .toMatchObject({ status: 'value', openKm: 105, origin: 'parte' });
    expect(liveDay([live({ op_status: 'closed_confirmed', open_km: null })])).toMatchObject({ status: 'closed', openKm: 0 });
    expect(liveDay([live({ op_status: 'out_of_season', open_km: null })])).toMatchObject({ status: 'closed', openKm: 0 });
  });
  it('sin cifra: calidad dudosa, estado desconocido o parte sin km', () => {
    expect(liveDay([live({ quality: 'suspicious' })])).toBeNull();
    expect(liveDay([live({ op_status: 'unknown' })])).toBeNull();
    expect(liveDay([live({ open_km: null })])).toBeNull();
    expect(liveDay([])).toBeNull();
  });
  it('SkiTrip antiguo: un 0 no es cifra («0 o sin dato»)', () => {
    expect(legacyDay({ obs_date: '2026-01-01', open_km: 120, total_km: 215 })).toMatchObject({ status: 'value', openKm: 120, origin: 'antiguo' });
    expect(legacyDay({ obs_date: '2026-01-01', open_km: 0, total_km: 215 })).toMatchObject({ status: 'legacy_zero', openKm: null });
    expect(legacyDay({ obs_date: '2026-01-01', open_km: null, total_km: 215 })).toBeNull();
    expect(legacyDay(undefined)).toBeNull();
  });
});

describe('comparación entre temporadas', () => {
  const mmdds = rangeMmdds('12-30', '01-02')!;
  it('temporada actual (solo días ya pasados), temporada anterior con datos antiguos y parte; nada inventado', () => {
    const r = compareSeasons({
      mmdds, today: '2026-12-31', firstDataDate: '2025-12-21',
      live: [live({ source_date: '2026-12-30', open_km: 150 }), live({ source_date: '2026-12-31', op_status: 'closed_confirmed', open_km: null }),
        live({ source_date: '2026-01-01', open_km: 199 })],
      legacy: [{ obs_date: '2025-12-30', open_km: 190, total_km: 215 }, { obs_date: '2025-12-31', open_km: 0, total_km: 215 },
        { obs_date: '2026-01-01', open_km: 180, total_km: 215 }],
    });
    expect(r.map((s) => s.season)).toEqual(['2026-27', '2025-26']);
    expect(r[0].dates.map((d) => d.status)).toEqual(['value', 'closed', 'future', 'future']);
    expect(r[0].summary).toMatchObject({ days: 2, withData: 2, closedDays: 1, mean: 75, min: 0, max: 150, usesLegacy: false });
    // El parte de v2 prevalece sobre el dato antiguo del mismo día.
    expect(r[1].dates.map((d) => [d.status, d.openKm, d.origin])).toEqual([['value', 190, 'antiguo'], ['legacy_zero', null, 'antiguo'], ['value', 199, 'parte'], ['none', null, null]]);
    expect(r[1].summary).toMatchObject({ days: 4, withData: 2, doubtfulZeros: 1, mean: 194.5, min: 190, max: 199, usesLegacy: true });
  });
  it('sin ningún dato del área: ninguna temporada; temporada sin datos: «Sin dato» sin media', () => {
    expect(compareSeasons({ mmdds, today: '2026-12-31', firstDataDate: null, live: [], legacy: [] })).toEqual([]);
    const r = compareSeasons({ mmdds, today: '2026-12-31', firstDataDate: '2024-11-01', live: [], legacy: [] });
    expect(r.map((s) => s.season)).toEqual(['2026-27', '2025-26', '2024-25']);
    expect(r[2].summary).toMatchObject({ days: 4, withData: 0, mean: null, min: null, max: null });
  });
  it('si ningún día del intervalo ha llegado en la temporada actual, no aparece', () => {
    const r = compareSeasons({ mmdds, today: '2026-11-19', firstDataDate: '2025-12-21', live: [], legacy: [] });
    expect(r.map((s) => s.season)).toEqual(['2025-26']);
  });
  it('fechas a leer: solo días pasados de las temporadas posibles', () => {
    expect(datesToRead(mmdds, '2026-12-31', '2025-12-21')).toEqual(['2026-12-30', '2026-12-31', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02']);
    expect(datesToRead(mmdds, '2026-12-31', null)).toEqual([]);
  });
  it('media con decimales redondeada a una cifra', () => {
    const d = (openKm: number) => ({ date: 'x', status: 'value' as const, openKm, totalKm: null, origin: 'parte' as const, provider: null });
    expect(summarize([d(10), d(10), d(11)]).mean).toBe(10.3);
  });
});
