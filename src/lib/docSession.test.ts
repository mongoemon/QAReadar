import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  judgeProbe,
  loadSession,
  mergeRestored,
  parseSession,
  saveSession,
  toSession,
  type LiveDoc,
  type Session,
} from './docSession'
import { isMissingFileError, type FileHandleLike } from './fileAccess'

const handle: FileHandleLike = {
  name: 'a.md',
  getFile: async () => new File([''], 'a.md'),
  createWritable: async () => ({ write: async () => {}, close: async () => {} }),
}

describe('parseSession', () => {
  it('rejects non-objects and empty/malformed doc lists', () => {
    expect(parseSession(undefined)).toBeNull()
    expect(parseSession(null)).toBeNull()
    expect(parseSession('x')).toBeNull()
    expect(parseSession({ docs: 'nope' })).toBeNull()
    expect(parseSession({ docs: [] })).toBeNull()
    expect(parseSession({ docs: [{ name: 1, text: 'x' }] })).toBeNull()
    expect(parseSession({ docs: [{ name: 'a.md', text: 5 }] })).toBeNull()
    expect(parseSession({ docs: ['str', 7] })).toBeNull()
  })

  it('keeps valid docs, defaults missing fields, and drops bad entries', () => {
    const session = parseSession({
      docs: [
        { name: 'a.md', text: 'A', savedText: 'A', handle, stamp: 42 },
        null,
        { name: 'b.md', text: 'B', handle: { not: 'a handle' }, stamp: '42', savedText: 3 },
      ],
      activeIndex: 1,
    })
    expect(session?.docs).toEqual([
      { name: 'a.md', text: 'A', savedText: 'A', handle, stamp: 42 },
      { name: 'b.md', text: 'B', savedText: '', handle: null, stamp: null },
    ])
    expect(session?.activeIndex).toBe(1)
  })

  it('treats a null handle as no handle', () => {
    expect(parseSession({ docs: [{ name: 'a', text: '', handle: null }] })?.docs[0].handle).toBeNull()
  })

  it('clamps the active index into range', () => {
    const docs = [{ name: 'a.md', text: '' }]
    expect(parseSession({ docs, activeIndex: 9 })?.activeIndex).toBe(0)
    expect(parseSession({ docs, activeIndex: -3 })?.activeIndex).toBe(0)
    expect(parseSession({ docs, activeIndex: 'x' })?.activeIndex).toBe(0)
    expect(parseSession({ docs, activeIndex: 0.5 })?.activeIndex).toBe(0)
    expect(parseSession({ docs })?.activeIndex).toBe(0)
  })
})

const live = (id: string, extra: Partial<LiveDoc> = {}): LiveDoc => ({
  id,
  name: `${id}.md`,
  text: id,
  savedText: id,
  handle: null,
  ...extra,
})

describe('toSession', () => {
  it('returns null when nothing is worth keeping', () => {
    expect(toSession([], 'x', () => 1)).toBeNull()
  })

  it('snapshots docs with their stamps and the active position', () => {
    const stamps: Record<string, number> = { b: 99 }
    const session = toSession([live('a'), live('b', { handle, savedText: '' })], 'b', (id) => stamps[id])
    expect(session).toEqual({
      docs: [
        { name: 'a.md', text: 'a', savedText: 'a', handle: null, stamp: null },
        { name: 'b.md', text: 'b', savedText: '', handle, stamp: 99 },
      ],
      activeIndex: 1,
    })
  })

  it('falls back to the first doc when the active one was filtered out', () => {
    expect(toSession([live('a'), live('b')], 'gone', () => undefined)?.activeIndex).toBe(0)
  })

  it('produces something parseSession accepts unchanged', () => {
    const session = toSession([live('a', { handle }), live('b')], 'a', () => 5)
    expect(parseSession(session)).toEqual(session)
  })
})

describe('mergeRestored', () => {
  const restored = [{ id: 'r1' }, { id: 'r2' }]

  it('puts restored docs first and keeps the active doc the user is on', () => {
    expect(mergeRestored(restored, 1, [{ id: 'k1' }], 'k1')).toEqual({
      docs: [{ id: 'r1' }, { id: 'r2' }, { id: 'k1' }],
      activeId: 'k1',
    })
  })

  it("uses the session's active doc when the current one was not kept", () => {
    expect(mergeRestored(restored, 1, [], 'starter')).toEqual({ docs: restored, activeId: 'r2' })
    expect(mergeRestored(restored, 0, [{ id: 'k1' }], 'starter').activeId).toBe('r1')
  })
})

describe('judgeProbe', () => {
  it('flags a missing file but keeps its stamp for when it comes back', () => {
    expect(judgeProbe(10, 'missing')).toEqual({ state: 'missing', stamp: 10 })
    expect(judgeProbe(undefined, 'missing')).toEqual({ state: 'missing', stamp: undefined })
  })

  it('adopts the first probe as the baseline for an unstamped doc', () => {
    expect(judgeProbe(undefined, 123)).toEqual({ state: undefined, stamp: 123 })
  })

  it('reports in sync when the stamp matches, changed when it differs', () => {
    expect(judgeProbe(123, 123)).toEqual({ state: undefined, stamp: 123 })
    expect(judgeProbe(123, 456)).toEqual({ state: 'changed', stamp: 123 })
  })
})

describe('isMissingFileError', () => {
  it('recognises NotFoundError only', () => {
    expect(isMissingFileError(new DOMException('gone', 'NotFoundError'))).toBe(true)
    expect(isMissingFileError({ name: 'NotFoundError' })).toBe(true)
    expect(isMissingFileError(new DOMException('no', 'NotAllowedError'))).toBe(false)
    expect(isMissingFileError(new Error('boom'))).toBe(false)
    expect(isMissingFileError('NotFoundError')).toBe(false)
    expect(isMissingFileError(null)).toBe(false)
  })
})

// ── Minimal in-memory IndexedDB, enough for docSession's open/get/put/delete use. ──

interface FakeIdbOptions {
  /** open() fails (storage blocked); `withError` false leaves request.error null. */
  failOpen?: { withError: boolean }
  /** The transaction aborts after the request (e.g. quota exceeded). */
  abortTx?: { withError: boolean }
  /** db.transaction() itself throws. */
  throwOnTransaction?: boolean
}

function installFakeIdb(options: FakeIdbOptions = {}) {
  const data = new Map<string, unknown>()
  let created = false
  const calls = { opens: 0, closes: 0, puts: 0 }
  const later = (fn: () => void) => queueMicrotask(fn)

  const db = {
    close: () => void calls.closes++,
    createObjectStore: () => {
      created = true
    },
    transaction: () => {
      if (options.throwOnTransaction) throw new Error('InvalidStateError')
      const tx: Record<string, unknown> & {
        oncomplete?: () => void
        onerror?: () => void
        onabort?: () => void
        error: Error | null
      } = { error: null }
      const request = (compute: () => unknown) => {
        const req: { result?: unknown } = {}
        req.result = compute() // synchronous, like a real DataCloneError from put()
        later(() => {
          if (options.abortTx) {
            tx.error = options.abortTx.withError ? new Error('QuotaExceededError') : null
            tx.onabort?.()
          } else tx.oncomplete?.()
        })
        return req
      }
      tx.objectStore = () => ({
        get: (key: string) => request(() => data.get(key)),
        put: (value: unknown, key: string) =>
          request(() => {
            calls.puts++
            data.set(key, structuredClone(value))
            return key
          }),
        delete: (key: string) =>
          request(() => {
            data.delete(key)
            return undefined
          }),
      })
      return tx
    },
  }

  vi.stubGlobal('indexedDB', {
    open: () => {
      calls.opens++
      const req: Record<string, unknown> & {
        onupgradeneeded?: () => void
        onsuccess?: () => void
        onerror?: () => void
      } = { result: db, error: null }
      later(() => {
        if (options.failOpen) {
          req.error = options.failOpen.withError ? new Error('SecurityError') : null
          req.onerror?.()
          return
        }
        if (!created) req.onupgradeneeded?.()
        req.onsuccess?.()
      })
      return req
    },
  })
  return { data, calls }
}

const session = (docs: Session['docs'], activeIndex = 0): Session => ({ docs, activeIndex })
const plainDoc = { name: 'a.md', text: 'A', savedText: 'A', handle: null, stamp: 1 }

describe('loadSession / saveSession (IndexedDB)', () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  it('returns null when nothing has been stored yet', async () => {
    const { calls } = installFakeIdb()
    expect(await loadSession()).toBeNull()
    expect(calls.closes).toBe(calls.opens)
  })

  it('round-trips a session', async () => {
    installFakeIdb()
    const stored = session([plainDoc, { ...plainDoc, name: 'b.md', stamp: null }], 1)
    await saveSession(stored)
    expect(await loadSession()).toEqual(stored)
  })

  it('clears the stored session when saving null', async () => {
    const { data } = installFakeIdb()
    await saveSession(session([plainDoc]))
    expect(data.size).toBe(1)
    await saveSession(null)
    expect(data.size).toBe(0)
    expect(await loadSession()).toBeNull()
  })

  it('drops file handles when the browser cannot clone them, keeping the text', async () => {
    const { calls } = installFakeIdb()
    // A handle with functions is not structured-cloneable, so the first put throws.
    await saveSession(session([{ ...plainDoc, handle }]))
    expect(calls.puts).toBe(2)
    expect(await loadSession()).toEqual(session([{ ...plainDoc, handle: null }]))
  })

  it('serialises writes so the last save always wins', async () => {
    installFakeIdb()
    const first = saveSession(session([{ ...plainDoc, text: 'first' }]))
    const second = saveSession(session([{ ...plainDoc, text: 'second' }]))
    await Promise.all([first, second])
    expect((await loadSession())?.docs[0].text).toBe('second')
  })

  it('ignores malformed stored data', async () => {
    const { data } = installFakeIdb()
    data.set('markdown', { docs: 'corrupt' })
    expect(await loadSession()).toBeNull()
  })

  it.each([true, false])('swallows a failing open (with error: %s)', async (withError) => {
    installFakeIdb({ failOpen: { withError } })
    expect(await loadSession()).toBeNull()
    await expect(saveSession(session([plainDoc]))).resolves.toBeUndefined()
    await expect(saveSession(null)).resolves.toBeUndefined()
  })

  it.each([true, false])('swallows an aborted transaction (with error: %s)', async (withError) => {
    const { calls } = installFakeIdb({ abortTx: { withError } })
    expect(await loadSession()).toBeNull()
    await expect(saveSession(session([plainDoc]))).resolves.toBeUndefined()
    expect(calls.closes).toBe(calls.opens)
  })

  it('swallows a transaction that throws synchronously and closes the db', async () => {
    const { calls } = installFakeIdb({ throwOnTransaction: true })
    expect(await loadSession()).toBeNull()
    await expect(saveSession(session([plainDoc]))).resolves.toBeUndefined()
    expect(calls.closes).toBe(calls.opens)
  })

  it('returns null when IndexedDB does not exist at all', async () => {
    vi.stubGlobal('indexedDB', undefined)
    expect(await loadSession()).toBeNull()
    await expect(saveSession(session([plainDoc]))).resolves.toBeUndefined()
  })

  it('keeps working after a failed write', async () => {
    installFakeIdb({ abortTx: { withError: true } })
    await saveSession(session([plainDoc]))
    installFakeIdb()
    await saveSession(session([plainDoc]))
    expect(await loadSession()).toEqual(session([plainDoc]))
  })
})
