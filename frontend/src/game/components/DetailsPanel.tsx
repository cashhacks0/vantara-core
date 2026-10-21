/** Details panel for the current selection: transform, material, physics and script slots. */
import { useEffect, useState } from 'react';
import { Info, Layers, Sliders, Trash2, Copy } from 'lucide-react';
import { useGameStore } from '../state/store';
import { Field, Input, Select, Toggle } from '../../components/ui';

function NumberField({ label, value, onChange, step = 0.1 }: { label: string; value: number; onChange: (value: number) => void; step?: number }) {
  return (
    <label className="flex items-center gap-1.5 text-[10px] text-muted">
      <span className="w-4 shrink-0 uppercase text-faint">{label}</span>
      <input
        type="number" step={step} value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full rounded border border-line bg-ink-950 px-1.5 py-1 font-mono text-[10.5px] text-ink-50"
      />
    </label>
  );
}

export function DetailsPanel() {
  const spec = useGameStore((state) => state.spec);
  const selection = useGameStore((state) => state.selection);
  const updateObject = useGameStore((state) => state.updateObject);
  const removeObjects = useGameStore((state) => state.removeObjects);
  const duplicateObject = useGameStore((state) => state.duplicateObject);
  const materials = spec?.materials ?? [];
  const object = spec?.objects.find((item) => item.id === selection[selection.length - 1]);
  const [name, setName] = useState(object?.name ?? '');

  useEffect(() => { setName(object?.name ?? ''); }, [object?.id, object?.name]);

  if (!spec) return <div className="p-3 text-[11px] text-faint">No scene loaded.</div>;

  if (!object) {
    return (
      <div className="p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Details</p>
        <p className="mt-3 text-[11px] leading-relaxed text-faint">Select an object in the viewport or outliner to edit its transform, material and properties.</p>
        <div className="mt-4 space-y-2">
          <Field label="Scene name"><Input value={spec.name} onChange={() => undefined} readOnly className="text-xs" /></Field>
          <div className="rounded-lg border border-lineSoft bg-ink-950/50 p-2.5 text-[10px] leading-relaxed text-faint">
            <p className="flex items-center gap-1.5 font-medium text-muted"><Info size={11} /> Phase 1 scope</p>
            <p className="mt-1">Transform, material and visibility are live. Physics and script slots become active in Phases 3 and 5.</p>
          </div>
        </div>
      </div>
    );
  }

  const material = materials.find((item) => item.id === object.materialId);
  const setTransform = (axis: 'position' | 'rotation' | 'scale', index: number, value: number) => {
    const current = object[axis];
    const next = [...current] as [number, number, number];
    next[index] = value;
    updateObject(object.id, { [axis]: next });
  };

  return (
    <div className="space-y-4 p-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Details</p>
        <div className="flex gap-1">
          <button onClick={() => duplicateObject(object.id)} className="rounded p-1 text-faint hover:text-accent-soft" title="Duplicate"><Copy size={11} /></button>
          <button onClick={() => removeObjects([object.id])} className="rounded p-1 text-faint hover:text-danger" title="Delete"><Trash2 size={11} /></button>
        </div>
      </div>

      <Field label="Name"><Input value={name} onChange={(event) => setName(event.target.value)} onBlur={() => updateObject(object.id, { name: name.trim() || object.name })} className="h-8 text-xs" /></Field>

      {selection.length > 1 && <p className="rounded-md border border-lineSoft bg-ink-950/50 px-2 py-1.5 text-[10px] text-muted">{selection.length} objects selected. The gizmo moves the last one.</p>}

      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium text-ink-50"><Sliders size={11} className="text-accent-soft" /> Transform</p>
        <div className="space-y-1.5">
          {(['position', 'rotation', 'scale'] as const).map((axis) => (
            <div key={axis} className="grid grid-cols-3 gap-1.5">
              <NumberField label={axis[0]} value={object[axis][0]} onChange={(value) => setTransform(axis, 0, value)} step={axis === 'rotation' ? 5 : 0.1} />
              <NumberField label={axis[1]} value={object[axis][1]} onChange={(value) => setTransform(axis, 1, value)} step={axis === 'rotation' ? 5 : 0.1} />
              <NumberField label={axis[2]} value={object[axis][2]} onChange={(value) => setTransform(axis, 2, value)} step={axis === 'rotation' ? 5 : 0.1} />
            </div>
          ))}
        </div>
        <p className="mt-1 text-[9px] text-faint">Rotation is stored in degrees. Use the gizmo for fine control.</p>
      </div>

      {object.kind === 'mesh' && (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium text-ink-50"><Layers size={11} className="text-accent-soft" /> Material</p>
          <div className="space-y-2">
            <Select value={object.materialId ?? ''} onChange={(event) => updateObject(object.id, { materialId: event.target.value })} className="h-8 py-1 text-[10.5px]">
              {materials.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
            {material && (
              <div className="space-y-1.5">
                <label className="flex items-center justify-between gap-2 text-[10px] text-muted">
                  Color
                  <span className="flex items-center gap-1.5">
                    <input type="color" value={material.color} onChange={(event) => {
                      const next = materials.map((item) => item.id === material.id ? { ...item, color: event.target.value } : item);
                      useGameStore.getState().commit((draft) => ({ ...draft, materials: next }));
                    }} className="h-6 w-10 cursor-pointer rounded border border-line bg-ink-950" />
                    <span className="font-mono text-[9.5px] text-faint">{material.color}</span>
                  </span>
                </label>
                <label className="block text-[10px] text-muted">Roughness <span className="font-mono text-faint">{material.roughness.toFixed(2)}</span>
                  <input type="range" min={0} max={1} step={0.05} value={material.roughness} onChange={(event) => {
                    const next = materials.map((item) => item.id === material.id ? { ...item, roughness: Number(event.target.value) } : item);
                    useGameStore.getState().commit((draft) => ({ ...draft, materials: next }));
                  }} className="mt-1 w-full accent-[#8b5cf6]" />
                </label>
                <label className="block text-[10px] text-muted">Metalness <span className="font-mono text-faint">{material.metalness.toFixed(2)}</span>
                  <input type="range" min={0} max={1} step={0.05} value={material.metalness} onChange={(event) => {
                    const next = materials.map((item) => item.id === material.id ? { ...item, metalness: Number(event.target.value) } : item);
                    useGameStore.getState().commit((draft) => ({ ...draft, materials: next }));
                  }} className="mt-1 w-full accent-[#8b5cf6]" />
                </label>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="space-y-1 border-t border-lineSoft pt-3">
        <Toggle checked={object.visible} onChange={() => useGameStore.getState().toggleVisible(object.id)} label="Visible" />
        <Toggle checked={object.locked} onChange={() => useGameStore.getState().toggleLocked(object.id)} label="Locked" description="Locked objects ignore gizmo edits." />
      </div>

      <div className="rounded-lg border border-lineSoft bg-ink-950/50 p-2.5 text-[10px] leading-relaxed text-faint">
        <p className="font-medium text-muted">Physics (Phase 3)</p>
        <p className="mt-1">Mode: {object.physics.mode} · collider: {object.physics.collider}. Values are stored now and become active when Rapier physics lands in Phase 3.</p>
        <p className="mt-1.5 font-medium text-muted">Scripts (Phase 5)</p>
        <p className="mt-1">{object.scriptIds.length ? object.scriptIds.join(', ') : 'No scripts attached yet.'}</p>
      </div>
    </div>
  );
}
