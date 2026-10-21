import type { GameSpec, MaterialSpec, PhysicsSpec, SceneObject, Vec3 } from './types';
import { GAME_SPEC_VERSION } from './types';

export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

export const DEFAULT_MATERIALS: MaterialSpec[] = [
  { id: 'mat_default', name: 'Default', color: '#8b5cf6', roughness: 0.6, metalness: 0.1, opacity: 1, transparent: false },
  { id: 'mat_ground', name: 'Ground', color: '#1c1c24', roughness: 0.9, metalness: 0, opacity: 1, transparent: false },
  { id: 'mat_gold', name: 'Gold', color: '#f2b84b', roughness: 0.25, metalness: 0.9, opacity: 1, transparent: false },
  { id: 'mat_neon', name: 'Neon', color: '#22d3ee', roughness: 0.3, metalness: 0.2, emissive: '#22d3ee', emissiveIntensity: 1.4, opacity: 1, transparent: false },
];

export const DEFAULT_PHYSICS: PhysicsSpec = { mode: 'none', collider: 'auto', mass: 1, restitution: 0.2, friction: 0.6 };

export function defaultSettings(): GameSpec['settings'] {
  return {
    gravity: 9.81,
    timeScale: 1,
    quality: 'medium',
    shadows: true,
    fog: { enabled: false, color: '#0b0b12', near: 20, far: 120 },
    sky: { color: '#0b0b12', groundColor: '#15151a', intensity: 1, sunAngle: 45 },
  };
}

export function createObject(partial: Partial<SceneObject> = {}): SceneObject {
  return {
    id: partial.id ?? uid('obj'),
    name: partial.name ?? 'Object',
    kind: partial.kind ?? 'mesh',
    shape: partial.shape ?? 'box',
    materialId: partial.materialId ?? 'mat_default',
    position: partial.position ?? ([0, 1, 0] as Vec3),
    rotation: partial.rotation ?? ([0, 0, 0] as [number, number, number]),
    scale: partial.scale ?? ([1, 1, 1] as Vec3),
    visible: partial.visible ?? true,
    locked: partial.locked ?? false,
    physics: partial.physics ?? { ...DEFAULT_PHYSICS },
    scriptIds: partial.scriptIds ?? [],
    tags: partial.tags ?? [],
    ...(partial.light ? { light: partial.light } : {}),
  };
}

export function createDefaultSpec(name = 'Untitled Game'): GameSpec {
  return {
    version: GAME_SPEC_VERSION,
    name,
    objects: [],
    materials: DEFAULT_MATERIALS.map((material) => ({ ...material })),
    lights: [
      { id: 'light_sun', name: 'Sun', kind: 'directional', color: '#fff4e6', intensity: 1.6, position: [8, 12, 6], castShadow: true },
      { id: 'light_fill', name: 'Fill', kind: 'ambient', color: '#8ea2ff', intensity: 0.45, position: [0, 0, 0], castShadow: false },
    ],
    scripts: [],
    assets: [],
    settings: defaultSettings(),
  };
}

/** A small starter scene so a new project is not an empty void. */
export function createSampleSpec(name = 'Sample Scene'): GameSpec {
  const spec = createDefaultSpec(name);
  spec.objects = [
    createObject({ id: 'obj_ground', name: 'Ground', shape: 'box', materialId: 'mat_ground', position: [0, -0.5, 0], scale: [24, 1, 24], physics: { ...DEFAULT_PHYSICS, mode: 'static', collider: 'box' } }),
    createObject({ id: 'obj_platform', name: 'Platform', shape: 'box', materialId: 'mat_default', position: [0, 0.5, 0], scale: [6, 1, 6], physics: { ...DEFAULT_PHYSICS, mode: 'static', collider: 'box' } }),
    createObject({ id: 'obj_coin', name: 'Coin', shape: 'cylinder', materialId: 'mat_gold', position: [0, 2, 0], scale: [0.8, 0.2, 0.8] }),
    createObject({ id: 'obj_pillar', name: 'Pillar', shape: 'cylinder', materialId: 'mat_neon', position: [5, 2, -3], scale: [0.7, 4, 0.7] }),
  ];
  return spec;
}
