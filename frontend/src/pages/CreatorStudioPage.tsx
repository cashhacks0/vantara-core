import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight, Bot, Box, Code2, Gamepad2, Globe2, HardDrive, Layers,
  Play, Plus, ShieldCheck, Sparkles, TerminalSquare, Wand2, Workflow,
} from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import type { Project, ProjectKind } from '../lib/types';
import { Badge, Button, EmptyState, Field, Input, Modal, PageHeader, Panel, Select, Skeleton, Textarea } from '../components/ui';
import { relativeTime } from '../lib/format';
import { toast } from '../lib/store';
import { ScrollPage } from '../components/Layout';

const EXAMPLES = [
  'Build a playable space game where I collect crystals and dodge asteroids.',
  'Create a polished landing page for a local coffee roaster with menu and contact form.',
  'Build a Python expense tracker that saves to JSON and includes tests.',
  'Create a Node.js API health-check CLI with a test suite.',
];

function inferKind(prompt: string, kinds: ProjectKind[]): string {
  const lower = prompt.toLowerCase();
  if (/(game|platformer|shooter|rpg|arcade|player)/.test(lower)) return 'game';
  if (/(python|pytest|cli tool)/.test(lower)) return 'python';
  if (/(node\.js|nodejs|express|npm package)/.test(lower)) return 'node';
  if (prompt.trim()) return 'static';
  return kinds[0]?.value ?? 'static';
}

const KIND_ICONS: Record<string, typeof Globe2> = { static: Globe2, game: Gamepad2, python: Code2, node: Box, blank: Layers };

export function CreatorStudioPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState('');
  const [kind, setKind] = useState('auto');
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [manual, setManual] = useState({ name: '', description: '', kind: 'static' });

  const { data: projects = [], isLoading } = useQuery({ queryKey: ['projects'], queryFn: () => api<{ projects: Project[] }>('/projects'), select: (data) => data.projects });
  const { data: kinds = [] } = useQuery({ queryKey: ['project-kinds'], queryFn: () => api<{ kinds: ProjectKind[] }>('/projects/kinds'), select: (data) => data.kinds, staleTime: Infinity });
  const inferred = useMemo(() => inferKind(prompt, kinds), [prompt, kinds]);
  const chosenKind = kind === 'auto' ? inferred : kind;

  async function buildProject(text = prompt) {
    if (!text.trim()) { toast.error('Describe what you want to create first'); return; }
    setCreating(true);
    try {
      const project = await api<Project>('/projects', {
        method: 'POST',
        body: JSON.stringify({ name: text.trim().slice(0, 70), description: text.trim(), kind: chosenKind, prompt: text.trim() }),
      });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      navigate(`/terminal?project=${project.id}&prompt=${encodeURIComponent(text.trim())}&autorun=1`);
    } catch (error) { toast.error('Project could not be created', errorMessage(error)); }
    finally { setCreating(false); }
  }

  async function createManual() {
    if (!manual.name.trim()) return;
    setCreating(true);
    try {
      const project = await api<Project>('/projects', { method: 'POST', body: JSON.stringify(manual) });
      setCreateOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      navigate(`/terminal?project=${project.id}`);
    } catch (error) { toast.error('Project could not be created', errorMessage(error)); }
    finally { setCreating(false); }
  }

  return (
    <ScrollPage>
      <PageHeader
        eyebrow="One prompt. Real files. Verified results."
        title="Creator Studio"
        description="Describe what you want to build. VANTARA creates a real project, selects a local model, writes files, runs checks, and opens a live preview you can inspect."
        actions={<><Link to="/terminal"><Button><TerminalSquare size={14} /> AI Terminal</Button></Link><Button onClick={() => setCreateOpen(true)}><Plus size={14} /> Empty project</Button></>}
      />

      <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        <Panel className="relative overflow-hidden p-5 sm:p-6">
          <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-accent/10 blur-3xl" />
          <div className="relative">
            <div className="flex flex-wrap items-center gap-2"><Badge tone="accent"><Sparkles size={10} /> Local-first build</Badge><Badge tone="neutral"><ShieldCheck size={10} /> Project stays on disk</Badge></div>
            <label className="mt-5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">What do you want to create?</label>
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={5}
              placeholder="Build me a playable game where a frog jumps across moving platforms…"
              className="mt-2 min-h-[130px] resize-none border-line bg-ink-950/70 text-[14px] leading-7"
              onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void buildProject(); }}
            />
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
              <Field label="Project type" className="sm:w-[230px]">
                <Select value={kind} onChange={(event) => setKind(event.target.value)}>
                  <option value="auto">Auto-detect · {kinds.find((item) => item.value === inferred)?.label ?? 'Website'}</option>
                  {kinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </Select>
              </Field>
              <Button variant="primary" size="lg" className="flex-1" onClick={() => void buildProject()} loading={creating} disabled={!prompt.trim()}>
                <Wand2 size={15} /> Create & build with local AI
              </Button>
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {EXAMPLES.map((example) => (
                <button key={example} onClick={() => setPrompt(example)} className="max-w-full truncate rounded-md border border-line bg-ink-950/50 px-2 py-1 text-left text-[10px] text-muted hover:border-accent/30 hover:text-ink-50">{example}</button>
              ))}
            </div>
            <p className="mt-3 text-[10px] leading-relaxed text-faint">Builds use a locally installed model. Large outputs depend on model quality, context size, and your hardware. Validation is shown exactly as it ran.</p>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel className="p-5">
            <div className="flex items-center gap-2"><span className="rounded-lg border border-line bg-raised p-2 text-accent-soft"><Bot size={15} /></span><div><h2 className="text-sm font-semibold text-ink-50">How a build runs</h2><p className="text-[10.5px] text-muted">Sequential and inspectable</p></div></div>
            <div className="mt-3 space-y-2.5">
              {[
                ['Planner', 'Reads the project, files, and project memory'],
                ['Developer', 'Writes a real implementation through the local model'],
                ['Tester', 'Runs syntax/compile checks and available tests'],
                ['Reviewer', 'Records a checkpoint, diff, and verified result'],
              ].map(([role, text], index) => (
                <div key={role} className="flex gap-2.5"><span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line bg-ink-950 text-[9px] text-accent-soft">{index + 1}</span><div><p className="text-[11px] font-medium text-ink-50">{role}</p><p className="text-[10px] leading-relaxed text-muted">{text}</p></div></div>
              ))}
            </div>
            <div className="mt-3 rounded-lg border border-lineSoft bg-ink-950/50 p-2.5 text-[10px] leading-relaxed text-faint">The AI team is a sequential pipeline, not simulated parallel agents. Every file change can be diffed and restored from a checkpoint.</div>
          </Panel>
          <Panel className="p-5">
            <div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-ink-50">Project workspace</h2><Badge tone="neutral">{projects.length}</Badge></div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-center">
              <div className="panel-soft p-3"><p className="text-xl font-semibold text-ink-50">{projects.length}</p><p className="text-[10px] text-muted">projects</p></div>
              <div className="panel-soft p-3"><p className="text-xl font-semibold text-ink-50">{projects.filter((item) => item.kind === 'game').length}</p><p className="text-[10px] text-muted">games</p></div>
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-[10px] text-faint"><HardDrive size={11} /> data/projects · checkpoints included</div>
          </Panel>
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between"><h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Recent projects</h2><Link to="/terminal" className="text-[11px] text-accent-soft hover:underline">Open terminal</Link></div>
        {isLoading ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((index) => <Skeleton key={index} className="h-36" />)}</div> : projects.length === 0 ? (
          <EmptyState icon={<Wand2 size={20} />} title="No projects yet" description="Describe an idea above and VANTARA will create the workspace, build the first version, and open a preview." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => {
              const Icon = KIND_ICONS[project.kind] ?? Layers;
              return (
                <Link key={project.id} to={`/terminal?project=${project.id}`} className="group panel overflow-hidden transition-colors hover:border-accent/30">
                  <div className="flex h-20 items-center justify-between border-b border-lineSoft bg-gradient-to-br from-accent/10 via-panel to-electric/5 px-4">
                    <span className="rounded-lg border border-line bg-ink-950/50 p-2 text-accent-soft"><Icon size={17} /></span>
                    <Badge tone="neutral">{project.kind_label}</Badge>
                  </div>
                  <div className="p-4">
                    <p className="truncate text-[12.5px] font-medium text-ink-50">{project.name}</p>
                    <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-relaxed text-muted">{project.description || 'No description'}</p>
                    <div className="mt-2 flex items-center gap-1.5 text-[9.5px] text-faint"><Play size={10} /> {project.task_count} task(s) · {relativeTime(project.last_task_at || project.updated_at)}<ArrowRight size={10} className="ml-auto transition-transform group-hover:translate-x-0.5" /></div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Link to="/workflows" className="panel flex items-center gap-3 p-4 hover:border-accent/30"><Workflow size={17} className="text-accent-soft" /><div><p className="text-[12px] font-medium text-ink-50">Automate it</p><p className="text-[10px] text-muted">Turn a task into a workflow</p></div></Link>
        <Link to="/models" className="panel flex items-center gap-3 p-4 hover:border-accent/30"><Layers size={17} className="text-electric" /><div><p className="text-[12px] font-medium text-ink-50">Choose a model</p><p className="text-[10px] text-muted">Install a coding-capable GGUF</p></div></Link>
        <Link to="/knowledge" className="panel flex items-center gap-3 p-4 hover:border-accent/30"><Globe2 size={17} className="text-success" /><div><p className="text-[12px] font-medium text-ink-50">Add project knowledge</p><p className="text-[10px] text-muted">Give the AI source material</p></div></Link>
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create empty project" description="A scaffold without an AI build. Useful for importing or hand-written work." footer={<><Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button><Button variant="primary" onClick={() => void createManual()} loading={creating} disabled={!manual.name.trim()}>Create project</Button></>}>
        <div className="space-y-3">
          <Field label="Project name"><Input value={manual.name} onChange={(event) => setManual({ ...manual, name: event.target.value })} placeholder="My project" /></Field>
          <Field label="Description"><Textarea rows={3} value={manual.description} onChange={(event) => setManual({ ...manual, description: event.target.value })} placeholder="What is this project for?" /></Field>
          <Field label="Type"><Select value={manual.kind} onChange={(event) => setManual({ ...manual, kind: event.target.value })}>{kinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></Field>
        </div>
      </Modal>
    </ScrollPage>
  );
}
