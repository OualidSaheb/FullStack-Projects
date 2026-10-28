import { useState } from 'react';
import { PackageCheck, Send, Truck } from 'lucide-react';
import type { OrderDetail, OrderListItem, Resend } from '@touraya/shared';
import { cn } from '@/lib/cn';
import { useResend } from '@/lib/queries';
import { Button, Field, Input, Modal } from '@/components/ui';

const MODES: { mode: Resend['mode']; icon: typeof Send; title: string; text: string }[] = [
  { mode: 'delivered', icon: PackageCheck, title: 'تسلّمتها الزبونة', text: 'أُعيد إرسالها وتسلّمتها: تصبح «سُلّمت» وتُحسب في المسلّمة والمداخيل.' },
  { mode: 'reship', icon: Send, title: 'سأرسلها من جديد من المنصة', text: 'ترجع «مؤكدة» (يمكن تغيير المقاس أو اللون)، ثم ترسلها لشركة التوصيل كطرد جديد.' },
  { mode: 'sent', icon: Truck, title: 'أرسلتها يدوياً', text: 'أُرسلت من جديد خارج المنصة: تصبح «أُرسلت». ضع رقم التتبع الجديد لتتبع حالتها وحدها.' },
];

/**
 * A returned order sent again to the same customer (she was out, wanted
 * another size…): it leaves the returns and counts where it really ended.
 */
export function ResendModal({ order, onClose }: { order: Pick<OrderDetail | OrderListItem, 'id' | 'reference' | 'customerName'>; onClose: () => void }) {
  const resend = useResend(order.id);
  const [mode, setMode] = useState<Resend['mode']>('delivered');
  const [tracking, setTracking] = useState('');
  const [note, setNote] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title={`إعادة الإرسال ${order.reference}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button
            variant="primary"
            loading={resend.isPending}
            onClick={() => resend.mutate({ mode, tracking: mode === 'sent' ? tracking.trim() || undefined : undefined, note: note.trim() || undefined }, { onSuccess: onClose })}
          >
            تأكيد
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-muted">الطلبية رجعت من شركة التوصيل، ثم أُعيد إرسالها لنفس الزبون ({order.customerName}):</p>
        {MODES.map(({ mode: m, icon: Icon, title, text }) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn('flex w-full items-start gap-3 rounded-lg border p-3 text-start transition', mode === m ? 'border-primary bg-primary/5' : 'border-line hover:border-primary/50')}
          >
            <Icon className={cn('mt-0.5 size-5 shrink-0', mode === m ? 'text-primary' : 'text-muted')} />
            <span>
              <b className="block">{title}</b>
              <span className="text-xs text-muted">{text}</span>
            </span>
          </button>
        ))}
        {mode === 'sent' && (
          <Field label="رقم التتبع الجديد (اختياري)">{(id) => <Input id={id} dir="ltr" value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="yal-XXXXXX" />}</Field>
        )}
        <Field label="ملاحظة (اختياري)">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً: لم تكن في البيت، غيّرت المقاس إلى 40" />}</Field>
        <p className="text-xs text-faint">الطرد القديم الذي رجع لا يغيّر حالة الطلبية بعد الآن، والمخزون يتبع ما حدث فعلاً.</p>
      </div>
    </Modal>
  );
}
