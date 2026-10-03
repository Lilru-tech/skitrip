// Fechas de calendario como 'YYYY-MM-DD' sin zona horaria. Toda la aritmética se hace en UTC
// sobre medianoches, así los cambios de horario (último domingo de marzo/octubre) no desplazan días.
const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDate(s: string): boolean {
  const m = RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

const toUTC = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUTC = (t: number) => new Date(t).toISOString().slice(0, 10);

export function addDays(s: string, n: number): string {
  return fromUTC(toUTC(s) + n * 86400_000);
}

/** Días naturales de `a` a `b` (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUTC(b) - toUTC(a)) / 86400_000);
}

/** Lista inclusiva de fechas entre a y b. */
export function eachDay(a: string, b: string): string[] {
  const out: string[] = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 0 = lunes … 6 = domingo (convención española). */
export function weekdayMon0(s: string): number {
  return (new Date(toUTC(s)).getUTCDay() + 6) % 7;
}

/** Hoy en Europe/Madrid como fecha de calendario. */
export function todayMadrid(nowMs = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs));
}

/**
 * Temporada que contiene (o sigue a) una fecha: 1 dic – 30 abr, cruzando el cambio de año.
 * Configurable por parámetros; nunca años fijos en código.
 */
export function seasonFor(s: string, startMonth = 12, endMonth = 4): { start: string; end: string } {
  const [y, m] = s.split('-').map(Number);
  const startYear = m >= startMonth ? y : m <= endMonth ? y - 1 : y;
  const endYear = startMonth > endMonth ? startYear + 1 : startYear;
  const last = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
  return {
    start: `${startYear}-${String(startMonth).padStart(2, '0')}-01`,
    end: `${endYear}-${String(endMonth).padStart(2, '0')}-${String(last).padStart(2, '0')}`,
  };
}
