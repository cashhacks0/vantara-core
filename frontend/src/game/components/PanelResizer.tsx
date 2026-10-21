/** Thin drag handle used to resize the editor side panels. */
import { useRef } from 'react';

export function PanelResizer({ onDelta, className }: { onDelta: (delta: number) => void; className?: string }) {
  const start = useRef<number | null>(null);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={(event) => { start.current = event.clientX; (event.target as HTMLElement).setPointerCapture(event.pointerId); }}
      onPointerMove={(event) => { if (start.current === null) return; onDelta(event.clientX - start.current); start.current = event.clientX; }}
      onPointerUp={() => { start.current = null; }}
      className={`w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-accent/40 ${className ?? ''}`}
    />
  );
}
