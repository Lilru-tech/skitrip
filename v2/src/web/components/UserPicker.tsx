import { useEffect, useState } from 'react';
import { errorMessage, get, qs } from '../api';
import { Field } from './Field';

export interface UserHit { id: string; alias: string }

/** Aviso que acompaña cualquier vinculación de datos de la hoja antigua a una cuenta. */
export const IDENTITY_WARNING = 'Un nombre parecido no prueba identidad. Asigna solo si has confirmado con esa persona que es ella.';

/** Buscador de cuentas por alias (solo muestra alias, nunca correo). */
export function UserPicker({ id, label, onPick }: { id: string; label: string; onPick: (u: UserHit) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<UserHit[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setHits([]); return; }
    let alive = true;
    const h = setTimeout(() => {
      get<{ users: UserHit[] }>(`/api/friends/search?${qs({ q: t })}`).then((r) => { if (alive) { setHits(r.users); setErr(null); } }, (e) => { if (alive) setErr(errorMessage(e)); });
    }, 250);
    return () => { alive = false; clearTimeout(h); };
  }, [q]);
  return (
    <div className="stack-s">
      <Field id={id} label={label} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" maxLength={24} hint="Escribe al menos 2 letras del alias. Las cuentas bloqueadas no aparecen." />
      {err && <p className="form-error" role="alert">{err}</p>}
      {hits.length > 0 && (
        <ul className="list" aria-label="Cuentas encontradas">
          {hits.map((u) => (
            <li key={u.id} className="row-between">
              <span>{u.alias}</span>
              <button type="button" className="btn btn-secondary btn-small" onClick={() => { onPick(u); setQ(''); setHits([]); }}>Elegir</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
