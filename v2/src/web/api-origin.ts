// Validación del origen de la API, sin dependencias del navegador (la usa también vite.config.ts).
/**
 * Valida el origen de la API: https://host[:puerto] sin ruta, consulta ni credenciales (http solo para localhost).
 * Vacío = mismo origen (desarrollo y E2E con el proxy de Vite). Un valor inválido rompe el arranque en vez de
 * enviar el token a un sitio inesperado o confundir la subruta /skitrip/ de Pages con la API.
 */
export function parseApiOrigin(raw: string | undefined): string {
  const v = (raw ?? '').trim();
  if (!v) return '';
  let u: URL;
  try { u = new URL(v); } catch { throw new Error(`VITE_API_BASE_URL no es una URL: ${v}`); }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new Error('VITE_API_BASE_URL debe usar https (http solo para localhost).');
  if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) {
    throw new Error('VITE_API_BASE_URL debe ser solo un origen, sin ruta (p. ej. https://skitrip.ejemplo.workers.dev).');
  }
  return u.origin;
}
