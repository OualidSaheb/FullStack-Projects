import { MessageCircle, Phone } from 'lucide-react';
import { intlPhone } from '@/lib/format';
import { cn } from '@/lib/cn';

/** One tap to call: tel: link, no copy/paste. */
export function CallButton({ phone, label, className, compact }: { phone: string | null; label?: string; className?: string; compact?: boolean }) {
  if (!phone) return <span className="text-faint">—</span>;
  return (
    <a
      href={`tel:${phone}`}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg font-medium transition',
        compact ? 'text-fg hover:text-primary' : 'h-9 bg-ok px-3 text-sm text-white hover:brightness-110 dark:text-ink',
        className,
      )}
      title={`اتصال ${phone}`}
    >
      <Phone className={compact ? 'size-3.5 text-ok' : 'size-4'} />
      <span className="ltr">{label ?? phone}</span>
    </a>
  );
}

export function WhatsAppButton({ phone }: { phone: string | null }) {
  if (!phone) return null;
  return (
    <a
      href={`https://wa.me/${intlPhone(phone)}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm font-medium hover:bg-subtle"
      title="WhatsApp"
    >
      <MessageCircle className="size-4 text-[#25a244]" />
      WhatsApp
    </a>
  );
}
