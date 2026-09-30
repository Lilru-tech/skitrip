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
