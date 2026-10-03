import { useState, type FormEvent } from 'react';
import { Field } from '../components/Field';
import { authErrorMessage, login, resetPassword, signup } from '../auth';
import { Link, usePageTitle } from '../router';
import { pendingSignup } from '../session';

const ALIAS_RE = /^[\p{L}\p{N}._-]{3,24}$/u;
export function aliasProblem(alias: string): string | null {
  const a = alias.normalize('NFC').trim();
  if (!ALIAS_RE.test(a) || !/[\p{L}\p{N}]/u.test(a)) return 'Entre 3 y 24 caracteres: letras, números, punto, guion o guion bajo.';
  return null;
}

export function LoginPage() {
  usePageTitle('Entrar');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(authErrorMessage(err));
      setBusy(false);
    }
  };

  return (
    <main id="main" className="auth-main">
      <form className="auth-card" onSubmit={submit} noValidate aria-describedby={error ? 'login-error' : undefined}>
        <h1>Entrar</h1>
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Contraseña" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="form-error" id="login-error" role="alert">{error}</p>}
        <button className="btn btn-primary btn-block" type="submit" disabled={busy} aria-busy={busy || undefined}>{busy ? 'Entrando…' : 'Entrar'}</button>
        <p className="auth-links">
          <Link to="/recuperar">¿Has olvidado la contraseña?</Link>
          <span>¿Aún no tienes cuenta? <Link to="/registro">Crear cuenta</Link></span>
        </p>
      </form>
    </main>
  );
}

export function SignupPage() {
  usePageTitle('Crear cuenta');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [alias, setAlias] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [aliasErr, setAliasErr] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const aErr = aliasProblem(alias);
    const pErr = password.length < 8 ? 'Usa al menos 8 caracteres.' : null;
    setAliasErr(aErr);
    setPwErr(pErr);
    if (aErr || pErr) return;
    setBusy(true);
    pendingSignup.alias = alias.normalize('NFC').trim();
    try {
      // Al crearse la cuenta, la app pasa a la pantalla de alias, que envía este alias automáticamente.
      await signup(email, password);
    } catch (err) {
      pendingSignup.alias = null;
      setError(authErrorMessage(err));
      setBusy(false);
    }
  };

  return (
    <main id="main" className="auth-main">
      <form className="auth-card" onSubmit={submit} noValidate>
        <h1>Crear cuenta</h1>
        <p className="muted">Solo necesitas un email, una contraseña y un alias. No hace falta confirmar el email.</p>
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          hint="Privado: nadie más lo verá." />
        <Field label="Contraseña" type="password" autoComplete="new-password" required minLength={8} value={password}
          onChange={(e) => setPassword(e.target.value)} hint="Mínimo 8 caracteres." error={pwErr} />
        <Field label="Alias público" autoComplete="nickname" required value={alias} onChange={(e) => setAlias(e.target.value)}
          hint="Así te verán tus amistades. 3 a 24 caracteres." error={aliasErr} maxLength={24} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn btn-primary btn-block" type="submit" disabled={busy} aria-busy={busy || undefined}>{busy ? 'Creando cuenta…' : 'Crear cuenta'}</button>
        <p className="auth-links"><span>¿Ya tienes cuenta? <Link to="/entrar">Entrar</Link></span></p>
      </form>
    </main>
  );
}

export function ResetPage() {
  usePageTitle('Recuperar contraseña');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await resetPassword(email);
      setSent(true);
    } catch (err) {
      const code = (err as { code?: string }).code;
      // No revelamos si el email existe: tratamos «usuario no encontrado» como enviado.
      if (code === 'auth/user-not-found') setSent(true);
      else setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main id="main" className="auth-main">
      <form className="auth-card" onSubmit={submit} noValidate>
        <h1>Recuperar contraseña</h1>
        {sent ? (
          <p role="status" className="notice notice-ok">Si existe una cuenta con ese email, recibirás un enlace para elegir una contraseña nueva. Revisa también la carpeta de spam.</p>
        ) : (
          <>
            <p className="muted">Te enviaremos un enlace para elegir una contraseña nueva.</p>
            <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="btn btn-primary btn-block" type="submit" disabled={busy} aria-busy={busy || undefined}>{busy ? 'Enviando…' : 'Enviar enlace'}</button>
          </>
        )}
        <p className="auth-links"><Link to="/entrar">Volver a entrar</Link></p>
      </form>
    </main>
  );
}
