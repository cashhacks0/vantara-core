import { beforeEach, describe, expect, it } from 'vitest';
import { deleteProject, exportProjectZip, getProject, importProjectZip, listProjects, putProject } from '../../game/state/persistence';
import { createDefaultSpec, createObject } from '../../game/spec/defaults';
import type { GameProject } from '../../game/spec/types';

function makeProject(name: string): GameProject {
  const now = new Date().toISOString();
  const spec = createDefaultSpec(name);
  spec.objects = [createObject({ name: 'Cube' })];
  return { id: `prj_test_${Math.random().toString(36).slice(2, 8)}`, name, createdAt: now, updatedAt: now, spec };
}

describe('project persistence', () => {
  beforeEach(async () => {
    for (const project of await listProjects()) await deleteProject(project.id);
  });

  it('stores, reads, lists and deletes projects', async () => {
    const project = makeProject('Stored Game');
    await putProject(project);
    const loaded = await getProject(project.id);
    expect(loaded?.name).toBe('Stored Game');
    expect((await listProjects()).some((item) => item.id === project.id)).toBe(true);
    await deleteProject(project.id);
    expect(await getProject(project.id)).toBeUndefined();
  });

  it('round-trips a project through a zip export', async () => {
    const project = makeProject('Zipped Game');
    await putProject(project);
    const blob = await exportProjectZip(project);
    expect(blob.size).toBeGreaterThan(0);
    const file = new File([await blob.arrayBuffer()], 'game.zip', { type: 'application/zip' });
    const imported = await importProjectZip(file);
    expect(imported.name).toContain('Zipped Game');
    expect(imported.spec.objects[0].name).toBe('Cube');
    expect(imported.id).not.toBe(project.id);
  });
});
