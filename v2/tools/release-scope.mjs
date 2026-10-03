#!/usr/bin/env node
// Qué hay que desplegar según los archivos cambiados (rutas desde la raíz del repositorio).
// La batería de pruebas se ejecuta SIEMPRE para el commit que se publica; esto solo decide si después se despliega la
// API (con sus migraciones e importación) y/o se publica la interfaz. Ante la duda, las dos.
//   git diff --name-only <antes> <commit> | node v2/tools/release-scope.mjs   →  api=true|false y pages=true|false

const BOTH = [
  /^\.github\/workflows\/v2-(release|verify)\.yml$/,
  /^v2\/package(-lock)?\.json$/, // dependencias de los dos lados
  /^v2\/tsconfig[^/]*\.json$/,
  /^v2\/src\/core\//, // código compartido por el Worker y la interfaz
];
const API = [
  /^v2\/src\/worker\//,
  /^v2\/migrations\//,
  /^v2\/wrangler\.jsonc$/,
  /^v2\/tools\/deploy-config\.mjs$/,
  /^v2\/tools\/import-legacy\.ts$/,
  /^v2\/data\//, // catálogo curado que importa el despliegue
  /^data\/(resorts|open_km_history|hotel_price_history)\.json$/, // históricos de la web antigua que se importan
];
const PAGES = [
  /^v2\/src\/web\//,
  /^v2\/index\.html$/,
  /^v2\/public\//,
  /^v2\/vite\.config\.ts$/,
  /^v2\/tools\/verify-pages-artifact\.sh$/,
];

/** @param {string[] | null} files null = no se sabe qué cambió (primer push, historia reescrita): todo. */
export function releaseScope(files) {
  if (files === null) return { api: true, pages: true };
  const hit = (res) => files.some((f) => res.some((re) => re.test(f)));
  const both = hit(BOTH);
  return { api: both || hit(API), pages: both || hit(PAGES) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = await new Promise((resolve) => { let s = ''; process.stdin.on('data', (d) => (s += d)); process.stdin.on('end', () => resolve(s)); });
  const files = process.argv.includes('--all') ? null : input.split('\n').map((l) => l.trim()).filter(Boolean);
  const { api, pages } = releaseScope(files);
  process.stdout.write(`api=${api}\npages=${pages}\n`);
}
