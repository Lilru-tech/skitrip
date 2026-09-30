// Mini parser HTML (sin DOM): suficiente para páginas de proveedores en Workers y Node.
// No pretende ser conforme a la especificación: tolera etiquetas sin cerrar y omite script/style.

export interface El {
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
  parent: El | null;
}
export type HtmlNode = El | string;

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
// Etiquetas que se cierran implícitamente al abrir otra igual (li tras li, etc.).
const AUTO_CLOSE_SAME = new Set(['li', 'p', 'option', 'td', 'th', 'tr', 'dt', 'dd']);
const INLINE = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'dfn', 'em', 'i', 'kbd', 'mark', 'q', 's', 'samp',
  'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'del', 'ins', 'strike', 'label', 'font',
]);

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', thinsp: ' ',
  ndash: '–', mdash: '—', middot: '·', deg: '°', ordm: 'º', ordf: 'ª', iexcl: '¡', iquest: '¿',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í',
  Oacute: 'Ó', Uacute: 'Ú', ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü', iuml: 'ï', ccedil: 'ç',
  Ccedil: 'Ç', agrave: 'à', egrave: 'è', ograve: 'ò', times: '×',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return NAMED[e] ?? m;
  });
}

const TOKEN_RE =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttrs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(src))) {
    const name = m[1].toLowerCase();
    if (name in out) continue;
    out[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

export function parseHtml(html: string): El {
  const root: El = { tag: '#root', attrs: {}, children: [], parent: null };
  let cur = root;
  const pushText = (t: string) => {
    if (t) cur.children.push(decodeEntities(t));
  };
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(html))) {
    pushText(html.slice(last, m.index));
    last = TOKEN_RE.lastIndex;
    if (m[2]) {
      const tag = m[2].toLowerCase();
      // Cierra hasta la apertura correspondiente; si no existe, se ignora.
      for (let e: El | null = cur; e && e !== root; e = e.parent) {
        if (e.tag === tag) {
          cur = e.parent ?? root;
          break;
        }
      }
    } else if (m[3]) {
      const tag = m[3].toLowerCase();
      let attrSrc = m[4] ?? '';
      const selfClosing = /\/\s*$/.test(attrSrc);
      if (selfClosing) attrSrc = attrSrc.replace(/\/\s*$/, '');
      if (AUTO_CLOSE_SAME.has(tag) && cur.tag === tag && cur.parent) cur = cur.parent;
      const el: El = { tag, attrs: parseAttrs(attrSrc), children: [], parent: cur };
      cur.children.push(el);
      if (!selfClosing && !VOID.has(tag)) cur = el;
    }
  }
  pushText(html.slice(last));
  return root;
}

export function isEl(n: HtmlNode): n is El {
  return typeof n !== 'string';
}

export function classes(el: El): string[] {
  return (el.attrs.class ?? '').split(/\s+/).filter(Boolean);
}

/** Recorre descendientes (en orden de documento). `skip` poda subárboles. */
export function findAll(root: El, pred: (el: El) => boolean, skip?: (el: El) => boolean): El[] {
  const out: El[] = [];
  const walk = (el: El) => {
    for (const c of el.children) {
      if (!isEl(c) || (skip && skip(c))) continue;
      if (pred(c)) out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}

/** Elementos que cumplen `pred` y no están dentro de otro que también lo cumple. */
export function findOutermost(root: El, pred: (el: El) => boolean): El[] {
  const out: El[] = [];
  const walk = (el: El) => {
    for (const c of el.children) {
      if (!isEl(c)) continue;
      if (pred(c)) out.push(c);
      else walk(c);
    }
  };
  walk(root);
  return out;
}

export function cleanText(s: string): string {
  return s
    .replace(/[    ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Texto visible aproximado: los elementos inline se concatenan, los de bloque se separan con espacio. */
export function textContent(el: El, skip?: (el: El) => boolean): string {
  let out = '';
  const walk = (n: El) => {
    for (const c of n.children) {
      if (!isEl(c)) {
        out += c;
        continue;
      }
      if (skip && skip(c)) continue;
      const block = !INLINE.has(c.tag);
      if (block || c.tag === 'br') out += ' ';
      walk(c);
      if (block) out += ' ';
    }
  };
  walk(el);
  return cleanText(out);
}

/** Nodos de texto no vacíos, cada uno por separado (útil para filas con celdas en spans). */
export function leafTexts(el: El, skip?: (el: El) => boolean): string[] {
  const out: string[] = [];
  const walk = (n: El) => {
    for (const c of n.children) {
      if (!isEl(c)) {
        const t = cleanText(c);
        if (t) out.push(t);
      } else if (!skip || !skip(c)) walk(c);
    }
  };
  walk(el);
  return out;
}

export function contains(ancestor: El, el: El): boolean {
  for (let e: El | null = el; e; e = e.parent) if (e === ancestor) return true;
  return false;
}
