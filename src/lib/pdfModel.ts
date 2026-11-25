/**
 * Immutable editing model for the PDF tab. The original PDF bytes are never touched while
 * editing: this model only records which pages to keep (in which order and rotation) and the
 * annotations drawn on them. Export applies it to the source bytes (see pdfExport.ts).
 *
 * Annotation coordinates are normalized (0..1) against the page as it looks with its own
 * built-in rotation but *before* the user's extra rotation, origin top-left. That keeps them
 * independent of zoom and lets the page + its annotations rotate together.
 */
export interface Pt {
  readonly x: number
  readonly y: number
}

interface AnnotationBase {
  readonly id: number
  readonly color: string
}

export interface TextAnnotation extends AnnotationBase {
  readonly kind: 'text'
  readonly x: number
  readonly y: number
  readonly text: string
  /** Font size as a fraction of the page height. */
  readonly size: number
}

export interface BoxAnnotation extends AnnotationBase {
  /** highlight = translucent fill, rect = outline, cover = opaque fill (whiteout). */
  readonly kind: 'highlight' | 'rect' | 'cover'
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export interface PenAnnotation extends AnnotationBase {
  readonly kind: 'pen'
  readonly points: readonly Pt[]
  /** Stroke width as a fraction of the page width. */
  readonly width: number
}

export type Annotation = TextAnnotation | BoxAnnotation | PenAnnotation

export type Rotation = 0 | 90 | 180 | 270

export interface PageEntry {
  readonly id: number
  /** Which loaded PDF the page comes from, and its 0-based index there. */
  readonly source: number
  readonly index: number
  /** Extra clockwise rotation applied by the user. */
  readonly rotation: Rotation
  readonly annotations: readonly Annotation[]
}

export interface PdfModel {
  readonly pages: readonly PageEntry[]
}

let idSeq = 0
export const nextId = (): number => ++idSeq

/** Line height as a multiple of the font size; the on-screen overlay and the export share it. */
export const LINE_HEIGHT = 1.2

export const EMPTY_MODEL: PdfModel = { pages: [] }

/** Pages `0..count-1` of one source, in order, appended after the existing pages. */
export function appendSource(model: PdfModel, source: number, count: number): PdfModel {
  const added = Array.from({ length: count }, (_, index): PageEntry => ({
    id: nextId(),
    source,
    index,
    rotation: 0,
    annotations: [],
  }))
  return { pages: [...model.pages, ...added] }
}

const inRange = (model: PdfModel, at: number): boolean => Number.isInteger(at) && at >= 0 && at < model.pages.length

function mapPage(model: PdfModel, at: number, change: (page: PageEntry) => PageEntry): PdfModel {
  if (!inRange(model, at)) return model
  return { pages: model.pages.map((page, i) => (i === at ? change(page) : page)) }
}

export function rotatePage(model: PdfModel, at: number, clockwise: boolean): PdfModel {
  return mapPage(model, at, (page) => ({
    ...page,
    rotation: ((page.rotation + (clockwise ? 90 : 270)) % 360) as Rotation,
  }))
}

export function deletePage(model: PdfModel, at: number): PdfModel {
  if (!inRange(model, at) || model.pages.length <= 1) return model
  return { pages: model.pages.filter((_, i) => i !== at) }
}

export function movePage(model: PdfModel, from: number, to: number): PdfModel {
  if (!inRange(model, from) || !inRange(model, to) || from === to) return model
  const pages = [...model.pages]
  const [moved] = pages.splice(from, 1)
  pages.splice(to, 0, moved)
  return { pages }
}

/** Copy of the page right after the original (annotations included, with fresh ids). */
export function duplicatePage(model: PdfModel, at: number): PdfModel {
  if (!inRange(model, at)) return model
  const page = model.pages[at]
  const copy: PageEntry = {
    ...page,
    id: nextId(),
    annotations: page.annotations.map((a) => ({ ...a, id: nextId() })),
  }
  const pages = [...model.pages]
  pages.splice(at + 1, 0, copy)
  return { pages }
}

export const addAnnotation = (model: PdfModel, at: number, annotation: Annotation): PdfModel =>
  mapPage(model, at, (page) => ({ ...page, annotations: [...page.annotations, annotation] }))

export const updateAnnotation = (model: PdfModel, at: number, annotation: Annotation): PdfModel =>
  mapPage(model, at, (page) => ({
    ...page,
    annotations: page.annotations.map((a) => (a.id === annotation.id ? annotation : a)),
  }))

export const removeAnnotation = (model: PdfModel, at: number, id: number): PdfModel =>
  mapPage(model, at, (page) => ({ ...page, annotations: page.annotations.filter((a) => a.id !== id) }))

/** Move an annotation by a normalized offset. */
export function translateAnnotation(annotation: Annotation, dx: number, dy: number): Annotation {
  if (annotation.kind === 'pen') {
    return { ...annotation, points: annotation.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
  }
  return { ...annotation, x: annotation.x + dx, y: annotation.y + dy }
}

/** Rectangle from two corner points in any order. */
export function rectFrom(a: Pt, b: Pt): { x: number; y: number; w: number; h: number } {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
}

/** Number of annotations across all pages. */
export const annotationCount = (model: PdfModel): number =>
  model.pages.reduce((sum, page) => sum + page.annotations.length, 0)

/** Linear undo/redo over immutable values. */
export interface History<T> {
  readonly past: readonly T[]
  readonly present: T
  readonly future: readonly T[]
}

const HISTORY_LIMIT = 100

export const startHistory = <T>(present: T): History<T> => ({ past: [], present, future: [] })

export const pushHistory = <T>(h: History<T>, next: T): History<T> =>
  next === h.present ? h : { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] }

export const undoHistory = <T>(h: History<T>): History<T> =>
  h.past.length === 0
    ? h
    : { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] }

export const redoHistory = <T>(h: History<T>): History<T> =>
  h.future.length === 0
    ? h
    : { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) }

/**
 * A point inside the displayed (user-rotated) page, as fractions of its width/height, → the
 * unrotated normalized space annotations are stored in. Inverse of rotating the page clockwise.
 */
export function displayToBase(fx: number, fy: number, rotation: Rotation): Pt {
  switch (rotation) {
    case 90:
      return { x: fy, y: 1 - fx }
    case 180:
      return { x: 1 - fx, y: 1 - fy }
    case 270:
      return { x: 1 - fy, y: fx }
    default:
      return { x: fx, y: fy }
  }
}
