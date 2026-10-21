import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Copy, FileJson, Plus, Sparkles, Trash2, Wand2, Workflow as WorkflowIcon } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import type { Workflow, WorkflowGraph } from '../lib/types';
import { Badge, Button, EmptyState, Field, Modal, PageHeader, Panel, Skeleton, Textarea, cn } from '../components/ui';
import { relativeTime } from '../lib/format';
import { toast } from '../lib/store';
import { ScrollPage } from '../components/Layout';

interface Template { id: string; name: string; description: string; graph: WorkflowGraph }

export function WorkflowsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<Workflow | null>(null);
  const [importGraph, setImportGraph] = useState<WorkflowGraph | null>(null);
  const [importName, setImportName] = useState('');
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generatePrompt, setGeneratePrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<{ name: string; description: string; graph: WorkflowGraph; explanation: string[]; validation: { valid: boolean; errors: string[]; warnings: string[] } } | null>(null);

  const { data: workflows, isLoading } = useQuery({ queryKey: ['workflows'], queryFn: () => api<{ workflows: Workflow[] }>('/workflows'), select: (data) => data.workflows });
  const { data: templates } = useQuery({ queryKey: ['workflow-templates'], queryFn: () => api<{ templates: Template[] }>('/workflows/templates'), select: (data) => data.templates });

  async function createFromTemplate(template?: Template) {
    try {
      const workflow = await api<Workflow>('/workflows', {
        method: 'POST',
        body: JSON.stringify({ name: template?.name ?? 'Untitled workflow', description: template?.description ?? '', graph: template?.graph ?? { nodes: [], edges: [] } }),
      });
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
      navigate(`/workflows/${workflow.id}`);
    } catch (error) { toast.error('Could not create workflow', errorMessage(error)); }
  }

  async function removeWorkflow() {
    if (!deleteTarget) return;
    try {
      await api(`/workflows/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
      toast.success('Workflow deleted');
    } catch (error) { toast.error('Could not delete workflow', errorMessage(error)); }
  }

  function importFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const graph = parsed.graph ?? parsed;
        if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error('JSON must contain nodes and edges arrays.');
        setImportGraph(graph as WorkflowGraph);
        setImportName(String(parsed.name || file.name.replace(/\.json$/i, '')));
      } catch (error) { toast.error('Invalid workflow JSON', errorMessage(error)); }
    };
    reader.readAsText(file);
  }

  async function confirmImport() {
    if (!importGraph) return;
    try {
      const workflow = await api<Workflow>('/workflows', { method: 'POST', body: JSON.stringify({ name: importName || 'Imported workflow', description: 'Imported from JSON', graph: importGraph }) });
      setImportGraph(null);
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
      navigate(`/workflows/${workflow.id}`);
    } catch (error) { toast.error('Import failed', errorMessage(error)); }
  }

  async function generateWorkflow() {
    if (!generatePrompt.trim()) return;
    setGenerating(true);
    setGenerated(null);
    try {
      setGenerated(await api('/workflows/generate', { method: 'POST', body: JSON.stringify({ prompt: generatePrompt }) }));
    } catch (error) { toast.error('Could not generate workflow', errorMessage(error)); }
    finally { setGenerating(false); }
  }

  async function saveGenerated() {
    if (!generated) return;
    try {
      const workflow = await api<Workflow>('/workflows', { method: 'POST', body: JSON.stringify({ name: generated.name, description: generated.description, graph: generated.graph }) });
      setGenerateOpen(false);
      setGenerated(null);
      setGeneratePrompt('');
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
      navigate(`/workflows/${workflow.id}`);
    } catch (error) { toast.error('Could not save workflow', errorMessage(error)); }
  }

  return (
    <ScrollPage>
      <PageHeader
        eyebrow="Executable graphs"
        title="Visual workflows"
        description="Compose typed nodes into directed acyclic graphs and execute them through local runtimes. Invalid graphs are rejected before anything runs."
        actions={<><input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) importFile(file); event.target.value = ''; }} /><Button onClick={() => fileRef.current?.click()}><FileJson size={14} /> Import JSON</Button><Button onClick={() => setGenerateOpen(true)}><Sparkles size={14} /> Generate from prompt</Button><Button variant="primary" onClick={() => void createFromTemplate()}><Plus size={14} /> New workflow</Button></>}
      />

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div>
          <div className="mb-2 flex items-center justify-between"><h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">Your workflows</h2><span className="text-[11px] text-faint">{workflows?.length ?? 0} saved</span></div>
          {isLoading ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div> : !workflows?.length ? (
            <EmptyState icon={<WorkflowIcon size={20} />} title="No workflows yet" description="Start from a template or create a blank graph, then add nodes from the palette." action={<Button variant="primary" onClick={() => void createFromTemplate()}><Plus size={14} /> Create workflow</Button>} />
          ) : (
            <div className="space-y-2">
              {workflows.map((workflow) => (
                <Panel key={workflow.id} className="group p-4 transition-colors hover:border-accent/25">
                  <div className="flex items-start gap-3">
                    <span className="rounded-lg border border-line bg-raised p-2 text-accent-soft"><WorkflowIcon size={15} /></span>
                    <Link to={`/workflows/${workflow.id}`} className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-ink-50">{workflow.name}</p>
                      <p className="mt-0.5 line-clamp-1 text-[11px] text-muted">{workflow.description || 'No description'}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5"><Badge tone="neutral">{workflow.node_count ?? workflow.graph.nodes.length} nodes</Badge><Badge tone="neutral">{workflow.graph.edges.length} edges</Badge><span className="text-[10px] text-faint">updated {relativeTime(workflow.updated_at)}</span></div>
                    </Link>
                    <div className="flex items-center gap-1">
                      <button className="rounded-md p-2 text-faint hover:bg-raised hover:text-danger" onClick={() => setDeleteTarget(workflow)} title="Delete workflow"><Trash2 size={14} /></button>
                      <Link to={`/workflows/${workflow.id}`} className="rounded-md p-2 text-muted hover:bg-raised hover:text-ink-50" title="Open editor"><ArrowRight size={14} /></Link>
                    </div>
                  </div>
                </Panel>
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted">Starting templates</h2>
          <div className="space-y-2">
            {(templates ?? []).map((template) => (
              <Panel key={template.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div><p className="text-[12.5px] font-medium text-ink-50">{template.name}</p><p className="mt-1 text-[11px] leading-relaxed text-muted">{template.description}</p></div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[10px] text-faint">{template.graph.nodes.length} nodes · {template.graph.edges.length} edges</span>
                  <Button size="sm" onClick={() => void createFromTemplate(template)}><Copy size={12} /> Use template</Button>
                </div>
              </Panel>
            ))}
            <div className={cn('rounded-xl border border-dashed border-line p-4 text-[11px] leading-relaxed text-faint')}>
              <p className="font-medium text-muted">ComfyUI import</p>
              <p className="mt-1">A compatibility layer is planned. VANTARA does not claim ComfyUI compatibility until node mappings and execution semantics are implemented and tested.</p>
            </div>
          </div>
        </div>
      </div>

      <Modal open={generateOpen} onClose={() => { setGenerateOpen(false); setGenerated(null); }} size="lg" title="Generate workflow from a prompt" description="A capability-aware planner maps your request to validated, editable nodes. Nothing runs until you press Run." footer={<><Button variant="ghost" onClick={() => { setGenerateOpen(false); setGenerated(null); }}>Cancel</Button>{generated?.validation.valid && <Button variant="primary" onClick={() => void saveGenerated()}><Wand2 size={13} /> Save & open</Button>}</>}>
        <div className="space-y-3">
          <Field label="What should the workflow do?"><Textarea rows={3} value={generatePrompt} onChange={(event) => setGeneratePrompt(event.target.value)} placeholder="Summarize a document and save the result…" /></Field>
          <Button variant="primary" onClick={() => void generateWorkflow()} loading={generating} disabled={!generatePrompt.trim()}><Sparkles size={13} /> Generate graph</Button>
          {generated && <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5"><Badge tone={generated.validation.valid ? 'success' : 'danger'}>{generated.validation.valid ? 'valid graph' : 'needs fixes'}</Badge><Badge tone="neutral">{generated.graph.nodes.length} nodes</Badge><Badge tone="neutral">{generated.graph.edges.length} edges</Badge></div>
            {generated.explanation.map((note) => <p key={note} className="rounded-md border border-lineSoft bg-ink-950/40 px-2.5 py-1.5 text-[10.5px] leading-relaxed text-muted">{note}</p>)}
            {generated.validation.errors.map((error) => <p key={error} className="text-[10.5px] text-danger">{error}</p>)}
            <pre className="max-h-48 overflow-auto rounded-lg border border-line bg-ink-950 p-2 text-[9px] text-faint">{JSON.stringify(generated.graph.nodes.map((node) => ({ type: node.type, config: node.config })), null, 2)}</pre>
          </div>}
        </div>
      </Modal>

      <Modal open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title="Delete workflow" footer={<><Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancel</Button><Button variant="danger" onClick={() => void removeWorkflow()}>Delete</Button></>}>
        <p className="text-[13px] text-muted">Delete “{deleteTarget?.name}”? Run history is retained.</p>
      </Modal>
      <Modal open={Boolean(importGraph)} onClose={() => setImportGraph(null)} title="Import workflow" description="JSON is validated by the backend when you run it." footer={<><Button variant="ghost" onClick={() => setImportGraph(null)}>Cancel</Button><Button variant="primary" onClick={() => void confirmImport()}>Import</Button></>}>
        <label className="label">Workflow name</label>
        <input className="field mt-1.5" value={importName} onChange={(event) => setImportName(event.target.value)} />
        <p className="mt-3 text-[11px] text-muted">{importGraph?.nodes.length} nodes, {importGraph?.edges.length} edges detected.</p>
      </Modal>
    </ScrollPage>
  );
}
