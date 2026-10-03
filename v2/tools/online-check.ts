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
import { cardKey, parseOfferCardsHtml, type OfferCard } from '../src/core/parsers/offers.ts';
import { classifyEmptyOffersPage, EMPTY_REASON_LABEL, type EmptyReason } from '../src/core/page-outcome.ts';
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
/** Perfil de validación de las tarjetas de una página: lo que hay que mirar antes de habilitarla (destino, límites,
 *  precio, unidad, noches, forfait y duplicados). Solo recuentos y rangos; nada se publica desde aquí. */
function cardProfile(all: OfferCard[]) {
  const priced = all.filter((c) => c.amount);
  const hist = (f: (c: OfferCard) => unknown) => { const m = new Map<string, number>(); for (const c of priced) { const k = String(f(c)); m.set(k, (m.get(k) ?? 0) + 1); } return Object.fromEntries([...m].sort((a, b) => b[1] - a[1])); };
  const keys = priced.map(cardKey);
  const cents = priced.map((c) => c.amount!.cents).sort((a, b) => a - b);
  return {
    tarjetas: all.length, conPrecio: priced.length, ambiguas: all.filter((c) => c.ambiguousPrice).length,
    hoteles: new Set(priced.map((c) => c.hotelName ?? '?')).size, sinHotel: priced.filter((c) => !c.hotelName).length,
    duplicadas: keys.filter((k) => k !== null).length - new Set(keys.filter((k) => k !== null)).size, noDeduplicables: keys.filter((k) => k === null).length,
    euros: cents.length ? `${cents[0] / 100}–${cents[cents.length - 1] / 100}` : '—',
    unidad: hist((c) => c.unit), tipo: hist((c) => c.priceKind), desde: priced.filter((c) => c.saysFrom).length,
    noches: hist((c) => c.nights), forfait: hist((c) => c.forfaitIncluded), diasForfait: hist((c) => c.forfaitDays),
    conFechas: priced.filter((c) => c.checkIn).length, avisos: priced.filter((c) => c.warnings.length).length,
  };
}
function analyse(s: Src, html: string, refusedPaths: string[] = []): { verdict: Verdict; rows: number; sample: unknown; profile?: unknown; reason?: EmptyReason; note?: string } {
  const text = html.replace(/<[^>]+>/g, ' ');
  const verdict = (rows: number): Verdict => (rows > 0 ? 'extracted' : NO_DATA.test(text) ? 'no_data' : 'incompatible');
  if (OFFICIAL_ADAPTERS[s.adapter!]) { const r = OFFICIAL_ADAPTERS[s.adapter!].parse(html); return { verdict: verdict(r ? 1 : 0), rows: r ? 1 : 0, sample: r }; }
  if (s.adapter === 'esquiades-status') {
    const r = esquiadesAdapter.parse(html);
    // Sin filas: el texto que hace que cuente como «sin datos legítimo», para poder clasificarlo en el recolector.
    const t = visibleText(html), m = r.length ? null : NO_DATA.exec(t);
    return { verdict: verdict(r.length), rows: r.length, sample: r.slice(0, 3), note: m ? `aviso de la página: «…${t.slice(Math.max(0, m.index - 200), m.index + m[0].length + 200)}…»` : undefined };
  }
  if (s.adapter === 'esquiades-cards' || s.adapter === 'estiber-cards') {
    const all = parseOfferCardsHtml(html, s.adapter.startsWith('esquiades') ? 'esquiades' : 'estiber');
    const r = all.filter((c) => c.amount);
    // Mismo criterio que el recolector (core/page-outcome.ts) para no discrepar: ausencia confirmada y fuera de
    // temporada son «sin datos legítimo»; robots y formato desconocido, incompatibles (con pistas para adaptarlo).
    const reason = r.length ? undefined : classifyEmptyOffersPage(html, refusedPaths);
    const v: Verdict = r.length ? 'extracted' : reason === 'no_offers' || reason === 'off_season' ? 'no_data' : 'incompatible';
    const note = reason ? `${EMPTY_REASON_LABEL[reason]}${v === 'incompatible' ? ` · ${incompatibleHint(html)}` : ''}` : undefined;
    return { verdict: v, rows: r.length, reason, profile: cardProfile(all), sample: r.slice(0, 3).map((c) => ({ hotel: c.hotelName, amount: c.amount?.cents ?? null, unit: c.unit, priceKind: c.priceKind, checkIn: c.checkIn, nights: c.nights, warnings: c.warnings })), note };
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
  writeFileSync(`${fixturesDir}/${s.id}.${at.slice(0, 10)}.html`, out ?? pageFixture(html, { ...meta, note: 'El analizador no reconoció ninguna tarjeta: solo la zona principal de la página.' }, 80_000, true));
}
await withBrowser(async (load, refused) => {
  for (const s of sources) {
    const at = new Date().toISOString();
    try {
      if (!(await allowedByRobots(s.url))) { log.push({ id: s.id, url: s.url, catalogStatus: s.status, at, transport: 'robots' }); continue; }
      const html = await load(s.url);
      if (saveDir) writeFileSync(`${saveDir}/${s.id}.html`, html);
      if (fixturesDir) writeFixture(s, html, at);
      const a = analyse(s, html, refused());
      // El catálogo y la comprobación no deben discrepar en silencio: una fuente apartada que hoy extrae se señala.
      const mismatch = a.verdict === 'extracted' && ['unsupported', 'broken', 'disabled'].includes(s.status) ? `el catálogo la tiene como «${s.status}» y hoy extrae: revisar el perfil antes de habilitarla` : undefined;
      log.push({ id: s.id, url: s.url, catalogStatus: s.status, at, transport: 'ok', ...a, ...(mismatch ? { note: [mismatch, a.note].filter(Boolean).join(' · ') } : {}) });
    } catch (e) {
      log.push({ id: s.id, url: s.url, catalogStatus: s.status, at, transport: e instanceof BlockedError ? 'blocked' : 'error', error: String((e as Error).message).slice(0, 300) });
    }
  }
});
console.log(JSON.stringify(log, null, 2));
const count = (k: string, v: string) => log.filter((l: any) => l[k] === v).length;
console.error(`Fuentes: ${log.length} · transporte ok ${count('transport', 'ok')} · extraídas ${count('verdict', 'extracted')} · sin datos legítimo ${count('verdict', 'no_data')} · estructura incompatible ${count('verdict', 'incompatible')} · bloqueadas ${count('transport', 'blocked')} · robots ${count('transport', 'robots')} · error de red ${count('transport', 'error')}`);
