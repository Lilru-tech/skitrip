import { Hono } from 'hono';
import { z } from 'zod';
import { offerPanel, searchDistribution, type PricePoint } from '../../core/analytics';
import { candidateScenario, computeBudget, resolveDestinationCosts, type BudgetInput, type DestinationCostRow } from '../../core/budget';
import { dateSearchAvailable, dateSearchNote } from '../../core/capabilities';
import { daysBetween, todayMadrid } from '../../core/dates';
import type { AppEnv } from '../env';
import { requireTripEditor, requireTripMember } from '../access';
import { sha256Hex } from '../crypto';
import { ApiError, conflict, forbidden, newId, notFound, now, parseBody } from '../http';
import { rateLimit } from '../ratelimit';
import { estimateList } from './shopping';
import { rankCosts } from '../../core/compare';
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
    note: dateSearchAvailable(b.providerId, b.modality) ? null : dateSearchNote(b.providerId, b.modality) }, 201);
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
  // Consultas fijas para todos los escenarios del viaje (antes, 2 por escenario).
  const ids = JSON.stringify(scenarios.map((s) => s.id));
  const [{ results: allRuns }, { results: allObs }] = await db.batch([
    db.prepare(`SELECT scenario_id, observed_at, outcome, offers_found, error FROM (SELECT r.*, ROW_NUMBER() OVER (PARTITION BY scenario_id ORDER BY observed_at DESC) AS rn
                FROM scenario_runs r WHERE scenario_id IN (SELECT value FROM json_each(?1))) WHERE rn <= 2 ORDER BY observed_at DESC`).bind(ids),
    db.prepare(`SELECT ob.scenario_id, o.id AS offer_id, o.hotel_name_raw, o.board, o.cancellation, o.nights, o.forfait_days, o.adults, o.url, ob.observed_at, ob.amount_cents, ob.unit, ob.price_kind, ob.availability
                FROM offer_observations ob JOIN offers o ON o.id = ob.offer_id WHERE ob.scenario_id IN (SELECT value FROM json_each(?1)) AND ob.observed_at >= ?2
                ORDER BY ob.observed_at LIMIT 5000`).bind(ids, Date.now() - 120 * 86400_000),
  ]) as D1Result<any>[];
  const out = [];
  for (const s of scenarios) {
    const runs = allRuns.filter((r) => r.scenario_id === s.id);
    const obs = allObs.filter((o) => o.scenario_id === s.id);
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
  // Costes propios de esta candidatura (tienen prioridad sobre los de su estación). null = sin dato.
  forfaitCentsPerDay: zCents.nullable().optional(),
  rentalCentsPerDay: zCents.nullable().optional(),
  tollsCentsPerCar: zCents.nullable().optional(),
  parkingCentsPerCar: zCents.nullable().optional(),
  costsNote: z.string().trim().max(300).nullable().optional(),
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
       pending_notes, proposed_by, created_at, updated_at, adults, children_ages, rooms, forfait_included,
       forfait_cents_per_day, rental_cents_per_day, tolls_cents_per_car, parking_cents_per_car, costs_note)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27)`,
  ).bind(id, tripId, b.offerId ?? null, b.title, b.areaId ?? fromOffer?.area_id ?? null, b.modality, b.url ?? fromOffer?.url ?? null,
    b.amountCents ?? fromOffer?.amount_cents ?? null, b.unit ?? fromOffer?.unit ?? null, b.priceKind ?? fromOffer?.price_kind ?? (b.amountCents != null ? 'user_quote' : null),
    b.checkIn ?? fromOffer?.check_in ?? null, b.checkOut ?? fromOffer?.check_out ?? null,
    b.people ?? (adults != null ? adults + (kids ? JSON.parse(kids).length : 0) : null), b.forfaitDays ?? fromOffer?.forfait_days ?? null,
    b.conditions ?? null, b.pendingNotes ?? null, me, t, adults, kids, b.rooms ?? fromOffer?.rooms ?? null,
    b.forfaitIncluded ?? fromOffer?.forfait_included ?? (b.modality === 'lodging_forfait' ? 'yes' : 'unknown'),
    b.forfaitCentsPerDay ?? null, b.rentalCentsPerDay ?? null, b.tollsCentsPerCar ?? null, b.parkingCentsPerCar ?? null, b.costsNote ?? null).run();
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
    adults: 'adults', childrenAges: 'children_ages', rooms: 'rooms', forfaitIncluded: 'forfait_included',
    forfaitCentsPerDay: 'forfait_cents_per_day', rentalCentsPerDay: 'rental_cents_per_day', tollsCentsPerCar: 'tolls_cents_per_car', parkingCentsPerCar: 'parking_cents_per_car', costsNote: 'costs_note' };
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

async function budgetContext(db: D1Database, tripId: string) {
  const t = await db.prepare('SELECT * FROM trips WHERE id = ?1').bind(tripId).first<any>();
  let b = await db.prepare('SELECT * FROM trip_budget WHERE trip_id = ?1').bind(tripId).first<any>();
  if (!b) {
    await db.prepare('INSERT OR IGNORE INTO trip_budget (trip_id, updated_at) VALUES (?1, ?2)').bind(tripId, now()).run();
    b = await db.prepare('SELECT * FROM trip_budget WHERE trip_id = ?1').bind(tripId).first<any>();
  }
  const members = await db.prepare('SELECT COUNT(*) AS n FROM trip_members WHERE trip_id = ?1').bind(tripId).first<{ n: number }>();
  const shopping = await estimateList(db, tripId);
  const { results: dest } = await db.prepare('SELECT d.*, a.name AS area_name FROM trip_destination_costs d JOIN areas a ON a.id = d.area_id WHERE d.trip_id = ?1').bind(tripId).all<any>();
  const destBy = new Map(dest.map((d) => [d.area_id as string, { row: destRow(d), name: d.area_name as string }]));
  return { t, b, members: members?.n ?? null, shopping, destBy, destinationCosts: dest.map(destinationOut) };
}
type BudgetCtx = Awaited<ReturnType<typeof budgetContext>>;
const destRow = (d: any): DestinationCostRow => ({ forfait: d.forfait_cents_per_day, rental: d.rental_cents_per_day, tolls: d.tolls_cents_per_car, parking: d.parking_cents_per_car,
  kind: d.kind, sourceNote: d.source_note, checkedOn: d.checked_on });
const destinationOut = (d: any) => ({ areaId: d.area_id, areaName: d.area_name, forfaitCentsPerDay: d.forfait_cents_per_day, rentalCentsPerDay: d.rental_cents_per_day,
  tollsCentsPerCar: d.tolls_cents_per_car, parkingCentsPerCar: d.parking_cents_per_car, kind: d.kind, sourceNote: d.source_note, checkedOn: d.checked_on,
  updatedAt: d.updated_at, version: d.version });
const COST_LABEL = { forfait: 'forfait', rental: 'alquiler', tolls: 'peajes', parking: 'parking' } as const;
type RouteRow = { road_km: number | null; source: string; validated: number; notes: string | null } | null;

/** scenario: coste de una candidatura en SU destino (hipótesis que no modifica el viaje). Sin él, destino real y validación estricta. */
function budgetWith({ t, b, members, shopping, destBy }: BudgetCtx, cand: any | null, route: RouteRow, scenario?: { areaLabel: (id: string) => string }) {
  const people = t.participants_planned ?? members ?? null;
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
  // Costes que dependen de la estación: los de la candidatura, los guardados para esa estación o, solo en el destino
  // del viaje, los comunes. Presupuesto elegido: destino real del viaje. Comparación: destino de cada candidatura.
  const areaLabel = scenario?.areaLabel ?? ((id: string) => destBy.get(id)?.name ?? id);
  const costArea: string | null = scenario ? (cand?.area_id ?? t.area_id) : t.area_id;
  const candOwn = cand && (cand.area_id == null || cand.area_id === costArea)
    ? { forfait: cand.forfait_cents_per_day, rental: cand.rental_cents_per_day, tolls: cand.tolls_cents_per_car, parking: cand.parking_cents_per_car } : null;
  const resolved = costArea
    ? resolveDestinationCosts(input, { costArea, tripArea: t.area_id, candidate: candOwn, candidateNote: cand?.costs_note, destination: destBy.get(costArea)?.row ?? null, areaLabel })
    : { input, confirmedForArea: [] };
  const sc = scenario ? candidateScenario(resolved.input, cand?.area_id ?? null, areaLabel, resolved.confirmedForArea) : { input: resolved.input, hypothetical: false };
  const result = computeBudget(sc.input);
  if (sc.hypothetical) {
    // Solo las que de verdad faltan: si no aplican (sin coches, nadie alquila, forfait incluido) no se mencionan.
    const missing = result.components.filter((x) => x.status === 'pending' && x.key in (sc.input.unconfirmed ?? {})).map((x) => COST_LABEL[x.key as keyof typeof COST_LABEL]);
    result.warnings.push(`Escenario hipotético en el destino de la candidatura: ${t.area_id ? 'el viaje tiene otro destino' : 'el viaje no tiene destino'} y no se modifica.`
      + (missing.length ? ` Sin precio de esta estación: ${missing.join(', ')} (quedan pendientes hasta añadirlos).` : ' Se usan los costes guardados para esta estación.'));
  }
  if (route && !route.validated) result.warnings.push(`Distancia por carretera sin validar (${route.source})${route.notes ? `: ${route.notes}` : '.'}`);
  if (b.groceries_cents == null && shopping.unpriced) result.warnings.push(`La lista de compra tiene ${shopping.unpriced} artículo(s) sin precio: la compra queda pendiente.`);
  return { input: sc.input, result, hypothetical: sc.hypothetical };
}

async function budgetFor(db: D1Database, tripId: string) {
  const ctx = await budgetContext(db, tripId);
  const { t, b } = ctx;
  const [route, cand] = await Promise.all([
    t.area_id ? db.prepare('SELECT road_km, source, validated, notes FROM routes WHERE origin_id = ?1 AND area_id = ?2').bind(t.origin_id ?? 'tarragona', t.area_id).first<any>() : null,
    b.chosen_candidate_id ? db.prepare('SELECT * FROM trip_candidates WHERE id = ?1 AND trip_id = ?2').bind(b.chosen_candidate_id, tripId).first<any>() : null,
  ]);
  return { params: b, destinationCosts: ctx.destinationCosts, ...budgetWith(ctx, cand, route) };
}

/**
 * Coste completo por persona de cada candidatura (alojamiento o paquete) con el resto de partidas del viaje. Las
 * completas se ordenan por coste; las incompletas no tienen posición y muestran lo que falta. Consultas fijas.
 */
planRoutes.get('/:id/cost-comparison', async (c) => {
  const tripId = c.req.param('id');
  const db = c.env.DB;
  await requireTripMember(db, tripId, c.get('user').id);
  const ctx = await budgetContext(db, tripId);
  const { results: cands } = await db.prepare('SELECT * FROM trip_candidates WHERE trip_id = ?1 ORDER BY created_at LIMIT 50').bind(tripId).all<any>();
  const areas = [...new Set([ctx.t.area_id, ...cands.map((x) => x.area_id)].filter(Boolean))];
  const [{ results: routes }, { results: names }] = await Promise.all([
    db.prepare(`SELECT area_id, road_km, source, validated, notes FROM routes WHERE origin_id = ?1 AND area_id IN (SELECT value FROM json_each(?2))`)
      .bind(ctx.t.origin_id ?? 'tarragona', JSON.stringify(areas)).all<any>(),
    db.prepare('SELECT id, name FROM areas WHERE id IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(areas)).all<{ id: string; name: string }>(),
  ]);
  const routeBy = new Map(routes.map((r) => [r.area_id, r]));
  const nameBy = new Map(names.map((a) => [a.id, a.name]));
  const areaLabel = (id: string) => nameBy.get(id) ?? id;
  const options = cands.map((cand) => {
    // Cada candidatura se calcula en su propio destino (hipótesis) sin tocar el viaje; su ruta es la de su estación.
    const areaId = cand.area_id ?? ctx.t.area_id;
    const route = areaId ? routeBy.get(areaId) ?? null : null;
    const b = budgetWith(ctx, cand, route, { areaLabel });
    return { id: cand.id, title: cand.title, areaId, roadKm: route?.road_km ?? null, roadValidated: !!route?.validated, hypothetical: b.hypothetical, budget: b.result };
  });
  return c.json({
    options: rankCosts(options).map((r) => { const o = options.find((x) => x.id === r.id)!; return { ...r, hypothetical: o.hypothetical, warnings: o.budget.warnings }; }),
    note: 'Coste completo por persona con transporte, forfait, alquiler y compra del viaje. Un presupuesto incompleto no tiene posición: nunca se muestra como el más barato.',
  });
});

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

/**
 * Costes de una estación para este viaje (forfait, alquiler, peajes, parking), con fuente y fecha. Sirven para el
 * presupuesto si es el destino del viaje y para comparar candidaturas de esa estación. Una sentencia de escritura.
 */
const zDestCosts = z.object({
  forfaitCentsPerDay: zCents.nullable(), rentalCentsPerDay: zCents.nullable(), tollsCentsPerCar: zCents.nullable(), parkingCentsPerCar: zCents.nullable(),
  kind: z.enum(['confirmed', 'estimate']), sourceNote: z.string().trim().max(300).nullable(), checkedOn: zDate.nullable(),
  version: z.number().int().min(0), // 0 = crear
});
planRoutes.put('/:id/destination-costs/:areaId', async (c) => {
  const tripId = c.req.param('id'), areaId = c.req.param('areaId');
  const me = c.get('user').id;
  await requireTripEditor(c.env.DB, tripId, me);
  const b = await parseBody(c, zDestCosts);
  if (!(await c.env.DB.prepare('SELECT 1 FROM areas WHERE id = ?1').bind(areaId).first())) throw notFound('Estación');
  const vals = [b.forfaitCentsPerDay, b.rentalCentsPerDay, b.tollsCentsPerCar, b.parkingCentsPerCar, b.kind, b.sourceNote, b.checkedOn, me, now()];
  const r = b.version === 0
    ? await c.env.DB.prepare(`INSERT OR IGNORE INTO trip_destination_costs (trip_id, area_id, forfait_cents_per_day, rental_cents_per_day, tolls_cents_per_car, parking_cents_per_car,
        kind, source_note, checked_on, updated_by, updated_at) VALUES (?10, ?11, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`).bind(...vals, tripId, areaId).run()
    : await c.env.DB.prepare(`UPDATE trip_destination_costs SET forfait_cents_per_day = ?1, rental_cents_per_day = ?2, tolls_cents_per_car = ?3, parking_cents_per_car = ?4,
        kind = ?5, source_note = ?6, checked_on = ?7, updated_by = ?8, updated_at = ?9, version = version + 1 WHERE trip_id = ?10 AND area_id = ?11 AND version = ?12`)
      .bind(...vals, tripId, areaId, b.version).run();
  if (!r.meta.changes) throw conflict('Los costes de esta estación cambiaron mientras editabas. Recarga para ver la última versión.', 'version_conflict');
  return c.json(await budgetFor(c.env.DB, tripId));
});
planRoutes.delete('/:id/destination-costs/:areaId', async (c) => {
  const tripId = c.req.param('id');
  await requireTripEditor(c.env.DB, tripId, c.get('user').id);
  await c.env.DB.prepare('DELETE FROM trip_destination_costs WHERE trip_id = ?1 AND area_id = ?2').bind(tripId, c.req.param('areaId')).run();
  return c.json({ ok: true });
});
