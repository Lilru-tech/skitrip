// Precio por kg / L / unidad y lectura de formatos de envase («Paquete 6 x 125 g»).

export type NetUnit = 'g' | 'ml' | 'unit';

export interface UnitPrice {
  perKgOrL_cents: number | null;
  perUnit_cents: number | null;
  label: '€/kg' | '€/L' | '€/ud';
}

/**
 * Redondeo al céntimo más cercano, mitades hacia arriba. amountCents·1000/netQty es un cociente de
 * enteros: cuando el valor exacto acaba en ,5 el resultado en coma flotante es exacto, así que
 * Math.round no sufre deriva.
 */
export function unitPrice(amountCents: number, netQty: number, netUnit: NetUnit): UnitPrice {
  const label = netUnit === 'g' ? '€/kg' : netUnit === 'ml' ? '€/L' : '€/ud';
  const ok = Number.isSafeInteger(amountCents) && amountCents >= 0 && Number.isFinite(netQty) && netQty > 0;
  if (!ok) return { perKgOrL_cents: null, perUnit_cents: null, label };
  if (netUnit === 'unit') return { perKgOrL_cents: null, perUnit_cents: Math.round(amountCents / netQty), label };
  return { perKgOrL_cents: Math.round((amountCents * 1000) / netQty), perUnit_cents: null, label };
}

export interface NetFormat {
  netQty: number;
  netUnit: NetUnit;
}

const FACTOR: Record<string, [number, NetUnit]> = {
  kg: [1000, 'g'], kgs: [1000, 'g'], g: [1, 'g'], gr: [1, 'g'], grs: [1, 'g'], gramos: [1, 'g'],
  l: [1000, 'ml'], lt: [1000, 'ml'], litro: [1000, 'ml'], litros: [1000, 'ml'], cl: [10, 'ml'], ml: [1, 'ml'],
};
const QTY = '(\\d+(?:[.,]\\d+)?)';
const UNIT = '(kgs?|grs?|gramos|g|litros?|lt|l|cl|ml)';
const END = '(?![\\p{L}\\p{N}])';

const num = (s: string) => Number(s.replace(',', '.'));

/** «Paquete 6 x 125 g» → 750 g; «Brick 1 L» → 1000 ml; «Botella 1,5 L» → 1500 ml; «12 ud» → 12. */
export function parseFormat(text: string): NetFormat | null {
  const t = text.toLowerCase().replace(/[   ]/g, ' ');
  let m = new RegExp(`(\\d{1,3})\\s*[x×]\\s*${QTY}\\s*${UNIT}${END}`, 'u').exec(t);
  if (m) {
    const [f, unit] = FACTOR[m[3]];
    const q = Math.round(+m[1] * num(m[2]) * f);
    return q > 0 ? { netQty: q, netUnit: unit } : null;
  }
  m = new RegExp(`${QTY}\\s*${UNIT}${END}`, 'u').exec(t);
  if (m) {
    const [f, unit] = FACTOR[m[2]];
    const q = Math.round(num(m[1]) * f);
    return q > 0 ? { netQty: q, netUnit: unit } : null;
  }
  m = new RegExp(`(\\d{1,4})\\s*(?:uds?\\.?|unidades|u\\.)(?![\\p{L}])`, 'u').exec(t);
  if (m && +m[1] > 0) return { netQty: +m[1], netUnit: 'unit' };
  return null;
}
