import { describe, expect, it } from 'vitest';
import { OFFICIAL_ADAPTERS, parsePirineu365Status } from '../../../src/core/parsers/official-snow';
import molina from '../../fixtures/real/pirineu365-status-15-la-molina.2026-10-03.html?raw';
import nuria from '../../fixtures/real/pirineu365-status-16-vall-de-nuria.2026-10-03.json?raw';
import unnamed from '../../fixtures/real/pirineu365-status-19-sin-nombre.2026-10-03.json?raw';

// Capturas reales de OCTUBRE (parte de verano o estación inactiva): validan el formato, el nombre y el fuera de
// temporada, NO la lectura de una estación abierta en invierno. El caso de invierno de abajo es sintético.
describe('Pirineu365 (API de FGC) con capturas reales del 03/10/2026, fuera de temporada', () => {
  it('La Molina: parte de verano → fuera de temporada, sin cifras de esquí (los remontes de verano no cuentan)', () => {
    expect(OFFICIAL_ADAPTERS['pirineu365-la-molina'].parse(molina)).toEqual({
      opStatus: 'out_of_season', openKm: null, totalKm: null, openRuns: null, totalRuns: null, openLifts: null, totalLifts: null,
      depthMinCm: null, depthMaxCm: null, sourceDate: '2026-10-02',
    });
  });
  it('Vall de Núria: nombre con acento, mismo resultado y fecha publicada', () => {
    expect(OFFICIAL_ADAPTERS['pirineu365-vall-de-nuria'].parse(nuria)).toMatchObject({ opStatus: 'out_of_season', openKm: null, sourceDate: '2026-10-03' });
  });
  it('un número de estación que devuelve otro nombre (o vacío) es un error, nunca datos de otra estación', () => {
    expect(() => OFFICIAL_ADAPTERS['pirineu365-espot'].parse(unnamed)).toThrow(/se esperaba «Espot»/);
    expect(() => OFFICIAL_ADAPTERS['pirineu365-espot'].parse(molina)).toThrow(/devuelve «La Molina»/);
  });
  it('respuesta de error o texto que no es JSON → nulo', () => {
    expect(parsePirineu365Status('{"success":false,"message":"An error occurred"}', 'Espot')).toBeNull();
    expect(parsePirineu365Status('<html><body>Página no encontrada</body></html>', 'Espot')).toBeNull();
  });
});

describe('Pirineu365 en temporada (caso SINTÉTICO con la estructura real; sin validación invernal)', () => {
  const winter = (km: object, extra: object = {}) => JSON.stringify({ success: true, data: { station_name: 'La Molina', is_active: true, is_winter: true, open_status: 'open', updated: '16/01/2027 08:05', skislopes: { is_open: 40, total: 61 }, km, skilifts: { is_open: 12, total: 15 }, snow: { min: 30, max: 80 }, ...extra } });
  it('abierta parcialmente: km, pistas, remontes y espesores', () => {
    expect(parsePirineu365Status(winter({ is_open: 45.5, total: 71 }), 'La Molina')).toEqual({
      opStatus: 'partial', openKm: 45.5, totalKm: 71, openRuns: 40, totalRuns: 61, openLifts: 12, totalLifts: 15, depthMinCm: 30, depthMaxCm: 80, sourceDate: '2027-01-16',
    });
  });
  it('cerrada con texto explícito de la API y valores imposibles descartados', () => {
    expect(parsePirineu365Status(winter({ is_open: 0, total: 71 }, { open_status: 'closed' }), 'La Molina')!.opStatus).toBe('closed_confirmed');
    expect(parsePirineu365Status(winter({ is_open: 90, total: 71 }), 'La Molina')).toMatchObject({ openKm: null, totalKm: null, opStatus: 'partial' });
    expect(parsePirineu365Status(winter({ is_open: 0, total: 0 }), 'La Molina')).toMatchObject({ openKm: null, totalKm: null });
  });
});
