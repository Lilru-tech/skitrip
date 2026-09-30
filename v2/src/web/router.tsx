// Enrutador mínimo con la History API (sin librerías).
import { useEffect, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
if (typeof window !== 'undefined') window.addEventListener('popstate', notify);

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (to === location.pathname + location.search + location.hash) return;
  if (opts.replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  notify();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => location.pathname + location.search;

export function useLocation() {
  const full = useSyncExternalStore(subscribe, snapshot);
  const [path, search = ''] = full.split('?');
  return { path, query: new URLSearchParams(search) };
}

export function setQuery(key: string, value: string | null) {
  const q = new URLSearchParams(location.search);
  if (value === null) q.delete(key);
  else q.set(key, value);
  const s = q.toString();
  navigate(location.pathname + (s ? `?${s}` : ''), { replace: true });
}

export function match(pattern: string, path: string): Record<string, string> | null {
  const names: string[] = [];
  const re = new RegExp('^' + pattern.replace(/:[a-zA-Z]+/g, (m) => (names.push(m.slice(1)), '([^/]+)')) + '/?$');
  const m = re.exec(path);
  if (!m) return null;
  return Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string };
export function Link({ to, onClick, ...rest }: LinkProps) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest} />;
}

/** Título del documento y foco al encabezado principal al cambiar de página (lectores de pantalla). */
export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · SkiTrip` : 'SkiTrip';
  }, [title]);
}
