/** Publish page: real exports today, web publishing in Phase 7. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CloudUpload, Download, ExternalLink, Globe, Info, Rocket } from 'lucide-react';
import { useGameStore } from '../game/state/store';
import { downloadBlob } from '../game/state/persistence';
import { Badge, Button, EmptyState, PageHeader, Panel } from '../components/ui';
import { relativeTime } from '../lib/format';
import { toast } from '../lib/store';
import { ScrollPage } from '../components/Layout';

export function PublishPage() {
  const projects = useGameStore((state) => state.projects);
  const refreshProjects = useGameStore((state) => state.refreshProjects);
  const exportProject = useGameStore((state) => state.exportProject);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { void refreshProjects(); }, [refreshProjects]);

  async function exportZip(id: string, name: string) {
    setBusy(id);
    const blob = await exportProject(id);
    setBusy(null);
    if (!blob) { toast.error('Export failed'); return; }
    downloadBlob(blob, `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.zip`);
    toast.success('Game project exported', 'game-spec.json is inside the zip');
  }

  return (
    <ScrollPage>
      <PageHeader
        eyebrow="Ship your game"
        title="Publish"
        description="Your games are already exportable as project files. Publishing a playable web build and free hosting links arrive in Phase 7 — this page is honest about what exists today."
        actions={<Badge tone="neutral">Phase 7: web publish</Badge>}
      />

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel className="p-5">
          <div className="flex items-center gap-2"><span className="rounded-lg border border-line bg-raised p-2 text-accent-soft"><Rocket size={15} /></span><div><h2 className="text-sm font-semibold text-ink-50">Export a game</h2><p className="text-[10.5px] text-muted">Download the complete scene as a zip you own</p></div></div>
          {projects.length === 0 ? <EmptyState className="mt-3 border-0 bg-transparent py-10" icon={<Globe size={18} />} title="No projects to publish yet" description="Create a project in the editor first." action={<Link to="/projects"><Button variant="primary">Open Projects</Button></Link>} /> : (
            <div className="mt-4 space-y-2">
              {projects.map((item) => (
                <div key={item.id} className="flex items-center gap-3 rounded-lg border border-lineSoft bg-ink-950/40 p-3">
                  <div className="min-w-0 flex-1"><p className="truncate text-[12px] font-medium text-ink-50">{item.name}</p><p className="text-[10px] text-faint">{item.objectCount} objects · updated {relativeTime(item.updatedAt)}</p></div>
                  <Link to={`/editor/${item.id}`}><Button size="sm" variant="ghost">Open</Button></Link>
                  <Button size="sm" onClick={() => void exportZip(item.id, item.name)} loading={busy === item.id}><Download size={11} /> Export .zip</Button>
                  <Button size="sm" variant="secondary" disabled title="Web publishing is scheduled for Phase 7"><CloudUpload size={11} /> Publish web</Button>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-relaxed text-faint"><Info size={11} className="mt-0.5 shrink-0" /> The zip contains <code className="text-muted">game-spec.json</code> (objects, materials, lights, physics and script slots) plus a README. Import it back from Projects.</p>
        </Panel>

        <div className="space-y-4">
          <Panel className="p-5">
            <h2 className="text-sm font-semibold text-ink-50">How free hosting will work (Phase 7)</h2>
            <ol className="mt-3 space-y-2 text-[11px] leading-relaxed text-muted">
              <li>1. Phase 7 adds a static web build (Three.js player + your scene JSON) that runs entirely in the browser.</li>
              <li>2. You connect <strong className="text-ink-50">your own</strong> Cloudflare Pages or GitHub Pages account — VANTARA cannot create or own it for you.</li>
              <li>3. Clicking Publish gives you the exact commands and a share link such as <code className="text-accent-soft">https://mygame.pages.dev</code>.</li>
              <li>4. Each game gets a share page: title, thumbnail, play button, fullscreen, copy link and QR code.</li>
            </ol>
            <p className="mt-3 rounded-lg border border-lineSoft bg-ink-950/50 p-2.5 text-[10.5px] leading-relaxed text-faint">Everything stays free and local until you choose to publish. Nothing is uploaded without your explicit action.</p>
          </Panel>
          <Panel className="p-5">
            <h2 className="text-sm font-semibold text-ink-50">What already works</h2>
            <ul className="mt-2 space-y-1.5 text-[11px] text-muted">
              <li>• 3D editor with grid, sky, lights, gizmo, multi-select and duplicate</li>
              <li>• Typed, validated scene spec with undo/redo and checkpoints</li>
              <li>• Projects stored in your browser, exportable as a zip</li>
              <li>• Local AI assistant docked in the editor (scene commands land in Phase 2)</li>
            </ul>
            <a href="https://developers.cloudflare.com/pages/" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-[11px] text-accent-soft hover:underline">Cloudflare Pages docs <ExternalLink size={10} /></a>
          </Panel>
        </div>
      </div>
    </ScrollPage>
  );
}
