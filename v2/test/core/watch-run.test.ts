// Flujo completo de la vigilancia con D1 y GitHub simulados: ningún aviso real, ninguna escritura real.
import { describe, expect, it } from 'vitest';
import type { Finding } from '../../tools/watch-policy';
import { runWatch, type FindingStore, type IssueTracker, type WatchRow } from '../../tools/watch-run';

const ACTIONS = { kind: 'actions', runUrl: 'https://example.invalid/run/1' } as const;
const row = (key: string, level: WatchRow['level'], kind: WatchRow['kind'] = 'check'): WatchRow => ({ key, kind, level, what: key, value: level, action: '' });

function memStore(initial: Finding[] = [], fail: { read?: boolean; write?: boolean } = {}) {
  const db = new Map(initial.map((f) => [f.key, f]));
  const store: FindingStore & { db: Map<string, Finding>; writes: number } = {
    db, writes: 0,
    async read() { if (fail.read) throw new Error('D1: no such table: watch_findings'); return [...db.values()].map((f) => ({ ...f })); },
    async write(fs) { if (fail.write) throw new Error('D1: database is locked'); store.writes++; for (const f of fs) db.set(f.key, { ...f }); },
  };
  return store;
}
function fakeIssues(fail: { list?: boolean; open?: boolean; close?: boolean } = {}) {
  const open = new Map<number, string>();
  let next = 100;
  const calls: string[] = [];
  const t: IssueTracker & { open_: Map<number, string>; calls: string[] } = {
    open_: open, calls,
    async listOpen() { calls.push('list'); if (fail.list) throw new Error('GitHub GET /issues: HTTP 502'); return [...open].map(([number, body]) => ({ number, body })); },
    async ensureLabel() { calls.push('label'); },
    async open(_title, body) { calls.push('open'); if (fail.open) throw new Error('GitHub POST /issues: HTTP 403'); open.set(++next, body); return next; },
    async close(n) { calls.push(`close ${n}`); if (fail.close) throw new Error('GitHub PATCH: HTTP 500'); open.delete(n); },
  };
  return t;
}
const days = (n: number) => Array.from({ length: n }, (_, i) => `2026-10-${String(13 + i).padStart(2, '0')}`);

describe('vigilancia de extremo a extremo (D1 y GitHub simulados)', () => {
  it('degradación repetida abre UN aviso, no lo repite y lo cierra al recuperarse', async () => {
    const store = memStore(), gh = fakeIssues();
    const results = [];
    for (const d of days(4)) results.push(await runWatch([row('check:Fuentes', 'AVISO')], d, ACTIONS, store, gh));
    results.push(await runWatch([row('check:Fuentes', 'OK')], '2026-10-17', ACTIONS, store, gh));
    expect(results.map((r) => r.findings![0].state)).toEqual(['aislado', 'aislado', 'degradado', 'degradado', 'ok']);
    expect(gh.calls.filter((c) => c === 'open')).toHaveLength(1);
    expect(gh.calls).toContain('close 101');
    expect(gh.open_.size).toBe(0);
    expect(results.map((r) => r.exitCode)).toEqual([0, 0, 0, 0, 0]);
    expect(results[2].lines.join('\n')).toMatch(/::warning::Degradación persistente/);
  });

  it('D1 no se puede leer: rojo, sin escribir, sin tocar avisos y sin reiniciar rachas', async () => {
    const prev: Finding = { key: 'check:Fuentes', label: 'Fuentes', kind: 'check', state: 'aislado', streak_days: 2, first_seen: '2026-10-13', last_day: '2026-10-14', last_value: 'AVISO', issue_number: null };
    const store = memStore([prev], { read: true }), gh = fakeIssues();
    for (const d of ['2026-10-15', '2026-10-16']) {
      const r = await runWatch([row('check:Fuentes', 'AVISO')], d, ACTIONS, store, gh);
      expect(r.exitCode).toBe(1);
      expect(r.findings).toBeNull();
      expect(r.lines.join('\n')).toMatch(/::error::Vigilancia: no se pudo leer watch_findings/);
    }
    expect(store.writes).toBe(0);
    expect(store.db.get('check:Fuentes')).toEqual(prev); // la racha anterior se conserva intacta
    expect(gh.calls).toEqual([]);
  });

  it('D1 no se puede guardar: rojo aunque todo esté OK', async () => {
    const r = await runWatch([row('check:API', 'OK')], '2026-10-15', ACTIONS, memStore([], { write: true }), fakeIssues());
    expect(r.exitCode).toBe(1);
    expect(r.lines.join('\n')).toMatch(/::error::Vigilancia: no se pudo guardar watch_findings/);
  });

  it('GitHub falla al listar o al abrir: rojo, el estado se guarda y el aviso se reintenta al día siguiente sin duplicar', async () => {
    const store = memStore(), bad = fakeIssues({ open: true });
    await runWatch([row('source:fgc', 'AVISO', 'regression')], '2026-10-13', ACTIONS, store, bad);
    const r = await runWatch([row('source:fgc', 'AVISO', 'regression')], '2026-10-14', ACTIONS, store, bad);
    expect(r.exitCode).toBe(1);
    expect(r.lines.join('\n')).toMatch(/::error::Vigilancia: aviso de GitHub de source:fgc no abierto/);
    expect(store.db.get('source:fgc')).toMatchObject({ state: 'degradado', streak_days: 2, issue_number: null });

    const listFails = await runWatch([row('source:fgc', 'AVISO', 'regression')], '2026-10-15', ACTIONS, store, fakeIssues({ list: true }));
    expect(listFails.exitCode).toBe(1);
    expect(listFails.lines.join('\n')).toMatch(/no se pudieron listar los avisos/);
    expect(store.db.get('source:fgc')!.streak_days).toBe(3);

    const good = fakeIssues();
    const ok1 = await runWatch([row('source:fgc', 'AVISO', 'regression')], '2026-10-16', ACTIONS, store, good);
    const ok2 = await runWatch([row('source:fgc', 'AVISO', 'regression')], '2026-10-17', ACTIONS, store, good);
    expect([ok1.exitCode, ok2.exitCode]).toEqual([0, 0]);
    expect(good.calls.filter((c) => c === 'open')).toHaveLength(1);
    expect(store.db.get('source:fgc')!.issue_number).toBe(101);
  });

  it('en Actions sin credenciales de GitHub: rojo y explícito', async () => {
    const r = await runWatch([row('check:API', 'AVISO')], '2026-10-15', ACTIONS, memStore(), null);
    expect(r.exitCode).toBe(1);
    expect(r.lines.join('\n')).toMatch(/sin GITHUB_TOKEN o GITHUB_REPOSITORY/);
  });

  it('un fallo real deja el workflow en rojo y abre aviso', async () => {
    const gh = fakeIssues();
    const r = await runWatch([row('check:Cortes por CPU', 'FALLO')], '2026-10-15', ACTIONS, memStore(), gh);
    expect(r.exitCode).toBe(1);
    expect(gh.calls).toContain('open');
  });

  it('ejecución local: diferenciada, sin estado ni avisos', async () => {
    const store = memStore(), gh = fakeIssues();
    const r = await runWatch([row('check:API', 'AVISO')], '2026-10-15', { kind: 'local' }, store, gh);
    expect(r.exitCode).toBe(0);
    expect(r.lines.join('\n')).toMatch(/MODO LOCAL/);
    expect(store.writes).toBe(0);
    expect(gh.calls).toEqual([]);
  });
});
