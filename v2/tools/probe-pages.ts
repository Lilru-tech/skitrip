#!/usr/bin/env -S npx tsx
/**
 * Sondeo de páginas candidatas a fuente (solo lectura, respetando robots.txt): para cada URL dice si el robots.txt la
 * permite, si cargó, el título, las peticiones XHR/fetch que hace la página (host y ruta, sin parámetros), lo que el
 * robots.txt impidió cargar y el texto visible de la zona principal. Con --fixtures imprime además la zona principal
 * saneada (core/parsers/fixture.ts) para convertirla en fixture real de los tests. No escribe en la API ni en D1.
 *
 *   npx tsx tools/probe-pages.ts https://www.ejemplo.com/estado-pistas https://… [--fixtures]
 */
import { createHash } from 'node:crypto';
import { pageFixture } from '../src/core/parsers/fixture.ts';
import { visibleText } from '../src/core/page-outcome.ts';
import { allowedByRobots, BlockedError, withBrowser } from './collectors/lib.ts';

const args = process.argv.slice(2);
const fixtures = args.includes('--fixtures');
const urls = args.filter((a) => /^https:\/\/[^\s]+$/.test(a)).slice(0, 15);
if (!urls.length) { console.error('Indica una o más URL https'); process.exit(2); }

await withBrowser(async (load, refused, requested) => {
  for (const url of urls) {
    console.log(`\n===== SONDEO ${url}`);
    if (!(await allowedByRobots(url))) { console.log('robots.txt: NO permitida (no se carga)'); continue; }
    try {
      const html = await load(url);
      const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1].trim() ?? '';
      const main = pageFixture(html, { sourceId: 'sondeo', url, capturedAt: new Date().toISOString(), sha256: createHash('sha256').update(html).digest('hex') }, 60_000, true);
      console.log(`robots.txt: permitida · título: ${title.slice(0, 120)} · HTML ${html.length} bytes`);
      console.log(`XHR/fetch: ${[...new Set(requested())].slice(0, 25).join(' , ') || 'ninguna'}`);
      console.log(`Impedidas por robots.txt: ${[...new Set(refused())].slice(0, 10).join(' , ') || 'ninguna'}`);
      const links = [...new Set([...html.matchAll(/href=["'](https?:\/\/[^"'?#]+|\/[^"'?#]*)["']/gi)].map((m) => m[1]).filter((h) => /pist|nieve|neu|snow|parte|estado|estat|infonie|meteo|ouvert|enneig/i.test(h)))].slice(0, 20);
      console.log(`Enlaces de nieve/pistas: ${links.join(' , ') || 'ninguno'}`);
      console.log(`Texto principal: ${visibleText(main).slice(0, 2500)}`);
      if (fixtures) console.log(`===== FIXTURE ${new URL(url).host}${new URL(url).pathname.replace(/\W+/g, '-')} =====\n${main}\n===== FIN =====`);
    } catch (e) {
      console.log(`${e instanceof BlockedError ? 'BLOQUEADA' : 'ERROR'}: ${String((e as Error).message).slice(0, 300)}`);
    }
  }
});
