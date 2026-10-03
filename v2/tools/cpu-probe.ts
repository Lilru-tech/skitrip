// Medición controlada de CPU por ruta en producción (workflow «v2 · medir CPU»).
//
// Lanza grupos de peticiones reales, uno por ruta y separados en el tiempo, y anota la ventana de cada grupo en
// cpu-windows.json. Después tools/cpu-summary.ts cruza esas ventanas con `wrangler tail` (CPU de cada petición) y con
// la analítica gratuita de Cloudflare (percentiles por ventana). Usa dos cuentas de prueba prod-check-<ejecución>-{p,q}
// que el workflow borra al final con tools/prod-cleanup.ts. No imprime tokens ni datos personales.
import { writeFileSync } from 'node:fs';

const API = (process.env.PROD_API ?? '').replace(/\/$/, '');
const KEY = process.env.FIREBASE_API_KEY ?? '';
const INGEST = process.env.SKITRIP_INGEST_TOKEN ?? '';
const RUN = process.env.RUN_ID ?? '';
const REPEAT = Number(process.env.PROBE_REPEAT ?? 5);
if (!API || !KEY || !INGEST || !/^[0-9]{6,15}(-[0-9]{1,3})?$/.test(RUN)) { console.error('Faltan PROD_API, FIREBASE_API_KEY, SKITRIP_INGEST_TOKEN o RUN_ID'); process.exit(2); }

const IDT = 'https://identitytoolkit.googleapis.com/v1';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Win = { label: string; method: string; path: string; n: number; start: string; end: string; statuses: number[] };
const windows: Win[] = [];

async function call(token: string | null, method: string, path: string, body?: unknown) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { Origin: 'https://lilru-tech.github.io', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* no JSON */ }
  return { status: r.status, json };
}

/** Un grupo: `n` peticiones iguales en su propia ventana de tiempo (con 3 s de margen a cada lado). */
async function group(label: string, token: string | null, method: string, path: string, body?: unknown, n = REPEAT) {
  await sleep(3000);
  const start = new Date().toISOString();
  const statuses: number[] = [];
  let last: any = null;
  for (let i = 0; i < n; i++) { const r = await call(token, method, path, typeof body === 'function' ? (body as (i: number) => unknown)(i) : body); statuses.push(r.status); last = r.json; }
  const end = new Date().toISOString();
  await sleep(3000);
  windows.push({ label, method, path: path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}|[A-Za-z0-9_-]{20,}/g, ':id'), n, start, end, statuses });
  console.log(`${label.padEnd(34)} ${method.padEnd(6)} ${statuses.join(',')}`);
  return last;
}

async function account(k: string) {
  const email = `prod-check-${RUN}-${k}@example.com`;
  const r = await fetch(`${IDT}/accounts:signUp?key=${KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: `pc-${RUN}-${k}-Segura!`, returnSecureToken: true }) });
  if (!r.ok) throw new Error(`alta de la cuenta de prueba ${k} en Firebase: HTTP ${r.status}`);
  const j = (await r.json()) as { idToken: string; localId: string };
  return { email, token: j.idToken, uid: j.localId };
}

const days = (from: string, n: number, status: (i: number) => string) =>
  Array.from({ length: n }, (_, i) => ({ day: new Date(Date.parse(from) + i * 864e5).toISOString().slice(0, 10), status: status(i) }));

const p = await account('p');
const q = await account('q');
writeFileSync(process.env.CLEANUP_MANIFEST ?? 'cleanup-manifest.json', JSON.stringify({ runId: RUN, users: [p, q].map(({ email, uid }) => ({ email, uid })) }));
const created: { trip?: string } = {};
try {
  // Públicas y de ingesta (solo lectura).
  await group('salud', null, 'GET', '/api/health');
  const cat = await group('catálogo', null, 'GET', '/api/public/catalog');
  await group('fuentes', null, 'GET', '/api/public/sources');
  await group('capacidades', null, 'GET', '/api/public/capabilities');
  const areas: string[] = (cat?.areas ?? []).map((a: any) => a.id);
  for (const id of areas.slice(0, 6)) await group(`estación ${id}`, null, 'GET', `/api/public/areas/${encodeURIComponent(id)}`);
  await group('ingesta: escenarios', INGEST, 'GET', '/api/ingest/scenarios');
  await group('ingesta: fuentes de ofertas', INGEST, 'GET', '/api/ingest/offer-sources');
  await group('ingesta: fuentes de nieve', INGEST, 'GET', '/api/ingest/snow-sources');

  // Alta y perfil (la primera petición autenticada descarga las claves de Firebase).
  const meP = await group('alta de perfil', p.token, 'POST', '/api/me', { alias: `pc${RUN.replace(/\D/g, '').slice(-7)}p` }, 1);
  const meQ = (await call(q.token, 'POST', '/api/me', { alias: `pc${RUN.replace(/\D/g, '').slice(-7)}q` })).json;
  const pid = meP?.profile?.id, qid = meQ?.profile?.id;
  if (!pid || !qid) throw new Error('no se pudieron crear los perfiles de prueba');
  await group('mi perfil', p.token, 'GET', '/api/me');
  await group('preferencias', p.token, 'GET', '/api/me/prefs');

  // Amistad y calendario con 150 días.
  const req = (await call(p.token, 'POST', '/api/friends/requests', { userId: qid })).json;
  if (req?.requestId) await call(q.token, 'POST', `/api/friends/requests/${req.requestId}/accept`);
  await group('amigos', p.token, 'GET', '/api/friends');
  await group('guardar disponibilidad 150 días', p.token, 'PUT', '/api/availability/me', { set: days('2026-12-01', 150, (i) => ['free', 'maybe', 'busy'][i % 3]) }, 2);
  await call(q.token, 'PUT', '/api/availability/me', { set: days('2026-12-01', 150, (i) => (i % 2 ? 'free' : 'maybe')) });
  await call(p.token, 'PUT', '/api/availability/shares', { friends: true, tripIds: [] });
  await call(q.token, 'PUT', '/api/availability/shares', { friends: true, tripIds: [] });
  await group('mi disponibilidad', p.token, 'GET', '/api/availability/me');
  await group('fechas comunes', p.token, 'GET', `/api/availability/common?from=2026-12-01&to=2027-04-29&ids=${qid}&nights=2`);
  await group('disponibilidad visible', p.token, 'GET', '/api/availability/visible?from=2026-12-01&to=2027-04-29');

  // Viaje con compra, gastos y comentarios.
  const trip = (await group('crear viaje', p.token, 'POST', '/api/trips', { name: 'Prueba CPU' }, 1))?.trip;
  created.trip = trip?.id;
  const T = `/api/trips/${trip.id}`;
  const inv = (await call(p.token, 'POST', `${T}/invitations`, { userId: qid })).json?.invitation;
  if (inv) await call(q.token, 'POST', `/api/trips/invitations/${inv.id}/accept`);
  await group('mis viajes', p.token, 'GET', '/api/trips');
  await group('viaje', p.token, 'GET', T);
  await group('disponibilidad del viaje', p.token, 'GET', `/api/availability/trip/${trip.id}?from=2026-12-01&to=2027-04-29&nights=2`);
  await group('añadir artículos', p.token, 'POST', `${T}/shopping/items`, (i: number) => ({ name: `Artículo ${i}`, qty: 1 + (i % 3) }), 10);
  await group('lista de la compra', p.token, 'GET', `${T}/shopping`);
  await group('cesta', p.token, 'GET', `${T}/shopping/basket`);
  await group('presupuesto', p.token, 'GET', `${T}/budget`);
  await group('comparar costes', p.token, 'GET', `${T}/cost-comparison`);
  await group('candidaturas', p.token, 'GET', `${T}/candidates`);
  await group('escenarios', p.token, 'GET', `${T}/scenarios`);
  await group('añadir gasto', p.token, 'POST', `${T}/expenses`, (i: number) => ({ concept: `Gasto ${i}`, spentOn: '2027-01-02', payerId: pid, amountCents: 1000 + i, split: { mode: 'equal', participants: [pid, qid] } }), 5);
  await group('gastos', p.token, 'GET', `${T}/expenses`);
  await group('comentar', p.token, 'POST', '/api/comments', (i: number) => ({ scope: 'trip_private', tripId: trip.id, body: `Comentario de prueba ${i}` }), 3);
  await group('comentarios', p.token, 'GET', `${T}/comments`);
  await group('avisos', q.token, 'GET', '/api/notifications');
  await group('productos', p.token, 'GET', '/api/products?q=leche');
  await group('borrar viaje', p.token, 'DELETE', T, undefined, 1);
  created.trip = undefined;
} finally {
  if (created.trip) await call(p.token, 'DELETE', `/api/trips/${created.trip}`);
  for (const u of [p, q]) await fetch(`${IDT}/accounts:delete?key=${KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: u.token }) });
  writeFileSync('cpu-windows.json', JSON.stringify(windows, null, 2));
}
