import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

const variants = {
  primary: 'bg-primary text-white hover:brightness-110 dark:text-ink shadow-sm',
  secondary: 'bg-surface text-fg border border-line hover:bg-subtle',
  ghost: 'text-muted hover:bg-subtle hover:text-fg',
  danger: 'bg-danger text-white hover:brightness-110 dark:text-ink',
  success: 'bg-ok text-white hover:brightness-110 dark:text-ink',
} as const;

const sizes = { sm: 'h-8 px-2.5 text-xs gap-1.5', md: 'h-9 px-3.5 text-sm gap-2', lg: 'h-11 px-5 text-sm gap-2' } as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg font-medium whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  ),
);

export function IconButton({ label, className, ...props }: ButtonProps & { label: string }) {
  return <Button variant="ghost" size="sm" aria-label={label} title={label} className={cn('w-8 px-0', className)} {...props} />;
}
