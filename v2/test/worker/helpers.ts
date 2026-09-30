import { SELF } from 'cloudflare:test';

const PROJECT = 'demo-skitrip';
const b64 = (o: unknown) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Token con el mismo formato que emite el emulador oficial de Firebase Auth (alg none, sin firma). */
export function emulatorToken(uid: string, opts: { email?: string; expOffset?: number; authTime?: number; aud?: string } = {}) {
  const nowS = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    iss: `https://securetoken.google.com/${opts.aud ?? PROJECT}`,
    aud: opts.aud ?? PROJECT,
    sub: uid, user_id: uid,
    email: opts.email ?? `${uid}@example.test`, email_verified: false,
    auth_time: opts.authTime ?? nowS, iat: nowS, exp: nowS + (opts.expOffset ?? 3600),
    firebase: { identities: {}, sign_in_provider: 'password' },
  })}.`;
}

export async function api(token: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await SELF.fetch(`http://localhost${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* texto */ }
  return { status: res.status, json, d1: Number(res.headers.get('X-D1-Statements') ?? NaN) };
}

/** Siembra el catálogo real (áreas y fuentes de data/catalog.json) para pruebas de volumen. */
export async function seedCatalog(db: D1Database, catalog: { areas: any[]; sources: any[] }) {
  const stmts = [
    ...catalog.areas.map((a) => db.prepare('INSERT OR IGNORE INTO areas (id, name, kind, country, official_total_km) VALUES (?1, ?2, ?3, ?4, ?5)').bind(a.id, a.name, a.kind, a.country, a.official_total_km ?? null)),
    ...catalog.sources.map((s) => db.prepare(`INSERT OR IGNORE INTO sources (id, area_id, scope_area_id, kind, provider, url, method, fields, status, adapter) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '[]', ?8, ?9)`)
      .bind(s.id, s.area, s.scope, s.kind, s.provider, s.url, s.method, s.status, s.adapter)),
  ];
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
}

let n = 0;
/** Crea usuario con perfil y devuelve { token, id, alias }. */
export async function signup(alias = `user${++n}${Math.random().toString(36).slice(2, 6)}`) {
  const token = emulatorToken(`uid-${alias}`);
  const r = await api(token, 'POST', '/api/me', { alias }, { 'CF-Connecting-IP': `10.0.${n % 250}.${Math.floor(Math.random() * 250)}` });
  if (r.status !== 201) throw new Error(`signup failed ${r.status} ${JSON.stringify(r.json)}`);
  return { token, id: r.json.profile.id as string, alias };
}

export async function befriend(a: { token: string; id: string }, b: { token: string; id: string }) {
  const r = await api(a.token, 'POST', '/api/friends/requests', { userId: b.id });
  if (r.json.status === 'accepted') return;
  const acc = await api(b.token, 'POST', `/api/friends/requests/${r.json.requestId}/accept`);
  if (acc.status !== 200) throw new Error('accept failed');
}
