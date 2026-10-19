import { describe, expect, it } from 'vitest';
import {
  auditRunCatalog, countRunList, domainRunTotal, entryCatalogRuns, entryRunsNow, runCatalogView, runEntryFromJson, runsNow,
  type RunCatalogEntry, type RunCatalogJson, type RunListJson,
} from '../../src/core/runs';
import { OFFICIAL_ADAPTERS } from '../../src/core/parsers/official-snow';
import catalogJson from '../../data/catalog.json';
import runLists from '../../data/run-lists.json';
import gvSect from '../fixtures/real/grandvalira-sectores.2026-10-01.txt?raw';
import gvReport from '../fixtures/real/grandvalira-estado-pistas.2026-09-30.txt?raw';
import pal from '../fixtures/real/pal-arinsal-parte-nieve.2026-10-01.txt?raw';
import arcalis from '../fixtures/real/ordino-arcalis-estado-pistas.2026-10-01.txt?raw';
import pdc from '../fixtures/real/port-del-comte-pistes.2026-10-01.txt?raw';

const catalog = catalogJson as unknown as { areas: { id: string }[]; run_catalog: RunCatalogJson[] };
const lists = (runLists as unknown as { lists: RunListJson[] }).lists;
const REAL: Record<string, string> = { gvSect, gvReport, pal, arcalis, pdc };
const real = (k: string) => REAL[k];
const entry = (o: Partial<RunCatalogEntry> = {}): RunCatalogEntry => ({
  areaId: 'x', total: 40, green: 10, blue: 10, red: 10, black: 10, basis: 'aggregate', comparable: true, season: null, sourceDate: null,
  checkedOn: '2026-10-19', sourceUrl: 'https://example.invalid', mapUrl: null, limitations: null, ...o,
});
const NOW = Date.parse('2027-01-16T10:00:00Z');
const report = (o: Record<string, unknown> = {}) => ({ observedAt: NOW - 3600_000, opStatus: 'partial', quality: 'ok', sourceDate: '2027-01-16', openRuns: 20, totalRuns: 40, ...o });

describe('listados individuales', () => {
  it('cuenta por identificador oficial: un duplicado (otro idioma o sector) cuenta una vez y un conflicto se señala', () => {
    const c = countRunList([
      { id: '1', name: 'Debutantes', colour: 'green' }, { id: '1', name: 'Beginners', colour: 'green' },
      { id: '2', name: 'Tobazo', colour: 'red' }, { id: '2', name: 'Tobazo', colour: 'black' },
    ]);
    expect(c.total).toBe(2);
    expect(c.duplicates).toEqual(['1']);
    expect(c.conflicts).toEqual(['2']);
  });
  it('no suma snowparks, trineos, fondo, itinerarios, fuera pista ni nocturno; no fusiona tramos por nombre', () => {
    const c = countRunList([
      { id: 'a', name: 'Alto Aragón superior', colour: 'red' }, { id: 'b', name: 'Alto Aragón inferior', colour: 'red' },
      { id: 'c', name: 'Snow Park', colour: 'blue', kind: 'snowpark' }, { id: 'd', name: 'Trineos', colour: 'green', kind: 'sledge' },
      { id: 'e', name: 'Fondo', colour: null, kind: 'nordic' }, { id: 'f', name: 'Ruta', colour: null, kind: 'itinerary' },
      { id: 'g', name: 'El Bosquet', colour: null, kind: 'freeride' }, { id: 'h', name: 'Nocturna', colour: 'blue', kind: 'night' },
      { id: 'i', name: 'Sin color', colour: null },
    ]);
    expect(c).toMatchObject({ total: 3, byColour: { green: 0, blue: 0, red: 2, black: 0 }, withoutColour: 1 });
    expect(c.excluded.map((x) => x.kind)).toEqual(['snowpark', 'sledge', 'nordic', 'itinerary', 'freeride', 'night']);
  });
});

describe('catálogo de pistas', () => {
  it('un dato ausente no es cero: sin total no hay cifra comparable; un 0 publicado sí lo es', () => {
    expect(runCatalogView(entry({ total: null, green: null, blue: null, red: null, black: null }))).toMatchObject({ total: null, comparableTotal: null, issues: ['sin_total'] });
    expect(runCatalogView(entry({ total: 0, green: 0, blue: 0, red: 0, black: 0 }))?.comparableTotal).toBe(0);
    expect(runCatalogView(null)).toBeNull();
  });
  it('desglose incoherente: se conservan las cifras y el total no puntúa (no se ajusta para que sume)', () => {
    const v = runCatalogView(entry({ total: 41, green: 17, blue: 12, red: 9, black: 9 }))!;
    expect(v).toMatchObject({ total: 41, byColour: { green: 17, blue: 12, red: 9, black: 9 }, breakdownComplete: false, comparableTotal: null });
    expect(v.issues).toContain('desglose_no_cuadra');
    expect(runCatalogView(entry({ total: 10, green: 8, blue: 5, red: null, black: null }))!.issues).toContain('desglose_supera_total');
  });
  it('desglose parcial: los colores que faltan quedan sin dato, nunca se reparten', () => {
    const v = runCatalogView(entry({ total: 38, green: null, blue: null, red: null, black: null }))!;
    expect(v).toMatchObject({ comparableTotal: 38, breakdownComplete: false, byColour: { green: null, blue: null, red: null, black: null } });
  });
  it('no comparable (mezcla zonas o cifras oficiales que no cuadran): se muestra, no puntúa', () => {
    expect(runCatalogView(entry({ comparable: false }))).toMatchObject({ total: 40, comparableTotal: null, issues: ['no_comparable'] });
  });
  it('cifras que no son enteros no negativos no valen', () => {
    expect(runCatalogView(entry({ total: -1 }))).toMatchObject({ total: null, comparableTotal: null });
    expect(runCatalogView(entry({ green: 2.5 }))!.issues).toContain('no_entero');
  });
});

describe('dominios y estaciones', () => {
  it('un dominio con cifra propia comparable usa la suya y no la suma con sus estaciones', () => {
    const r = entryCatalogRuns(entry({ areaId: 'dom', total: 131, green: 29, blue: 45, red: 45, black: 12 }), [entry({ total: 66, green: 20, blue: 18, red: 22, black: 6 })]);
    expect(r).toMatchObject({ comparableTotal: 131, via: 'own' });
  });
  it('sin cifra propia comparable, la suma de sus estaciones solo si todas la tienen', () => {
    const a = entry({ total: 57, green: 3, blue: 18, red: 19, black: 17 }), b = entry({ total: 57, green: 12, blue: 14, red: 18, black: 13 });
    expect(entryCatalogRuns(entry({ total: 110, green: 14, blue: 31, red: 35, black: 30, comparable: false }), [a, b]))
      .toMatchObject({ comparableTotal: 114, via: 'members', byColour: { green: 15, blue: 32, red: 37, black: 30 }, own: { total: 110 } });
    expect(entryCatalogRuns(null, [a, null])).toMatchObject({ comparableTotal: null, via: null });
    expect(domainRunTotal([])).toBeNull();
  });
});

describe('parte actual separado del catálogo', () => {
  it('abiertas del parte vigente, con su total y colores del mismo parte', () => {
    const r = runsNow(report({ openRunsByColour: { green: 5, blue: 8, red: 6, black: 1 } }), NOW, { green: 10, blue: 10, red: 10, black: 10 });
    expect(r).toMatchObject({ open: 20, total: 40, byColour: { green: 5, blue: 8, red: 6, black: 1 }, excluded: null });
  });
  it('parte caducado, capturado hace mucho, dudoso o de estado desconocido: sin abiertas (nunca el total del catálogo)', () => {
    expect(runsNow(report({ sourceDate: '2027-01-10' }), NOW)).toMatchObject({ open: null, excluded: 'parte_antiguo' });
    expect(runsNow(report({ observedAt: NOW - 3 * 86400_000 }), NOW)).toMatchObject({ open: null, excluded: 'antiguo' });
    expect(runsNow(report({ quality: 'suspect' }), NOW)).toMatchObject({ open: null, excluded: 'dudoso' });
    expect(runsNow(report({ opStatus: 'unknown' }), NOW)).toMatchObject({ open: null, excluded: 'estado_desconocido' });
    expect(runsNow(null, NOW)).toMatchObject({ open: null, excluded: 'sin_dato' });
  });
  it('ausente no es cero; un cierre confirmado da 0 deducido del cierre, sin desglose por colores', () => {
    expect(runsNow(report({ openRuns: null }), NOW)).toMatchObject({ open: null, excluded: 'sin_pistas' });
    expect(runsNow(report({ opStatus: 'closed_confirmed', openRuns: null, totalRuns: null }), NOW)).toMatchObject({ open: 0, derivedFromClosure: true, byColour: null });
  });
  it('más abiertas que totales: no vale; colores que no cuadran con las abiertas: se descartan y se dice', () => {
    expect(runsNow(report({ openRuns: 45 }), NOW)).toMatchObject({ open: null, excluded: 'abiertas_superan_total' });
    const r = runsNow(report({ openRunsByColour: { green: 5, blue: 5, red: 5, black: 1 } }), NOW);
    expect(r).toMatchObject({ open: 20, byColour: null });
    expect(r.colourIssue).toMatch(/suman 16/);
    expect(runsNow(report({ openRunsByColour: { green: 12, blue: 8, red: 0, black: 0 } }), NOW, { green: 10, blue: 10, red: 10, black: 10 }).byColour).toBeNull();
  });
  it('un dominio sin parte propio suma sus estaciones solo si todas tienen parte vigente', () => {
    expect(entryRunsNow(null, [report(), report({ openRuns: 5, totalRuns: 10 })], NOW)).toMatchObject({ open: 25, total: 50, via: 'members' });
    expect(entryRunsNow(null, [report(), report({ sourceDate: '2027-01-01' })], NOW)).toMatchObject({ open: null, excluded: 'parte_antiguo' });
  });
});

describe('datos reales: catálogo, listados y partes oficiales', () => {
  it('el catálogo pasa la revisión y cubre todas las áreas; los recuentos individuales coinciden con sus listados', () => {
    const areaIds = new Set<string>(catalog.areas.map((a: { id: string }) => a.id));
    const audit = auditRunCatalog(catalog.run_catalog, lists, areaIds);
    expect(audit).toEqual({ errors: [], warnings: [] });
    expect(new Set(catalog.run_catalog.map((r: RunCatalogJson) => r.area))).toEqual(areaIds);
  });
  it('la revisión detecta un recuento individual que no coincide con su listado', () => {
    const bad = catalog.run_catalog.map((r: RunCatalogJson) => (r.area === 'astun' ? { ...r, total: 59 } : r));
    expect(auditRunCatalog(bad, lists, new Set(catalog.areas.map((a: { id: string }) => a.id))).errors.join()).toMatch(/astun: el catálogo/);
  });
  it('Astún: 59 entradas numeradas, sin la 3 (trineos) ni la 19 (snowpark) quedan 57', () => {
    const c = countRunList(lists.find((l) => l.area === 'astun')!.runs);
    expect(c).toMatchObject({ total: 57, byColour: { green: 3, blue: 18, red: 19, black: 17 }, duplicates: [], conflicts: [] });
    expect(c.excluded.map((x) => x.id)).toEqual(['3', '19']);
  });
  it('los totales del catálogo coinciden con los partes oficiales capturados (Andorra y Port del Comte)', () => {
    const cat = (id: string) => runEntryFromJson(catalog.run_catalog.find((r: RunCatalogJson) => r.area === id)!);
    for (const [area, adapter, file] of [
      ['grandvalira', 'grandvalira-official', 'gvSect'],
      ['pal-arinsal', 'pal-arinsal-official', 'pal'],
      ['ordino-arcalis', 'ordino-arcalis-official', 'arcalis'],
      ['port-del-comte', 'port-del-comte-official', 'pdc'],
    ] as const) {
      const p = OFFICIAL_ADAPTERS[adapter].parse(real(file))!;
      const c = cat(area);
      expect([p.totalRuns, p.totalRunsByColour], area).toEqual([c.total, { green: c.green, blue: c.blue, red: c.red, black: c.black }]);
    }
  });
  it('los partes de Andorra publican abiertas por color; fuera de temporada son 0 de cada total', () => {
    const p = OFFICIAL_ADAPTERS['grandvalira-official'].parse(real('gvReport'))!;
    expect(p).toMatchObject({ openRuns: 0, totalRuns: 142, openRunsByColour: { green: 0, blue: 0, red: 0, black: 0 }, totalRunsByColour: { green: 23, blue: 53, red: 46, black: 20 } });
  });
});
