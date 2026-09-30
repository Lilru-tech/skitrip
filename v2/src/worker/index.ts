import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { AuthError, bearer, verifyIdToken } from './auth';
import type { AppEnv, UserRow } from './env';
import { ApiError } from './http';
import { meRoutes } from './routes/me';
import { tripRoutes } from './routes/trips';
import { friendRoutes } from './routes/friends';
import { availabilityRoutes } from './routes/availability';
import { purgeRateLimits } from './ratelimit';

const app = new Hono<AppEnv>();

// Cabeceras de seguridad y sin caché para todas las respuestas de la API.
app.use('/api/*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Cache-Control', 'no-store');
  c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
});

// Orígenes explícitos. La SPA es del mismo origen; otros orígenes solo si están en ALLOWED_ORIGINS.
app.use('/api/*', async (c, next) => {
  const origin = c.req.header('Origin');
  if (origin) {
    const self = new URL(c.req.url).origin;
    const allowed = new Set(c.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean));
    if (origin !== self && !allowed.has(origin)) {
      throw new ApiError(403, 'origin_not_allowed', 'Origen no permitido.');
    }
    if (origin !== self) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
      if (c.req.method === 'OPTIONS') {
        c.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE');
        c.header('Access-Control-Allow-Headers', 'Authorization,Content-Type,If-Match');
        c.header('Access-Control-Max-Age', '600');
        return c.body(null, 204);
      }
    }
  }
  await next();
});

app.use('/api/*', bodyLimit({ maxSize: 64 * 1024, onError: () => { throw new ApiError(413, 'too_large', 'La petición es demasiado grande.'); } }));

app.get('/api/health', (c) => c.json({ ok: true }));

// Autenticación: toda ruta bajo /api/ excepto las públicas exige un ID token válido.
const PUBLIC = [/^\/api\/health$/, /^\/api\/public\//, /^\/api\/ingest\//];
app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (PUBLIC.some((re) => re.test(path))) return next();
  try {
    const auth = await verifyIdToken(bearer(c.req.header('Authorization')), {
      projectId: c.env.FIREBASE_PROJECT_ID,
      mode: c.env.AUTH_MODE,
      requestHost: new URL(c.req.url).hostname,
    });
    c.set('auth', auth);
  } catch (e) {
    if (e instanceof AuthError) {
      const msg = e.code === 'expired' ? 'La sesión ha caducado. Vuelve a iniciar sesión.' : 'Sesión no válida.';
      throw new ApiError(401, `auth_${e.code}`, msg);
    }
    throw e;
  }
  // El perfil propio (alta de alias) es la única ruta autenticada que no exige perfil existente.
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE firebase_uid = ?1').bind(c.var.auth.uid).first<UserRow>();
  if (user) {
    if (user.status !== 'active') throw new ApiError(403, 'user_blocked', 'Tu cuenta está bloqueada.');
    if (c.var.auth.authTime < user.tokens_valid_after) throw new ApiError(401, 'auth_revoked', 'La sesión fue revocada. Vuelve a iniciar sesión.');
    c.set('user', user);
  } else if (!(path === '/api/me' && (c.req.method === 'GET' || c.req.method === 'POST'))) {
    throw new ApiError(403, 'profile_required', 'Completa tu registro eligiendo un alias.');
  }
  await next();
});

app.route('/api/me', meRoutes);
app.route('/api/trips', tripRoutes);
app.route('/api/friends', friendRoutes);
app.route('/api/availability', availabilityRoutes);

app.all('/api/*', () => {
  throw new ApiError(404, 'not_found', 'Ruta no encontrada.');
});

app.onError((err, c) => {
  if (err instanceof ApiError) return c.json({ error: { code: err.code, message: err.message } }, err.status);
  if (err instanceof HTTPException) return c.json({ error: { code: 'http', message: err.message } }, err.status);
  const msg = String((err as Error)?.message ?? err);
  if (/D1_ERROR|SQLITE_CONSTRAINT/.test(msg) && /UNIQUE/.test(msg)) {
    return c.json({ error: { code: 'conflict', message: 'Ya existe un registro igual.' } }, 409);
  }
  if (/daily limit|exceeded/i.test(msg)) {
    return c.json({ error: { code: 'quota', message: 'Se ha alcanzado el límite gratuito diario. Los datos siguen disponibles en modo lectura cuando sea posible.' } }, 503);
  }
  console.error('unhandled', msg);
  return c.json({ error: { code: 'internal', message: 'Error interno. Inténtalo de nuevo.' } }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_ctrl: ScheduledController, env: AppEnv['Bindings']) {
    await purgeRateLimits(env.DB);
  },
} satisfies ExportedHandler<AppEnv['Bindings']>;

export { app };
