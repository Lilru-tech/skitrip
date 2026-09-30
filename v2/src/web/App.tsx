import { useEffect, useRef } from 'react';
import { ToastProvider } from './components/Toast';
import { Loading, ErrorState } from './components/States';
import { CalendarIcon, Cart, Compare, Mountain, People, Suitcase, UserIcon } from './components/Icons';
import { Link, match, navigate, useLocation } from './router';
import { SessionProvider, useSession } from './session';
import { logout } from './auth';
import { Landing } from './pages/Landing';
import { LoginPage, ResetPage, SignupPage } from './pages/AuthPages';
import { AliasOnboarding } from './pages/AliasOnboarding';
import { ProfilePage } from './pages/Profile';
import { FriendsPage } from './pages/Friends';
import { TripsPage } from './pages/Trips';
import { TripDetailPage } from './pages/TripDetail';
import { TripCalendarPage } from './pages/TripCalendar';
import { CalendarPage } from './pages/CalendarPage';
import { JoinPage } from './pages/Join';
import { ComparePage } from './pages/Compare';
import { AreaPage } from './pages/Area';
import { SourcesPage } from './pages/Sources';
import { ShoppingPage } from './pages/Shopping';
import { NotificationsBell, NotificationsPage } from './pages/Notifications';
import { AdminPage } from './pages/Admin';
import { TripBudgetPage } from './pages/TripBudget';
import { TripCandidatesPage } from './pages/TripCandidates';
import { TripSearchesPage } from './pages/TripSearches';
import { TripExpensesPage } from './pages/TripExpenses';
import { TripCommentsPage } from './pages/TripComments';

export function App() {
  return (
    <ToastProvider>
      <SessionProvider>
        <Root />
      </SessionProvider>
    </ToastProvider>
  );
}

const NAV = [
  { to: '/comparar', label: 'Comparar', icon: Compare },
  { to: '/viajes', label: 'Mis viajes', short: 'Viajes', icon: Suitcase },
  { to: '/calendario', label: 'Calendario', icon: CalendarIcon },
  { to: '/compra', label: 'Compra', icon: Cart },
  { to: '/amigos', label: 'Amigos', icon: People },
];

export function Wordmark() {
  return (
    <span className="wordmark"><Mountain className="wordmark-icon" width={26} height={26} /> <span>SkiTrip</span></span>
  );
}

const PUBLIC_PATHS = ['/', '/entrar', '/registro', '/recuperar'];
/** Páginas visibles también sin sesión, pero que no redirigen a la app al entrar. */
const OPEN_PATHS = ['/fuentes'];

function Root() {
  const { state } = useSession();
  const { path } = useLocation();

  // Tras iniciar sesión, las páginas públicas redirigen a la app; sin sesión, la app redirige a entrar.
  useEffect(() => {
    if (state.status === 'ready' && PUBLIC_PATHS.includes(path)) {
      let next: string | null = null;
      try { next = sessionStorage.getItem('skitrip.next'); sessionStorage.removeItem('skitrip.next'); } catch { /* sin almacenamiento */ }
      navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/viajes', { replace: true });
    }
    if (state.status === 'anonymous' && !PUBLIC_PATHS.includes(path) && !OPEN_PATHS.includes(path)) {
      try { sessionStorage.setItem('skitrip.next', path + location.search + location.hash); } catch { /* sin almacenamiento */ }
      navigate('/entrar', { replace: true });
    }
  }, [state.status, path]);

  if (state.status === 'loading') return <div className="boot"><Wordmark /><Loading label="Cargando SkiTrip…" /></div>;

  if (state.status === 'anonymous') {
    return (
      <PublicShell>
        {path === '/fuentes' ? <main id="main" className="public-main"><SourcesPage /></main> : path === '/entrar' ? <LoginPage /> : path === '/registro' ? <SignupPage /> : path === '/recuperar' ? <ResetPage /> : <Landing />}
      </PublicShell>
    );
  }
  if (state.status === 'needsAlias') return <PublicShell><AliasOnboarding /></PublicShell>;
  if (state.status === 'error') {
    return (
      <PublicShell>
        <main id="main" className="auth-main">
          <ErrorState message={state.message} onRetry={() => location.reload()} />
          <button type="button" className="btn btn-link" onClick={() => void logout()}>Cerrar sesión</button>
        </main>
      </PublicShell>
    );
  }
  return <AppShell path={path} />;
}

function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="public-shell">
      <a className="skip-link" href="#main">Saltar al contenido</a>
      <header className="public-header">
        <Link to="/" className="brand-link" aria-label="SkiTrip, inicio"><Wordmark /></Link>
      </header>
      {children}
    </div>
  );
}

function AppShell({ path }: { path: string }) {
  const { state } = useSession();
  const mainRef = useRef<HTMLElement>(null);
  const first = useRef(true);
  // Al navegar, llevar el foco al contenido principal para lectores de pantalla y teclado.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [path]);
  const alias = state.status === 'ready' ? state.profile.alias : '';
  const rawSection = '/' + (path.split('/')[1] ?? '');
  const section = rawSection === '/estaciones' ? '/comparar' : rawSection;

  let page: React.ReactNode;
  let p: Record<string, string> | null;
  if ((p = match('/viajes/:id/calendario', path))) page = <TripCalendarPage key={p.id} tripId={p.id} />;
  else if ((p = match('/viajes/:id/presupuesto', path))) page = <TripBudgetPage key={p.id} tripId={p.id} />;
  else if ((p = match('/viajes/:id/candidaturas', path))) page = <TripCandidatesPage key={p.id} tripId={p.id} />;
  else if ((p = match('/viajes/:id/busquedas', path))) page = <TripSearchesPage key={p.id} tripId={p.id} />;
  else if ((p = match('/viajes/:id/gastos', path))) page = <TripExpensesPage key={p.id} tripId={p.id} />;
  else if ((p = match('/viajes/:id/comentarios', path))) page = <TripCommentsPage key={p.id} tripId={p.id} />;
  else if ((p = match('/viajes/:id', path))) page = <TripDetailPage key={p.id} tripId={p.id} />;
  else if (match('/viajes', path)) page = <TripsPage />;
  else if (match('/calendario', path)) page = <CalendarPage />;
  else if (match('/amigos', path)) page = <FriendsPage />;
  else if (match('/perfil', path)) page = <ProfilePage />;
  else if (match('/unirse', path)) page = <JoinPage />;
  else if (match('/comparar', path)) page = <ComparePage />;
  else if ((p = match('/estaciones/:id', path))) page = <AreaPage key={p.id} areaId={p.id} />;
  else if (match('/fuentes', path)) page = <SourcesPage />;
  else if (match('/compra', path)) page = <ShoppingPage />;
  else if (match('/avisos', path)) page = <NotificationsPage />;
  else if (match('/admin', path)) page = <AdminPage />;
  else page = <NotFound />;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">Saltar al contenido</a>
      <header className="app-header">
        <div className="app-header-inner">
          <Link to="/viajes" className="brand-link" aria-label="SkiTrip, mis viajes"><Wordmark /></Link>
          <nav className="top-nav" aria-label="Principal">
            {NAV.map((n) => (
              <Link key={n.to} to={n.to} className="top-nav-link" aria-current={section === n.to ? 'page' : undefined}>{n.label}</Link>
            ))}
          </nav>
          <NotificationsBell path={path} />
          <Link to="/perfil" className="profile-link" aria-current={section === '/perfil' ? 'page' : undefined} aria-label={`Tu perfil: ${alias}`}>
            <UserIcon /><span className="profile-alias">{alias}</span>
          </Link>
        </div>
      </header>
      <main id="main" ref={mainRef} tabIndex={-1} className="app-main">{page}</main>
      <nav className="bottom-nav" aria-label="Principal (móvil)">
        {NAV.map((n) => (
          <Link key={n.to} to={n.to} className="bottom-nav-link" aria-current={section === n.to ? 'page' : undefined}>
            <n.icon /><span>{n.short ?? n.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

function NotFound() {
  return (
    <div className="page">
      <h1>Página no encontrada</h1>
      <p>La dirección no existe o ya no está disponible.</p>
      <Link to="/viajes" className="btn btn-primary">Ir a mis viajes</Link>
    </div>
  );
}
