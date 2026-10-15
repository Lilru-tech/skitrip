import { describe, expect, it } from 'vitest';
import { OFFICIAL_ADAPTERS } from '../../src/core/parsers/official-snow';
import { parseEsquiadesStatusHtml } from '../../src/core/parsers/snow';
import { aggregatorSnowOutcome, officialSnowOutcome, snowFailure } from '../../src/core/snow-outcome';
import molinaStatus15 from '../fixtures/real/pirineu365-status-15-sin-nombre.2026-10-15.html?raw';
import molinaReport15 from '../fixtures/real/pirineu365-report-15-la-molina.2026-10-15.html?raw';
import notFound15 from '../fixtures/real/pirineu365-report-21-404.2026-10-15.html?raw';
import esquiades15 from '../fixtures/real/esquiades-estado-pistas.2026-10-15.html?raw';

// El mismo resultado para el recolector, la comprobación online, la ingesta y las vistas.
describe('resultado común de una fuente de nieve', () => {
  const molina = OFFICIAL_ADAPTERS['pirineu365-la-molina'].parse;
  const official = (html: string) => { try { return officialSnowOutcome(html, molina); } catch (e) { return snowFailure(e, false); } };
  it('oficial fuera de temporada → correcta, con el motivo informativo y los datos', () => {
    expect(official(molinaReport15)).toMatchObject({ status: 'ok', reason: 'off_season', data: { opStatus: 'out_of_season' } });
  });
  it('oficial con otro nombre o vacío → error de identidad, sin datos (no «transporte» ni «sin datos»)', () => {
    expect(official(molinaStatus15)).toMatchObject({ status: 'error', reason: 'identity_mismatch', data: null });
  });
  it('404 real de la API → transporte (cuenta como fallo); «sin parte» dicho por la fuente → sin parte publicado; irreconocible → formato', () => {
    expect(official(notFound15)).toMatchObject({ status: 'error', reason: 'transport' });
    expect(official('{"success":false,"message":"An error occurred"}')).toMatchObject({ status: 'error', reason: 'transport' });
    expect(official('<html><body><p>Parte no disponible: la estación aún no ha publicado el parte.</p></body></html>')).toMatchObject({ status: 'empty', reason: 'no_report' });
    expect(official('<html><body><div>Mantenimiento</div></body></html>')).toMatchObject({ status: 'error', reason: 'unknown_structure' });
  });
  it('bloqueo y transporte se distinguen', () => {
    expect(snowFailure(new Error('HTTP 403'), true)).toMatchObject({ status: 'blocked', reason: null });
    expect(snowFailure(new Error('net::ERR_TIMED_OUT'), false)).toMatchObject({ status: 'error', reason: 'transport' });
  });
  it('agregador: fila exacta, estación que la página no incluye y página sin filas', () => {
    const rows = parseEsquiadesStatusHtml(esquiades15);
    expect(aggregatorSnowOutcome(rows, ['la molina'])).toMatchObject({ status: 'ok', reason: null, data: { name: 'La Molina', opStatus: 'closed_confirmed' } });
    expect(aggregatorSnowOutcome(rows, ['alp 2500 la molina masella', 'alp 2500'])).toMatchObject({ status: 'error', reason: 'not_listed', data: null });
    // Antes el recolector lo guardaba como «empty» (sin datos) y la comprobación como «incompatible»: ahora ambos, formato no reconocido.
    expect(aggregatorSnowOutcome([], ['la molina'])).toMatchObject({ status: 'error', reason: 'unknown_structure' });
  });
});
