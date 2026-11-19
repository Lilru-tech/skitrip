// Festivos y vacaciones escolares en las fechas elegidas (las mismas que la previsión y el clima). Sustituye a la
// afluencia histórica: no es una cifra de gente, solo dice qué calendarios tienen fiesta o vacaciones esos días.
import { get, qs } from '../api';
import { dayShort, instant, numDate } from '../format';
import { useKeyedResource } from '../hooks';
import { useLocation } from '../router';
import { addDaysIso, NEAR_MAX_LEAD } from '../../core/weather';
import { todayMadrid } from '../../core/dates';
import type { CalendarDays } from '../../core/holidays';

interface HolidaysResponse { from: string; to: string; days: string[]; calendars: CalendarDays[]; fetchedAt: number | null; source: string }

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const KIND_LABEL = { public: 'festivo', school: 'vacaciones escolares' } as const;
const weekend = (d: string) => { const w = new Date(`${d}T12:00:00Z`).getUTCDay(); return w === 0 || w === 6; };
const span = (a: string, b: string) => (a === b ? numDate(a).slice(0, 5) : `${numDate(a).slice(0, 5)}–${numDate(b).slice(0, 5)}`);
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);

export function HolidaysSection() {
  const { query } = useLocation();
  const today = todayMadrid();
  const qFrom = query.get('desde');
  const qTo = query.get('hasta');
  const from = qFrom && ISO.test(qFrom) ? qFrom : today;
  const to = qTo && ISO.test(qTo) && qTo >= from ? qTo : addDaysIso(from, NEAR_MAX_LEAD);
  const h = useKeyedResource(`${from}|${to}`, () => get<HolidaysResponse>(`/api/public/holidays?${qs({ desde: from, hasta: to })}`));
  const d = h.data;
  return (
    <section className="panel stack" aria-labelledby="a-holidays" data-testid="holidays">
      <h2 id="a-holidays">Festivos y vacaciones en estas fechas</h2>
      <p className="small muted">Del {numDate(from)} al {numDate(to)}. No es una cifra de gente: dice qué calendarios tienen fiesta o vacaciones escolares esos días, que es cuando suele haber más gente en las pistas.</p>
      {h.loading && !d ? <p className="small muted">Cargando los calendarios…</p> : h.error ? (
        <p className="notice notice-warn small">No se han podido cargar los calendarios: {h.error} <button type="button" className="btn-link" onClick={() => void h.reload()}>Reintentar</button></p>
      ) : d && <HolidaysBody d={d} />}
    </section>
  );
}

function HolidaysBody({ d }: { d: HolidaysResponse }) {
  const ends = d.days.filter(weekend);
  const busy = d.calendars.filter((c) => c.periods.some((p) => p.scope === 'all'));
  const partial = d.calendars.filter((c) => !busy.includes(c) && c.periods.length > 0);
  const unknown = d.calendars.filter((c) => !c.periods.length && c.unknownDays.length > 0);
  const none = d.fetchedAt == null;
  return (
    <>
      <p className="small" data-testid="holidays-summary">
        {none ? 'Todavía no hay calendarios cargados: no se puede decir nada de estas fechas.' : (
          <>
            {busy.length ? <>Con fiesta o vacaciones: <strong>{list(busy.map((c) => c.label.replace(/ \(.*\)$/, '')))}</strong>.</> : unknown.length === d.calendars.length ? null : 'Ningún calendario tiene fiesta ni vacaciones en todo su territorio.'}
            {partial.length > 0 && <> Solo en parte de: {list(partial.map((c) => c.label.replace(/ \(.*\)$/, '')))}.</>}
            {unknown.length > 0 && <> Sin calendario publicado todavía: {unknown.length === d.calendars.length ? 'ninguno de los calendarios cubre estas fechas' : list(unknown.map((c) => c.label.replace(/ \(.*\)$/, '')))}.</>}
          </>
        )}
        {' '}{ends.length ? `Fin de semana: ${list(ends.map(dayShort))}.` : 'Ningún día es fin de semana.'}
      </p>
      {!none && (
        <details className="area-more">
          <summary>Ver por calendario</summary>
          <div className="stack">
            <ul className="list stack-s small" aria-label="Festivos y vacaciones por calendario">
              {d.calendars.map((c) => (
                <li key={c.calendarId} data-testid={`holidays-${c.calendarId}`}>
                  <strong>{c.label}</strong>:{' '}
                  {c.periods.length ? list(c.periods.map((p) => `${p.name} (${KIND_LABEL[p.kind]}, ${span(p.start, p.end)}${p.scope === 'part' ? `; solo en ${p.parts ?? 'parte del territorio'}` : ''})`))
                    : c.unknownDays.length ? 'calendario aún no publicado para estas fechas'
                      : 'sin festivos ni vacaciones escolares'}
                  {c.periods.length > 0 && c.unknownDays.length > 0 && <span className="muted"> · sin calendario publicado para {c.unknownDays.length === d.days.length ? 'estas fechas' : `${c.unknownDays.length} de los días`}</span>}
                </li>
              ))}
            </ul>
            <ul className="small muted run-notes">
              <li>Vacaciones escolares y festivos oficiales; no incluye fiestas locales de cada municipio. Un día sin calendario publicado no cuenta como día sin fiesta.</li>
              <li>{d.source}{d.fetchedAt != null && <> Actualizado {instant(d.fetchedAt)}.</>}</li>
            </ul>
          </div>
        </details>
      )}
    </>
  );
}
