import { describe, expect, it } from 'vitest';
import { pdfItemsToLines } from '../../../src/core/parsers/pdf-lines';
import { parseReceiptText } from '../../../src/core/parsers/receipt';

const it8 = (str: string, x: number, y: number) => ({ str, x, y, height: 8 });

describe('pdfItemsToLines: líneas de ticket a partir de la capa de texto de un PDF', () => {
  it('une las columnas de la misma altura en orden x y ordena las líneas de arriba abajo', () => {
    // Orden de llegada desordenado, como pdf.js puede devolverlo.
    const lines = pdfItemsToLines([
      it8('0,89', 180, 324), it8('TOTAL (€)', 10, 272), it8('LECHE ENTERA', 22, 324), it8('1', 10, 324),
      it8('2,40', 180, 312), it8('2', 10, 312), it8('1,20', 130, 312), it8('AGUA MINERAL 5L', 22, 312),
      it8('30/09/2026 18:42', 10, 364), it8('3,29', 180, 272),
    ]);
    expect(lines).toEqual(['30/09/2026 18:42', '1 LECHE ENTERA 0,89', '2 AGUA MINERAL 5L 1,20 2,40', 'TOTAL (€) 3,29']);
    const parsed = parseReceiptText(lines.join('\n'));
    expect(parsed.purchasedOn).toBe('2026-09-30');
    expect(parsed.lines.map((l) => [l.qty, l.description, l.amountCents])).toEqual([[1, 'LECHE ENTERA', 89], [2, 'AGUA MINERAL 5L', 240]]);
    expect(parsed.totalCents).toBe(329);
    expect(parsed.sumMatchesTotal).toBe(true);
  });

  it('tolera pequeñas diferencias de línea base dentro de la misma fila y no mezcla filas contiguas', () => {
    expect(pdfItemsToLines([it8('1', 10, 300.4), it8('PAN', 22, 300), it8('1,45', 180, 299.7), it8('1', 10, 288), it8('YOGUR', 22, 288)]))
      .toEqual(['1 PAN 1,45', '1 YOGUR']);
  });

  it('ignora fragmentos vacíos y devuelve [] para un PDF sin texto', () => {
    expect(pdfItemsToLines([it8('  ', 10, 10), it8('', 20, 10)])).toEqual([]);
    expect(pdfItemsToLines([])).toEqual([]);
  });
});
