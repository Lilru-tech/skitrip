// Grupo representativo (10–20 personas) para «v2 · medir CPU» sin abrir 16 cuentas de Firebase: las altas por IP
// están limitadas a 5 por hora (routes/me.ts), así que la medición usa dos cuentas reales (p, q: autenticación, alta,
// amistad e invitación por la API) y hasta 14 miembros SINTÉTICOS creados en D1 con la misma forma que deja la API.
// Las rutas medidas leen sus filas exactamente igual que las de personas reales.
//
// Los sintéticos usan el formato de correo de la limpieza (prod-check-<ejecución>-<letra>@example.com), un UID propio
// y rol 'user', así que tools/prod-cleanup.ts los borra por identidad exacta con el resto de la ejecución.
import { testEmail } from './prod-cleanup-sql';

export interface SyntheticMember { id: string; uid: string; email: string; alias: string }

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const LETTERS = 'abcdefghijklmn'; // p y q son las cuentas reales

export function syntheticMembers(runId: string, n: number): SyntheticMember[] {
  if (!Number.isInteger(n) || n < 0 || n > LETTERS.length) throw new Error(`miembros sintéticos: entre 0 y ${LETTERS.length}`);
  const digits = runId.replace(/\D/g, '').slice(-8);
  return [...LETTERS].slice(0, n).map((k) => ({ id: `pcs-${runId}-${k}`, uid: `pcsynth-${runId}-${k}`, email: testEmail(runId, k), alias: `pc${digits}${k}s` }));
}

/** Perfiles, amistad con `ownerId`, `days` días de disponibilidad desde `from` y permiso de verla a los amigos. */
export function seedGroupStatements(members: SyntheticMember[], ownerId: string, from: string, days: number, t: number): string[] {
  if (!members.length) return [];
  const ids = JSON.stringify(members.map((m) => m.id));
  return [
    `INSERT INTO users (id, firebase_uid, alias, alias_norm, email, role, status, created_at, updated_at) VALUES ${members
      .map((m) => `(${q(m.id)}, ${q(m.uid)}, ${q(m.alias)}, ${q(m.alias.toLowerCase())}, ${q(m.email)}, 'user', 'active', ${t}, ${t})`).join(', ')}`,
    `INSERT INTO friendships (user_a, user_b, created_at) SELECT MIN(value, ${q(ownerId)}), MAX(value, ${q(ownerId)}), ${t} FROM json_each(${q(ids)})`,
    // Patrón variado por persona (libre, quizá, ocupado, sin indicar), como un calendario real a medio rellenar.
    `INSERT INTO availability (user_id, day, status, updated_at)
     WITH RECURSIVE d(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM d WHERE i < ${days - 1})
     SELECT m.value, date(${q(from)}, '+' || d.i || ' days'),
            CASE (d.i + m.key * 3) % 7 WHEN 0 THEN 'busy' WHEN 1 THEN 'maybe' WHEN 2 THEN 'busy' ELSE 'free' END, ${t}
     FROM d, json_each(${q(ids)}) m WHERE (d.i + m.key) % 11 <> 0`,
    `INSERT INTO availability_shares (id, owner_id, scope, created_at) SELECT 'pcs-share-' || value, value, 'friends', ${t} FROM json_each(${q(ids)})`,
  ];
}

/** Los sintéticos como miembros del viaje de la prueba (lo que dejaría aceptar una invitación). */
export function seedTripStatements(members: SyntheticMember[], tripId: string, t: number): string[] {
  if (!members.length) return [];
  return [`INSERT INTO trip_members (trip_id, user_id, role, joined_at) SELECT ${q(tripId)}, value, 'member', ${t} FROM json_each(${q(JSON.stringify(members.map((m) => m.id)))})`];
}
