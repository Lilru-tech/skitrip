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
const PAD2 = Array.from({ length: 32 }, (_, i) => String(i).padStart(2, '0'));
const monthDays = (y: number, m: number) => (m === 2 ? (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28) : m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31);
export function eachDay(a: string, b: string): string[] {
  // Un solo análisis de cada extremo y luego día, mes y año como enteros: antes cada día pasaba por split/map, Date y
  // toISOString (con 150 días por petición de calendario se notaba en la CPU). Mismo resultado: dates.test.ts.
  const out: string[] = [];
  const n = daysBetween(a, b);
  if (!(n >= 0)) return out;
  let [y, m, d] = a.split('-').map(Number);
  const md = () => monthDays(y, m);
  let last = md();
  let ys = String(y).padStart(4, '0');
  for (let i = 0; i <= n; i++) {
    out.push(`${ys}-${PAD2[m]}-${PAD2[d]}`);
    if (++d > last) { d = 1; if (++m > 12) { m = 1; y++; ys = String(y).padStart(4, '0'); } last = md(); }
  }
  return out;
}

/** 0 = lunes … 6 = domingo (convención española). */
export function weekdayMon0(s: string): number {
  return (new Date(toUTC(s)).getUTCDay() + 6) % 7;
}

// Crear un Intl.DateTimeFormat con zona horaria cuesta del orden de 0,1–0,5 ms de CPU (resolver la zona en ICU);
// formatear con uno ya creado, microsegundos. El catálogo público lo llamaba cientos de veces por petición (varias por
// cada observación de nieve con fecha de parte), así que se crea una vez por isolate y se recuerda el último resultado.
let madridFmt: Intl.DateTimeFormat | null = null;
let lastToday: { ms: number; day: string } | null = null;

/** Fecha de calendario en Europe/Madrid de un instante (formato AAAA-MM-DD). */
export function madridDate(ms: number): string {
  madridFmt ??= new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' });
  return madridFmt.format(new Date(ms));
}

/** Hoy en Europe/Madrid como fecha de calendario. Calculado en cada llamada con su instante: nunca queda fijo. */
export function todayMadrid(nowMs = Date.now()): string {
  if (lastToday?.ms !== nowMs) lastToday = { ms: nowMs, day: madridDate(nowMs) };
  return lastToday.day;
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
