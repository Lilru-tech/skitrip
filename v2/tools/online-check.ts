#!/usr/bin/env -S npx tsx
/**
 * Comprobación ONLINE de fuentes, separada de los tests deterministas. Solo lee: descarga cada página con adaptador
 * (respetando robots.txt, un navegador, concurrencia 1), la analiza e imprime un registro de verificación.
 * NUNCA escribe en la API ni en D1: no usa SKITRIP_API_URL ni SKITRIP_INGEST_TOKEN.
 *
 *   npx tsx tools/online-check.ts                 # todas las fuentes con adaptador de data/catalog.json
 *   npx tsx tools/online-check.ts grandvalira     # solo las fuentes cuyo id contiene el texto
 *   … --save-html exports/online-check            # guarda el HTML completo (solo en local; no se sube a ningún sitio)
 *   … --fixtures diag/fixtures                    # guarda fixtures reducidos y saneados (src/core/parsers/fixture.ts)
 *                                                 # para copiarlos a test/fixtures/real tras revisarlos
 *
 * El registro (URL, fecha, campos obtenidos, resultado y limitaciones) es lo que hace falta antes de marcar una
 * fuente como «verificada» en data/catalog.json. Este entorno de desarrollo no tiene salida a esas webs: se ejecuta en
 * GitHub Actions (workflow manual) o en un equipo con acceso.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { offerCardsFixture, pageFixture } from '../src/core/parsers/fixture.ts';
import { parseOfferCardsHtml } from '../src/core/parsers/offers.ts';
import { OFFICIAL_ADAPTERS } from '../src/core/parsers/official-snow.ts';
import { esquiadesAdapter } from '../src/core/parsers/snow.ts';
import { allowedByRobots, BlockedError, withBrowser } from './collectors/lib.ts';

type Src = { id: string; kind: string; url: string; adapter: string | null; status: string };
const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const saveDir = opt('--save-html');
const fixturesDir = opt('--fixtures');
const filter = args.find((a, i) => !a.startsWith('--') && !['--save-html', '--fixtures'].includes(args[i - 1])) ?? '';
const catalog = JSON.parse(readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8')) as { sources: Src[] };
const sources = catalog.sources.filter((s) => s.adapter && s.id.includes(filter));

// Resultado por fuente: transporte (carga o no), extracción (filas reconocidas), «sin datos legítimo» (la página lo dice
// con texto propio) o estructura incompatible (cargó pero no se reconoce nada). Un bloqueo o el robots.txt van aparte.
const NO_DATA = /no hemos encontrado ning[uú]n resultado|no hay ofertas|sin resultados|no est[aá] disponible en este momento|temporada[^.]{0,40}(finalizad|terminad)/i;
/** Texto visible (sin scripts, estilos ni plantillas), compactado. */
const visibleText = (html: string) => html.replace(/<(script|style|template|noscript|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
/** Pistas para adaptar el analizador: «€» visibles, clases con aspecto de tarjeta y el texto tras el título principal. */
function incompatibleHint(html: string): string {
  const text = visibleText(html);
  const euros = (text.match(/€/g) ?? []).length;
  const classes = new Map<string, number>();
  for (const m of html.matchAll(/class=["']([^"']+)["']/gi)) for (const c of m[1].split(/\s+/)) if (/offer|oferta|card|hotel|price|precio/i.test(c)) classes.set(c, (classes.get(c) ?? 0) + 1);
  const top = [...classes].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, n]) => `${c}×${n}`).join(' ');
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() ?? '';
  const at = h1 ? text.indexOf(h1, text.indexOf(h1) + 1) : -1;
  const from = at >= 0 ? at : h1 ? Math.max(0, text.indexOf(h1)) : 0;
  return `€×${euros} · clases: ${top || 'ninguna'} · h1: ${h1.slice(0, 80)} · texto: ${text.slice(from, from + 600)}`;
}
type Verdict = 'extracted' | 'no_data' | 'incompatible';
function analyse(s: Src, html: string): { verdict: Verdict; rows: number; sample: unknown; note?: string } {
  const text = html.replace(/<[^>]+>/g, ' ');
  const verdict = (rows: number): Verdict => (rows > 0 ? 'extracted' : NO_DATA.test(text) ? 'no_data' : 'incompatible');
  if (OFFICIAL_ADAPTERS[s.adapter!]) { const r = OFFICIAL_ADAPTERS[s.adapter!].parse(html); return { verdict: verdict(r ? 1 : 0), rows: r ? 1 : 0, sample: r }; }
  if (s.adapter === 'esquiades-status') { const r = esquiadesAdapter.parse(html); return { verdict: verdict(r.length), rows: r.length, sample: r.slice(0, 3) }; }
  if (s.adapter === 'esquiades-cards' || s.adapter === 'estiber-cards') {
    const r = parseOfferCardsHtml(html, s.adapter.startsWith('esquiades') ? 'esquiades' : 'estiber').filter((c) => c.amount);
    const v = verdict(r.length);
    // Sin tarjetas y sin un «no hay ofertas» reconocible: un extracto del texto visible ayuda a decidir si es estructura nueva o un aviso propio.
    const note = v === 'incompatible' ? incompatibleHint(html) : undefined;
    return { verdict: v, rows: r.length, sample: r.slice(0, 3).map((c) => ({ hotel: c.hotelName, amount: c.amount?.cents ?? null, unit: c.unit, priceKind: c.priceKind, checkIn: c.checkIn, nights: c.nights, warnings: c.warnings })), note };
  }
  return { verdict: 'incompatible', rows: 0, sample: null, note: `sin analizador para ${s.adapter}` };
}

const log: unknown[] = [];
if (saveDir) mkdirSync(saveDir, { recursive: true });
if (fixturesDir) mkdirSync(fixturesDir, { recursive: true });
function writeFixture(s: Src, html: string, at: string) {
  const meta = { sourceId: s.id, url: s.url, capturedAt: at, sha256: createHash('sha256').update(html).digest('hex') };
  const cards = s.adapter?.endsWith('-cards');
  const out = cards ? offerCardsFixture(html, s.adapter!.startsWith('esquiades') ? 'esquiades' : 'estiber', meta) : pageFixture(html, meta);
  // Sin tarjetas reconocidas se guarda el cuerpo saneado: es justo lo que hace falta para adaptar el analizador.
  writeFileSync(`${fixturesDir}/${s.id}.${at.slice(0, 10)}.html`, out ?? pageFixture(html, { ...meta, note: 'El analizador no reconoció ninguna tarjeta.' }));
}
await withBrowser(async (load) => {
  for (const s of sources) {
    const at = new Date().toISOString();
    try {
      if (!(await allowedByRobots(s.url))) { log.push({ id: s.id, url: s.url, catalogStatus: s.status, at, transport: 'robots' }); continue; }
      const html = await load(s.url);
      if (saveDir) writeFileSync(`${saveDir}/${s.id}.html`, html);
      if (fixturesDir) writeFixture(s, html, at);
      log.push({ id: s.id, url: s.url, catalogStatus: s.status, at, transport: 'ok', ...analyse(s, html) });
    } catch (e) {
      log.push({ id: s.id, url: s.url, catalogStatus: s.status, at, transport: e instanceof BlockedError ? 'blocked' : 'error', error: String((e as Error).message).slice(0, 300) });
    }
  }
});
console.log(JSON.stringify(log, null, 2));
const count = (k: string, v: string) => log.filter((l: any) => l[k] === v).length;
console.error(`Fuentes: ${log.length} · transporte ok ${count('transport', 'ok')} · extraídas ${count('verdict', 'extracted')} · sin datos legítimo ${count('verdict', 'no_data')} · estructura incompatible ${count('verdict', 'incompatible')} · bloqueadas ${count('transport', 'blocked')} · robots ${count('transport', 'robots')} · error de red ${count('transport', 'error')}`);
