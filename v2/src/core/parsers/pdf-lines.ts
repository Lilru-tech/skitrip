// Reconstruye las líneas de un ticket a partir de los fragmentos de texto de un PDF (capa de texto de pdf.js).
// Los tickets en PDF colocan cada columna (unidades, descripción, precio, importe) como fragmentos separados
// en la misma altura: se agrupan por línea base (y) y se ordenan de izquierda a derecha (x).
export interface PdfTextItem { str: string; x: number; y: number; height: number }

export function pdfItemsToLines(items: PdfTextItem[]): string[] {
  const parts = items.filter((i) => i.str.trim() !== '');
  // De arriba abajo (en PDF la y crece hacia arriba) y, en la misma altura, de izquierda a derecha.
  parts.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: { y: number; tol: number; items: PdfTextItem[] }[] = [];
  for (const it of parts) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= r.tol);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, tol: Math.max(1, (it.height || 8) * 0.4), items: [it] });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((r) => r.items.sort((a, b) => a.x - b.x).map((i) => i.str.trim()).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}
