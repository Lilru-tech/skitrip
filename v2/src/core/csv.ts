// CSV mínimo (RFC 4180): comillas dobles, saltos de línea dentro de comillas, BOM y separador «,» o «;».
// El separador se detecta en la cabecera para no romper decimales con coma («1,50») en ficheros con «;».
export function detectDelimiter(text: string): ',' | ';' {
  let q = false, commas = 0, semis = 0;
  for (const ch of text) {
    if (ch === '"') q = !q;
    else if (!q && ch === '\n') break;
    else if (!q && ch === ',') commas++;
    else if (!q && ch === ';') semis++;
  }
  return semis > commas ? ';' : ',';
}

export function parseCsv(input: string, delimiter: ',' | ';' = detectDelimiter(input.replace(/^﻿/, ''))): string[][] {
  const text = input.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === delimiter) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

/** Filas como objetos por cabecera normalizada (minúsculas, sin acentos ni espacios). */
export function csvRecords(text: string): { headers: string[]; records: Record<string, string>[] } {
  const [head = [], ...body] = parseCsv(text);
  const headers = head.map(normHeader);
  return { headers, records: body.map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()]))) };
}

export const normHeader = (h: string) => h.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase().replace(/[\s-]+/g, '_');
