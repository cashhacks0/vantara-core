/** Editor state: current project, scene, selection, undo/redo history, viewport preferences. */
import { create } from 'zustand';
import type { GameProject, GameSpec, SceneObject, Vec3 } from '../spec/types';
import { createDefaultSpec, createObject, createSampleSpec, uid } from '../spec/defaults';
import { validateGameSpec } from '../spec/validate';
import {
  deleteProject as removeFromDb,
  exportProjectZip,
  getProject,
  importProjectZip,
  listProjects,
  putProject,
} from './persistence';

const HISTORY_LIMIT = 50;

export type GizmoMode = 'translate' | 'rotate' | 'scale';
export type CameraMode = 'orbit' | 'fly';

interface GameState {
  projects: Awaited<ReturnType<typeof listProjects>>;
  project: GameProject | null;
  spec: GameSpec | null;
  selection: string[];
  history: GameSpec[];
  future: GameSpec[];
  dirty: boolean;
  loading: boolean;
  error: string | null;
  gizmoMode: GizmoMode;
  snap: boolean;
  cameraMode: CameraMode;

  refreshProjects: () => Promise<void>;
  createProject: (name: string, template: 'empty' | 'sample') => Promise<string | null>;
  openProject: (id: string) => Promise<boolean>;
  renameProject: (name: string) => Promise<void>;
  duplicateProject: (id: string) => Promise<string | null>;
  removeProject: (id: string) => Promise<void>;
  importProject: (file: File) => Promise<string | null>;
  exportProject: (id?: string) => Promise<Blob | null>;

  commit: (mutate: (spec: GameSpec) => GameSpec) => void;
  preview: (mutate: (spec: GameSpec) => GameSpec) => void;
  undo: () => void;
  redo: () => void;

  select: (ids: string[]) => void;
  addObject: (object: Partial<SceneObject>) => string | null;
  updateObject: (id: string, patch: Partial<SceneObject>) => void;
  updateTransform: (id: string, patch: { position?: Vec3; rotation?: Vec3; scale?: Vec3 }) => void;
  removeObjects: (ids: string[]) => void;
  duplicateObject: (id: string) => string | null;
  renameObject: (id: string, name: string) => void;
  toggleVisible: (id: string) => void;
  toggleLocked: (id: string) => void;

  save: () => Promise<boolean>;
  setGizmoMode: (mode: GizmoMode) => void;
  setSnap: (value: boolean) => void;
  setCameraMode: (mode: CameraMode) => void;
}

function cloneSpec(spec: GameSpec): GameSpec {
  return JSON.parse(JSON.stringify(spec)) as GameSpec;
}

export const useGameStore = create<GameState>((set, get) => ({
  projects: [],
  project: null,
  spec: null,
  selection: [],
  history: [],
  future: [],
  dirty: false,
  loading: false,
  error: null,
  gizmoMode: 'translate',
  snap: true,
  cameraMode: 'orbit',

  refreshProjects: async () => {
    try {
      set({ projects: await listProjects() });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Could not read project storage.' });
    }
  },

  createProject: async (name, template) => {
    const trimmed = name.trim() || 'Untitled game';
    const now = new Date().toISOString();
    const spec = template === 'sample' ? createSampleSpec(trimmed) : createDefaultSpec(trimmed);
    const validation = validateGameSpec(spec);
    if (!validation.ok) {
      set({ error: validation.errors.join('; ') });
      return null;
    }
    const project: GameProject = { id: uid('prj'), name: trimmed, createdAt: now, updatedAt: now, spec };
    await putProject(project);
    set({ project, spec: cloneSpec(spec), selection: [], history: [], future: [], dirty: false, error: null });
    await get().refreshProjects();
    return project.id;
  },

  openProject: async (id) => {
    set({ loading: true, error: null });
    try {
      const project = await getProject(id);
      if (!project) {
        set({ error: 'That project no longer exists.', loading: false });
        return false;
      }
      const validation = validateGameSpec(project.spec);
      if (!validation.ok) {
        set({ error: `This project spec is invalid: ${validation.errors.join('; ')}`, loading: false });
        return false;
      }
      set({ project, spec: cloneSpec(project.spec), selection: [], history: [], future: [], dirty: false, loading: false });
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Could not open the project.', loading: false });
      return false;
    }
  },

  renameProject: async (name) => {
    const { project, spec } = get();
    if (!project || !spec) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const next = { ...project, name: trimmed, updatedAt: new Date().toISOString(), spec: { ...spec, name: trimmed } };
    await putProject(next);
    set({ project: next, spec: cloneSpec(next.spec), dirty: true });
    await get().refreshProjects();
  },

  duplicateProject: async (id) => {
    const source = await getProject(id);
    if (!source) return null;
    const now = new Date().toISOString();
    const copy: GameProject = {
      ...source,
      id: uid('prj'),
      name: `${source.name} copy`,
      createdAt: now,
      updatedAt: now,
      spec: { ...cloneSpec(source.spec), name: `${source.name} copy` },
    };
    await putProject(copy);
    await get().refreshProjects();
    return copy.id;
  },

  removeProject: async (id) => {
    await removeFromDb(id);
    const { project } = get();
    if (project?.id === id) set({ project: null, spec: null, selection: [], history: [], future: [], dirty: false });
    await get().refreshProjects();
  },

  importProject: async (file) => {
    try {
      const project = await importProjectZip(file);
      const validation = validateGameSpec(project.spec);
      if (!validation.ok) {
        set({ error: `Imported project is invalid: ${validation.errors.join('; ')}` });
        return null;
      }
      await putProject(project);
      await get().refreshProjects();
      return project.id;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Import failed.' });
      return null;
    }
  },

  exportProject: async (id) => {
    const { project } = get();
    const target = id ? await getProject(id) : project;
    if (!target) return null;
    return exportProjectZip(target);
  },

  commit: (mutate) => {
    const { spec, history } = get();
    if (!spec) return;
    const next = mutate(cloneSpec(spec));
    const validation = validateGameSpec(next);
    if (!validation.ok) {
      set({ error: `Change rejected: ${validation.errors.join('; ')}` });
      return;
    }
    set({
      spec: next,
      history: [...history, cloneSpec(spec)].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
      error: null,
    });
  },

  preview: (mutate) => {
    const { spec } = get();
    if (!spec) return;
    set({ spec: mutate(cloneSpec(spec)) });
  },

  undo: () => {
    const { history, future, spec } = get();
    if (!history.length || !spec) return;
    const previous = history[history.length - 1];
    set({ spec: previous, history: history.slice(0, -1), future: [cloneSpec(spec), ...future].slice(0, HISTORY_LIMIT), dirty: true });
  },

  redo: () => {
    const { history, future, spec } = get();
    if (!future.length || !spec) return;
    const next = future[0];
    set({ spec: next, history: [...history, cloneSpec(spec)].slice(-HISTORY_LIMIT), future: future.slice(1), dirty: true });
  },

  select: (ids) => set({ selection: ids }),

  addObject: (partial) => {
    const { spec } = get();
    if (!spec) return null;
    const object = createObject(partial);
    get().commit((draft) => ({ ...draft, objects: [...draft.objects, object] }));
    set({ selection: [object.id] });
    return object.id;
  },

  updateObject: (id, patch) => {
    get().commit((draft) => ({
      ...draft,
      objects: draft.objects.map((object) => (object.id === id ? { ...object, ...patch } : object)),
    }));
  },

  updateTransform: (id, patch) => {
    get().commit((draft) => ({
      ...draft,
      objects: draft.objects.map((object) => (object.id === id ? { ...object, ...patch } : object)),
    }));
  },

  removeObjects: (ids) => {
    const set_ = new Set(ids);
    get().commit((draft) => ({ ...draft, objects: draft.objects.filter((object) => !set_.has(object.id)) }));
    set({ selection: [] });
  },

  duplicateObject: (id) => {
    const { spec } = get();
    if (!spec) return null;
    const source = spec.objects.find((object) => object.id === id);
    if (!source) return null;
    const copy = createObject({
      ...source,
      id: uid('obj'),
      name: `${source.name} copy`,
      position: [source.position[0] + 1, source.position[1], source.position[2] + 1] as Vec3,
    });
    get().commit((draft) => ({ ...draft, objects: [...draft.objects, copy] }));
    set({ selection: [copy.id] });
    return copy.id;
  },

  renameObject: (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    get().updateObject(id, { name: trimmed });
  },

  toggleVisible: (id) => {
    const object = get().spec?.objects.find((item) => item.id === id);
    if (!object) return;
    get().updateObject(id, { visible: !object.visible });
  },

  toggleLocked: (id) => {
    const object = get().spec?.objects.find((item) => item.id === id);
    if (!object) return;
    get().updateObject(id, { locked: !object.locked });
  },

  save: async () => {
    const { project, spec } = get();
    if (!project || !spec) return false;
    const validation = validateGameSpec(spec);
    if (!validation.ok) {
      set({ error: `Not saved: ${validation.errors.join('; ')}` });
      return false;
    }
    const next: GameProject = { ...project, spec: cloneSpec(spec), updatedAt: new Date().toISOString() };
    await putProject(next);
    set({ project: next, spec: cloneSpec(next.spec), dirty: false, error: null });
    await get().refreshProjects();
    return true;
  },

  setGizmoMode: (mode) => set({ gizmoMode: mode }),
  setSnap: (value) => set({ snap: value }),
  setCameraMode: (mode) => set({ cameraMode: mode }),
}));

export function selectedObjects(state: GameState): SceneObject[] {
  if (!state.spec) return [];
  return state.spec.objects.filter((object) => state.selection.includes(object.id));
}
