/** Projects hub: create, open, rename, duplicate, delete, import and export browser projects. */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Boxes, Copy, Download, FolderPlus, Pencil, Play, Trash2, Upload } from 'lucide-react';
import { useGameStore } from '../game/state/store';
import { downloadBlob } from '../game/state/persistence';
import { Button, EmptyState, Field, Input, Modal, PageHeader, Panel, Select } from '../components/ui';
import { relativeTime } from '../lib/format';
import { toast } from '../lib/store';
import { ScrollPage } from '../components/Layout';

export function ProjectsPage() {
  const navigate = useNavigate();
  const projects = useGameStore((state) => state.projects);
  const refreshProjects = useGameStore((state) => state.refreshProjects);
  const createProject = useGameStore((state) => state.createProject);
  const renameProject = useGameStore((state) => state.renameProject);
  const duplicateProject = useGameStore((state) => state.duplicateProject);
  const removeProject = useGameStore((state) => state.removeProject);
  const importProject = useGameStore((state) => state.importProject);
  const exportProject = useGameStore((state) => state.exportProject);
  const error = useGameStore((state) => state.error);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [template, setTemplate] = useState<'empty' | 'sample'>('sample');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void refreshProjects(); }, [refreshProjects]);

  async function create() {
    setBusy(true);
    const id = await createProject(name || 'Untitled game', template);
    setBusy(false);
    if (id) {
      setCreateOpen(false);
      setName('');
      navigate(`/editor/${id}`);
    }
  }

  async function exportZip(id: string, projectName: string) {
    const blob = await exportProject(id);
    if (!blob) { toast.error('Export failed'); return; }
    downloadBlob(blob, `${projectName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.zip`);
    toast.success('Project exported', 'game-spec.json is inside the zip');
  }

  async function importZip(file: File) {
    setBusy(true);
    const id = await importProject(file);
    setBusy(false);
    if (id) { toast.success('Project imported'); void refreshProjects(); }
    else toast.error('Import failed');
  }

  return (
    <ScrollPage>
      <PageHeader
        eyebrow="Browser game projects"
        title="Projects"
        description="Every game is stored in this browser (IndexedDB) as a versioned JSON scene. Export a zip any time — you own the files."
        actions={<><input ref={fileRef} type="file" accept=".zip,application/zip" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importZip(file); event.target.value = ''; }} /><Button onClick={() => fileRef.current?.click()} loading={busy}><Upload size={14} /> Import .zip</Button><Button variant="primary" onClick={() => setCreateOpen(true)}><FolderPlus size={14} /> New project</Button></>}
      />

      {error && <div className="mb-3 rounded-lg border border-danger/25 bg-danger/5 px-3 py-2 text-[11px] text-danger">{error}</div>}

      {projects.length === 0 ? (
        <EmptyState icon={<Boxes size={20} />} title="No game projects yet" description="Create your first project to open the 3D editor. Start from an empty scene or a small sample with a ground plane, platform, coin and pillar." action={<Button variant="primary" onClick={() => setCreateOpen(true)}><FolderPlus size={13} /> Create a project</Button>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((item) => (
            <Panel key={item.id} className="overflow-hidden">
              <div className="flex h-20 items-center justify-between border-b border-lineSoft bg-gradient-to-br from-accent/10 via-panel to-electric/5 px-4">
                <span className="rounded-lg border border-line bg-ink-950/50 p-2 text-accent-soft"><Boxes size={16} /></span>
                <span className="text-[10px] text-faint">{item.objectCount} objects</span>
              </div>
              <div className="p-4">
                {renaming === item.id ? (
                  <form onSubmit={(event) => { event.preventDefault(); void renameProject(draft); setRenaming(null); }} className="flex gap-1.5">
                    <Input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} className="h-8 text-xs" maxLength={120} />
                    <Button size="sm" variant="primary" onClick={() => { void renameProject(draft); setRenaming(null); }}>Save</Button>
                  </form>
                ) : (
                  <p className="truncate text-[12.5px] font-medium text-ink-50">{item.name}</p>
                )}
                <p className="mt-1 text-[10px] text-faint">updated {relativeTime(item.updatedAt)}</p>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <Link to={`/editor/${item.id}`}><Button size="sm" variant="primary"><Play size={11} /> Open editor</Button></Link>
                  <button onClick={() => { setRenaming(item.id); setDraft(item.name); }} className="rounded p-1.5 text-faint hover:bg-raised hover:text-ink-50" title="Rename"><Pencil size={12} /></button>
                  <button onClick={() => void duplicateProject(item.id)} className="rounded p-1.5 text-faint hover:bg-raised hover:text-accent-soft" title="Duplicate"><Copy size={12} /></button>
                  <button onClick={() => void exportZip(item.id, item.name)} className="rounded p-1.5 text-faint hover:bg-raised hover:text-electric" title="Export zip"><Download size={12} /></button>
                  <button onClick={() => { if (window.confirm(`Delete "${item.name}"? This cannot be undone.`)) void removeProject(item.id); }} className="rounded p-1.5 text-faint hover:bg-raised hover:text-danger" title="Delete"><Trash2 size={12} /></button>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New game project" description="Projects live in this browser until you export them." footer={<><Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button><Button variant="primary" onClick={() => void create()} loading={busy}>Create project</Button></>}>
        <div className="space-y-3">
          <Field label="Project name"><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="My game" maxLength={120} /></Field>
          <Field label="Starting scene" help="The sample scene gives you a ground plane, a platform, a coin and a light pillar to move around.">
            <Select value={template} onChange={(event) => setTemplate(event.target.value as 'empty' | 'sample')}>
              <option value="sample">Sample scene (recommended)</option>
              <option value="empty">Empty scene</option>
            </Select>
          </Field>
        </div>
      </Modal>
    </ScrollPage>
  );
}
