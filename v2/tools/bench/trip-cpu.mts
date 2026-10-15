// Perfil local de GET /api/availability/trip/:id con 16 personas × 150 días (la carga de «v2 · medir CPU»).
// Uso: npx tsx tools/bench/trip-cpu.mts [veces]   (con --cpu-prof para un perfil de V8)
import { app } from '../../src/worker/index.ts';
import { nodeD1 } from './d1-node.ts';
import { seedGroupStatements, seedTripStatements, syntheticMembers } from '../cpu-group-sql.ts';

const PROJECT = 'demo-skitrip';
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (uid: string) => { const s = Math.floor(Date.now() / 1000); return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: uid, auth_time: s, iat: s, exp: s + 3600 })}.`; };
const DB = nodeD1(new URL('../../migrations', import.meta.url).pathname);
const env = { DB, AUTH_MODE: 'emulator', FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: 'https://lilru-tech.github.io' } as any;
const ctx = { waitUntil() {}, passThroughOnException() {} } as any;
const call = async (tk: string, method: string, path: string, body?: unknown) => {
  const r = await app.fetch(new Request(`http://localhost${path}`, { method, headers: { Authorization: `Bearer ${tk}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }), env, ctx);
  return { status: r.status, text: await r.text() };
};
const run = (sqls: string[]) => { for (const s of sqls) DB.sqlite.exec(s); };

const tp = token('uid-p'), tq = token('uid-q');
const pid = JSON.parse((await call(tp, 'POST', '/api/me', { alias: 'benchp' })).text).profile.id;
const qid = JSON.parse((await call(tq, 'POST', '/api/me', { alias: 'benchq' })).text).profile.id;
const req = JSON.parse((await call(tp, 'POST', '/api/friends/requests', { userId: qid })).text);
await call(tq, 'POST', `/api/friends/requests/${req.requestId}/accept`);
const synth = syntheticMembers('900000001-1', 14);
run(seedGroupStatements(synth, pid, '2026-12-01', 150, Date.now()));
const days = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => ({ day: new Date(Date.parse('2026-12-01') + i * 864e5).toISOString().slice(0, 10), status: f(i) }));
await call(tp, 'PUT', '/api/availability/me', { set: days(150, (i) => ['free', 'maybe', 'busy'][i % 3]) });
await call(tq, 'PUT', '/api/availability/me', { set: days(150, (i) => (i % 2 ? 'free' : 'maybe')) });
await call(tp, 'PUT', '/api/availability/shares', { friends: true, tripIds: [] });
await call(tq, 'PUT', '/api/availability/shares', { friends: true, tripIds: [] });
const trip = JSON.parse((await call(tp, 'POST', '/api/trips', { name: 'Prueba CPU' })).text).trip;
const inv = JSON.parse((await call(tp, "POST", `/api/trips/${trip.id}/invitations`, { userId: qid })).text).invitation;
if (inv?.id) await call(tq, 'POST', `/api/trips/invitations/${inv.id}/accept`);
run(seedTripStatements(synth, trip.id, Date.now()));

const path = `/api/availability/trip/${trip.id}?from=2026-12-01&to=2027-04-29&nights=2${process.env.QS ?? ""}`;
const N = Number(process.argv[2] ?? 300);
// MEMO=1: D1 devuelve lecturas guardadas (structuredClone), así la medida es el trabajo del Worker sin SQLite.
if (process.env.MEMO) DB.memo();
const t0 = performance.now(); const first = await call(tp, 'GET', path); const firstMs = performance.now() - t0;
const out = JSON.parse(first.text);
console.log(`estado ${first.status}, miembros ${out.members?.length}, compartidos ${out.requirement?.sharing}, bytes ${first.text.length}`);
const ts: number[] = [];
for (let i = 0; i < N; i++) { const s = performance.now(); await call(tp, 'GET', path); ts.push(performance.now() - s); }
ts.sort((a, b) => a - b);
const q = (p: number) => ts[Math.min(ts.length - 1, Math.floor(p * ts.length))].toFixed(2);
console.log(`1.ª ${firstMs.toFixed(2)} ms · repetidas (n=${N}) p50 ${q(0.5)} · p90 ${q(0.9)} · máx ${q(1)} ms (Node, ${process.env.MEMO ? "sin SQLite: lecturas guardadas" : "incluye SQLite"})`);
if (process.env.DUMP) (await import('node:fs')).writeFileSync(process.env.DUMP, first.text);
