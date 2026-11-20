import { ProjectRecord } from '../types/hanuman';

const DB_NAME = 'hanuman_ai_offline_db';
const DB_VERSION = 2;
const STORE_PROJECTS = 'projects';
const STORE_MEDIA = 'media_blobs';
const STORE_EXPORTS = 'export_blobs';
const STORE_EXPORT_CHUNKS = 'export_chunks';

export interface SerializedEncodedPacket {
  kind: 'video' | 'audio';
  type: 'key' | 'delta';
  timestamp: number;
  duration: number;
  data: ArrayBuffer;
}

export interface StoredExportUnit {
  key: string; // `${projectId}:${unitIndex}`
  projectId: string;
  unitIndex: number;
  packets: SerializedEncodedPacket[];
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        const store = db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_MEDIA)) {
        db.createObjectStore(STORE_MEDIA);
      }
      if (!db.objectStoreNames.contains(STORE_EXPORTS)) {
        db.createObjectStore(STORE_EXPORTS);
      }
      if (!db.objectStoreNames.contains(STORE_EXPORT_CHUNKS)) {
        const chunkStore = db.createObjectStore(STORE_EXPORT_CHUNKS, { keyPath: 'key' });
        chunkStore.createIndex('projectId', 'projectId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
  });
}

export async function saveProject(project: ProjectRecord): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readwrite');
    tx.objectStore(STORE_PROJECTS).put({
      ...project,
      updatedAt: Date.now(),
    });
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Failed to save project'));
    };
  });
}

export async function getProject(projectId: string): Promise<ProjectRecord | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readonly');
    const req = tx.objectStore(STORE_PROJECTS).get(projectId);
    req.onsuccess = () => {
      db.close();
      resolve((req.result as ProjectRecord | undefined) ?? null);
    };
    req.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Failed to load project'));
    };
  });
}

export async function listProjects(): Promise<ProjectRecord[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readonly');
    const req = tx.objectStore(STORE_PROJECTS).getAll();
    req.onsuccess = () => {
      db.close();
      const items = (req.result as ProjectRecord[]) ?? [];
      items.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(items);
    };
    req.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Failed to list projects'));
    };
  });
}

export async function saveMediaBlob(projectId: string, blob: Blob): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MEDIA, 'readwrite');
    tx.objectStore(STORE_MEDIA).put(blob, projectId);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Failed to store read-only media cache'));
    };
  });
}

export async function getMediaBlob(projectId: string): Promise<Blob | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MEDIA, 'readonly');
    const req = tx.objectStore(STORE_MEDIA).get(projectId);
    req.onsuccess = () => {
      db.close();
      resolve((req.result as Blob | undefined) ?? null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error ?? new Error('Failed to retrieve cached video'));
    };
  });
}

export async function saveExportBlob(projectId: string, blob: Blob): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_EXPORTS, 'readwrite');
    tx.objectStore(STORE_EXPORTS).put(blob, projectId);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Failed to cache exported video'));
    };
  });
}

export async function getExportBlob(projectId: string): Promise<Blob | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_EXPORTS, 'readonly');
    const req = tx.objectStore(STORE_EXPORTS).get(projectId);
    req.onsuccess = () => {
      db.close();
      resolve((req.result as Blob | undefined) ?? null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error ?? new Error('Failed to load exported video'));
    };
  });
}

export async function saveExportUnit(unit: StoredExportUnit): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_EXPORT_CHUNKS, 'readwrite');
    tx.objectStore(STORE_EXPORT_CHUNKS).put(unit);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Failed to persist export chunk'));
    };
  });
}

export async function getExportUnits(projectId: string): Promise<StoredExportUnit[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_EXPORT_CHUNKS, 'readonly');
    const idx = tx.objectStore(STORE_EXPORT_CHUNKS).index('projectId');
    const req = idx.getAll(projectId);
    req.onsuccess = () => {
      db.close();
      const units = (req.result as StoredExportUnit[]) ?? [];
      units.sort((a, b) => a.unitIndex - b.unitIndex);
      resolve(units);
    };
    req.onerror = () => {
      db.close();
      reject(req.error ?? new Error('Failed to load export chunks'));
    };
  });
}

export async function clearExportUnits(projectId: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_EXPORT_CHUNKS, 'readwrite');
    const store = tx.objectStore(STORE_EXPORT_CHUNKS);
    const idx = store.index('projectId');
    const req = idx.getAllKeys(projectId);
    req.onsuccess = () => {
      const keys = (req.result as IDBValidKey[]) ?? [];
      for (const k of keys) {
        store.delete(k);
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Failed to clear export chunks'));
    };
  });
}

export async function deleteProjectCache(projectId: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      [STORE_PROJECTS, STORE_MEDIA, STORE_EXPORTS, STORE_EXPORT_CHUNKS],
      'readwrite'
    );
    tx.objectStore(STORE_PROJECTS).delete(projectId);
    tx.objectStore(STORE_MEDIA).delete(projectId);
    tx.objectStore(STORE_EXPORTS).delete(projectId);
    const chunkStore = tx.objectStore(STORE_EXPORT_CHUNKS);
    const idx = chunkStore.index('projectId');
    const req = idx.getAllKeys(projectId);
    req.onsuccess = () => {
      const keys = (req.result as IDBValidKey[]) ?? [];
      for (const k of keys) {
        chunkStore.delete(k);
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Failed to remove project cache'));
    };
  });
}

export async function estimateStorageUsage(): Promise<{ usedMb: number; quotaMb: number }> {
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
    try {
      const est = await navigator.storage.estimate();
      const usedMb = Math.round(((est.usage ?? 0) / (1024 * 1024)) * 10) / 10;
      const quotaMb = Math.round(((est.quota ?? 0) / (1024 * 1024)) * 10) / 10;
      return { usedMb, quotaMb };
    } catch {
      return { usedMb: 0, quotaMb: 0 };
    }
  }
  return { usedMb: 0, quotaMb: 0 };
}
