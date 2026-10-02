import { normalizeText } from './text';

/**
 * Turns the customer's free answer ("أسود_رمادي", "noir et bleu", "L") into
 * one line per piece, matched against the product's known options.
 */
export interface ItemDraft {
  size: string | null;
  color: string | null;
}

/** Known options found in the text, in the order the customer wrote them (repeats allowed). */
export function findOptions(text: string | null | undefined, options: string[]): string[] {
  const haystack = ` ${normalizeText((text ?? '').replace(/_/g, ' '))} `;
  if (!haystack.trim() || !options.length) return [];
  const hits: { at: number; option: string; len: number }[] = [];
  // Longer names first so "أزرق فاتح" wins over "أزرق".
  const sorted = [...options].sort((a, b) => normalizeText(b).length - normalizeText(a).length);
  const taken: [number, number][] = [];
  for (const option of sorted) {
    const needle = ` ${normalizeText(option)} `;
    if (needle.trim().length === 0) continue;
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) break;
      const end = at + needle.length;
      if (!taken.some(([s, e]) => at < e - 1 && end - 1 > s)) {
        hits.push({ at, option, len: needle.length });
        taken.push([at, end]);
      }
      from = at + 1;
    }
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.option);
}

/**
 * Builds `units` item drafts. Several colors/sizes are assigned in order (one
 * per piece); a single one applies to every piece. Missing values stay null
 * and are completed by the agent during the call.
 */
export function draftItems(units: number, request: { size?: string | null; colors?: string | null }, product: { sizes: string[]; colors: string[] }): ItemDraft[] {
  const colors = findOptions(request.colors, product.colors);
  const sizes = findOptions(request.size, product.sizes);
  const pick = (found: string[], i: number) => (found.length === 1 ? found[0]! : found[i] ?? null);
  return Array.from({ length: Math.max(1, units) }, (_, i) => ({ size: pick(sizes, i), color: pick(colors, i) }));
}
