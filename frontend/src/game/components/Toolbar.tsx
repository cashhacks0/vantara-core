/** Editor toolbar: save, undo, redo, transform mode, camera, quality, play and publish. */
import { useNavigate } from 'react-router-dom';
import { Camera, Grid3X3, MousePointer2, Play, Redo2, RotateCw, Save, Scale, Undo2, Upload } from 'lucide-react';
import { useGameStore } from '../state/store';
import { Button, Select, cn } from '../../components/ui';

export function Toolbar({ projectName }: { projectName: string }) {
  const navigate = useNavigate();
  const dirty = useGameStore((state) => state.dirty);
  const history = useGameStore((state) => state.history);
  const future = useGameStore((state) => state.future);
  const gizmoMode = useGameStore((state) => state.gizmoMode);
  const setGizmoMode = useGameStore((state) => state.setGizmoMode);
  const snap = useGameStore((state) => state.snap);
  const setSnap = useGameStore((state) => state.setSnap);
  const cameraMode = useGameStore((state) => state.cameraMode);
  const setCameraMode = useGameStore((state) => state.setCameraMode);
  const quality = useGameStore((state) => state.spec?.settings.quality ?? 'medium');
  const save = useGameStore((state) => state.save);
  const undo = useGameStore((state) => state.undo);
  const redo = useGameStore((state) => state.redo);
  const commit = useGameStore((state) => state.commit);

  const modes: Array<{ value: 'translate' | 'rotate' | 'scale'; icon: typeof MousePointer2; label: string }> = [
    { value: 'translate', icon: MousePointer2, label: 'Move' },
    { value: 'rotate', icon: RotateCw, label: 'Rotate' },
    { value: 'scale', icon: Scale, label: 'Scale' },
  ];

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-lineSoft bg-ink-950/70 px-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="rounded-md border border-line bg-raised p-1.5 text-accent-soft"><Grid3X3 size={13} /></span>
        <div className="min-w-0">
          <p className="truncate text-[12px] font-semibold text-ink-50">{projectName}</p>
          <p className="text-[9px] text-faint">{dirty ? 'unsaved changes' : 'saved'}</p>
        </div>
      </div>

      <div className="mx-1 h-6 w-px bg-lineSoft" />

      <Button size="sm" onClick={() => void save()} disabled={!dirty}><Save size={12} /> Save</Button>
      <button onClick={undo} disabled={!history.length} className="rounded-md p-1.5 text-muted hover:bg-raised hover:text-ink-50 disabled:opacity-30" title="Undo (Ctrl+Z)"><Undo2 size={14} /></button>
      <button onClick={redo} disabled={!future.length} className="rounded-md p-1.5 text-muted hover:bg-raised hover:text-ink-50 disabled:opacity-30" title="Redo (Ctrl+Shift+Z)"><Redo2 size={14} /></button>

      <div className="mx-1 h-6 w-px bg-lineSoft" />

      <div className="flex items-center gap-0.5 rounded-lg border border-line bg-panel p-0.5">
        {modes.map((mode) => (
          <button key={mode.value} onClick={() => setGizmoMode(mode.value)} title={mode.label} className={cn('rounded-md p-1.5 transition-colors', gizmoMode === mode.value ? 'bg-accent/15 text-accent-soft' : 'text-muted hover:text-ink-50')}>
            <mode.icon size={13} />
          </button>
        ))}
      </div>
      <button onClick={() => setSnap(!snap)} className={cn('rounded-md border px-2 py-1.5 text-[10px]', snap ? 'border-accent/40 bg-accent/10 text-accent-soft' : 'border-line text-muted')} title="Snap to grid / 15° / 0.1">
        Snap {snap ? 'on' : 'off'}
      </button>
      <button onClick={() => setCameraMode(cameraMode === 'orbit' ? 'fly' : 'orbit')} className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1.5 text-[10px] text-muted hover:text-ink-50" title="Switch between orbit and fly camera">
        <Camera size={12} /> {cameraMode === 'orbit' ? 'Orbit' : 'Fly'}
      </button>

      <div className="ml-auto flex items-center gap-2">
        <Select
          value={quality}
          onChange={(event) => commit((draft) => ({ ...draft, settings: { ...draft.settings, quality: event.target.value as 'low' | 'medium' | 'high' | 'ultra' } }))}
          className="h-8 w-[110px] py-1 text-[10px]"
          aria-label="Quality"
        >
          <option value="low">Low quality</option>
          <option value="medium">Medium quality</option>
          <option value="high">High quality</option>
          <option value="ultra">Ultra quality</option>
        </Select>
        <Button size="sm" variant="ghost" disabled title="Play mode arrives in Phase 3 (physics, controllers and the game loop)"><Play size={12} /> Play</Button>
        <Button size="sm" variant="secondary" onClick={() => navigate('/publish')}><Upload size={12} /> Publish</Button>
      </div>
    </div>
  );
}
