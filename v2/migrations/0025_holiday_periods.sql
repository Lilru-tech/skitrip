-- Festivos y vacaciones escolares (sustituyen a la afluencia histórica en la ficha; ver docs/METEO-AFLUENCIA.md §1).
-- Los envía cada semana tools/holidays-sync.ts desde GitHub Actions (OpenHolidays API, ODbL 1.0): cada envío sustituye
-- los periodos de su ventana de fechas. Las tablas de afluencia (0022) se conservan, sin uso, con sus 3 observaciones.
CREATE TABLE IF NOT EXISTS holiday_periods (
  calendar_id TEXT NOT NULL,                                    -- core/holidays.ts HOLIDAY_CALENDARS
  kind        TEXT NOT NULL CHECK (kind IN ('public','school')),
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  name        TEXT NOT NULL,
  scope       TEXT NOT NULL CHECK (scope IN ('all','part')),    -- 'part': solo en parte del territorio
  parts       TEXT,                                             -- qué partes (provincias, academias)
  fetched_at  INTEGER NOT NULL,
  PRIMARY KEY (calendar_id, kind, start_date, name),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS holiday_periods_end ON holiday_periods (end_date, start_date);
