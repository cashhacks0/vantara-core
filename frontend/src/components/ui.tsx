import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, useEffect } from 'react';
import { AlertTriangle, Check, Copy, Loader2, X } from 'lucide-react';
import clsx from 'clsx';

export const cn = clsx;

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';

export function Button({ variant = 'secondary', size = 'md', loading, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }) {
  const variants: Record<ButtonVariant, string> = {
    primary: 'btn-primary', secondary: 'btn-secondary', ghost: 'btn-ghost', danger: 'btn-danger',
    subtle: 'btn bg-accent/10 px-3 py-1.5 text-accent-soft hover:bg-accent/20',
  };
  const sizes = { sm: 'text-xs px-2.5 py-1.5', md: '', lg: 'text-sm px-4 py-2.5' };
  return (
    <button className={cn(variants[variant], sizes[size], className)} disabled={loading || props.disabled} {...props}>
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
}

export type BadgeTone = 'neutral' | 'success' | 'warn' | 'danger' | 'accent' | 'blue';

export function Badge({ tone = 'neutral', children, className, dot }: { tone?: BadgeTone; children: ReactNode; className?: string; dot?: boolean }) {
  const tones: Record<BadgeTone, string> = {
    neutral: 'border-line bg-raised/70 text-muted',
    success: 'border-success/25 bg-success/10 text-success',
    warn: 'border-warn/25 bg-warn/10 text-warn',
    danger: 'border-danger/25 bg-danger/10 text-danger',
    accent: 'border-accent/30 bg-accent/10 text-accent-soft',
    blue: 'border-electric/25 bg-electric/10 text-electric',
  };
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium', tones[tone], className)}>
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', tone === 'success' ? 'bg-success' : tone === 'danger' ? 'bg-danger' : tone === 'warn' ? 'bg-warn' : tone === 'accent' ? 'bg-accent' : tone === 'blue' ? 'bg-electric' : 'bg-muted')} />}
      {children}
    </span>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('panel', className)}>{children}</div>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('animate-spin text-muted', className)} size={18} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-raised/80', className)} />;
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-panel/40 px-6 py-12 text-center', className)}>
      {icon && <div className="mb-3 rounded-xl border border-line bg-raised p-2.5 text-muted">{icon}</div>}
      <h3 className="text-sm font-semibold text-ink-50">{title}</h3>
      {description && <p className="mt-1.5 max-w-md text-xs leading-relaxed text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: string; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-soft/80">{eyebrow}</p>}
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink-50">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, detail, icon, tone }: { label: string; value: ReactNode; detail?: ReactNode; icon?: ReactNode; tone?: 'accent' | 'blue' | 'success' }) {
  return (
    <div className="panel p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">{label}</p>
        {icon && <span className={cn('rounded-md border border-line bg-raised p-1.5', tone === 'accent' ? 'text-accent-soft' : tone === 'blue' ? 'text-electric' : tone === 'success' ? 'text-success' : 'text-muted')}>{icon}</span>}
      </div>
      <p className="mt-2 text-[22px] font-semibold tracking-tight text-ink-50">{value}</p>
      {detail && <div className="mt-1 text-[11px] text-muted">{detail}</div>}
    </div>
  );
}

export function Field({ label, help, error, children, className, htmlFor }: { label?: string; help?: string; error?: string; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && <label htmlFor={htmlFor} className="label block">{label}</label>}
      {children}
      {help && !error && <p className="text-[11px] leading-relaxed text-faint">{help}</p>}
      {error && <p className="flex items-center gap-1 text-[11px] text-danger"><AlertTriangle size={11} /> {error}</p>}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn('field', className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn('field min-h-[90px] resize-y leading-6', className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return <select ref={ref} className={cn('field appearance-none bg-ink-900 pr-8', className)} {...props}>{children}</select>;
});

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div>
        <p className="text-[13px] font-medium text-ink-50">{label}</p>
        {description && <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{description}</p>}
      </div>
      <button
        type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn('relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-40', checked ? 'border-accent/50 bg-accent/80' : 'border-line bg-raised')}
      >
        <span className={cn('absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
      </button>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: Array<{ value: T; label: string; count?: number }>; value: T; onChange: (value: T) => void; className?: string }) {
  return (
    <div className={cn('inline-flex items-center gap-1 rounded-lg border border-line bg-panel p-1', className)} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value} role="tab" aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
          className={cn('rounded-md px-3 py-1.5 text-xs font-medium transition-colors', value === tab.value ? 'bg-raised text-ink-50 shadow-sm' : 'text-muted hover:text-ink-50')}
        >
          {tab.label}{tab.count !== undefined && <span className="ml-1.5 text-[10px] text-faint">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;
  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center" onMouseDown={onClose} role="presentation">
      <div className={cn('my-8 w-full rounded-xl border border-line bg-surface shadow-2xl animate-fadeUp', widths[size])} onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-start justify-between gap-4 border-b border-lineSoft px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-ink-50">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-raised hover:text-ink-50" aria-label="Close"><X size={16} /></button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-lineSoft px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  );
}

export function Progress({ value, className, indeterminate }: { value?: number | null; className?: string; indeterminate?: boolean }) {
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-raised', className)} role="progressbar" aria-valuenow={value ?? undefined} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full bg-accent transition-[width] duration-300', indeterminate && 'w-1/3 animate-pulseSoft')} style={indeterminate ? undefined : { width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} />
    </div>
  );
}

export function CopyButton({ text, label = 'Copy', className }: { text: string; label?: string; className?: string }) {
  return (
    <button
      className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted transition-colors hover:bg-raised hover:text-ink-50', className)}
      onClick={async () => { try { await navigator.clipboard.writeText(text); } catch { /* clipboard unavailable */ } }}
      title={label}
    >
      <Copy size={11} /> {label}
    </button>
  );
}

export function InlineCheck({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center gap-1 text-[11px] text-success"><Check size={11} />{children}</span>;
}
