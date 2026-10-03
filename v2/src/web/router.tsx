// Enrutador mínimo con rutas en el fragmento (sin librerías): /skitrip/#/viajes?x=1.
// GitHub Pages solo sirve archivos estáticos: con el fragmento, abrir un enlace directo o recargar cualquier pantalla
// pide siempre index.html (sin 404) y la ruta de la app nunca viaja al servidor. Las rutas internas siguen siendo
// «/viajes», «/estaciones/:id»…; solo la URL visible lleva el «#».
import { useEffect, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', notify);
  window.addEventListener('hashchange', notify);
}

/** Ruta actual de la app («/viajes?x=1»), leída del fragmento. Sin fragmento, la portada. */
export function currentRoute(): string {
  const h = location.hash.slice(1);
  return h.startsWith('/') ? h : '/';
}

/** URL relativa al documento para una ruta de la app: sirve para href, abrir en otra pestaña y compartir. */
export const hrefFor = (to: string) => `#${to}`;

/** URL absoluta para compartir (enlaces de invitación): origen + subruta publicada + fragmento. */
export const absoluteUrl = (to: string) => new URL(`${import.meta.env.BASE_URL}${hrefFor(to)}`, location.origin).toString();

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (to === currentRoute()) return;
  const url = location.pathname + location.search + hrefFor(to);
  if (opts.replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  notify();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useLocation() {
  const full = useSyncExternalStore(subscribe, currentRoute);
  const [path, search = ''] = full.split('?');
  return { path, query: new URLSearchParams(search) };
}

export function setQuery(key: string, value: string | null) {
  const [path, search = ''] = currentRoute().split('?');
  const q = new URLSearchParams(search);
  if (value === null) q.delete(key);
  else q.set(key, value);
  const s = q.toString();
  navigate(path + (s ? `?${s}` : ''), { replace: true });
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
  return <a href={hrefFor(to)} onClick={handle} {...rest} />;
}

/** Título del documento y foco al encabezado principal al cambiar de página (lectores de pantalla). */
export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · SkiTrip` : 'SkiTrip';
  }, [title]);
}
