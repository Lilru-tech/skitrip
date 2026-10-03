#!/usr/bin/env -S npx tsx
// Genera docs/SOURCES.md a partir de data/catalog.json (única fuente de verdad de la matriz de fuentes).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const V2 = path.resolve(import.meta.dirname, '..');
const c = JSON.parse(readFileSync(path.join(V2, 'data/catalog.json'), 'utf8'));
const areaName = new Map<string, string>(c.areas.map((a: any) => [a.id, a.name]));
const esc = (s: unknown) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const STATUS: Record<string, string> = { verified: 'verificada', unverified: 'no verificada online', disabled: 'deshabilitada' };

const out: string[] = [
  '# Matriz de fuentes',
  '',
  '> Generado con `npx tsx tools/gen-sources-doc.ts` desde `data/catalog.json`. No editar a mano.',
  '',
  '«No verificada online» significa que el adaptador está probado con fixtures sintéticos pero todavía no ha corrido contra la web real (este entorno no tiene salida a esas webs; la primera ejecución real será en GitHub Actions). Un campo que una fuente no publica se queda vacío: nunca se infiere.',
  '',
];
for (const [kind, title] of [['snow', 'Nieve'], ['offers', 'Ofertas de alojamiento y paquetes']] as const) {
  out.push(`## ${title}`, '', '| Ámbito | Proveedor | Método | Campos | Adaptador | Estado | Revisada | Limitaciones |', '|---|---|---|---|---|---|---|---|');
  for (const s of c.sources.filter((s: any) => s.kind === kind).sort((a: any, b: any) => esc(areaName.get(a.scope)).localeCompare(esc(areaName.get(b.scope))) || a.priority - b.priority)) {
    out.push(`| ${esc(areaName.get(s.scope) ?? s.scope)} | ${esc(s.provider)} | ${esc(s.method)} | ${esc(s.fields.join(', '))} | ${esc(s.adapter ?? 'sin adaptador')} | ${esc(STATUS[s.status] ?? s.status)} | ${esc(s.checked_on ?? '—')} | ${esc(s.limitations)} |`);
  }
  out.push('');
}
out.push(
  '## Precios de supermercado',
  '',
  '| Fuente | Estado | Uso | Limitaciones |',
  '|---|---|---|---|',
  '| Mercadona (web/API directa) | **Deshabilitada** (`src/worker/price-providers.ts`, `enabled: false`) | Ninguno | Sin autorización del titular. No se sustituye por proxy, extensión ni otro mecanismo equivalente. |',
  '| Precio manual | Implementada y probada | Precio con tienda, CP (43007 por defecto), canal y fecha | Lo introduce una persona; queda marcado como manual. |',
  '| CSV propio | Implementada y probada | Previsualizar y confirmar; el servidor vuelve a analizar el CSV | Columnas en `src/worker/routes/shopping.ts`. |',
  '| Ticket en texto | Implementada y probada | Pegar el texto del ticket, revisar líneas y confirmar; puede crear un gasto | Sin OCR. El formato de ticket se ha probado con un fixture sintético. |',
  '| Open Prices (Open Food Facts) | Implementada, no verificada online | Capa colaborativa separada, caché 7 días, atribución ODbL visible | Cobertura muy escasa para productos de Mercadona en España; nunca se mezcla con los precios propios. |',
  '',
  '## Distancias',
  '',
  'Rutas por carretera curadas en `data/catalog.json` (`routes`), heredadas del legacy con su fuente y fecha. `validateRoutes` marca incoherencias (ruta más corta que la línea recta, desvíos excesivos, vecinos con distancias dispares); las marcadas se muestran como «por revisar». La distancia en línea recta solo se usa como estimación geográfica.',
  '',
);
writeFileSync(path.join(V2, 'docs/SOURCES.md'), out.join('\n'));
console.log('docs/SOURCES.md generado');
