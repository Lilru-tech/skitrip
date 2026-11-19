/**
 * Festivos y vacaciones escolares (core/holidays.ts): descarga de OpenHolidays API (openholidaysapi.org, datos ODbL 1.0)
 * los de España, Francia y Andorra desde hace un año hasta dentro de ~23 meses, los reparte entre los calendarios de
 * SkiTrip y los envía a la ingesta del Worker, que sustituye los periodos de esa ventana. 6 peticiones por ejecución.
 *
 *   SKITRIP_API_URL=… SKITRIP_INGEST_TOKEN=… npx tsx tools/holidays-sync.ts [--dry-run]
 *
 * Si un país no devuelve nada o algún calendario se queda sin festivos o sin vacaciones, no envía nada y falla: una
 * descarga incompleta nunca borra lo que ya hay. No imprime la credencial.
 */
import { addDays, todayMadrid } from '../src/core/dates';
import { HOLIDAY_CALENDARS, HOLIDAY_COUNTRIES, HOLIDAY_LANG, periodsFromOpenHolidays, type HolidayKind, type HolidayPeriod, type OpenHolidayItem } from '../src/core/holidays';

const API = (process.env.SKITRIP_API_URL ?? '').replace(/\/$/, '');
const TOKEN = process.env.SKITRIP_INGEST_TOKEN ?? '';
const BASE = (process.env.OPEN_HOLIDAYS_URL ?? 'https://openholidaysapi.org').replace(/\/$/, '');
const DRY = process.argv.includes('--dry-run');

async function fetchItems(country: string, kind: HolidayKind, from: string, to: string): Promise<OpenHolidayItem[]> {
  const q = new URLSearchParams({ countryIsoCode: country, languageIsoCode: HOLIDAY_LANG[country as keyof typeof HOLIDAY_LANG], validFrom: from, validTo: to });
  const r = await fetch(`${BASE}/${kind === 'public' ? 'PublicHolidays' : 'SchoolHolidays'}?${q}`, { headers: { accept: 'application/json', 'user-agent': 'SkiTrip (private non-commercial trip planner)' } });
  if (!r.ok) throw new Error(`OpenHolidays ${country} ${kind}: HTTP ${r.status}`);
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error(`OpenHolidays ${country} ${kind}: respuesta inesperada`);
  return j as OpenHolidayItem[];
}

async function main() {
  if (!DRY && (!API || TOKEN.length < 16)) throw new Error('Faltan SKITRIP_API_URL o SKITRIP_INGEST_TOKEN.');
  const today = todayMadrid();
  const from = addDays(today, -365), to = addDays(today, 700); // OpenHolidays admite ventanas de hasta 3 años
  const periods: HolidayPeriod[] = [];
  for (const country of HOLIDAY_COUNTRIES) {
    for (const kind of ['public', 'school'] as const) {
      const items = await fetchItems(country, kind, from, to);
      if (!items.length) throw new Error(`OpenHolidays ${country} ${kind}: 0 elementos; no se envía nada.`);
      const mine = periodsFromOpenHolidays(country, kind, items).filter((p) => p.start >= from && p.start <= to);
      console.log(`${country} ${kind === 'public' ? 'festivos' : 'vacaciones'}: ${items.length} recibidos, ${mine.length} periodos para los calendarios`);
      periods.push(...mine);
    }
  }
  const empty: string[] = [];
  for (const cal of HOLIDAY_CALENDARS) {
    const p = periods.filter((x) => x.calendarId === cal.id && x.scope === 'all');
    const pub = p.filter((x) => x.kind === 'public'), sch = p.filter((x) => x.kind === 'school');
    const until = (xs: HolidayPeriod[]) => xs.reduce((m, x) => (x.end > m ? x.end : m), '—');
    console.log(`  ${cal.label}: ${pub.length} festivos (hasta ${until(pub)}), ${sch.length} vacaciones (hasta ${until(sch)})`);
    if (!pub.length || !sch.length) empty.push(cal.label);
  }
  if (empty.length) throw new Error(`Sin festivos o sin vacaciones para: ${empty.join(', ')}. No se envía nada.`);
  console.log(`Ventana ${from} → ${to}: ${periods.length} periodos${DRY ? ' · simulación: no se envía nada' : ''}`);
  if (DRY) return;
  const r = await fetch(`${API}/api/ingest/holidays`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to, periods }) });
  const j = await r.json().catch(() => null) as any;
  if (!r.ok) throw new Error(`POST /api/ingest/holidays: HTTP ${r.status} ${j?.error?.message ?? ''}`);
  console.log(`Guardados: ${j.written} (sustituidos ${j.deleted}).`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
