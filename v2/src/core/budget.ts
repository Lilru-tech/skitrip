// Presupuesto honesto: cada componente es conocido, pendiente o no aplicable. Nada desconocido
// se trata como 0 y un presupuesto incompleto nunca se presenta como total.

export type Modality = 'lodging' | 'lodging_forfait';
export type PriceUnit = 'per_person' | 'per_room' | 'per_night' | 'per_person_night' | 'per_stay' | 'unknown';

export interface BudgetInput {
  people: number | null;          // participantes del viaje
  skiers: number | null;          // cuántos esquían (forfait)
  renters: number | null;         // cuántos alquilan material
  nights: number | null;
  skiDays: number | null;
  cars: number | null;
  roadKmOneWay: number | null;    // SOLO km por carretera; haversine no vale
  fuelCentsPerLitre: number | null;
  litresPer100km: number | null;
  tollsCentsPerCar: number | null;   // ida y vuelta, por coche
  parkingCentsPerCar: number | null; // estancia completa, por coche
  /** Condiciones del viaje con las que se compara la cotización (null = sin indicar). */
  trip?: TripConditions;
  lodging: null | LodgingQuote;
  forfaitCentsPerDay: number | null;
  rentalCentsPerDay: number | null;
  groceriesCents: number | null;
  /**
   * Partidas que dependen del destino y cuyo importe guardado NO está confirmado para el destino calculado (escenario
   * hipotético de otra estación). Quedan pendientes con esta nota salvo que no apliquen (sin coches, forfait incluido…).
   */
  unconfirmed?: Partial<Record<DestinationCost, string>>;
  /** Procedencia de cada partida dependiente del destino (se añade a la nota). */
  costSources?: Partial<Record<DestinationCost, string>>;
  /** Partidas cuyo importe es una estimación explícita: cuentan como «estimado», nunca como confirmado. */
  estimatedCosts?: DestinationCost[];
}

/** Partidas cuyo precio depende de la estación: forfait, peajes, parking y alquiler. */
export const DESTINATION_COSTS = ['tolls', 'parking', 'forfait', 'rental'] as const;
export type DestinationCost = (typeof DESTINATION_COSTS)[number];

export interface TripConditions {
  startDate: string | null;
  endDate: string | null;
  areaId: string | null;
  adults: number | null;
  childrenAges: number[];          // [] = sin menores
  rooms: number | null;            // null = sin indicar (solo importa si el precio es por habitación o la cotización lo fija)
}

/** Cotización tal como se obtuvo. Sus condiciones son las DECLARADAS por la cotización; null = desconocido. */
export interface LodgingQuote {
  modality: Modality;
  forfaitIncluded?: 'yes' | 'no' | 'unknown';
  amountCents: number | null;
  unit: PriceUnit;
  priceKind: string | null;        // quoted_for_search | user_quote | manual_estimate | advertised_from
  checkIn: string | null;
  checkOut: string | null;
  adults: number | null;
  childrenAges: number[] | null;   // null = no consta
  rooms: number | null;
  areaId: string | null;
  forfaitDays: number | null;
}

export interface QuoteComparison {
  status: 'compatible' | 'incompatible' | 'incomplete';
  issues: string[];                // condiciones distintas
  unknown: string[];               // condiciones que no se pueden comprobar
}

const daysBetweenIso = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400_000);
const agesKey = (a: number[]) => JSON.stringify([...a].sort((x, y) => x - y));

/**
 * Compara las condiciones exactas del viaje con las de la cotización. Nunca escala: si cambia una dimensión
 * determinante (fechas, ocupación, habitaciones, destino o forfait) la cotización deja de valer para el grupo.
 */
export function compareQuote(i: Pick<BudgetInput, 'nights' | 'skiDays'> & { trip?: TripConditions }, q: LodgingQuote): QuoteComparison {
  const t = i.trip;
  const issues: string[] = [];
  const unknown: string[] = [];
  // Fechas exactas (misma duración en otras fechas NO es la misma cotización).
  if (q.checkIn && q.checkOut) {
    const qn = daysBetweenIso(q.checkIn, q.checkOut);
    if (t?.startDate && t?.endDate) {
      if (q.checkIn !== t.startDate || q.checkOut !== t.endDate) issues.push(`la cotización es del ${q.checkIn} al ${q.checkOut} y el viaje del ${t.startDate} al ${t.endDate}`);
    } else if (i.nights != null && qn !== i.nights) issues.push(`la cotización es para ${qn} noche(s) y el viaje tiene ${i.nights}`);
    else unknown.push('fechas del viaje');
  } else unknown.push('fechas de la cotización');
  // Ocupación: adultos y edades de menores. Un precio por persona tampoco se escala a otro grupo.
  if (q.adults == null) unknown.push('adultos de la cotización');
  else if (t?.adults == null) unknown.push('adultos del viaje');
  else if (q.adults !== t.adults) issues.push(`la cotización es para ${q.adults} adulto(s) y el viaje tiene ${t.adults}`);
  const tripKids = t?.childrenAges ?? [];
  // Que la cotización no mencione menores no prueba que sea para un grupo sin menores.
  if (q.childrenAges == null) unknown.push('menores de la cotización');
  else if (agesKey(q.childrenAges) !== agesKey(tripKids)) issues.push(`menores distintos (cotización: ${q.childrenAges.length ? q.childrenAges.join(', ') + ' años' : 'ninguno'}; viaje: ${tripKids.length ? tripKids.join(', ') + ' años' : 'ninguno'})`);
  // Habitaciones: si una parte fija una distribución, la otra tiene que declararla; si ninguna la fija, solo importa
  // cuando el precio es por habitación.
  const tRooms = t?.rooms ?? null;
  if (q.rooms != null && tRooms != null) { if (q.rooms !== tRooms) issues.push(`la cotización es para ${q.rooms} habitación(es) y el viaje prevé ${tRooms}`); }
  else if (tRooms != null) unknown.push(`habitaciones de la cotización (el viaje pide ${tRooms})`);
  else if (q.rooms != null) unknown.push(`habitaciones del viaje (la cotización es para ${q.rooms})`);
  else if (q.unit === 'per_room') unknown.push('habitaciones');
  // Destino.
  if (q.areaId && t?.areaId && q.areaId !== t.areaId) issues.push('la cotización es de otro destino');
  else if (!q.areaId || !t?.areaId) unknown.push('destino');
  // Forfait.
  const forfait = q.forfaitIncluded ?? (q.modality === 'lodging_forfait' ? 'yes' : 'unknown');
  if (forfait === 'unknown') unknown.push('si incluye forfait');
  if (forfait === 'yes') {
    if (q.forfaitDays == null) unknown.push('días de forfait');
    else if (i.skiDays == null) unknown.push(`días de esquí del viaje (el paquete incluye ${q.forfaitDays})`);
    else if (q.forfaitDays !== i.skiDays) issues.push(`el paquete incluye ${q.forfaitDays} día(s) de forfait y planeáis ${i.skiDays}`);
  }
  return { status: issues.length ? 'incompatible' : unknown.length ? 'incomplete' : 'compatible', issues, unknown };
}

/** known = cotización válida para el grupo; estimated = estimación manual deliberada (se suma aparte). */
export type ComponentStatus = 'known' | 'estimated' | 'pending' | 'not_applicable';
export interface BudgetComponent {
  key: 'transport' | 'tolls' | 'parking' | 'lodging' | 'forfait' | 'rental' | 'groceries';
  label: string;
  status: ComponentStatus;
  totalCents: number | null;
  note: string;
  /** Importe de la cotización que no se suma (incompatible, incompleta u orientativa), como referencia histórica. */
  referenceCents?: number | null;
  comparison?: QuoteComparison;
}
export interface BudgetResult {
  components: BudgetComponent[];
  knownSubtotalCents: number;
  estimatedSubtotalCents: number;  // solo estimaciones manuales; nunca mezcladas con lo conocido
  pending: string[];
  complete: boolean;
  perPersonCents: number | null;   // solo si está completo y hay personas
  knownPerPersonCents: number | null;
  warnings: string[];
}

const costStatus = (i: BudgetInput, k: DestinationCost): ComponentStatus => (i.estimatedCosts?.includes(k) ? 'estimated' : 'known');
const src = (i: BudgetInput, k: DestinationCost) => (i.costSources?.[k] ? ` ${i.costSources[k]}` : '');
const eur = (c: number) => (c / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

export function computeBudget(i: BudgetInput): BudgetResult {
  const c: BudgetComponent[] = [];
  const warnings: string[] = [];
  const pending = (key: BudgetComponent['key'], label: string, note: string) => c.push({ key, label, status: 'pending', totalCents: null, note });

  // Transporte: combustible ida y vuelta por coche.
  if (i.cars === 0) c.push({ key: 'transport', label: 'Combustible', status: 'not_applicable', totalCents: null, note: 'Sin coches.' });
  else if (i.cars == null || i.roadKmOneWay == null || i.fuelCentsPerLitre == null || i.litresPer100km == null) {
    const miss = [i.cars == null && 'nº de coches', i.roadKmOneWay == null && 'km por carretera', i.fuelCentsPerLitre == null && 'precio del combustible', i.litresPer100km == null && 'consumo'].filter(Boolean);
    pending('transport', 'Combustible', `Falta: ${miss.join(', ')}.`);
  } else {
    const litres = (i.roadKmOneWay * 2 * i.litresPer100km) / 100;
    const total = Math.round(litres * i.fuelCentsPerLitre) * i.cars;
    c.push({ key: 'transport', label: 'Combustible', status: 'known', totalCents: total, note: `${i.cars} coche(s) × ${i.roadKmOneWay * 2} km × ${i.litresPer100km} l/100 km × ${eur(i.fuelCentsPerLitre)}/l.` });
  }
  for (const [key, label, v] of [['tolls', 'Peajes', i.tollsCentsPerCar], ['parking', 'Parking', i.parkingCentsPerCar]] as const) {
    if (i.cars === 0) c.push({ key, label, status: 'not_applicable', totalCents: null, note: 'Sin coches.' });
    else if (i.unconfirmed?.[key]) pending(key, label, i.unconfirmed[key]!);
    else if (v == null || i.cars == null) pending(key, label, `Falta ${label.toLowerCase()} por coche${i.cars == null ? ' y nº de coches' : ''}.`);
    else c.push({ key, label, status: costStatus(i, key), totalCents: v * i.cars, note: `${eur(v)} por coche × ${i.cars}.${src(i, key)}` });
  }

  // Alojamiento (o paquete alojamiento + forfait). Nunca se escala una cotización a otras fechas, personas o destino.
  let packageIncludesForfait = false;
  const L = i.lodging;
  if (!L || L.amountCents == null) pending('lodging', 'Alojamiento', 'Sin alojamiento elegido o sin precio.');
  else {
    const forfait = L.forfaitIncluded ?? (L.modality === 'lodging_forfait' ? 'yes' : 'unknown');
    packageIncludesForfait = forfait === 'yes';
    const label = packageIncludesForfait ? 'Alojamiento + forfait' : 'Alojamiento';
    const cmp = compareQuote(i, L);
    const estimate = L.priceKind === 'manual_estimate';
    const ref = { referenceCents: L.amountCents, comparison: cmp };
    if (cmp.status === 'incompatible') c.push({ key: 'lodging', label, status: 'pending', totalCents: null, ...ref,
      note: `La cotización guardada no vale para el viaje actual: ${cmp.issues.join('; ')}. Se conserva como referencia; pide una cotización para estas condiciones.` });
    else if (cmp.status === 'incomplete' && !estimate) c.push({ key: 'lodging', label, status: 'pending', totalCents: null, ...ref,
      note: `No se puede comprobar que la cotización valga para el grupo: falta ${cmp.unknown.join(', ')}.` });
    else if (L.priceKind === 'advertised_from') c.push({ key: 'lodging', label, status: 'pending', totalCents: null, ...ref,
      note: 'Precio «desde» orientativo del proveedor: no es una cotización para vuestro grupo ni fechas.' });
    else {
      let total: number | null = null;
      let note = '';
      const who = i.people;
      if (packageIncludesForfait && i.skiers != null && i.people != null && i.skiers < i.people) warnings.push('Hay participantes que no esquían y el paquete incluye forfait para cada persona: confirma el precio sin forfait para ellos.');
      switch (L.unit) {
        case 'per_stay': total = L.amountCents; note = 'Precio total de la estancia.'; break;
        case 'per_person': if (who != null) { total = L.amountCents * who; note = `${eur(L.amountCents)} por persona × ${who} (cotizado para este mismo grupo).`; } break;
        case 'per_night': if (i.nights != null) { total = L.amountCents * i.nights; note = `${eur(L.amountCents)} por noche (alojamiento completo) × ${i.nights}.`; } break;
        case 'per_person_night': if (who != null && i.nights != null) { total = L.amountCents * who * i.nights; note = `${eur(L.amountCents)} por persona y noche × ${who} × ${i.nights}.`; } break;
        case 'per_room': if (L.rooms != null && i.trip?.rooms != null && L.rooms === i.trip.rooms) { total = L.amountCents * L.rooms; note = `${eur(L.amountCents)} por habitación × ${L.rooms}.`; } break;
        default: break;
      }
      if (total == null) pending('lodging', label, L.unit === 'per_room' ? 'Precio por habitación: confirma cuántas habitaciones antes de sumar.' : 'Unidad del precio desconocida o faltan personas/noches.');
      else if (estimate) {
        c.push({ key: 'lodging', label, status: 'estimated', totalCents: total, ...ref, note: `Estimación manual, no una cotización. ${note}${cmp.unknown.length ? ` Sin comprobar: ${cmp.unknown.join(', ')}.` : ''}` });
      } else c.push({ key: 'lodging', label, status: 'known', totalCents: total, comparison: cmp, note });
    }
  }

  // Forfait: si el paquete ya lo incluye, no se suma otra vez.
  if (packageIncludesForfait) c.push({ key: 'forfait', label: 'Forfait', status: 'not_applicable', totalCents: null, note: 'Incluido en el paquete.' });
  else if (i.skiers === 0) c.push({ key: 'forfait', label: 'Forfait', status: 'not_applicable', totalCents: null, note: 'Nadie esquía.' });
  else if (i.unconfirmed?.forfait) pending('forfait', 'Forfait', i.unconfirmed.forfait);
  else if (i.forfaitCentsPerDay == null || i.skiers == null || i.skiDays == null) pending('forfait', 'Forfait', 'Falta precio por día, días de esquí o nº de esquiadores.');
  else c.push({ key: 'forfait', label: 'Forfait', status: costStatus(i, 'forfait'), totalCents: i.forfaitCentsPerDay * i.skiers * i.skiDays, note: `${eur(i.forfaitCentsPerDay)} × ${i.skiers} esquiador(es) × ${i.skiDays} día(s).${src(i, 'forfait')}` });

  if (i.renters === 0) c.push({ key: 'rental', label: 'Alquiler de material', status: 'not_applicable', totalCents: null, note: 'Nadie alquila.' });
  else if (i.unconfirmed?.rental) pending('rental', 'Alquiler de material', i.unconfirmed.rental);
  else if (i.rentalCentsPerDay == null || i.renters == null || i.skiDays == null) pending('rental', 'Alquiler de material', 'Falta precio por día, días o nº de personas que alquilan.');
  else c.push({ key: 'rental', label: 'Alquiler de material', status: costStatus(i, 'rental'), totalCents: i.rentalCentsPerDay * i.renters * i.skiDays, note: `${eur(i.rentalCentsPerDay)} × ${i.renters} × ${i.skiDays} día(s).${src(i, 'rental')}` });

  if (i.groceriesCents == null) pending('groceries', 'Compra', 'Sin estimación de la compra.');
  else c.push({ key: 'groceries', label: 'Compra', status: 'known', totalCents: i.groceriesCents, note: 'Estimación del grupo.' });

  const knownSubtotalCents = c.reduce((s, x) => s + (x.status === 'known' ? x.totalCents! : 0), 0);
  const estimatedSubtotalCents = c.reduce((s, x) => s + (x.status === 'estimated' ? x.totalCents! : 0), 0);
  const pend = c.filter((x) => x.status === 'pending').map((x) => x.label);
  // Completo solo con partidas conocidas: una estimación manual no completa el presupuesto.
  const complete = pend.length === 0 && !c.some((x) => x.status === 'estimated');
  const people = i.people && i.people > 0 ? i.people : null;
  return {
    components: c,
    knownSubtotalCents,
    estimatedSubtotalCents,
    pending: pend,
    complete,
    perPersonCents: complete && people ? Math.round(knownSubtotalCents / people) : null,
    knownPerPersonCents: people ? Math.round(knownSubtotalCents / people) : null,
    warnings,
  };
}

/**
 * Escenario hipotético de una candidatura: el viaje trasladado al destino de la candidatura, SIN modificar el viaje.
 * - La comparación de condiciones usa el destino de la candidatura (otra estación no es «otro destino» aquí).
 * - Las partidas que dependen de la estación solo se reutilizan si la candidatura es del mismo destino del viaje;
 *   si no, quedan pendientes (nunca se toman como confirmadas las de otra estación).
 * - El presupuesto elegido del viaje sigue usando computeBudget con el destino real y su validación estricta.
 */
export function candidateScenario(i: BudgetInput, candidateAreaId: string | null, areaLabel: (id: string) => string = (id) => id,
  confirmedForArea: readonly DestinationCost[] = []): { input: BudgetInput; hypothetical: boolean } {
  const tripArea = i.trip?.areaId ?? null;
  const area = candidateAreaId ?? tripArea;
  const hypothetical = area !== tripArea;
  if (!hypothetical) return { input: i, hypothetical };
  const why = tripArea == null
    ? `el viaje no tiene destino y el importe guardado no está confirmado para ${area ? areaLabel(area) : 'esta candidatura'}`
    : `el importe guardado es de ${areaLabel(tripArea)}, no de ${area ? areaLabel(area) : 'esta candidatura'}`;
  const unconfirmed: BudgetInput['unconfirmed'] = {};
  for (const k of DESTINATION_COSTS) if (!confirmedForArea.includes(k)) unconfirmed[k] = `Sin confirmar para este destino: ${why}.`;
  return { input: { ...i, trip: i.trip ? { ...i.trip, areaId: area } : i.trip, unconfirmed }, hypothetical };
}

type CostSet = Partial<Record<DestinationCost, number | null>>;
export interface DestinationCostRow extends CostSet { kind: 'confirmed' | 'estimate'; sourceNote: string | null; checkedOn: string | null }
const FIELD: Record<DestinationCost, 'tollsCentsPerCar' | 'parkingCentsPerCar' | 'forfaitCentsPerDay' | 'rentalCentsPerDay'> =
  { tolls: 'tollsCentsPerCar', parking: 'parkingCentsPerCar', forfait: 'forfaitCentsPerDay', rental: 'rentalCentsPerDay' };

/**
 * Importes de forfait, alquiler, peajes y parking para calcular en el destino `costArea`, con su procedencia:
 *  1. los propios de la candidatura (p. ej. apartamento con parking incluido);
 *  2. los guardados para esa estación en el viaje (con fuente y fecha; pueden ser estimación);
 *  3. los comunes del viaje, SOLO si `costArea` es el destino del viaje.
 * Lo que no sale de 1–2 en otra estación queda pendiente (candidateScenario). Nunca se toma el precio de otra estación.
 */
export function resolveDestinationCosts(i: BudgetInput, o: { costArea: string | null; tripArea: string | null; candidate?: CostSet | null; candidateNote?: string | null;
  destination?: DestinationCostRow | null; areaLabel?: (id: string) => string }): { input: BudgetInput; confirmedForArea: DestinationCost[] } {
  const label = o.areaLabel ?? ((id: string) => id);
  const out: BudgetInput = { ...i, costSources: { ...i.costSources }, estimatedCosts: [...(i.estimatedCosts ?? [])] };
  const confirmedForArea: DestinationCost[] = [];
  const sameArea = o.costArea != null && o.costArea === o.tripArea;
  for (const k of DESTINATION_COSTS) {
    const f = FIELD[k];
    const cand = o.candidate?.[k];
    const dest = o.destination?.[k];
    if (cand != null) {
      out[f] = cand; confirmedForArea.push(k);
      out.costSources![k] = `(de la candidatura${o.candidateNote ? `: ${o.candidateNote}` : ''})`;
    } else if (dest != null && o.destination) {
      out[f] = dest; confirmedForArea.push(k);
      const meta = [o.destination.sourceNote, o.destination.checkedOn].filter(Boolean).join(', ');
      out.costSources![k] = `(${o.destination.kind === 'estimate' ? 'estimación' : 'precio'} de ${o.costArea ? label(o.costArea) : 'la estación'}${meta ? `: ${meta}` : ''})`;
      if (o.destination.kind === 'estimate') out.estimatedCosts!.push(k);
    } else if (sameArea) {
      if (i[f] != null) out.costSources![k] = '(común del viaje)';
    } else out[f] = null;
  }
  return { input: out, confirmedForArea };
}
