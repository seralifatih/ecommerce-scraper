import { describe, expect, it } from '@jest/globals';

import {
  turkishCompare,
  turkishLowerCase,
  turkishUpperCase,
} from '../src/turkish-utils.js';

describe('turkishLowerCase', () => {
  it('handles dotted and dotless i characters correctly', () => {
    expect(turkishLowerCase('İI')).toBe('iı');
    expect(turkishLowerCase('IĞDIR')).toBe('ığdır');
  });

  it('returns empty strings unchanged', () => {
    expect(turkishLowerCase('')).toBe('');
  });
});

describe('turkishUpperCase', () => {
  it('handles dotted and dotless i characters correctly', () => {
    expect(turkishUpperCase('iiı')).toBe('İİI');
    expect(turkishUpperCase('istanbul ısparta')).toBe('İSTANBUL ISPARTA');
  });

  it('returns empty strings unchanged', () => {
    expect(turkishUpperCase('')).toBe('');
  });
});

describe('turkishCompare', () => {
  it('uses Turkish alphabetical ordering', () => {
    expect(turkishCompare('c', 'ç')).toBeLessThan(0);
    expect(turkishCompare('ı', 'i')).toBeLessThan(0);
  });

  it('treats identical strings as equal', () => {
    expect(turkishCompare('', '')).toBe(0);
    expect(turkishCompare('mağaza', 'mağaza')).toBe(0);
  });
});
