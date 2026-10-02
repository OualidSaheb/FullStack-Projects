import { normalizeText } from './text';

/** Normalized words without the Arabic article, so "البني" = "بني" and "الأسود" = "اسود". */
const words = (text: string | null | undefined) =>
  normalizeText((text ?? '').replace(/_/g, ' '))
    .split(' ')
    .filter(Boolean)
    .map((w) => (w.startsWith('ال') && w.length > 3 ? w.slice(2) : w))
    .join(' ');

/**
 * Turns the customer's free answer ("أسود_رمادي", "noir et bleu", "L") into
 * one line per piece, matched against the product's known options.
 */
export interface ItemDraft {
  size: string | null;
  color: string | null;
}

/**
 * The customer's answer split into its choices: "البيج الفاتح|الاحمر العنابي|البني",
 * "noir, gris", "أسود_رمادي" (Facebook joins multiple choices with "_").
 */
export function splitAnswer(text: string | null | undefined): string[] {
  const raw = (text ?? '').trim();
  if (!raw) return [];
  const parts = /[|,،;/+\n]/.test(raw) ? raw.split(/[|,،;/+\n]+/) : raw.split(/_+/);
  return parts.map((p) => p.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** Little words that are not choices ("أسود و رمادي", "noir et gris"). */
const FILLERS = new Set(['و', 'او', 'أو', 'مع', 'and', 'et', 'ou', 'or', 'with', 'avec', 'لون', 'الوان', 'مقاس', 'size', 'taille']);

/**
 * Choices in the customer's answer that the product does not have yet (to add
 * them in one click). Works with separated answers ("a|b|c") and with plain
 * space-separated ones ("أسود أحمر") — leftover words after removing known options.
 */
export function unknownOptions(request: { size?: string | null; colors?: string | null }, product: { sizes: string[]; colors: string[] }) {
  const unknown = (answer: string | null | undefined, options: string[]): string[] => {
    const parts = splitAnswer(answer);
    const known = new Set(options.map(words));
    const isKnown = (choice: string) => known.has(words(choice)) || findOptions(choice, options).length > 0;
    if (parts.length > 1) return [...new Set(parts.filter((p) => !isKnown(p)))];
    // One block of text: every word not covered by a known option is a new choice.
    const covered = new Set(findOptions(answer, options).flatMap((o) => words(o).split(' ')));
    const leftovers = (answer ?? '')
      .split(/[\s_]+/)
      .map((t) => t.trim())
      .filter((t) => t && !FILLERS.has(normalizeText(t)) && !covered.has(words(t)));
    return [...new Set(leftovers)].filter((t) => !isKnown(t));
  };
  return { sizes: unknown(request.size, product.sizes), colors: unknown(request.colors, product.colors) };
}

/** Known options found in the text, in the order the customer wrote them (repeats allowed). */
export function findOptions(text: string | null | undefined, options: string[]): string[] {
  const haystack = ` ${words(text)} `;
  if (!haystack.trim() || !options.length) return [];
  const hits: { at: number; option: string; len: number }[] = [];
  // Longer names first so "أزرق فاتح" wins over "أزرق".
  const sorted = [...options].sort((a, b) => words(b).length - words(a).length);
  const taken: [number, number][] = [];
  for (const option of sorted) {
    const needle = ` ${words(option)} `;
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
