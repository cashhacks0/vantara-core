/** Unreal-style editor shell: toolbar, outliner, 3D viewport, details/AI panels, content browser. */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Box, Bot, PanelRight, Sliders } from 'lucide-react';
import { useGameStore } from '../game/state/store';
import { Toolbar } from '../game/components/Toolbar';
import { Outliner } from '../game/components/Outliner';
import { Viewport } from '../game/components/Viewport';
import { DetailsPanel } from '../game/components/DetailsPanel';
import { ContentBrowser } from '../game/components/ContentBrowser';
import { AIAssistantDock } from '../game/components/AIAssistantDock';
import { PanelResizer } from '../game/components/PanelResizer';
import { Button, EmptyState, Spinner, cn } from '../components/ui';

export function GameEditorPage() {
  const { projectId } = useParams();
  const project = useGameStore((state) => state.project);
  const loading = useGameStore((state) => state.loading);
  const error = useGameStore((state) => state.error);
  const projects = useGameStore((state) => state.projects);
  const openProject = useGameStore((state) => state.openProject);
  const save = useGameStore((state) => state.save);
  const undo = useGameStore((state) => state.undo);
  const redo = useGameStore((state) => state.redo);
  const [leftWidth, setLeftWidth] = useState(240);
  const [rightWidth, setRightWidth] = useState(320);
  const [bottomHeight, setBottomHeight] = useState(190);
  const [rightTab, setRightTab] = useState<'details' | 'ai'>('details');

  useEffect(() => {
    if (projectId && project?.id !== projectId) void openProject(projectId);
  }, [projectId, project?.id, openProject]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, undo, redo]);

  if (!projectId) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-[20px] font-semibold text-ink-50">Game Editor</h1>
          <p className="mt-1 text-[12px] text-muted">Choose a project to open, or create a new one.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {projects.map((item) => (
              <Link key={item.id} to={`/editor/${item.id}`} className="panel flex items-center gap-3 p-3 hover:border-accent/30">
                <span className="rounded-lg border border-line bg-raised p-2 text-accent-soft"><Box size={15} /></span>
                <div className="min-w-0"><p className="truncate text-[12px] font-medium text-ink-50">{item.name}</p><p className="text-[10px] text-faint">{item.objectCount} objects</p></div>
              </Link>
            ))}
          </div>
          <div className="mt-4"><Link to="/projects"><Button variant="primary">Open Projects</Button></Link></div>
        </div>
      </div>
    );
  }

  if (loading) return <div className="flex h-full items-center justify-center text-muted"><Spinner className="mr-2" /> Opening project…</div>;
  if (error) return <div className="flex h-full items-center justify-center p-6"><EmptyState title="Project could not be opened" description={error} action={<Link to="/projects"><Button>Back to Projects</Button></Link>} /></div>;
  if (!project) return <div className="flex h-full items-center justify-center text-muted">Loading…</div>;

  return (
    <div className="flex h-full min-h-0 flex-col bg-ink">
      <Toolbar projectName={project.name} />

      <div className="flex min-h-0 flex-1">
        <div style={{ width: leftWidth }} className="shrink-0 overflow-hidden border-r border-lineSoft bg-ink-950/40">
          <Outliner />
        </div>
        <PanelResizer onDelta={(delta) => setLeftWidth((width) => Math.max(180, Math.min(420, width + delta)))} />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1"><Viewport /></div>
          <div className="h-1 w-full cursor-row-resize bg-lineSoft transition-colors hover:bg-accent/40" onPointerDown={(event) => {
            const startY = event.clientY; const startHeight = bottomHeight;
            const move = (moveEvent: PointerEvent) => setBottomHeight(Math.max(120, Math.min(420, startHeight - (moveEvent.clientY - startY))));
            const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
            window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
          }} />
          <div style={{ height: bottomHeight }} className="shrink-0 overflow-hidden border-t border-lineSoft bg-ink-950/50">
            <ContentBrowser />
          </div>
        </div>

        <PanelResizer onDelta={(delta) => setRightWidth((width) => Math.max(260, Math.min(520, width - delta)))} />
        <div style={{ width: rightWidth }} className="shrink-0 overflow-hidden border-l border-lineSoft bg-ink-950/40">
          <div className="flex items-center gap-1 border-b border-lineSoft px-2 py-1.5">
            <button onClick={() => setRightTab('details')} className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10.5px]', rightTab === 'details' ? 'bg-raised text-ink-50' : 'text-muted hover:text-ink-50')}>
              <Sliders size={11} /> Details
            </button>
            <button onClick={() => setRightTab('ai')} className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10.5px]', rightTab === 'ai' ? 'bg-raised text-ink-50' : 'text-muted hover:text-ink-50')}>
              <Bot size={11} /> AI Assistant
            </button>
            <span className="ml-auto text-[9px] text-faint"><PanelRight size={10} /></span>
          </div>
          <div className="h-[calc(100%-33px)] overflow-y-auto">
            {rightTab === 'details' ? <DetailsPanel /> : <AIAssistantDock />}
          </div>
        </div>
      </div>
    </div>
  );
}
