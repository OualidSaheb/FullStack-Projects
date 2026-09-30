import { useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, FileSpreadsheet, MessageSquarePlus, PackagePlus, Pencil, RotateCcw, Send, Trash2, Truck, UserCheck } from 'lucide-react';
import { isOrderStatus, PHONE_ISSUES, type OrderEventDTO, type PhoneIssue } from '@touraya/shared';
import { fmtDateTime, timeAgo } from '@/lib/format';
import { useAddComment, useSettings, useTimeline, useUsers } from '@/lib/queries';
import { useCan } from '@/lib/auth';
import { StatusBadge } from '@/components/status';
import { Button, Card, CardHeader, Spinner, Textarea } from '@/components/ui';

const FIELD_LABELS: Record<string, string> = {
  customerName: 'الاسم', phone: 'الهاتف', phoneAlt: 'هاتف احتياطي', wilayaCode: 'الولاية', communeName: 'البلدية', address: 'العنوان',
  productId: 'العرض', quantity: 'الكمية', price: 'السعر', size: 'المقاس', colors: 'الألوان',
};

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

function EventLine({ e, userName }: { e: OrderEventDTO; userName: (id: unknown) => string }) {
  const d = e.data as Record<string, unknown>;
  let icon: ReactNode = <Pencil className="size-3.5" />;
  let body: ReactNode = e.type;
  switch (e.type) {
    case 'created':
      icon = <PackagePlus className="size-3.5" />;
      body = <>دخلت الطلبية من <b>{show(d.source)}</b> <span className="text-faint">({show(d.sheet)} · سطر {show(d.row)})</span></>;
      break;
    case 'status_changed':
      icon = <ArrowLeft className="size-3.5" />;
      body = (
        <span className="flex flex-wrap items-center gap-1.5">
          {isOrderStatus(d.from) && <StatusBadge status={d.from} short />}
          <ArrowLeft className="size-3 text-faint" />
          {isOrderStatus(d.to) && <StatusBadge status={d.to} short />}
          {d.via === 'yalidine' && <span className="text-xs text-faint">عبر Yalidine</span>}
        </span>
      );
      break;
    case 'updated':
      body = (
        <ul className="space-y-0.5">
          {Object.entries((d.changes ?? {}) as Record<string, [unknown, unknown]>).map(([k, [from, to]]) => (
            <li key={k}>
              {FIELD_LABELS[k] ?? k}: <span className="text-faint line-through">{show(from)}</span> ← <b>{show(to)}</b>
            </li>
          ))}
        </ul>
      );
      break;
    case 'commented':
      icon = <MessageSquarePlus className="size-3.5" />;
      body = <>أضاف تعليقاً: «{show(d.body)}»</>;
      break;
    case 'assigned':
      icon = <UserCheck className="size-3.5" />;
      body = <>أسندت إلى <b>{d.userId ? userName(d.userId) : 'لا أحد'}</b></>;
      break;
    case 'exported':
      icon = <FileSpreadsheet className="size-3.5" />;
      body = <>أضيفت إلى ملف التوصيل رقم {show(d.batchId)}</>;
      break;
    case 'carrier_sent':
      icon = <Send className="size-3.5" />;
      body = <>أرسلت إلى Yalidine — رقم التتبع <b className="ltr">{show(d.tracking)}</b></>;
      break;
    case 'carrier_error':
      icon = <AlertTriangle className="size-3.5 text-danger" />;
      body = <span className="text-danger">فشل الإرسال إلى Yalidine: {show(d.message)}{d.cfRay ? ` (${d.cfRay})` : ''}</span>;
      break;
    case 'carrier_update':
      icon = <Truck className="size-3.5" />;
      body = <>تحديث من شركة التوصيل: <b>{show(d.carrierStatus)}</b></>;
      break;
    case 'phone_issue':
      icon = <AlertTriangle className="size-3.5 text-warn" />;
      body = <span className="text-warn">{PHONE_ISSUES[d.issue as PhoneIssue] ?? 'مشكل في الهاتف'}</span>;
      break;
    case 'deleted':
      icon = <Trash2 className="size-3.5" />;
      body = 'حذفت الطلبية (سلة المحذوفات)';
      break;
    case 'restored':
      icon = <RotateCcw className="size-3.5" />;
      body = 'استرجعت الطلبية';
      break;
  }
  return (
    <li className="flex gap-3 py-2.5">
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-subtle text-muted">{icon}</span>
      <div className="min-w-0 flex-1 text-sm">
        <div>{body}</div>
        <p className="mt-0.5 text-xs text-faint">
          {e.actorName ?? 'النظام'} · <span title={fmtDateTime(e.createdAt)}>{timeAgo(e.createdAt)}</span>
        </p>
      </div>
    </li>
  );
}

export function OrderComments({ orderId }: { orderId: string }) {
  const { data } = useTimeline(orderId);
  const { data: settings } = useSettings();
  const can = useCan();
  const add = useAddComment(orderId);
  const [body, setBody] = useState('');
  const submit = (text = body) => text.trim() && add.mutate(text.trim(), { onSuccess: () => setBody('') });

  return (
    <Card>
      <CardHeader title={`التعليقات (${data?.comments.length ?? 0})`} icon={<MessageSquarePlus className="size-4 text-muted" />} />
      {can('orders.comment') && (
        <div className="space-y-2 border-b border-line p-3">
          <div className="flex flex-wrap gap-1.5">
            {settings?.quickComments.map((c) => (
              <button key={c} onClick={() => submit(c)} disabled={add.isPending} className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-muted transition hover:border-primary hover:text-primary">
                {c}
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && submit()}
              placeholder="أضف ملاحظة… (Ctrl+Enter للإرسال)"
              className="min-h-10 flex-1"
              rows={1}
            />
            <Button variant="primary" loading={add.isPending} disabled={!body.trim()} onClick={() => submit()}>
              إضافة
            </Button>
          </div>
        </div>
      )}
      <ul className="max-h-64 divide-y divide-line overflow-y-auto px-4 scroll-thin">
        {!data && <li className="py-4 text-center"><Spinner /></li>}
        {data?.comments.length === 0 && <li className="py-6 text-center text-sm text-faint">لا توجد تعليقات بعد</li>}
        {data?.comments.map((c) => (
          <li key={c.id} className="py-2.5">
            <p className="text-sm whitespace-pre-wrap">{c.body}</p>
            <p className="mt-0.5 text-xs text-faint">{c.authorName ?? '—'} · <span title={fmtDateTime(c.createdAt)}>{timeAgo(c.createdAt)}</span></p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function OrderActivity({ orderId }: { orderId: string }) {
  const { data } = useTimeline(orderId);
  const { data: users } = useUsers();
  const userName = (id: unknown) => users?.find((u) => u.id === id)?.name ?? `#${String(id)}`;
  return (
    <Card>
      <CardHeader title="سجل النشاط" icon={<RotateCcw className="size-4 text-muted" />} />
      <ul className="max-h-72 divide-y divide-line overflow-y-auto px-4 scroll-thin">
        {!data && <li className="py-4 text-center"><Spinner /></li>}
        {data?.events.map((e) => <EventLine key={e.id} e={e} userName={userName} />)}
      </ul>
    </Card>
  );
}
