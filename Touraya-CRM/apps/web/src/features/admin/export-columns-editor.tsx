import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { DEFAULT_EXPORT_COLUMNS, EXPORT_FIELDS, type ExportColumn, type ExportFieldKey } from '@touraya/shared';
import { Button, IconButton, Input, Select } from '@/components/ui';

function ColumnRow({ col, onChange, onMove, onRemove }: { col: ExportColumn; onChange: (c: ExportColumn) => void; onMove: (d: -1 | 1) => void; onRemove: () => void }) {
  const isField = 'field' in col;
  return (
    <div className="grid grid-cols-12 items-center gap-2 py-2">
      <Input className="col-span-12 sm:col-span-5" dir="ltr" value={col.header.replace(/\n/g, ' ⏎ ')} onChange={(e) => onChange({ ...col, header: e.target.value.replace(/ ⏎ /g, '\n') })} aria-label="عنوان العمود" />
      <Select
        className="col-span-5 sm:col-span-3"
        value={isField ? `field:${col.field}` : 'value'}
        onChange={(e) => onChange(e.target.value === 'value' ? { header: col.header, value: '' } : { header: col.header, field: e.target.value.slice(6) as ExportFieldKey })}
        aria-label="المصدر"
      >
        <option value="value">قيمة ثابتة</option>
        {(Object.keys(EXPORT_FIELDS) as ExportFieldKey[]).map((k) => <option key={k} value={`field:${k}`}>{EXPORT_FIELDS[k].label}</option>)}
      </Select>
      <Input className="col-span-4 sm:col-span-2" dir="ltr" disabled={isField} value={isField ? '' : String(col.value)} onChange={(e) => !isField && onChange({ header: col.header, value: e.target.value })} aria-label="القيمة" />
      <div className="col-span-3 flex justify-end sm:col-span-2">
        <IconButton label="أعلى" icon={<ArrowUp className="size-3.5" />} onClick={() => onMove(-1)} />
        <IconButton label="أسفل" icon={<ArrowDown className="size-3.5" />} onClick={() => onMove(1)} />
        <IconButton label="حذف" className="hover:text-danger" icon={<Trash2 className="size-3.5" />} onClick={onRemove} />
      </div>
    </div>
  );
}

/** Columns of the carrier Excel file: each one is an order field or a constant. */
export function ExportColumnsEditor({ value, onChange }: { value: ExportColumn[]; onChange: (v: ExportColumn[]) => void }) {
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  return (
    <div>
      <div className="divide-y divide-line">
        {value.map((col, i) => (
          <ColumnRow key={i} col={col} onChange={(c) => onChange(value.map((x, k) => (k === i ? c : x)))} onMove={(d) => move(i, d)} onRemove={() => onChange(value.filter((_, k) => k !== i))} />
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => onChange([...value, { header: 'new', value: '' }])}>عمود</Button>
        <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => onChange(DEFAULT_EXPORT_COLUMNS)}>قالب Yalidine</Button>
      </div>
    </div>
  );
}
