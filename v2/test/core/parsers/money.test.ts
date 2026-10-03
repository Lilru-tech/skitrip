import { describe, it, expect } from 'vitest';
import { findMoney, formatEuros, parseAmount } from '../../../src/core/parsers/money';

const c = (s: string) => parseAmount(s)?.cents ?? null;

describe('parseAmount', () => {
  it('Spanish thousands dot + decimal comma', () => {
    expect(parseAmount('1.234,56 €')).toEqual({ cents: 123456, currency: 'EUR' });
    expect(c('12.345.678,90 €')).toBeNull(); // > 1.000.000 €
    expect(c('999.999,99 €')).toBe(99999999);
  });
  it('decimal comma without thousands', () => {
    expect(c('1234,56€')).toBe(123456);
    expect(c('0,99')).toBe(99);
    expect(c('12,5 €')).toBe(1250);
  });
  it('decimal dot', () => {
    expect(c('1234.56 €')).toBe(123456);
    expect(c('12.50')).toBe(1250);
    expect(c('12.5 €')).toBe(1250);
  });
  it('space thousands: normal, non-breaking, narrow and thin spaces', () => {
    expect(c('1 234,56 €')).toBe(123456);
    expect(c('1 234,56 €')).toBe(123456);
    expect(c('1 234,56 €')).toBe(123456);
    expect(c('1 234,56 €')).toBe(123456);
  });
  it('currency before/after, with or without space', () => {
    expect(c('€ 99')).toBe(9900);
    expect(c('€99')).toBe(9900);
    expect(c('99 €')).toBe(9900);
    expect(c('82€')).toBe(8200);
    expect(c('99 EUR')).toBe(9900);
  });
  it('single dot + 3 digits is thousands; + 2 digits is decimal (deterministic)', () => {
    expect(c('1.234 €')).toBe(123400);
    expect(c('1.234')).toBe(123400);
    expect(c('1.23')).toBe(123);
  });
  it('no float drift', () => {
    expect(c('0,29 €')).toBe(29);
    expect(c('1,15')).toBe(115);
    expect(c('4,35')).toBe(435);
    expect(c('1.005,07')).toBe(100507);
  });
  it('rejects ambiguous, garbage, negative, absurd and other currencies', () => {
    for (const bad of ['1,234', '1,234 €', '', 'abc', '12,345,67', '1.2.3', '-5 €', '−5 €', '€ -5', '1.234,567', '0099', '1.000.000,01 €', '2.000.000 €', '$99', '99 USD', '£5', '12 34', '1 23,45 €', '99 € 10 €']) {
      expect(parseAmount(bad), bad).toBeNull();
    }
    expect(c('1.000.000 €')).toBe(100000000);
    expect(c('1,234.56')).toBe(123456);
  });
});

describe('findMoney', () => {
  it('finds € amounts in free text and ignores bare numbers', () => {
    const hits = findMoney('2 noches desde 1.234,56 € (antes 1 399 €) hab. 12');
    expect(hits.map((h) => h.cents)).toEqual([123456, 139900]);
  });
  it('does not read an ambiguous comma amount', () => {
    expect(findMoney('1,234 €')).toEqual([]);
  });
  it('formats back in Spanish', () => {
    expect(formatEuros(123456)).toBe('1.234,56 €');
    expect(formatEuros(5)).toBe('0,05 €');
  });
});
