import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { IconButton } from './button';

function useEscape(onClose: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  useEscape(onClose);
  if (!open) return null;
  const width = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-6xl' }[size];
  return createPortal(
    // Bottom sheet on phones, centered dialog on larger screens.
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 backdrop-blur-[2px] animate-fade-in sm:items-center sm:p-4" onMouseDown={onClose}>
      <div role="dialog" aria-modal className={cn('w-full rounded-t-2xl border border-line bg-surface shadow-2xl sm:rounded-2xl', width)} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-base font-semibold">{title}</h2>
          <IconButton label="إغلاق" icon={<X className="size-4" />} onClick={onClose} />
        </div>
        <div className="max-h-[70dvh] overflow-y-auto p-5 scroll-thin">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Side panel opening from the left edge (RTL end side). */
export function Drawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEscape(onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/30 animate-fade-in" onMouseDown={onClose}>
      <aside
        className="flex h-full w-full max-w-3xl flex-col border-e border-line bg-bg shadow-2xl animate-slide-in"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </aside>
    </div>,
    document.body,
  );
}
