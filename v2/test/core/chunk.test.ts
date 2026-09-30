import { describe, expect, it } from 'vitest';
import { chunkBy } from '../../src/core/chunk';

describe('chunkBy', () => {
  it('respeta peso y número máximos sin partir elementos y conserva el orden', () => {
    const items = Array.from({ length: 19 }, (_, i) => ({ i, n: 60 }));
    const parts = chunkBy(items, (x) => x.n, 200, 60);
    expect(parts.every((p) => p.reduce((k, x) => k + x.n, 0) <= 200)).toBe(true);
    expect(parts.flat().map((x) => x.i)).toEqual(items.map((x) => x.i));
    expect(parts).toHaveLength(7); // 3 por parte
  });
  it('lista vacía = una parte vacía (la ejecución se registra igualmente)', () => {
    expect(chunkBy([], () => 1, 200)).toEqual([[]]);
  });
  it('un elemento más pesado que el máximo es un error explícito', () => {
    expect(() => chunkBy([{ n: 201 }], (x) => x.n, 200)).toThrow(/no cabe/);
  });
});
