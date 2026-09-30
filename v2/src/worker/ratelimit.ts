import { ApiError } from './http';

/**
 * Límite de ventana fija guardado en D1: un único contador por (bucket, ventana), consistente
 * entre ubicaciones de Cloudflare (a diferencia de un contador en memoria del isolate).
 * Cuesta una escritura por llamada, así que se usa solo en acciones caras o abusables.
 */
export async function rateLimit(db: D1Database, bucket: string, limit: number, windowSeconds: number, nowMs = Date.now()): Promise<void> {
  const windowStart = Math.floor(nowMs / 1000 / windowSeconds) * windowSeconds;
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (bucket, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT (bucket, window_start) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(bucket, windowStart)
    .first<{ count: number }>();
  if ((row?.count ?? 0) > limit) {
    throw new ApiError(429, 'rate_limited', 'Demasiadas solicitudes. Espera un poco y vuelve a intentarlo.');
  }
}

/** Limpieza oportunista de ventanas antiguas (se llama desde el cron diario). */
export async function purgeRateLimits(db: D1Database, olderThanSeconds = 2 * 86400, nowMs = Date.now()) {
  await db.prepare('DELETE FROM rate_limits WHERE window_start < ?1').bind(Math.floor(nowMs / 1000) - olderThanSeconds).run();
}
