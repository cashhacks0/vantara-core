import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { useToastStore } from '../lib/store';

export function Toaster() {
  const { toasts, dismiss } = useToastStore();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = toast.tone === 'success' ? CheckCircle2 : toast.tone === 'error' ? AlertTriangle : Info;
        return (
          <div key={toast.id} className="pointer-events-auto flex items-start gap-3 rounded-lg border border-line bg-surface/95 px-3.5 py-3 shadow-panel backdrop-blur animate-fadeUp">
            <Icon size={16} className={toast.tone === 'success' ? 'mt-0.5 text-success' : toast.tone === 'error' ? 'mt-0.5 text-danger' : 'mt-0.5 text-electric'} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-ink-50">{toast.title}</p>
              {toast.description && <p className="mt-0.5 break-words text-[11px] leading-relaxed text-muted">{toast.description}</p>}
            </div>
            <button onClick={() => dismiss(toast.id)} className="rounded p-0.5 text-faint hover:text-ink-50" aria-label="Dismiss"><X size={12} /></button>
          </div>
        );
      })}
    </div>
  );
}
