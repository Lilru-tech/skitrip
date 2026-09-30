// Cliente de la API del mismo origen. Añade el ID token en la cabecera (nunca en la URL),
// convierte errores `{ error: { code, message } }` en ApiError y reintenta una vez un 401
// forzando la renovación del token.
import { idToken } from './auth';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
  get isConflict() {
    return this.status === 409 && this.code === 'version_conflict';
  }
  get isNetwork() {
    return this.status === 0;
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function once(method: Method, path: string, body: unknown, force: boolean): Promise<Response> {
  const token = await idToken(force);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
}

export async function api<T = unknown>(method: Method, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await once(method, path, body, false);
    if (res.status === 401) res = await once(method, path, body, true);
  } catch {
    throw new ApiError(0, 'network', 'No hay conexión con el servidor. Revisa tu red e inténtalo de nuevo.');
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* respuesta no JSON */
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'http_' + res.status, err?.message ?? 'Error inesperado del servidor. Inténtalo de nuevo.');
  }
  return json as T;
}

export const get = <T>(path: string) => api<T>('GET', path);
export const post = <T>(path: string, body?: unknown) => api<T>('POST', path, body ?? {});
export const put = <T>(path: string, body: unknown) => api<T>('PUT', path, body);
export const patch = <T>(path: string, body: unknown) => api<T>('PATCH', path, body);
export const del = <T>(path: string) => api<T>('DELETE', path);

export const errorMessage = (e: unknown) =>
  e instanceof ApiError ? e.message : e instanceof Error && e.message ? e.message : 'Ha ocurrido un error inesperado.';

export const qs = (params: Record<string, string | number | undefined | null>) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])).toString();
