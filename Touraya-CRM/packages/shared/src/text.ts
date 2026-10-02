/**
 * Text normalisation used for matching free text typed by customers
 * (wilaya/commune names, Facebook column headers, product names).
 */
const ARABIC_DIACRITICS = /[ً-ٰٟـ]/g; // tashkeel + tatweel

export function normalizeText(input: unknown): string {
  if (input === null || input === undefined) return '';
  return String(input)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // latin accents
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .toLowerCase()
    .replace(/['’`´"]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Same as normalizeText but ignores spaces and the Arabic article, for loose comparisons. */
export function looseKey(input: unknown): string {
  return normalizeText(input)
    .split(' ')
    .map((w) => (w.startsWith('ال') && w.length > 3 ? w.slice(2) : w))
    .join('')
    .replace(/^(wilaya|ولايه|commune|بلديه)/, '');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    prev = curr;
  }
  return prev[b.length]!;
}

/** 0..1 similarity based on edit distance. */
export function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}
