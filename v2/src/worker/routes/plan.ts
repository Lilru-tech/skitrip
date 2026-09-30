import { Hono } from 'hono';
import { z } from 'zod';
import { offerPanel, searchDistribution, type PricePoint } from '../../core/analytics';
import { computeBudget, type BudgetInput } from '../../core/budget';
import { dateSearchAvailable } from '../../core/capabilities';
import { daysBetween, todayMadrid } from '../../core/dates';
import type { AppEnv } from '../env';
import { requireTripEditor, requireTripMember } from '../access';
import { sha256Hex } from '../crypto';
import { ApiError, conflict, forbidden, newId, notFound, now, parseBody } from '../http';
import { rateLimit } from '../ratelimit';
import { estimateList } from './shopping';
import { zCents, zDate, zId } from '../schemas';

// Escenarios de búsqueda, ofertas, candidaturas con votos y presupuesto del viaje.
export const planRoutes = new Hono<AppEnv>();

const MAX_SCENARIOS_PER_TRIP = 4;
const MAX_ACTIVE_SCENARIOS = 40;
const zUnit = z.enum(['per_person', 'per_room', 'per_night', 'per_person_night', 'per_stay', 'unknown']);

// ---------- Escenarios ----------

planRoutes.post('/:id/scenarios', async (c) => {
  const me = c.get('user').id;
  const tripId = c.req.param('id');
  await requireTripEditor(c.env.DB, tripId, me);
  const b = await parseBody(c, z.object({
    providerId: z.enum(['esquiades', 'estiber']),
    areaId: zId,
    modality: z.enum(['lodging', 'lodging_forfait']),
    checkIn: zDate, checkOut: zDate,
    adults: z.number().int().min(1).max(30),
    childrenAges: z.array(z.number().int().min(0).max(17)).max(10).default([]),
    rooms: z.number().int().min(1).max(15).nullable().default(null),
    forfaitDays: z.number().int().min(0).max(14).nullable().default(null),
  }));
  const nights = daysBetween(b.checkIn, b.checkOut);
  if (nights < 1 || nights > 14) throw new ApiError(422, 'validation', 'La estancia debe tener entre 1 y 14 noches.');
  const today = todayMadrid();
  if (b.checkIn < today || daysBetween(today, b.checkIn) > 240) throw new ApiError(422, 'validation', 'La fecha de entrada debe estar entre hoy y los próximos 8 meses.');
  if (b.modality === 'lodging_forfait' && !b.forfaitDays) throw new ApiError(422, 'validation', 'Indica los días de forfait del paquete.');
  if (b.modality === 'lodging' && b.forfaitDays) throw new ApiError(422, 'validation', 'La modalidad «solo alojamiento» no lleva forfait.');
  const area = await c.env.DB.prepare('SELECT id FROM areas WHERE id = ?1').bind(b.areaId).first();
  if (!area) throw notFound('Estación');
  await rateLimit(c.env.DB, `scenario:${me}`, 20, 86400);

  const key = await sha256Hex(JSON.stringify([b.providerId, b.areaId, b.modality, b.checkIn, b.checkOut, b.adults, [...b.childrenAges].sort(), b.rooms, b.forfaitDays ?? 0]));
  const linked = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM trip_scenarios WHERE trip_id = ?1').bind(tripId).first<{ n: number }>();
  if ((linked?.n ?? 0) >= MAX_SCENARIOS_PER_TRIP) throw new ApiError(422, 'limit', `Máximo ${MAX_SCENARIOS_PER_TRIP} búsquedas por viaje.`);
  let sc = await c.env.DB.prepare('SELECT id, active FROM search_scenarios WHERE scenario_key = ?1').bind(key).first<{ id: string; active: number }>();
  const reused = !!sc;
  if (!sc) {
    const active = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM search_scenarios WHERE active = 1').first<{ n: number }>();
    if ((active?.n ?? 0) >= MAX_ACTIVE_SCENARIOS) throw new ApiError(503, 'limit', 'Se ha alcanzado el máximo de búsquedas activas para mantener el coste en 0 €. Libera alguna o espera.');
    const id = newId();
    await c.env.DB.prepare(
      `INSERT INTO search_scenarios (id, provider_id, area_id, modality, check_in, check_out, nights, adults, children_ages, rooms, forfait_days, scenario_key, created_by, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
    ).bind(id, b.providerId, b.areaId, b.modality, b.checkIn, b.checkOut, nights, b.adults, JSON.stringify(b.childrenAges), b.rooms, b.modality === 'lodging' ? null : b.forfaitDays, key, me, now()).run();
    sc = { id, active: 1 };
  } else if (!sc.active) {
    await c.env.DB.prepare('UPDATE search_scenarios SET active = 1 WHERE id = ?1').bind(sc.id).run();
  }
  await c.env.DB.prepare('INSERT OR IGNORE INTO trip_scenarios (trip_id, scenario_id) VALUES (?1, ?2)').bind(tripId, sc.id).run();
  // Se informa de la capacidad real: sin adaptador, la búsqueda queda registrada pero no se ejecutará sola.
  return c.json({ scenarioId: sc.id, reused, dateSearch: dateSearchAvailable(b.providerId, b.modality) ? 'automatic' : 'not_implemented',
    note: dateSearchAvailable(b.providerId, b.modality) ? null : 'La búsqueda automática por fechas no está implementada para este proveedor: consulta con el enlace y guarda la cotización a mano.' }, 201);
});

planRoutes.delete('/:id/scenarios/:sid', async (c) => {
  const tripId = c.req.param('id');
  await requireTripEditor(c.env.DB, tripId, c.get('user').id);
  await c.env.DB.prepare('DELETE FROM trip_scenarios WHERE trip_id = ?1 AND scenario_id = ?2').bind(tripId, c.req.param('sid')).run();
  // Sin viajes que la usen, la búsqueda deja de ejecutarse (el histórico se conserva).
  await c.env.DB.prepare('UPDATE search_scenarios SET active = 0 WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM trip_scenarios WHERE scenario_id = ?1)').bind(c.req.param('sid')).run();
  return c.json({ ok: true });
});

planRoutes.get('/:id/scenarios', async (c) => {
  const tripId = c.req.param('id');
  await requireTripMember(c.env.DB, tripId, c.get('user').id);
  const db = c.env.DB;
  const { results: scenarios } = await db.prepare(
    `SELECT s.* FROM search_scenarios s JOIN trip_scenarios ts ON ts.scenario_id = s.id WHERE ts.trip_id = ?1 ORDER BY s.check_in`,
  ).bind(tripId).all<any>();
  const out = [];
  for (const s of scenarios) {
    const { results: runs } = await db.prepare('SELECT observed_at, outcome, offers_found, error FROM scenario_runs WHERE scenario_id = ?1 ORDER BY observed_at DESC LIMIT 2').bind(s.id).all<any>();
    const { results: obs } = await db.prepare(
      `SELECT o.id AS offer_id, o.hotel_name_raw, o.board, o.cancellation, o.nights, o.forfait_days, o.adults, o.url, ob.observed_at, ob.amount_cents, ob.unit, ob.price_kind, ob.availability
       FROM offer_observations ob JOIN offers o ON o.id = ob.offer_id WHERE ob.scenario_id = ?1 AND ob.observed_at >= ?2 ORDER BY ob.observed_at`,
    ).bind(s.id, Date.now() - 120 * 86400_000).all<any>();
    const byOffer = new Map<string, any[]>();
    for (const o of obs) (byOffer.get(o.offer_id) ?? byOffer.set(o.offer_id, []).get(o.offer_id)!).push(o);
    const lastRun = runs[0]?.observed_at;
    const prevRun = runs[1]?.observed_at;
    const offers = [...byOffer.values()].map((pts) => {
      const o = pts.at(-1);
      const panel = offerPanel(pts.map((p): PricePoint => ({ observedAt: p.observed_at, amountCents: p.amount_cents, priceKind: p.price_kind, unit: p.unit, availability: p.availability })));
      // No observada en la última búsqueda ≠ agotada: se indica tal cual.
      const seenInLastRun = lastRun != null && pts.some((p) => p.observed_at === lastRun);
      return { offerId: o.offer_id, hotelName: o.hotel_name_raw, board: o.board, cancellation: o.cancellation, nights: o.nights, forfaitDays: o.forfait_days, adults: o.adults, url: o.url,
        availability: seenInLastRun ? o.availability : 'not_observed', panel };
    });
    const current = offers.filter((o) => o.availability !== 'not_observed')
      .map((o) => ({ offerId: o.offerId, amountCents: o.panel.lastValid?.amountCents ?? null, unit: o.panel.lastValid?.unit, priceKind: o.panel.lastValid?.priceKind }));
    const previous = prevRun ? [...byOffer.entries()].filter(([, pts]) => pts.some((p) => p.observed_at === prevRun)).map(([id, pts]) => {
      const p = pts.find((x) => x.observed_at === prevRun)!;
      return { offerId: id, amountCents: p.amount_cents, unit: p.unit, priceKind: p.price_kind };
    }) : undefined;
    out.push({
      id: s.id, providerId: s.provider_id, areaId: s.area_id, modality: s.modality, checkIn: s.check_in, checkOut: s.check_out, nights: s.nights, adults: s.adults,
      childrenAges: JSON.parse(s.children_ages), rooms: s.rooms, forfaitDays: s.forfait_days, active: !!s.active, lastRun: runs[0] ?? null,
      offers, distribution: searchDistribution(current, previous),
    });
  }
  return c.json({ scenarios: out, note: 'Precios capturados por los recolectores. Una oferta que no aparece en la última búsqueda se marca «no observada», no «agotada».' });
});

// ---------- Candidaturas y votos ----------

const zCandidate = z.object({
  title: z.string().trim().min(1).max(160),
  offerId: zId.nullable().optional(),
  areaId: zId.nullable().optional(),
  modality: z.enum(['lodging', 'lodging_forfait']),
  url: z.string().url().max(500).refine((u) => /^https?:\/\//.test(u), 'URL http(s)').nullable().optional(),
  amountCents: zCents.nullable().optional(),
  unit: zUnit.nullable().optional(),
  priceKind: z.enum(['advertised_from', 'quoted_for_search', 'manual_estimate', 'user_quote']).nullable().optional(),
  checkIn: zDate.nullable().optional(),
  checkOut: zDate.nullable().optional(),
  people: z.number().int().min(1).max(60).nullable().optional(),
  // Condiciones exactas de la cotización (null = no consta). No se deducen de lo que se pidió.
  adults: z.number().int().min(1).max(60).nullable().optional(),
  childrenAges: z.array(z.number().int().min(0).max(17)).max(20).nullable().optional(),
  rooms: z.number().int().min(1).max(30).nullable().optional(),
  forfaitIncluded: z.enum(['yes', 'no', 'unknown']).optional(),
  forfaitDays: z.number().int().min(0).max(30).nullable().optional(),
  conditions: z.string().max(1000).nullable().optional(),
  pendingNotes: z.string().max(1000).nullable().optional(),
});

planRoutes.get('/:id/candidates', async (c) => {
  const me = c.get('user').id;
  const tripId = c.req.param('id');
  await requireTripMember(c.env.DB, tripId, me);
  const { results } = await c.env.DB.prepare(
    `SELECT tc.*, u.alias AS proposed_by_alias,
            COALESCE((SELECT SUM(value) FROM candidate_votes v WHERE v.candidate_id = tc.id), 0) AS score,
            (SELECT COUNT(*) FROM candidate_votes v WHERE v.candidate_id = tc.id AND v.value = 1) AS up,
            (SELECT COUNT(*) FROM candidate_votes v WHERE v.candidate_id = tc.id AND v.value = -1) AS down,
            (SELECT value FROM candidate_votes v WHERE v.candidate_id = tc.id AND v.user_id = ?2) AS my_vote
     FROM trip_candidates tc JOIN users u ON u.id = tc.proposed_by WHERE tc.trip_id = ?1 ORDER BY tc.status = 'discarded', score DESC, tc.created_at`,
  ).bind(tripId, me).all();
  return c.json({ candidates: results, note: 'Votar no es reservar. El estado «reservado» solo lo marca quien hizo la reserva.' });
});

planRoutes.post('/:id/candidates', async (c) => {
  const me = c.get('user').id;
  const tripId = c.req.param('id');
  await requireTripMember(c.env.DB, tripId, me);
  const b = await parseBody(c, zCandidate);
  await rateLimit(c.env.DB, `candidate:${me}`, 60, 86400);
  let fromOffer: any = null;
  if (b.offerId) {
    // Condiciones de la oferta: las declaradas por la tarjeta; las del escenario solo si la tarjeta las verificó.
    fromOffer = await c.env.DB.prepare(
      `SELECT o.*, ob.amount_cents, ob.unit, ob.price_kind,
              s.check_in AS sc_check_in, s.check_out AS sc_check_out, s.adults AS sc_adults, s.children_ages AS sc_children, s.rooms AS sc_rooms, s.forfait_days AS sc_forfait
       FROM offers o LEFT JOIN offer_observations ob ON ob.offer_id = o.id LEFT JOIN search_scenarios s ON s.id = o.scenario_id
       WHERE o.id = ?1 ORDER BY ob.observed_at DESC LIMIT 1`,
    ).bind(b.offerId).first();
    if (!fromOffer) throw notFound('Oferta');
    if (fromOffer.conditions_verified) {
      fromOffer.check_in ??= fromOffer.sc_check_in; fromOffer.check_out ??= fromOffer.sc_check_out; fromOffer.adults ??= fromOffer.sc_adults;
      fromOffer.children_ages ??= fromOffer.sc_children; fromOffer.rooms ??= fromOffer.sc_rooms;
    }
  }
  const kids = b.childrenAges !== undefined ? (b.childrenAges ? JSON.stringify(b.childrenAges) : null) : fromOffer?.children_ages ?? null;
  const adults = b.adults ?? fromOffer?.adults ?? null;
  const id = newId();
  const t = now();
  await c.env.DB.prepare(
    `INSERT INTO trip_candidates (id, trip_id, offer_id, title, area_id, modality, url, amount_cents, unit, price_kind, check_in, check_out, people, forfait_days, conditions,
       pending_notes, proposed_by, created_at, updated_at, adults, children_ages, rooms, forfait_included)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?18, ?19, ?20, ?21, ?22)`,
  ).bind(id, tripId, b.offerId ?? null, b.title, b.areaId ?? fromOffer?.area_id ?? null, b.modality, b.url ?? fromOffer?.url ?? null,
    b.amountCents ?? fromOffer?.amount_cents ?? null, b.unit ?? fromOffer?.unit ?? null, b.priceKind ?? fromOffer?.price_kind ?? (b.amountCents != null ? 'user_quote' : null),
    b.checkIn ?? fromOffer?.check_in ?? null, b.checkOut ?? fromOffer?.check_out ?? null,
    b.people ?? (adults != null ? adults + (kids ? JSON.parse(kids).length : 0) : null), b.forfaitDays ?? fromOffer?.forfait_days ?? null,
    b.conditions ?? null, b.pendingNotes ?? null, me, t, adults, kids, b.rooms ?? fromOffer?.rooms ?? null,
    b.forfaitIncluded ?? fromOffer?.forfait_included ?? (b.modality === 'lodging_forfait' ? 'yes' : 'unknown')).run();
  return c.json({ id }, 201);
});

planRoutes.patch('/:id/candidates/:cid', async (c) => {
  const me = c.get('user').id;
  const tripId = c.req.param('id');
  const role = await requireTripMember(c.env.DB, tripId, me);
  const cand = await c.env.DB.prepare('SELECT proposed_by, version FROM trip_candidates WHERE id = ?1 AND trip_id = ?2').bind(c.req.param('cid'), tripId).first<{ proposed_by: string }>();
  if (!cand) throw notFound('Candidatura');
  const b = await parseBody(c, zCandidate.partial().extend({ version: z.number().int().positive(), status: z.enum(['proposed', 'chosen', 'booked', 'discarded']).optional() }));
  if (cand.proposed_by !== me && role === 'member') throw forbidden('Solo quien la propuso o un editor puede modificarla.');
  if ((b.status === 'chosen' || b.status === 'booked') && role === 'member') throw forbidden('Elegir o marcar como reservada corresponde al propietario o a un editor.');
  const map: Record<string, string> = { title: 'title', url: 'url', amountCents: 'amount_cents', unit: 'unit', priceKind: 'price_kind', checkIn: 'check_in', checkOut: 'check_out',
    people: 'people', forfaitDays: 'forfait_days', conditions: 'conditions', pendingNotes: 'pending_notes', status: 'status', modality: 'modality', areaId: 'area_id',
    adults: 'adults', childrenAges: 'children_ages', rooms: 'rooms', forfaitIncluded: 'forfait_included' };
  const sets: string[] = []; const args: unknown[] = [];
  for (const [k, col] of Object.entries(map)) if ((b as any)[k] !== undefined) {
    sets.push(`${col} = ?`);
    args.push(k === 'childrenAges' && (b as any)[k] != null ? JSON.stringify((b as any)[k]) : (b as any)[k]);
  }
  if (!sets.length) return c.json({ ok: true });
  const r = await c.env.DB.prepare(`UPDATE trip_candidates SET ${sets.join(', ')}, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`).bind(...args, now(), c.req.param('cid'), b.version).run();
  if (!r.meta.changes) throw conflict('La candidatura cambió mientras editabas. Recarga para ver la última versión.', 'version_conflict');
  return c.json({ ok: true });
});

planRoutes.delete('/:id/candidates/:cid', async (c) => {
  const me = c.get('user').id;
  const tripId = c.req.param('id');
  const role = await requireTripMember(c.env.DB, tripId, me);
  const cand = await c.env.DB.prepare('SELECT proposed_by FROM trip_candidates WHERE id = ?1 AND trip_id = ?2').bind(c.req.param('cid'), tripId).first<{ proposed_by: string }>();
  if (!cand) throw notFound('Candidatura');
  if (cand.proposed_by !== me && role === 'member') throw forbidden();
  await c.env.DB.prepare('DELETE FROM trip_candidates WHERE id = ?1').bind(c.req.param('cid')).run();
  return c.json({ ok: true });
});

// Un voto por persona y candidatura; se puede cambiar o retirar.
planRoutes.put('/:id/candidates/:cid/vote', async (c) => {
  const me = c.get('user').id;
  const tripId = c.req.param('id');
  await requireTripMember(c.env.DB, tripId, me);
  const { value } = await parseBody(c, z.object({ value: z.union([z.literal(1), z.literal(-1), z.null()]) }));
  const cand = await c.env.DB.prepare('SELECT id FROM trip_candidates WHERE id = ?1 AND trip_id = ?2').bind(c.req.param('cid'), tripId).first();
  if (!cand) throw notFound('Candidatura');
  if (value === null) await c.env.DB.prepare('DELETE FROM candidate_votes WHERE candidate_id = ?1 AND user_id = ?2').bind(c.req.param('cid'), me).run();
  else await c.env.DB.prepare(`INSERT INTO candidate_votes (candidate_id, user_id, value, updated_at) VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT (candidate_id, user_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(c.req.param('cid'), me, value, now()).run();
  return c.json({ ok: true });
});

// ---------- Presupuesto ----------

const zBudget = z.object({
  fuelCentsPerLitre: zCents.nullable().optional(),
  litresPer100kmX10: z.number().int().min(10).max(300).nullable().optional(),
  tollsCentsPerCar: zCents.nullable().optional(),
  parkingCentsPerCar: zCents.nullable().optional(),
  forfaitCentsPerDay: zCents.nullable().optional(),
  rentalCentsPerDay: zCents.nullable().optional(),
  skiers: z.number().int().min(0).max(60).nullable().optional(),
  renters: z.number().int().min(0).max(60).nullable().optional(),
  groceriesCents: zCents.nullable().optional(),
  chosenCandidateId: zId.nullable().optional(),
});
const BCOLS: Record<string, string> = { fuelCentsPerLitre: 'fuel_cents_per_litre', litresPer100kmX10: 'litres_per_100km_x10', tollsCentsPerCar: 'tolls_cents_per_car',
  parkingCentsPerCar: 'parking_cents_per_car', forfaitCentsPerDay: 'forfait_cents_per_day', rentalCentsPerDay: 'rental_cents_per_day', skiers: 'skiers', renters: 'renters',
  groceriesCents: 'groceries_cents', chosenCandidateId: 'chosen_candidate_id' };

async function budgetFor(db: D1Database, tripId: string) {
  const t = await db.prepare('SELECT * FROM trips WHERE id = ?1').bind(tripId).first<any>();
  let b = await db.prepare('SELECT * FROM trip_budget WHERE trip_id = ?1').bind(tripId).first<any>();
  if (!b) {
    await db.prepare('INSERT OR IGNORE INTO trip_budget (trip_id, updated_at) VALUES (?1, ?2)').bind(tripId, now()).run();
    b = await db.prepare('SELECT * FROM trip_budget WHERE trip_id = ?1').bind(tripId).first<any>();
  }
  const members = await db.prepare('SELECT COUNT(*) AS n FROM trip_members WHERE trip_id = ?1').bind(tripId).first<{ n: number }>();
  const route = t.area_id ? await db.prepare('SELECT road_km, source, validated, notes FROM routes WHERE origin_id = ?1 AND area_id = ?2').bind(t.origin_id ?? 'tarragona', t.area_id).first<any>() : null;
  const cand = b.chosen_candidate_id ? await db.prepare('SELECT * FROM trip_candidates WHERE id = ?1 AND trip_id = ?2').bind(b.chosen_candidate_id, tripId).first<any>() : null;
  const shopping = await estimateList(db, tripId);
  const people = t.participants_planned ?? members?.n ?? null;
  const tripKids: number[] = JSON.parse(t.children_ages || '[]');
  const groceries = b.groceries_cents ?? (shopping.complete ? shopping.knownCents : null);
  const input: BudgetInput = {
    people, skiers: b.skiers ?? people, renters: b.renters, nights: t.nights, skiDays: t.ski_days, cars: t.cars,
    roadKmOneWay: route?.road_km ?? null, fuelCentsPerLitre: b.fuel_cents_per_litre, litresPer100km: b.litres_per_100km_x10 != null ? b.litres_per_100km_x10 / 10 : null,
    tollsCentsPerCar: b.tolls_cents_per_car, parkingCentsPerCar: b.parking_cents_per_car,
    trip: { startDate: t.start_date, endDate: t.end_date, areaId: t.area_id, rooms: t.rooms, childrenAges: tripKids,
      adults: people != null ? people - tripKids.length : null },
    lodging: cand ? { modality: cand.modality, forfaitIncluded: cand.forfait_included, amountCents: cand.amount_cents, unit: cand.unit ?? 'unknown', priceKind: cand.price_kind,
      checkIn: cand.check_in, checkOut: cand.check_out, adults: cand.adults, childrenAges: cand.children_ages ? JSON.parse(cand.children_ages) : null, rooms: cand.rooms,
      areaId: cand.area_id, forfaitDays: cand.forfait_days } : null,
    forfaitCentsPerDay: b.forfait_cents_per_day, rentalCentsPerDay: b.rental_cents_per_day, groceriesCents: groceries,
  };
  const result = computeBudget(input);
  if (route && !route.validated) result.warnings.push(`Distancia por carretera sin validar (${route.source})${route.notes ? `: ${route.notes}` : '.'}`);
  if (b.groceries_cents == null && shopping.unpriced) result.warnings.push(`La lista de compra tiene ${shopping.unpriced} artículo(s) sin precio: la compra queda pendiente.`);
  return { params: b, input, result };
}

planRoutes.get('/:id/budget', async (c) => {
  const tripId = c.req.param('id');
  await requireTripMember(c.env.DB, tripId, c.get('user').id);
  return c.json(await budgetFor(c.env.DB, tripId));
});

planRoutes.put('/:id/budget', async (c) => {
  const tripId = c.req.param('id');
  await requireTripEditor(c.env.DB, tripId, c.get('user').id);
  const b = await parseBody(c, zBudget.extend({ version: z.number().int().positive() }));
  await budgetFor(c.env.DB, tripId); // asegura la fila
  if (b.chosenCandidateId) {
    const ok = await c.env.DB.prepare('SELECT 1 FROM trip_candidates WHERE id = ?1 AND trip_id = ?2').bind(b.chosenCandidateId, tripId).first();
    if (!ok) throw notFound('Candidatura');
  }
  const sets: string[] = []; const args: unknown[] = [];
  for (const [k, col] of Object.entries(BCOLS)) if ((b as any)[k] !== undefined) { sets.push(`${col} = ?`); args.push((b as any)[k]); }
  if (sets.length) {
    const r = await c.env.DB.prepare(`UPDATE trip_budget SET ${sets.join(', ')}, version = version + 1, updated_at = ? WHERE trip_id = ? AND version = ?`).bind(...args, now(), tripId, b.version).run();
    if (!r.meta.changes) throw conflict('El presupuesto cambió mientras editabas. Recarga para ver la última versión.', 'version_conflict');
  }
  return c.json(await budgetFor(c.env.DB, tripId));
});
