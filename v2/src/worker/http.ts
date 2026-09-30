import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';

export class ApiError extends HTTPException {
  constructor(status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 503, public code: string, message: string) {
    super(status, { message });
  }
}

export const notFound = (what = 'Recurso') => new ApiError(404, 'not_found', `${what} no encontrado.`);
export const forbidden = (msg = 'No tienes permiso para esta acción.') => new ApiError(403, 'forbidden', msg);
export const conflict = (msg: string, code = 'conflict') => new ApiError(409, code, msg);
export const badRequest = (msg: string, code = 'bad_request') => new ApiError(400, code, msg);

export async function parseBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest('El cuerpo debe ser JSON válido.', 'invalid_json');
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new ApiError(422, 'validation', `Dato no válido${first?.path.length ? ` en «${first.path.join('.')}»` : ''}: ${first?.message ?? ''}`.trim());
  }
  return r.data;
}

export function parseQuery<T extends z.ZodType>(c: Context, schema: T): z.infer<T> {
  const r = schema.safeParse(c.req.query());
  if (!r.success) throw new ApiError(422, 'validation', 'Parámetros no válidos.');
  return r.data;
}

export const now = () => Date.now();
export const newId = () => crypto.randomUUID();
