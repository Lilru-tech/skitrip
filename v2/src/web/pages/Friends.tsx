import { useEffect, useState, type FormEvent } from 'react';
import { del, errorMessage, get, post, qs } from '../api';
import { ConfirmDialog } from '../components/Dialog';
import { Empty, ErrorState, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { useBusy, useResource } from '../hooks';
import { Link, usePageTitle } from '../router';
import type { FriendsResponse, PublicUser } from '../types';

type Confirm = { kind: 'remove' | 'block'; user: PublicUser } | null;

export function FriendsPage() {
  usePageTitle('Amigos');
  const toast = useToast();
  const { data, error, loading, reload } = useResource(() => get<FriendsResponse>('/api/friends'), []);
  const { busy, run } = useBusy();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PublicUser[] | null>(null);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [confirmErr, setConfirmErr] = useState<string | null>(null);

  // Búsqueda con pequeña espera para no lanzar una petición por tecla.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults(null); setSearchErr(null); return; }
    const t = window.setTimeout(async () => {
      setSearching(true);
      try {
        const r = await get<{ users: PublicUser[] }>(`/api/friends/search?${qs({ q: term })}`);
        setResults(r.users);
        setSearchErr(null);
      } catch (e) {
        setSearchErr(errorMessage(e));
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    try {
      await run(key, fn);
      toast.show(ok);
      await reload();
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  const sendRequest = (u: PublicUser) => act(`req:${u.id}`, async () => {
    const r = await post<{ status: string }>('/api/friends/requests', { userId: u.id });
    if (r.status === 'accepted') toast.show(`${u.alias} ya te había enviado una solicitud: ahora sois amigos.`);
  }, `Solicitud enviada a ${u.alias}.`);

  const doConfirm = async () => {
    if (!confirm) return;
    setConfirmErr(null);
    try {
      await run('confirm', () => confirm.kind === 'remove' ? del(`/api/friends/${confirm.user.id}`) : post('/api/friends/blocks', { userId: confirm.user.id }));
      toast.show(confirm.kind === 'remove' ? `${confirm.user.alias} ya no está en tus amigos.` : `Has bloqueado a ${confirm.user.alias}.`);
      setConfirm(null);
      await reload();
    } catch (e) {
      setConfirmErr(errorMessage(e));
    }
  };

  const relation = (id: string) => {
    if (!data) return null;
    if (data.friends.some((f) => f.id === id)) return 'Ya sois amigos';
    if (data.outgoing.some((r) => r.user_id === id)) return 'Solicitud enviada';
    if (data.incoming.some((r) => r.user_id === id)) return 'Te ha enviado una solicitud';
    return null;
  };

  return (
    <div className="page">
      <h1>Amigos</h1>
      <p className="lead-s">Tus amistades pueden invitarte a viajes y, si tú lo decides, ver tu disponibilidad.</p>

      <section className="panel stack" aria-labelledby="find-h">
        <h2 id="find-h">Buscar por alias</h2>
        <form role="search" onSubmit={(e: FormEvent) => e.preventDefault()}>
          <div className="field">
            <label htmlFor="friend-search">Alias</label>
            <input id="friend-search" type="search" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Escribe al menos 2 letras" />
          </div>
        </form>
        <div aria-live="polite">
          {searching && <p className="muted">Buscando…</p>}
          {searchErr && <p className="form-error">{searchErr}</p>}
          {results && !searching && results.length === 0 && <p className="muted">Nadie con ese alias.</p>}
          {results && results.length > 0 && (
            <ul className="list" aria-label="Resultados de la búsqueda">
              {results.map((u) => {
                const rel = relation(u.id);
                return (
                  <li key={u.id} className="list-row">
                    <span className="list-main">{u.alias}</span>
                    {rel ? <span className="muted">{rel}</span> : (
                      <button type="button" className="btn btn-small btn-primary" onClick={() => void sendRequest(u)} disabled={busy !== null}>
                        {busy === `req:${u.id}` ? 'Enviando…' : 'Enviar solicitud'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {loading && !data && <Loading />}
      {error && !data && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <>
          {data.incoming.length > 0 && (
            <section className="panel stack" aria-labelledby="in-h">
              <h2 id="in-h">Solicitudes recibidas</h2>
              <ul className="list">
                {data.incoming.map((r) => (
                  <li key={r.id} className="list-row">
                    <span className="list-main">{r.alias}</span>
                    <span className="cluster-s">
                      <button type="button" className="btn btn-small btn-primary" disabled={busy !== null}
                        onClick={() => void act(`acc:${r.id}`, () => post(`/api/friends/requests/${r.id}/accept`), `Ahora eres amigo de ${r.alias}.`)}>
                        Aceptar<span className="visually-hidden"> a {r.alias}</span>
                      </button>
                      <button type="button" className="btn btn-small btn-secondary" disabled={busy !== null}
                        onClick={() => void act(`rej:${r.id}`, () => post(`/api/friends/requests/${r.id}/reject`), 'Solicitud rechazada.')}>
                        Rechazar<span className="visually-hidden"> a {r.alias}</span>
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="panel stack" aria-labelledby="fr-h">
            <h2 id="fr-h">Tus amigos <span className="count">{data.friends.length}</span></h2>
            {data.friends.length === 0 ? (
              <Empty title="Todavía no tienes amigos en SkiTrip">
                <p>Busca a tu grupo por su alias (arriba) y envíales una solicitud. Si aún no tienen cuenta, pídeles que se registren y te digan su alias.</p>
                <p className="small">Después, comparte tu disponibilidad en <Link to="/calendario?vista=compartir">Calendario › Compartir</Link> para encontrar fechas en común.</p>
              </Empty>
            ) : (
              <ul className="list">
                {data.friends.map((f) => (
                  <li key={f.id} className="list-row">
                    <span className="list-main">{f.alias}</span>
                    <span className="cluster-s">
                      <button type="button" className="btn btn-small btn-secondary" onClick={() => { setConfirmErr(null); setConfirm({ kind: 'remove', user: f }); }}>
                        Quitar<span className="visually-hidden"> a {f.alias}</span>
                      </button>
                      <button type="button" className="btn btn-small btn-ghost" onClick={() => { setConfirmErr(null); setConfirm({ kind: 'block', user: f }); }}>
                        Bloquear<span className="visually-hidden"> a {f.alias}</span>
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {data.outgoing.length > 0 && (
            <section className="panel stack" aria-labelledby="out-h">
              <h2 id="out-h">Solicitudes enviadas</h2>
              <ul className="list">
                {data.outgoing.map((r) => (
                  <li key={r.id} className="list-row">
                    <span className="list-main">{r.alias}</span>
                    <button type="button" className="btn btn-small btn-secondary" disabled={busy !== null}
                      onClick={() => void act(`can:${r.id}`, () => post(`/api/friends/requests/${r.id}/cancel`), 'Solicitud cancelada.')}>
                      Cancelar<span className="visually-hidden"> solicitud a {r.alias}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.blocked.length > 0 && (
            <section className="panel stack" aria-labelledby="bl-h">
              <h2 id="bl-h">Bloqueados</h2>
              <p className="muted">No pueden encontrarte, invitarte ni ver tu disponibilidad.</p>
              <ul className="list">
                {data.blocked.map((u) => (
                  <li key={u.id} className="list-row">
                    <span className="list-main">{u.alias}</span>
                    <button type="button" className="btn btn-small btn-secondary" disabled={busy !== null}
                      onClick={() => void act(`unb:${u.id}`, () => del(`/api/friends/blocks/${u.id}`), `Has desbloqueado a ${u.alias}.`)}>
                      Desbloquear<span className="visually-hidden"> a {u.alias}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <ConfirmDialog open={confirm !== null} busy={busy === 'confirm'} error={confirmErr}
        title={confirm?.kind === 'block' ? `¿Bloquear a ${confirm.user.alias}?` : `¿Quitar a ${confirm?.user.alias ?? ''} de tus amigos?`}
        confirmLabel={confirm?.kind === 'block' ? 'Bloquear' : 'Quitar'} danger
        body={confirm?.kind === 'block'
          ? <p>Dejaréis de ser amigos, se cancelarán las invitaciones pendientes entre vosotros y no podrá encontrarte ni ver tu disponibilidad.</p>
          : <p>Dejará de ver tu disponibilidad compartida con «amigos» de inmediato. Podéis volver a ser amigos más adelante.</p>}
        onConfirm={() => void doConfirm()} onClose={() => setConfirm(null)} />
    </div>
  );
}
