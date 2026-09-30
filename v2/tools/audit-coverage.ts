// Cobertura de la auditoría de consultas D1: todas las rutas HTTP del Worker deben estar medidas.
// Módulo puro (sin fs): lo usan tools/check-audit-coverage.ts (Node) y test/worker/quota-audit-all.test.ts (workerd, con ?raw).

const METHODS = '(get|post|put|patch|delete)';

/** `POST /api/trips/:id/x?y=1 (variante)` → `POST /trips/:/x`: sin /api, sin query, sin sufijo y con parámetros anónimos. */
export function normalizeRoute(label: string): string {
  const m = /^(GET|POST|PUT|PATCH|DELETE)\s+(\S+)/.exec(label.trim());
  if (!m) throw new Error(`etiqueta no válida: ${label}`);
  let path = m[2].split('?')[0].replace(/^\/api(?=\/|$)/, '');
  path = path.replace(/:\w+(\{[^}]*\})?/g, ':').replace(/\/+$/, '');
  return `${m[1]} ${path || '/'}`;
}

/** `:action{accept|reject}` → una ruta por alternativa literal; otros patrones quedan como parámetro. */
function expandAlternatives(path: string): string[] {
  const m = /:\w+\{([A-Za-z0-9_-]+(?:\|[A-Za-z0-9_-]+)+)\}/.exec(path);
  if (!m) return [path];
  return m[1].split('|').flatMap((alt) => expandAlternatives(path.replace(m[0], alt)));
}

/**
 * Rutas definidas: `index` es src/worker/index.ts y `files` mapea el nombre del módulo de rutas (p. ej. 'trips')
 * a su código. Solo cuentan llamadas sobre variables declaradas como `new Hono` (evita `c.get('user')`, etc.).
 */
export function definedRoutes(index: string, files: Record<string, string>): string[] {
  const out = new Set<string>();
  const add = (method: string, path: string) => { for (const p of expandAlternatives(path)) out.add(normalizeRoute(`${method.toUpperCase()} ${p}`)); };
  // Rutas directas de la app.
  const appVar = /const\s+(\w+)\s*=\s*new Hono\b/.exec(index)?.[1] ?? 'app';
  for (const r of index.matchAll(new RegExp(`\\b${appVar}\\.${METHODS}\\(\\s*'([^']+)'`, 'g'))) add(r[1], r[2]);
  // Variable importada → módulo.
  const moduleOf = new Map<string, string>();
  for (const r of index.matchAll(/import\s*\{([^}]+)\}\s*from\s*'\.\/routes\/([\w-]+)'/g)) for (const v of r[1].split(',')) moduleOf.set(v.trim(), r[2]);
  // Montajes de la app.
  for (const r of index.matchAll(new RegExp(`\\b${appVar}\\.route\\(\\s*'([^']+)'\\s*,\\s*(\\w+)\\s*\\)`, 'g'))) {
    const mod = moduleOf.get(r[2]);
    if (!mod || files[mod] == null) throw new Error(`montaje sin módulo conocido: ${r[2]}`);
    walk(files[mod], r[2], r[1], add);
  }
  return [...out].sort();
}

function walk(src: string, routerVar: string, prefix: string, add: (m: string, p: string) => void) {
  const routers = new Set([...src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*new Hono\b/g)].map((r) => r[1]));
  if (!routers.has(routerVar)) throw new Error(`router ${routerVar} no declarado con new Hono`);
  const join = (a: string, b: string) => (a.replace(/\/$/, '') + (b === '/' ? '' : b)) || '/';
  for (const r of src.matchAll(new RegExp(`\\b${routerVar}\\.${METHODS}\\(\\s*'([^']+)'`, 'g'))) add(r[1], join(prefix, r[2]));
  for (const r of src.matchAll(new RegExp(`\\b${routerVar}\\.route\\(\\s*'([^']+)'\\s*,\\s*(\\w+)\\s*\\)`, 'g'))) {
    if (routers.has(r[2])) walk(src, r[2], join(prefix, r[1]), add);
  }
}

/** Etiquetas medidas en un fichero de auditoría: llamadas `m('MÉTODO /ruta…', …)`. */
export function measuredLabels(testSrc: string): string[] {
  return [...testSrc.matchAll(/\bm\(\s*'((?:GET|POST|PUT|PATCH|DELETE) [^']+)'/g)].map((r) => r[1]);
}

export function coverage(defined: string[], labels: string[]) {
  const measured = new Set(labels.map(normalizeRoute));
  return {
    defined: defined.length,
    measured: defined.filter((d) => measured.has(d)).length,
    missing: defined.filter((d) => !measured.has(d)),
    unknown: [...measured].filter((l) => !defined.includes(l)).sort(),
  };
}
