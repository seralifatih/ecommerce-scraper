import { describe, expect, it } from '@jest/globals';

import {
  cleanText,
  generateSlug,
  normalizeRating,
  parseTurkishPrice,
} from '../src/normalizer.js';

describe('parseTurkishPrice', () => {
  it('parses Turkish-formatted prices with TL suffix', () => {
    expect(parseTurkishPrice('1.299,99 TL')).toEqual({
      amount: 1299.99,
      currency: 'TRY',
    });
  });

  it('parses symbol-prefixed prices that use dot decimals', () => {
    expect(parseTurkishPrice('₺1299.99')).toEqual({
      amount: 1299.99,
      currency: 'TRY',
    });
  });

  it('defaults to TRY when no currency marker is present', () => {
    expect(parseTurkishPrice('1299,99')).toEqual({
      amount: 1299.99,
      currency: 'TRY',
    });
  });

  it('throws for empty or non-numeric prices', () => {
    expect(() => parseTurkishPrice('')).toThrow();
    expect(() => parseTurkishPrice('fiyat yok')).toThrow();
  });
});

describe('normalizeRating', () => {
  it('normalizes arbitrary scales into the 0-5 range', () => {
    expect(normalizeRating(80, 100)).toBe(4);
  });

  it('clamps values outside the expected bounds', () => {
    expect(normalizeRating(-1, 5)).toBe(0);
    expect(normalizeRating(8, 5)).toBe(5);
  });
});

describe('cleanText', () => {
  it('trims text and collapses internal whitespace', () => {
    expect(cleanText('  Merhaba   \n  dunya\t ')).toBe('Merhaba dunya');
  });

  it('normalizes unicode into a stable form', () => {
    expect(cleanText('I\u0307stanbul')).toBe('İstanbul');
  });
});

describe('generateSlug', () => {
  it('creates Turkish-aware slugs', () => {
    expect(generateSlug('İstanbul Çılgın Şeker')).toBe('istanbul-cilgin-seker');
  });

  it('returns an empty slug for empty content', () => {
    expect(generateSlug('  ')).toBe('');
  });
});
