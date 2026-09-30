import { useState, type FormEvent } from 'react';
import { errorMessage, patch } from '../api';
import { authErrorMessage, logout, resetPassword } from '../auth';
import { Field } from '../components/Field';
import { useToast } from '../components/Toast';
import { instantDate } from '../format';
import { usePageTitle } from '../router';
import { useProfile, useSession } from '../session';
import type { OwnProfile } from '../types';
import { aliasProblem } from './AuthPages';

export function ProfilePage() {
  usePageTitle('Tu perfil');
  const profile = useProfile();
  const { setProfile } = useSession();
  const toast = useToast();
  const [alias, setAlias] = useState(profile.alias);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const p = aliasProblem(alias);
    if (p) { setError(p); return; }
    setError(null);
    setBusy('alias');
    try {
      const r = await patch<{ profile: OwnProfile }>('/api/me', { alias: alias.trim() });
      setProfile(r.profile);
      toast.show('Alias guardado.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const sendReset = async () => {
    if (!profile.email) return;
    setBusy('reset');
    try {
      await resetPassword(profile.email);
      toast.show('Te hemos enviado un enlace para cambiar la contraseña.');
    } catch (err) {
      toast.show(authErrorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  const doLogout = async () => {
    setBusy('logout');
    try {
      await logout();
    } catch (err) {
      toast.show(authErrorMessage(err), 'error');
      setBusy(null);
    }
  };

  return (
    <div className="page page-narrow">
      <h1>Tu perfil</h1>
      <section className="panel stack">
        <form onSubmit={save} className="stack" noValidate>
          <Field label="Alias público" value={alias} maxLength={24} onChange={(e) => setAlias(e.target.value)} error={error}
            hint="Es lo único que ven tus amistades y los miembros de tus viajes." />
          <div><button type="submit" className="btn btn-primary" disabled={busy !== null || alias.trim() === profile.alias}>{busy === 'alias' ? 'Guardando…' : 'Guardar alias'}</button></div>
        </form>
        <dl className="facts">
          <div><dt>Email</dt><dd>{profile.email ?? '—'} <span className="muted">(privado, solo tú lo ves)</span></dd></div>
          <div><dt>Miembro desde</dt><dd>{instantDate(profile.createdAt)}</dd></div>
        </dl>
      </section>
      <section className="panel stack">
        <h2>Sesión y seguridad</h2>
        <div className="cluster">
          <button type="button" className="btn btn-secondary" onClick={sendReset} disabled={busy !== null || !profile.email}>
            {busy === 'reset' ? 'Enviando…' : 'Cambiar contraseña por email'}
          </button>
          <button type="button" className="btn btn-danger-outline" onClick={doLogout} disabled={busy !== null}>
            {busy === 'logout' ? 'Cerrando…' : 'Cerrar sesión'}
          </button>
        </div>
      </section>
    </div>
  );
}
