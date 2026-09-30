import { describe, it, expect } from 'vitest';
import { parseReceiptText, receiptHash } from '../../../src/core/parsers/receipt';
import ticket from '../../fixtures/parsers/mercadona-ticket.txt?raw';

describe('parseReceiptText', () => {
  const r = parseReceiptText(ticket);

  it('header data: date, time, postal code, total', () => {
    expect(r.purchasedOn).toBe('2026-09-30');
    expect(r.purchasedTime).toBe('18:42');
    expect(r.postalCode).toBe('22640');
    expect(r.totalCents).toBe(2745);
  });
  it('lines: simple, multi-quantity, weighted (one line and two lines)', () => {
    expect(r.lines).toHaveLength(10);
    expect(r.lines[0]).toMatchObject({ description: 'LECHE ENTERA', qty: 1, unitCents: 89, amountCents: 89, weightGrams: null });
    expect(r.lines[1]).toMatchObject({ description: 'AGUA MINERAL 5L', qty: 2, unitCents: 120, amountCents: 240 });
    expect(r.lines[2]).toMatchObject({ description: 'PLATANO', qty: 1, weightGrams: 1234, unitCents: 199, amountCents: 246 });
    expect(r.lines[3]).toMatchObject({ description: 'MANZANA GOLDEN', weightGrams: 850, unitCents: 210, amountCents: 179 });
    expect(r.lines[3].rawText).toContain('0,850 kg');
  });
  it('sum matches total, payment/VAT section not read as items', () => {
    expect(r.sumMatchesTotal).toBe(true);
    expect(r.warnings).toEqual([]);
  });
  it('sum mismatch is warned', () => {
    const bad = parseReceiptText(ticket.replace('TOTAL (€) 27,45', 'TOTAL (€) 30,00'));
    expect(bad.sumMatchesTotal).toBe(false);
    expect(bad.warnings.join(' ')).toMatch(/no coincide con el total/);
  });
  it('unparseable lines go to warnings, never invented', () => {
    const t = parseReceiptText('01/10/2026 10:00\nDescripción P. Unit Importe\n1 PAN 1,00\nDESCUENTO -0,50\n1 PEPINO\nTOTAL 1,00');
    expect(t.lines).toHaveLength(1);
    expect(t.warnings.some((w) => w.includes('DESCUENTO'))).toBe(true);
    expect(t.warnings.some((w) => w.includes('PEPINO'))).toBe(true);
    expect(t.sumMatchesTotal).toBe(true);
  });
  it('qty > 1 without printed unit price keeps unitCents null; wrong multiplication warned', () => {
    const t = parseReceiptText('Descripción\n3 YOGUR 1,05\n2 AGUA 1,20 2,50\nTOTAL 3,55');
    expect(t.lines[0].unitCents).toBeNull();
    expect(t.warnings.some((w) => w.includes('no da'))).toBe(true);
    expect(t.purchasedOn).toBeNull();
  });
  it('invalid date is not accepted', () => {
    expect(parseReceiptText('31/02/2026 10:00\nTOTAL 1,00').purchasedOn).toBeNull();
  });
});

describe('receiptHash', () => {
  it('same ticket imported twice (even re-spaced) gives the same hash', async () => {
    const a = await receiptHash(parseReceiptText(ticket));
    const b = await receiptHash(parseReceiptText(ticket.replace(/ /g, '  ').replace(/\n/g, '\r\n')));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
  });
  it('different ticket → different hash', async () => {
    const a = await receiptHash(parseReceiptText(ticket));
    const b = await receiptHash(parseReceiptText(ticket.replace('1 PAN DE MOLDE 1,45', '1 PAN DE MOLDE 1,55')));
    expect(b).not.toBe(a);
  });
});
