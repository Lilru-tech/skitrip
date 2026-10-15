import { describe, expect, it } from 'vitest';
import { insightsTable, redactSql } from '../../tools/d1-insights';

describe('consultas de D1 con más lecturas', () => {
  it('no imprime literales: correos, UID, fechas ni importes', () => {
    const q = redactSql(`DELETE FROM users WHERE email = 'prod-check-123-p@example.com' AND firebase_uid IN ('aB9xYz', 'it''s')\n AND created_at < 1760000000000 AND x = X'0aff' AND price = 12.5`);
    expect(q).toBe('DELETE FROM users WHERE email = ? AND firebase_uid IN (?, ?) AND created_at < ? AND x = ? AND price = ?');
    expect(redactSql('SELECT * FROM t WHERE a = ?1 AND b = ?2 LIMIT 120')).toBe('SELECT * FROM t WHERE a = ?1 AND b = ?2 LIMIT ?');
    expect(redactSql('SELECT s.*, src.priority FROM sources src')).toBe('SELECT s.*, src.priority FROM sources src');
  });

  it('ordena por filas leídas y da el porcentaje sobre el total listado', () => {
    const t = insightsTable([
      { query: 'SELECT 1', totalRowsRead: 100, avgRowsRead: 10, numberOfTimesRun: 10 },
      { query: "SELECT * FROM legacy_snow_observations WHERE scope_area_id = 'la-molina'", totalRowsRead: 900, avgRowsRead: 5394, numberOfTimesRun: 1 },
    ], 5);
    expect(t[0]).toContain('1000');
    expect(t[4]).toContain('| 900 | 90.0 | 1 |');
    expect(t[4]).toContain('scope_area_id = ?');
    expect(t.join('\n')).not.toContain('la-molina');
  });
});
