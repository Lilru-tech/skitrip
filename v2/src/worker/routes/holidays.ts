// Festivos y vacaciones escolares en las fechas elegidas (ficha de estación). 1 sentencia: periodos que se solapan con
// las fechas y, por calendario y tipo, hasta qué día hay calendario publicado (solo periodos de todo el territorio).
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { ApiError } from '../http';
import { daysBetween, eachDay, isValidDate, todayMadrid } from '../../core/dates';
import { calendarDays, HOLIDAY_MAX_DAYS, HOLIDAY_SOURCE, type HolidayKind, type HolidayPeriod } from '../../core/holidays';

export const holidayRoutes = new Hono<AppEnv>();

interface Row { kind: 'p' | 'k'; calendar_id: string; hk: HolidayKind; start_date: string | null; end_date: string | null; name: string | null; scope: 'all' | 'part' | null; parts: string | null; fetched_at: number | null }

holidayRoutes.get('/holidays', async (c) => {
  const today = todayMadrid();
  const from = c.req.query('desde') ?? today;
  const to = c.req.query('hasta') ?? from;
  if (!isValidDate(from) || !isValidDate(to)) throw new ApiError(422, 'validation', 'Fechas no válidas (AAAA-MM-DD).');
  if (to < from) throw new ApiError(422, 'validation', 'La fecha final no puede ser anterior a la inicial.');
  if (daysBetween(from, to) >= HOLIDAY_MAX_DAYS) throw new ApiError(422, 'validation', `Como mucho ${HOLIDAY_MAX_DAYS} días.`);
  const { results } = await c.env.DB.prepare(
    `SELECT 'p' AS kind, calendar_id, kind AS hk, start_date, end_date, name, scope, parts, fetched_at FROM holiday_periods WHERE end_date >= ?1 AND start_date <= ?2
     UNION ALL
     SELECT 'k', calendar_id, kind, NULL, MAX(end_date), NULL, NULL, NULL, MAX(fetched_at) FROM holiday_periods WHERE scope = 'all' GROUP BY calendar_id, kind`,
  ).bind(from, to).all<Row>();
  const periods: HolidayPeriod[] = [];
  const known = new Map<string, Record<HolidayKind, string | null>>();
  let fetchedAt: number | null = null;
  for (const r of results) {
    if (r.kind === 'p') periods.push({ calendarId: r.calendar_id, kind: r.hk, start: r.start_date!, end: r.end_date!, name: r.name!, scope: r.scope!, parts: r.parts });
    else {
      const k = known.get(r.calendar_id) ?? { public: null, school: null };
      k[r.hk] = r.end_date;
      known.set(r.calendar_id, k);
      if (r.fetched_at != null && (fetchedAt == null || r.fetched_at > fetchedAt)) fetchedAt = r.fetched_at;
    }
  }
  const days = eachDay(from, to);
  return c.json({ from, to, days, calendars: calendarDays(days, periods, known), fetchedAt, source: HOLIDAY_SOURCE });
});
