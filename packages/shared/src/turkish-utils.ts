const TURKISH_LOCALE = 'tr-TR';

export function turkishLowerCase(text: string): string {
  return text.replace(/I/g, 'ı').replace(/İ/g, 'i').toLocaleLowerCase(TURKISH_LOCALE);
}

export function turkishUpperCase(text: string): string {
  return text.replace(/i/g, 'İ').replace(/ı/g, 'I').toLocaleUpperCase(TURKISH_LOCALE);
}

export function turkishCompare(a: string, b: string): number {
  return a.localeCompare(b, TURKISH_LOCALE, {
    sensitivity: 'variant',
    numeric: true,
  });
}
