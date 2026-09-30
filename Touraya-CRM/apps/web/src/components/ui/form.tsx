import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const control =
  'w-full rounded-lg border border-line bg-surface px-3 text-sm text-fg placeholder:text-faint transition focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/15 disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(control, 'h-9', className)} {...props} />
));

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(control, 'min-h-20 py-2', className)} {...props} />
));

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn(control, 'h-9 pe-8', className)} {...props}>
    {children}
  </select>
));

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      {children(id)}
      {error ? <p className="text-xs text-danger">{error}</p> : hint ? <p className="text-xs text-faint">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ className, indeterminate, ...props }: InputHTMLAttributes<HTMLInputElement> & { indeterminate?: boolean }) {
  return (
    <input
      type="checkbox"
      ref={(el) => {
        if (el) el.indeterminate = Boolean(indeterminate);
      }}
      className={cn('size-4 cursor-pointer rounded border-line accent-[var(--primary)]', className)}
      {...props}
    />
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn('relative h-5 w-9 rounded-full transition', checked ? 'bg-primary' : 'bg-line')}
      >
        <span className={cn('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all', checked ? 'start-4.5' : 'start-0.5')} />
      </button>
      {label}
    </label>
  );
}

/** Editable list of short strings (aliases, sizes, colors, quick comments). */
export function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  return (
    <div className={cn(control, 'flex min-h-9 flex-wrap items-center gap-1.5 py-1.5')}>
      {value.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 rounded-md bg-subtle px-2 py-0.5 text-xs">
          {tag}
          <button type="button" className="text-faint hover:text-danger" onClick={() => onChange(value.filter((t) => t !== tag))} aria-label="حذف">
            ×
          </button>
        </span>
      ))}
      <input
        className="min-w-24 flex-1 bg-transparent text-sm outline-none"
        placeholder={placeholder}
        onKeyDown={(e) => {
          const input = e.currentTarget;
          if ((e.key === 'Enter' || e.key === ',') && input.value.trim()) {
            e.preventDefault();
            const tag = input.value.trim();
            if (!value.includes(tag)) onChange([...value, tag]);
            input.value = '';
          }
        }}
      />
    </div>
  );
}
