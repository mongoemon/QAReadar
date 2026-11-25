import { describe, expect, it } from 'vitest'
import {
  addDoc,
  activeDoc,
  closeDoc,
  copyName,
  createDocSet,
  insertDocAfter,
  isDocDirty,
  keepOnly,
  markDocSaved,
  otherDocs,
  parseDrafts,
  serializeDrafts,
  setActive,
  steppedId,
  updateText,
  type Doc,
} from './docSet'

const doc = (id: string, text = '', savedText = text): Doc => ({
  id,
  name: `${id}.md`,
  text,
  savedText,
  handle: null,
})

describe('docSet', () => {
  it('adds a document and activates it without mutating the old set', () => {
    const a = createDocSet(doc('a'))
    const b = addDoc(a, doc('b'))
    expect(a.docs).toHaveLength(1)
    expect(b.docs.map((d) => d.id)).toEqual(['a', 'b'])
    expect(b.activeId).toBe('b')
  })

  it('tracks dirtiness from text vs savedText', () => {
    const set = updateText(createDocSet(doc('a', 'x')), 'a', 'xy')
    expect(isDocDirty(activeDoc(set))).toBe(true)
    const saved = markDocSaved(set, 'a', 'renamed.md', null)
    expect(isDocDirty(activeDoc(saved))).toBe(false)
    expect(activeDoc(saved).name).toBe('renamed.md')
  })

  it('switches the active document', () => {
    const set = setActive(addDoc(createDocSet(doc('a')), doc('b')), 'a')
    expect(set.activeId).toBe('a')
  })

  it('ignores unknown ids when switching', () => {
    const set = createDocSet(doc('a'))
    expect(setActive(set, 'zzz')).toBe(set)
  })

  it('activates a neighbour when closing the active document', () => {
    let set = addDoc(addDoc(createDocSet(doc('a')), doc('b')), doc('c'))
    set = setActive(set, 'b')
    const closed = closeDoc(set, 'b', () => doc('fresh'))
    expect(closed.docs.map((d) => d.id)).toEqual(['a', 'c'])
    expect(closed.activeId).toBe('c')
  })

  it('keeps the active document when closing another one', () => {
    const set = addDoc(createDocSet(doc('a')), doc('b'))
    expect(closeDoc(set, 'a', () => doc('fresh')).activeId).toBe('b')
  })

  it('creates a fresh document when the last one is closed', () => {
    const closed = closeDoc(createDocSet(doc('a')), 'a', () => doc('fresh'))
    expect(closed.docs.map((d) => d.id)).toEqual(['fresh'])
    expect(closed.activeId).toBe('fresh')
  })
})

describe('drafts', () => {
  it('serialises only dirty documents', () => {
    const set = addDoc(createDocSet(doc('a', 'clean')), doc('b', 'new', 'old'))
    expect(parseDrafts(serializeDrafts(set))).toEqual([{ name: 'b.md', text: 'new' }])
  })

  it('returns an empty list for corrupt or foreign data', () => {
    expect(parseDrafts('not json')).toEqual([])
    expect(parseDrafts('{"a":1}')).toEqual([])
    expect(parseDrafts('[{"name":1,"text":"x"},{"name":"ok","text":"y"}]')).toEqual([
      { name: 'ok', text: 'y' },
    ])
    expect(parseDrafts(null)).toEqual([])
  })
})

describe('insertDocAfter', () => {
  it('places the doc right after the given one and activates it', () => {
    const set = addDoc(addDoc(createDocSet(doc('a')), doc('b')), doc('c'))
    const next = insertDocAfter(set, 'a', doc('x'))
    expect(next.docs.map((d) => d.id)).toEqual(['a', 'x', 'b', 'c'])
    expect(next.activeId).toBe('x')
  })

  it('appends when the anchor is gone', () => {
    const next = insertDocAfter(createDocSet(doc('a')), 'zz', doc('x'))
    expect(next.docs.map((d) => d.id)).toEqual(['a', 'x'])
  })
})

describe('copyName', () => {
  it('adds (copy) before the extension', () => {
    expect(copyName('notes.md', ['notes.md'])).toBe('notes (copy).md')
  })

  it('numbers further copies and does not stack suffixes', () => {
    const taken = ['notes.md', 'notes (copy).md']
    expect(copyName('notes.md', taken)).toBe('notes (copy 2).md')
    expect(copyName('notes (copy).md', taken)).toBe('notes (copy 2).md')
  })

  it('handles names without an extension and dotfiles', () => {
    expect(copyName('README', [])).toBe('README (copy)')
    expect(copyName('.env', [])).toBe('.env (copy)')
  })
})

describe('closing the other documents', () => {
  const three = () => addDoc(addDoc(createDocSet(doc('a')), doc('b')), doc('c'))

  it('lists every document but the given one', () => {
    expect(otherDocs(three(), 'b').map((d) => d.id)).toEqual(['a', 'c'])
  })

  it('keeps only that document and activates it without mutating the old set', () => {
    const set = three()
    const kept = keepOnly(set, 'b')
    expect(kept.docs.map((d) => d.id)).toEqual(['b'])
    expect(kept.activeId).toBe('b')
    expect(set.docs).toHaveLength(3)
  })

  it('leaves the set alone for an unknown id', () => {
    const set = three()
    expect(keepOnly(set, 'zzz')).toBe(set)
  })
})

describe('steppedId', () => {
  const set = addDoc(addDoc(createDocSet(doc('a')), doc('b')), doc('c'))

  it('moves forwards and backwards, wrapping around', () => {
    expect(steppedId(set, 1)).toBe('a')
    expect(steppedId(set, -1)).toBe('b')
    expect(steppedId(setActive(set, 'a'), -1)).toBe('c')
  })

  it('stays put with a single document', () => {
    expect(steppedId(createDocSet(doc('a')), 1)).toBe('a')
  })
})
