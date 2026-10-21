import { describe, expect, it } from 'vitest';
import { createDefaultSpec, createObject, createSampleSpec } from '../../game/spec/defaults';
import { validateGameSpec } from '../../game/spec/validate';

describe('game spec validation', () => {
  it('accepts the default and sample scenes', () => {
    expect(validateGameSpec(createDefaultSpec()).ok).toBe(true);
    expect(validateGameSpec(createSampleSpec()).ok).toBe(true);
  });

  it('rejects an unsupported version', () => {
    const spec = { ...createDefaultSpec(), version: 99 };
    const result = validateGameSpec(spec);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('version');
  });

  it('rejects objects with a broken transform', () => {
    const spec = createDefaultSpec();
    spec.objects = [{ ...createObject(), position: [0, 1] as unknown as [number, number, number] }];
    const result = validateGameSpec(spec);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('position');
  });

  it('rejects malformed material colours', () => {
    const spec = createDefaultSpec();
    spec.materials[0].color = 'purple';
    const result = validateGameSpec(spec);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('color');
  });

  it('warns when an object references a missing material', () => {
    const spec = createDefaultSpec();
    spec.objects = [createObject({ materialId: 'mat_missing' })];
    const result = validateGameSpec(spec);
    expect(result.ok).toBe(true);
    expect(result.warnings.join(' ')).toContain('mat_missing');
  });
});
