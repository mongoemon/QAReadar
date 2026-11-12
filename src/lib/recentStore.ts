import type { FileHandleLike } from './fileAccess'
import { pushRecent, type RecentEntry } from './recent'

export interface StoredRecent {
  readonly entry: RecentEntry
  readonly handle: FileHandleLike
}

const DB_NAME = 'mdreadar'
const STORE = 'recent'
const MAX_RECENT = 10

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'entry.id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'))
  })
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

/** Recent files are a convenience: any storage failure yields an empty list, never an error. */
export async function listRecent(): Promise<StoredRecent[]> {
  try {
    const db = await openDb()
    const all = (await promisify(db.transaction(STORE).objectStore(STORE).getAll())) as StoredRecent[]
    db.close()
    return all.sort((a, b) => b.entry.openedAt - a.entry.openedAt)
  } catch {
    return []
  }
}

export async function saveRecent(entry: RecentEntry, handle: FileHandleLike): Promise<void> {
  try {
    const existing = await listRecent()
    const keep = new Set(pushRecent(existing.map((r) => r.entry), entry, MAX_RECENT).map((e) => e.id))
    const db = await openDb()
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE)
    store.put({ entry, handle })
    for (const old of existing) {
      if (!keep.has(old.entry.id)) store.delete(old.entry.id)
    }
    db.close()
  } catch {
    // Handles cannot be stored in every browser/profile; the feature just stays empty.
  }
}
