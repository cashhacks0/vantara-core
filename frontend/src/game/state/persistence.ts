/** IndexedDB storage for game projects, plus zip export/import so users own their games. */
import { openDB, type IDBPDatabase } from 'idb';
import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate';
import type { GameProject, ProjectSummary } from '../spec/types';

const DB_NAME = 'vantara-games';
const DB_VERSION = 1;
const STORE = 'projects';

let databasePromise: Promise<IDBPDatabase> | null = null;

function database(): Promise<IDBPDatabase> {
  if (!databasePromise) {
    databasePromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt');
        }
      },
    });
  }
  return databasePromise;
}

function summarize(project: GameProject): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    objectCount: project.spec.objects.length,
  };
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const db = await database();
  const all = (await db.getAll(STORE)) as GameProject[];
  return all.map(summarize).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getProject(id: string): Promise<GameProject | undefined> {
  const db = await database();
  return (await db.get(STORE, id)) as GameProject | undefined;
}

export async function putProject(project: GameProject): Promise<void> {
  const db = await database();
  await db.put(STORE, project);
}

export async function deleteProject(id: string): Promise<void> {
  const db = await database();
  await db.delete(STORE, id);
}

export async function exportProjectZip(project: GameProject): Promise<Blob> {
  const files: Record<string, Uint8Array> = {
    'game-spec.json': strToU8(JSON.stringify(project, null, 2)),
    'README.txt': strToU8(
      [
        'VANTARA AI Studio — game project export',
        '',
        `Name: ${project.name}`,
        `Exported: ${new Date().toISOString()}`,
        `Objects: ${project.spec.objects.length}`,
        '',
        'game-spec.json contains the complete scene. Import it from Projects → Import.',
      ].join('\n'),
    ),
  };
  const archive = zipSync(files, { level: 6 });
  return new Blob([archive as unknown as BlobPart], { type: 'application/zip' });
}

export async function importProjectZip(file: File): Promise<GameProject> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const entries = unzipSync(buffer);
  const specEntry = Object.entries(entries).find(([name]) => name.endsWith('game-spec.json'));
  if (!specEntry) throw new Error('That zip does not contain a game-spec.json file.');
  const parsed = JSON.parse(strFromU8(specEntry[1])) as GameProject;
  if (!parsed || typeof parsed !== 'object' || !parsed.spec) throw new Error('That project file is not readable.');
  const now = new Date().toISOString();
  return {
    id: `prj_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`,
    name: parsed.name ? `${parsed.name} (imported)` : 'Imported game',
    createdAt: now,
    updatedAt: now,
    spec: parsed.spec,
  };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
