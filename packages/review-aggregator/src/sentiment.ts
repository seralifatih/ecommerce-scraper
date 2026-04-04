import { cleanText, turkishLowerCase } from '@workspace/shared';

import type { SentimentTag } from './types.js';

export const POSITIVE_KEYWORDS = [
  'm\u00fckemmel',
  'harika',
  's\u00fcper',
  'memnunum',
  'tavsiye ederim',
  'kaliteli',
  'h\u0131zl\u0131',
  'g\u00fczel',
  'ba\u015far\u0131l\u0131',
  'sa\u011flam',
] as const;

export const NEGATIVE_KEYWORDS = [
  'k\u00f6t\u00fc',
  'berbat',
  'memnun de\u011filim',
  'iade',
  'bozuk',
  'sahte',
  'ge\u00e7',
  'eksik',
  'k\u0131r\u0131k',
  'pi\u015fman\u0131m',
] as const;

function normalizeReviewText(text: string): string {
  return turkishLowerCase(cleanText(text));
}

function countKeywordHits(text: string, keywords: readonly string[]): number {
  return keywords.reduce((count, keyword) => {
    return count + (text.includes(keyword) ? 1 : 0);
  }, 0);
}

export function tagSentiment(text: string, rating: number): SentimentTag {
  const normalizedText = normalizeReviewText(text);
  const positiveHits = normalizedText ? countKeywordHits(normalizedText, POSITIVE_KEYWORDS) : 0;
  const negativeHits = normalizedText ? countKeywordHits(normalizedText, NEGATIVE_KEYWORDS) : 0;

  if (positiveHits > 0 && negativeHits > 0) {
    if (positiveHits >= negativeHits + 2) {
      return 'positive';
    }

    if (negativeHits >= positiveHits + 2) {
      return 'negative';
    }

    return 'mixed';
  }

  if (positiveHits > 0) {
    return 'positive';
  }

  if (negativeHits > 0) {
    return 'negative';
  }

  if (rating >= 4) {
    return 'positive';
  }

  if (rating <= 2) {
    return 'negative';
  }

  return 'neutral';
}
