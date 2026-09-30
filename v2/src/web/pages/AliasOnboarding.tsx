import { useEffect, useRef, useState, type FormEvent } from 'react';
import { errorMessage, post } from '../api';
import { logout } from '../auth';
import { Field } from '../components/Field';
import { usePageTitle } from '../router';
import { pendingSignup, useSession } from '../session';
import type { OwnProfile } from '../types';
import { aliasProblem } from './AuthPages';

export function AliasOnboarding() {
  usePageTitle('Elige tu alias');
  const { setProfile } = useSession();
  const [alias, setAlias] = useState(pendingSignup.alias ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const auto = useRef(false);

  const send = async (value: string) => {
    setError(null);
    setBusy(true);
    try {
      const r = await post<{ profile: OwnProfile }>('/api/me', { alias: value.normalize('NFC').trim() });
      pendingSignup.alias = null;
      setProfile(r.profile);
    } catch (e) {
      pendingSignup.alias = null;
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  // Viene del registro: enviar el alias ya elegido una sola vez.
  useEffect(() => {
    if (auto.current || !pendingSignup.alias) return;
    auto.current = true;
    void send(pendingSignup.alias);
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const p = aliasProblem(alias);
    if (p) { setError(p); return; }
    void send(alias);
  };

  return (
    <main id="main" className="auth-main">
      <form className="auth-card" onSubmit={submit} noValidate>
        <h1>Elige tu alias</h1>
        <p className="muted">Es el nombre público con el que te verán tus amistades. Tu email seguirá siendo privado.</p>
        <Field label="Alias público" autoComplete="nickname" value={alias} maxLength={24} onChange={(e) => setAlias(e.target.value)}
          hint="3 a 24 caracteres: letras, números, punto, guion o guion bajo." />
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn btn-primary btn-block" type="submit" disabled={busy} aria-busy={busy || undefined}>{busy ? 'Guardando…' : 'Guardar alias'}</button>
        <p className="auth-links"><button type="button" className="btn btn-link" onClick={() => void logout()}>Cerrar sesión</button></p>
      </form>
    </main>
  );
}
