import { describe, expect, it } from 'vitest';
import { classifySource, issueAction, nextState, type Finding, type Kind, type Level } from '../../tools/watch-policy';

const run = (days: [string, Level][], kind: Kind = 'check') => {
  let f: Finding | undefined;
  const out: Finding[] = [];
  for (const [day, level] of days) out.push((f = nextState(f, { key: 'k', label: 'K', kind, level, value: level }, day)));
  return out;
};

describe('política de la vigilancia: aislado, degradado y fallo', () => {
  it('un aviso de un día es aislado y vuelve a OK sin dejar racha', () => {
    expect(run([['2026-10-14', 'AVISO'], ['2026-10-15', 'OK']]).map((f) => [f.state, f.streak_days])).toEqual([['aislado', 1], ['ok', 0]]);
  });
  it('tres días seguidos de aviso degradan una comprobación; varias ejecuciones el mismo día cuentan una vez', () => {
    const r = run([['2026-10-13', 'AVISO'], ['2026-10-13', 'AVISO'], ['2026-10-14', 'AVISO'], ['2026-10-15', 'AVISO']]);
    expect(r.map((f) => f.state)).toEqual(['aislado', 'aislado', 'aislado', 'degradado']);
    expect(r[3]).toMatchObject({ streak_days: 3, first_seen: '2026-10-13' });
  });
  it('una fuente que funcionaba y deja de hacerlo se degrada al segundo día; una pendiente, al tercero', () => {
    expect(run([['2026-10-12', 'AVISO'], ['2026-10-13', 'AVISO']], 'regression').map((f) => f.state)).toEqual(['aislado', 'degradado']);
    expect(run([['2026-10-12', 'AVISO'], ['2026-10-13', 'AVISO']], 'pending').map((f) => f.state)).toEqual(['aislado', 'aislado']);
  });
  it('días con huecos (01, 08 y 15/10) no son consecutivos: cada observación empieza una racha nueva', () => {
    const r = run([['2026-10-01', 'AVISO'], ['2026-10-08', 'AVISO'], ['2026-10-15', 'AVISO']]);
    expect(r.map((f) => [f.state, f.streak_days, f.first_seen])).toEqual([['aislado', 1, '2026-10-01'], ['aislado', 1, '2026-10-08'], ['aislado', 1, '2026-10-15']]);
  });
  it('un solo día sin observación corta la racha (no cuenta como degradado ni como recuperado)', () => {
    const r = run([['2026-10-12', 'AVISO'], ['2026-10-13', 'AVISO'], ['2026-10-15', 'AVISO'], ['2026-10-16', 'AVISO'], ['2026-10-17', 'AVISO']]);
    expect(r.map((f) => [f.state, f.streak_days])).toEqual([['aislado', 1], ['aislado', 2], ['aislado', 1], ['aislado', 2], ['degradado', 3]]);
    expect(r[4].first_seen).toBe('2026-10-15');
  });
  it('un hueco no cierra un aviso abierto: solo una observación OK lo hace', () => {
    let f = run([['2026-10-12', 'AVISO'], ['2026-10-13', 'AVISO']], 'regression')[1];
    expect(f.state).toBe('degradado');
    f = { ...f, issue_number: 7 };
    const afterGap = nextState(f, { key: 'k', label: 'K', kind: 'regression', level: 'AVISO', value: 'x' }, '2026-10-20');
    expect(afterGap).toMatchObject({ state: 'aislado', streak_days: 1, issue_number: 7 });
    expect(issueAction(afterGap, 7)).toBeNull();
    const ok = nextState(afterGap, { key: 'k', label: 'K', kind: 'regression', level: 'OK', value: 'ok' }, '2026-10-21');
    expect(issueAction(ok, 7)).toBe('close');
  });
  it('recuperación observada: OK reinicia; un aviso al día siguiente vuelve a empezar en 1', () => {
    const r = run([['2026-10-13', 'AVISO'], ['2026-10-14', 'AVISO'], ['2026-10-15', 'OK'], ['2026-10-16', 'AVISO']]);
    expect(r.map((f) => [f.state, f.streak_days])).toEqual([['aislado', 1], ['aislado', 2], ['ok', 0], ['aislado', 1]]);
  });
  it('mismo día repetido: ni suma ni reinicia; un estado con fecha futura es incoherente', () => {
    const r = run([['2026-10-14', 'AVISO'], ['2026-10-15', 'AVISO'], ['2026-10-15', 'AVISO'], ['2026-10-15', 'AVISO']]);
    expect(r.map((f) => f.streak_days)).toEqual([1, 2, 2, 2]);
    expect(() => nextState(r[3], { key: 'k', label: 'K', kind: 'check', level: 'AVISO', value: 'x' }, '2026-10-14')).toThrow(/posterior/);
  });
  it('un FALLO es fallo desde el primer día', () => {
    expect(run([['2026-10-15', 'FALLO']])[0].state).toBe('fallo');
  });
});

describe('avisos de GitHub sin duplicados', () => {
  const f = (state: Finding['state']): Finding => ({ key: 'k', label: 'K', kind: 'check', state, streak_days: 3, first_seen: null, last_day: 'd', last_value: null, issue_number: null });
  it('abre solo si no hay uno abierto y cierra al recuperarse', () => {
    expect(issueAction(f('degradado'), null)).toBe('open');
    expect(issueAction(f('degradado'), 12)).toBeNull();   // ya abierto: nada, ni comentario diario
    expect(issueAction(f('fallo'), null)).toBe('open');
    expect(issueAction(f('aislado'), null)).toBeNull();
    expect(issueAction(f('ok'), 12)).toBe('close');
    expect(issueAction(f('ok'), null)).toBeNull();
  });
});

describe('edad y cobertura de una fuente prioritaria', () => {
  const now = Date.UTC(2026, 9, 15, 9);
  const day = 864e5;
  const src = (o: object) => ({ id: 'fgc-pirineu365', area_id: 'la-molina', status: 'unverified', last_attempt_at: now - 3600e3, last_success_at: null, last_status: 'ok', reason: null, consecutive_fail: 0, ...o });
  it('fuera de temporada confirmado: OK, pendiente de invierno (no degradación)', () => {
    expect(classifySource(src({ last_status: 'empty', reason: 'off_season' }), now, 8 * day)).toMatchObject({ kind: 'absence', level: 'OK' });
  });
  it('La Molina el 12/10: funcionaba y pasa a error de identidad → regresión', () => {
    expect(classifySource(src({ last_status: 'error', reason: 'identity_mismatch', consecutive_fail: 5, last_success_at: now - 6 * day }), now, 8 * day))
      .toMatchObject({ kind: 'regression', level: 'AVISO', value: expect.stringMatching(/dejó de funcionar: error\/identity_mismatch ×5/) });
  });
  it('nunca ha dado datos → pendiente; sin intentos recientes → aviso de edad', () => {
    expect(classifySource(src({ last_status: 'error', reason: 'unknown_structure' }), now, 8 * day)).toMatchObject({ kind: 'pending', level: 'AVISO' });
    expect(classifySource(src({ last_attempt_at: now - 9 * day, last_success_at: now - 9 * day }), now, 8 * day)).toMatchObject({ kind: 'regression', level: 'AVISO', value: expect.stringMatching(/último intento/) });
    expect(classifySource(src({ last_attempt_at: null }), now, 8 * day)).toMatchObject({ kind: 'pending', level: 'AVISO' });
  });
  it('sin adaptador (Ax, Font-Romeu): limitación documentada, no degradación', () => {
    expect(classifySource(src({ last_status: 'unsupported' }), now, 8 * day)).toMatchObject({ kind: 'absence', level: 'OK' });
  });
  it('con datos recientes: OK', () => {
    expect(classifySource(src({ last_success_at: now - 3600e3 }), now, 8 * day)).toMatchObject({ level: 'OK' });
  });
});
