import { describe, expect, it } from 'vitest';
import { isGeneralScope, legacyAnomalyText, routeProvenance } from '../../src/core/legacy';
import { snowForRanking, snowStateText } from '../../src/core/compare';
import { mapAvailability, mapComments, mapShopping } from '../../src/core/sheets';
import { SHEET_TEMPLATES } from '../../src/core/sheet-templates';
import catalog from '../../data/catalog.json';
import { normName } from '../../src/core/legacy';
import docAvailability from '../../docs/templates/sheets-availability.csv?raw';
import docComments from '../../docs/templates/sheets-comments.csv?raw';
import docShopping from '../../docs/templates/sheets-shopping.csv?raw';

describe('textos legacy en español', () => {
  it('los códigos de aviso se explican y nunca se muestran tal cual', () => {
    expect(legacyAnomalyText('zero_ambiguous')).toMatch(/convertía «-» \(sin dato\) en 0/);
    expect(legacyAnomalyText('total_mismatch_catalog')).toMatch(/no coinciden/);
    expect(legacyAnomalyText('scope_remapped_to_la-molina')).toBe('Asignada a «la-molina» por sus km totales (la serie antigua mezclaba ámbitos).');
    expect(legacyAnomalyText('top10_with_n_3')).toMatch(/solo 3 muestras/);
    expect(legacyAnomalyText('top10_with_n_1')).toMatch(/solo 1 muestra\.$/);
    for (const code of ['zero_ambiguous', 'open_null', 'open_gt_total', 'duplicate_of_astun_series', 'scope_unknown', 'nights_missing', 'no_hotel_identity', 'no_stay_dates', 'no_occupancy', 'forfait_days_fixed_2', 'cheapest_gt_avg', 'non_positive_sample']) {
      expect(legacyAnomalyText(code), code).not.toMatch(/_/);
    }
    // Un texto que ya es español (o un código desconocido) se conserva.
    expect(legacyAnomalyText('cero posiblemente «-»')).toBe('cero posiblemente «-»');
  });

  it('consejo general: «global», «general» o «Consejo general», pero no una estación', () => {
    expect(isGeneralScope('global')).toBe(true);
    expect(isGeneralScope('Consejo general')).toBe(true);
    expect(isGeneralScope('grandvalira')).toBe(false);
    expect(isGeneralScope(null)).toBe(false);
  });
});

describe('procedencia de las rutas: tres niveles sin inflarlos', () => {
  const osrm = { source: 'OSRM (OpenStreetMap), router.project-osrm.org', checkedOn: '2026-10-01', validated: false, accessName: '(punto de la estación en el catálogo)', notes: null };
  it('OSRM sin revisión humana: calculada con fuente y fecha, destino aproximado', () => {
    const p = routeProvenance(osrm);
    expect(p.level).toBe('computed');
    expect(p.label).toBe('calculada con OSRM (OpenStreetMap) el 01/10/2026, sin revisión humana');
    expect(p.approxAccess).toBe(true);
    expect(p.detail).toMatch(/acceso o aparcamiento no está confirmado/);
  });
  it('legado sin fuente ni fecha: estimación heredada', () => {
    expect(routeProvenance({ ...osrm, source: 'legacy_hardcode', checkedOn: null, accessName: '(acceso principal, sin especificar)' })).toMatchObject({ level: 'legacy', label: 'estimación heredada, sin fuente ni fecha' });
  });
  it('solo validated = 1 es «revisada por una persona», con el acceso nombrado', () => {
    const p = routeProvenance({ ...osrm, validated: true, accessName: 'Pas de la Casa' });
    expect(p).toMatchObject({ level: 'reviewed', approxAccess: false });
    expect(p.label).toBe('revisada por una persona (01/10/2026)');
    expect(p.detail).toMatch(/Destino: Pas de la Casa\./);
  });
});

describe('estado de nieve visible', () => {
  const now = Date.parse('2026-10-01T10:00:00Z');
  it('Ordino: cierre confirmado sin km publicados se muestra como cerrada, no como «sin dato de sin dato»', () => {
    const ordino = { opStatus: 'closed_confirmed', openKm: null, totalKm: null };
    expect(snowStateText(ordino)).toEqual({ text: 'Cerrada (confirmado por la fuente) · la fuente no publica km', closed: true });
    // El cálculo de la puntuación no cambia: un cierre confirmado puntúa 0 km.
    expect(snowForRanking({ sourceId: 's', priority: 10, observedAt: now - 3600_000, quality: 'ok', sourceDate: '2026-10-01', ...ordino }, now)).toEqual({ openKm: 0, excluded: null });
  });
  it('fuera de temporada con total, abierta con km y sin dato', () => {
    expect(snowStateText({ opStatus: 'out_of_season', openKm: null, totalKm: 79 }).text).toBe('Fuera de temporada (confirmado por la fuente) · 79 km en total');
    expect(snowStateText({ opStatus: 'closed_confirmed', openKm: 0, totalKm: 215 }).text).toBe('Cerrada (confirmado por la fuente) · 0 km abiertos de 215 km');
    expect(snowStateText({ opStatus: 'partial', openKm: 12.5, totalKm: 215 })).toEqual({ text: '12,5 km abiertos de 215 km', closed: false });
    expect(snowStateText({ opStatus: 'unknown', openKm: null, totalKm: null }).text).toBe('sin dato abiertos de sin dato');
  });
});

describe('CSV de comentarios sin identificadores internos', () => {
  it('acepta el nombre de la estación y «general»; lo desconocido avisa sin inventar estación', () => {
    const names = new Map([['grandvalira', 'grandvalira'], ['port del comte', 'port-del-comte']]);
    const m = mapComments('estacion,autor,comentario,fecha\nPort del Comte,Ana,Poca cola,12/01/2026\nGeneral,Pau,Llevad cadenas,13/01/2026\nInventada,Pau,Otro,\n',
      new Set(['grandvalira', 'port-del-comte']), names);
    expect(m.rows.map((r) => r.resortId)).toEqual(['port-del-comte', 'global', 'Inventada']);
    expect(m.warnings).toHaveLength(1);
    expect(m.warnings[0].message).toMatch(/estación desconocida «Inventada»/);
  });
});

describe('plantillas CSV descargables', () => {
  it('son las de docs/templates y se importan sin errores ni avisos con el catálogo real', () => {
    expect(SHEET_TEMPLATES.availability.csv).toBe(docAvailability);
    expect(SHEET_TEMPLATES.comments.csv).toBe(docComments);
    expect(SHEET_TEMPLATES.shopping.csv).toBe(docShopping);
    const areas = (catalog as any).areas as { id: string; name: string; legacy_id: string | null }[];
    const known = new Set(areas.flatMap((a) => [a.id, ...(a.legacy_id ? [a.legacy_id] : [])]));
    const byName = new Map(areas.map((a) => [normName(a.name), a.legacy_id ?? a.id] as [string, string]));
    const c = mapComments(SHEET_TEMPLATES.comments.csv, known, byName);
    expect([c.errors, c.warnings]).toEqual([[], []]);
    expect(c.rows.map((r) => r.resortId)).toEqual(['grandvalira', 'global']);
    const a = mapAvailability(SHEET_TEMPLATES.availability.csv);
    expect([a.errors, a.warnings, a.rows.map((r) => r.mapped)]).toEqual([[], [], ['busy', 'maybe', 'free']]);
    const s = mapShopping(SHEET_TEMPLATES.shopping.csv);
    expect([s.errors, s.warnings, s.rows.length]).toEqual([[], [], 2]);
  });
});
