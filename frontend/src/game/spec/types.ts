/** Versioned, typed description of a browser game. This JSON is the source of truth. */

export type Vec3 = [number, number, number];
export type EulerDeg = [number, number, number];

export const GAME_SPEC_VERSION = 1;

export type MeshShape = 'box' | 'sphere' | 'cylinder' | 'plane' | 'cone' | 'torus';
export type ObjectKind = 'mesh' | 'light' | 'empty';
export type LightKind = 'directional' | 'point' | 'spot' | 'ambient' | 'hemisphere';
export type PhysicsMode = 'none' | 'static' | 'dynamic' | 'kinematic';
export type ColliderShape = 'auto' | 'box' | 'sphere' | 'capsule';
export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface MaterialSpec {
  id: string;
  name: string;
  color: string;
  roughness: number;
  metalness: number;
  emissive?: string;
  emissiveIntensity?: number;
  opacity: number;
  transparent: boolean;
}

export interface LightSpec {
  id: string;
  name: string;
  kind: LightKind;
  color: string;
  intensity: number;
  position: Vec3;
  castShadow: boolean;
}

export interface PhysicsSpec {
  mode: PhysicsMode;
  collider: ColliderShape;
  mass: number;
  restitution: number;
  friction: number;
}

export interface ScriptSpec {
  id: string;
  name: string;
  source: string;
  entry: string;
}

export interface AssetRef {
  id: string;
  name: string;
  kind: 'model' | 'texture' | 'audio' | 'image';
  source: 'builtin' | 'imported' | 'generated';
  url?: string;
  sizeBytes: number;
  tags: string[];
  createdAt: string;
}

export interface SceneObject {
  id: string;
  name: string;
  kind: ObjectKind;
  shape?: MeshShape;
  materialId?: string;
  light?: LightSpec;
  position: Vec3;
  rotation: EulerDeg;
  scale: Vec3;
  visible: boolean;
  locked: boolean;
  physics: PhysicsSpec;
  scriptIds: string[];
  tags: string[];
}

export interface GameSettings {
  gravity: number;
  timeScale: number;
  quality: 'low' | 'medium' | 'high' | 'ultra';
  shadows: boolean;
  fog: { enabled: boolean; color: string; near: number; far: number };
  sky: { color: string; groundColor: string; intensity: number; sunAngle: number };
}

export interface GameSpec {
  version: number;
  name: string;
  objects: SceneObject[];
  materials: MaterialSpec[];
  lights: LightSpec[];
  scripts: ScriptSpec[];
  assets: AssetRef[];
  settings: GameSettings;
}

export interface GameProject {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  spec: GameSpec;
}

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  objectCount: number;
  thumbnail?: string;
}
