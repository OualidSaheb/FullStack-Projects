import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import type { ProductDTO, ProductInput } from '@touraya/shared';
import { api } from '@/lib/api';
import { fmtDA } from '@/lib/format';
import { qk, useAdminMutation, useProducts } from '@/lib/queries';
import { Badge, Button, Card, Field, Input, Modal, PageLoader, Switch, TagInput } from '@/components/ui';

const EMPTY: ProductInput = { name: '', carrierName: '', price: 0, aliases: [], sizes: [], colors: [], active: true };

function ProductForm({ product, onClose }: { product: ProductDTO | null; onClose: () => void }) {
  const [form, setForm] = useState<ProductInput>(product ?? EMPTY);
  const save = useAdminMutation(qk.products, (v: ProductInput) => (product ? api.put(`/products/${product.id}`, v) : api.post('/products', v)));
  const set = <K extends keyof ProductInput>(k: K, v: ProductInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Modal open onClose={onClose} title={product ? 'تعديل العرض' : 'عرض جديد'} footer={<><Button variant="ghost" onClick={onClose}>إلغاء</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(form, { onSuccess: onClose })}>حفظ</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="اسم العرض (كما في Facebook)">{(id) => <Input id={id} value={form.name} onChange={(e) => set('name', e.target.value)} />}</Field>
        <Field label="الاسم المشفر لشركة التوصيل">{(id) => <Input id={id} dir="ltr" value={form.carrierName} onChange={(e) => set('carrierName', e.target.value)} />}</Field>
        <Field label="السعر (دج)">{(id) => <Input id={id} type="number" min={0} value={form.price} onChange={(e) => set('price', Number(e.target.value))} />}</Field>
        <Field label="أسماء بديلة للتعرف على العرض" hint="مثلاً جزء من اسم الفورم — Enter للإضافة">{() => <TagInput value={form.aliases} onChange={(v) => set('aliases', v)} />}</Field>
        <Field label="المقاسات المتوفرة">{() => <TagInput value={form.sizes} onChange={(v) => set('sizes', v)} placeholder="M, L, XL…" />}</Field>
        <Field label="الألوان المتوفرة">{() => <TagInput value={form.colors} onChange={(v) => set('colors', v)} />}</Field>
        <Switch checked={form.active} onChange={(v) => set('active', v)} label="مفعل" />
      </div>
    </Modal>
  );
}

export function ProductsTab() {
  const { data: products, isLoading } = useProducts();
  const [editing, setEditing] = useState<ProductDTO | null | 'new'>(null);
  if (isLoading) return <PageLoader />;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">السعر يؤخذ من هنا عند دخول الطلبية، والاسم المشفر هو ما يظهر في ملف التوصيل.</p>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>عرض جديد</Button>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-subtle text-xs text-muted">
            <tr>{['العرض', 'الاسم المشفر', 'السعر', 'مقاسات / ألوان', 'الحالة', ''].map((h) => <th key={h} className="px-4 py-2.5 text-start font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-line">
            {products?.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3 font-medium">{p.name}<div className="text-xs text-faint">{p.aliases.join(' · ')}</div></td>
                <td className="ltr px-4 py-3 text-start"><code className="rounded bg-subtle px-1.5 py-0.5 text-xs">{p.carrierName}</code></td>
                <td className="ltr px-4 py-3 text-start">{fmtDA(p.price)}</td>
                <td className="px-4 py-3 text-xs text-muted">{[...p.sizes, ...p.colors].join('، ') || '—'}</td>
                <td className="px-4 py-3">{p.active ? <Badge tone="ok">مفعل</Badge> : <Badge>متوقف</Badge>}</td>
                <td className="px-4 py-3 text-end"><Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(p)}>تعديل</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {editing && <ProductForm product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
