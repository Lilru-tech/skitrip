import { describe, expect, it } from 'vitest';
import { OFFICIAL_ADAPTERS, parsePirineu365Status, PIRINEU365_STATIONS } from '../../../src/core/parsers/official-snow';
import molina from '../../fixtures/real/pirineu365-status-15-la-molina.2026-10-03.html?raw';
import nuria from '../../fixtures/real/pirineu365-status-16-vall-de-nuria.2026-10-03.json?raw';
import unnamed from '../../fixtures/real/pirineu365-status-19-sin-nombre.2026-10-03.json?raw';
import espotReport from '../../fixtures/real/pirineu365-report-18-espot.2026-10-03.html?raw';
import molinaStatus15 from '../../fixtures/real/pirineu365-status-15-sin-nombre.2026-10-15.html?raw';
import molinaReport15 from '../../fixtures/real/pirineu365-report-15-la-molina.2026-10-15.html?raw';
import nuriaReport15 from '../../fixtures/real/pirineu365-report-16-vall-de-nuria.2026-10-15.html?raw';
import vallterReport15 from '../../fixtures/real/pirineu365-report-17-vallter.2026-10-15.html?raw';
import espotReport15 from '../../fixtures/real/pirineu365-report-18-espot.2026-10-15.html?raw';
import portAineReport15 from '../../fixtures/real/pirineu365-report-19-port-aine.2026-10-15.html?raw';
import boiReport15 from '../../fixtures/real/pirineu365-report-20-boi-taull.2026-10-15.html?raw';
import notFound15 from '../../fixtures/real/pirineu365-report-21-404.2026-10-15.html?raw';
import catalog from '../../../data/catalog.json';

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
  it('Espot desde /report (el /status devuelve el nombre vacío fuera de temporada): estación inactiva → fuera de temporada', () => {
    expect(OFFICIAL_ADAPTERS['pirineu365-espot'].parse(espotReport)).toEqual({
      opStatus: 'out_of_season', openKm: null, totalKm: null, openRuns: null, totalRuns: null, openLifts: null, totalLifts: null,
      depthMinCm: null, depthMaxCm: null, sourceDate: '2026-10-03',
    });
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
  it('forma de /report: kilometers {open, total} y stats de pistas y remontes', () => {
    const report = JSON.stringify({ success: true, data: { station_name: 'Espot', is_active: true, is_winter: true, open_status: 'open', updated: '16/01/2027 08:05', kilometers: { display: true, open: 20, total: 26 }, skislopes: { stats: { open: 18, total: 23 } }, skilifts: { stats: { open: 5, total: 7 } }, snow: { min: 40, max: 90 } } });
    expect(parsePirineu365Status(report, 'Espot')).toMatchObject({ opStatus: 'partial', openKm: 20, totalKm: 26, openRuns: 18, totalRuns: 23, openLifts: 5, totalLifts: 7, depthMinCm: 40, depthMaxCm: 90 });
  });
  it('cerrada con texto explícito de la API y valores imposibles descartados', () => {
    expect(parsePirineu365Status(winter({ is_open: 0, total: 71 }, { open_status: 'closed' }), 'La Molina')!.opStatus).toBe('closed_confirmed');
    expect(parsePirineu365Status(winter({ is_open: 90, total: 71 }), 'La Molina')).toMatchObject({ openKm: null, totalKm: null, opStatus: 'partial' });
    expect(parsePirineu365Status(winter({ is_open: 0, total: 0 }), 'La Molina')).toMatchObject({ openKm: null, totalKm: null });
  });
});

const OFF = { opStatus: 'out_of_season', openKm: null, totalKm: null, openRuns: null, totalRuns: null, openLifts: null, totalLifts: null, depthMinCm: null, depthMaxCm: null };

describe('Pirineu365 con capturas reales del 15/10/2026 (fallo de La Molina del 12/10)', () => {
  it('La Molina por /status: nombre vacío → error de identidad (lo que fallaba), nunca cifras sin nombre', () => {
    expect(() => OFFICIAL_ADAPTERS['pirineu365-la-molina'].parse(molinaStatus15)).toThrow(/se esperaba «La Molina» y la API devuelve «»/);
  });
  it('La Molina por /report: mismo número de estación con nombre → fuera de temporada, sin cifras', () => {
    expect(OFFICIAL_ADAPTERS['pirineu365-la-molina'].parse(molinaReport15)).toEqual({ ...OFF, sourceDate: '2026-10-15' });
  });
  it('Vall de Núria por /report: parte de verano abierto (telecabina) → fuera de temporada, sin remontes de esquí', () => {
    expect(OFFICIAL_ADAPTERS['pirineu365-vall-de-nuria'].parse(nuriaReport15)).toEqual({ ...OFF, sourceDate: '2026-10-15' });
  });
  it('cierre estacional con is_winter=true pero inactiva (Espot, Port Ainé) → fuera de temporada', () => {
    expect(OFFICIAL_ADAPTERS['pirineu365-espot'].parse(espotReport15)).toEqual({ ...OFF, sourceDate: '2026-10-15' });
    expect(OFFICIAL_ADAPTERS['pirineu365-port-aine'].parse(portAineReport15)).toEqual({ ...OFF, sourceDate: '2026-10-15' });
  });
  it('Boí Taüll identificada por nombre en /report (estación 20)', () => {
    expect(OFFICIAL_ADAPTERS['pirineu365-boi-taull'].parse(boiReport15)).toEqual({ ...OFF, sourceDate: '2026-10-15' });
  });
  it('nombre ajeno: la respuesta de Vallter o de La Molina no se atribuye a otra estación', () => {
    expect(() => OFFICIAL_ADAPTERS['pirineu365-boi-taull'].parse(vallterReport15)).toThrow(/se esperaba «Boí Taüll» y la API devuelve «Vallter»/);
    expect(() => OFFICIAL_ADAPTERS['pirineu365-port-aine'].parse(molinaReport15)).toThrow(/devuelve «La Molina»/);
  });
  it('número inexistente (404 de la API) → nulo, sin datos', () => {
    expect(OFFICIAL_ADAPTERS['pirineu365-la-molina'].parse(notFound15)).toBeNull();
  });
});

describe('catálogo de fuentes FGC', () => {
  const fgc = (catalog as { sources: { id: string; area: string; url: string; method: string; adapter: string | null; kind: string }[] }).sources.filter((s) => s.adapter?.startsWith('pirineu365-'));
  it('las cinco estaciones prioritarias usan /report con su número y un adaptador que existe', () => {
    expect(fgc.map((s) => s.area).sort()).toEqual(['boi-taull', 'espot-esqui', 'la-molina', 'port-aine', 'vall-de-nuria']);
    for (const s of fgc) {
      const [n] = PIRINEU365_STATIONS[s.area as keyof typeof PIRINEU365_STATIONS];
      expect(s.url).toBe(`https://api.pirineu365.cat/api/v1/web/stations/${n}/report`);
      expect(s.method).toBe('json');
      expect(OFFICIAL_ADAPTERS[s.adapter!]).toBeDefined();
    }
  });
});
