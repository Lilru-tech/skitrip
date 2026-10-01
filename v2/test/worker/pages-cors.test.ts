// La interfaz publicada en GitHub Pages (https://lilru-tech.github.io/skitrip/) llama a la API en otro origen.
// El origen exacto es https://lilru-tech.github.io (sin /skitrip/). CORS no sustituye la autenticación.
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import wrangler from '../../wrangler.jsonc?raw';
import { api, signup } from './helpers';

const PAGES = 'https://lilru-tech.github.io';
const raw = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
  SELF.fetch(`http://localhost${path}`, { method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });

describe('CORS para GitHub Pages', () => {
  it('la configuración de producción permite solo el origen exacto de Pages, sin comodines ni subruta', () => {
    const m = /"ALLOWED_ORIGINS":\s*"([^"]*)"/.exec(wrangler);
    expect(m?.[1]).toBe(PAGES);
    expect(wrangler).not.toMatch(/"ALLOWED_ORIGINS":\s*"[^"]*\*/);
    expect(wrangler).not.toMatch(/"assets"/); // el Worker ya no sirve la interfaz
  });

  it('preflight OPTIONS desde Pages: 204 con origen exacto, métodos de escritura y cabecera Authorization', async () => {
    const r = await raw('OPTIONS', '/api/trips', { Origin: PAGES, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' });
    expect(r.status).toBe(204);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(PAGES);
    expect(r.headers.get('Vary')).toMatch(/Origin/);
    expect(r.headers.get('Access-Control-Allow-Methods')).toBe('GET,POST,PUT,PATCH,DELETE');
    expect(r.headers.get('Access-Control-Allow-Headers')).toMatch(/Authorization/);
    expect(r.headers.get('Access-Control-Allow-Credentials')).toBeNull(); // sin cookies: solo Bearer
  });

  it('escritura con token desde Pages: 201 con JSON y cabecera CORS; lectura y borrado también', async () => {
    const u = await signup();
    const c = await raw('POST', '/api/trips', { Origin: PAGES, Authorization: `Bearer ${u.token}` }, { name: 'Desde Pages' });
    expect(c.status).toBe(201);
    expect(c.headers.get('Access-Control-Allow-Origin')).toBe(PAGES);
    expect(c.headers.get('Content-Type')).toMatch(/application\/json/);
    const id = (await c.json<any>()).trip.id;
    const g = await raw('GET', `/api/trips/${id}`, { Origin: PAGES, Authorization: `Bearer ${u.token}` });
    expect(g.status).toBe(200);
    expect(g.headers.get('Access-Control-Allow-Origin')).toBe(PAGES);
    const d = await raw('DELETE', `/api/trips/${id}`, { Origin: PAGES, Authorization: `Bearer ${u.token}` });
    expect(d.status).toBe(200);
    expect(d.headers.get('Access-Control-Allow-Origin')).toBe(PAGES);
  });

  it('los errores también llevan la cabecera CORS (el navegador puede leer el mensaje): 401, 422 y 404', async () => {
    const u = await signup();
    const noToken = await raw('GET', '/api/trips', { Origin: PAGES });
    expect(noToken.status).toBe(401);
    expect(noToken.headers.get('Access-Control-Allow-Origin')).toBe(PAGES);
    expect((await noToken.json<any>()).error.code).toMatch(/^auth_/);
    const bad = await raw('POST', '/api/trips', { Origin: PAGES, Authorization: `Bearer ${u.token}` }, { name: '' });
    expect(bad.status).toBe(422);
    expect(bad.headers.get('Access-Control-Allow-Origin')).toBe(PAGES);
    const missing = await raw('GET', '/api/trips/no-existe', { Origin: PAGES, Authorization: `Bearer ${u.token}` });
    expect([403, 404]).toContain(missing.status);
    expect(missing.headers.get('Access-Control-Allow-Origin')).toBe(PAGES);
  });

  it('CORS no da acceso: desde Pages, un viaje ajeno sigue prohibido', async () => {
    const a = await signup(), b = await signup();
    const t = (await api(a.token, 'POST', '/api/trips', { name: 'Privado' })).json.trip;
    const r = await raw('GET', `/api/trips/${t.id}`, { Origin: PAGES, Authorization: `Bearer ${b.token}` });
    expect([403, 404]).toContain(r.status);
  });

  it('orígenes parecidos o con ruta se rechazan, también en preflight', async () => {
    for (const origin of [`${PAGES}/skitrip`, 'https://lilru-tech.github.io.evil.example', 'http://lilru-tech.github.io', 'https://evil.example', 'null']) {
      const p = await raw('OPTIONS', '/api/trips', { Origin: origin, 'Access-Control-Request-Method': 'POST' });
      expect(p.status, origin).toBe(403);
      expect(p.headers.get('Access-Control-Allow-Origin'), origin).toBeNull();
    }
  });

  it('el origen local de pruebas sigue permitido por separado', async () => {
    const r = await raw('OPTIONS', '/api/trips', { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'PUT' });
    expect(r.status).toBe(204);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });
});
