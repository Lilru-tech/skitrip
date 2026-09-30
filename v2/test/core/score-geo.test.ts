import { describe, expect, it } from 'vitest';
import { haversineKm, validateRoutes } from '../../src/core/geo';
import { scoreRows } from '../../src/core/score';

describe('puntuación', () => {
  it('no premia datos faltantes', () => {
    const r = scoreRows([
      { id: 'completo', costPerPersonCents: 30000, roadKm: 200, totalKm: 100, openKmNow: 50, vibe: 5 },
      { id: 'sin-precio', costPerPersonCents: null, roadKm: 200, totalKm: 100, openKmNow: 50, vibe: 5 },
    ]);
    expect(r[0].id).toBe('completo');
    expect(r[1].missing).toContain('cost');
    expect(r[1].coverage).toBeLessThan(1);
  });
});

describe('rutas', () => {
  const o = { lat: 41.1189, lon: 1.2445 };
  it('detecta carretera más corta que la línea recta', () => {
    const area = { lat: 42.8, lon: -0.5 };
    expect(validateRoutes([{ originId: 't', areaId: 'x', roadKm: 100, origin: o, area }])[0].issue).toMatch(/menor/);
  });
  it('detecta incoherencia entre áreas vecinas', () => {
    const a = { lat: 42.806, lon: -0.504 }, b = { lat: 42.781, lon: -0.538 };
    expect(haversineKm(a, b)).toBeLessThan(12);
    const issues = validateRoutes([{ originId: 't', areaId: 'astun', roadKm: 315, origin: o, area: a }, { originId: 't', areaId: 'candanchu', roadKm: 405, origin: o, area: b }]);
    expect(issues.some((i) => /incoherente/.test(i.issue))).toBe(true);
  });
});
