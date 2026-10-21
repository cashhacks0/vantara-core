import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle2, Database, Download, ExternalLink, FolderOpen, HardDrive,
  KeyRound, Plus, RefreshCw, Save, Server, Shield, Terminal, Trash2, Wrench,
} from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import type { ProviderInfo, RuntimeStatus } from '../lib/types';
import { useRuntimes } from '../lib/queries';
import { Badge, Button, EmptyState, Field, Input, Modal, PageHeader, Panel, Skeleton, Spinner, Stat, Tabs, Textarea, Toggle, cn } from '../components/ui';
import { bytes } from '../lib/format';
import { toast } from '../lib/store';
import { ScrollPage } from '../components/Layout';
import { ModelPicker } from '../components/ModelPicker';

type Tab = 'general' | 'local' | 'privacy' | 'providers' | 'storage' | 'developer';
type Values = Record<string, unknown>;
interface StorageInfo { disk: { total_bytes: number; free_bytes: number }; models: { count: number; directory_bytes: number; tracked_bytes: number }; uploads: { count: number; directory_bytes: number }; outputs: { count: number; directory_bytes: number }; conversations: number; messages: number; workflows: number; database_bytes: number; paths: Record<string, string> }

const PROVIDER_EMPTY = { name: '', base_url: '', api_key: '', enabled: false };
const EDITABLE_KEYS = ['theme','default_model','default_assistant','assistant_name','assistant_system_prompt','send_on_enter','stream_responses','telemetry_enabled','retain_chat_history','remote_providers_enabled','llama_context','llama_threads','auto_start_llama','active_llama_model','max_concurrent_generations'];

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('general');
  const [values, setValues] = useState<Values | null>(null);
  const [saving, setSaving] = useState(false);
  const [providerOpen, setProviderOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ProviderInfo | null>(null);
  const [providerForm, setProviderForm] = useState(PROVIDER_EMPTY);
  const [savingProvider, setSavingProvider] = useState(false);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);

  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: () => api<Values>('/settings') });
  const providersQuery = useQuery({ queryKey: ['providers'], queryFn: () => api<{ providers: ProviderInfo[]; remote_allowed_by_env: boolean }>('/providers') });
  const storageQuery = useQuery({ queryKey: ['storage'], queryFn: () => api<StorageInfo>('/system/storage'), enabled: tab === 'storage' });
  const logsQuery = useQuery({ queryKey: ['logs'], queryFn: () => api<{ logs: Array<Record<string, unknown>> }>('/system/logs?limit=100'), enabled: tab === 'developer', refetchInterval: 10_000 });
  const hardwareQuery = useQuery({ queryKey: ['hardware'], queryFn: () => api<Record<string, unknown>>('/system/info') });
  const { data: runtimeData } = useRuntimes();

  useEffect(() => { if (settingsQuery.data && !values) setValues(settingsQuery.data); }, [settingsQuery.data, values]);

  const dirty = useMemo(() => Boolean(values && settingsQuery.data && JSON.stringify(values) !== JSON.stringify(settingsQuery.data)), [values, settingsQuery.data]);

  function set(key: string, value: unknown) { setValues((current) => current ? { ...current, [key]: value } : current); }

  async function save() {
    if (!values) return;
    setSaving(true);
    try {
      const editable = Object.fromEntries(Object.entries(values).filter(([key]) => EDITABLE_KEYS.includes(key)));
      const result = await api<Values>('/settings', { method: 'PUT', body: JSON.stringify({ values: editable }) });
      setValues(result);
      void queryClient.invalidateQueries({ queryKey: ['runtimes'] });
      toast.success('Settings saved');
    } catch (error) { toast.error('Could not save settings', errorMessage(error)); }
    finally { setSaving(false); }
  }

  async function deleteAllConversations() {
    if (!window.confirm('Delete every conversation and message stored locally? This cannot be undone.')) return;
    try { const result = await api<{ deleted: number }>('/conversations', { method: 'DELETE' }); toast.success(`Deleted ${result.deleted} conversation(s)`); void queryClient.invalidateQueries({ queryKey: ['conversations'] }); void queryClient.invalidateQueries({ queryKey: ['dashboard'] }); }
    catch (error) { toast.error('Delete failed', errorMessage(error)); }
  }

  function openProvider(provider?: ProviderInfo) {
    setEditingProvider(provider ?? null);
    setProviderForm(provider ? { name: provider.name, base_url: provider.base_url, api_key: '', enabled: provider.enabled } : PROVIDER_EMPTY);
    setProviderOpen(true);
  }

  async function saveProvider() {
    if (!providerForm.name.trim() || !providerForm.base_url.trim()) return;
    setSavingProvider(true);
    try {
      const body: Record<string, unknown> = { name: providerForm.name, base_url: providerForm.base_url, enabled: providerForm.enabled };
      if (providerForm.api_key) body.api_key = providerForm.api_key;
      if (editingProvider) await api(`/providers/${editingProvider.id}`, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/providers', { method: 'POST', body: JSON.stringify({ ...body, kind: 'openai-compatible' }) });
      setProviderOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
      toast.success(editingProvider ? 'Provider updated' : 'Provider added');
    } catch (error) { toast.error('Could not save provider', errorMessage(error)); }
    finally { setSavingProvider(false); }
  }

  async function toggleProvider(provider: ProviderInfo) {
    try { await api(`/providers/${provider.id}`, { method: 'PUT', body: JSON.stringify({ enabled: !provider.enabled }) }); void queryClient.invalidateQueries({ queryKey: ['providers'] }); }
    catch (error) { toast.error('Update failed', errorMessage(error)); }
  }

  async function testProvider(provider: ProviderInfo) {
    setTestingProvider(provider.id);
    try {
      const status = await api<RuntimeStatus>(`/providers/${provider.id}/test`, { method: 'POST' });
      toast[status.available ? 'success' : 'error'](`${provider.name}: ${status.available ? 'reachable' : 'unavailable'}`, status.error || status.detail);
    } catch (error) { toast.error('Provider test failed', errorMessage(error)); }
    finally { setTestingProvider(null); }
  }

  async function removeProvider(provider: ProviderInfo) {
    if (!window.confirm(`Delete provider “${provider.name}”?`)) return;
    try { await api(`/providers/${provider.id}`, { method: 'DELETE' }); void queryClient.invalidateQueries({ queryKey: ['providers'] }); toast.success('Provider deleted'); }
    catch (error) { toast.error('Delete failed', errorMessage(error)); }
  }

  async function loadDiagnostics() {
    setDiagnosticsLoading(true);
    try { setDiagnostics(await api<Record<string, unknown>>('/system/diagnostics')); }
    catch (error) { toast.error('Diagnostics failed', errorMessage(error)); }
    finally { setDiagnosticsLoading(false); }
  }

  function exportDiagnostics() {
    const blob = new Blob([JSON.stringify({ settings: values, diagnostics, storage: storageQuery.data }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'vantara-diagnostics.json'; anchor.click(); URL.revokeObjectURL(url);
  }

  if (settingsQuery.isLoading || !values) return <ScrollPage><Skeleton className="h-96" /></ScrollPage>;

  return (
    <ScrollPage>
      <PageHeader eyebrow="Control center" title="Settings" description="Configure local inference, privacy boundaries, storage, providers, and developer diagnostics. Remote access is opt-in only." actions={<Button variant="primary" onClick={() => void save()} loading={saving} disabled={!dirty}><Save size={14} /> Save changes</Button>} />
      <Tabs<Tab> value={tab} onChange={setTab} className="mb-5" tabs={[{ value: 'general', label: 'General' }, { value: 'local', label: 'Local AI' }, { value: 'privacy', label: 'Privacy' }, { value: 'providers', label: 'Providers' }, { value: 'storage', label: 'Storage' }, { value: 'developer', label: 'Developer' }]} />

      {tab === 'general' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel className="p-5"><h2 className="text-sm font-semibold text-ink-50">Assistant</h2><div className="mt-3 space-y-3"><Field label="Assistant name"><Input value={String(values.assistant_name ?? 'VANTARA')} onChange={(event) => set('assistant_name', event.target.value)} /></Field><Field label="Default assistant system prompt" help="Used for new conversations unless overridden per conversation."><Textarea rows={7} value={String(values.assistant_system_prompt ?? '')} onChange={(event) => set('assistant_system_prompt', event.target.value)} /></Field><Field label="Default model"><ModelPicker value={String(values.default_model ?? 'auto')} onChange={(value) => set('default_model', value)} /></Field></div></Panel>
          <Panel className="p-5"><h2 className="text-sm font-semibold text-ink-50">Chat behavior</h2><div className="mt-2 divide-y divide-lineSoft"><Toggle checked={Boolean(values.send_on_enter)} onChange={(value) => set('send_on_enter', value)} label="Send on Enter" description="Shift+Enter inserts a new line." /><Toggle checked={Boolean(values.stream_responses)} onChange={(value) => set('stream_responses', value)} label="Stream responses" description="Supported local runtimes stream tokens as they are generated." /></div><div className="mt-3 rounded-lg border border-lineSoft bg-ink-950/40 p-3 text-[10.5px] leading-relaxed text-muted"><p className="flex items-center gap-1.5 font-medium text-ink-50"><CheckCircle2 size={12} className="text-success" /> Current theme: graphite dark</p><p className="mt-1">The design system is dark-first. Additional themes are on the roadmap; VANTARA does not pretend a light theme is implemented.</p></div></Panel>
        </div>
      )}

      {tab === 'local' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel className="p-5"><h2 className="text-sm font-semibold text-ink-50">llama.cpp management</h2><div className="mt-3 space-y-3"><div className="grid grid-cols-2 gap-3"><Field label="Context size"><Input type="number" min={512} max={32768} step={512} value={Number(values.llama_context ?? 4096)} onChange={(event) => set('llama_context', Number(event.target.value))} /></Field><Field label="CPU threads"><Input type="number" min={1} max={64} value={Number(values.llama_threads ?? 4)} onChange={(event) => set('llama_threads', Number(event.target.value))} /></Field></div><Field label="Concurrent generations" help="Queue depth for chat requests. Keep at 1 on memory-constrained machines."><Input type="number" min={1} max={4} value={Number(values.max_concurrent_generations ?? 1)} onChange={(event) => set('max_concurrent_generations', Number(event.target.value))} /></Field><Toggle checked={Boolean(values.auto_start_llama)} onChange={(value) => set('auto_start_llama', value)} label="Auto-start managed llama.cpp" description="Load a GGUF model on the first request instead of requiring a manual warm-up." /></div>
            <div className="mt-3 rounded-lg border border-lineSoft bg-ink-950/40 p-3 text-[10.5px] text-muted"><p className="flex items-center justify-between"><span>Server binary</span><Badge tone={values.llama_server_configured ? 'success' : 'danger'}>{values.llama_server_configured ? 'configured' : 'missing'}</Badge></p><p className="mt-1 break-all font-mono text-[9.5px] text-faint">{String(values.llama_server_path ?? 'not found')}</p><p className="mt-2 flex items-center justify-between"><span>Hugging Face token</span><Badge tone={values.hf_token_configured ? 'success' : 'neutral'}>{values.hf_token_configured ? 'present' : 'not set'}</Badge></p><p className="mt-1 text-[9.5px] text-faint">Tokens are read from the server environment (HF_TOKEN) and never returned to the browser.</p></div>
          </Panel>
          <Panel className="p-5"><h2 className="text-sm font-semibold text-ink-50">Detected runtimes</h2><div className="mt-3 space-y-2">{(runtimeData ?? []).map((runtime) => <div key={runtime.id} className="flex items-start gap-2 rounded-lg border border-lineSoft bg-ink-950/40 p-2.5"><span className={cn('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', runtime.available ? 'bg-success' : 'bg-faint')} /><div className="min-w-0 flex-1"><p className="text-[11px] font-medium text-ink-50">{runtime.label}</p><p className="truncate text-[10px] text-faint">{runtime.detail}</p></div><Badge tone={runtime.available ? 'success' : 'neutral'}>{runtime.available ? 'ready' : 'offline'}</Badge></div>)}</div><Link to="/local-models"><Button className="mt-3 w-full"><Wrench size={13} /> Open Local Models</Button></Link></Panel>
        </div>
      )}

      {tab === 'privacy' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel className="p-5"><h2 className="flex items-center gap-2 text-sm font-semibold text-ink-50"><Shield size={14} className="text-success" /> Privacy boundaries</h2><div className="mt-2 divide-y divide-lineSoft"><Toggle checked={Boolean(values.retain_chat_history)} onChange={(value) => set('retain_chat_history', value)} label="Retain conversation history" description="Stored in the local SQLite database. Disable to change the default for new sessions." /><div className="flex items-start justify-between gap-4 py-3"><div><p className="text-[13px] font-medium text-ink-50">Telemetry</p><p className="mt-0.5 text-[11px] leading-relaxed text-muted">This build contains no telemetry uploader. The setting remains false and cannot silently enable network reporting.</p></div><Badge tone="success">disabled</Badge></div><Toggle checked={Boolean(values.remote_providers_enabled)} onChange={(value) => set('remote_providers_enabled', value)} label="Allow remote providers" description="When enabled, you can explicitly select a configured remote model. VANTARA never falls back to remote inference automatically." /></div></Panel>
          <Panel className="p-5"><h2 className="text-sm font-semibold text-ink-50">Data controls</h2><div className="mt-3 space-y-2"><div className="flex items-center justify-between gap-3 rounded-lg border border-lineSoft bg-ink-950/40 p-3"><div><p className="text-[11px] font-medium text-ink-50">Delete all conversations</p><p className="text-[10px] text-muted">Removes messages from local storage.</p></div><Button size="sm" variant="danger" onClick={() => void deleteAllConversations()}><Trash2 size={11} /> Delete</Button></div><div className="rounded-lg border border-lineSoft bg-ink-950/40 p-3 text-[10.5px] leading-relaxed text-muted"><p className="font-medium text-ink-50">Uploads and outputs</p><p className="mt-1">Files live under <span className="font-mono text-faint">{String(storageQuery.data?.paths?.outputs ?? 'data/uploads and data/outputs')}</span>. Remove individual outputs in Runs & History or Local Models.</p></div><div className="rounded-lg border border-lineSoft bg-ink-950/40 p-3 text-[10.5px] leading-relaxed text-muted"><p className="font-medium text-ink-50">Network permissions</p><p className="mt-1">Workflow HTTP nodes are {values.workflow_http_allowed ? 'enabled' : 'disabled'} at the server level. Local inference services bind to loopback only.</p></div></div></Panel>
        </div>
      )}

      {tab === 'providers' && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-warn/25 bg-warn/5 p-4"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" /><div><p className="text-[12px] font-medium text-warn">Remote providers require explicit consent</p><p className="mt-1 text-[11px] leading-relaxed text-muted">Enabling a provider does not change defaults. You must select a remote model in chat or a workflow. API keys are encrypted at rest with a local key file (0600) and never logged.</p></div></div>
          <div className="flex items-center justify-between"><h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">OpenAI-compatible endpoints ({providersQuery.data?.providers.length ?? 0})</h2><Button size="sm" onClick={() => openProvider()}><Plus size={12} /> Add provider</Button></div>
          {providersQuery.isLoading ? <Skeleton className="h-40" /> : !providersQuery.data?.providers.length ? <EmptyState icon={<Server size={19} />} title="No remote providers configured" description="Configure an OpenAI-compatible endpoint such as a self-hosted gateway or local server. Local inference remains the default." action={<Button onClick={() => openProvider()}>Add provider</Button>} /> : <div className="space-y-2">{providersQuery.data.providers.map((provider) => <Panel key={provider.id} className="p-4"><div className="flex flex-wrap items-start gap-3"><span className="rounded-lg border border-line bg-raised p-2 text-muted"><Server size={14} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5"><p className="text-[12.5px] font-medium text-ink-50">{provider.name}</p><Badge tone={provider.enabled ? 'success' : 'neutral'}>{provider.enabled ? 'enabled' : 'disabled'}</Badge>{provider.has_key ? <Badge tone="accent"><KeyRound size={9} /> key stored</Badge> : <Badge tone="warn">no key</Badge>}</div><p className="mt-0.5 truncate font-mono text-[10px] text-faint">{provider.base_url}</p></div><div className="flex flex-wrap gap-1"><Button size="sm" onClick={() => void testProvider(provider)} loading={testingProvider === provider.id}>Test</Button><Button size="sm" variant="ghost" onClick={() => void toggleProvider(provider)}>{provider.enabled ? 'Disable' : 'Enable'}</Button><Button size="sm" variant="ghost" onClick={() => openProvider(provider)}>Edit</Button><button onClick={() => void removeProvider(provider)} className="rounded p-1.5 text-faint hover:text-danger"><Trash2 size={12} /></button></div></div></Panel>)}</div>}
        </div>
      )}

      {tab === 'storage' && (
        <div className="space-y-4">{storageQuery.isLoading ? <Skeleton className="h-64" /> : storageQuery.data ? <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="Disk free" value={bytes(storageQuery.data.disk.free_bytes)} detail={bytes(storageQuery.data.disk.total_bytes) + ' total'} icon={<HardDrive size={14} />} /><Stat label="Models" value={bytes(storageQuery.data.models.directory_bytes)} detail={`${storageQuery.data.models.count} installed`} icon={<Database size={14} />} tone="accent" /><Stat label="Uploads" value={bytes(storageQuery.data.uploads.directory_bytes)} detail={`${storageQuery.data.uploads.count} files`} icon={<FolderOpen size={14} />} /><Stat label="Outputs" value={bytes(storageQuery.data.outputs.directory_bytes)} detail={`${storageQuery.data.outputs.count} files`} icon={<Download size={14} />} tone="blue" /></div>
          <Panel className="p-5"><h2 className="text-sm font-semibold text-ink-50">Local storage breakdown</h2><div className="mt-3 divide-y divide-lineSoft text-[11px]">{[['Conversations', String(storageQuery.data.conversations)], ['Messages', String(storageQuery.data.messages)], ['Workflows', String(storageQuery.data.workflows)], ['SQLite database', bytes(storageQuery.data.database_bytes)], ['Model files (directory)', bytes(storageQuery.data.models.directory_bytes)], ['Model files (tracked records)', bytes(storageQuery.data.models.tracked_bytes)]].map(([label, value]) => <div key={label} className="flex items-center justify-between py-2"><span className="text-muted">{label}</span><span className="text-ink-50">{value}</span></div>)}</div><div className="mt-3 rounded-lg border border-lineSoft bg-ink-950/40 p-3 text-[10px] text-faint"><p className="font-mono">models: {storageQuery.data.paths.models}</p><p className="mt-1 font-mono">outputs: {storageQuery.data.paths.outputs}</p></div></Panel>
        </> : <EmptyState title="Storage information unavailable" />}</div>
      )}

      {tab === 'developer' && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel className="p-5"><h2 className="flex items-center gap-2 text-sm font-semibold text-ink-50"><Terminal size={14} /> Diagnostics</h2><p className="mt-1 text-[11px] text-muted">Collect runtime status, configuration, and llama.cpp log tails. Secrets are redacted.</p><div className="mt-3 flex flex-wrap gap-2"><Button onClick={() => void loadDiagnostics()} loading={diagnosticsLoading}><RefreshCw size={12} /> Collect</Button><Button onClick={exportDiagnostics} disabled={!diagnostics}><Download size={12} /> Export JSON</Button><a href="/api/docs" target="_blank" rel="noreferrer"><Button variant="ghost"><ExternalLink size={12} /> API docs</Button></a></div>{diagnostics && <pre className="mt-3 max-h-80 overflow-auto rounded-lg border border-line bg-ink-950 p-3 text-[9.5px] leading-relaxed text-muted">{JSON.stringify(diagnostics, null, 2)}</pre>}</Panel>
            <Panel className="p-5"><h2 className="text-sm font-semibold text-ink-50">Application logs</h2><p className="mt-1 text-[11px] text-muted">Structured JSON logs from this process. API keys and tokens are redacted.</p><div className="mt-3 max-h-80 space-y-1 overflow-y-auto rounded-lg border border-line bg-ink-950 p-2 font-mono text-[9.5px]">{logsQuery.isLoading ? <div className="flex items-center gap-2 p-2 text-muted"><Spinner className="h-3 w-3" /> Loading logs…</div> : (logsQuery.data?.logs ?? []).slice().reverse().map((log, index) => <div key={index} className={cn('flex gap-2 border-b border-lineSoft/50 py-1', log.level === 'ERROR' ? 'text-danger' : 'text-muted')}><span className="shrink-0 text-faint">{String(log.level)}</span><span className="min-w-0 break-all">{String(log.message)}</span></div>)}</div></Panel>
          </div>
          <Panel className="p-5"><h2 className="text-sm font-semibold text-ink-50">System</h2><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-[11px]">{hardwareQuery.data ? <><div><p className="text-faint">CPU</p><p className="mt-0.5 truncate text-ink-50">{(hardwareQuery.data.cpu as { model: string }).model}</p></div><div><p className="text-faint">Memory</p><p className="mt-0.5 text-ink-50">{bytes((hardwareQuery.data.memory as { total_bytes: number; available_bytes: number }).total_bytes)}</p></div><div><p className="text-faint">Python</p><p className="mt-0.5 text-ink-50">{String(hardwareQuery.data.python)}</p></div><div><p className="text-faint">App version</p><p className="mt-0.5 text-ink-50">{String(values.version)}</p></div></> : <p className="text-faint">Loading system report…</p>}</div></Panel>
        </div>
      )}

      <Modal open={providerOpen} onClose={() => setProviderOpen(false)} title={editingProvider ? 'Edit provider' : 'Add remote provider'} description="Keys are write-only and encrypted on disk. Use only endpoints you trust." footer={<><Button variant="ghost" onClick={() => setProviderOpen(false)}>Cancel</Button><Button variant="primary" onClick={() => void saveProvider()} loading={savingProvider} disabled={!providerForm.name.trim() || !providerForm.base_url.trim()}>Save</Button></>}>
        <div className="space-y-3"><Field label="Name"><Input value={providerForm.name} onChange={(event) => setProviderForm({ ...providerForm, name: event.target.value })} placeholder="Self-hosted gateway" /></Field><Field label="Base URL" help="OpenAI-compatible API root, for example http://127.0.0.1:1234/v1."><Input value={providerForm.base_url} onChange={(event) => setProviderForm({ ...providerForm, base_url: event.target.value })} placeholder="https://…/v1" /></Field><Field label="API key" help={editingProvider ? 'Leave empty to keep the existing key.' : 'Optional for local endpoints.'}><Input type="password" value={providerForm.api_key} onChange={(event) => setProviderForm({ ...providerForm, api_key: event.target.value })} autoComplete="off" /></Field><Toggle checked={providerForm.enabled} onChange={(value) => setProviderForm({ ...providerForm, enabled: value })} label="Enable provider" description="You will still explicitly select remote models per request." /></div>
      </Modal>
    </ScrollPage>
  );
}
