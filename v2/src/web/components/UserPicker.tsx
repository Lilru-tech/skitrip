import { useEffect, useState } from 'react';
import { errorMessage, get, qs } from '../api';
import { Field } from './Field';

export interface UserHit { id: string; alias: string; isMe?: boolean }

/** Aviso que acompaña cualquier vinculación de datos de la hoja antigua a una cuenta. */
export const IDENTITY_WARNING = 'Un nombre parecido no prueba identidad. Asigna solo si has confirmado con esa persona que es ella.';

/** Alias para mostrar: la propia cuenta como «Alias (tú)». */
export const userLabel = (u: UserHit) => (u.isMe ? `${u.alias} (tú)` : u.alias);

type Search = { status: 'idle' } | { status: 'loading' } | { status: 'done'; hits: UserHit[] } | { status: 'error'; message: string };

/**
 * Buscador de cuentas por alias (solo muestra alias, nunca correo).
 * - `friends` (por defecto): el buscador de amigos; excluye la propia cuenta y las bloqueadas entre sí.
 * - `admin`: cuentas activas para vincular datos de la hoja antigua, la propia incluida (solo administración).
 */
export function UserPicker({ id, label, onPick, scope = 'friends' }: { id: string; label: string; onPick: (u: UserHit) => void; scope?: 'friends' | 'admin' }) {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState<Search>({ status: 'idle' });
  useEffect(() => {
    const t = q.trim();
    // Al cambiar la consulta no se muestran los resultados de la anterior.
    if (t.length < 2) { setSearch({ status: 'idle' }); return; }
    setSearch({ status: 'loading' });
    let alive = true;
    const path = scope === 'admin' ? '/api/admin/users/search' : '/api/friends/search';
    const h = setTimeout(() => {
      get<{ users: UserHit[] }>(`${path}?${qs({ q: t })}`).then(
        (r) => { if (alive) setSearch({ status: 'done', hits: r.users }); },
        (e) => { if (alive) setSearch({ status: 'error', message: errorMessage(e) }); },
      );
    }, 250);
    return () => { alive = false; clearTimeout(h); };
  }, [q, scope]);
  const hint = scope === 'admin' ? 'Escribe al menos 2 letras del alias. Incluye tu cuenta; las cuentas bloqueadas no aparecen.' : 'Escribe al menos 2 letras del alias. Las cuentas bloqueadas no aparecen.';
  return (
    <div className="stack-s">
      <Field id={id} label={label} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" maxLength={24} hint={hint} />
      {search.status === 'loading' && <p className="small muted" role="status">Buscando…</p>}
      {search.status === 'error' && <p className="form-error" role="alert">No se ha podido buscar: {search.message}</p>}
      {search.status === 'done' && search.hits.length === 0 && (
        <p className="small muted" role="status">{scope === 'admin' ? 'Ninguna cuenta activa con ese alias.' : 'Ninguna cuenta con ese alias.'}</p>
      )}
      {search.status === 'done' && search.hits.length > 0 && (
        <ul className="list" aria-label="Cuentas encontradas">
          {search.hits.map((u) => (
            <li key={u.id} className="row-between">
              <span>{userLabel(u)}</span>
              <button type="button" className="btn btn-secondary btn-small" onClick={() => { onPick(u); setQ(''); }}>Elegir<span className="visually-hidden"> {userLabel(u)}</span></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
