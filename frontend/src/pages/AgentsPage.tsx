import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bot, CheckCircle2, ChevronRight, Play, Plus, ShieldAlert, Trash2, Wrench } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import type { Agent, AgentRun } from '../lib/types';
import { useAgentTools, useAgents } from '../lib/queries';
import { Badge, Button, EmptyState, Field, Input, Modal, PageHeader, Panel, Select, Skeleton, Textarea, Toggle, cn } from '../components/ui';
import { relativeTime } from '../lib/format';
import { toast } from '../lib/store';
import { ScrollPage } from '../components/Layout';
import { ModelPicker } from '../components/ModelPicker';

const EMPTY_FORM = { name: '', description: '', system_prompt: 'You are a careful local research agent. Use tools only when needed.', model_id: 'auto', tools: ['calculator'], max_steps: 5, require_approval: true };

export function AgentsPage() {
  const queryClient = useQueryClient();
  const { data: agents = [], isLoading } = useAgents();
  const { data: tools = [] } = useAgentTools();
  const { data: runs = [] } = useQuery({ queryKey: ['agent-runs'], queryFn: () => api<{ runs: AgentRun[] }>('/agent-runs'), select: (data) => data.runs, refetchInterval: 15_000 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [form, setForm] = useState<typeof EMPTY_FORM>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [input, setInput] = useState('');
  const [approved, setApproved] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AgentRun | null>(null);
  const [needsApproval, setNeedsApproval] = useState<{ message: string; tools: string[] } | null>(null);

  useEffect(() => { if (!selectedId && agents.length) setSelectedId(agents[0].id); }, [agents, selectedId]);
  const selected = useMemo(() => agents.find((agent) => agent.id === selectedId) ?? null, [agents, selectedId]);
  const selectedRuns = useMemo(() => runs.filter((run) => run.agent_id === selectedId).slice(0, 8), [runs, selectedId]);

  function openCreate() { setEditing(null); setForm(EMPTY_FORM); setEditorOpen(true); }
  function openEdit(agent: Agent) {
    setEditing(agent);
    setForm({ name: agent.name, description: agent.description, system_prompt: agent.system_prompt, model_id: agent.model_id || 'auto', tools: agent.tools, max_steps: agent.max_steps, require_approval: agent.require_approval });
    setEditorOpen(true);
  }

  async function saveAgent() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editing) await api(`/agents/${editing.id}`, { method: 'PUT', body: JSON.stringify(form) });
      else await api('/agents', { method: 'POST', body: JSON.stringify(form) });
      setEditorOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['agents'] });
      toast.success(editing ? 'Agent updated' : 'Agent created');
    } catch (error) { toast.error('Save failed', errorMessage(error)); }
    finally { setSaving(false); }
  }

  async function removeAgent(agent: Agent) {
    if (!window.confirm(`Delete agent “${agent.name}”?`)) return;
    try { await api(`/agents/${agent.id}`, { method: 'DELETE' }); setSelectedId(null); setResult(null); void queryClient.invalidateQueries({ queryKey: ['agents'] }); toast.success('Agent deleted'); }
    catch (error) { toast.error('Delete failed', errorMessage(error)); }
  }

  async function runAgent(forceApproved = false) {
    if (!selected || !input.trim()) return;
    setRunning(true);
    setResult(null);
    setNeedsApproval(null);
    try {
      const data = await api<AgentRun & { message?: string; tools?: string[] }>(`/agents/${selected.id}/run`, { method: 'POST', body: JSON.stringify({ input, approved: forceApproved || approved }) });
      if (data.status === 'requires_approval') {
        setNeedsApproval({ message: data.message ?? 'Approval required.', tools: data.tools ?? [] });
      } else {
        setResult(data);
        void queryClient.invalidateQueries({ queryKey: ['agent-runs'] });
        void queryClient.invalidateQueries({ queryKey: ['outputs'] });
      }
    } catch (error) { toast.error('Agent run failed', errorMessage(error)); }
    finally { setRunning(false); }
  }

  return (
    <ScrollPage>
      <PageHeader eyebrow="Bounded automation" title="AI Agents" description="Agents use approved tools with explicit step limits. Modifying tools require human approval. There is no shell execution or unrestricted filesystem access." actions={<Button variant="primary" onClick={openCreate}><Plus size={14} /> New agent</Button>} />

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <div className="space-y-2">
          {isLoading ? <Skeleton className="h-64" /> : agents.length === 0 ? <EmptyState icon={<Bot size={19} />} title="No agents configured" action={<Button onClick={openCreate}>Create an agent</Button>} /> : agents.map((agent) => (
            <button key={agent.id} onClick={() => { setSelectedId(agent.id); setResult(null); setNeedsApproval(null); setInput(''); }} className={cn('w-full rounded-xl border p-3.5 text-left transition-colors', selected?.id === agent.id ? 'border-accent/40 bg-accent/5' : 'border-line bg-surface/70 hover:bg-panel')}>
              <div className="flex items-center gap-2"><span className="rounded-md border border-line bg-raised p-1.5 text-accent-soft"><Bot size={13} /></span><p className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink-50">{agent.name}</p><ChevronRight size={13} className="text-faint" /></div>
              <p className="mt-1.5 line-clamp-2 text-[10.5px] leading-relaxed text-muted">{agent.description || 'No description'}</p>
              <div className="mt-2 flex flex-wrap gap-1"><Badge tone="neutral">{agent.tools.length} tools</Badge><Badge tone="neutral">max {agent.max_steps} steps</Badge>{agent.require_approval && <Badge tone="warn">approval</Badge>}</div>
            </button>
          ))}
        </div>

        {selected ? (
          <div className="space-y-4">
            <Panel className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-ink-50">{selected.name}</h2><p className="mt-1 max-w-2xl text-[11.5px] leading-relaxed text-muted">{selected.description || 'No description'}</p></div><div className="flex gap-1.5"><Button size="sm" onClick={() => openEdit(selected)}>Edit</Button><Button size="sm" variant="ghost" onClick={() => void removeAgent(selected)}><Trash2 size={12} /></Button></div></div>
              <div className="mt-3 flex flex-wrap gap-1.5"><Badge tone="accent">{selected.model_id || 'auto'}</Badge><Badge tone="neutral">{selected.max_steps} max steps</Badge><Badge tone={selected.require_approval ? 'warn' : 'neutral'}>{selected.require_approval ? 'human approval' : 'no approval gate'}</Badge></div>
              <div className="mt-3 rounded-lg border border-lineSoft bg-ink-950/40 p-3 text-[11px] leading-relaxed text-muted">{selected.system_prompt || 'No system instructions.'}</div>
              <div className="mt-3 flex flex-wrap gap-1">{selected.tools.map((name) => { const tool = tools.find((item) => item.name === name); return <span key={name} className="chip" title={tool?.description}><Wrench size={9} />{name}{tool?.modifies && <span className="text-warn">·write</span>}</span>; })}</div>
            </Panel>

            <Panel className="p-5">
              <h3 className="text-sm font-semibold text-ink-50">Run agent</h3>
              <p className="mt-0.5 text-[11px] text-muted">The model receives a strict JSON tool protocol. Every tool call is logged.</p>
              <Textarea className="mt-3" rows={4} value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask the agent to accomplish something…" />
              {selected.require_approval && <div className="mt-2"><Toggle checked={approved} onChange={setApproved} label="Approve modifying actions for this run" description="Required before write_output can be used." /></div>}
              <div className="mt-2 flex items-center gap-2"><Button variant="primary" onClick={() => void runAgent()} loading={running} disabled={!input.trim()}><Play size={13} /> Run agent</Button><span className="text-[10px] text-faint">Bounded to {selected.max_steps} steps · 180s per step</span></div>
              {needsApproval && (
                <div className="mt-3 rounded-lg border border-warn/25 bg-warn/5 p-3"><p className="flex items-center gap-1.5 text-[11px] font-medium text-warn"><ShieldAlert size={12} /> Approval required</p><p className="mt-1 text-[11px] text-muted">{needsApproval.message} Tools: {needsApproval.tools.join(', ')}</p><Button size="sm" className="mt-2" onClick={() => void runAgent(true)}>Approve & run</Button></div>
              )}
            </Panel>

            {result && <RunResult run={result} />}

            <Panel className="p-5">
              <h3 className="text-sm font-semibold text-ink-50">Recent runs</h3>
              {selectedRuns.length === 0 ? <p className="mt-2 text-[11px] text-faint">No runs for this agent yet.</p> : <div className="mt-2 divide-y divide-lineSoft">{selectedRuns.map((run) => <div key={run.id} className="py-2.5"><div className="flex items-center gap-2"><Badge tone={run.status === 'completed' ? 'success' : run.status === 'failed' ? 'danger' : 'warn'}>{run.status}</Badge><span className="text-[10px] text-faint">{relativeTime(run.started_at)}</span><span className="ml-auto text-[10px] text-faint">{run.steps.length} steps</span></div><p className="mt-1 line-clamp-2 text-[11px] text-muted">{run.input}</p>{run.error && <p className="mt-1 text-[10px] text-danger">{run.error}</p>}</div>)}</div>}
            </Panel>
          </div>
        ) : <Panel className="flex items-center justify-center p-12 text-sm text-muted"><Bot size={18} className="mr-2" /> Select or create an agent</Panel>}
      </div>

      <Modal open={editorOpen} onClose={() => setEditorOpen(false)} title={editing ? 'Edit agent' : 'New agent'} description="Only approved tools are exposed to the model." footer={<><Button variant="ghost" onClick={() => setEditorOpen(false)}>Cancel</Button><Button variant="primary" onClick={() => void saveAgent()} loading={saving} disabled={!form.name.trim()}>Save agent</Button></>}>
        <div className="space-y-3">
          <Field label="Name"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Research assistant" /></Field>
          <Field label="Description"><Input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What this agent is for" /></Field>
          <Field label="System instructions"><Textarea rows={4} value={form.system_prompt} onChange={(event) => setForm({ ...form, system_prompt: event.target.value })} /></Field>
          <Field label="Model"><ModelPicker value={form.model_id} onChange={(value) => setForm({ ...form, model_id: value })} /></Field>
          <Field label="Approved tools"><div className="grid gap-1.5 sm:grid-cols-2">{tools.map((tool) => <label key={tool.name} className="flex items-start gap-2 rounded-lg border border-line bg-ink-950/40 p-2.5 text-[11px]"><input type="checkbox" className="mt-0.5 accent-[#8b5cf6]" checked={form.tools.includes(tool.name)} onChange={(event) => setForm({ ...form, tools: event.target.checked ? [...form.tools, tool.name] : form.tools.filter((name) => name !== tool.name) })} /><span><span className="flex items-center gap-1 font-medium text-ink-50">{tool.name}{tool.modifies && <Badge tone="warn">write</Badge>}</span><span className="mt-0.5 block text-[10px] leading-relaxed text-muted">{tool.description}</span></span></label>)}</div></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Maximum steps"><Input type="number" min={1} max={10} value={form.max_steps} onChange={(event) => setForm({ ...form, max_steps: Math.max(1, Math.min(10, Number(event.target.value))) })} /></Field><Field label="Approval"><Select value={form.require_approval ? 'yes' : 'no'} onChange={(event) => setForm({ ...form, require_approval: event.target.value === 'yes' })}><option value="yes">Require human approval</option><option value="no">Skip approval gate</option></Select></Field></div>
        </div>
      </Modal>
    </ScrollPage>
  );
}

function RunResult({ run }: { run: AgentRun }) {
  return (
    <Panel className="p-5">
      <div className="flex items-center gap-2"><Badge tone={run.status === 'completed' ? 'success' : run.status === 'failed' ? 'danger' : 'warn'} dot>{run.status}</Badge><span className="text-[10px] text-faint">{run.id}</span></div>
      {run.error && <p className="mt-2 rounded-lg border border-danger/20 bg-danger/5 p-2 text-[11px] text-danger">{run.error}</p>}
      <div className="mt-3 space-y-2">{run.steps.map((step) => (
        <div key={step.step} className="rounded-lg border border-lineSoft bg-ink-950/40 p-2.5">
          <div className="flex items-center gap-2 text-[10.5px] text-muted"><span className="font-mono text-faint">step {step.step}</span>{step.type === 'tool' ? <><Wrench size={10} className="text-accent-soft" /><span className="font-medium text-ink-50">{step.tool}</span></> : <span className="flex items-center gap-1 text-success"><CheckCircle2 size={10} /> final</span>}</div>
          {step.arguments && <pre className="mt-1 overflow-x-auto text-[10px] text-faint">{JSON.stringify(step.arguments, null, 2)}</pre>}
          {step.observation !== undefined && <pre className="mt-1 max-h-40 overflow-auto rounded bg-surface px-2 py-1.5 text-[10px] text-muted">{JSON.stringify(step.observation, null, 2)}</pre>}
        </div>
      ))}</div>
      {run.output && <div className="mt-3 rounded-lg border border-accent/20 bg-accent/5 p-3 text-[12px] leading-6 text-ink-50/90 whitespace-pre-wrap">{run.output}</div>}
      {run.status === 'stopped' && <p className="mt-2 flex items-center gap-1 text-[11px] text-warn"><AlertTriangle size={11} /> Maximum step limit reached.</p>}
    </Panel>
  );
}
