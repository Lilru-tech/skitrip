import { describe, it, expect } from 'vitest';
import {
  classifySnow,
  esquiadesAdapter,
  manualAdapter,
  mapStatus,
  matchResortRow,
  parseEsquiadesStatusHtml,
  parseKmPair,
  type StatusRow,
} from '../../../src/core/parsers/snow';
import statusHtml from '../../fixtures/parsers/esquiades-estado-pistas.html?raw';
import statusTableHtml from '../../fixtures/parsers/esquiades-estado-pistas-table.html?raw';

describe('parseKmPair', () => {
  it('decimal km with comma or dot', () => {
    expect(parseKmPair('12,5 / 32')).toEqual({ open: 12.5, total: 32, flags: [] });
    expect(parseKmPair('12.5/32.4')).toEqual({ open: 12.5, total: 32.4, flags: [] });
  });
  it('dash, em dash or empty open means unknown (null), never 0', () => {
    expect(parseKmPair('- / 32')?.open).toBeNull();
    expect(parseKmPair('— / 32')?.open).toBeNull();
    expect(parseKmPair(' / 32')?.open).toBeNull();
    expect(parseKmPair('- / 32')?.total).toBe(32);
  });
  it('explicit 0 stays 0', () => {
    expect(parseKmPair('0 / 32')).toEqual({ open: 0, total: 32, flags: [] });
  });
  it('open > total is flagged, not dropped', () => {
    expect(parseKmPair('40 / 35')).toEqual({ open: 40, total: 35, flags: ['open_exceeds_total'] });
  });
  it('garbage → null', () => {
    expect(parseKmPair('abc')).toBeNull();
    expect(parseKmPair('12 km')).toBeNull();
    expect(parseKmPair('1a / 3')).toBeNull();
  });
});

describe('mapStatus', () => {
  it('maps status words explicitly', () => {
    expect(mapStatus('Abierta')).toBe('open');
    expect(mapStatus('Parcialmente abierta')).toBe('partial');
    expect(mapStatus('Cerrada')).toBe('closed_confirmed');
    expect(mapStatus('Cierre temporada')).toBe('out_of_season');
    expect(mapStatus('Fuera de temporada')).toBe('out_of_season');
    expect(mapStatus('Próxima apertura')).toBe('out_of_season');
    expect(mapStatus('Consultar')).toBe('unknown');
    expect(mapStatus(null)).toBe('unknown');
  });
});

describe('parseEsquiadesStatusHtml', () => {
  const rows = parseEsquiadesStatusHtml(statusHtml);
  const byName = (n: string) => rows.filter((r) => r.name === n);

  it('one row per resort container, header/script/footer ignored', () => {
    expect(rows.map((r) => r.name)).toEqual([
      'Grandvalira', 'Ordino-Arcalís', 'Port Ainé', 'Espot Esquí', 'Formigal - Panticosa',
      'Cerler', 'Candanchú', 'Astún', 'Valdelinares', 'Javalambre',
    ]);
  });
  it('parses fields of an open resort', () => {
    expect(byName('Grandvalira')[0]).toEqual({
      name: 'Grandvalira', nameNorm: 'grandvalira', region: 'Andorra', statusText: 'Abierta', opStatus: 'open',
      openKm: 78, totalKm: 215, openRuns: 60, totalRuns: 138, flags: [],
    });
  });
  it('two resorts with identical figures both survive', () => {
    const a = byName('Port Ainé')[0];
    const b = byName('Espot Esquí')[0];
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect([a.openKm, a.totalKm, a.openRuns]).toEqual([12.5, 32, 10]);
    expect([b.openKm, b.totalKm, b.openRuns]).toEqual([12.5, 32, 10]);
  });
  it('confirmed closure with dash open km → null km, closed_confirmed', () => {
    const r = byName('Ordino-Arcalís')[0];
    expect(r.opStatus).toBe('closed_confirmed');
    expect(r.openKm).toBeNull();
    expect(r.totalKm).toBe(30.5);
  });
  it('season states and unknown words', () => {
    expect(byName('Cerler')[0]).toMatchObject({ opStatus: 'out_of_season', openKm: 0, totalKm: 79 });
    expect(byName('Candanchú')[0]).toMatchObject({ opStatus: 'out_of_season', openKm: null, totalKm: 50.6 });
    expect(byName('Astún')[0]).toMatchObject({ opStatus: 'out_of_season', openKm: null });
    expect(byName('Valdelinares')[0]).toMatchObject({ opStatus: 'unknown', statusText: 'Consultar', openKm: 8 });
  });
  it('open > total is kept and flagged', () => {
    expect(byName('Javalambre')[0]).toMatchObject({ openKm: 40, totalKm: 35, flags: ['open_exceeds_total'] });
  });
  it('table layout variant', () => {
    const t = parseEsquiadesStatusHtml(statusTableHtml);
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ name: 'Baqueira Beret', region: 'Pirineo Catalán', opStatus: 'open', openKm: 120.5, totalKm: 167, openRuns: 80 });
    expect(t[1]).toMatchObject({ name: 'La Molina', opStatus: 'closed_confirmed', openKm: null, totalKm: 71 });
  });
  it('adapter exposes id/version and same output', () => {
    expect(esquiadesAdapter.id).toBe('esquiades_estado_pistas');
    expect(esquiadesAdapter.parse(statusHtml)).toEqual(rows);
  });
});

describe('matchResortRow', () => {
  const rows = parseEsquiadesStatusHtml(statusHtml);
  it('exact normalized alias (accents/case/punctuation)', () => {
    const m = matchResortRow(rows, ['ordino arcalis']);
    expect(m.match?.name).toBe('Ordino-Arcalís');
    expect(matchResortRow(rows, ['FORMIGAL-PANTICOSA']).match?.name).toBe('Formigal - Panticosa');
  });
  it('no substring match: "formigal" does not match the joint domain', () => {
    expect(matchResortRow(rows, ['formigal'])).toMatchObject({ match: null, reason: 'no_match' });
  });
  it('ambiguous name (several rows) is not matched', () => {
    const dup: StatusRow[] = [
      { ...rows[0], name: 'Baqueira', nameNorm: 'baqueira', totalKm: 167 },
      { ...rows[0], name: 'Baqueira Beret', nameNorm: 'baqueira beret', totalKm: 170 },
    ];
    const m = matchResortRow(dup, ['baqueira', 'baqueira beret']);
    expect(m.match).toBeNull();
    expect(m.reason).toBe('ambiguous');
  });
});

describe('classifySnow', () => {
  const base = { openKm: 78, totalKm: 215, opStatus: 'open' as const };
  it('ok when consistent', () => {
    expect(classifySnow(base, { openKm: 60, totalKm: 215 }, { catalogTotalKm: 212 }).quality).toBe('ok');
  });
  it('total mismatch vs catalog (>5%)', () => {
    const r = classifySnow({ openKm: 110, totalKm: 180 }, null, { catalogTotalKm: 100 });
    expect(r.quality).toBe('total_mismatch');
    expect(r.reasons[0]).toMatch(/catálogo/);
  });
  it('total mismatch vs previous observation', () => {
    expect(classifySnow(base, { openKm: 70, totalKm: 100 }).quality).toBe('total_mismatch');
  });
  it('suspicious: open > total, closed with open km', () => {
    expect(classifySnow({ openKm: 40, totalKm: 35 }).quality).toBe('suspicious');
    expect(classifySnow({ openKm: 5, totalKm: 35, opStatus: 'closed_confirmed' }).quality).toBe('suspicious');
  });
  it('unknown open km is fine', () => {
    expect(classifySnow({ openKm: null, totalKm: 30.5, opStatus: 'closed_confirmed' }).quality).toBe('ok');
  });
});

describe('manualAdapter', () => {
  it('parses JSON entries and maps status', () => {
    const out = manualAdapter.parse(
      JSON.stringify([
        { name: 'Vall de Núria', status: 'Abierta', openKm: '7,5', totalKm: 7.6 },
        { name: 'Tavascan', status: 'closed_confirmed', openKm: null, totalKm: 5 },
      ]),
    );
    expect(out[0]).toMatchObject({ nameNorm: 'vall de nuria', opStatus: 'open', openKm: 7.5, totalKm: 7.6 });
    expect(out[1]).toMatchObject({ opStatus: 'closed_confirmed', openKm: null });
  });
  it('rejects invalid input with a Spanish message', () => {
    expect(() => manualAdapter.parse('{')).toThrow(/JSON/);
    expect(() => manualAdapter.parse('[{"name":"X","openKm":-3}]')).toThrow(/openKm/);
    expect(() => manualAdapter.parse('[{"openKm":3}]')).toThrow(/nombre/);
  });
});
