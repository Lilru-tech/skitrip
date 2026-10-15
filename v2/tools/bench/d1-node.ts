// D1 mínimo sobre node:sqlite para perfilar el Worker en Node (solo herramientas locales; nunca se publica).
// Implementa lo que usa la API: prepare/bind/all/first/run/raw y batch (en una transacción), con migraciones reales.
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Row = Record<string, unknown>;
export function nodeD1(migrationsDir: string): D1Database & { sqlite: DatabaseSync; memo(): void } {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) db.exec(readFileSync(join(migrationsDir, f), 'utf8'));
  const norm = (sql: string) => sql.replace(/\?(\d+)/g, '?$1');
  // memo(): a partir de ahí las lecturas repetidas devuelven el resultado guardado, para medir solo el trabajo del Worker.
  let memo: Map<string, unknown> | null = null;
  const stmt = (sql: string, args: unknown[] = []): any => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    _run() { const key = memo && /^\s*(select|with)/i.test(sql) ? sql + '\u0000' + JSON.stringify(args) : null;
      if (key && memo!.has(key)) return structuredClone(memo!.get(key));
      const r = this._exec(); if (key) memo!.set(key, structuredClone(r)); return r; },
    _exec() { const s = db.prepare(norm(sql)); const p = args.map((x) => (x === undefined ? null : typeof x === 'boolean' ? Number(x) : x)) as any[];
      if (/^\s*(select|with)/i.test(sql) || /returning/i.test(sql)) return { results: s.all(...p) as Row[], meta: { rows_read: 0, changes: 0 } };
      const r = s.run(...p); return { results: [], meta: { rows_read: 0, changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    async all() { const r = this._run(); return { success: true, ...r }; },
    async run() { const r = this._run(); return { success: true, ...r }; },
    async first(col?: string) { const r = this._run().results[0] ?? null; return col && r ? r[col] : r; },
    async raw() { return this._run().results.map((r: Row) => Object.values(r)); },
  });
  return {
    sqlite: db,
    memo() { memo = new Map(); },
    prepare: (sql: string) => stmt(sql),
    async batch(list: any[]) { db.exec('BEGIN'); try { const out = list.map((s) => ({ success: true, ...s._run() })); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; } },
    async exec(sql: string) { db.exec(sql); return { count: 1, duration: 0 }; },
  } as any;
}
