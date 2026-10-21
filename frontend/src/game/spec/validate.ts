import { z } from 'zod';
import { GAME_SPEC_VERSION } from './types';
import type { GameSpec } from './types';

const vec3 = z.tuple([z.number(), z.number(), z.number()]);

const materialSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{3,8}$/, 'color must be a hex value'),
  roughness: z.number().min(0).max(1),
  metalness: z.number().min(0).max(1),
  emissive: z.string().optional(),
  emissiveIntensity: z.number().min(0).max(20).optional(),
  opacity: z.number().min(0).max(1),
  transparent: z.boolean(),
});

const lightSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['directional', 'point', 'spot', 'ambient', 'hemisphere']),
  color: z.string().regex(/^#[0-9a-fA-F]{3,8}$/),
  intensity: z.number().min(0).max(50),
  position: vec3,
  castShadow: z.boolean(),
});

const physicsSchema = z.object({
  mode: z.enum(['none', 'static', 'dynamic', 'kinematic']),
  collider: z.enum(['auto', 'box', 'sphere', 'capsule']),
  mass: z.number().min(0).max(100000),
  restitution: z.number().min(0).max(1),
  friction: z.number().min(0).max(10),
});

const objectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['mesh', 'light', 'empty']),
  shape: z.enum(['box', 'sphere', 'cylinder', 'plane', 'cone', 'torus']).optional(),
  materialId: z.string().optional(),
  light: lightSchema.optional(),
  position: vec3,
  rotation: vec3,
  scale: vec3,
  visible: z.boolean(),
  locked: z.boolean(),
  physics: physicsSchema,
  scriptIds: z.array(z.string()),
  tags: z.array(z.string()),
});

const scriptSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  source: z.string(),
  entry: z.string().min(1),
});

const assetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['model', 'texture', 'audio', 'image']),
  source: z.enum(['builtin', 'imported', 'generated']),
  url: z.string().optional(),
  sizeBytes: z.number().min(0),
  tags: z.array(z.string()),
  createdAt: z.string().min(1),
});

export const gameSpecSchema = z.object({
  version: z.number().int().min(1).max(GAME_SPEC_VERSION),
  name: z.string().min(1).max(120),
  objects: z.array(objectSchema),
  materials: z.array(materialSchema),
  lights: z.array(lightSchema),
  scripts: z.array(scriptSchema),
  assets: z.array(assetSchema),
  settings: z.object({
    gravity: z.number().min(-50).max(50),
    timeScale: z.number().min(0).max(5),
    quality: z.enum(['low', 'medium', 'high', 'ultra']),
    shadows: z.boolean(),
    fog: z.object({ enabled: z.boolean(), color: z.string(), near: z.number().min(0), far: z.number().min(1) }),
    sky: z.object({ color: z.string(), groundColor: z.string(), intensity: z.number().min(0).max(10), sunAngle: z.number().min(0).max(360) }),
  }),
});

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/** Strict validation used for every spec that is loaded, saved, or produced by the AI. */
export function validateGameSpec(spec: unknown): ValidationResult {
  const parsed = gameSpecSchema.safeParse(spec);
  if (parsed.success) {
    const warnings: string[] = [];
    const known = new Set(parsed.data.materials.map((material) => material.id));
    for (const object of parsed.data.objects) {
      if (object.kind === 'mesh' && object.materialId && !known.has(object.materialId)) {
        warnings.push(`Object "${object.name}" references unknown material "${object.materialId}".`);
      }
    }
    return { ok: true, errors: [], warnings };
  }
  const errors = parsed.error.issues.map((issue) => {
    const path = issue.path.join('.') || 'spec';
    return `${path}: ${issue.message}`;
  });
  return { ok: false, errors, warnings: [] };
}

export function parseGameSpec(spec: unknown): GameSpec {
  return gameSpecSchema.parse(spec) as GameSpec;
}
