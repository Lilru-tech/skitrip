import { Hono } from 'hono';
import { z } from 'zod';
import { validateAlias } from '../../core/alias';
import type { AppEnv, UserRow } from '../env';
import { ApiError, conflict, newId, now, parseBody } from '../http';
import { rateLimit } from '../ratelimit';

export const meRoutes = new Hono<AppEnv>();

export const publicProfile = (u: Pick<UserRow, 'id' | 'alias'>) => ({ id: u.id, alias: u.alias });
const ownProfile = (u: UserRow) => ({ id: u.id, alias: u.alias, email: u.email, role: u.role, homeOriginId: u.home_origin_id, createdAt: u.created_at });

meRoutes.get('/', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ profile: null, needsAlias: true });
  return c.json({ profile: ownProfile(user), needsAlias: false });
});

// Alta del perfil tras registrarse en Firebase. El email se toma del token validado, nunca del cuerpo.
meRoutes.post('/', async (c) => {
  if (c.get('user')) throw conflict('Tu perfil ya existe.', 'profile_exists');
  const { alias: rawAlias } = await parseBody(c, z.object({ alias: z.string().max(64) }));
  const v = validateAlias(rawAlias);
  if (!v.ok) throw new ApiError(422, 'invalid_alias', v.reason);

  const ip = c.req.header('CF-Connecting-IP') ?? 'local';
  await rateLimit(c.env.DB, `signup:ip:${ip}`, 5, 3600);

  const max = Number(c.env.MAX_PROFILES) || 50;
  const { n } = (await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>())!;
  if (n >= max) throw new ApiError(503, 'signups_closed', 'El registro está completo por ahora. Pide acceso a quien administra SkiTrip.');

  const auth = c.get('auth');
  const t = now();
  const id = newId();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO users (id, firebase_uid, alias, alias_norm, email, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)',
      ).bind(id, auth.uid, v.alias, v.norm, auth.email, t),
      c.env.DB.prepare('INSERT INTO user_prefs (user_id, updated_at) VALUES (?1, ?2)').bind(id, t),
    ]);
  } catch (e) {
    const msg = String((e as Error).message);
    if (/alias_norm/.test(msg)) throw conflict('Ese alias ya está en uso.', 'alias_taken');
    if (/firebase_uid/.test(msg)) throw conflict('Tu perfil ya existe.', 'profile_exists');
    throw e;
  }
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?1').bind(id).first<UserRow>();
  return c.json({ profile: ownProfile(user!) }, 201);
});

meRoutes.patch('/', async (c) => {
  const user = c.get('user');
  const body = await parseBody(c, z.object({ alias: z.string().max(64).optional(), homeOriginId: z.string().max(64).nullable().optional() }));
  const sets: string[] = [];
  const args: unknown[] = [];
  if (body.alias !== undefined) {
    const v = validateAlias(body.alias);
    if (!v.ok) throw new ApiError(422, 'invalid_alias', v.reason);
    sets.push('alias = ?', 'alias_norm = ?');
    args.push(v.alias, v.norm);
  }
  if (body.homeOriginId !== undefined) {
    sets.push('home_origin_id = ?');
    args.push(body.homeOriginId);
  }
  if (!sets.length) return c.json({ profile: ownProfile(user) });
  try {
    await c.env.DB.prepare(`UPDATE users SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).bind(...args, now(), user.id).run();
  } catch (e) {
    if (/alias_norm/.test(String((e as Error).message))) throw conflict('Ese alias ya está en uso.', 'alias_taken');
    throw e;
  }
  const fresh = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?1').bind(user.id).first<UserRow>();
  return c.json({ profile: ownProfile(fresh!) });
});

meRoutes.get('/prefs', async (c) => {
  const row = await c.env.DB.prepare('SELECT prefs_json, version FROM user_prefs WHERE user_id = ?1').bind(c.get('user').id).first<{ prefs_json: string; version: number }>();
  return c.json({ prefs: JSON.parse(row?.prefs_json ?? '{}'), version: row?.version ?? 1 });
});

// Preferencias con control de versión: si otro dispositivo guardó antes, 409 en lugar de sobrescribir.
meRoutes.put('/prefs', async (c) => {
  const { prefs, version } = await parseBody(c, z.object({ prefs: z.record(z.string(), z.unknown()), version: z.number().int().positive() }));
  const json = JSON.stringify(prefs);
  if (json.length > 8000) throw new ApiError(413, 'too_large', 'Preferencias demasiado grandes.');
  const r = await c.env.DB.prepare('UPDATE user_prefs SET prefs_json = ?1, version = version + 1, updated_at = ?2 WHERE user_id = ?3 AND version = ?4')
    .bind(json, now(), c.get('user').id, version)
    .run();
  if (!r.meta.changes) throw conflict('Tus preferencias cambiaron en otro dispositivo. Recarga para ver la última versión.', 'version_conflict');
  return c.json({ prefs, version: version + 1 });
});
