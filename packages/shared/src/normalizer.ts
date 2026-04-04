import type { PriceInfo } from './types.js';
import { turkishLowerCase } from './turkish-utils.js';

const TURKISH_CHAR_MAP: Record<string, string> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  i: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
};

function inferCurrency(text: string): string {
  if (/₺|(?:^|\s)TL(?:\s|$)|TRY/i.test(text)) {
    return 'TRY';
  }

  if (/€|EUR/i.test(text)) {
    return 'EUR';
  }

  if (/\$|USD/i.test(text)) {
    return 'USD';
  }

  return 'TRY';
}

function normalizeNumberString(value: string): string {
  const commaMatches = value.match(/,/g) ?? [];
  const dotMatches = value.match(/\./g) ?? [];
  const lastCommaIndex = value.lastIndexOf(',');
  const lastDotIndex = value.lastIndexOf('.');

  if (lastCommaIndex !== -1 && lastDotIndex !== -1) {
    if (lastCommaIndex > lastDotIndex) {
      return value.replace(/\./g, '').replace(',', '.');
    }

    return value.replace(/,/g, '');
  }

  if (lastCommaIndex !== -1) {
    const digitsAfterComma = value.length - lastCommaIndex - 1;
    if (commaMatches.length === 1 && digitsAfterComma > 0 && digitsAfterComma <= 2) {
      return value.replace(',', '.');
    }

    return value.replace(/,/g, '');
  }

  if (lastDotIndex !== -1) {
    const digitsAfterDot = value.length - lastDotIndex - 1;
    if (dotMatches.length === 1 && digitsAfterDot > 0 && digitsAfterDot <= 2) {
      return value;
    }

    return value.replace(/\./g, '');
  }

  return value;
}

export function parseTurkishPrice(text: string): PriceInfo {
  const normalizedText = cleanText(text);

  if (!normalizedText) {
    throw new Error('Price text is empty.');
  }

  const currency = inferCurrency(normalizedText);
  const numericPortion = normalizedText.replace(/[^\d.,-]/g, '');

  if (!/\d/.test(numericPortion)) {
    throw new Error(`Could not parse price from "${text}".`);
  }

  const amount = Number.parseFloat(normalizeNumberString(numericPortion));

  if (!Number.isFinite(amount)) {
    throw new Error(`Could not parse price from "${text}".`);
  }

  return {
    amount,
    currency,
  };
}

export function normalizeRating(value: number, maxScale: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(maxScale) || maxScale <= 0) {
    return 0;
  }

  const normalized = (value / maxScale) * 5;
  return Math.min(5, Math.max(0, Number.parseFloat(normalized.toFixed(2))));
}

export function cleanText(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function generateSlug(text: string): string {
  const cleaned = cleanText(text);

  if (!cleaned) {
    return '';
  }

  const transliterated = turkishLowerCase(cleaned)
    .split('')
    .map((character) => TURKISH_CHAR_MAP[character] ?? character)
    .join('');

  return transliterated
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}
