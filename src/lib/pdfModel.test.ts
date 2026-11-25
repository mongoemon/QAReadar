import { describe, expect, it } from 'vitest'
import {
  addAnnotation,
  appendSource,
  deletePage,
  displayToBase,
  duplicatePage,
  EMPTY_MODEL,
  movePage,
  pushHistory,
  rectFrom,
  redoHistory,
  removeAnnotation,
  rotatePage,
  startHistory,
  translateAnnotation,
  undoHistory,
  updateAnnotation,
  type Annotation,
} from './pdfModel'

const three = appendSource(EMPTY_MODEL, 0, 3)
const note: Annotation = { id: 900, kind: 'text', x: 0.1, y: 0.2, text: 'hi', size: 0.02, color: '#000000' }

describe('pdfModel pages', () => {
  it('appends pages of a source in order', () => {
    const merged = appendSource(three, 1, 2)
    expect(merged.pages.map((p) => [p.source, p.index])).toEqual([[0, 0], [0, 1], [0, 2], [1, 0], [1, 1]])
  })

  it('rotates in both directions and wraps around', () => {
    expect(rotatePage(three, 0, true).pages[0].rotation).toBe(90)
    expect(rotatePage(three, 0, false).pages[0].rotation).toBe(270)
    expect(rotatePage(rotatePage(rotatePage(rotatePage(three, 1, true), 1, true), 1, true), 1, true).pages[1].rotation).toBe(0)
  })

  it('does not mutate the input model', () => {
    rotatePage(three, 0, true)
    expect(three.pages[0].rotation).toBe(0)
  })

  it('refuses to delete the last remaining page', () => {
    const one = appendSource(EMPTY_MODEL, 0, 1)
    expect(deletePage(one, 0)).toBe(one)
    expect(deletePage(three, 1).pages.map((p) => p.index)).toEqual([0, 2])
  })

  it('moves a page and ignores out-of-range moves', () => {
    expect(movePage(three, 0, 2).pages.map((p) => p.index)).toEqual([1, 2, 0])
    expect(movePage(three, 0, 5)).toBe(three)
    expect(movePage(three, 1, 1)).toBe(three)
  })

  it('duplicates a page with fresh annotation ids', () => {
    const withNote = addAnnotation(three, 1, note)
    const copy = duplicatePage(withNote, 1)
    expect(copy.pages).toHaveLength(4)
    expect(copy.pages[2].index).toBe(1)
    expect(copy.pages[2].annotations[0].id).not.toBe(note.id)
    expect(copy.pages[2].id).not.toBe(copy.pages[1].id)
  })
})

describe('pdfModel annotations', () => {
  it('adds, updates and removes an annotation', () => {
    const added = addAnnotation(three, 0, note)
    expect(added.pages[0].annotations).toEqual([note])
    const changed = updateAnnotation(added, 0, { ...note, text: 'bye' })
    expect((changed.pages[0].annotations[0] as typeof note).text).toBe('bye')
    expect(removeAnnotation(changed, 0, note.id).pages[0].annotations).toEqual([])
  })

  it('ignores annotations for a page that does not exist', () => {
    expect(addAnnotation(three, 9, note)).toBe(three)
  })

  it('translates boxes and pen strokes', () => {
    const box: Annotation = { id: 1, kind: 'rect', x: 0.5, y: 0.25, w: 0.2, h: 0.2, color: '#f00' }
    expect(translateAnnotation(box, 0.25, 0.25)).toMatchObject({ x: 0.75, y: 0.5, w: 0.2 })
    const pen: Annotation = { id: 2, kind: 'pen', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], width: 0.01, color: '#f00' }
    const moved = translateAnnotation(pen, 0.5, 0.5)
    expect(moved.kind === 'pen' && moved.points[1]).toEqual({ x: 1.5, y: 1.5 })
  })

  it('builds a rectangle from corners in any order', () => {
    expect(rectFrom({ x: 0.75, y: 0.5 }, { x: 0.25, y: 0.25 })).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.25 })
  })
})

describe('history', () => {
  it('undoes and redoes, and drops the redo branch on a new edit', () => {
    let h = startHistory(1)
    h = pushHistory(h, 2)
    h = pushHistory(h, 3)
    h = undoHistory(h)
    expect(h.present).toBe(2)
    h = redoHistory(h)
    expect(h.present).toBe(3)
    h = undoHistory(undoHistory(h))
    h = pushHistory(h, 9)
    expect(h.future).toEqual([])
    expect(redoHistory(h)).toBe(h)
  })

  it('ignores pushing the same value and undo with nothing to undo', () => {
    const h = startHistory('a')
    expect(pushHistory(h, 'a')).toBe(h)
    expect(undoHistory(h)).toBe(h)
  })
})

describe('displayToBase', () => {
  it('is the identity when the page is not rotated', () => {
    expect(displayToBase(0.25, 0.75, 0)).toEqual({ x: 0.25, y: 0.75 })
  })

  it('maps the displayed top-left corner to where it sits on the unrotated page', () => {
    // Rotating clockwise moves the unrotated bottom-left to the top-left, and so on.
    expect(displayToBase(0, 0, 90)).toEqual({ x: 0, y: 1 })
    expect(displayToBase(0, 0, 180)).toEqual({ x: 1, y: 1 })
    expect(displayToBase(0, 0, 270)).toEqual({ x: 1, y: 0 })
  })

  it('round-trips: rotating the unrotated point forward lands on the display point', () => {
    const forward = (x: number, y: number, r: number): [number, number] =>
      r === 90 ? [1 - y, x] : r === 180 ? [1 - x, 1 - y] : r === 270 ? [y, 1 - x] : [x, y]
    for (const r of [0, 90, 180, 270] as const) {
      const [fx, fy] = forward(0.3, 0.8, r)
      const base = displayToBase(fx, fy, r)
      expect(base.x).toBeCloseTo(0.3)
      expect(base.y).toBeCloseTo(0.8)
    }
  })
})
