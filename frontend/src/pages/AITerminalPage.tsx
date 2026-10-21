import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle2, Code2, Eye,
  FileCode2, FileText, FolderGit2, Gamepad2, Layers, Loader2, Play,
  Plus, RefreshCw, RotateCcw, Save, ShieldCheck, Square, Terminal, Globe2,
  TerminalSquare, Trash2, Wand2, Zap,
} from 'lucide-react';
import { api, ApiError, errorMessage, streamSSE } from '../lib/api';
import type {
  Checkpoint, CommandResult, Project, ProjectDiff, ProjectMemory, ProjectTask,
} from '../lib/types';
import { ModelPicker } from '../components/ModelPicker';
import { Markdown } from '../components/Markdown';
import {
  Badge, Button, EmptyState, Modal, Select, Skeleton, Spinner, Textarea, cn,
} from '../components/ui';
import { bytes, relativeTime, statusTone } from '../lib/format';
import { toast } from '../lib/store';

const MODE_OPTIONS = [
  { value: 'build', label: 'Build / edit file' },
  { value: 'agent', label: 'Agent · multi-file tools' },
  { value: 'repair', label: 'Repair errors' },
  { value: 'explain', label: 'Explain code' },
];

type TerminalEvent = Record<string, unknown>;
type WorkspaceTab = 'files' | 'preview' | 'diff' | 'memory' | 'history';

const KIND_ICON: Record<string, typeof Gamepad2> = { static: Code2, game: Gamepad2, python: FileCode2, node: Layers, blank: FolderGit2 };

function text(value: unknown): string { return value === null || value === undefined ? '' : String(value); }


export function AITerminalPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const requestedProject = params.get('project');
  const [selectedId, setSelectedId] = useState<string | null>(requestedProject);
  const [events, setEvents] = useState<TerminalEvent[]>([]);
  const [plan, setPlan] = useState<Array<{ role: string; label: string }>>([]);
  const [streamBuffer, setStreamBuffer] = useState('');
  const [input, setInput] = useState('');
  const [mode, setMode] = useState('build');
  const [model, setModel] = useState('auto');
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState('');
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('preview');
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [fileOpen, setFileOpen] = useState(false);
  const [filePath, setFilePath] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const [fileSaving, setFileSaving] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState('');
  const [memoryKind, setMemoryKind] = useState('note');
  const [memorySaving, setMemorySaving] = useState(false);
  const [taskDetail, setTaskDetail] = useState<ProjectTask | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const autoStarted = useRef(false);

  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ['projects'], queryFn: () => api<{ projects: Project[] }>('/projects'),
    select: (data) => data.projects, refetchInterval: 20_000,
  });

  useEffect(() => {
    if (!selectedId && projects.length) setSelectedId(projects[0].id);
  }, [projects, selectedId]);

  const { data: project, isLoading: projectLoading } = useQuery({
    queryKey: ['project', selectedId], queryFn: () => api<Project>(`/projects/${selectedId}`),
    enabled: Boolean(selectedId), refetchInterval: running ? false : 20_000,
  });
  const { data: diff } = useQuery({
    queryKey: ['project-diff', selectedId], queryFn: () => api<ProjectDiff>(`/projects/${selectedId}/diff`),
    enabled: Boolean(selectedId) && workspaceTab === 'diff',
  });
  const { data: memory = [] } = useQuery({
    queryKey: ['project-memory', selectedId], queryFn: () => api<{ memory: ProjectMemory[] }>(`/projects/${selectedId}/memory`),
    enabled: Boolean(selectedId), select: (data) => data.memory,
  });
  const { data: tasks = [] } = useQuery({
    queryKey: ['project-tasks', selectedId], queryFn: () => api<{ tasks: ProjectTask[] }>(`/projects/${selectedId}/tasks`),
    enabled: Boolean(selectedId), select: (data) => data.tasks, refetchInterval: running ? false : 15_000,
  });
  const { data: checkpoints = [] } = useQuery({
    queryKey: ['project-checkpoints', selectedId], queryFn: () => api<{ checkpoints: Checkpoint[] }>(`/projects/${selectedId}/checkpoints`),
    enabled: Boolean(selectedId), select: (data) => data.checkpoints, refetchInterval: running ? false : 20_000,
  });

  useEffect(() => {
    if (!selectedId && requestedProject) setSelectedId(requestedProject);
  }, [requestedProject, selectedId]);

  useEffect(() => {
    setEvents([]); setPlan([]); setStreamBuffer(''); setStage(''); setTaskDetail(null);
  }, [selectedId]);

  useEffect(() => {
    terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight, behavior: running ? 'auto' : 'smooth' });
  }, [events, streamBuffer, running]);

  useEffect(() => () => abortRef.current?.abort(), []);

  function refreshWorkspace() {
    void queryClient.invalidateQueries({ queryKey: ['project', selectedId] });
    void queryClient.invalidateQueries({ queryKey: ['project-tasks', selectedId] });
    void queryClient.invalidateQueries({ queryKey: ['project-diff', selectedId] });
    void queryClient.invalidateQueries({ queryKey: ['project-checkpoints', selectedId] });
    void queryClient.invalidateQueries({ queryKey: ['project-memory', selectedId] });
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
    setPreviewKey((value) => value + 1);
  }

  async function runTask(promptText?: string) {
    const prompt = (promptText ?? input).trim();
    if (!prompt || !selectedId || running) return;
    setInput('');
    setRunning(true);
    setPlan([]);
    setStreamBuffer('');
    setStage('Starting…');
    setEvents((current) => [...current, { type: 'user_prompt', prompt, ts: new Date().toISOString() }]);
    const controller = new AbortController();
    abortRef.current = controller;
    let finished = false;
    try {
      await streamSSE(`/projects/${selectedId}/code/stream`, {
        prompt, model_id: model, mode, max_steps: 8,
      }, (event) => {
        const type = text(event.type);
        if (type === 'delta') {
          setStreamBuffer((current) => (current + text(event.content)).slice(-24000));
          return;
        }
        if (type === 'meta') {
          const metaPlan = Array.isArray(event.plan) ? event.plan as Array<{ role: string; label: string }> : [];
          setPlan(metaPlan);
          setStage('Understanding your idea');
        }
        if (type === 'status') setStage(text(event.stage) || text(event.message));
        if (type === 'done') { finished = true; setStage('Ready'); refreshWorkspace(); }
        if (type === 'error') setStage('Needs attention');
        setEvents((current) => [...current.slice(-250), event]);
      }, controller.signal);
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') {
        const message = errorMessage(error);
        setEvents((current) => [...current, { type: 'error', error: message, hint: error instanceof ApiError ? error.hint : undefined }]);
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
      if (finished) refreshWorkspace();
    }
  }

  async function runShell(raw: string) {
    const command = raw.replace(/^\$\s*/, '').replace(/^\/run\s+/, '').trim();
    if (!command || !selectedId) return;
    setInput('');
    setEvents((current) => [...current, { type: 'shell', command, ts: new Date().toISOString() }]);
    try {
      const result = await api<CommandResult>(`/projects/${selectedId}/commands`, {
        method: 'POST', body: JSON.stringify({ command, approved: true }),
      });
      setEvents((current) => [...current, { type: 'command_result', ...result }]);
      refreshWorkspace();
    } catch (error) {
      setEvents((current) => [...current, { type: 'error', error: errorMessage(error), hint: error instanceof ApiError ? error.hint : undefined }]);
    }
  }

  function submit() {
    const value = input.trim();
    if (!value) return;
    if (value.startsWith('$') || value.startsWith('/run ')) void runShell(value);
    else void runTask(value);
  }

  function stop() {
    abortRef.current?.abort();
    setRunning(false);
    setStage('Stopped');
  }

  useEffect(() => {
    const prompt = params.get('prompt');
    const autorun = params.get('autorun');
    if (!project || !selectedId || !prompt || !autorun || autoStarted.current) return;
    autoStarted.current = true;
    navigate(`/terminal?project=${selectedId}`, { replace: true });
    void runTask(prompt);
  }, [project, selectedId, params, navigate]);

  async function openFile(path: string) {
    if (!selectedId) return;
    setFilePath(path); setFileOpen(true); setFileLoading(true);
    try {
      const data = await api<{ content: string }>(`/projects/${selectedId}/file?path=${encodeURIComponent(path)}`);
      setFileContent(data.content);
    } catch (error) { toast.error('Could not open file', errorMessage(error)); setFileOpen(false); }
    finally { setFileLoading(false); }
  }

  async function saveFile() {
    if (!selectedId || !filePath) return;
    setFileSaving(true);
    try {
      await api(`/projects/${selectedId}/file`, { method: 'PUT', body: JSON.stringify({ path: filePath, content: fileContent, checkpoint: true }) });
      toast.success('File saved', 'A checkpoint was created first');
      setFileOpen(false); refreshWorkspace();
    } catch (error) { toast.error('Save failed', errorMessage(error)); }
    finally { setFileSaving(false); }
  }

  async function addMemory() {
    if (!selectedId || !memoryDraft.trim()) return;
    setMemorySaving(true);
    try {
      await api(`/projects/${selectedId}/memory`, { method: 'POST', body: JSON.stringify({ kind: memoryKind, content: memoryDraft.trim(), verified: true }) });
      setMemoryDraft('');
      void queryClient.invalidateQueries({ queryKey: ['project-memory', selectedId] });
      toast.success('Project memory saved');
    } catch (error) { toast.error('Could not save memory', errorMessage(error)); }
    finally { setMemorySaving(false); }
  }

  async function removeMemory(id: string) {
    if (!selectedId) return;
    try { await api(`/projects/${selectedId}/memory/${id}`, { method: 'DELETE' }); void queryClient.invalidateQueries({ queryKey: ['project-memory', selectedId] }); }
    catch (error) { toast.error('Could not delete memory', errorMessage(error)); }
  }

  async function restoreCheckpoint(checkpoint: Checkpoint) {
    if (!selectedId) return;
    if (!window.confirm(`Restore “${checkpoint.label}”? A safety checkpoint will be created first.`)) return;
    try {
      await api(`/projects/${selectedId}/checkpoints/${checkpoint.id}/restore`, { method: 'POST' });
      toast.success('Checkpoint restored');
      setEvents((current) => [...current, { type: 'notice', notice: `Restored checkpoint: ${checkpoint.label}` }]);
      refreshWorkspace();
    } catch (error) { toast.error('Restore failed', errorMessage(error)); }
  }

  const ProjectKindIcon = project ? (KIND_ICON[project.kind] ?? FolderGit2) : TerminalSquare;

  function renderWorkspace() {
    if (!project) return <div className="p-4 text-xs text-muted">Select a project.</div>;
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-lineSoft px-2 py-2">
          {([['files', 'Files'], ['preview', 'Preview'], ['diff', 'Diff'], ['memory', 'Memory'], ['history', 'History']] as Array<[WorkspaceTab, string]>).map(([value, label]) => (
            <button key={value} onClick={() => setWorkspaceTab(value)} className={cn('rounded-md px-2.5 py-1.5 text-[10.5px] font-medium transition-colors', workspaceTab === value ? 'bg-raised text-ink-50' : 'text-muted hover:text-ink-50')}>{label}</button>
          ))}
          <button onClick={refreshWorkspace} className="ml-auto rounded-md p-1.5 text-faint hover:bg-raised hover:text-ink-50" title="Refresh"><RefreshCw size={11} /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {workspaceTab === 'files' && (
            <div className="p-2">
              <div className="mb-2 flex items-center justify-between px-1"><p className="text-[10px] uppercase tracking-[0.1em] text-faint">Workspace files</p><span className="text-[9px] text-faint">{project.files?.length ?? 0}</span></div>
              <div className="space-y-0.5">{(project.files ?? []).map((file) => (
                <button key={file.path} onClick={() => void openFile(file.path)} className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-raised/70">
                  {file.path.endsWith('.html') ? <Globe2 size={11} className="shrink-0 text-success" /> : file.path.endsWith('.js') || file.path.endsWith('.py') ? <FileCode2 size={11} className="shrink-0 text-electric" /> : <FileText size={11} className="shrink-0 text-muted" />}
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink-50/85">{file.path}</span>
                  <span className="text-[8.5px] text-faint">{bytes(file.size)}</span>
                </button>
              ))}</div>
              {!project.files?.length && <p className="p-3 text-[11px] text-faint">No files yet. Ask the AI to create one.</p>}
              <div className="mt-3 border-t border-lineSoft pt-3">
                <p className="px-1 text-[10px] uppercase tracking-[0.1em] text-faint">Project</p>
                <div className="mt-2 rounded-lg border border-lineSoft bg-ink-950/40 p-2.5 text-[10px] leading-relaxed text-muted"><p className="truncate font-mono text-[9px] text-faint">{project.path}</p><p className="mt-1">Created {relativeTime(project.created_at)}</p><p>{project.task_count} AI task(s) · {memory.length} memory item(s)</p></div>
              </div>
            </div>
          )}

          {workspaceTab === 'preview' && (
            <div className="flex h-full min-h-[320px] flex-col">
              <div className="flex items-center justify-between gap-2 border-b border-lineSoft px-3 py-2"><div className="flex items-center gap-1.5"><Eye size={12} className="text-success" /><span className="text-[10px] font-medium text-ink-50">Live preview</span><Badge tone="neutral">sandboxed</Badge></div><button onClick={() => setPreviewKey((value) => value + 1)} className="rounded p-1 text-faint hover:text-ink-50" title="Reload preview"><RefreshCw size={11} /></button></div>
              {project.preview_entry ? (
                <iframe
                  key={previewKey}
                  title={`${project.name} preview`}
                  src={`/api/projects/${project.id}/preview/?v=${previewKey}`}
                  sandbox="allow-scripts"
                  referrerPolicy="no-referrer"
                  className="min-h-[360px] w-full flex-1 bg-white"
                />
              ) : (
                <EmptyState className="m-3 flex-1" icon={<Eye size={18} />} title="No web preview for this project" description="Python and Node projects are validated with commands. Open files and the activity log to inspect results." />
              )}
              <p className="border-t border-lineSoft px-3 py-2 text-[9px] leading-relaxed text-faint">Preview runs in a sandboxed iframe. It cannot call the VANTARA API, read cookies, or access local storage.</p>
            </div>
          )}

          {workspaceTab === 'diff' && (
            <div className="p-3">
              <div className="mb-2 flex flex-wrap items-center gap-1.5"><Badge tone="success">+{diff?.summary.added ?? 0}</Badge><Badge tone="danger">-{diff?.summary.removed ?? 0}</Badge><Badge tone="warn">~{diff?.summary.changed ?? 0}</Badge><span className="ml-auto text-[9px] text-faint">{diff?.checkpoint ? `vs ${relativeTime(diff.checkpoint.created_at)}` : 'no checkpoint'}</span></div>
              {!diff || diff.files.length === 0 ? <p className="rounded-lg border border-dashed border-line p-4 text-center text-[11px] text-faint">No changes since the last checkpoint.</p> : (
                <div className="space-y-2">{diff.files.map((file) => (
                  <details key={file.path} open className="overflow-hidden rounded-lg border border-lineSoft bg-ink-950/40">
                    <summary className="flex cursor-pointer items-center gap-2 px-2.5 py-2 text-[10px] text-ink-50"><span className={file.status === 'added' ? 'text-success' : file.status === 'removed' ? 'text-danger' : 'text-warn'}>{file.status}</span><span className="truncate font-mono">{file.path}</span></summary>
                    <pre className="max-h-64 overflow-auto border-t border-lineSoft p-2 text-[9px] leading-relaxed">{file.diff.split('\n').map((line, index) => <span key={index} className={line.startsWith('+') && !line.startsWith('+++') ? 'block text-success' : line.startsWith('-') && !line.startsWith('---') ? 'block text-danger' : line.startsWith('@@') ? 'block text-accent-soft' : 'block text-muted'}>{line || ' '}{"\n"}</span>)}</pre>
                  </details>
                ))}</div>
              )}
            </div>
          )}

          {workspaceTab === 'memory' && (
            <div className="p-3">
              <div className="rounded-lg border border-lineSoft bg-ink-950/40 p-2.5">
                <p className="text-[10px] font-medium text-ink-50">Add project memory</p>
                <p className="mt-0.5 text-[9px] leading-relaxed text-faint">Requirements and decisions are included in future AI context. Memory is editable and deletable.</p>
                <Textarea rows={2} className="mt-2 text-[11px]" value={memoryDraft} onChange={(event) => setMemoryDraft(event.target.value)} placeholder="e.g. Keep the design dark; use no external dependencies" />
                <div className="mt-2 flex gap-1.5"><Select value={memoryKind} onChange={(event) => setMemoryKind(event.target.value)} className="h-8 flex-1 py-1 text-[10px]"><option value="note">Note</option><option value="requirement">Requirement</option><option value="decision">Decision</option><option value="fix">Verified fix</option><option value="preference">Preference</option></Select><Button size="sm" onClick={() => void addMemory()} loading={memorySaving} disabled={!memoryDraft.trim()}><Plus size={11} /> Add</Button></div>
              </div>
              <div className="mt-3 space-y-1.5">
                {memory.length === 0 && <p className="py-4 text-center text-[10px] text-faint">No project memory yet.</p>}
                {memory.map((item) => (
                  <div key={item.id} className="rounded-lg border border-lineSoft bg-ink-950/40 p-2.5">
                    <div className="flex items-center gap-1.5"><Badge tone={item.verified ? 'success' : 'warn'}>{item.kind}</Badge>{item.verified && <CheckCircle2 size={10} className="text-success" />}<span className="ml-auto text-[8.5px] text-faint">{relativeTime(item.created_at)}</span><button onClick={() => void removeMemory(item.id)} className="rounded p-0.5 text-faint hover:text-danger"><Trash2 size={10} /></button></div>
                    <p className="mt-1.5 whitespace-pre-wrap text-[10px] leading-relaxed text-muted">{item.content}</p>
                    {item.source && <p className="mt-1 truncate text-[8.5px] text-faint">source: {item.source}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {workspaceTab === 'history' && (
            <div className="p-3">
              <p className="mb-2 text-[10px] uppercase tracking-[0.1em] text-faint">AI tasks</p>
              <div className="space-y-1.5">{tasks.length === 0 && <p className="text-[10px] text-faint">No tasks yet.</p>}{tasks.map((task) => (
                <button key={task.id} onClick={() => setTaskDetail(task)} className="w-full rounded-lg border border-lineSoft bg-ink-950/40 p-2.5 text-left hover:bg-raised/50">
                  <div className="flex items-center gap-1.5"><Badge tone={statusTone(task.status)}>{task.status}</Badge><span className="text-[8.5px] text-faint">{relativeTime(task.started_at)}</span><span className="ml-auto text-[8.5px] text-faint">{task.kind}</span></div>
                  <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-muted">{task.prompt}</p>
                  {task.error && <p className="mt-1 line-clamp-2 text-[9px] text-danger">{task.error}</p>}
                </button>
              ))}</div>
              <div className="mt-4 border-t border-lineSoft pt-3">
                <p className="mb-2 text-[10px] uppercase tracking-[0.1em] text-faint">Checkpoints</p>
                <div className="space-y-1">{checkpoints.length === 0 && <p className="text-[10px] text-faint">No checkpoints.</p>}{checkpoints.map((checkpoint) => (
                  <div key={checkpoint.id} className="flex items-center gap-2 rounded-md border border-lineSoft bg-ink-950/40 px-2 py-1.5"><div className="min-w-0 flex-1"><p className="truncate text-[9.5px] text-ink-50">{checkpoint.label}</p><p className="text-[8px] text-faint">{checkpoint.file_count} files · {relativeTime(checkpoint.created_at)}</p></div><button onClick={() => void restoreCheckpoint(checkpoint)} className="rounded p-1 text-faint hover:text-warn" title="Restore checkpoint"><RotateCcw size={10} /></button></div>
                ))}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-ink">
      <aside className="hidden w-[224px] shrink-0 flex-col border-r border-lineSoft bg-ink-950/50 lg:flex">
        <div className="border-b border-lineSoft p-3">
          <Link to="/create"><Button variant="primary" className="w-full justify-start"><Plus size={14} /> New project</Button></Link>
          <p className="mt-3 text-[9px] font-semibold uppercase tracking-[0.14em] text-faint">Projects</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {projectsLoading ? <Skeleton className="h-24" /> : projects.length === 0 ? <p className="p-2 text-[10px] text-faint">No projects. Create one to begin.</p> : projects.map((item) => {
            const Icon = KIND_ICON[item.kind] ?? FolderGit2;
            return (
              <button key={item.id} onClick={() => { setSelectedId(item.id); navigate(`/terminal?project=${item.id}`); }} className={cn('mb-1 flex w-full items-start gap-2 rounded-lg p-2 text-left transition-colors', selectedId === item.id ? 'bg-accent/10 ring-1 ring-inset ring-accent/20' : 'hover:bg-raised/60')}>
                <span className="mt-0.5 rounded-md border border-line bg-raised p-1.5 text-accent-soft"><Icon size={11} /></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-medium text-ink-50">{item.name}</span><span className="mt-0.5 block truncate text-[9px] text-faint">{item.kind_label} · {item.task_count} task(s)</span></span>
              </button>
            );
          })}
        </div>
        <div className="border-t border-lineSoft p-3 text-[9px] leading-relaxed text-faint"><p className="flex items-center gap-1 text-muted"><ShieldCheck size={10} className="text-success" /> Sandboxed workspace</p><p className="mt-1">Files stay under data/projects. Commands use a strict allowlist.</p></div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-lineSoft px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            {project ? <span className="rounded-lg border border-line bg-raised p-2 text-accent-soft"><ProjectKindIcon size={15} /></span> : null}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5"><h1 className="truncate text-[13px] font-semibold text-ink-50">{project?.name ?? 'AI Terminal'}</h1>{project && <Badge tone="neutral">{project.kind_label}</Badge>}{running && <Badge tone="warn" dot>working</Badge>}</div>
              <p className="truncate text-[9.5px] text-faint">{stage || (project ? `${project.files?.length ?? 0} files · ${project.task_count} AI task(s)` : 'Select or create a project')}</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <div className="hidden w-[190px] sm:block"><ModelPicker value={model} onChange={setModel} compact /></div>
            <div className="hidden w-[150px] md:block"><Select value={mode} onChange={(event) => setMode(event.target.value)} className="h-8 py-1 text-[10px]" aria-label="AI mode">{MODE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></div>
            <Button size="sm" variant="ghost" className="xl:hidden" onClick={() => setWorkspaceOpen(true)}><Layers size={13} /><span className="hidden sm:inline">Workspace</span></Button>
          </div>
        </div>

        {!project && !projectLoading ? (
          <div className="flex flex-1 items-center justify-center p-6"><EmptyState icon={<Wand2 size={22} />} title="No project selected" description="Create a project in Creator Studio, then return here to build with a local model." action={<Link to="/create"><Button variant="primary"><Plus size={13} /> Open Creator Studio</Button></Link>} /></div>
        ) : (
          <>
            <div ref={terminalRef} className="min-h-0 flex-1 overflow-y-auto bg-[#08080b] px-3 py-4 font-mono text-[11px] leading-relaxed sm:px-5">
              <div className="mx-auto max-w-3xl space-y-2.5">
                {events.length === 0 && !running && (
                  <div className="py-10 text-center">
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-accent/25 bg-accent/10"><Terminal size={19} className="text-accent-soft" /></div>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-accent-soft/80">VANTARA AI TERMINAL</p>
                    <h2 className="mt-2 font-sans text-xl font-semibold tracking-tight text-ink-50">Describe it. Build it. Verify it.</h2>
                    <p className="mx-auto mt-2 max-w-md font-sans text-[11.5px] leading-relaxed text-muted">Ask for a feature, fix, or explanation. Use <code className="rounded bg-raised px-1 text-accent-soft">$ ls</code> for allowlisted shell commands. Every AI file change is checkpointed and diffable.</p>
                    <div className="mx-auto mt-4 grid max-w-lg gap-1 5 text-left font-sans text-[10.5px] sm:grid-cols-2">
                      {['Add a hero section with a call to action', 'Make the movement feel heavier', 'Add a score counter and enemies', 'Explain how this project works'].map((suggestion) => <button key={suggestion} onClick={() => setInput(suggestion)} className="rounded-lg border border-line bg-panel/60 px-3 py-2 text-left text-muted hover:border-accent/30 hover:text-ink-50">{suggestion}</button>)}
                    </div>
                  </div>
                )}

                {plan.length > 0 && (
                  <div className="rounded-lg border border-lineSoft bg-panel/40 p-2.5 font-sans">
                    <p className="mb-1.5 text-[9px] uppercase tracking-[0.12em] text-faint">AI team · sequential</p>
                    <div className="flex flex-wrap gap-1">{plan.map((step, index) => <span key={`${step.role}-${index}`} className="rounded border border-line bg-ink-950/50 px-1.5 py-0.5 text-[9px] text-muted"><span className="text-accent-soft">{step.role}</span> · {step.label}</span>)}</div>
                  </div>
                )}

                {events.map((event, index) => <EventLine key={`${text(event.ts)}-${index}`} event={event} />)}

                {streamBuffer && (
                  <details className="rounded-lg border border-lineSoft bg-panel/30" open={running}>
                    <summary className="cursor-pointer px-2.5 py-1.5 text-[9px] uppercase tracking-[0.1em] text-faint">Raw model output · {streamBuffer.length} chars</summary>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t border-lineSoft p-2 text-[10px] leading-relaxed text-muted">{streamBuffer.slice(-8000)}</pre>
                  </details>
                )}

                {running && <div className="flex items-center gap-2 py-1 text-[10px] text-warn"><Loader2 size={12} className="animate-spin" /> {stage || 'Working…'}<span className="ml-2 h-3 w-1.5 animate-caret bg-warn" /></div>}
              </div>
            </div>

            <div className="shrink-0 border-t border-lineSoft bg-ink-950/70 p-3">
              <div className="mx-auto max-w-3xl">
                <div className="rounded-xl border border-line bg-surface p-2 focus-within:border-accent/40">
                  <div className="flex items-center gap-1.5 border-b border-lineSoft px-1 pb-1.5 text-[9px] text-faint">
                    <span className="flex items-center gap-1"><Terminal size={9} /> {mode}</span><span>·</span><span>{model === 'auto' ? 'auto-selected local model' : model.split('::').pop()}</span>
                    <button onClick={() => setWorkspaceTab('preview')} className="ml-auto inline-flex items-center gap-1 hover:text-ink-50"><Eye size={9} /> preview</button>
                    <button onClick={() => setWorkspaceTab('diff')} className="inline-flex items-center gap-1 hover:text-ink-50"><Code2 size={9} /> diff</button>
                  </div>
                  <textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); } }}
                    rows={2}
                    placeholder="Describe what to build or change…  ·  $ ls for a command  ·  /run npm test"
                    className="max-h-40 min-h-[48px] w-full resize-none bg-transparent px-1.5 py-2 font-mono text-[11.5px] leading-6 text-ink-50 placeholder:text-faint"
                    aria-label="AI Terminal input"
                  />
                  <div className="flex items-center gap-1.5 px-1 pt-1">
                    <div className="sm:hidden"><ModelPicker value={model} onChange={setModel} compact /></div>
                    <div className="md:hidden"><Select value={mode} onChange={(event) => setMode(event.target.value)} className="h-8 py-1 text-[10px]">{MODE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></div>
                    <span className="hidden items-center gap-1 text-[9px] text-faint sm:flex"><ShieldCheck size={10} className="text-success" /> checkpoint before every AI task</span>
                    <div className="ml-auto flex items-center gap-1.5">
                      {running ? <Button size="sm" variant="danger" onClick={stop}><Square size={11} /> Stop</Button> : <Button size="sm" variant="primary" onClick={submit} disabled={!input.trim()}><Play size={11} /> Run</Button>}
                    </div>
                  </div>
                </div>
                <p className="mt-1.5 px-1 text-[9px] text-faint">Enter to run · Shift+Enter newline · commands run only if allowlisted</p>
              </div>
            </div>
          </>
        )}
      </section>

      <aside className="hidden w-[370px] shrink-0 border-l border-lineSoft bg-ink-950/40 xl:block">
        {projectLoading ? <div className="p-4"><Skeleton className="h-64" /></div> : renderWorkspace()}
      </aside>

      <Modal open={workspaceOpen} onClose={() => setWorkspaceOpen(false)} size="xl" title="Workspace" description={project?.name} footer={<Button onClick={() => setWorkspaceOpen(false)}>Close</Button>}>
        <div className="h-[65vh] overflow-hidden rounded-lg border border-lineSoft">{renderWorkspace()}</div>
      </Modal>

      <Modal open={fileOpen} onClose={() => setFileOpen(false)} size="lg" title={filePath || 'File'} description="Manual edits create a checkpoint before saving." footer={<><Button variant="ghost" onClick={() => setFileOpen(false)}>Cancel</Button><Button variant="primary" onClick={() => void saveFile()} loading={fileSaving}><Save size={12} /> Save file</Button></>}>
        {fileLoading ? <div className="flex items-center gap-2 py-10 text-xs text-muted"><Spinner /> Loading file…</div> : <textarea value={fileContent} onChange={(event) => setFileContent(event.target.value)} rows={22} className="w-full resize-y rounded-lg border border-line bg-ink-950 p-3 font-mono text-[11px] leading-relaxed text-ink-50 focus:border-accent/50 focus:outline-none" spellCheck={false} />}
      </Modal>

      <Modal open={Boolean(taskDetail)} onClose={() => setTaskDetail(null)} size="lg" title={taskDetail ? `${taskDetail.kind} task` : 'Task'} description={taskDetail ? `${taskDetail.status} · ${relativeTime(taskDetail.started_at)}` : undefined} footer={<Button onClick={() => setTaskDetail(null)}>Close</Button>}>
        {taskDetail && <div className="space-y-3">
          <div className="rounded-lg border border-line bg-ink-950/40 p-3 text-[11px] text-muted"><p className="text-[9px] uppercase tracking-wider text-faint">Request</p><p className="mt-1 whitespace-pre-wrap text-ink-50/90">{taskDetail.prompt}</p></div>
          {taskDetail.error && <p className="rounded-lg border border-danger/20 bg-danger/5 p-2 text-[11px] text-danger">{taskDetail.error}</p>}
          {taskDetail.output && <div className="rounded-lg border border-accent/20 bg-accent/5 p-3 text-[11px] leading-relaxed text-ink-50/90">{taskDetail.output}</div>}
          <div className="space-y-1.5">{taskDetail.steps.filter((step) => !['delta'].includes(String(step.type))).map((step, index) => (
            <div key={index} className="rounded-md border border-lineSoft bg-ink-950/40 px-2.5 py-1.5"><span className="text-[9px] uppercase tracking-wider text-faint">{String(step.type)}</span><p className="mt-0.5 line-clamp-3 text-[10px] text-muted">{text(step.message || step.path || step.error || step.output || step.tool || '')}</p></div>
          ))}</div>
          <Button size="sm" variant="ghost" onClick={() => { setEvents(taskDetail.steps); setTaskDetail(null); }}>Load events into terminal</Button>
        </div>}
      </Modal>
    </div>
  );
}

function EventLine({ event }: { event: TerminalEvent }) {
  const type = text(event.type);
  const base = 'rounded-lg border px-3 py-2';
  if (type === 'user_prompt') return <div className="flex items-start gap-2 py-1 text-[11px]"><span className="text-accent-soft">›</span><span className="whitespace-pre-wrap text-ink-50">{text(event.prompt)}</span></div>;
  if (type === 'shell') return <div className="flex items-start gap-2 py-1 text-[11px]"><span className="text-success">$</span><span className="whitespace-pre-wrap text-ink-50">{text(event.command)}</span></div>;
  if (type === 'status') return <div className="flex items-start gap-2 text-[10.5px] text-muted"><Loader2 size={11} className="mt-0.5 shrink-0 text-accent-soft" /><span><span className="text-accent-soft">{text(event.stage)}</span>{event.message ? ` — ${text(event.message)}` : ''}</span></div>;
  if (type === 'model') return <div className="flex flex-wrap items-center gap-1.5 text-[9.5px] text-faint"><Zap size={10} className="text-accent-soft" /> model: <span className="text-ink-50">{text((event.model as { name?: string } | undefined)?.name ?? event.model)}</span><span>· {text(event.runtime)}</span>{event.local === false && <Badge tone="warn">remote</Badge>}</div>;
  if (type === 'notice') return <div className="rounded-md border border-warn/20 bg-warn/5 px-2.5 py-1.5 text-[10px] text-warn">{text(event.notice)}</div>;
  if (type === 'agent_step') return <div className="text-[10px] text-muted"><span className="text-accent-soft">agent</span> step {text(event.step)}/{text(event.max_steps)} · {text(event.message)}</div>;
  if (type === 'file_changed') return <div className="flex items-center gap-2 text-[10.5px] text-success"><FileCode2 size={11} /> {text(event.message || `Wrote ${event.path}`)}</div>;
  if (type === 'diff') return <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted"><Code2 size={10} className="text-accent-soft" /> diff <Badge tone="success">+{text((event.summary as { added?: number } | undefined)?.added ?? 0)}</Badge><Badge tone="danger">-{text((event.summary as { removed?: number } | undefined)?.removed ?? 0)}</Badge><Badge tone="warn">~{text((event.summary as { changed?: number } | undefined)?.changed ?? 0)}</Badge></div>;
  if (type === 'test_result') return (
    <div className={cn(base, event.passed ? 'border-success/25 bg-success/5' : 'border-danger/25 bg-danger/5')}>
      <div className="flex items-center gap-1.5 text-[10px] font-medium">{event.passed ? <CheckCircle2 size={11} className="text-success" /> : <AlertTriangle size={11} className="text-danger" />}<span className={event.passed ? 'text-success' : 'text-danger'}>Validation {event.passed ? 'passed' : 'failed'}{event.repair_attempt ? ` · repair ${event.repair_attempt}` : ''}</span></div>
      {Array.isArray(event.checks) && event.checks.map((check, index) => <p key={index} className="mt-1 text-[9.5px] text-muted">• {text(check)}</p>)}
      {Array.isArray(event.commands) && (event.commands as CommandResult[]).map((command, index) => (
        <details key={index} className="mt-1.5 rounded border border-lineSoft bg-ink-950/40"><summary className="cursor-pointer px-2 py-1 text-[9px] text-muted">$ {command.command} · exit {command.exit_code ?? '—'}</summary>{(command.stdout || command.stderr) && <pre className="max-h-40 overflow-auto border-t border-lineSoft p-2 text-[9px] text-muted">{`${command.stdout || ''}${command.stderr ? `\n${command.stderr}` : ''}`.slice(0, 6000)}</pre>}</details>
      ))}
    </div>
  );
  if (type === 'tool_call') return <div className="text-[10px] text-electric"><span className="text-accent-soft">tool</span> {text(event.tool)} <span className="text-faint">{JSON.stringify(event.arguments).slice(0, 300)}</span></div>;
  if (type === 'tool_result') return <details className="rounded border border-lineSoft bg-panel/30"><summary className="cursor-pointer px-2 py-1 text-[9px] text-muted">tool result · {text(event.tool)} {event.ok === false ? '· error' : ''}</summary><pre className="max-h-48 overflow-auto border-t border-lineSoft p-2 text-[9px] text-muted">{text(event.result).slice(0, 6000)}</pre></details>;
  if (type === 'command_result') return (
    <div className="rounded-lg border border-lineSoft bg-ink-950/50 p-2.5">
      <div className="flex items-center gap-2 text-[10px]"><span className="text-success">$</span><span className="text-ink-50">{text(event.command)}</span><span className={event.status === 'completed' ? 'ml-auto text-success' : 'ml-auto text-danger'}>exit {text(event.exit_code ?? '—')} · {text(event.duration_ms)}ms</span></div>
      {(text(event.stdout) || text(event.stderr)) && <pre className="mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap text-[9.5px] leading-relaxed text-muted">{`${text(event.stdout)}${event.stderr ? `\n${text(event.stderr)}` : ''}`.slice(0, 12000)}</pre>}
    </div>
  );
  if (type === 'error') return <div className="rounded-lg border border-danger/25 bg-danger/5 px-3 py-2"><p className="text-[10.5px] text-danger">{text(event.error)}</p>{Boolean(event.hint) && <p className="mt-1 text-[9.5px] text-muted">{text(event.hint)}</p>}</div>;
  if (type === 'done') return <div className="rounded-lg border border-success/25 bg-success/5 px-3 py-2"><div className="flex items-center gap-1.5 text-[10.5px] text-success"><CheckCircle2 size={12} /> {text(event.status)} · {text(event.duration_ms)}ms</div>{Boolean(event.output) && <p className="mt-1 text-[9.5px] text-muted">{text(event.output)}</p>}</div>;
  if (type === 'final_text') return <div className="rounded-lg border border-line bg-panel/40 p-3 font-sans text-[11.5px]"><Markdown content={text(event.content)} /></div>;
  if (type === 'meta') return null;
  return null;
}
