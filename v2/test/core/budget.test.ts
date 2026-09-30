import { describe, expect, it } from 'vitest';
import { computeBudget, type BudgetInput } from '../../src/core/budget';

const base: BudgetInput = {
  people: 4, skiers: 4, renters: 2, nights: 2, skiDays: 2, cars: 1, roadKmOneWay: 260, fuelCentsPerLitre: 160, litresPer100km: 6.5,
  tollsCentsPerCar: 2000, parkingCentsPerCar: 0,
  trip: { startDate: '2026-12-10', endDate: '2026-12-12', areaId: 'cerler', adults: 4, childrenAges: [], rooms: null },
  lodging: { modality: 'lodging_forfait', forfaitIncluded: 'yes', amountCents: 20000, unit: 'per_person', priceKind: 'quoted_for_search',
    checkIn: '2026-12-10', checkOut: '2026-12-12', adults: 4, childrenAges: [], rooms: null, areaId: 'cerler', forfaitDays: 2 },
  forfaitCentsPerDay: 5500, rentalCentsPerDay: 3000, groceriesCents: 8000,
};

describe('presupuesto', () => {
  it('un paquete con forfait no suma el forfait otra vez', () => {
    const r = computeBudget(base);
    expect(r.components.find((c) => c.key === 'forfait')!.status).toBe('not_applicable');
    expect(r.components.find((c) => c.key === 'lodging')!.totalCents).toBe(80000);
  });
  it('con solo alojamiento, el forfait se suma por esquiador y día', () => {
    const r = computeBudget({ ...base, lodging: { ...base.lodging!, modality: 'lodging', forfaitIncluded: 'no' } });
    expect(r.components.find((c) => c.key === 'forfait')!.totalCents).toBe(5500 * 4 * 2);
  });
  it('si falta un componente esencial muestra subtotal conocido y pendientes, sin total por persona', () => {
    const r = computeBudget({ ...base, lodging: null });
    expect(r.complete).toBe(false);
    expect(r.perPersonCents).toBeNull();
    expect(r.pending).toContain('Alojamiento');
    expect(r.knownSubtotalCents).toBeGreaterThan(0);
  });
  it('cambiar noches no multiplica una cotización anterior: queda pendiente', () => {
    const r = computeBudget({ ...base, nights: 3, trip: { ...base.trip!, endDate: '2026-12-13' } });
    const l = r.components.find((c) => c.key === 'lodging')!;
    expect(l.status).toBe('pending');
    expect(l.totalCents).toBeNull();
    expect(l.referenceCents).toBe(20000);
    expect(l.comparison!.status).toBe('incompatible');
  });
  it('un precio por habitación no se multiplica por personas sin confirmar habitaciones', () => {
    const r = computeBudget({ ...base, lodging: { ...base.lodging!, unit: 'per_room', modality: 'lodging', forfaitIncluded: 'no' } });
    expect(r.components.find((c) => c.key === 'lodging')!.status).toBe('pending');
  });
  it('sin km por carretera el combustible queda pendiente (no se usa línea recta)', () => {
    const r = computeBudget({ ...base, roadKmOneWay: null });
    expect(r.components.find((c) => c.key === 'transport')!.status).toBe('pending');
  });
  it('peajes y parking son por coche', () => {
    const r = computeBudget({ ...base, cars: 2 });
    expect(r.components.find((c) => c.key === 'tolls')!.totalCents).toBe(4000);
  });
  it('participantes que no alquilan: el alquiler se calcula solo para quienes alquilan', () => {
    const r = computeBudget({ ...base, renters: 0 });
    expect(r.components.find((c) => c.key === 'rental')!.status).toBe('not_applicable');
  });
  it('un precio «desde» nunca cuenta como cotización del grupo', () => {
    const l = computeBudget({ ...base, lodging: { ...base.lodging!, priceKind: 'advertised_from' } }).components.find((c) => c.key === 'lodging')!;
    expect(l).toMatchObject({ status: 'pending', totalCents: null, referenceCents: 20000 });
    expect(l.note).toMatch(/desde/);
  });
});

// Reproducción de la revisión: viaje 10–12 dic, dos personas, 100 €/persona cotizado para esas fechas y dos personas.
describe('presupuesto: condiciones exactas', () => {
  const trip2: BudgetInput = { ...base, people: 2, skiers: 2, nights: 2,
    trip: { startDate: '2026-12-10', endDate: '2026-12-12', areaId: 'cerler', adults: 2, childrenAges: [], rooms: null },
    lodging: { ...base.lodging!, modality: 'lodging', forfaitIncluded: 'no', amountCents: 10000, adults: 2 } };
  const lodging = (i: BudgetInput) => computeBudget(i).components.find((c) => c.key === 'lodging')!;

  it('con las mismas condiciones suma 200 € conocidos', () => {
    expect(lodging(trip2)).toMatchObject({ status: 'known', totalCents: 20000 });
  });
  it('mover el viaje a febrero con la misma duración deja la cotización incompatible', () => {
    const l = lodging({ ...trip2, trip: { ...trip2.trip!, startDate: '2027-02-10', endDate: '2027-02-12' } });
    expect(l).toMatchObject({ status: 'pending', totalCents: null, referenceCents: 10000 });
    expect(l.comparison!.issues.join(' ')).toMatch(/2026-12-10/);
  });
  it('pasar a cuatro personas no convierte 100 €/persona en 400 € conocidos', () => {
    const l = lodging({ ...trip2, people: 4, skiers: 4, trip: { ...trip2.trip!, adults: 4 } });
    expect(l.status).toBe('pending');
    expect(l.comparison!.issues.join(' ')).toMatch(/2 adulto/);
  });
  it('menores con otras edades o habitaciones distintas no son la misma cotización', () => {
    expect(lodging({ ...trip2, trip: { ...trip2.trip!, childrenAges: [3] }, lodging: { ...trip2.lodging!, childrenAges: [12] } }).comparison!.status).toBe('incompatible');
    expect(lodging({ ...trip2, trip: { ...trip2.trip!, rooms: 2 }, lodging: { ...trip2.lodging!, rooms: 1 } }).status).toBe('pending');
  });
  it('otro destino no vale', () => {
    expect(lodging({ ...trip2, lodging: { ...trip2.lodging!, areaId: 'formigal' } }).comparison!.issues.join(' ')).toMatch(/destino/);
  });
  it('condiciones desconocidas limitan la comparación: queda pendiente con lo que falta', () => {
    const l = lodging({ ...trip2, lodging: { ...trip2.lodging!, checkIn: null, checkOut: null, adults: null } });
    expect(l.status).toBe('pending');
    expect(l.comparison!.status).toBe('incomplete');
    expect(l.note).toMatch(/fechas de la cotización/);
  });
  it('null en forfait no significa «solo alojamiento»', () => {
    expect(lodging({ ...trip2, lodging: { ...trip2.lodging!, forfaitIncluded: 'unknown' } }).comparison!.unknown).toContain('si incluye forfait');
  });
  it('una estimación manual se distingue de una cotización y no completa el presupuesto', () => {
    const r = computeBudget({ ...trip2, lodging: { ...trip2.lodging!, priceKind: 'manual_estimate', adults: null } });
    const l = r.components.find((c) => c.key === 'lodging')!;
    expect(l.status).toBe('estimated');
    expect(r.estimatedSubtotalCents).toBe(20000);
    expect(r.complete).toBe(false);
    expect(r.perPersonCents).toBeNull();
  });
});

describe('revisión final 4 · condiciones que no se pueden dar por comprobadas', () => {
  const trip: BudgetInput = { ...base, people: 2, skiers: 2, renters: 0, cars: 0, groceriesCents: 0,
    trip: { startDate: '2027-01-15', endDate: '2027-01-17', areaId: 'a', adults: 2, childrenAges: [], rooms: null },
    lodging: { modality: 'lodging', forfaitIncluded: 'no', amountCents: 10000, unit: 'per_person', priceKind: 'user_quote',
      checkIn: '2027-01-15', checkOut: '2027-01-17', adults: 2, childrenAges: [], rooms: null, areaId: 'a', forfaitDays: null } };
  const lodging = (i: BudgetInput) => computeBudget(i).components.find((c) => c.key === 'lodging')!;

  it('el viaje pide dos habitaciones y la cotización no dice cuántas: pendiente', () => {
    const l = lodging({ ...trip, trip: { ...trip.trip!, rooms: 2 } });
    expect(l.status).toBe('pending');
    expect(l.comparison!.unknown.join(' ')).toMatch(/habitaciones de la cotización/);
  });
  it('control: ninguna parte fija habitaciones y el precio es por persona → conocido; ambas coinciden → conocido', () => {
    expect(lodging(trip)).toMatchObject({ status: 'known', totalCents: 20000 });
    expect(lodging({ ...trip, trip: { ...trip.trip!, rooms: 2 }, lodging: { ...trip.lodging!, rooms: 2 } })).toMatchObject({ status: 'known', totalCents: 20000 });
  });
  it('la cotización fija habitaciones y el viaje no: pendiente hasta indicarlas en el viaje', () => {
    const l = lodging({ ...trip, lodging: { ...trip.lodging!, rooms: 1 } });
    expect(l.status).toBe('pending');
    expect(l.comparison!.unknown.join(' ')).toMatch(/habitaciones del viaje/);
  });
  it('paquete con 2 días de forfait y viaje sin días de esquí: no está completo', () => {
    const pkg: BudgetInput = { ...trip, skiDays: null, lodging: { ...trip.lodging!, modality: 'lodging_forfait', forfaitIncluded: 'yes', forfaitDays: 2 } };
    const r = computeBudget(pkg);
    expect(r.complete).toBe(false);
    expect(r.components.find((c) => c.key === 'lodging')!.comparison!.unknown.join(' ')).toMatch(/días de esquí del viaje/);
    expect(computeBudget({ ...pkg, skiDays: 2 }).complete).toBe(true); // control compatible
  });
  it('menores: la cotización no los declara → pendiente, también si el viaje no tiene menores', () => {
    expect(lodging({ ...trip, lodging: { ...trip.lodging!, childrenAges: null } }).comparison!.unknown.join(' ')).toMatch(/menores de la cotización/);
    expect(lodging({ ...trip, trip: { ...trip.trip!, childrenAges: [8] }, lodging: { ...trip.lodging!, childrenAges: null } }).status).toBe('pending');
  });
  it('se mantiene la estimación manual aparte aunque falten condiciones', () => {
    const l = lodging({ ...trip, trip: { ...trip.trip!, rooms: 2 }, lodging: { ...trip.lodging!, priceKind: 'manual_estimate' } });
    expect(l.status).toBe('estimated');
    expect(l.note).toMatch(/Sin comprobar: .*habitaciones/);
  });
});
