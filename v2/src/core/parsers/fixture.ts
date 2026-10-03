// Fixture reducido y saneado a partir del HTML real de una página pública (comprobación online → test/fixtures/real).
// Conserva la estructura y las clases que leen los analizadores; quita scripts, estilos, imágenes, formularios,
// atributos de seguimiento y parámetros de las URL. Así el fixture es pequeño, legible y sin identificadores de sesión.
import { findAll, isEl, parseHtml, type El, type HtmlNode } from './html';
import { findOfferCards, type Provider } from './offers';

const DROP = new Set(['script', 'style', 'template', 'noscript', 'svg', 'iframe', 'img', 'picture', 'source', 'video', 'audio', 'canvas', 'form', 'input', 'select', 'textarea', 'button', 'link', 'meta', 'head']);
const VOID = new Set(['br', 'hr', 'wbr']);
const KEEP_ATTRS = new Set(['class', 'href', 'datetime', 'data-offer-id', 'data-hotel-id', 'data-product-id', 'data-id', 'style']);

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => escText(s).replace(/"/g, '&quot;');

/** href sin parámetros ni fragmento (pueden llevar sesión o seguimiento); solo http(s) o rutas relativas. */
function cleanHref(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    if (!/^https?:$/.test(u.protocol)) return null;
    return `${u.origin}${u.pathname}`;
  } catch { return null; }
}

function attrs(el: El, base: string): string {
  let out = '';
  for (const [k, v] of Object.entries(el.attrs)) {
    if (!KEEP_ATTRS.has(k)) continue;
    // De style solo interesa el tachado, que distingue el precio anterior.
    const val = k === 'href' ? cleanHref(v, base) : k === 'style' ? (/line-through/i.test(v) ? 'text-decoration:line-through' : null) : v.trim();
    if (val) out += ` ${k}="${escAttr(val)}"`;
  }
  return out;
}

function serialize(n: HtmlNode, base: string, depth: number): string {
  if (!isEl(n)) return escText(n.replace(/\s+/g, ' '));
  if (DROP.has(n.tag)) return '';
  const inner = n.children.map((c) => serialize(c, base, depth + 1)).join('');
  if (VOID.has(n.tag)) return `<${n.tag}>`;
  // Contenedores vacíos tras sanear (iconos, imágenes) no aportan nada.
  if (!inner.trim() && n.tag !== 'td' && n.tag !== 'th') return '';
  return `<${n.tag}${attrs(n, base)}>${inner}</${n.tag}>`;
}

export interface FixtureMeta { sourceId: string; url: string; capturedAt: string; sha256: string; note?: string }

function header(meta: FixtureMeta, what: string): string {
  const safe = (s: string) => s.replace(/--/g, '—');
  return `<!-- CAPTURA REAL REDUCIDA Y SANEADA (${safe(what)}). Fuente: ${safe(meta.sourceId)} · ${safe(meta.url)} · descargada ${safe(meta.capturedAt)} por tools/online-check.ts · sha256 del HTML original ${meta.sha256}. Sin scripts, estilos, imágenes, formularios ni parámetros de URL.${meta.note ? ' ' + safe(meta.note) : ''} -->\n`;
}

/** Tarjetas de oferta reconocidas (cada una intacta y por separado), como máximo `max`. null si no hay ninguna. */
export function offerCardsFixture(html: string, provider: Provider, meta: FixtureMeta, max = 6): string | null {
  const cards = findOfferCards(parseHtml(html), provider).slice(0, max);
  if (!cards.length) return null;
  const body = cards.map((c) => serialize(c, meta.url, 0)).join('\n');
  return `${header(meta, `${cards.length} tarjetas de oferta tal como las reconoce el analizador`)}<!doctype html>\n<html lang="es"><body>\n${body}\n</body></html>\n`;
}

/** Zona principal de una página (sin menús ni pie): <main> o el contenedor «main» de ofertas, si existe. */
function mainRegion(doc: El): El | null {
  return findAll(doc, (e) => e.tag === 'main')[0]
    ?? findAll(doc, (e) => (e.attrs.class ?? '').split(/\s+/).some((c) => /(^|-)main(-|$)|offers-page|ofertas/i.test(c) && !/menu|nav|header|footer/i.test(c)))[0]
    ?? null;
}

/** Cuerpo de la página saneado (partes de nieve), acotado a `maxBytes`. Con `main`, solo la zona principal. */
export function pageFixture(html: string, meta: FixtureMeta, maxBytes = 80_000, main = false): string {
  const doc = parseHtml(html);
  const body = (main ? mainRegion(doc) : null) ?? findAll(doc, (e) => e.tag === 'body')[0] ?? doc;
  let out = body.children.map((c) => serialize(c, meta.url, 0)).join('').replace(/\s{2,}/g, ' ');
  const cut = out.length > maxBytes;
  if (cut) out = out.slice(0, maxBytes);
  return `${header(meta, cut ? `cuerpo de la página recortado a ${maxBytes} bytes` : 'cuerpo de la página')}<!doctype html>\n<html lang="es"><body>\n${out}\n</body></html>\n`;
}
