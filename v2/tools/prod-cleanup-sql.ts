// Limpieza de los datos de una prueba de producción, por identidades EXACTAS que registró la propia ejecución.
//
// No es un endpoint: lo ejecuta un workflow con el token de Cloudflare (wrangler d1 execute --remote) o un test local.
// Solo selecciona perfiles que cumplen TODO a la vez:
//   - correo en la lista del manifiesto y con la forma exacta prod-check-<ejecución>-<letra>@example.com de ESA ejecución;
//   - si el manifiesto trae UIDs de Firebase, también el UID;
//   - rol 'user' (nunca un administrador).
// Antes de borrar, `blockingQuery` busca viajes de esos perfiles que tengan miembros o propietarios ajenos a la prueba:
// si hay alguno, no se borra nada (serían datos reales). Cada sentencia toca solo datos de la prueba, así que si la
// ejecución se corta a mitad lo que queda es residuo de la prueba y repetirla completa la limpieza. Si un dato ajeno
// siguiera apuntando a un perfil de prueba (p. ej. un gasto en un viaje real que abandonó), la clave ajena impide borrar
// el perfil y la herramienta lo informa en vez de forzarlo.

export interface CleanupManifest {
  runId: string;                        // p. ej. «37124136929» o «37124136929-2» (id de ejecución y reintento)
  users: { email: string; uid?: string }[];
}

const RUN_ID = /^[0-9]{6,15}(-[0-9]{1,3})?$/;
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Correo de prueba de una ejecución: el único formato que la limpieza acepta. */
export const testEmail = (runId: string, k: string) => `prod-check-${runId}-${k}@example.com`;

export function validateManifest(m: CleanupManifest): string[] {
  const errors: string[] = [];
  if (!RUN_ID.test(m.runId ?? '')) errors.push(`runId no válido: «${m.runId}»`);
  if (!Array.isArray(m.users) || m.users.length === 0) errors.push('el manifiesto no tiene usuarios');
  for (const u of m.users ?? []) {
    const ok = new RegExp(`^prod-check-${m.runId.replace(/-/g, '\\-')}-[a-z]@example\\.com$`).test(u.email ?? '');
    if (!ok) errors.push(`correo fuera del formato de la ejecución ${m.runId}: «${u.email}»`);
    if (u.uid != null && !/^[A-Za-z0-9_-]{6,128}$/.test(u.uid)) errors.push(`UID no válido: «${u.uid}»`);
  }
  return errors;
}

/** Subconsulta con los ids de perfil seleccionados (todas las condiciones a la vez). */
export function selectedUsers(m: CleanupManifest): string {
  const errors = validateManifest(m);
  if (errors.length) throw new Error(errors.join('; '));
  const emails = m.users.map((u) => q(u.email)).join(', ');
  const uids = m.users.filter((u) => u.uid).map((u) => q(u.uid!));
  const uidCond = uids.length === m.users.length ? ` AND firebase_uid IN (${uids.join(', ')})` : '';
  return `SELECT id FROM users WHERE email IN (${emails}) AND email GLOB 'prod-check-*@example.com' AND role = 'user'${uidCond}`;
}

/** Filas que impiden limpiar: viajes de la prueba con alguien de fuera de la prueba. Debe devolver 0 filas. */
export function blockingQuery(m: CleanupManifest): string {
  const T = selectedUsers(m);
  return `SELECT t.id AS trip_id FROM trips t WHERE (t.owner_id IN (${T}) OR t.id IN (SELECT trip_id FROM trip_members WHERE user_id IN (${T})))
    AND (t.owner_id NOT IN (${T}) OR EXISTS (SELECT 1 FROM trip_members m WHERE m.trip_id = t.id AND m.user_id NOT IN (${T})))`;
}

/**
 * Sentencias en orden (las claves ajenas están activas en D1). Idempotentes: repetirlas no cambia nada.
 * Los viajes van primero: al borrarlos caen en cascada miembros, invitaciones, propuestas, comentarios del viaje,
 * candidaturas, presupuesto, listas, gastos y liquidaciones. Después lo que cuelga del perfil sin cascada y, al final,
 * el perfil (con cascada sobre preferencias, amistades, solicitudes, bloqueos, disponibilidad, permisos y avisos).
 */
export function cleanupStatements(m: CleanupManifest): string[] {
  const T = selectedUsers(m);
  return [
    // Historial de gastos sin clave ajena al viaje: se borra el de los viajes de la prueba y el de sus actores.
    `DELETE FROM expense_history WHERE trip_id IN (SELECT id FROM trips WHERE owner_id IN (${T})) OR actor_id IN (${T})`,
    `DELETE FROM trips WHERE owner_id IN (${T})`,
    `DELETE FROM comments WHERE author_id IN (${T})`,
    `DELETE FROM receipts WHERE owner_id IN (${T})`,
    `DELETE FROM price_observations WHERE owner_id IN (${T})`,
    `DELETE FROM audit_log WHERE actor_id IN (${T})`,
    // Referencias informativas en datos compartidos: se desvinculan, no se borran.
    `UPDATE products SET created_by = NULL WHERE created_by IN (${T})`,
    `UPDATE search_scenarios SET created_by = NULL WHERE created_by IN (${T})`,
    `UPDATE hotel_provider_ids SET verified_by = NULL WHERE verified_by IN (${T})`,
    `UPDATE legacy_comments SET reconciled_user_id = NULL WHERE reconciled_user_id IN (${T})`,
    `UPDATE legacy_comments SET reconciled_by = NULL WHERE reconciled_by IN (${T})`,
    `UPDATE legacy_availability SET reconciled_user_id = NULL WHERE reconciled_user_id IN (${T})`,
    `DELETE FROM users WHERE id IN (${T})`,
  ];
}

/** Recuento de lo que quedaría de la prueba (debe ser 0 tras limpiar). */
export function remainingQuery(m: CleanupManifest): string {
  return `SELECT COUNT(*) AS n FROM users WHERE email IN (${m.users.map((u) => q(u.email)).join(', ')})`;
}

/** Perfiles que la limpieza seleccionaría (debe ser 0 tras limpiar). */
export function selectedCountQuery(m: CleanupManifest): string {
  return `SELECT COUNT(*) AS n FROM (${selectedUsers(m)})`;
}
