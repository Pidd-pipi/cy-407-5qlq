import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { isProxy, toRaw } from 'vue';

export type EntityStoreName = 'artifacts' | 'exhibitions' | 'annotations' | 'tours' | 'publications';

export interface StoredFile {
  id: string;
  name: string;
  type: string;
  size: number;
  blob: Blob;
  createdAt: string;
}

interface CraftGalleryDB extends DBSchema {
  artifacts: {
    key: string;
    value: { id: string; [key: string]: unknown };
  };
  exhibitions: {
    key: string;
    value: { id: string; [key: string]: unknown };
  };
  annotations: {
    key: string;
    value: { id: string; [key: string]: unknown };
  };
  tours: {
    key: string;
    value: { id: string; [key: string]: unknown };
  };
  publications: {
    key: string;
    value: { id: string; [key: string]: unknown };
  };
  files: {
    key: string;
    value: StoredFile;
  };
}

const DB_NAME = 'craft-gallery-local';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<CraftGalleryDB>> | null = null;
const objectUrls = new Map<string, string>();

export function createId(prefix = 'item'): string {
  const randomPart = crypto.getRandomValues(new Uint32Array(2)).join('');
  return `${prefix}-${Date.now().toString(36)}-${randomPart}`;
}

/**
 * 写入 IndexedDB 前递归剥离 Vue 响应式代理：结构化克隆无法直接克隆 Proxy
 * （fake-indexeddb 与部分浏览器都会拒绝）。
 */
function toPlainRecord<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value === null || typeof value !== 'object') return value;
  const raw = isProxy(value) ? toRaw(value) : value;
  if (raw instanceof Blob || raw instanceof ArrayBuffer) return raw;
  if (seen.has(raw as object)) return seen.get(raw as object) as T;

  if (Array.isArray(raw)) {
    const list: unknown[] = [];
    seen.set(raw, list);
    raw.forEach((item) => list.push(toPlainRecord(item, seen)));
    return list as T;
  }

  const record: Record<string, unknown> = {};
  seen.set(raw as object, record);
  Object.keys(raw as Record<string, unknown>).forEach((key) => {
    record[key] = toPlainRecord((raw as Record<string, unknown>)[key], seen);
  });
  return record as T;
}

export function getDatabase(): Promise<IDBPDatabase<CraftGalleryDB>> {
  if (!dbPromise) {
    dbPromise = openDB<CraftGalleryDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        for (const storeName of ['artifacts', 'exhibitions', 'annotations', 'tours', 'publications', 'files'] as const) {
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName, { keyPath: 'id' });
          }
        }
      }
    });
  }

  return dbPromise;
}

export async function getAllRecords<T extends { id: string }>(storeName: EntityStoreName): Promise<T[]> {
  const db = await getDatabase();
  return (await db.getAll(storeName)) as T[];
}

export async function getRecord<T extends { id: string }>(storeName: EntityStoreName, id: string): Promise<T | undefined> {
  const db = await getDatabase();
  return (await db.get(storeName, id)) as T | undefined;
}

export async function putRecord<T extends { id: string }>(storeName: EntityStoreName, value: T): Promise<void> {
  const db = await getDatabase();
  await db.put(storeName, toPlainRecord(value));
}

export async function putManyRecords<T extends { id: string }>(storeName: EntityStoreName, values: T[]): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  await Promise.all(values.map((value) => tx.store.put(toPlainRecord(value))));
  await tx.done;
}

export async function deleteRecord(storeName: EntityStoreName, id: string): Promise<void> {
  const db = await getDatabase();
  await db.delete(storeName, id);
}

export async function clearRecords(storeName: EntityStoreName): Promise<void> {
  const db = await getDatabase();
  await db.clear(storeName);
}

export async function saveBlobFile(file: Blob, fileName = 'local-file'): Promise<StoredFile> {
  const db = await getDatabase();
  const storedFile: StoredFile = {
    id: createId('file'),
    name: 'name' in file && typeof file.name === 'string' ? file.name : fileName,
    type: file.type || 'application/octet-stream',
    size: file.size,
    blob: file,
    createdAt: new Date().toISOString()
  };

  await db.put('files', storedFile);
  return storedFile;
}

export async function getBlobFile(fileId: string): Promise<StoredFile | undefined> {
  const db = await getDatabase();
  return db.get('files', fileId);
}

/**
 * 把一个已存入的 Blob 文件复制为新 id 的文件，供发布快照使用：
 * 快照持有独立的文件副本，展品库删除原件不会影响已发布版本。
 */
export async function cloneBlobFile(fileId: string): Promise<StoredFile | undefined> {
  const source = await getBlobFile(fileId);
  if (!source) return undefined;

  const db = await getDatabase();
  const clone: StoredFile = {
    ...source,
    id: createId('snapshot-file'),
    createdAt: new Date().toISOString()
  };
  await db.put('files', clone);
  return clone;
}

export async function createBlobUrl(fileId: string): Promise<string | undefined> {
  if (objectUrls.has(fileId)) {
    return objectUrls.get(fileId);
  }

  const storedFile = await getBlobFile(fileId);
  if (!storedFile) return undefined;

  const url = URL.createObjectURL(storedFile.blob);
  objectUrls.set(fileId, url);
  return url;
}

export function revokeBlobUrl(fileId: string): void {
  const url = objectUrls.get(fileId);
  if (url) {
    URL.revokeObjectURL(url);
    objectUrls.delete(fileId);
  }
}

export async function deleteBlobFile(fileId: string): Promise<void> {
  const db = await getDatabase();
  revokeBlobUrl(fileId);
  await db.delete('files', fileId);
}

export function revokeAllBlobUrls(): void {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls.clear();
}
