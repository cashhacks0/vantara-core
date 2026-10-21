import { useMemo } from 'react';
import { Cpu, Link2, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Select, Badge, cn } from './ui';
import { useRuntimes } from '../lib/queries';
import { bytes } from '../lib/format';
import type { RuntimeModel, RuntimeStatus } from '../lib/types';

export function ModelPicker({ value, onChange, allowAuto = true, allowNone = false, noneLabel = 'No model (lexical only)', className, compact, includeRemote = false }: { value: string; onChange: (value: string) => void; allowAuto?: boolean; allowNone?: boolean; noneLabel?: string; className?: string; compact?: boolean; includeRemote?: boolean }) {
  const { data: runtimes, isLoading } = useRuntimes();
  const groups = useMemo(() => {
    const result: Array<{ runtime: RuntimeStatus; models: RuntimeModel[] }> = [];
    for (const runtime of runtimes ?? []) {
      if (!runtime.available || (!runtime.local && !includeRemote)) continue;
      if (runtime.models.length) result.push({ runtime, models: runtime.models });
    }
    return result;
  }, [runtimes, includeRemote]);
  const hasModels = groups.length > 0;
  if (isLoading) return <div className={cn('h-9 animate-pulse rounded-lg border border-line bg-raised', className)} />;
  if (!hasModels) {
    return (
      <Link to="/local-models" className={cn('flex items-center gap-2 rounded-lg border border-warn/25 bg-warn/5 px-3 py-2 text-xs text-warn hover:bg-warn/10', className)}>
        <Cpu size={13} /> No local model installed — open Local Models
      </Link>
    );
  }
  return (
    <Select value={value} onChange={(event) => onChange(event.target.value)} className={cn(compact && 'h-9 py-0 text-xs', className)} aria-label="Model">
      {allowNone && <option value="">{noneLabel}</option>}
      {allowAuto && <option value="auto">Auto · first available local model</option>}
      {groups.map(({ runtime, models }) => (
        <optgroup key={runtime.id} label={`${runtime.label}${runtime.local ? '' : ' (remote)'}`}>
          {models.map((model) => (
            <option key={model.qualified_id} value={model.qualified_id}>
              {model.name}{model.quantization ? ` · ${model.quantization}` : ''}{model.size_bytes ? ` · ${bytes(model.size_bytes)}` : ''}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}

export function ModelBadge({ modelId, local = true }: { modelId?: string | null; local?: boolean }) {
  if (!modelId) return null;
  return (
    <Badge tone={local ? 'accent' : 'warn'}>
      {local ? <Cpu size={10} /> : <Link2 size={10} />}
      {modelId.split('::').pop()?.replace(/\.gguf$/i, '') ?? modelId}
    </Badge>
  );
}

export function AutoLabel() {
  return <span className="inline-flex items-center gap-1 text-accent-soft"><Sparkles size={11} /> auto</span>;
}
