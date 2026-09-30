import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { DEFAULT_EXPORT_COLUMNS, EXPORT_FIELDS, type ExportColumn, type ExportFieldKey } from '@touraya/shared';
import { Button, Card, CardHeader, Field, IconButton, Input, PageLoader, Select, TagInput } from '@/components/ui';
import { useSettingsForm } from './use-settings-form';

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

export function SettingsTab() {
  const { form, setForm, save } = useSettingsForm();
  if (!form) return <PageLoader />;
  const cols = form.exportColumns;
  const setCols = (exportColumns: ExportColumn[]) => setForm({ ...form, exportColumns });
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= cols.length) return;
    const next = [...cols];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setCols(next);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="التعليقات السريعة" />
        <div className="p-4">
          <TagInput value={form.quickComments} onChange={(quickComments) => setForm({ ...form, quickComments })} placeholder="أضف تعليقاً ثم Enter" />
        </div>
      </Card>
      <Card>
        <CardHeader
          title="أعمدة ملف شركة التوصيل"
          action={<Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => setCols(DEFAULT_EXPORT_COLUMNS)}>القالب الأصلي</Button>}
        />
        <div className="p-4">
          <p className="mb-2 text-sm text-muted">مطابقة لقالب الاستيراد الخاص بـ Yalidine. غيّرها فقط إذا غيرت الشركة قالبها.</p>
          <Field label="الصيغة" className="mb-3 w-40">
            {(id) => (
              <Select id={id} value={form.exportFormat} onChange={(e) => setForm({ ...form, exportFormat: e.target.value as 'xlsx' | 'csv' })}>
                <option value="xlsx">Excel (xlsx)</option>
                <option value="csv">CSV</option>
              </Select>
            )}
          </Field>
          <div className="divide-y divide-line">
            {cols.map((col, i) => (
              <ColumnRow
                key={i}
                col={col}
                onChange={(c) => setCols(cols.map((x, k) => (k === i ? c : x)))}
                onMove={(d) => move(i, d)}
                onRemove={() => setCols(cols.filter((_, k) => k !== i))}
              />
            ))}
          </div>
          <Button size="sm" className="mt-2" icon={<Plus className="size-3.5" />} onClick={() => setCols([...cols, { header: 'new', value: '' }])}>عمود</Button>
        </div>
      </Card>
      <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(form)}>حفظ الإعدادات</Button>
    </div>
  );
}
