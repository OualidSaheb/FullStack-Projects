import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Check, Pencil } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Click-to-edit text: shows the value, becomes an input on tap, saves on
 * Enter / leaving the field, Esc cancels. No separate "edit" screen.
 */
export function InlineText({
  value,
  onSave,
  placeholder = '—',
  disabled,
  className,
  display,
  ...input
}: { value: string; onSave: (v: string) => void; placeholder?: string; disabled?: boolean; className?: string; display?: ReactNode } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (editing) ref.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() !== value.trim()) onSave(draft.trim());
  };

  if (disabled) return <span className={className}>{display ?? (value || <span className="text-faint">{placeholder}</span>)}</span>;
  if (editing)
    return (
      <span className="inline-flex w-full items-center gap-1">
        <input
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setDraft(value);
              setEditing(false);
            }
          }}
          className="h-8 w-full min-w-0 rounded-md border border-primary bg-surface px-2 text-sm outline-none ring-3 ring-primary/15"
          {...input}
        />
        <Check className="size-4 shrink-0 text-primary" />
      </span>
    );
  return (
    <button type="button" onClick={() => setEditing(true)} className={cn('group inline-flex max-w-full items-center gap-1.5 rounded-md text-start hover:text-primary', className)} title="اضغط للتعديل">
      <span className="truncate border-b border-dashed border-line group-hover:border-primary">{display ?? (value || <span className="text-faint">{placeholder}</span>)}</span>
      <Pencil className="size-3 shrink-0 text-faint opacity-60 group-hover:text-primary group-hover:opacity-100" />
    </button>
  );
}

/** Native select styled as a chip: one tap opens the phone's picker, the choice is saved at once. */
export function InlineSelect<T extends string | number>({
  value,
  options,
  onSave,
  disabled,
  className,
  placeholder,
  tone,
  ...rest
}: {
  value: T | null;
  options: { value: T; label: string; disabled?: boolean }[];
  onSave: (v: T | null) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  tone?: 'warn';
  'aria-label'?: string;
}) {
  return (
    <select
      disabled={disabled}
      value={value ?? ''}
      onChange={(e) => {
        const raw = e.target.value;
        const match = options.find((o) => String(o.value) === raw);
        onSave(match ? match.value : null);
      }}
      className={cn(
        'h-8 max-w-full cursor-pointer rounded-lg border bg-surface ps-2.5 pe-7 text-sm font-medium transition hover:border-primary focus:border-primary focus:outline-none disabled:cursor-default disabled:opacity-70',
        tone === 'warn' ? 'border-warn/60 text-warn' : 'border-line',
        className,
      )}
      {...rest}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
