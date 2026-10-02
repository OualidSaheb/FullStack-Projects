import { useMemo } from 'react';
import { getWilaya, suggestCommunes, WILAYAS } from '@touraya/shared';
import { Field, Select } from './ui';

/**
 * Wilaya → commune dropdowns. Communes are limited to the chosen wilaya and use
 * the carrier's official names. When the customer's typed commune did not match,
 * the closest names are suggested first.
 */
export function WilayaCommuneSelect({
  wilayaCode,
  communeName,
  communeRaw,
  onChange,
}: {
  wilayaCode: number | null;
  communeName: string | null;
  communeRaw?: string | null;
  onChange: (v: { wilayaCode: number | null; communeName: string | null }) => void;
}) {
  const wilaya = getWilaya(wilayaCode);
  const suggestions = useMemo(
    () => (communeRaw && !communeName && wilayaCode ? suggestCommunes(communeRaw, wilayaCode, 3).filter((s) => s.score > 0.4) : []),
    [communeRaw, communeName, wilayaCode],
  );
  const communeInList = !communeName || wilaya?.communes.some((c) => c.name === communeName);

  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="الولاية">
        {(id) => (
          <Select id={id} value={wilayaCode ?? ''} onChange={(e) => onChange({ wilayaCode: e.target.value ? Number(e.target.value) : null, communeName: null })}>
            <option value="">— اختر الولاية —</option>
            {WILAYAS.map((w) => (
              <option key={w.code} value={w.code}>
                {String(w.code).padStart(2, '0')} - {w.nameAr} ({w.name})
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label="البلدية"
        error={!communeInList ? 'البلدية ليست من قائمة هذه الولاية' : undefined}
        hint={communeRaw && !communeName ? `كتب الزبون: «${communeRaw}»` : undefined}
      >
        {(id) => (
          <Select id={id} value={communeName ?? ''} disabled={!wilaya} onChange={(e) => onChange({ wilayaCode, communeName: e.target.value || null })}>
            <option value="">— اختر البلدية —</option>
            {suggestions.length > 0 && (
              <optgroup label="اقتراحات">
                {suggestions.map((s) => (
                  <option key={`s-${s.commune.name}`} value={s.commune.name}>
                    {s.commune.nameAr || s.commune.name} ({s.commune.name})
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label={wilaya ? `بلديات ${wilaya.nameAr}` : 'البلديات'}>
              {wilaya?.communes.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.nameAr ? `${c.nameAr} (${c.name})` : c.name}
                </option>
              ))}
            </optgroup>
          </Select>
        )}
      </Field>
    </div>
  );
}

export function wilayaLabel(code: number | null | undefined): string {
  const w = getWilaya(code);
  return w ? `${String(w.code).padStart(2, '0')} ${w.nameAr}` : '—';
}

export function communeLabel(name: string | null, wilayaCode: number | null): string | null {
  if (!name) return null;
  return getWilaya(wilayaCode)?.communes.find((c) => c.name === name)?.nameAr || name;
}
