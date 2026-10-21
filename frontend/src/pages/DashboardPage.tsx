import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight, Bot, Boxes, Cpu, Download, FileText, Gauge, HardDrive, Image as ImageIcon, TerminalSquare,
  Library, MessageSquare, Shield, Sparkles, Workflow, Zap,
} from 'lucide-react';
import { api } from '../lib/api';
import type { DashboardData } from '../lib/types';
import { Badge, Button, EmptyState, PageHeader, Panel, Progress, Skeleton, Stat } from '../components/ui';
import { bytes, compact, relativeTime, statusTone } from '../lib/format';
import { ScrollPage } from '../components/Layout';

const QUICK_ACTIONS = [
  { to: '/chat', title: 'Start a chat', description: 'Talk to a local model with streaming responses.', icon: MessageSquare },
  { to: '/terminal', title: 'Open AI Terminal', description: 'Build and fix real project files with a local model.', icon: TerminalSquare },
  { to: '/workflows', title: 'Create a workflow', description: 'Compose executable AI pipelines visually.', icon: Workflow },
  { to: '/models', title: 'Browse models', description: 'Search the real Hugging Face catalog.', icon: Library },
  { to: '/local-models', title: 'Install a local model', description: 'Detect runtimes and manage GGUF files.', icon: HardDrive },
];

export function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardData>('/dashboard'),
    refetchInterval: 15_000,
  });

  if (isLoading) return <ScrollPage><Skeleton className="h-40 w-full" /><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div></ScrollPage>;
  if (error || !data) return <ScrollPage><EmptyState title="Dashboard unavailable" description="The backend did not return dashboard data. Confirm the API is running on port 8756." action={<Button onClick={() => window.location.reload()}>Retry</Button>} /></ScrollPage>;

  const readyRuntimes = data.runtimes.filter((runtime) => runtime.available);
  const localModels = data.runtimes.filter((r) => r.local).reduce((sum, runtime) => sum + runtime.models.length, 0);
  const localReady = readyRuntimes.some((runtime) => runtime.local);

  return (
    <ScrollPage>
      <PageHeader
        eyebrow="Local-first AI operating environment"
        title="Your private AI workspace"
        description="Run open models, build executable workflows, and keep your data on this machine — unless you explicitly choose a remote provider."
        actions={<><Link to="/create"><Button variant="primary"><Sparkles size={14} /> Create with AI</Button></Link><Link to="/terminal"><Button><TerminalSquare size={14} /> AI Terminal</Button></Link></>}
      />

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Panel className="relative overflow-hidden p-6">
          <div className="pointer-events-none absolute -right-24 -top-28 h-64 w-64 rounded-full bg-accent/10 blur-3xl" />
          <div className="relative">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={localReady ? 'success' : 'warn'} dot>{localReady ? 'Local engine online' : 'Local engine idle'}</Badge>
              <Badge tone="neutral"><Shield size={10} /> Data stays local</Badge>
              {data.local_only && <Badge tone="accent">loopback only</Badge>}
            </div>
            <h2 className="mt-5 max-w-xl text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink-50">Build with open models.<br /><span className="text-accent-soft">Own the entire stack.</span></h2>
            <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-muted">
              VANTARA orchestrates local runtimes through a single interface. There are no application-level message quotas for supported local inference — your hardware is the only limit.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link to="/chat"><Button variant="primary"><Sparkles size={14} /> Ask VANTARA</Button></Link>
              <Link to="/models"><Button><Library size={14} /> Explore {compact(10000)}+ model listings</Button></Link>
            </div>
            <div className="mt-6 grid max-w-md grid-cols-3 gap-4 border-t border-lineSoft pt-4 text-[11px] text-muted">
              <div><p className="text-base font-semibold text-ink-50">{localModels}</p><p>local models</p></div>
              <div><p className="text-base font-semibold text-ink-50">{data.counts.installed_models ?? 0}</p><p>installed records</p></div>
              <div><p className="text-base font-semibold text-ink-50">{data.counts.workflows ?? 0}</p><p>workflows</p></div>
            </div>
          </div>
        </Panel>

        <Panel className="p-5">
          <div className="flex items-center justify-between">
            <div><h3 className="text-sm font-semibold text-ink-50">Runtime health</h3><p className="text-[11px] text-muted">Detected inference backends</p></div>
            <Link to="/local-models" className="text-[11px] text-accent-soft hover:underline">Manage</Link>
          </div>
          <div className="mt-3 divide-y divide-lineSoft">
            {data.runtimes.length === 0 && <p className="py-4 text-xs text-muted">No runtime adapters reported.</p>}
            {data.runtimes.map((runtime) => (
              <div key={runtime.id} className="flex items-start gap-3 py-3">
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${runtime.available ? 'bg-success' : 'bg-faint'}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2"><p className="truncate text-xs font-medium text-ink-50">{runtime.label}</p><Badge tone={runtime.available ? 'success' : 'neutral'}>{runtime.available ? 'ready' : 'offline'}</Badge></div>
                  <p className="mt-0.5 truncate text-[10.5px] text-muted">{runtime.detail}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 rounded-lg border border-lineSoft bg-ink-950/60 p-3">
            <div className="flex items-center justify-between text-[10.5px] text-muted"><span className="inline-flex items-center gap-1"><Cpu size={11} /> {data.hardware.cpu.cores} CPU cores</span><span className="inline-flex items-center gap-1"><Gauge size={11} /> {data.hardware.inference_mode}</span></div>
            <p className="mt-1.5 text-[10.5px] text-faint">{data.hardware.gpus[0]?.name ?? 'No discrete GPU detected'} · {bytes(data.hardware.memory.available_bytes)} RAM free</p>
            <Progress className="mt-2" value={data.hardware.memory.total_bytes ? ((data.hardware.memory.total_bytes - data.hardware.memory.available_bytes) / data.hardware.memory.total_bytes) * 100 : 0} />
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Installed models" value={data.counts.installed_models ?? 0} detail="Tracked on disk" icon={<Boxes size={14} />} tone="accent" />
        <Stat label="Conversations" value={data.counts.conversations ?? 0} detail="Local history" icon={<MessageSquare size={14} />} tone="blue" />
        <Stat label="Agents" value={data.counts.agents ?? 0} detail={`${data.counts.active_runs ?? 0} run(s) active`} icon={<Bot size={14} />} />
        <Stat label="Knowledge bases" value={data.counts.knowledge_bases ?? 0} detail={`${data.counts.outputs ?? 0} outputs stored`} icon={<FileText size={14} />} />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {QUICK_ACTIONS.map((action) => (
          <Link key={action.to} to={action.to} className="group panel p-4 transition-colors hover:border-accent/30 hover:bg-panel">
            <div className="flex items-center justify-between"><span className="rounded-lg border border-line bg-raised p-2 text-accent-soft"><action.icon size={15} /></span><ArrowRight size={14} className="text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent-soft" /></div>
            <p className="mt-3 text-[13px] font-medium text-ink-50">{action.title}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{action.description}</p>
          </Link>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <Panel className="p-5">
          <div className="flex items-center justify-between"><div><h3 className="text-sm font-semibold text-ink-50">Recent activity</h3><p className="text-[11px] text-muted">Workflow and agent runs</p></div><Link to="/runs" className="text-[11px] text-accent-soft hover:underline">All runs</Link></div>
          {data.recent_runs.length === 0 ? (
            <EmptyState className="mt-3 border-0 bg-transparent py-8" icon={<Zap size={18} />} title="No runs yet" description="Execute a workflow to see execution history here." />
          ) : (
            <div className="mt-3 divide-y divide-lineSoft">
              {data.recent_runs.map((run) => (
                <Link to="/runs" key={run.id} className="flex items-center gap-3 py-2.5 hover:bg-raised/30">
                  <span className="rounded-md border border-line bg-raised p-1.5 text-muted">{run.kind === 'workflow' ? <Workflow size={12} /> : <Bot size={12} />}</span>
                  <div className="min-w-0 flex-1"><p className="truncate text-xs text-ink-50">{run.name ?? 'Untitled'}</p><p className="text-[10px] text-faint">{relativeTime(run.started_at)} · {run.kind}</p></div>
                  <Badge tone={statusTone(run.status)}>{run.status}</Badge>
                </Link>
              ))}
            </div>
          )}
        </Panel>

        <Panel className="p-5">
          <div className="flex items-center justify-between"><div><h3 className="text-sm font-semibold text-ink-50">Recent conversations</h3><p className="text-[11px] text-muted">Continue where you left off</p></div><Link to="/chat" className="text-[11px] text-accent-soft hover:underline">Open chat</Link></div>
          {data.conversations.length === 0 ? (
            <EmptyState className="mt-3 border-0 bg-transparent py-8" icon={<MessageSquare size={18} />} title="No conversations" description="Start a chat with an installed local model." action={<Link to="/chat"><Button size="sm" variant="primary">New chat</Button></Link>} />
          ) : (
            <div className="mt-3 space-y-1">
              {data.conversations.map((conversation) => (
                <Link key={conversation.id} to={`/chat/${conversation.id}`} className="flex items-center gap-2 rounded-lg px-2 py-2.5 hover:bg-raised/60">
                  <MessageSquare size={13} className="text-faint" />
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-50">{conversation.title}</span>
                  <span className="text-[10px] text-faint">{relativeTime(conversation.updated_at)}</span>
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between"><div><h3 className="text-sm font-semibold text-ink-50">Downloads</h3><p className="text-[11px] text-muted">Model files from Hugging Face</p></div><Link to="/models" className="text-[11px] text-accent-soft hover:underline">Model Library</Link></div>
          {data.downloads.length === 0 ? (
            <div className="mt-3 flex items-center gap-3 rounded-lg border border-dashed border-line px-4 py-5 text-xs text-muted"><Download size={15} /> No downloads yet. Browse the catalog to install a GGUF model.</div>
          ) : (
            <div className="mt-3 space-y-3">
              {data.downloads.map((download) => (
                <div key={download.id}>
                  <div className="flex items-center justify-between gap-3 text-xs"><span className="truncate text-ink-50">{download.filename}</span><Badge tone={statusTone(download.status)}>{download.status}</Badge></div>
                  <Progress className="mt-1.5" value={download.percent ?? 0} indeterminate={download.status === 'queued'} />
                  <div className="mt-1 flex justify-between text-[10px] text-faint"><span className="truncate">{download.repo_id}</span><span>{bytes(download.downloaded_bytes)} / {bytes(download.total_bytes)}</span></div>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel className="p-5">
          <div className="flex items-center justify-between"><div><h3 className="text-sm font-semibold text-ink-50">Outputs</h3><p className="text-[11px] text-muted">Generated locally</p></div><Link to="/image-studio" className="text-[11px] text-accent-soft hover:underline">Studios</Link></div>
          {data.recent_outputs.length === 0 ? (
            <p className="mt-4 flex items-center gap-2 text-xs text-muted"><ImageIcon size={14} /> No generated outputs yet.</p>
          ) : (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {data.recent_outputs.map((output) => (
                <a key={output.id} href={output.url} target="_blank" rel="noreferrer" className="group relative aspect-square overflow-hidden rounded-lg border border-line bg-ink-950">
                  {output.mime?.startsWith('image/') ? <img src={output.url} alt={output.name} className="h-full w-full object-cover transition-transform group-hover:scale-105" /> : <span className="flex h-full items-center justify-center text-faint"><FileText size={16} /></span>}
                </a>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </ScrollPage>
  );
}
