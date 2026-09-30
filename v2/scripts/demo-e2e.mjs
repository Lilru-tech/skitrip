#!/usr/bin/env node
// Demostración de extremo a extremo con servicios locales oficiales:
//   Firebase Auth Emulator (firebase-tools) + Worker en workerd (wrangler dev) + D1 local.
// Recorrido: registro sin verificación → sesión → petición autenticada → fila en D1
//            → rechazo de acceso de otro usuario → recuperación de contraseña → logout.
// Uso: npm run demo:e2e   (arranca y detiene los servicios por sí mismo)
import { spawn, execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const AUTH = 'http://127.0.0.1:9099';
const API = 'http://localhost:8787';
const KEY = 'demo-api-key'; // el emulador acepta cualquier clave
const PROJECT = 'demo-skitrip';
const procs = [];

function start(cmd, args, name) {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } });
  p.stdout.on('data', (d) => process.env.DEBUG && process.stdout.write(`[${name}] ${d}`));
  p.stderr.on('data', (d) => process.env.DEBUG && process.stderr.write(`[${name}] ${d}`));
  procs.push(p);
  return p;
}
async function waitFor(url, label, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.status < 500) return; } catch { /* aún no */ }
    await sleep(500);
  }
  throw new Error(`${label} no arrancó`);
}
async function idt(path, body) {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/${path}?key=${KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path}: ${JSON.stringify(j)}`);
  return j;
}
async function api(token, method, path, body) {
  const r = await fetch(`${API}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
}

try {
  execSync('npx wrangler d1 migrations apply skitrip --local', { stdio: 'ignore' });
  start('npx', ['firebase', 'emulators:start', '--only', 'auth', '--project', PROJECT], 'auth');
  start('npx', ['wrangler', 'dev', '--local', '--port', '8787', '--var', 'AUTH_MODE:emulator', '--var', `FIREBASE_PROJECT_ID:${PROJECT}`], 'api');
  await waitFor(`${AUTH}/`, 'Auth emulator');
  await waitFor(`${API}/api/health`, 'Worker');
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  execSync(`npx wrangler d1 execute skitrip --local --command "DELETE FROM trip_members; DELETE FROM trips; DELETE FROM user_prefs; DELETE FROM rate_limits; DELETE FROM users;"`, { stdio: 'ignore' });

  // 1. Registro con email + contraseña, sin verificación.
  const ana = await idt('accounts:signUp', { email: 'ana@example.test', password: 'contraseña-segura-1', returnSecureToken: true });
  check('Alta en Firebase Auth (emulador) sin confirmar email', ana.idToken && ana.localId);
  const lookup = await idt('accounts:lookup', { idToken: ana.idToken });
  check('La cuenta queda con emailVerified=false', lookup.users[0].emailVerified === false);

  // 2. Sesión + perfil con alias.
  check('Sin alias, la API pide completarlo', (await api(ana.idToken, 'GET', '/api/me')).json?.needsAlias === true);
  const prof = await api(ana.idToken, 'POST', '/api/me', { alias: 'Ana' });
  check('Perfil creado en D1 con el alias', prof.status === 201, `id ${prof.json?.profile?.id}`);

  // 3. Petición autenticada que persiste en D1.
  const trip = await api(ana.idToken, 'POST', '/api/trips', { name: 'Demo Grandvalira', startDate: '2026-12-30', endDate: '2027-01-02', nights: 3 });
  check('Viaje creado vía API autenticada', trip.status === 201);
  const row = execSync(`npx wrangler d1 execute skitrip --local --json --command "SELECT name, owner_id FROM trips WHERE id = '${trip.json.trip.id}'"`).toString();
  check('La fila existe en D1 local', row.includes('Demo Grandvalira'));

  // 4. Otro usuario no puede acceder.
  const bruno = await idt('accounts:signUp', { email: 'bruno@example.test', password: 'otra-contraseña-2', returnSecureToken: true });
  await api(bruno.idToken, 'POST', '/api/me', { alias: 'Bruno' });
  const steal = await api(bruno.idToken, 'GET', `/api/trips/${trip.json.trip.id}`);
  check('Otro usuario recibe 404 al pedir el viaje ajeno', steal.status === 404);
  const edit = await api(bruno.idToken, 'PATCH', `/api/trips/${trip.json.trip.id}`, { name: 'x', version: 1 });
  check('Otro usuario no puede modificarlo', edit.status === 404);

  // 5. Sin token. (La firma solo existe en modo producción: sus rechazos se prueban en test/worker/auth.test.ts.)
  check('Sin token: 401', (await api(null, 'GET', '/api/trips')).status === 401);

  // 6. Recuperación de contraseña (el emulador expone el código que iría por correo).
  await idt('accounts:sendOobCode', { requestType: 'PASSWORD_RESET', email: 'ana@example.test' });
  const codes = await (await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/oobCodes`)).json();
  const oob = codes.oobCodes.find((c) => c.email === 'ana@example.test' && c.requestType === 'PASSWORD_RESET');
  await idt('accounts:resetPassword', { oobCode: oob.oobCode, newPassword: 'nueva-contraseña-3' });
  const relog = await idt('accounts:signInWithPassword', { email: 'ana@example.test', password: 'nueva-contraseña-3', returnSecureToken: true });
  check('Recuperación de contraseña y nuevo login', !!relog.idToken);
  check('La nueva sesión sigue viendo su viaje', (await api(relog.idToken, 'GET', `/api/trips/${trip.json.trip.id}`)).status === 200);
  let oldPwdFails = false;
  try { await idt('accounts:signInWithPassword', { email: 'ana@example.test', password: 'contraseña-segura-1', returnSecureToken: true }); } catch { oldPwdFails = true; }
  check('La contraseña antigua ya no sirve', oldPwdFails);
} catch (e) {
  console.error('Error en la demo:', e.message);
  results.push({ name: 'ejecución', ok: false });
} finally {
  for (const p of procs) p.kill('SIGINT');
  await sleep(1000);
  for (const p of procs) if (!p.killed) p.kill('SIGKILL');
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} comprobaciones correctas (servicios locales; nada desplegado).`);
process.exit(failed ? 1 : 0);
