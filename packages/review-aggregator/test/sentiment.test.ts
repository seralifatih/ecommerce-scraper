import { tagSentiment } from '../src/sentiment.js';

describe('tagSentiment', () => {
  it('returns positive for clearly positive Turkish keywords', () => {
    expect(tagSentiment('Mükemmel ürün, çok kaliteli ve harika.', 5)).toBe('positive');
  });

  it('returns negative for clearly negative Turkish keywords', () => {
    expect(tagSentiment('Kötü çıktı, kırık geldi ve iade ettim.', 1)).toBe('negative');
  });

  it('returns mixed when both positive and negative signals appear together', () => {
    expect(tagSentiment('Kaliteli ama geç geldi ve eksik parça vardı.', 3)).toBe('mixed');
  });

  it('falls back to rating when no keywords are present', () => {
    expect(tagSentiment('Ürün geldi.', 5)).toBe('positive');
    expect(tagSentiment('Ürün geldi.', 2)).toBe('negative');
    expect(tagSentiment('Ürün geldi.', 3)).toBe('neutral');
  });

  it('handles empty review text with rating fallback', () => {
    expect(tagSentiment('', 4)).toBe('positive');
    expect(tagSentiment('', 1)).toBe('negative');
  });
});
