/** Scene outliner: object tree with rename, visibility, lock and delete. */
import { useState } from 'react';
import { Box, Eye, EyeOff, Layers, Lightbulb, Lock, LockOpen, MousePointer2, Trash2 } from 'lucide-react';
import { useGameStore } from '../state/store';

export function Outliner() {
  const spec = useGameStore((state) => state.spec);
  const selection = useGameStore((state) => state.selection);
  const select = useGameStore((state) => state.select);
  const renameObject = useGameStore((state) => state.renameObject);
  const toggleVisible = useGameStore((state) => state.toggleVisible);
  const toggleLocked = useGameStore((state) => state.toggleLocked);
  const removeObjects = useGameStore((state) => state.removeObjects);
  const duplicateObject = useGameStore((state) => state.duplicateObject);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  if (!spec) return <div className="p-3 text-[11px] text-faint">No scene loaded.</div>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-lineSoft px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Outliner</p>
        <span className="text-[9px] text-faint">{spec.objects.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {spec.objects.length === 0 && (
          <p className="p-3 text-[10.5px] leading-relaxed text-faint">The scene is empty. Drag a primitive from the Content Browser into the viewport.</p>
        )}
        <div className="space-y-0.5">
          {spec.objects.map((object) => {
            const isSelected = selection.includes(object.id);
            return (
              <div
                key={object.id}
                onClick={(event) => {
                  if (event.shiftKey) select(selection.includes(object.id) ? selection.filter((id) => id !== object.id) : [...selection, object.id]);
                  else select([object.id]);
                }}
                className={`group flex items-center gap-1.5 rounded-md px-1.5 py-1.5 text-[11px] transition-colors ${isSelected ? 'bg-accent/10 ring-1 ring-inset ring-accent/20' : 'hover:bg-raised/60'}`}
              >
                <span className="text-faint">
                  {object.kind === 'light' ? <Lightbulb size={11} /> : object.kind === 'empty' ? <Layers size={11} /> : <Box size={11} />}
                </span>
                {editing === object.id ? (
                  <input
                    autoFocus
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => { renameObject(object.id, draft); setEditing(null); }}
                    onKeyDown={(event) => { if (event.key === 'Enter') { renameObject(object.id, draft); setEditing(null); } if (event.key === 'Escape') setEditing(null); }}
                    className="min-w-0 flex-1 rounded border border-accent/40 bg-ink-950 px-1 py-0.5 text-[11px] text-ink-50"
                  />
                ) : (
                  <span className={`min-w-0 flex-1 truncate ${object.visible ? 'text-ink-50' : 'text-faint line-through'}`} onDoubleClick={() => { setEditing(object.id); setDraft(object.name); }} title="Double-click to rename">
                    {object.name}
                  </span>
                )}
                <button onClick={(event) => { event.stopPropagation(); toggleVisible(object.id); }} className="rounded p-0.5 text-faint hover:text-ink-50" title={object.visible ? 'Hide' : 'Show'}>
                  {object.visible ? <Eye size={10} /> : <EyeOff size={10} />}
                </button>
                <button onClick={(event) => { event.stopPropagation(); toggleLocked(object.id); }} className="rounded p-0.5 text-faint hover:text-warn" title={object.locked ? 'Unlock' : 'Lock'}>
                  {object.locked ? <Lock size={10} /> : <LockOpen size={10} />}
                </button>
                <button onClick={(event) => { event.stopPropagation(); duplicateObject(object.id); }} className="rounded p-0.5 text-faint opacity-0 hover:text-accent-soft group-hover:opacity-100" title="Duplicate">
                  <MousePointer2 size={10} />
                </button>
                <button onClick={(event) => { event.stopPropagation(); removeObjects([object.id]); }} className="rounded p-0.5 text-faint opacity-0 hover:text-danger group-hover:opacity-100" title="Delete">
                  <Trash2 size={10} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
