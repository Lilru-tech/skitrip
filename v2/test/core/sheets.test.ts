import { describe, expect, it } from 'vitest';
import { parseCsv } from '../../src/core/csv';
import { mapAvailability, mapComments, mapShopping, sheetDate } from '../../src/core/sheets';

describe('CSV', () => {
  it('detecta «;» y respeta la coma decimal, comillas y saltos de línea', () => {
    expect(parseCsv('﻿name;price\n"Pan; de molde";1,35\n"a\nb";2\n')).toEqual([['name', 'price'], ['Pan; de molde', '1,35'], ['a\nb', '2']]);
    expect(parseCsv('a,b\n"x ""y""",1\n')).toEqual([['a', 'b'], ['x "y"', '1']]);
  });
});

describe('importadores de Sheets', () => {
  it('fechas: D/M/AAAA, ISO y un instante de Apps Script a medianoche de Madrid', () => {
    expect(sheetDate('9/1/2026')).toEqual({ date: '2026-01-09', shifted: false });
    expect(sheetDate('2026-02-30').date).toBeNull();
    expect(sheetDate('2026-01-09T23:00:00.000Z')).toEqual({ date: '2026-01-10', shifted: true });
  });

  it('disponibilidad: una fila sin estado es «ocupado» y los días ausentes no se inventan', () => {
    const m = mapAvailability('date,user\n10/01/2026,Núria\n12/01/2026,Núria\n10/01/2026,Núria\n');
    expect(m.errors).toEqual([]);
    expect(m.rows.map((r) => [r.day, r.mapped])).toEqual([['2026-01-10', 'busy'], ['2026-01-12', 'busy']]);
    expect(m.duplicates).toBe(1);
    expect(m.rows.some((r) => r.day === '2026-01-11')).toBe(false);
  });

  it('disponibilidad: estados desconocidos se conservan sin interpretar y las fechas malas son errores', () => {
    const m = mapAvailability('fecha;usuario;estado\n2026-01-10;Pau;quizá\n2026-01-11;Pau;no\n31/02/2026;Pau;libre\n');
    expect(m.rows.map((r) => r.mapped)).toEqual(['maybe', null]);
    expect(m.rows[1].legacyStatus).toBe('no');
    expect(m.errors).toHaveLength(1);
    expect(m.warnings[0].message).toMatch(/sin equivalencia/);
  });

  it('comentarios: «global» de la hoja real es un comentario general, no una estación desconocida', () => {
    const m = mapComments('id,resort_id,text,user,created_at,updated_at\n120f,global,En Andorra no hay datos moviles,David,1765720759854,1765720759854\n', new Set(['grandvalira']));
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0].resortId).toBe('global');
    expect(m.warnings).toEqual([]);
  });

  it('comentarios: sin publicar ni asignar, avisa de estaciones desconocidas y exige texto', () => {
    const m = mapComments('id,resort_id,user,text\n1,grandvalira,Ana,Hola\n2,inventada,Ana,Otro\n3,grandvalira,Ana,\n', new Set(['grandvalira']));
    expect(m.rows).toHaveLength(2);
    expect(m.warnings.some((w) => /desconocida/.test(w.message))).toBe(true);
    expect(m.errors).toEqual([{ line: 4, message: 'comentario vacío' }]);
    expect(mapComments('user\nAna\n', new Set()).errors[0].message).toMatch(/falta la columna/);
  });

  it('compra: el precio queda como texto y las columnas extra se conservan', () => {
    const m = mapShopping('id;name;quantity;price;per\ng1;Pan;2;1,35;grupo\ng2;Leche;1;barato;\n');
    expect(m.rows[0]).toMatchObject({ name: 'Pan', quantityText: '2', priceText: '1,35', extra: { id: 'g1', per: 'grupo' } });
    expect(m.warnings[0].message).toMatch(/no numérico/);
  });
});
