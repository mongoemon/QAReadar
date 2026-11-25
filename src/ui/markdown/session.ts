// What the Markdown tab remembers across reloads: the IndexedDB session, plus localStorage
// drafts as a fallback for unsaved edits.
import { createDocSet, isDocDirty, parseDrafts, serializeDrafts, type Doc, type DocSet } from '../../lib/docSet'
import { loadSession, mergeRestored, saveSession, toSession, type Session } from '../../lib/docSession'
import type { FileHandleLike } from '../../lib/fileAccess'
import { readStored, writeStored } from '../../lib/safeStorage'

const DRAFT_KEY = 'mdreadar:md-drafts'

export interface SessionHost {
  readonly defaultName: string
  makeDoc(name: string, text: string, handle: FileHandleLike | null, savedText?: string): Doc
  getSet(): DocSet
  setSet(set: DocSet): void
  stampOf(id: string): number | undefined
  setStamp(id: string, stamp: number): void
  /** The stored documents are now in the set: show them and check their files. */
  restored(): void
}

export interface MarkdownSession {
  /** The documents to start with, before the stored session has been read. */
  initialSet(): DocSet
  blankDoc(): Doc
  /** Not worth remembering while clean and unlinked (starter, sample, blank new doc). */
  markEphemeral(id: string): void
  isEphemeral(id: string): boolean
  persist(): void
  /** Restore the documents that were open last time — text first, links to disk second. */
  hydrate(): Promise<void>
}

export function createMarkdownSession(host: SessionHost): MarkdownSession {
  const ephemeral = new Set<string>()
  /** Docs restored from the legacy localStorage drafts; superseded by the IndexedDB session. */
  const legacy = new Set<string>()
  /** The stored session is written only after it has been read, so startup never clobbers it. */
  let hydrated = false

  function blankDoc(): Doc {
    const blank = host.makeDoc(host.defaultName, '', null)
    ephemeral.add(blank.id)
    return blank
  }

  function initialSet(): DocSet {
    const drafts = parseDrafts(readStored(DRAFT_KEY))
    // First launch starts blank; samples are one click away in the top bar.
    if (drafts.length === 0) return createDocSet(blankDoc())
    const docs = drafts.map((d) => host.makeDoc(d.name, d.text, null, ''))
    docs.forEach((d) => legacy.add(d.id))
    return { docs, activeId: docs[0].id }
  }

  const worthKeeping = (doc: Doc): boolean =>
    doc.handle !== null || isDocDirty(doc) || !ephemeral.has(doc.id)

  function sessionOf(): Session | null {
    const set = host.getSet()
    return toSession(set.docs.filter(worthKeeping), set.activeId, host.stampOf)
  }

  function persist(): void {
    // localStorage drafts stay as a synchronous fallback for unsaved edits.
    const set = host.getSet()
    writeStored(DRAFT_KEY, set.docs.some(isDocDirty) ? serializeDrafts(set) : null)
    if (hydrated) void saveSession(sessionOf())
  }

  async function hydrate(): Promise<void> {
    const session = await loadSession()
    hydrated = true
    if (!session) {
      persist()
      return
    }
    // Keep anything the user opened or typed while the session was loading.
    const set = host.getSet()
    const kept = set.docs.filter((d) => !legacy.has(d.id) && worthKeeping(d))
    const restored = session.docs.map((s) => {
      const doc = host.makeDoc(s.name, s.text, s.handle, s.savedText)
      if (s.stamp !== null) host.setStamp(doc.id, s.stamp)
      return doc
    })
    host.setSet(mergeRestored(restored, session.activeIndex, kept, set.activeId))
    host.restored()
  }

  return {
    initialSet,
    blankDoc,
    markEphemeral: (id) => void ephemeral.add(id),
    isEphemeral: (id) => ephemeral.has(id),
    persist,
    hydrate,
  }
}
