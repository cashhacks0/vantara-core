import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Background, Controls, MiniMap, ReactFlow, addEdge, useEdgesState, useNodesState,
  type Connection, type Edge, type Node, type NodeProps,
} from '@xyflow/react';
import {
  ArrowLeft, CheckCircle2, Download, Play, Plus, Redo2, Save,
  Settings2, ShieldAlert, Square, Trash2, Undo2, Upload, X, Zap,
} from 'lucide-react';
import { api, ApiError, errorMessage, streamRunEvents } from '../lib/api';
import type { NodeSpec, Workflow, WorkflowGraph } from '../lib/types';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Field, Input, Modal, Select, Spinner, Textarea, Toggle, cn } from '../components/ui';
import { ModelPicker } from '../components/ModelPicker';
import { toast } from '../lib/store';

interface VNodeData extends Record<string, unknown> {
  spec: NodeSpec;
  config: Record<string, unknown>;
  status?: string;
}
type VNode = Node<VNodeData, 'vantara'>;

const STATUS_TONE: Record<string, string> = {
  running: 'border-warn/50 bg-warn/10 text-warn',
  completed: 'border-success/40 bg-success/10 text-success',
  failed: 'border-danger/40 bg-danger/10 text-danger',
  skipped: 'border-line bg-raised text-faint',
};

function VantaraNode({ data, selected }: NodeProps<VNode>) {
  const iconTone = data.spec.category === 'AI' ? 'text-accent-soft' : data.spec.category === 'Output' ? 'text-success' : 'text-electric';
  return (
    <div className={cn('vantara-node w-[224px] rounded-xl border bg-panel shadow-panel transition-colors', selected ? 'border-accent/60' : 'border-line')}>
      <div className="flex items-center gap-2 border-b border-lineSoft px-3 py-2.5">
        <span className={cn('rounded-md border border-line bg-raised p-1', iconTone)}><Zap size={11} /></span>
        <div className="min-w-0 flex-1"><p className="truncate text-[11.5px] font-semibold text-ink-50">{data.spec.label}</p><p className="truncate text-[9px] uppercase tracking-wider text-faint">{data.spec.category}</p></div>
        {data.status && <span className={cn('rounded border px-1.5 py-0.5 text-[9px] font-medium', STATUS_TONE[data.status] ?? STATUS_TONE.skipped)}>{data.status}</span>}
      </div>
      <div className="space-y-1.5 px-3 py-2.5 text-[10px] text-muted">
        {data.spec.inputs.map((port) => (
          <div key={port.name} className="relative flex items-center gap-1.5">
            <span className={cn('absolute -left-[17px] h-2 w-2 rounded-full border', port.required ? 'border-accent bg-ink' : 'border-faint bg-ink')} />
            <span className="truncate">{port.name}</span><span className="ml-auto rounded bg-raised px-1 py-0.5 text-[8.5px] text-faint">{port.type}</span>
          </div>
        ))}
        {data.spec.inputs.length === 0 && <p className="text-faint">No inputs</p>}
        {data.spec.outputs.length > 0 && <div className="my-1 border-t border-lineSoft" />}
        {data.spec.outputs.map((port) => (
          <div key={port.name} className="relative flex items-center justify-end gap-1.5">
            <span className="rounded bg-raised px-1 py-0.5 text-[8.5px] text-faint">{port.type}</span>
            <span className="truncate">{port.name}</span>
            <span className="absolute -right-[17px] h-2 w-2 rounded-full border border-faint bg-ink" />
          </div>
        ))}
      </div>
      {data.spec.requires.length > 0 && <div className="border-t border-lineSoft px-3 py-1.5 text-[8.5px] uppercase tracking-wider text-faint">needs {data.spec.requires.join(' · ')}</div>}
    </div>
  );
}

const nodeTypes = { vantara: VantaraNode };

function nodeStatusTone(status?: string) {
  if (status === 'completed') return 'success' as const;
  if (status === 'failed') return 'danger' as const;
  if (status === 'running') return 'warn' as const;
  return 'neutral' as const;
}

export function WorkflowEditorPage() {
  const { workflowId } = useParams();
  const queryClient = useQueryClient();
  const { data: workflow, isLoading } = useQuery({ queryKey: ['workflow', workflowId], queryFn: () => api<Workflow>(`/workflows/${workflowId}`), enabled: Boolean(workflowId) });
  const { data: catalog } = useQuery({ queryKey: ['workflow-nodes'], queryFn: () => api<{ nodes: NodeSpec[] }>('/workflows/nodes'), select: (data) => data.nodes, staleTime: Infinity });
  const { data: uploads } = useQuery({ queryKey: ['uploads'], queryFn: () => api<{ uploads: Array<{ name: string; stored_name: string; size_bytes: number }> }>('/uploads'), select: (data) => data.uploads });

  const [nodes, setNodes, onNodesChange] = useNodesState<VNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState('Untitled workflow');
  const [description, setDescription] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState('idle');
  const [runEvents, setRunEvents] = useState<Array<Record<string, unknown>>>([]);
  const [runError, setRunError] = useState<{ error: string; hint?: string } | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  const [validation, setValidation] = useState<{ errors: string[]; warnings: string[] } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');

  const loadedId = useRef<string | null>(null);
  const past = useRef<Array<{ nodes: VNode[]; edges: Edge[] }>>([]);
  const future = useRef<Array<{ nodes: VNode[]; edges: Edge[] }>>([]);
  const [, forceHistory] = useState(0);
  const abortRun = useRef<AbortController | null>(null);

  const specs = useMemo(() => new Map((catalog ?? []).map((spec) => [spec.type, spec])), [catalog]);

  useEffect(() => {
    if (!workflow || loadedId.current === workflow.id) return;
    loadedId.current = workflow.id;
    setName(workflow.name);
    setDescription(workflow.description);
    const rfNodes: VNode[] = workflow.graph.nodes.map((node) => {
      const spec = specs.get(node.type);
      return { id: node.id, type: 'vantara', position: node.position, data: { spec: spec ?? fallbackSpec(node.type), config: node.config ?? {} } };
    });
    const rfEdges: Edge[] = workflow.graph.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle ?? undefined, targetHandle: edge.targetHandle ?? undefined, type: 'smoothstep' }));
    setNodes(rfNodes);
    setEdges(rfEdges);
    setDirty(false);
    past.current = [];
    future.current = [];
    forceHistory((value) => value + 1);
  }, [workflow, specs, setNodes, setEdges]);

  useEffect(() => () => abortRun.current?.abort(), []);

  function snapshot() {
    past.current = [...past.current.slice(-49), { nodes, edges }];
    future.current = [];
    forceHistory((value) => value + 1);
  }

  function undo() {
    const previous = past.current.pop();
    if (!previous) return;
    future.current = [...future.current, { nodes, edges }];
    setNodes(previous.nodes);
    setEdges(previous.edges);
    setDirty(true);
    forceHistory((value) => value + 1);
  }

  function redo() {
    const next = future.current.pop();
    if (!next) return;
    past.current = [...past.current, { nodes, edges }];
    setNodes(next.nodes);
    setEdges(next.edges);
    setDirty(true);
    forceHistory((value) => value + 1);
  }

  const onConnect = useCallback((connection: Connection) => {
    snapshot();
    setEdges((current) => addEdge({ ...connection, type: 'smoothstep' }, current));
    setDirty(true);
  }, [setEdges, nodes, edges]);

  function addNode(spec: NodeSpec) {
    snapshot();
    const id = `${spec.type}-${Math.random().toString(36).slice(2, 7)}`;
    const config: Record<string, unknown> = {};
    for (const field of spec.config) config[field.key] = field.default;
    const newNode: VNode = {
      id, type: 'vantara',
      position: { x: 80 + (nodes.length % 3) * 270, y: 80 + Math.floor(nodes.length / 3) * 190 },
      data: { spec, config },
    };
    setNodes((current) => [...current, newNode]);
    setSelectedId(id);
    setDirty(true);
  }

  function updateConfig(nodeId: string, key: string, value: unknown) {
    setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, config: { ...node.data.config, [key]: value } } } : node));
    setDirty(true);
  }

  function removeNode(nodeId: string) {
    snapshot();
    setNodes((current) => current.filter((node) => node.id !== nodeId));
    setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    if (selectedId === nodeId) setSelectedId(null);
    setDirty(true);
  }

  function currentGraph(): WorkflowGraph {
    return {
      nodes: nodes.map((node) => ({ id: node.id, type: node.data.spec.type, position: node.position, config: node.data.config })),
      edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle ?? null, targetHandle: edge.targetHandle ?? null })),
    };
  }

  async function save(): Promise<boolean> {
    if (!workflowId) return false;
    setSaving(true);
    try {
      await api(`/workflows/${workflowId}`, { method: 'PUT', body: JSON.stringify({ name, description, graph: currentGraph() }) });
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
      toast.success('Workflow saved');
      return true;
    } catch (error) {
      toast.error('Save failed', errorMessage(error));
      return false;
    } finally { setSaving(false); }
  }

  async function validate() {
    try {
      const result = await api<{ valid: boolean; errors: string[]; warnings: string[] }>('/workflows/validate', { method: 'POST', body: JSON.stringify({ graph: currentGraph() }) });
      setValidation({ errors: result.errors, warnings: result.warnings });
      if (result.valid) toast.success('Graph is valid', result.warnings[0]);
    } catch (error) { toast.error('Validation failed', errorMessage(error)); }
  }

  async function runWorkflow() {
    if (running) return;
    if (dirty && !(await save())) return;
    setRunOpen(true);
    setRunStatus('running');
    setRunEvents([]);
    setRunError(null);
    setNodes((current) => current.map((node) => ({ ...node, data: { ...node.data, status: undefined } })));
    try {
      const response = await api<{ run_id: string }>(`/workflows/${workflowId}/run`, { method: 'POST', body: JSON.stringify({}) });
      setRunId(response.run_id);
      setRunning(true);
      const controller = new AbortController();
      abortRun.current = controller;
      await streamRunEvents(response.run_id, (event) => {
        setRunEvents((current) => [...current.slice(-300), event]);
        const type = String(event.type || '');
        const nodeId = event.node_id ? String(event.node_id) : null;
        if (type === 'node_started' && nodeId) setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, status: 'running' } } : node));
        if (type === 'node_completed' && nodeId) setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, status: 'completed' } } : node));
        if (type === 'node_skipped' && nodeId) setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, status: 'skipped' } } : node));
        if (type === 'run_failed') setRunError({ error: String(event.error || 'Run failed'), hint: event.hint ? String(event.hint) : undefined });
        if (type === 'run_cancelled') setRunStatus('cancelled');
        if (type === 'run_completed') setRunStatus('completed');
        if (type === 'stream_end') {
          setRunStatus(String(event.status || 'completed'));
          setRunning(false);
          void queryClient.invalidateQueries({ queryKey: ['workflow-runs'] });
          void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        }
      }, controller.signal);
    } catch (error) {
      setRunning(false);
      setRunStatus('failed');
      if (error instanceof ApiError) {
        const payload = error.payload as { errors?: string[]; warnings?: string[] } | undefined;
        setValidation({ errors: payload?.errors ?? [error.message], warnings: payload?.warnings ?? [] });
        setRunError({ error: error.message, hint: error.hint });
      } else {
        setRunError({ error: errorMessage(error) });
      }
    } finally {
      setRunning(false);
      abortRun.current = null;
    }
  }

  async function cancelRun() {
    if (!runId) return;
    try { await api(`/workflow-runs/${runId}/cancel`, { method: 'POST' }); } catch (error) { toast.error('Could not cancel run', errorMessage(error)); }
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify({ name, description, graph: currentGraph() }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`; anchor.click();
    URL.revokeObjectURL(url);
  }

  function importJson() {
    try {
      const parsed = JSON.parse(importText);
      const graph = parsed.graph ?? parsed;
      if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error('Expected nodes and edges arrays.');
      snapshot();
      const rfNodes: VNode[] = graph.nodes.map((node: { id: string; type: string; position: { x: number; y: number }; config?: Record<string, unknown> }) => ({
        id: node.id, type: 'vantara', position: node.position ?? { x: 0, y: 0 },
        data: { spec: specs.get(node.type) ?? fallbackSpec(node.type), config: node.config ?? {} },
      }));
      setNodes(rfNodes);
      setEdges(graph.edges.map((edge: Edge) => ({ ...edge, type: 'smoothstep' })));
      if (parsed.name) setName(parsed.name);
      setDirty(true);
      setImportOpen(false);
      setImportText('');
      toast.success('Graph imported', 'Validate before running.');
    } catch (error) { toast.error('Import failed', errorMessage(error)); }
  }

  const selectedNode = nodes.find((node) => node.id === selectedId) ?? null;
  const groupedSpecs = useMemo(() => {
    const groups = new Map<string, NodeSpec[]>();
    for (const spec of catalog ?? []) {
      if (!groups.has(spec.category)) groups.set(spec.category, []);
      groups.get(spec.category)!.push(spec);
    }
    return Array.from(groups.entries());
  }, [catalog]);
  const lastPreview = [...runEvents].reverse().find((event) => event.type === 'preview')?.preview as { kind?: string; text?: string; value?: unknown; label?: string } | undefined;

  function renderField(field: NodeSpec['config'][number]) {
    if (!selectedNode) return null;
    const value = selectedNode.data.config[field.key];
    const inputClass = 'text-xs';
    if (field.type === 'boolean') {
      return <Toggle key={field.key} checked={Boolean(value)} onChange={(next) => updateConfig(selectedNode.id, field.key, next)} label={field.label} description={field.help} />;
    }
    if (field.type === 'model') {
      return <Field key={field.key} label={field.label} help={field.help}><ModelPicker value={String(value || 'auto')} onChange={(next) => updateConfig(selectedNode.id, field.key, next)} /></Field>;
    }
    if (field.type === 'file') {
      return (
        <Field key={field.key} label={field.label} help={field.help || 'Upload a file in Chat or Knowledge first.'}>
          <Select className={inputClass} value={String(value || '')} onChange={(event) => updateConfig(selectedNode.id, field.key, event.target.value)}>
            <option value="">Select an uploaded file…</option>
            {(uploads ?? []).map((upload) => <option key={upload.stored_name} value={upload.stored_name}>{upload.name}</option>)}
          </Select>
        </Field>
      );
    }
    if (field.type === 'select') {
      return <Field key={field.key} label={field.label} help={field.help}><Select className={inputClass} value={String(value ?? field.default ?? '')} onChange={(event) => updateConfig(selectedNode.id, field.key, event.target.value)}>{field.options.map((option) => <option key={option} value={option}>{option}</option>)}</Select></Field>;
    }
    if (field.type === 'textarea') {
      return <Field key={field.key} label={field.label} help={field.help}><Textarea className="text-xs" rows={4} value={String(value ?? '')} onFocus={snapshot} onChange={(event) => updateConfig(selectedNode.id, field.key, event.target.value)} /></Field>;
    }
    if (field.type === 'number') {
      return <Field key={field.key} label={field.label} help={field.help}><Input className={inputClass} type="number" value={Number(value ?? 0)} onFocus={snapshot} onChange={(event) => updateConfig(selectedNode.id, field.key, event.target.value === '' ? '' : Number(event.target.value))} /></Field>;
    }
    return <Field key={field.key} label={field.label} help={field.help}><Input className={inputClass} value={String(value ?? '')} onFocus={snapshot} onChange={(event) => updateConfig(selectedNode.id, field.key, event.target.value)} /></Field>;
  }

  if (isLoading) return <div className="flex h-full items-center justify-center text-muted"><Spinner className="mr-2" /> Loading workflow…</div>;
  if (!workflow) return <div className="flex h-full items-center justify-center"><div className="text-center"><p className="text-sm text-ink-50">Workflow not found</p><Link to="/workflows" className="mt-2 inline-block text-xs text-accent-soft">Back to workflows</Link></div></div>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-lineSoft bg-ink-950/60 px-3">
        <Link to="/workflows" className="rounded-md p-2 text-muted hover:bg-raised hover:text-ink-50" title="Back to workflows"><ArrowLeft size={15} /></Link>
        <div className="min-w-0">
          <input value={name} onChange={(event) => { setName(event.target.value); setDirty(true); }} className="w-full max-w-[320px] truncate border-none bg-transparent text-[13px] font-semibold text-ink-50 focus:ring-0" aria-label="Workflow name" />
          <div className="flex items-center gap-1.5 text-[10px] text-faint"><span>{nodes.length} nodes</span><span>·</span><span>{edges.length} edges</span><span>·</span><span className={dirty ? 'text-warn' : 'text-success'}>{dirty ? 'unsaved changes' : 'saved'}</span></div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setImportOpen(true)} title="Import graph JSON"><Upload size={13} /></Button>
          <Button size="sm" variant="ghost" onClick={exportJson} title="Export graph JSON"><Download size={13} /></Button>
          <Button size="sm" variant="ghost" onClick={undo} disabled={!past.current.length} title="Undo"><Undo2 size={13} /></Button>
          <Button size="sm" variant="ghost" onClick={redo} disabled={!future.current.length} title="Redo"><Redo2 size={13} /></Button>
          <Button size="sm" onClick={() => void validate()}>Validate</Button>
          <Button size="sm" onClick={() => void save()} loading={saving} disabled={!dirty && !saving}><Save size={13} /> Save</Button>
          {running ? <Button size="sm" variant="danger" onClick={() => void cancelRun()}><Square size={12} /> Stop</Button> : <Button size="sm" variant="primary" onClick={() => void runWorkflow()}><Play size={13} /> Run</Button>}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className={cn('hidden w-[220px] shrink-0 flex-col overflow-y-auto border-r border-lineSoft bg-ink-950/40 md:flex')}>
          <div className="flex items-center justify-between border-b border-lineSoft px-3 py-2.5"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Nodes</p><button onClick={() => setPaletteOpen((value) => !value)} className="text-faint hover:text-ink-50"><Settings2 size={12} /></button></div>
          {paletteOpen && <div className="space-y-3 p-2">
            {groupedSpecs.map(([category, items]) => (
              <div key={category}>
                <p className="px-1.5 pb-1 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-faint">{category}</p>
                <div className="space-y-0.5">
                  {items.map((spec) => (
                    <button key={spec.type} onClick={() => addNode(spec)} title={spec.description} className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] text-muted hover:bg-raised hover:text-ink-50">
                      <Plus size={10} className="shrink-0 text-faint group-hover:text-accent-soft" /><span className="truncate">{spec.label}</span>
                      {spec.requires.length > 0 && <span className="ml-auto h-1 w-1 rounded-full bg-warn/60" title={`Requires ${spec.requires.join(', ')}`} />}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>}
          <div className="mt-auto border-t border-lineSoft p-3 text-[9.5px] leading-relaxed text-faint">Drag from a port to connect. Cycles are rejected. Press Delete to remove selected nodes.</div>
        </aside>

        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className={cn('min-h-0 flex-1', runOpen ? 'h-[58%]' : 'h-full')}>
            <ReactFlow
              nodes={nodes} edges={edges} nodeTypes={nodeTypes}
              onNodesChange={(changes) => { onNodesChange(changes); if (changes.some((change) => change.type === 'remove' || change.type === 'position')) setDirty(true); }}
              onEdgesChange={(changes) => { onEdgesChange(changes); if (changes.some((change) => change.type === 'remove')) { setDirty(true); snapshot(); } }}
              onConnect={onConnect}
              onNodeClick={(_, node) => setSelectedId(node.id)}
              onPaneClick={() => setSelectedId(null)}
              onNodesDelete={() => { setDirty(true); setSelectedId(null); }}
              fitView defaultViewport={{ x: 0, y: 0, zoom: 0.85 }} minZoom={0.2} maxZoom={1.8}
              deleteKeyCode={['Backspace', 'Delete']} proOptions={{ hideAttribution: true }}
              defaultEdgeOptions={{ type: 'smoothstep' }} connectionLineStyle={{ stroke: '#8b5cf6', strokeWidth: 1.5 }}
              className="bg-ink-950"
            >
              <Background color="#22222a" gap={22} size={1} />
              <Controls showInteractive={false} position="bottom-left" />
              <MiniMap position="bottom-right" pannable zoomable nodeColor={() => '#26262e'} maskColor="rgba(7,7,9,0.75)" />
            </ReactFlow>
            {nodes.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="pointer-events-auto max-w-sm rounded-xl border border-dashed border-line bg-surface/90 p-6 text-center shadow-panel">
                  <p className="text-sm font-medium text-ink-50">Empty canvas</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">Add a Text Input, Prompt Template, Local LLM, and Text Output to build your first executable pipeline.</p>
                  <Button size="sm" variant="primary" className="mt-3" onClick={() => { const specsToAdd = ['text_input', 'prompt_template', 'llm', 'text_output']; specsToAdd.forEach((type) => { const spec = specs.get(type); if (spec) addNode(spec); }); }}><Plus size={12} /> Add starter chain</Button>
                </div>
              </div>
            )}
          </div>

          {runOpen && (
            <div className="flex h-[42%] shrink-0 flex-col border-t border-lineSoft bg-ink-950/70">
              <div className="flex h-10 shrink-0 items-center gap-2 border-b border-lineSoft px-3">
                <Badge tone={runStatus === 'completed' ? 'success' : runStatus === 'failed' ? 'danger' : runStatus === 'cancelled' ? 'warn' : 'warn'} dot>{runStatus}</Badge>
                <span className="truncate font-mono text-[10px] text-faint">{runId ?? 'starting…'}</span>
                <div className="ml-auto flex items-center gap-1">
                  {running && <Button size="sm" variant="danger" onClick={() => void cancelRun()}><Square size={11} /> Stop</Button>}
                  <button onClick={() => setRunOpen(false)} className="rounded p-1.5 text-faint hover:bg-raised hover:text-ink-50" aria-label="Close run panel"><X size={14} /></button>
                </div>
              </div>
              {runError && <div className="border-b border-danger/20 bg-danger/5 px-3 py-2 text-[11px] text-danger"><p>{runError.error}</p>{runError.hint && <p className="mt-0.5 text-muted">{runError.hint}</p>}</div>}
              <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
                <div className="min-h-0 overflow-y-auto border-lineSoft p-3 font-mono text-[10.5px] leading-relaxed md:border-r">
                  {runEvents.length === 0 && <p className="text-faint">Waiting for execution events…</p>}
                  {runEvents.map((event, index) => (
                    <div key={index} className="flex gap-2 py-0.5">
                      <span className="w-[86px] shrink-0 text-faint">{String(event.type).replace(/_/g, ' ')}</span>
                      <span className={cn('min-w-0 break-words', event.type === 'run_failed' ? 'text-danger' : event.type === 'node_delta' ? 'text-muted' : 'text-ink-50/80')}>{describeEvent(event, nodes)}</span>
                    </div>
                  ))}
                </div>
                <div className="min-h-0 overflow-y-auto p-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Output preview</p>
                  {lastPreview?.kind === 'text' && lastPreview.text && <pre className="whitespace-pre-wrap rounded-lg border border-line bg-surface p-3 text-[11.5px] leading-relaxed text-ink-50/90">{lastPreview.text}</pre>}
                  {lastPreview?.kind === 'image' && <p className="text-[11px] text-muted">Image written to local outputs. Open Runs & History to inspect it.</p>}
                  {lastPreview?.kind === 'json' && <pre className="overflow-x-auto rounded-lg border border-line bg-surface p-3 text-[10.5px] text-ink-50/80">{JSON.stringify(lastPreview.value, null, 2)}</pre>}
                  {!lastPreview && <p className="text-[11px] text-faint">Node outputs and text previews appear here while the graph executes.</p>}
                </div>
              </div>
            </div>
          )}
        </div>

        <aside className="hidden w-[288px] shrink-0 flex-col overflow-y-auto border-l border-lineSoft bg-ink-950/40 lg:flex">
          {selectedNode ? (
            <div className="p-3">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div><p className="text-[12px] font-semibold text-ink-50">{selectedNode.data.spec.label}</p><p className="mt-0.5 text-[10px] leading-relaxed text-faint">{selectedNode.data.spec.description}</p></div>
                <button onClick={() => removeNode(selectedNode.id)} className="rounded p-1.5 text-faint hover:bg-raised hover:text-danger" title="Delete node"><Trash2 size={13} /></button>
              </div>
              <div className="mb-3 flex flex-wrap gap-1"><Badge tone="neutral">{selectedNode.data.spec.type}</Badge><Badge tone={nodeStatusTone(selectedNode.data.status)}>{selectedNode.data.status ?? 'idle'}</Badge></div>
              {selectedNode.data.spec.requires.length > 0 && <div className="mb-3 flex items-start gap-2 rounded-lg border border-warn/20 bg-warn/5 p-2.5 text-[10.5px] leading-relaxed text-warn"><ShieldAlert size={13} className="mt-0.5 shrink-0" /> Requires {selectedNode.data.spec.requires.join(' or ')}.</div>}
              <div className="space-y-3">{(selectedNode.data.spec.config ?? []).map((field) => renderField(field))}</div>
              {selectedNode.data.spec.config.length === 0 && <p className="text-[11px] text-faint">This node has no configuration.</p>}
              <div className="mt-4 border-t border-lineSoft pt-3 text-[10px] text-faint">Ports: {selectedNode.data.spec.inputs.map((port) => port.name).join(', ') || 'none'} → {selectedNode.data.spec.outputs.map((port) => port.name).join(', ') || 'none'}</div>
            </div>
          ) : (
            <div className="space-y-4 p-4">
              <div><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Workflow</p><Textarea className="mt-2 text-xs" rows={3} value={description} onChange={(event) => { setDescription(event.target.value); setDirty(true); }} placeholder="Describe what this workflow does…" /></div>
              <div className="grid grid-cols-2 gap-2"><div className="panel-soft p-3"><p className="text-lg font-semibold text-ink-50">{nodes.length}</p><p className="text-[10px] text-muted">nodes</p></div><div className="panel-soft p-3"><p className="text-lg font-semibold text-ink-50">{edges.length}</p><p className="text-[10px] text-muted">edges</p></div></div>
              <div className="rounded-lg border border-lineSoft bg-ink-950/50 p-3 text-[10.5px] leading-relaxed text-muted">
                <p className="mb-1 font-medium text-ink-50">Execution rules</p>
                <p>• Graphs must be acyclic.</p><p>• Required ports must be connected.</p><p>• Branches skip inactive downstream nodes.</p><p>• Models run locally unless a remote model is explicitly selected.</p>
              </div>
              <Button variant="primary" className="w-full" onClick={() => void validate()}><CheckCircle2 size={13} /> Validate graph</Button>
            </div>
          )}
        </aside>
      </div>

      <Modal open={Boolean(validation)} onClose={() => setValidation(null)} title={validation?.errors.length ? 'Validation issues' : 'Graph is valid'} description={validation?.errors.length ? 'Fix these before running.' : 'The executor accepted this graph.'} footer={<Button onClick={() => setValidation(null)}>Close</Button>}>
        {validation?.errors.map((error) => <div key={error} className="mb-1.5 flex gap-2 rounded-md border border-danger/20 bg-danger/5 px-2.5 py-1.5 text-[11px] text-danger"><ShieldAlert size={12} className="mt-0.5 shrink-0" />{error}</div>)}
        {validation?.warnings.map((warning) => <div key={warning} className="mb-1.5 flex gap-2 rounded-md border border-warn/20 bg-warn/5 px-2.5 py-1.5 text-[11px] text-warn"><ShieldAlert size={12} className="mt-0.5 shrink-0" />{warning}</div>)}
        {!validation?.errors.length && !validation?.warnings.length && <p className="text-xs text-success">No errors or warnings.</p>}
      </Modal>

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import graph JSON" description="Paste a VANTARA workflow graph. Imported node types must exist in this build." footer={<><Button variant="ghost" onClick={() => setImportOpen(false)}>Cancel</Button><Button variant="primary" onClick={importJson}>Import</Button></>}>
        <Textarea rows={12} className="font-mono text-[11px]" value={importText} onChange={(event) => setImportText(event.target.value)} placeholder='{ "nodes": [], "edges": [] }' />
      </Modal>

    </div>
  );
}

function fallbackSpec(type: string): NodeSpec {
  return { type, label: type, category: 'Unknown', description: 'This node type is not available in this build.', inputs: [], outputs: [], config: [], requires: [], disabled: true };
}

function describeEvent(event: Record<string, unknown>, nodes: VNode[]): string {
  const type = String(event.type || '');
  const node = event.node_id ? nodes.find((item) => item.id === event.node_id) : undefined;
  if (type === 'node_delta') return String(event.content || '').slice(-120);
  if (type === 'node_started') return `${node?.data.spec.label ?? event.node_id} started`;
  if (type === 'node_completed') return `${node?.data.spec.label ?? event.node_id} completed in ${event.duration_ms ?? '?'}ms`;
  if (type === 'node_skipped') return `${node?.data.spec.label ?? event.node_id}: ${event.reason ?? 'skipped'}`;
  if (type === 'run_started') return `Run started · ${event.workflow ?? ''}`;
  if (type === 'run_completed') return `Completed in ${event.duration_ms ?? '?'}ms`;
  if (type === 'run_failed') return String(event.error || 'Run failed');
  if (type === 'run_cancelled') return 'Run cancelled';
  if (type === 'plan') return `Execution order: ${(event.order as string[] | undefined)?.join(' → ') ?? '—'}`;
  if (type === 'preview') return `Preview: ${(event.preview as { kind?: string } | undefined)?.kind ?? 'value'}`;
  if (type === 'stream_end') return `Stream ended · ${event.status}`;
  return '';
}
