import { get } from '../api';
import { ErrorState, Loading, Empty } from '../components/States';
import { healthText, instant, numDate, PROVIDER_LABEL, RUN_STATUS_LABEL, SOURCE_FIELD_LABEL, SOURCE_METHOD_LABEL, SOURCE_STATUS_LABEL } from '../format';
import { useResource } from '../hooks';
import { usePageTitle } from '../router';
import type { SourceRow } from '../catalog';

const KIND_LABEL: Record<string, string> = { snow: 'Nieve', offers: 'Ofertas', route: 'Ruta' };

/** Página pública: de dónde salen los datos, qué se extrae y su estado. */
export function SourcesPage() {
  usePageTitle('Fuentes de datos');
  const r = useResource(() => get<{ sources: SourceRow[] }>('/api/public/sources'), []);
  const byArea = new Map<string, SourceRow[]>();
  for (const s of r.data?.sources ?? []) (byArea.get(s.area_name ?? s.area_id) ?? byArea.set(s.area_name ?? s.area_id, []).get(s.area_name ?? s.area_id)!).push(s);
  return (
    <div className="page page-wide">
      <h1>Fuentes de datos</h1>
      <p className="lead-s">Cada dato de nieve u ofertas viene de una fuente concreta. Aquí se ve qué se extrae, cómo y cuándo funcionó por última vez. Una fuente «sin verificar» o «rota» puede dar datos incompletos.</p>
      {r.loading && !r.data && <Loading />}
      {r.error && !r.data && <ErrorState message={r.error} onRetry={r.reload} />}
      {r.data && (byArea.size === 0 ? <Empty title="No hay fuentes registradas" /> : [...byArea].map(([area, rows]) => (
        <section key={area} className="panel stack" aria-label={`Fuentes de ${area}`}>
          <h2>{area}</h2>
          <ul className="list">
            {rows.map((s) => (
              <li key={s.id} className="source-row">
                <p><strong>{KIND_LABEL[s.kind] ?? s.kind}</strong> · {PROVIDER_LABEL[s.provider] ?? s.provider} · {SOURCE_METHOD_LABEL[s.method] ?? s.method} · <span className={`tag ${s.status === 'verified' ? 'tag-ok' : s.status === 'broken' ? 'tag-bad' : 'tag-quiet'}`}>{SOURCE_STATUS_LABEL[s.status] ?? s.status}</span></p>
                <p className="small">Datos que extrae: {s.fields.map((f) => SOURCE_FIELD_LABEL[f] ?? f).join(', ') || '—'}{s.scope_area_id !== s.area_id && ` · cifras del ámbito ${s.scope_area_id}`}</p>
                <p className="small muted">
                  Comprobada: {s.checked_on ? numDate(s.checked_on) : 'nunca'} · Último intento: {s.last_attempt_at ? instant(s.last_attempt_at) : 'nunca'} · Último éxito: {s.last_success_at ? instant(s.last_success_at) : 'nunca'}
                  {s.last_status && ` · Último resultado: ${healthText(s.last_status, s.reason)}`}
                </p>
                {s.limitations && <p className="small">Limitaciones: {s.limitations}</p>}
              </li>
            ))}
          </ul>
        </section>
      )))}
    </div>
  );
}
