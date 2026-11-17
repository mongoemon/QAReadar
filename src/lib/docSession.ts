import type { FileHandleLike } from './fileAccess'

/**
 * The Markdown tab's open documents, kept across reloads. Text lives here (not only on disk)
 * so a document whose file was moved or deleted still reopens with its content intact.
 */
export interface SessionDoc {
  readonly name: string
  readonly text: string
  readonly savedText: string
  readonly handle: FileHandleLike | null
  /** lastModified of the file when last read/saved; null when unknown. */
  readonly stamp: number | null
}

export interface Session {
  readonly docs: readonly SessionDoc[]
  readonly activeIndex: number
}

const DB_NAME = 'mdreadar-session'
const STORE = 'session'
const KEY = 'markdown'

const isHandle = (value: unknown): value is FileHandleLike =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { getFile?: unknown }).getFile === 'function'

/** Validate whatever came out of storage; anything malformed is dropped, never thrown. */
export function parseSession(raw: unknown): Session | null {
  if (raw === null || typeof raw !== 'object') return null
  const { docs, activeIndex } = raw as Record<string, unknown>
  if (!Array.isArray(docs)) return null
  const valid = docs.flatMap((item: unknown): SessionDoc[] => {
    if (item === null || typeof item !== 'object') return []
    const { name, text, savedText, handle, stamp } = item as Record<string, unknown>
    if (typeof name !== 'string' || typeof text !== 'string') return []
    return [
      {
        name,
        text,
        savedText: typeof savedText === 'string' ? savedText : '',
        handle: isHandle(handle) ? handle : null,
        stamp: typeof stamp === 'number' ? stamp : null,
      },
    ]
  })
  if (valid.length === 0) return null
  const index = typeof activeIndex === 'number' && Number.isInteger(activeIndex) ? activeIndex : 0
  return { docs: valid, activeIndex: Math.min(Math.max(index, 0), valid.length - 1) }
}

/** A document as the tab holds it in memory (structurally a docSet `Doc`). */
export interface LiveDoc {
  readonly id: string
  readonly name: string
  readonly text: string
  readonly savedText: string
  readonly handle: FileHandleLike | null
}

/** Snapshot the docs worth keeping; null means "nothing to remember" (clears storage). */
export function toSession(
  docs: readonly LiveDoc[],
  activeId: string,
  stampOf: (id: string) => number | undefined,
): Session | null {
  if (docs.length === 0) return null
  return {
    docs: docs.map((d) => ({
      name: d.name,
      text: d.text,
      savedText: d.savedText,
      handle: d.handle,
      stamp: stampOf(d.id) ?? null,
    })),
    activeIndex: Math.max(0, docs.findIndex((d) => d.id === activeId)),
  }
}

/**
 * Put restored docs first, then whatever the user opened while the session was loading.
 * The current active doc wins if it survived; otherwise the session's own active doc does.
 */
export function mergeRestored<T extends { readonly id: string }>(
  restored: readonly T[],
  restoredActive: number,
  kept: readonly T[],
  activeId: string,
): { docs: T[]; activeId: string } {
  const keepActive = kept.some((d) => d.id === activeId)
  return {
    docs: [...restored, ...kept],
    activeId: keepActive ? activeId : restored[restoredActive].id,
  }
}

export type DiskState = 'missing' | 'changed'

/**
 * Interpret a background probe of a doc's file. `stamp` is the lastModified we last read or
 * wrote; the first successful probe of an unstamped doc adopts the file's stamp as the baseline.
 * `state` undefined means the file is in sync with what the app read.
 */
export function judgeProbe(
  stamp: number | undefined,
  probe: number | 'missing',
): { state: DiskState | undefined; stamp: number | undefined } {
  if (probe === 'missing') return { state: 'missing', stamp }
  if (stamp === undefined) return { state: undefined, stamp: probe }
  return { state: stamp === probe ? undefined : 'changed', stamp }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'))
  })
}

function run(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest): Promise<unknown> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        let request: IDBRequest
        try {
          const tx = db.transaction(STORE, mode)
          tx.oncomplete = () => {
            db.close()
            resolve(request.result)
          }
          tx.onerror = tx.onabort = () => {
            db.close()
            reject(tx.error ?? new Error('IndexedDB transaction failed'))
          }
          request = act(tx.objectStore(STORE))
        } catch (e) {
          // put() throws DataCloneError synchronously for uncloneable values.
          db.close()
          reject(e)
        }
      }),
  )
}

/** Best-effort: storage failures yield null (caller falls back to localStorage drafts). */
export async function loadSession(): Promise<Session | null> {
  try {
    return parseSession(await run('readonly', (store) => store.get(KEY)))
  } catch {
    return null
  }
}

/** Calls are serialised so a slow write never lands after (and overwrites) a newer one. */
let queue: Promise<void> = Promise.resolve()

export function saveSession(session: Session | null): Promise<void> {
  queue = queue.then(() => write(session))
  return queue
}

async function write(session: Session | null): Promise<void> {
  try {
    if (session === null) {
      await run('readwrite', (store) => store.delete(KEY))
      return
    }
    try {
      await run('readwrite', (store) => store.put(session, KEY))
    } catch {
      // Some browsers cannot clone file handles: keep the text, drop the links to disk.
      const textOnly: Session = { ...session, docs: session.docs.map((d) => ({ ...d, handle: null })) }
      await run('readwrite', (store) => store.put(textOnly, KEY))
    }
  } catch {
    // Storage blocked or full: the localStorage draft fallback still covers unsaved edits.
  }
}
