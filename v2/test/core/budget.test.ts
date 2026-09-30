import { describe, expect, it } from 'vitest';
import { computeBudget, type BudgetInput } from '../../src/core/budget';

const base: BudgetInput = {
  people: 4, skiers: 4, renters: 2, nights: 2, skiDays: 2, cars: 1, roadKmOneWay: 260, fuelCentsPerLitre: 160, litresPer100km: 6.5,
  tollsCentsPerCar: 2000, parkingCentsPerCar: 0, lodging: { modality: 'lodging_forfait', amountCents: 20000, unit: 'per_person', quotedPeople: 4, quotedNights: 2, quotedForfaitDays: 2, priceKind: 'quoted_for_search' },
  forfaitCentsPerDay: 5500, rentalCentsPerDay: 3000, groceriesCents: 8000,
};

describe('presupuesto', () => {
  it('un paquete con forfait no suma el forfait otra vez', () => {
    const r = computeBudget(base);
    expect(r.components.find((c) => c.key === 'forfait')!.status).toBe('not_applicable');
    expect(r.components.find((c) => c.key === 'lodging')!.totalCents).toBe(80000);
  });
  it('con solo alojamiento, el forfait se suma por esquiador y día', () => {
    const r = computeBudget({ ...base, lodging: { ...base.lodging!, modality: 'lodging' } });
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
    const r = computeBudget({ ...base, nights: 3 });
    const l = r.components.find((c) => c.key === 'lodging')!;
    expect(l.status).toBe('pending');
    expect(l.totalCents).toBeNull();
    expect(l.note).toMatch(/2 noche/);
  });
  it('un precio por habitación no se multiplica por personas sin confirmar habitaciones', () => {
    const r = computeBudget({ ...base, lodging: { ...base.lodging!, unit: 'per_room', modality: 'lodging' } });
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
  it('avisa si el precio es «desde»', () => {
    const r = computeBudget({ ...base, lodging: { ...base.lodging!, priceKind: 'advertised_from' } });
    expect(r.warnings.join(' ')).toMatch(/desde/);
  });
});
