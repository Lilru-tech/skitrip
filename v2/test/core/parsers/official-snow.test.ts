import { describe, expect, it } from 'vitest';
import { parseGrandvalira } from '../../../src/core/parsers/official-snow';
import real from '../../fixtures/real/grandvalira-estado-pistas.2026-09-30.txt?raw';

describe('Grandvalira (web oficial) con texto real del 30/09/2026', () => {
  const r = parseGrandvalira(real)!;
  it('extrae km, pistas, remontes, espesores y fecha publicada', () => {
    expect(r).toMatchObject({ openKm: 0, totalKm: 215, openRuns: 0, totalRuns: 142, openLifts: 4, totalLifts: 73, depthMinCm: 0, depthMaxCm: 0, sourceDate: '2026-09-23' });
  });
  it('0 km fuera de temporada no se interpreta como cerrado confirmado: estado desconocido', () => {
    expect(r.opStatus).toBe('unknown');
  });
  it('mismo contenido en HTML con etiquetas y saltos: mismo resultado', () => {
    const html = '<div class="dash"><span>Km esquiables</span> <b>35</b> / <b>215</b></div><p>Pistas <b>40 / 142</b></p><p>Instalaciones 30 / 73</p><p>Espesores de nieve (cm) 20-60</p><p>Última actualización: Sáb, 16/01/2027 - 08:05</p>';
    expect(parseGrandvalira(html)).toMatchObject({ openKm: 35, totalKm: 215, openRuns: 40, openLifts: 30, depthMinCm: 20, depthMaxCm: 60, sourceDate: '2027-01-16', opStatus: 'partial' });
  });
  it('sin la línea de km no inventa nada', () => {
    expect(parseGrandvalira('<p>Instalaciones 4 / 73</p>')).toBeNull();
  });
});

// Extractos reales del 01/10/2026 (fuera de temporada). Ver la cabecera de cada fixture.
import gvSect from '../../fixtures/real/grandvalira-sectores.2026-10-01.txt?raw';
import arcalis from '../../fixtures/real/ordino-arcalis-estado-pistas.2026-10-01.txt?raw';
import pal from '../../fixtures/real/pal-arinsal-parte-nieve.2026-10-01.txt?raw';
import pdc from '../../fixtures/real/port-del-comte-pistes.2026-10-01.txt?raw';
import cerler from '../../fixtures/real/cerler-parte-nieve.2026-10-01.txt?raw';
import formigal from '../../fixtures/real/formigal-panticosa-parte-nieve.2026-10-01.txt?raw';
import { ARCALIS_SECTORS, GRANDVALIRA_SECTORS, OFFICIAL_ADAPTERS, PAL_ARINSAL_SECTORS, parseAndorra, parseAndorraSectors, parseAramon, parsePortDelComte } from '../../../src/core/parsers/official-snow';

describe('Andorra (plantilla común) con textos reales del 01/10/2026', () => {
  it('Grandvalira: dominio con km y los 7 sectores con su estado, sin km por sector', () => {
    const r = parseAndorra(gvSect, GRANDVALIRA_SECTORS)!;
    expect(r).toMatchObject({ openKm: 0, totalKm: 215, openRuns: 0, totalRuns: 142, openLifts: 4, totalLifts: 73, sourceDate: '2026-09-30' });
    // Todos los sectores dicen «Cerrado» con texto explícito: cerrado confirmado (no se deduce del 0).
    expect(r.opStatus).toBe('closed_confirmed');
    const sectors = parseAndorraSectors(gvSect, GRANDVALIRA_SECTORS);
    expect(sectors.map((s) => s.name)).toEqual([...GRANDVALIRA_SECTORS]);
    expect(sectors.every((s) => s.state === 'closed')).toBe(true);
    expect(sectors.find((s) => s.name === 'Encamp')).toMatchObject({ openLifts: 0, totalLifts: 7, openRuns: 0, totalRuns: 16 });
    expect(sectors.find((s) => s.name === 'Canillo')).toMatchObject({ openLifts: 3, totalLifts: 9, openRuns: 0, totalRuns: 15 });
    expect(sectors.find((s) => s.name === 'El Tarter')).toMatchObject({ totalLifts: 12, totalRuns: 21 });
    expect(Object.keys(sectors[0])).not.toContain('openKm');
  });

  it('Ordino Arcalís: sin km publicados (null, no 0), pistas, instalaciones y fecha', () => {
    const r = parseAndorra(arcalis, ARCALIS_SECTORS)!;
    expect(r).toMatchObject({ openKm: null, totalKm: null, openRuns: 0, totalRuns: 27, openLifts: 1, totalLifts: 2, depthMinCm: 0, depthMaxCm: 0, sourceDate: '2026-10-01', opStatus: 'closed_confirmed' });
  });

  it('Pal Arinsal: dos sectores cerrados, totales del dominio aunque el texto los repita', () => {
    const r = parseAndorra(pal, PAL_ARINSAL_SECTORS)!;
    expect(r).toMatchObject({ openKm: null, openRuns: 0, totalRuns: 47, openLifts: 0, totalLifts: 5, sourceDate: '2026-09-30', opStatus: 'closed_confirmed' });
    expect(parseAndorraSectors(pal, PAL_ARINSAL_SECTORS).map((s) => [s.name, s.state, s.totalLifts])).toEqual([['Pal', 'closed', 5], ['Arinsal', 'closed', null]]);
  });

  it('en temporada (texto sintético con la misma plantilla): parcial por pistas si no hay km', () => {
    const t = 'Última actualización: Sáb, 16/01/2027 - 08:05 Pistas 20 / 27 Instalaciones 2 / 2 Espesores de nieve (cm) 40-90 Ordino Arcalís Parcialmente abierto Instalaciones 2 / 2';
    expect(parseAndorra(t, ARCALIS_SECTORS)).toMatchObject({ opStatus: 'partial', openRuns: 20, depthMaxCm: 90, sourceDate: '2027-01-16' });
    expect(parseAndorra('<p>Nada que ver</p>', ARCALIS_SECTORS)).toBeNull();
  });
});

describe('Port del Comte con texto real (último parte de la temporada)', () => {
  it('estación «TANCAT» explícita, km 0,0, 31 pistas y 13 remontes contados por ficha, fecha del parte', () => {
    expect(parsePortDelComte(pdc)).toMatchObject({
      opStatus: 'closed_confirmed', openKm: 0, totalKm: null, openRuns: 0, totalRuns: 31, openLifts: 0, totalLifts: 13, depthMinCm: 0, depthMaxCm: 0, sourceDate: '2026-04-05',
    });
  });
});

describe('Aramón con textos reales (fin de temporada)', () => {
  it('Cerler y Formigal-Panticosa: fuera de temporada con la fecha de emisión real, sin cifras inventadas', () => {
    for (const [txt, date] of [[cerler, '2026-04-05'], [formigal, '2026-04-05']] as const) {
      expect(parseAramon(txt)).toMatchObject({ opStatus: 'out_of_season', sourceDate: date, openKm: null, openRuns: null, openLifts: null });
    }
  });
  it('sin la línea «Emitido…» no devuelve nada', () => {
    expect(parseAramon('<p>Estación cerrada</p>')).toBeNull();
  });
});

describe('registro de adaptadores oficiales', () => {
  it('cada adaptador nuevo lee su fixture real', () => {
    expect(OFFICIAL_ADAPTERS['grandvalira-official'].parse(gvSect)?.totalKm).toBe(215);
    expect(OFFICIAL_ADAPTERS['ordino-arcalis-official'].parse(arcalis)?.totalRuns).toBe(27);
    expect(OFFICIAL_ADAPTERS['pal-arinsal-official'].parse(pal)?.totalRuns).toBe(47);
    expect(OFFICIAL_ADAPTERS['port-del-comte-official'].parse(pdc)?.totalLifts).toBe(13);
    expect(OFFICIAL_ADAPTERS['aramon-official'].parse(cerler)?.opStatus).toBe('out_of_season');
  });
});
