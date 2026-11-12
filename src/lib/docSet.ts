import type { FileHandleLike } from './fileAccess'

export interface Doc {
  readonly id: string
  readonly name: string
  readonly text: string
  readonly savedText: string
  readonly handle: FileHandleLike | null
}

export interface DocSet {
  readonly docs: readonly Doc[]
  readonly activeId: string
}

export interface Draft {
  readonly name: string
  readonly text: string
}

export const isDocDirty = (doc: Doc): boolean => doc.text !== doc.savedText

export const createDocSet = (doc: Doc): DocSet => ({ docs: [doc], activeId: doc.id })

export function activeDoc(set: DocSet): Doc {
  return set.docs.find((d) => d.id === set.activeId) ?? set.docs[0]
}

export const addDoc = (set: DocSet, doc: Doc): DocSet => ({
  docs: [...set.docs, doc],
  activeId: doc.id,
})

export function setActive(set: DocSet, id: string): DocSet {
  if (id === set.activeId || !set.docs.some((d) => d.id === id)) return set
  return { ...set, activeId: id }
}

function mapDoc(set: DocSet, id: string, change: (doc: Doc) => Doc): DocSet {
  return { ...set, docs: set.docs.map((d) => (d.id === id ? change(d) : d)) }
}

export const updateText = (set: DocSet, id: string, text: string): DocSet =>
  mapDoc(set, id, (d) => ({ ...d, text }))

export const markDocSaved = (
  set: DocSet,
  id: string,
  name: string,
  handle: FileHandleLike | null,
  savedText?: string,
): DocSet => mapDoc(set, id, (d) => ({ ...d, name, handle, savedText: savedText ?? d.text }))

export const replaceDoc = (set: DocSet, id: string, next: Doc): DocSet =>
  mapDoc(set, id, () => next)

export function closeDoc(set: DocSet, id: string, makeFresh: () => Doc): DocSet {
  const index = set.docs.findIndex((d) => d.id === id)
  if (index === -1) return set

  const docs = set.docs.filter((d) => d.id !== id)
  if (docs.length === 0) return createDocSet(makeFresh())
  if (id !== set.activeId) return { docs, activeId: set.activeId }

  const neighbour = docs[Math.min(index, docs.length - 1)]
  return { docs, activeId: neighbour.id }
}

export function serializeDrafts(set: DocSet): string {
  const drafts: Draft[] = set.docs
    .filter(isDocDirty)
    .map((d) => ({ name: d.name, text: d.text }))
  return JSON.stringify(drafts)
}

export function parseDrafts(raw: string | null): Draft[] {
  if (raw === null) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap((item: unknown): Draft[] => {
    if (item === null || typeof item !== 'object') return []
    const { name, text } = item as Record<string, unknown>
    return typeof name === 'string' && typeof text === 'string' ? [{ name, text }] : []
  })
}
