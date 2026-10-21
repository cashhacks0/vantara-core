/** Content browser: built-in primitives and lights that can be dragged into the scene. */
import { Box, Circle, Cone, Cylinder, FolderOpen, Lightbulb, Plane, Search, Torus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useGameStore } from '../state/store';
import type { MeshShape, SceneObject } from '../spec/types';

const PRIMITIVES: Array<{ shape: MeshShape; label: string; icon: typeof Box }> = [
  { shape: 'box', label: 'Box', icon: Box },
  { shape: 'sphere', label: 'Sphere', icon: Circle },
  { shape: 'cylinder', label: 'Cylinder', icon: Cylinder },
  { shape: 'cone', label: 'Cone', icon: Cone },
  { shape: 'torus', label: 'Torus', icon: Torus },
  { shape: 'plane', label: 'Plane', icon: Plane },
];

const LIGHTS: Array<{ kind: 'directional' | 'point' | 'spot' | 'ambient'; label: string }> = [
  { kind: 'directional', label: 'Sun' },
  { kind: 'point', label: 'Point' },
  { kind: 'spot', label: 'Spot' },
  { kind: 'ambient', label: 'Ambient' },
];

function dragPayload(object: Partial<SceneObject>): string {
  return JSON.stringify(object);
}

export function ContentBrowser() {
  const addObject = useGameStore((state) => state.addObject);
  const assets = useGameStore((state) => state.spec?.assets ?? []);
  const [filter, setFilter] = useState('');

  const filteredPrimitives = useMemo(
    () => PRIMITIVES.filter((item) => item.label.toLowerCase().includes(filter.toLowerCase())),
    [filter],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-lineSoft px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Content Browser</p>
        <div className="relative ml-auto w-40">
          <Search size={11} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search" className="h-6 w-full rounded border border-line bg-ink-950 pl-6 pr-1.5 text-[10px] text-ink-50 placeholder:text-faint" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        <p className="mb-1.5 text-[9.5px] uppercase tracking-[0.12em] text-faint">Primitives · drag into the viewport</p>
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6 lg:grid-cols-3 xl:grid-cols-6">
          {filteredPrimitives.map((primitive) => (
            <button
              key={primitive.shape}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('application/x-vantara-shape', dragPayload({ kind: 'mesh', shape: primitive.shape, name: primitive.label, materialId: 'mat_default' }));
                event.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => addObject({ kind: 'mesh', shape: primitive.shape, name: primitive.label, materialId: 'mat_default' })}
              className="flex flex-col items-center gap-1 rounded-lg border border-line bg-ink-950/60 px-2 py-2 text-[9.5px] text-muted transition-colors hover:border-accent/30 hover:text-ink-50"
            >
              <primitive.icon size={15} className="text-accent-soft" />
              {primitive.label}
            </button>
          ))}
        </div>

        <p className="mb-1.5 mt-4 text-[9.5px] uppercase tracking-[0.12em] text-faint">Lights</p>
        <div className="flex flex-wrap gap-1.5">
          {LIGHTS.map((light) => (
            <button
              key={light.kind}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('application/x-vantara-shape', dragPayload({ kind: 'light', name: light.label, light: { id: `light_${Date.now().toString(36)}`, name: light.label, kind: light.kind, color: '#fff4e6', intensity: 1.4, position: [4, 6, 4], castShadow: light.kind !== 'ambient' } }));
                event.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => addObject({ kind: 'light', name: light.label, light: { id: `light_${Date.now().toString(36)}`, name: light.label, kind: light.kind, color: '#fff4e6', intensity: 1.4, position: [4, 6, 4], castShadow: light.kind !== 'ambient' } })}
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-ink-950/60 px-2 py-1.5 text-[10px] text-muted hover:border-accent/30 hover:text-ink-50"
            >
              <Lightbulb size={11} className="text-warn" /> {light.label}
            </button>
          ))}
        </div>

        <p className="mb-1.5 mt-4 text-[9.5px] uppercase tracking-[0.12em] text-faint">Assets</p>
        {assets.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-3 text-[10px] leading-relaxed text-faint">
            <FolderOpen size={13} /> No imported assets yet. GLB, texture and audio import arrives in Phase 4, and Image/Audio Studio outputs will land here automatically.
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-1.5">
            {assets.map((asset) => (
              <div key={asset.id} className="rounded-lg border border-line bg-ink-950/60 p-2 text-[9px] text-muted">
                <p className="truncate text-ink-50">{asset.name}</p>
                <p className="text-faint">{asset.kind}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
