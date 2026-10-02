import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { LEAD_FIELD_LABELS, LEAD_FIELDS, type FieldMap, type LeadField } from '@touraya/shared';
import { api } from '@/lib/api';
import { qk, useAdminMutation, useSources } from '@/lib/queries';
import { Alert, Button, Card, EmptyState, Field, PageLoader, Select } from '@/components/ui';

/**
 * Maps Facebook form questions (sheet columns) to order fields, per source.
 * "Auto" uses the built-in names; an explicit choice wins. Old orders keep their raw data,
 * so changing questions later never breaks them.
 */
export function MappingTab() {
  const { data: sources } = useSources();
  const [sourceId, setSourceId] = useState<number | null>(null);
  const source = sources?.find((s) => s.id === sourceId) ?? sources?.[0];
  const [fieldMap, setFieldMap] = useState<FieldMap>({});
  useEffect(() => setFieldMap(source?.fieldMap ?? {}), [source]);

  const { data: preview, isLoading } = useQuery({
    queryKey: ['mapping-preview', source?.id, fieldMap],
    queryFn: () => api.post<{ headers: string[]; mapping: Partial<Record<LeadField, string>> }>(`/sources/${source!.id}/preview-mapping`, { fieldMap }),
    enabled: Boolean(source),
  });
  const save = useAdminMutation(qk.sources, () => api.put(`/sources/${source!.id}`, { ...source, fieldMap }));
  const reprocess = useAdminMutation(qk.orders, () => api.post<{ checked: number; updated: number }>(`/sources/${source!.id}/reprocess`), 'تمت إعادة المعالجة');

  if (!sources) return <PageLoader />;
  if (!source) return <Card><EmptyState title="أضف مصدراً أولاً" /></Card>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="المصدر">
          {(id) => (
            <Select id={id} className="w-80" value={source.id} onChange={(e) => setSourceId(Number(e.target.value))}>
              {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          )}
        </Field>
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>حفظ المطابقة</Button>
        <Button
          loading={reprocess.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: () => reprocess.mutate(undefined) })}
          title="بعد تصحيح الأعمدة: يكمل الحقول الفارغة في الطلبيات القديمة من بيانات الفورم الأصلية، بدون تغيير ما عدّله الموظفون"
        >
          حفظ + إعادة معالجة الطلبيات القديمة
        </Button>
        {reprocess.data && <span className="text-sm text-ok">تم تحديث {reprocess.data.updated} من {reprocess.data.checked} طلبية</span>}
      </div>
      <Alert tone="primary" icon={<Info className="mt-0.5 size-4 shrink-0" />}>
        الأعمدة المعروضة هي آخر أعمدة استقبلها النظام من هذا الملف. «تلقائي» يتعرف على الأسماء المعروفة (مثل رقمك_الخاص_للتواصل_معاك، phone_number، الولاية…).
      </Alert>
      {isLoading || !preview ? (
        <PageLoader />
      ) : !preview.headers.length ? (
        <Card><EmptyState title="لم يستقبل النظام أي سطر من هذا الملف بعد">ثبت Apps Script أولاً من تبويب المصادر.</EmptyState></Card>
      ) : (
        <Card className="divide-y divide-line">
          {LEAD_FIELDS.map((field) => {
            const explicit = fieldMap[field]?.[0] ?? '';
            return (
              <div key={field} className="grid items-center gap-2 px-4 py-2.5 sm:grid-cols-3">
                <span className="text-sm font-medium">{LEAD_FIELD_LABELS[field]}</span>
                <Select
                  value={explicit}
                  onChange={(e) => setFieldMap((m) => ({ ...m, [field]: e.target.value ? [e.target.value] : [] }))}
                  aria-label={LEAD_FIELD_LABELS[field]}
                >
                  <option value="">تلقائي</option>
                  {preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </Select>
                <span className="text-xs text-muted">
                  {preview.mapping[field] ? <>← <b className="text-fg">{preview.mapping[field]}</b></> : <span className="text-faint">غير موجود</span>}
                </span>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
