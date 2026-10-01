#!/usr/bin/env -S npx tsx
/**
 * Comprobación ONLINE de fuentes, separada de los tests deterministas. Solo lee: descarga cada página con adaptador
 * (respetando robots.txt, un navegador, concurrencia 1), la analiza e imprime un registro de verificación.
 * NUNCA escribe en la API ni en D1: no usa SKITRIP_API_URL ni SKITRIP_INGEST_TOKEN.
 *
 *   npx tsx tools/online-check.ts                 # todas las fuentes con adaptador de data/catalog.json
 *   npx tsx tools/online-check.ts grandvalira     # solo las fuentes cuyo id contiene el texto
 *   … --save-html exports/online-check            # guarda el HTML para crear fixtures reales (revisar y sanear antes de subir)
 *
 * El registro (URL, fecha, campos obtenidos, resultado y limitaciones) es lo que hace falta antes de marcar una
 * fuente como «verificada» en data/catalog.json. Este entorno de desarrollo no tiene salida a esas webs: se ejecuta en
 * GitHub Actions (workflow manual) o en un equipo con acceso.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseOfferCardsHtml } from '../src/core/parsers/offers.ts';
import { OFFICIAL_ADAPTERS } from '../src/core/parsers/official-snow.ts';
import { esquiadesAdapter } from '../src/core/parsers/snow.ts';
import { allowedByRobots, BlockedError, withBrowser } from './collectors/lib.ts';

type Src = { id: string; kind: string; url: string; adapter: string | null; status: string };
const args = process.argv.slice(2);
const saveDir = args.includes('--save-html') ? args[args.indexOf('--save-html') + 1] : null;
const filter = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--save-html') ?? '';
const catalog = JSON.parse(readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8')) as { sources: Src[] };
const sources = catalog.sources.filter((s) => s.adapter && s.id.includes(filter));

// Resultado por fuente: transporte (carga o no), extracción (filas reconocidas), «sin datos legítimo» (la página lo dice
// con texto propio) o estructura incompatible (cargó pero no se reconoce nada). Un bloqueo o el robots.txt van aparte.
const NO_DATA = /no hemos encontrado ning[uú]n resultado|no hay ofertas|sin resultados|no est[aá] disponible en este momento|temporada[^.]{0,40}(finalizad|terminad)/i;
type Verdict = 'extracted' | 'no_data' | 'incompatible';
function analyse(s: Src, html: string): { verdict: Verdict; rows: number; sample: unknown; note?: string } {
  const text = html.replace(/<[^>]+>/g, ' ');
  const verdict = (rows: number): Verdict => (rows > 0 ? 'extracted' : NO_DATA.test(text) ? 'no_data' : 'incompatible');
  if (OFFICIAL_ADAPTERS[s.adapter!]) { const r = OFFICIAL_ADAPTERS[s.adapter!].parse(html); return { verdict: verdict(r ? 1 : 0), rows: r ? 1 : 0, sample: r }; }
  if (s.adapter === 'esquiades-status') { const r = esquiadesAdapter.parse(html); return { verdict: verdict(r.length), rows: r.length, sample: r.slice(0, 3) }; }
  if (s.adapter === 'esquiades-cards' || s.adapter === 'estiber-cards') {
    const r = parseOfferCardsHtml(html, s.adapter.startsWith('esquiades') ? 'esquiades' : 'estiber').filter((c) => c.amount);
    return { verdict: verdict(r.length), rows: r.length, sample: r.slice(0, 3).map((c) => ({ hotel: c.hotelName, amount: c.amount?.cents ?? null, unit: c.unit, priceKind: c.priceKind, checkIn: c.checkIn, nights: c.nights, warnings: c.warnings })) };
  }
  return { verdict: 'incompatible', rows: 0, sample: null, note: `sin analizador para ${s.adapter}` };
}

const log: unknown[] = [];
if (saveDir) mkdirSync(saveDir, { recursive: true });
await withBrowser(async (load) => {
  for (const s of sources) {
    const at = new Date().toISOString();
    try {
      if (!(await allowedByRobots(s.url))) { log.push({ id: s.id, url: s.url, catalogStatus: s.status, at, transport: 'robots' }); continue; }
      const html = await load(s.url);
      if (saveDir) writeFileSync(`${saveDir}/${s.id}.html`, html);
      log.push({ id: s.id, url: s.url, catalogStatus: s.status, at, transport: 'ok', ...analyse(s, html) });
    } catch (e) {
      log.push({ id: s.id, url: s.url, catalogStatus: s.status, at, transport: e instanceof BlockedError ? 'blocked' : 'error', error: String((e as Error).message).slice(0, 300) });
    }
  }
});
console.log(JSON.stringify(log, null, 2));
const count = (k: string, v: string) => log.filter((l: any) => l[k] === v).length;
console.error(`Fuentes: ${log.length} · transporte ok ${count('transport', 'ok')} · extraídas ${count('verdict', 'extracted')} · sin datos legítimo ${count('verdict', 'no_data')} · estructura incompatible ${count('verdict', 'incompatible')} · bloqueadas ${count('transport', 'blocked')} · robots ${count('transport', 'robots')} · error de red ${count('transport', 'error')}`);
