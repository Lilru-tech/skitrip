// Fecha en Europe/Madrid: correcta en los cambios de día y de hora, y sin crear un formateador por llamada
// (crear uno con zona horaria costaba la mayor parte de la CPU del catálogo público).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { madridDate, todayMadrid } from '../../src/core/dates';

afterEach(() => vi.restoreAllMocks());

describe('todayMadrid', () => {
  it('cambia de día a medianoche de Madrid, en horario de verano y de invierno', () => {
    expect(todayMadrid(Date.parse('2026-10-15T21:59:59Z'))).toBe('2026-10-15'); // 23:59:59 CEST
    expect(todayMadrid(Date.parse('2026-10-15T22:00:00Z'))).toBe('2026-10-16'); // 00:00 CEST
    expect(todayMadrid(Date.parse('2026-12-31T22:59:59Z'))).toBe('2026-12-31'); // 23:59:59 CET
    expect(todayMadrid(Date.parse('2026-12-31T23:00:00Z'))).toBe('2027-01-01');
    expect(todayMadrid(Date.parse('2026-03-29T00:59:59Z'))).toBe('2026-03-29'); // cambio de hora
  });

  it('se calcula para cada instante: no se queda con el primero', () => {
    const a = todayMadrid(Date.parse('2026-10-15T10:00:00Z'));
    const b = todayMadrid(Date.parse('2026-10-16T10:00:00Z'));
    expect([a, b]).toEqual(['2026-10-15', '2026-10-16']);
    expect(todayMadrid(Date.parse('2026-10-15T10:00:00Z'))).toBe('2026-10-15');
  });

  it('no crea un Intl.DateTimeFormat por llamada', () => {
    madridDate(0); // el formateador del isolate ya existe a partir de aquí
    const spy = vi.spyOn(Intl, 'DateTimeFormat');
    const t0 = Date.parse('2026-10-15T00:00:00Z');
    for (let i = 0; i < 500; i++) todayMadrid(t0 + i * 3600_000);
    expect(spy).not.toHaveBeenCalled();
    expect(todayMadrid(t0 + 499 * 3600_000)).toBe('2026-11-04');
  });
});
