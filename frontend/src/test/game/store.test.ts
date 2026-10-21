import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from '../../game/state/store';

function resetStore() {
  useGameStore.setState({
    projects: [], project: null, spec: null, selection: [], history: [], future: [],
    dirty: false, loading: false, error: null,
  });
}

describe('editor store', () => {
  beforeEach(async () => {
    resetStore();
    const state = useGameStore.getState();
    for (const project of await state.refreshProjects().then(() => useGameStore.getState().projects)) {
      await useGameStore.getState().removeProject(project.id);
    }
    resetStore();
  });

  it('creates a project and lists it', async () => {
    const id = await useGameStore.getState().createProject('Test Arena', 'sample');
    expect(id).toBeTruthy();
    const state = useGameStore.getState();
    expect(state.project?.name).toBe('Test Arena');
    expect(state.spec?.objects.length).toBe(4);
    expect(state.projects.some((project) => project.id === id)).toBe(true);
  });

  it('adds objects and undoes / redoes the change', async () => {
    await useGameStore.getState().createProject('Undo Test', 'empty');
    const before = useGameStore.getState().spec?.objects.length ?? 0;
    useGameStore.getState().addObject({ kind: 'mesh', shape: 'sphere', name: 'Ball' });
    expect(useGameStore.getState().spec?.objects.length).toBe(before + 1);
    expect(useGameStore.getState().selection.length).toBe(1);
    useGameStore.getState().undo();
    expect(useGameStore.getState().spec?.objects.length).toBe(before);
    useGameStore.getState().redo();
    expect(useGameStore.getState().spec?.objects.length).toBe(before + 1);
  });

  it('renames, duplicates and deletes objects', async () => {
    await useGameStore.getState().createProject('Ops Test', 'sample');
    const object = useGameStore.getState().spec!.objects[0];
    useGameStore.getState().renameObject(object.id, 'Renamed');
    expect(useGameStore.getState().spec!.objects[0].name).toBe('Renamed');
    const count = useGameStore.getState().spec!.objects.length;
    useGameStore.getState().duplicateObject(object.id);
    expect(useGameStore.getState().spec!.objects.length).toBe(count + 1);
    useGameStore.getState().removeObjects(useGameStore.getState().selection);
    expect(useGameStore.getState().spec!.objects.length).toBe(count);
  });

  it('rejects an invalid change instead of corrupting the scene', async () => {
    await useGameStore.getState().createProject('Validation Test', 'empty');
    useGameStore.getState().commit((draft) => ({ ...draft, objects: [{ ...draft.objects[0] } as never] }));
    expect(useGameStore.getState().error).toBeTruthy();
  });

  it('saves and reloads the same scene', async () => {
    const id = await useGameStore.getState().createProject('Persist Test', 'sample');
    useGameStore.getState().updateObject(useGameStore.getState().spec!.objects[0].id, { name: 'Ground2' });
    expect(await useGameStore.getState().save()).toBe(true);
    expect(useGameStore.getState().dirty).toBe(false);
    resetStore();
    const opened = await useGameStore.getState().openProject(id!);
    expect(opened).toBe(true);
    expect(useGameStore.getState().spec?.objects[0].name).toBe('Ground2');
  });
});
