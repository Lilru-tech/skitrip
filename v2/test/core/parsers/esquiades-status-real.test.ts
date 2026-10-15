import { describe, expect, it } from 'vitest';
import { esquiadesUpdateDate, matchResortRow, parseEsquiadesStatusHtml } from '../../../src/core/parsers/snow';
import page from '../../fixtures/real/esquiades-estado-pistas.2026-10-15.html?raw';
import catalog from '../../../data/catalog.json';

// Captura real de octubre (estaciones cerradas). Valida la estructura, los nombres, los totales y la fecha del parte;
// NO valida una estación abierta en invierno (cifras de abiertos y si «Pistas N» sigue siendo el total).
describe('Esquiades «estado de pistas»: captura real del 15/10/2026', () => {
  const rows = parseEsquiadesStatusHtml(page);
  it('una fila por estación (antes: 0, la fecha «08/10/2026» de la última nevada se contaba como par «x / y»)', () => {
    expect(rows.map((r) => r.name)).toEqual(['Grandvalira', 'Vallnord Pal-Arinsal', 'Ordino-Arcalís', 'Boí Taüll', 'Port Ainé', 'Espot Esquí', 'Baqueira Beret',
      'La Molina', 'Masella', 'Vall de Núria', 'Port del Comte', 'Vallter 2000', 'Formigal', 'Cerler', 'Panticosa', 'Astún y Candanchú']);
  });
  it('cerrada: km abiertos «-» es desconocido (nunca 0); «Pistas 142» es el total, abiertas desconocidas; fecha del bloque', () => {
    expect(rows[0]).toEqual({
      name: 'Grandvalira', nameNorm: 'grandvalira', region: 'Andorra', statusText: 'Cerrada', opStatus: 'closed_confirmed',
      openKm: null, totalKm: 215, openRuns: null, totalRuns: 142, flags: [], sourceDate: '2026-10-14',
    });
    expect(rows.find((r) => r.name === 'La Molina')).toMatchObject({ totalKm: 71, totalRuns: 66, region: 'Pirineo Catalán' });
  });
  it('fecha del parte solo si el texto es inequívoco', () => {
    expect(esquiadesUpdateDate('Última actualización del 14 de Octubre de 2026 a las 05:45')).toBe('2026-10-14');
    expect(esquiadesUpdateDate('Última actualización del 14 de Octubre de 2026 · Última actualización del 13 de Octubre de 2026')).toBeNull();
    expect(esquiadesUpdateDate('sin fecha')).toBeNull();
  });
  it('cada fuente del catálogo encuentra su fila o queda explícitamente sin fila (nunca suma estaciones)', () => {
    const sources = (catalog as { sources: { id: string; adapter: string | null; aliases: string[] | null }[] }).sources.filter((s) => s.adapter === 'esquiades-status');
    const found = Object.fromEntries(sources.map((s) => {
      for (const a of s.aliases ?? []) { const m = matchResortRow(rows, [a]); if (m.match) return [s.id, m.match.name]; }
      return [s.id, null];
    }));
    expect(found).toMatchObject({
      'esquiades-status-la-molina': 'La Molina', 'esquiades-status-boi-taull': 'Boí Taüll', 'esquiades-status-port-aine': 'Port Ainé',
      'esquiades-status-astun-candanchu': 'Astún y Candanchú', 'esquiades-status-pal-arinsal': 'Vallnord Pal-Arinsal',
      // Esquiades publica La Molina y Masella por separado, y Formigal y Panticosa por separado: el área combinada no tiene fila.
      'esquiades-status-alp-2500': null, 'esquiades-status-formigal-panticosa': null,
    });
  });
});
