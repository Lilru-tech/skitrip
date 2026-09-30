import { describe, it, expect } from 'vitest';
import { parseFormat, unitPrice } from '../../../src/core/parsers/unit-price';

describe('unitPrice', () => {
  it('€/kg with half-up rounding', () => {
    expect(unitPrice(245, 400, 'g')).toEqual({ perKgOrL_cents: 613, perUnit_cents: null, label: '€/kg' }); // 612,5 → 613
    expect(unitPrice(199, 750, 'g').perKgOrL_cents).toBe(265); // 265,33
    expect(unitPrice(100, 3, 'g').perKgOrL_cents).toBe(33333);
    expect(unitPrice(29, 1000, 'g').perKgOrL_cents).toBe(29);
  });
  it('€/L and €/ud', () => {
    expect(unitPrice(135, 1500, 'ml')).toEqual({ perKgOrL_cents: 90, perUnit_cents: null, label: '€/L' });
    expect(unitPrice(291, 12, 'unit')).toEqual({ perKgOrL_cents: null, perUnit_cents: 24, label: '€/ud' }); // 24,25
    expect(unitPrice(290, 12, 'unit').perUnit_cents).toBe(24); // 24,1666
    expect(unitPrice(30, 4, 'unit').perUnit_cents).toBe(8); // 7,5 → 8
  });
  it('invalid quantities → null', () => {
    expect(unitPrice(100, 0, 'g').perKgOrL_cents).toBeNull();
    expect(unitPrice(-1, 10, 'unit').perUnit_cents).toBeNull();
  });
});

describe('parseFormat', () => {
  it.each([
    ['Paquete 6 x 125 g', 750, 'g'],
    ['Pack 4×1,5 L', 6000, 'ml'],
    ['Brick 1 L', 1000, 'ml'],
    ['Botella 1,5 L', 1500, 'ml'],
    ['Lata 33 cl', 330, 'ml'],
    ['Bote 400 g', 400, 'g'],
    ['Malla 1 kg', 1000, 'g'],
    ['Bandeja 0,5 kg', 500, 'g'],
    ['12 ud', 12, 'unit'],
    ['Caja 6 unidades', 6, 'unit'],
  ] as const)('%s', (text, netQty, netUnit) => {
    expect(parseFormat(text)).toEqual({ netQty, netUnit });
  });
  it('unknown format → null; "Lata" is not "L"', () => {
    expect(parseFormat('Lata')).toBeNull();
    expect(parseFormat('1 Lata')).toBeNull();
    expect(parseFormat('Granel')).toBeNull();
  });
});
