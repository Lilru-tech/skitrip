// Presupuesto de consultas D1 por invocación.
// D1 Free admite 50 consultas por invocación del Worker y la documentación aplica los límites a cada sentencia
// de un batch (https://developers.cloudflare.com/d1/platform/limits/). Aquí contamos cada sentencia, esté o no
// en un batch, y cortamos antes del límite real para dejar margen. Cada ruta está diseñada para quedar muy por
// debajo; los tests comprueban el recuento con la cabecera X-D1-Statements (solo en modo emulador/local).
import { ApiError } from './http';

export const D1_FREE_LIMIT = 50;
export const QUERY_BUDGET = 40;

export interface Counter { n: number; max: number }

export function countingDb(db: D1Database, counter: Counter): D1Database {
  const spend = (k: number) => {
    if (counter.n + k > counter.max) {
      throw new ApiError(503, 'query_budget', 'La operación es demasiado grande para una sola petición. Divídela en partes más pequeñas.');
    }
    counter.n += k;
  };
  const raw = new WeakMap<object, D1PreparedStatement>();
  const wrapStmt = (s: D1PreparedStatement): D1PreparedStatement => {
    const p = new Proxy(s, {
    get(t, prop) {
      const v = Reflect.get(t, prop, t);
      if (prop === 'bind') return (...a: unknown[]) => wrapStmt((v as Function).apply(t, a));
      if (prop === 'first' || prop === 'all' || prop === 'run' || prop === 'raw') return (...a: unknown[]) => { spend(1); return (v as Function).apply(t, a); };
      return typeof v === 'function' ? (v as Function).bind(t) : v;
    },
    });
    raw.set(p, s);
    return p;
  };
  return new Proxy(db, {
    get(t, prop) {
      const v = Reflect.get(t, prop, t);
      if (prop === 'prepare') return (sql: string) => wrapStmt((v as Function).call(t, sql) as D1PreparedStatement);
      if (prop === 'batch') return (stmts: D1PreparedStatement[]) => { spend(stmts.length); return (v as Function).call(t, stmts.map((x) => raw.get(x) ?? x)); };
      if (prop === 'exec') return (sql: string) => { spend(Math.max(1, sql.split(';').filter((x) => x.trim()).length)); return (v as Function).call(t, sql); };
      return typeof v === 'function' ? (v as Function).bind(t) : v;
    },
  });
}
