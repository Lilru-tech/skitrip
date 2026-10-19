// Prioridad entre el catálogo importado (automático) y las aportaciones manuales de administración, y validación de
// una aportación. Las cifras de ejemplo salen del catálogo real (data/catalog.json).
import { describe, expect, it } from 'vitest';
import { entryCatalogRuns, runCatalogView, runEntryFromJson, type RunCatalogEntry, type RunCatalogJson } from '../../src/core/runs';
import { resolveRunCatalog, seasonRelation, validateManualDraft, type ManualDraft, type ManualRunContribution } from '../../src/core/runs-manual';
import { DEFAULT_WEIGHTS, scoreRows } from '../../src/core/score';
import catalogJson from '../../data/catalog.json';

const cat = new Map(((catalogJson as unknown as { run_catalog: RunCatalogJson[] }).run_catalog).map((j) => [j.area, runEntryFromJson(j)]));
const real = (id: string) => cat.get(id)!;
const manual = (areaId: string, o: Partial<ManualRunContribution> = {}): ManualRunContribution => ({
  areaId, total: null, green: null, blue: null, red: null, black: null, comparable: true, resolution: null, season: null, sourceDate: null,
  sourceRef: 'https://example.invalid/ficha', enteredOn: '2026-10-19', status: 'active', version: 1, ...o,
});
// Misma temporada declarada por las dos fuentes: el único caso en que se combinan campos.
const S = '2026-27';
const TODAY = '2026-10-19';
const ax = (): RunCatalogEntry => ({ ...real('ax-3-domaines'), season: S });
const axManual = (o: Partial<ManualRunContribution>) => manual('ax-3-domaines', { season: S, ...o });
const draft = (o: Partial<ManualDraft> = {}): ManualDraft => ({
  total: null, green: null, blue: null, red: null, black: null, comparable: true, resolution: null, season: null, sourceDate: null,
  sourceRef: 'https://example.invalid/ficha', reason: 'Ficha 2026-27', ...o,
});

describe('resolución del dato efectivo', () => {
  it('completa los colores que faltan sin tocar el total importado, y la cifra mixta puntúa con su desglose', () => {
    const imp = ax();
    expect([imp.total, imp.green]).toEqual([38, null]);
    const r = resolveRunCatalog(imp, axManual({ green: 10, blue: 12, red: 11, black: 5 }), TODAY);
    expect(r.state).toBe('applied');
    expect(r.entry).toMatchObject({ total: 38, green: 10, blue: 12, red: 11, black: 5, origin: 'mixed', basis: 'aggregate', comparable: true, sourceUrl: imp.sourceUrl });
    expect(r.fieldOrigin).toEqual({ total: 'catalog', green: 'manual', blue: 'manual', red: 'manual', black: 'manual' });
    expect(r.entry!.manual!.fields).toEqual(['green', 'blue', 'red', 'black']);
    expect(entryCatalogRuns(r.entry)).toMatchObject({ comparableTotal: 38, byColour: { green: 10, blue: 12, red: 11, black: 5 } });
  });

  it('un desglose parcial completa lo que se sabe y deja el resto sin dato (nunca se rellena con ceros)', () => {
    const r = resolveRunCatalog(ax(), axManual({ black: 5 }), TODAY);
    expect(r.entry).toMatchObject({ total: 38, green: null, blue: null, red: null, black: 5 });
    expect(runCatalogView(r.entry)!.breakdownComplete).toBe(false);
    expect(entryCatalogRuns(r.entry).byColour).toBeNull();
  });

  it('cero es cero confirmado y se aplica; ausente no es cero', () => {
    const r = resolveRunCatalog(ax(), axManual({ green: 0, blue: 20, red: 13, black: 5 }), TODAY);
    expect(r.entry).toMatchObject({ green: 0, blue: 20 });
    expect(runCatalogView(r.entry)!.breakdownComplete).toBe(true);
  });

  it('si la combinación con el total importado no cuadra, no se mezcla: se muestra lo importado y se explica', () => {
    const full = resolveRunCatalog(ax(), axManual({ green: 10, blue: 10, red: 10, black: 10 }), TODAY);
    expect(full.state).toBe('not_applied');
    expect(full.notes).toContain('combinacion_incoherente');
    expect(full.entry).toMatchObject({ total: 38, green: null, origin: 'catalog' });
    const over = resolveRunCatalog(ax(), axManual({ red: 39 }), TODAY);
    expect(over.notes).toContain('combinacion_incoherente');
  });

  it('una cifra importada válida de la misma temporada prevalece sobre una manual distinta; la manual se conserva y se dice', () => {
    const gv = { ...real('grandvalira'), season: S };
    const r = resolveRunCatalog(gv, manual('grandvalira', { total: 140, season: S }), TODAY);
    expect(r.state).toBe('not_applied');
    expect(r.overridden).toEqual(['total']);
    expect(r.notes).toEqual(['automatica_prevalece']);
    expect(r.entry).toMatchObject({ total: 142, origin: 'catalog' });
  });

  it('sin cifra importada (Baqueira) la aportación se usa entera y puntúa; se presenta como total publicado manual', () => {
    const bq = real('baqueira-beret');
    expect(bq.total).toBeNull();
    const r = resolveRunCatalog(bq, manual('baqueira-beret', { total: 110, season: '2026-27' }));
    expect(r.notes).toEqual(['sustituye_ausente']);
    expect(r.entry).toMatchObject({ total: 110, origin: 'manual', basis: 'aggregate', checkedOn: '2026-10-19', sourceUrl: 'https://example.invalid/ficha', mapUrl: bq.mapUrl });
    expect(entryCatalogRuns(r.entry).comparableTotal).toBe(110);
  });

  it('una cifra importada no fiable no desplaza la aportación: la sustituye entera, sin mezclar colores', () => {
    const la = real('les-angles');
    expect([la.total, la.comparable]).toEqual([41, false]);
    const r = resolveRunCatalog(la, manual('les-angles', { total: 37, resolution: 'La página de pistas 2026-27 lista 37 alpinas sin las 4 de freeride.' }));
    expect(r.notes).toEqual(['sustituye_invalido']);
    expect(r.entry).toMatchObject({ total: 37, green: null, origin: 'manual', comparable: true });
    expect(r.entry!.manual!.resolution).toMatch(/freeride/);
  });

  it('Astún + Candanchú: sin resolución sigue siendo discrepancia (no la suma 114); con una aportación justificada puntúa su cifra', () => {
    const own = real('astun-candanchu');
    const members = [real('astun'), real('candanchu')];
    expect(entryCatalogRuns(resolveRunCatalog(own, null).entry, members)).toMatchObject({ comparableTotal: null, pendingDiscrepancy: true });
    const notComparable = resolveRunCatalog(own, manual('astun-candanchu', { total: 116, comparable: false }));
    expect(entryCatalogRuns(notComparable.entry, members)).toMatchObject({ comparableTotal: null, pendingDiscrepancy: true });
    const solved = resolveRunCatalog(own, manual('astun-candanchu', { total: 114, green: 16, blue: 33, red: 35, black: 30, resolution: 'Parte oficial 2026-27: 116 entradas menos trineos y snowpark.' }));
    expect(entryCatalogRuns(solved.entry, members)).toMatchObject({ comparableTotal: 114, via: 'own', pendingDiscrepancy: false });
  });

  it('temporadas conocidas: una importada anterior no desplaza la manual; una manual anterior no desplaza la importada', () => {
    const pdc = real('port-del-comte');
    expect(pdc.season).toBe('2025-26');
    const newer = resolveRunCatalog(pdc, manual('port-del-comte', { total: 30, season: '2026-27' }), TODAY);
    expect(newer.notes).toEqual(['sustituye_antiguo']);
    expect(newer.entry).toMatchObject({ total: 30, green: null, origin: 'manual' });
    const older = resolveRunCatalog(pdc, manual('port-del-comte', { total: 28, season: '2024-25' }), TODAY);
    expect(older).toMatchObject({ state: 'not_applied', notes: ['temporada_anterior'] });
    expect(older.entry!.total).toBe(29);
    // Una manual anterior con un color que falta tampoco se mezcla con la importada más nueva.
    const olderPartial = resolveRunCatalog({ ...pdc, black: null }, manual('port-del-comte', { black: 3, season: '2024-25' }), TODAY);
    expect(olderPartial.entry).toMatchObject({ black: null, origin: 'catalog' });
  });

  it('temporada desconocida no equivale a la misma: el caso de la revisión (40 sin temporada frente a 50 de 2026-27)', () => {
    const imp: RunCatalogEntry = { ...real('grandvalira'), total: 40, green: null, blue: null, red: null, black: null, season: null, sourceDate: null };
    const r = resolveRunCatalog(imp, manual('grandvalira', { total: 50, season: '2026-27' }), TODAY);
    expect(r.notes).toEqual(['sustituye_sin_temporada']);
    expect(r.entry).toMatchObject({ total: 50, origin: 'manual' });
    expect(entryCatalogRuns(r.entry).comparableTotal).toBe(50);
    // La fecha de publicación no fija la temporada: una ficha de septiembre sin temporada sigue siendo «desconocida».
    expect(seasonRelation({ season: null }, { season: '2026-27' })).toBe('unknown');
    const dated = resolveRunCatalog({ ...imp, sourceDate: '2026-09-30' }, manual('grandvalira', { total: 50, season: '2026-27' }), TODAY);
    expect(dated.entry!.total).toBe(50);
  });

  it('temporada desconocida en otros casos: prevalece la importada, sin mezclar campos y explicando por qué', () => {
    const imp: RunCatalogEntry = { ...real('ax-3-domaines'), season: null };
    // Las dos sin temporada.
    const both = resolveRunCatalog(imp, manual('ax-3-domaines', { green: 10, blue: 12, red: 11, black: 5 }), TODAY);
    expect(both).toMatchObject({ state: 'not_applied', notes: ['vigencia_desconocida'] });
    expect(both.entry).toMatchObject({ total: 38, green: null, origin: 'catalog' });
    // Manual de una temporada pasada frente a importada sin temporada: no se acredita cuál es vigente.
    const past = resolveRunCatalog(imp, manual('ax-3-domaines', { total: 40, season: '2025-26' }), TODAY);
    expect(past).toMatchObject({ state: 'not_applied', notes: ['vigencia_desconocida'] });
    expect(past.entry!.total).toBe(38);
    // Importada de temporada conocida frente a manual sin temporada: tampoco se mezclan los colores.
    const known = resolveRunCatalog({ ...imp, season: S }, manual('ax-3-domaines', { green: 10 }), TODAY);
    expect(known.notes).toEqual(['vigencia_desconocida']);
    expect(known.entry).toMatchObject({ green: null, origin: 'catalog' });
    // Parcial de la temporada actual frente a importada sin temporada: sustituye entera (sin total no puntúa, sus colores sí se ven).
    const partial = resolveRunCatalog(imp, manual('ax-3-domaines', { green: 10, season: S }), TODAY);
    expect(partial.entry).toMatchObject({ total: null, green: 10, blue: null, origin: 'manual' });
    expect(entryCatalogRuns(partial.entry).comparableTotal).toBeNull();
    expect(runCatalogView(partial.entry)!.byColour.green).toBe(10);
  });

  it('temporadas iguales con datos parciales: se completa solo el hueco y el resto sigue sin dato', () => {
    const r = resolveRunCatalog({ ...real('ax-3-domaines'), season: S }, axManual({ green: 10 }), TODAY);
    expect(r.state).toBe('applied');
    expect(r.entry).toMatchObject({ total: 38, green: 10, blue: null, red: null, black: null, origin: 'mixed' });
    expect(entryCatalogRuns(r.entry)).toMatchObject({ comparableTotal: 38, byColour: null });
  });

  it('cuando llega después un dato automático válido de la misma temporada, prevalece y la aportación queda conservada sin aplicar', () => {
    const m = axManual({ green: 10, blue: 12, red: 11, black: 5 });
    const later: RunCatalogEntry = { ...ax(), green: 9, blue: 13, red: 11, black: 5 };
    const r = resolveRunCatalog(later, m, TODAY);
    expect(r.state).toBe('not_applied');
    expect(r.entry).toMatchObject({ green: 9, blue: 13, origin: 'catalog' });
    expect(r.overridden).toEqual(['green', 'blue']);
  });

  it('un dato automático ausente, inválido o de otra temporada no sustituye la aportación', () => {
    const m = manual('baqueira-beret', { total: 110, season: '2026-27' });
    const absent = resolveRunCatalog({ ...real('baqueira-beret') }, m);
    const invalid = resolveRunCatalog({ ...real('baqueira-beret'), total: 100, green: 90, blue: 20, red: 0, black: 0, comparable: true }, m);
    const old = resolveRunCatalog({ ...real('baqueira-beret'), total: 104, comparable: true, season: '2025-26' }, m);
    for (const r of [absent, invalid, old]) expect(r.entry).toMatchObject({ total: 110, origin: 'manual' });
  });

  it('una aportación no comparable no completa una cifra comparable; una retirada no cuenta', () => {
    expect(resolveRunCatalog(ax(), axManual({ green: 10, comparable: false }), TODAY).notes).toContain('no_comparable_no_se_mezcla');
    const w = resolveRunCatalog(real('baqueira-beret'), manual('baqueira-beret', { total: 110, status: 'withdrawn' }));
    expect(w).toMatchObject({ state: 'withdrawn' });
    expect(w.entry!.total).toBeNull();
  });

  it('con el peso de variedad a 0 la puntuación es la misma con o sin aportaciones', () => {
    const rows = (withManual: boolean) => ['ax-3-domaines', 'baqueira-beret', 'grandvalira'].map((id, i) => {
      const e = resolveRunCatalog(real(id), withManual ? manual(id, { total: 110, green: 10 }) : null).entry;
      return { id, costPerPersonCents: null, roadKm: 100 + i * 50, totalKm: 50 + i * 30, openKmNow: null, vibe: 5, runs: entryCatalogRuns(e).comparableTotal };
    });
    expect(DEFAULT_WEIGHTS.runs).toBe(0);
    expect(scoreRows(rows(true)).map((s) => [s.id, s.score])).toEqual(scoreRows(rows(false)).map((s) => [s.id, s.score]));
    expect(scoreRows(rows(true), { ...DEFAULT_WEIGHTS, runs: 0.3 }).find((s) => s.id === 'baqueira-beret')!.missing).not.toContain('runs');
  });
});

describe('validación de una aportación', () => {
  const ctx = { imported: real('ax-3-domaines'), today: '2026-10-19' };
  it('acepta una aportación correcta, parcial o con ceros confirmados', () => {
    expect(validateManualDraft(draft({ green: 10, blue: 12, red: 11, black: 5 }), ctx)).toEqual([]);
    expect(validateManualDraft(draft({ total: 38, black: 0 }), ctx)).toEqual([]);
    expect(validateManualDraft(draft({ total: 0, green: 0, blue: 0, red: 0, black: 0, season: '2026-27', sourceDate: '2026-10-01' }), ctx)).toEqual([]);
  });
  it('rechaza números negativos, decimales y una aportación vacía', () => {
    expect(validateManualDraft(draft({ total: -1 }), ctx).join()).toMatch(/total/);
    expect(validateManualDraft(draft({ green: 1.5 }), ctx).join()).toMatch(/verdes/);
    expect(validateManualDraft(draft(), ctx).join()).toMatch(/al menos una cifra/);
  });
  it('un desglose completo coincide con el total y uno parcial no lo supera', () => {
    expect(validateManualDraft(draft({ total: 40, green: 10, blue: 10, red: 10, black: 9 }), ctx).join()).toMatch(/suman 39 y el total es 40/);
    expect(validateManualDraft(draft({ total: 20, green: 15, blue: 10 }), ctx).join()).toMatch(/suman 25, más que el total/);
  });
  it('exige fuente comprobable, motivo, temporada bien escrita y fecha de la fuente no futura', () => {
    const e = validateManualDraft(draft({ total: 10, sourceRef: 'web', reason: '', season: '2026-28', sourceDate: '2026-12-01' }), ctx).join(' ');
    expect(e).toMatch(/fuente o referencia/);
    expect(e).toMatch(/motivo/);
    expect(e).toMatch(/2026-27/);
    expect(e).toMatch(/posterior a hoy/);
    expect(validateManualDraft(draft({ total: 10, sourceRef: 'http://inseguro.example/x' }), ctx).join()).toMatch(/https/);
    expect(validateManualDraft(draft({ total: 10, sourceRef: 'Folleto oficial 2026-27, página 4' }), ctx)).toEqual([]);
    expect(validateManualDraft(draft({ total: 10, season: '2027-28' }), ctx).join()).toMatch(/posterior a la actual \(2026-27\)/);
    expect(validateManualDraft(draft({ green: 10 }), ctx)).toEqual([]);
  });
  it('una discrepancia pendiente no se vuelve comparable con una casilla: hace falta explicación con evidencia', () => {
    const disc = { imported: real('astun-candanchu'), today: '2026-10-19' };
    expect(validateManualDraft(draft({ total: 114 }), disc).join()).toMatch(/discrepancia pendiente/);
    expect(validateManualDraft(draft({ total: 114, resolution: 'corto' }), disc).join()).toMatch(/discrepancia pendiente/);
    expect(validateManualDraft(draft({ total: 114, comparable: false }), disc)).toEqual([]);
    expect(validateManualDraft(draft({ total: 114, resolution: 'Parte oficial 2026-27: 116 entradas menos trineos y snowpark.' }), disc)).toEqual([]);
  });
});
