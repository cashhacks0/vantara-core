import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, AlertTriangle, CheckCircle2, Cpu, Database, Gauge, HardDrive, Library,
  Play, Power, RefreshCw, ShieldCheck, Terminal, Trash2, Zap,
} from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import type { InstalledModel, RuntimeStatus } from '../lib/types';
import { useLocalModels, useRuntimes } from '../lib/queries';
import { Badge, Button, EmptyState, Modal, PageHeader, Panel, Progress, Skeleton, Spinner, Stat, cn } from '../components/ui';
import { bytes, relativeTime } from '../lib/format';
import { toast } from '../lib/store';
import { ScrollPage } from '../components/Layout';

export function LocalModelsPage() {
  const queryClient = useQueryClient();
  const { data: runtimes, isLoading } = useRuntimes();
  const { data: local } = useLocalModels();
  const { data: installed } = useQuery({ queryKey: ['installed-models'], queryFn: () => api<{ models: InstalledModel[] }>('/models/installed'), select: (data) => data.models });
  const [actionId, setActionId] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['runtimes'] });
    void queryClient.invalidateQueries({ queryKey: ['local-models'] });
    void queryClient.invalidateQueries({ queryKey: ['installed-models'] });
  };

  async function testRuntime(runtimeId: string) {
    setActionId(runtimeId);
    try {
      const status = await api<RuntimeStatus>(`/runtimes/${runtimeId}/test`, { method: 'POST' });
      toast[status.available ? 'success' : 'error'](status.available ? `${status.label} is available` : `${status.label} is unavailable`, status.error || status.detail);
      refresh();
    } catch (error) { toast.error('Runtime test failed', errorMessage(error)); }
    finally { setActionId(null); }
  }

  async function loadModel(modelId: string) {
    setActionId(modelId);
    try {
      const result = await api<{ loaded: { name: string } }>('/runtimes/llama/load', { method: 'POST', body: JSON.stringify({ model: modelId }) });
      toast.success('Model loaded', result.loaded.name);
      refresh();
    } catch (error) { toast.error('Could not load model', errorMessage(error)); }
    finally { setActionId(null); }
  }

  async function stopServer() {
    setActionId('stop');
    try { await api('/runtimes/llama/stop', { method: 'POST' }); toast.success('llama.cpp server stopped'); refresh(); }
    catch (error) { toast.error('Could not stop server', errorMessage(error)); }
    finally { setActionId(null); }
  }

  async function removeModel(model: InstalledModel) {
    if (!window.confirm(`Delete ${model.display_name} from disk? This cannot be undone.`)) return;
    setActionId(model.id);
    try {
      await api(`/models/installed/${model.id}`, { method: 'DELETE' });
      toast.success('Model deleted'); refresh();
    } catch (error) { toast.error('Delete failed', errorMessage(error)); }
    finally { setActionId(null); }
  }

  async function runDiagnostics() {
    setDiagnosticsOpen(true);
    setDiagnostics(null);
    try { setDiagnostics(await api<Record<string, unknown>>('/system/diagnostics')); }
    catch (error) { setDiagnostics({ error: errorMessage(error) }); }
  }

  const ready = runtimes?.filter((runtime) => runtime.available) ?? [];
  const hardware = local?.hardware;

  return (
    <ScrollPage>
      <PageHeader
        eyebrow="Local AI engine"
        title="Local Models"
        description="Runtime discovery, hardware fit, and model files. VANTARA only reports a runtime as available when it actually responds."
        actions={<><Button onClick={() => void runDiagnostics()}><Terminal size={14} /> Diagnostics</Button><Button onClick={refresh}><RefreshCw size={14} /> Refresh</Button><Link to="/models"><Button variant="primary"><Library size={14} /> Install model</Button></Link></>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Runtimes ready" value={`${ready.length}/${runtimes?.length ?? 0}`} detail={ready.map((runtime) => runtime.id).join(', ') || 'None detected'} icon={<Activity size={14} />} tone="success" />
        <Stat label="Local models" value={local?.models.length ?? 0} detail="Discovered across runtimes" icon={<Cpu size={14} />} tone="accent" />
        <Stat label="Free RAM" value={hardware ? bytes(hardware.memory.available_bytes) : '—'} detail={hardware ? `of ${bytes(hardware.memory.total_bytes)}` : 'Detecting'} icon={<Gauge size={14} />} />
        <Stat label="Disk free" value={hardware ? bytes(hardware.disk.free_bytes) : '—'} detail={hardware ? `${bytes(hardware.disk.total_bytes)} total` : 'Detecting'} icon={<HardDrive size={14} />} tone="blue" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center justify-between"><h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">Inference runtimes</h2><span className="text-[10px] text-faint">Auto-detected</span></div>
          {isLoading ? <Skeleton className="h-40" /> : (runtimes ?? []).map((runtime) => (
            <Panel key={runtime.id} className="p-4">
              <div className="flex items-start gap-3">
                <span className={cn('rounded-lg border p-2', runtime.available ? 'border-success/25 bg-success/10 text-success' : 'border-line bg-raised text-faint')}>{runtime.available ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><p className="text-[13px] font-medium text-ink-50">{runtime.label}</p><Badge tone={runtime.available ? 'success' : 'neutral'} dot>{runtime.available ? 'ready' : runtime.configured ? 'unreachable' : 'not configured'}</Badge>{runtime.version && <span className="text-[10px] text-faint">{runtime.version}</span>}{!runtime.local && <Badge tone="warn">remote</Badge>}</div>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">{runtime.detail}</p>
                  {runtime.error && <p className="mt-1 rounded-md bg-danger/5 px-2 py-1 text-[10px] text-danger">{runtime.error}</p>}
                  {runtime.hint && <p className="mt-1 text-[10px] text-warn">{runtime.hint}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-1">{runtime.capabilities.map((capability) => <span key={capability} className="chip">{capability}</span>)}<span className="chip">{runtime.models.length} models</span></div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {runtime.id !== 'remote' && <Button size="sm" onClick={() => void testRuntime(runtime.id)} loading={actionId === runtime.id}><RefreshCw size={11} /> Test</Button>}
                    {runtime.id === 'llama.cpp' && runtime.available && <Button size="sm" variant="ghost" onClick={() => void stopServer()} loading={actionId === 'stop'}><Power size={11} /> Stop server</Button>}
                  </div>
                </div>
              </div>
            </Panel>
          ))}
          <div className="rounded-xl border border-lineSoft bg-panel/40 p-4 text-[10.5px] leading-relaxed text-faint">
            <p className="flex items-center gap-1.5 font-medium text-muted"><ShieldCheck size={12} /> Local by default</p>
            <p className="mt-1">llama.cpp binds to 127.0.0.1 and is managed by VANTARA. Ollama is detected if it is already running. Transformers is optional and only activates when PyTorch and Transformers are importable.</p>
          </div>
        </div>

        <div className="space-y-4">
          <Panel className="p-4">
            <div className="flex items-center justify-between"><h2 className="text-xs font-semibold text-ink-50">Hardware report</h2><Badge tone="accent">{hardware?.inference_mode ?? '…'}</Badge></div>
            {!hardware ? <Skeleton className="mt-3 h-24" /> : (
              <div className="mt-3 space-y-2.5 text-[11px] text-muted">
                <div className="flex items-center justify-between gap-2"><span>CPU</span><span className="max-w-[60%] truncate text-right text-ink-50" title={hardware.cpu.model}>{hardware.cpu.model} · {hardware.cpu.cores} cores</span></div>
                <div className="flex items-center justify-between"><span>Memory</span><span className="text-ink-50">{bytes(hardware.memory.available_bytes)} free / {bytes(hardware.memory.total_bytes)}</span></div>
                <Progress value={((hardware.memory.total_bytes - hardware.memory.available_bytes) / Math.max(1, hardware.memory.total_bytes)) * 100} />
                <div className="flex items-center justify-between"><span>GPU</span><span className="max-w-[60%] truncate text-right text-ink-50">{hardware.gpus[0]?.name ?? 'None detected'}</span></div>
                <div className="flex items-center justify-between"><span>Acceleration</span><span className="text-ink-50">{Object.entries(hardware.accelerators).filter(([, value]) => value).map(([key]) => key.toUpperCase()).join(', ') || 'CPU'}</span></div>
                <div className="flex items-center justify-between"><span>Disk</span><span className="text-ink-50">{bytes(hardware.disk.free_bytes)} free</span></div>
                <div className="flex items-center justify-between"><span>Platform</span><span className="text-ink-50">{hardware.os.system} · {hardware.os.machine}</span></div>
              </div>
            )}
            <p className="mt-3 text-[9.5px] leading-relaxed text-faint">Memory-fit guidance is a heuristic, not a benchmark. Context size, batch size, and driver overhead also affect whether a model fits.</p>
          </Panel>

          <Panel className="p-4">
            <div className="flex items-center justify-between"><h2 className="text-xs font-semibold text-ink-50">Ready to run</h2><Badge tone="neutral">{local?.models.filter((model) => model.runtime_available).length ?? 0}</Badge></div>
            <div className="mt-3 space-y-2">
              {!local?.models.length && <p className="text-[11px] leading-relaxed text-faint">No models discovered. Install a GGUF model from the Model Library, or start Ollama.</p>}
              {(local?.models ?? []).map((model) => (
                <div key={`${model.qualified_id}`} className="rounded-lg border border-lineSoft bg-ink-950/40 p-2.5">
                  <div className="flex items-start justify-between gap-2"><p className="min-w-0 truncate text-[11px] font-medium text-ink-50" title={model.name}>{model.name}</p>{model.quantization && <Badge tone="accent">{model.quantization}</Badge>}</div>
                  <p className="mt-0.5 truncate text-[9.5px] text-faint">{model.runtime} · {bytes(model.size_bytes)}</p>
                  {model.recommendation && <p className={cn('mt-1 text-[9.5px] leading-relaxed', model.recommendation.fits === false ? 'text-warn' : 'text-faint')}>{model.recommendation.reason}</p>}
                  <div className="mt-1.5 flex gap-1">
                    {model.runtime === 'llama.cpp' && <Button size="sm" variant="ghost" onClick={() => void loadModel(model.id)} loading={actionId === model.id}><Play size={10} /> Warm up</Button>}
                    <Link to={`/chat`}><Button size="sm" variant="ghost">Chat <Zap size={10} /></Button></Link>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between"><h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">Installed model files</h2><span className="text-[10px] text-faint">{installed?.length ?? 0} records</span></div>
        {!installed?.length ? (
          <EmptyState icon={<Database size={19} />} title="No installed models tracked" description="VANTARA records downloads here. You can also place GGUF files directly in data/models/gguf." action={<Link to="/models"><Button variant="primary"><Library size={13} /> Browse model library</Button></Link>} />
        ) : (
          <div className="overflow-hidden rounded-xl border border-line">
            {installed.map((model) => (
              <div key={model.id} className="flex flex-wrap items-center gap-3 border-b border-lineSoft bg-surface/60 px-4 py-3 last:border-b-0">
                <span className="rounded-md border border-line bg-raised p-2 text-accent-soft"><Database size={13} /></span>
                <div className="min-w-0 flex-1"><p className="truncate text-[12px] font-medium text-ink-50">{model.display_name}</p><p className="truncate text-[10px] text-faint">{model.repo_id ?? model.filename}</p><p className="mt-0.5 truncate font-mono text-[9px] text-faint">{model.path}</p></div>
                <div className="flex flex-wrap items-center gap-1.5"><Badge tone={model.runnable ? 'success' : 'warn'}>{model.runtime}</Badge>{model.quantization && <span className="chip">{model.quantization}</span>}<span className="text-[10px] text-faint">{bytes(model.size_bytes)}</span><span className="hidden text-[10px] text-faint sm:inline">{relativeTime(model.created_at)}</span></div>
                <div className="flex items-center gap-1"><Link to="/chat"><Button size="sm" variant="ghost" disabled={!model.runnable}>Chat</Button></Link><button onClick={() => void removeModel(model)} disabled={actionId === model.id} className="rounded p-2 text-faint hover:bg-raised hover:text-danger" title="Delete file">{actionId === model.id ? <Spinner className="h-3 w-3" /> : <Trash2 size={13} />}</button></div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal open={diagnosticsOpen} onClose={() => setDiagnosticsOpen(false)} size="lg" title="Runtime diagnostics" description="Live checks and server log tail." footer={<Button onClick={() => setDiagnosticsOpen(false)}>Close</Button>}>
        {!diagnostics ? <div className="flex items-center gap-2 py-8 text-xs text-muted"><Spinner /> Collecting diagnostics…</div> : <pre className="max-h-[55vh] overflow-auto rounded-lg border border-line bg-ink-950 p-3 text-[10px] leading-relaxed text-muted">{JSON.stringify(diagnostics, null, 2)}</pre>}
      </Modal>
    </ScrollPage>
  );
}
