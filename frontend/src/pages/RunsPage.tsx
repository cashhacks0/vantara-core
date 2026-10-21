import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Download, FileText, Image as ImageIcon, Square, Trash2, Workflow } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import type { AgentRun, Output, WorkflowRun } from '../lib/types';
import { Badge, Button, EmptyState, Modal, PageHeader, Panel, Skeleton, Tabs, cn } from '../components/ui';
import { dateTime, duration, relativeTime, statusTone } from '../lib/format';
import { toast } from '../lib/store';
import { ScrollPage } from '../components/Layout';

type Tab = 'workflows' | 'agents' | 'outputs';

export function RunsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('workflows');
  const [selectedRun, setSelectedRun] = useState<WorkflowRun | null>(null);
  const [selectedAgentRun, setSelectedAgentRun] = useState<AgentRun | null>(null);
  const [selectedOutput, setSelectedOutput] = useState<Output | null>(null);

  const workflowRuns = useQuery({ queryKey: ['workflow-runs'], queryFn: () => api<{ runs: WorkflowRun[] }>('/workflow-runs'), select: (data) => data.runs, refetchInterval: 10_000 });
  const agentRuns = useQuery({ queryKey: ['agent-runs'], queryFn: () => api<{ runs: AgentRun[] }>('/agent-runs'), select: (data) => data.runs, refetchInterval: 10_000 });
  const outputs = useQuery({ queryKey: ['outputs'], queryFn: () => api<{ outputs: Output[] }>('/outputs'), select: (data) => data.outputs });

  const activeCount = useMemo(() => (workflowRuns.data ?? []).filter((run) => run.status === 'running').length, [workflowRuns.data]);

  async function loadRun(run: WorkflowRun) {
    try { setSelectedRun(await api<WorkflowRun>(`/workflow-runs/${run.id}`)); }
    catch (error) { toast.error('Could not load run', errorMessage(error)); }
  }

  async function cancelRun(run: WorkflowRun) {
    try { await api(`/workflow-runs/${run.id}/cancel`, { method: 'POST' }); void queryClient.invalidateQueries({ queryKey: ['workflow-runs'] }); toast.success('Cancellation requested'); }
    catch (error) { toast.error('Cancel failed', errorMessage(error)); }
  }

  async function deleteOutput(output: Output) {
    try { await api(`/outputs/${output.id}`, { method: 'DELETE' }); setSelectedOutput(null); void queryClient.invalidateQueries({ queryKey: ['outputs'] }); toast.success('Output deleted'); }
    catch (error) { toast.error('Delete failed', errorMessage(error)); }
  }

  return (
    <ScrollPage>
      <PageHeader eyebrow="Execution records" title="Runs & History" description="Every workflow run, agent run, and generated output is recorded locally. Events and errors are persisted for auditing." actions={<Badge tone={activeCount ? 'warn' : 'neutral'} dot>{activeCount} active workflow run(s)</Badge>} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ value: 'workflows', label: 'Workflow runs', count: workflowRuns.data?.length }, { value: 'agents', label: 'Agent runs', count: agentRuns.data?.length }, { value: 'outputs', label: 'Outputs', count: outputs.data?.length }]} className="mb-4" />

      {tab === 'workflows' && (
        <div className="space-y-2">
          {workflowRuns.isLoading ? <Skeleton className="h-64" /> : !workflowRuns.data?.length ? <EmptyState icon={<Workflow size={19} />} title="No workflow runs" description="Run a workflow to create an execution record with events and outputs." /> : workflowRuns.data.map((run) => (
            <Panel key={run.id} className="p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md border border-line bg-raised p-1.5 text-accent-soft"><Workflow size={12} /></span>
                <button onClick={() => void loadRun(run)} className="min-w-0 flex-1 text-left"><p className="truncate text-[12px] font-medium text-ink-50">{run.workflow_name ?? 'Untitled workflow'}</p><p className="text-[10px] text-faint">{relativeTime(run.started_at)} · {duration(run.started_at, run.finished_at)} · <span className="font-mono">{run.id}</span></p></button>
                {run.error && <span className="hidden max-w-[280px] truncate text-[10px] text-danger sm:block" title={run.error}>{run.error}</span>}
                <Badge tone={statusTone(run.status)}>{run.status}</Badge>
                {run.status === 'running' && <button onClick={() => void cancelRun(run)} className="rounded p-1.5 text-warn hover:bg-raised" title="Cancel run"><Square size={12} /></button>}
              </div>
            </Panel>
          ))}
        </div>
      )}

      {tab === 'agents' && (
        <div className="space-y-2">
          {agentRuns.isLoading ? <Skeleton className="h-64" /> : !agentRuns.data?.length ? <EmptyState icon={<Bot size={19} />} title="No agent runs" description="Run an agent to record each tool call and final answer." /> : agentRuns.data.map((run) => (
            <button key={run.id} onClick={() => setSelectedAgentRun(run)} className="w-full rounded-xl border border-line bg-surface/70 p-3.5 text-left hover:bg-panel">
              <div className="flex flex-wrap items-center gap-2"><span className="rounded-md border border-line bg-raised p-1.5 text-accent-soft"><Bot size={12} /></span><div className="min-w-0 flex-1"><p className="truncate text-[12px] font-medium text-ink-50">{run.agent_name ?? 'Agent'} <span className="text-faint">· {run.steps.length} steps</span></p><p className="truncate text-[10px] text-faint">{run.input}</p></div><Badge tone={statusTone(run.status)}>{run.status}</Badge><span className="text-[10px] text-faint">{relativeTime(run.started_at)}</span></div>
            </button>
          ))}
        </div>
      )}

      {tab === 'outputs' && (
        outputs.isLoading ? <Skeleton className="h-64" /> : !outputs.data?.length ? <EmptyState icon={<FileText size={19} />} title="No outputs" description="Workflow Save Output nodes, Image Studio generations, and agent writes appear here." /> : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {outputs.data.map((output) => (
              <Panel key={output.id} className="overflow-hidden">
                <button onClick={() => setSelectedOutput(output)} className="block w-full text-left">
                  <div className="flex aspect-[4/3] items-center justify-center bg-ink-950">{output.mime?.startsWith('image/') && output.exists !== false ? <img src={output.url} alt={output.name} className="h-full w-full object-cover" loading="lazy" /> : <FileText size={26} className="text-faint" />}</div>
                  <div className="p-3"><p className="truncate text-[11px] font-medium text-ink-50">{output.name}</p><div className="mt-1 flex items-center gap-1.5"><Badge tone="neutral">{output.kind}</Badge><span className="text-[9px] text-faint">{relativeTime(output.created_at)}</span></div></div>
                </button>
              </Panel>
            ))}
          </div>
        )
      )}

      <Modal open={Boolean(selectedRun)} onClose={() => setSelectedRun(null)} size="lg" title={selectedRun?.workflow_name ?? 'Workflow run'} description={selectedRun ? `${selectedRun.status} · ${duration(selectedRun.started_at, selectedRun.finished_at)} · ${selectedRun.id}` : undefined} footer={<Button onClick={() => setSelectedRun(null)}>Close</Button>}>
        {selectedRun && <div className="space-y-4">
          {selectedRun.error && <div className="rounded-lg border border-danger/20 bg-danger/5 p-3 text-[11px] text-danger">{selectedRun.error}</div>}
          <section><h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">Outputs</h3>{Object.keys(selectedRun.outputs).length === 0 ? <p className="text-[11px] text-faint">No output nodes produced data.</p> : <pre className="max-h-64 overflow-auto rounded-lg border border-line bg-ink-950 p-3 text-[10px] leading-relaxed text-muted">{JSON.stringify(selectedRun.outputs, null, 2)}</pre>}</section>
          <section><h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">Event log ({selectedRun.events.length})</h3><div className="max-h-72 overflow-y-auto rounded-lg border border-line bg-ink-950 p-2 font-mono text-[10px]">{selectedRun.events.map((event, index) => <div key={index} className={cn('flex gap-2 py-0.5', event.type === 'run_failed' ? 'text-danger' : 'text-muted')}><span className="w-[90px] shrink-0 text-faint">{String(event.type)}</span><span className="min-w-0 break-words">{JSON.stringify(Object.fromEntries(Object.entries(event).filter(([key]) => !['type', 'ts', 'run_id'].includes(key)))).slice(0, 500)}</span></div>)}</div></section>
          <p className="text-[10px] text-faint">Started {dateTime(selectedRun.started_at)} · finished {dateTime(selectedRun.finished_at)}</p>
        </div>}
      </Modal>

      <Modal open={Boolean(selectedAgentRun)} onClose={() => setSelectedAgentRun(null)} size="lg" title={selectedAgentRun?.agent_name ?? 'Agent run'} description={selectedAgentRun ? `${selectedAgentRun.status} · ${selectedAgentRun.steps.length} steps` : undefined} footer={<Button onClick={() => setSelectedAgentRun(null)}>Close</Button>}>
        {selectedAgentRun && <div className="space-y-3"><div className="rounded-lg border border-line bg-ink-950/40 p-3 text-[11px] text-muted"><p className="text-[10px] uppercase tracking-wider text-faint">Input</p><p className="mt-1 whitespace-pre-wrap text-ink-50/90">{selectedAgentRun.input}</p></div>{selectedAgentRun.error && <p className="text-[11px] text-danger">{selectedAgentRun.error}</p>}{selectedAgentRun.steps.map((step) => <div key={step.step} className="rounded-lg border border-lineSoft bg-ink-950/40 p-2.5"><p className="flex items-center gap-2 text-[10.5px] text-muted"><span className="font-mono text-faint">step {step.step}</span>{step.type === 'tool' ? <span className="text-accent-soft">{step.tool}</span> : <span className="text-success">final</span>}</p>{step.arguments && <pre className="mt-1 text-[10px] text-faint">{JSON.stringify(step.arguments)}</pre>}{step.observation !== undefined && <pre className="mt-1 max-h-40 overflow-auto rounded bg-surface p-2 text-[10px] text-muted">{JSON.stringify(step.observation, null, 2)}</pre>}{step.text && <p className="mt-1 text-[11px] text-ink-50/90 whitespace-pre-wrap">{step.text}</p>}</div>)}{selectedAgentRun.output && <div className="rounded-lg border border-accent/20 bg-accent/5 p-3 text-[12px] leading-6 whitespace-pre-wrap">{selectedAgentRun.output}</div>}</div>}
      </Modal>

      <Modal open={Boolean(selectedOutput)} onClose={() => setSelectedOutput(null)} size="lg" title={selectedOutput?.name ?? 'Output'} description={selectedOutput ? `${selectedOutput.kind} · ${relativeTime(selectedOutput.created_at)}` : undefined} footer={<><Button variant="danger" onClick={() => selectedOutput && void deleteOutput(selectedOutput)}><Trash2 size={12} /> Delete</Button><a href={selectedOutput?.url} download><Button><Download size={12} /> Download</Button></a></>}>
        {selectedOutput && <div className="space-y-3">{selectedOutput.mime?.startsWith('image/') ? <img src={selectedOutput.url} alt={selectedOutput.name} className="max-h-[55vh] w-full rounded-lg border border-line bg-ink-950 object-contain" /> : <a href={selectedOutput.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border border-line bg-ink-950 p-4 text-xs text-accent-soft hover:underline"><ImageIcon size={15} /> Open output file</a>}<pre className="overflow-auto rounded-lg border border-line bg-ink-950 p-3 text-[10px] text-muted">{JSON.stringify(selectedOutput.meta, null, 2)}</pre><p className="truncate font-mono text-[9.5px] text-faint">{selectedOutput.path}</p></div>}
      </Modal>
    </ScrollPage>
  );
}
