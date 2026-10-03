// Lectura local de tickets en PDF: el archivo no sale del navegador; solo se extrae su capa de texto.
// pdf.js se carga bajo demanda (no pesa en el resto de la app) y su worker se sirve desde el propio origen,
// compatible con la CSP de Pages (script-src/worker-src 'self', sin eval).
import { pdfItemsToLines, type PdfTextItem } from '../core/parsers/pdf-lines';

export const MAX_PDF_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_PAGES = 10;

export type PdfTextResult = { kind: 'text'; text: string; pages: number } | { kind: 'no-text'; pages: number };

export async function extractPdfText(file: File): Promise<PdfTextResult> {
  if (file.size > MAX_PDF_BYTES) throw new Error('El PDF supera 5 MB; un ticket ocupa mucho menos.');
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (String.fromCharCode(...head) !== '%PDF-') throw new Error('El archivo no es un PDF.');
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), disableFontFace: true, useSystemFonts: false }).promise;
  try {
    if (doc.numPages > MAX_PDF_PAGES) throw new Error(`El PDF tiene ${doc.numPages} páginas; un ticket tiene como mucho ${MAX_PDF_PAGES}.`);
    const lines: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items: PdfTextItem[] = [];
      for (const it of content.items) {
        if (!('str' in it)) continue;
        items.push({ str: it.str, x: it.transform[4], y: it.transform[5], height: it.height || Math.abs(it.transform[3]) });
      }
      lines.push(...pdfItemsToLines(items));
    }
    const text = lines.join('\n').trim();
    return text.length < 10 ? { kind: 'no-text', pages: doc.numPages } : { kind: 'text', text, pages: doc.numPages };
  } finally {
    void doc.destroy();
  }
}
