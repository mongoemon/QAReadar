// Mouse and pen on the page: drawing marks, dragging them, and opening the text box.
import {
  addAnnotation,
  nextId,
  rectFrom,
  translateAnnotation,
  updateAnnotation,
  type Annotation,
  type PageEntry,
  type PdfModel,
  type Pt,
} from '../../lib/pdfModel'
import type { AnnotationLayer, Tool } from './annotationLayer'
import type { PageDims } from './viewport'

const PEN_WIDTH_PT = 2
/** Boxes smaller than this fraction of the page are taken as stray clicks. */
const MIN_SHAPE = 0.004

type Gesture =
  | { readonly kind: 'drag'; readonly original: Annotation; readonly start: Pt }
  | { readonly kind: 'box'; readonly tool: 'highlight' | 'rect' | 'cover'; readonly start: Pt }
  | { readonly kind: 'pen'; readonly points: Pt[] }

export interface GestureHost {
  readonly layer: AnnotationLayer
  entry(): PageEntry | undefined
  index(): number
  model(): PdfModel
  commit(next: PdfModel): void
  select(id: number | null): void
  tool(): Tool
  color(tool: Tool): string
  dims(): PageDims | undefined
  toPage(ev: PointerEvent | MouseEvent): Pt
  /** Take keyboard focus, so Delete and Escape reach the tab. */
  focus(): void
}

const isBigEnough = (a: Annotation): boolean => a.kind === 'pen' || (a.kind !== 'text' && a.w > MIN_SHAPE && a.h > MIN_SHAPE)

export function attachGestures(host: GestureHost): void {
  const { layer } = host
  const surface = layer.element
  let gesture: Gesture | null = null

  function draftFor(current: Gesture, at: Pt): Annotation {
    if (current.kind === 'drag') {
      return translateAnnotation(current.original, at.x - current.start.x, at.y - current.start.y)
    }
    if (current.kind === 'pen') {
      current.points.push(at)
      const width = PEN_WIDTH_PT / (host.dims()?.w ?? 600)
      return { id: -1, kind: 'pen', points: [...current.points], width, color: host.color('pen') }
    }
    return { id: -1, kind: current.tool, ...rectFrom(current.start, at), color: host.color(current.tool) }
  }

  function updateDraft(at: Pt): void {
    if (!gesture) return
    layer.setDraft(draftFor(gesture, at))
    layer.paint()
  }

  function start(ev: PointerEvent): void {
    if (ev.button !== 0 || !host.entry() || layer.isEditing()) return
    host.focus()
    const at = host.toPage(ev)
    const hit = layer.markAt(ev.target)
    const tool = host.tool()
    if (tool === 'text') {
      ev.preventDefault()
      layer.startTextEditor(hit?.kind === 'text' ? hit : undefined, at)
      return
    }
    if (tool === 'select') {
      if (!hit) return host.select(null)
      host.select(hit.id)
      gesture = { kind: 'drag', original: hit, start: at }
      surface.setPointerCapture(ev.pointerId)
      return
    }
    surface.setPointerCapture(ev.pointerId)
    gesture = tool === 'pen' ? { kind: 'pen', points: [] } : { kind: 'box', tool, start: at }
    updateDraft(at)
  }

  function end(ev: PointerEvent, cancelled: boolean): void {
    if (!gesture) return
    const finished = layer.draft()
    const dragging = gesture.kind === 'drag'
    gesture = null
    layer.setDraft(null)
    if (surface.hasPointerCapture(ev.pointerId)) surface.releasePointerCapture(ev.pointerId)
    if (cancelled || !finished) return layer.paint()
    if (dragging) host.commit(updateAnnotation(host.model(), host.index(), finished))
    else if (isBigEnough(finished)) host.commit(addAnnotation(host.model(), host.index(), { ...finished, id: nextId() }))
    else layer.paint()
  }

  surface.addEventListener('pointerdown', start)
  surface.addEventListener('pointermove', (ev) => {
    if (gesture) updateDraft(host.toPage(ev))
  })
  surface.addEventListener('pointerup', (ev) => end(ev, false))
  surface.addEventListener('pointercancel', (ev) => end(ev, true))
  surface.addEventListener('dblclick', (ev) => {
    const hit = layer.markAt(ev.target)
    if (hit?.kind === 'text') layer.startTextEditor(hit, host.toPage(ev))
  })
}
