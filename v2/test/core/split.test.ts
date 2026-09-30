import { describe, expect, it } from 'vitest';
import { balances, splitEqual, suggestTransfers, sumShares } from '../../src/core/split';

describe('reparto de gastos', () => {
  it('10 € entre tres personas suma exactamente 10 €', () => {
    const s = splitEqual(1000, ['c', 'a', 'b']);
    expect(sumShares(s.values())).toBe(1000);
    expect([...s.values()].sort()).toEqual([333, 333, 334]);
  });
  it('el residuo es determinista e independiente del orden', () => {
    expect(splitEqual(1001, ['b', 'a', 'c'])).toEqual(splitEqual(1001, ['c', 'b', 'a']));
    expect(splitEqual(1001, ['b', 'a', 'c']).get('a')).toBe(334);
  });
  it('los saldos suman cero y una transferencia no crea un gasto nuevo', () => {
    const shares = splitEqual(1000, ['a', 'b', 'c']);
    const exp = [{ payerId: 'a', amountCents: 1000, shares }];
    const b = balances(exp);
    expect(sumShares(b.values())).toBe(0);
    expect(b.get('a')).toBe(1000 - shares.get('a')!);
    const t = suggestTransfers(b);
    const after = balances(exp, t);
    expect([...after.values()].every((v) => v === 0)).toBe(true);
    expect(exp).toHaveLength(1);
  });
  it('rechaza total negativo y lista vacía', () => {
    expect(() => splitEqual(-1, ['a'])).toThrow();
    expect(() => splitEqual(10, [])).toThrow();
  });
});
