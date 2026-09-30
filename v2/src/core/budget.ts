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
  lodging: null | {
    modality: Modality;
    amountCents: number | null;
    unit: PriceUnit;
    /** Personas/noches a las que se refiere la cotización; si no coinciden con el viaje, no se escala. */
    quotedPeople: number | null;
    quotedNights: number | null;
    quotedForfaitDays: number | null;
    priceKind: string | null;
  };
  forfaitCentsPerDay: number | null;
  rentalCentsPerDay: number | null;
  groceriesCents: number | null;
}

export type ComponentStatus = 'known' | 'pending' | 'not_applicable';
export interface BudgetComponent {
  key: 'transport' | 'tolls' | 'parking' | 'lodging' | 'forfait' | 'rental' | 'groceries';
  label: string;
  status: ComponentStatus;
  totalCents: number | null;
  note: string;
}
export interface BudgetResult {
  components: BudgetComponent[];
  knownSubtotalCents: number;
  pending: string[];
  complete: boolean;
  perPersonCents: number | null;   // solo si está completo y hay personas
  knownPerPersonCents: number | null;
  warnings: string[];
}

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
    else if (v == null || i.cars == null) pending(key, label, `Falta ${label.toLowerCase()} por coche${i.cars == null ? ' y nº de coches' : ''}.`);
    else c.push({ key, label, status: 'known', totalCents: v * i.cars, note: `${eur(v)} por coche × ${i.cars}.` });
  }

  // Alojamiento (o paquete alojamiento + forfait). Nunca se escala una cotización a otras noches/personas.
  let packageIncludesForfait = false;
  const L = i.lodging;
  if (!L || L.amountCents == null) pending('lodging', 'Alojamiento', 'Sin alojamiento elegido o sin precio.');
  else {
    packageIncludesForfait = L.modality === 'lodging_forfait';
    const label = packageIncludesForfait ? 'Alojamiento + forfait' : 'Alojamiento';
    const mismatch: string[] = [];
    if (L.quotedNights != null && i.nights != null && L.quotedNights !== i.nights) mismatch.push(`la cotización es para ${L.quotedNights} noche(s) y el viaje tiene ${i.nights}`);
    if (L.quotedPeople != null && i.people != null && L.quotedPeople !== i.people && L.unit !== 'per_person' && L.unit !== 'per_person_night') mismatch.push(`la cotización es para ${L.quotedPeople} persona(s) y sois ${i.people}`);
    if (packageIncludesForfait && L.quotedForfaitDays != null && i.skiDays != null && L.quotedForfaitDays !== i.skiDays) mismatch.push(`el paquete incluye ${L.quotedForfaitDays} día(s) de forfait y planeáis ${i.skiDays}`);
    if (mismatch.length) pending('lodging', label, `No comparable: ${mismatch.join('; ')}. Pide una cotización para estas condiciones.`);
    else {
      let total: number | null = null;
      let note = '';
      const who = i.people;
      if (packageIncludesForfait && i.skiers != null && i.people != null && i.skiers < i.people) warnings.push('Hay participantes que no esquían y el paquete incluye forfait para cada persona: confirma el precio sin forfait para ellos.');
      switch (L.unit) {
        case 'per_stay': total = L.amountCents; note = 'Precio total de la estancia.'; break;
        case 'per_person': if (who != null) { total = L.amountCents * who; note = `${eur(L.amountCents)} por persona × ${who}.`; } break;
        case 'per_night': if (i.nights != null) { total = L.amountCents * i.nights; note = `${eur(L.amountCents)} por noche (alojamiento completo) × ${i.nights}.`; } break;
        case 'per_person_night': if (who != null && i.nights != null) { total = L.amountCents * who * i.nights; note = `${eur(L.amountCents)} por persona y noche × ${who} × ${i.nights}.`; } break;
        default: break; // por habitación o desconocido: requiere confirmar habitaciones/cupo
      }
      if (total == null) pending('lodging', label, L.unit === 'per_room' ? 'Precio por habitación: confirma cuántas habitaciones y el cupo antes de sumar.' : 'Unidad del precio desconocida o faltan personas/noches.');
      else {
        if (L.priceKind === 'advertised_from') warnings.push('El alojamiento es un precio «desde»: no garantiza disponibilidad para vuestro grupo ni fechas.');
        if (L.priceKind === 'manual_estimate') warnings.push('El alojamiento es una estimación manual.');
        c.push({ key: 'lodging', label, status: 'known', totalCents: total, note });
      }
    }
  }

  // Forfait: si el paquete ya lo incluye, no se suma otra vez.
  if (packageIncludesForfait) c.push({ key: 'forfait', label: 'Forfait', status: 'not_applicable', totalCents: null, note: 'Incluido en el paquete.' });
  else if (i.skiers === 0) c.push({ key: 'forfait', label: 'Forfait', status: 'not_applicable', totalCents: null, note: 'Nadie esquía.' });
  else if (i.forfaitCentsPerDay == null || i.skiers == null || i.skiDays == null) pending('forfait', 'Forfait', 'Falta precio por día, días de esquí o nº de esquiadores.');
  else c.push({ key: 'forfait', label: 'Forfait', status: 'known', totalCents: i.forfaitCentsPerDay * i.skiers * i.skiDays, note: `${eur(i.forfaitCentsPerDay)} × ${i.skiers} esquiador(es) × ${i.skiDays} día(s).` });

  if (i.renters === 0) c.push({ key: 'rental', label: 'Alquiler de material', status: 'not_applicable', totalCents: null, note: 'Nadie alquila.' });
  else if (i.rentalCentsPerDay == null || i.renters == null || i.skiDays == null) pending('rental', 'Alquiler de material', 'Falta precio por día, días o nº de personas que alquilan.');
  else c.push({ key: 'rental', label: 'Alquiler de material', status: 'known', totalCents: i.rentalCentsPerDay * i.renters * i.skiDays, note: `${eur(i.rentalCentsPerDay)} × ${i.renters} × ${i.skiDays} día(s).` });

  if (i.groceriesCents == null) pending('groceries', 'Compra', 'Sin estimación de la compra.');
  else c.push({ key: 'groceries', label: 'Compra', status: 'known', totalCents: i.groceriesCents, note: 'Estimación del grupo.' });

  const knownSubtotalCents = c.reduce((s, x) => s + (x.status === 'known' ? x.totalCents! : 0), 0);
  const pend = c.filter((x) => x.status === 'pending').map((x) => x.label);
  const complete = pend.length === 0;
  const people = i.people && i.people > 0 ? i.people : null;
  return {
    components: c,
    knownSubtotalCents,
    pending: pend,
    complete,
    perPersonCents: complete && people ? Math.round(knownSubtotalCents / people) : null,
    knownPerPersonCents: people ? Math.round(knownSubtotalCents / people) : null,
    warnings,
  };
}
