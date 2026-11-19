import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { ApiError, notFound } from '../http';
import { zId } from '../schemas';
import { todayMadrid } from '../../core/dates';
import { compareSeasons, datesToRead, KM_RANGE_MAX_DAYS, rangeMmdds, type KmLegacyRow, type KmLiveRow } from '../../core/km-history';

// Comparador de km esquiables entre temporadas (docs/KM-HISTORICO.md). Lectura pública por estación e intervalo de días
// y meses. 2 sentencias + 1 batch de 2: primero la fecha del primer dato del área (por índice) y después solo las
// fechas concretas del intervalo en cada temporada posible.

export const kmHistoryRoutes = new Hono<AppEnv>();

kmHistoryRoutes.get('/areas/:id/km-history', async (c) => {
  const p = zId.safeParse(c.req.param('id'));
  if (!p.success) throw notFound('Estación');
  const id = p.data;
  const from = c.req.query('desde') ?? '';
  const to = c.req.query('hasta') ?? from;
  const mmdds = rangeMmdds(from, to);
  if (!mmdds) throw new ApiError(422, 'validation', `Indica las fechas como MM-DD (por ejemplo 12-27 y 01-02), en orden y de ${KM_RANGE_MAX_DAYS} días como máximo.`);
  const db = c.env.DB;
  const [area, firstLive, firstLegacy] = await db.batch([
    db.prepare('SELECT id, name FROM areas WHERE id = ?1').bind(id),
    // Índices snow_obs_area_source_date (migración 0026) y legacy_snow_scope: un MIN por índice cada uno.
    db.prepare('SELECT MIN(source_date) AS d FROM snow_observations WHERE area_id = ?1').bind(id),
    db.prepare('SELECT MIN(obs_date) AS d FROM legacy_snow_observations WHERE scope_area_id = ?1').bind(id),
  ]);
  const a = (area.results as any[])[0];
  if (!a) throw notFound('Estación');
  const today = todayMadrid();
  // Primera fecha publicada de un parte o primera fecha del SkiTrip antiguo (las anteriores a 2000 no son de esta app).
  const firstCandidates = [(firstLive.results as any[])[0]?.d, (firstLegacy.results as any[])[0]?.d].filter((x): x is string => typeof x === 'string' && x >= '2000-01-01');
  const firstDataDate = firstCandidates.length ? firstCandidates.sort()[0] : null;
  const dates = datesToRead(mmdds, today, firstDataDate);
  let live: KmLiveRow[] = [], legacy: KmLegacyRow[] = [];
  if (dates.length) {
    const json = JSON.stringify(dates);
    const [l, g] = await db.batch([
      db.prepare(`SELECT s.source_date, s.observed_at, s.op_status, s.open_km, s.total_km, s.quality, src.priority, src.provider
                  FROM snow_observations s JOIN sources src ON src.id = s.source_id
                  WHERE s.area_id = ?1 AND s.source_date IN (SELECT value FROM json_each(?2))`).bind(id, json),
      db.prepare(`SELECT obs_date, open_km, total_km FROM legacy_snow_observations
                  WHERE scope_area_id = ?1 AND obs_date IN (SELECT value FROM json_each(?2))`).bind(id, json),
    ]);
    live = l.results as any[];
    legacy = g.results as any[];
  }
  c.header('Cache-Control', 'public, max-age=300');
  return c.json({
    areaId: a.id, name: a.name, from: mmdds[0], to: mmdds.at(-1), today, firstDataDate,
    seasons: compareSeasons({ mmdds, today, firstDataDate, live, legacy }),
  });
});
