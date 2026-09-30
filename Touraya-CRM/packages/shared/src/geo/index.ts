import data from './algeria.json';
import { looseKey, similarity } from '../text';

export interface Commune {
  name: string; // official carrier name (Yalidine "nom officiel")
  nameAr: string;
  aliases: string[]; // other common Latin spellings
}

export interface Wilaya {
  code: number;
  name: string; // French name, as used by Yalidine
  nameAr: string;
  communes: Commune[];
}

/** Source: the carrier's official wilaya/commune list (integrations/yalidine), with Arabic names attached. */
export const WILAYAS: Wilaya[] = (data as { code: number; name: string; nameAr: string; communes: string[][] }[]).map((w) => ({
  code: w.code,
  name: w.name,
  nameAr: w.nameAr,
  communes: w.communes.map(([name = '', nameAr = '', ...aliases]) => ({ name, nameAr, aliases })),
}));

const byCode = new Map(WILAYAS.map((w) => [w.code, w]));

export function getWilaya(code: number | null | undefined): Wilaya | undefined {
  return code ? byCode.get(code) : undefined;
}

/** Common alternative spellings customers / Facebook forms use. */
const WILAYA_ALIASES: Record<string, number> = {
  algiers: 16, alger: 16, dzair: 16, 'الجزائر العاصمه': 16, 'العاصمه': 16, 'الجزائر': 16,
  bejaia: 6, bgayet: 6, 'بجايه': 6,
  'tizi ouzou': 15, tizi: 15,
  'sidi bel abbes': 22, sba: 22,
  msila: 28, 'm sila': 28,
  'bordj bou arreridj': 34, bba: 34, bordj: 34,
  'oum el bouaghi': 4, oeb: 4,
  constantine: 25, qacentina: 25,
  oran: 31, wahran: 31,
};

function wilayaKeys(w: Wilaya): string[] {
  return [w.name, w.nameAr, String(w.code), String(w.code).padStart(2, '0')].map(looseKey);
}

const wilayaIndex = new Map<string, number>();
for (const w of WILAYAS) for (const k of wilayaKeys(w)) wilayaIndex.set(k, w.code);
for (const [alias, code] of Object.entries(WILAYA_ALIASES)) wilayaIndex.set(looseKey(alias), code);

export interface GeoMatch<T> {
  value: T;
  exact: boolean;
  score: number;
}

/**
 * Finds a wilaya from free text: "16", "16 - Alger", "الجزائر", "Béjaïa"…
 */
export function matchWilaya(input: unknown): GeoMatch<Wilaya> | null {
  const text = String(input ?? '').trim();
  if (!text) return null;

  const leadingCode = /^(\d{1,2})\b/.exec(text);
  if (leadingCode) {
    const w = getWilaya(Number(leadingCode[1]));
    if (w) return { value: w, exact: true, score: 1 };
  }

  const key = looseKey(text);
  const direct = wilayaIndex.get(key);
  if (direct) return { value: byCode.get(direct)!, exact: true, score: 1 };

  // "16 Alger" / "Alger 16" / "ولاية الجزائر" → try each word group
  for (const part of text.split(/[-–|/,،]+/)) {
    const code = wilayaIndex.get(looseKey(part));
    if (code) return { value: byCode.get(code)!, exact: true, score: 1 };
  }

  return bestFuzzy(WILAYAS, key, wilayaKeys, 0.75);
}

function communeKeys(c: Commune): string[] {
  return [c.name, c.nameAr, ...c.aliases].filter(Boolean).map(looseKey);
}

/** Finds a commune inside a wilaya (or across all wilayas when none is given). */
export function matchCommune(input: unknown, wilayaCode?: number | null): GeoMatch<Commune & { wilayaCode: number }> | null {
  const key = looseKey(input);
  if (!key) return null;
  const scope = wilayaCode ? [getWilaya(wilayaCode)].filter(Boolean) as Wilaya[] : WILAYAS;
  const candidates = scope.flatMap((w) => w.communes.map((c) => ({ ...c, wilayaCode: w.code })));

  const exact = candidates.find((c) => communeKeys(c).includes(key));
  if (exact) return { value: exact, exact: true, score: 1 };
  return bestFuzzy(candidates, key, communeKeys, 0.8);
}

/** Top N closest communes — used by the UI to suggest a fix for misspelled input. */
export function suggestCommunes(input: unknown, wilayaCode?: number | null, limit = 5) {
  const key = looseKey(input);
  if (!key) return [];
  const scope = wilayaCode ? [getWilaya(wilayaCode)].filter(Boolean) as Wilaya[] : WILAYAS;
  return scope
    .flatMap((w) => w.communes.map((c) => ({ ...c, wilayaCode: w.code })))
    .map((c) => ({ commune: c, score: Math.max(...communeKeys(c).map((k) => similarity(k, key))) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function bestFuzzy<T>(items: T[], key: string, keysOf: (t: T) => string[], threshold: number): GeoMatch<T> | null {
  let best: GeoMatch<T> | null = null;
  for (const item of items) {
    for (const k of keysOf(item)) {
      const score = similarity(k, key);
      if (score >= threshold && (!best || score > best.score)) best = { value: item, exact: false, score };
    }
  }
  return best;
}
