// Estado de apertura: abierta, cerrada, fuera de temporada o desconocida. Un dato ausente, antiguo o dudoso nunca es
// cierre; «todas cerradas» solo con cierre confirmado y vigente en todas.
import { describe, expect, it } from 'vitest';
import { combineStatus, countStatuses, noOpenNotice, resortStatus } from '../../src/core/compare';
import { addDays, todayMadrid } from '../../src/core/dates';

const NOW = Date.UTC(2027, 1, 27, 10);
const today = todayMadrid(NOW);
const obs = (o: Partial<{ opStatus: string; quality: string; observedAt: number; sourceDate: string | null }>) =>
  ({ opStatus: 'open', quality: 'ok', observedAt: NOW - 3600_000, sourceDate: today, ...o });

describe('resortStatus', () => {
  it('distingue los cuatro estados con dato vigente', () => {
    expect(resortStatus(obs({}), NOW)).toMatchObject({ status: 'open', partial: false });
    expect(resortStatus(obs({ opStatus: 'partial' }), NOW)).toMatchObject({ status: 'open', partial: true });
    expect(resortStatus(obs({ opStatus: 'closed_confirmed' }), NOW).status).toBe('closed');
    expect(resortStatus(obs({ opStatus: 'out_of_season' }), NOW).status).toBe('off_season');
    expect(resortStatus(obs({ opStatus: 'unknown' }), NOW)).toMatchObject({ status: 'unknown', reason: 'la fuente no indica si está abierta' });
  });

  it('sin dato, dato antiguo, parte antiguo o dudoso es desconocido, nunca cerrado', () => {
    expect(resortStatus(null, NOW)).toMatchObject({ status: 'unknown', reason: 'no hay datos de la fuente', lastKnown: null });
    const stale = resortStatus(obs({ opStatus: 'closed_confirmed', observedAt: NOW - 5 * 86400_000 }), NOW);
    expect(stale).toMatchObject({ status: 'unknown', lastKnown: 'cerrada' });
    expect(stale.reason).toMatch(/hace más de/);
    expect(resortStatus(obs({ opStatus: 'closed_confirmed', sourceDate: addDays(today, -3) }), NOW)).toMatchObject({ status: 'unknown', reason: 'el parte de la fuente es anterior a ayer' });
    expect(resortStatus(obs({ quality: 'suspicious' }), NOW)).toMatchObject({ status: 'unknown', reason: 'dato dudoso' });
    // Parte de ayer: sigue vigente.
    expect(resortStatus(obs({ opStatus: 'closed_confirmed', sourceDate: addDays(today, -1) }), NOW).status).toBe('closed');
  });

  it('los km abiertos no deciden el estado: abierta con 0 km sigue abierta según la fuente', () => {
    expect(resortStatus({ ...obs({}), openKm: 0 } as any, NOW).status).toBe('open');
  });
});

describe('combineStatus (dominio sin parte propio)', () => {
  const o = resortStatus(obs({}), NOW), c = resortStatus(obs({ opStatus: 'closed_confirmed' }), NOW);
  const f = resortStatus(obs({ opStatus: 'out_of_season' }), NOW), u = resortStatus(null, NOW);
  it('abierto si alguna lo está (en parte si no todas)', () => {
    expect(combineStatus([o, c])).toMatchObject({ status: 'open', partial: true });
    expect(combineStatus([o, o])).toMatchObject({ status: 'open', partial: false });
  });
  it('cerrado solo si todas lo confirman; con una desconocida, desconocido', () => {
    expect(combineStatus([c, f]).status).toBe('closed');
    expect(combineStatus([f, f]).status).toBe('off_season');
    expect(combineStatus([c, u]).status).toBe('unknown');
    expect(combineStatus([]).status).toBe('unknown');
  });
});

describe('noOpenNotice', () => {
  it('sin aviso si hay alguna abierta o el conjunto está vacío', () => {
    expect(noOpenNotice(countStatuses(['open', 'closed', 'unknown']))).toBeNull();
    expect(noOpenNotice(countStatuses([]))).toBeNull();
  });
  it('«todas cerradas» solo si todas tienen cierre confirmado y vigente', () => {
    expect(noOpenNotice(countStatuses(['closed', 'off_season', 'closed']))).toMatchObject({ allClosed: true, text: 'Las 3 están cerradas o fuera de temporada según su fuente, con dato vigente.' });
    const mixed = noOpenNotice(countStatuses(['closed', 'unknown', 'unknown']))!;
    expect(mixed.allClosed).toBe(false);
    expect(mixed.text).toBe('Ninguna abierta confirmada: 1 cerrada, 2 con estado desconocido (pueden estar abiertas; no hay dato vigente).');
    expect(noOpenNotice(countStatuses(['unknown']))!.text).toBe('Ninguna abierta confirmada: 1 con estado desconocido (puede estar abierta; no hay dato vigente).');
  });
});
