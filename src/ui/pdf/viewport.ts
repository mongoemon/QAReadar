// The page on screen: its size, zoom, rotation and rendering.
import { displayToBase, type PageEntry, type Pt, type Rotation } from '../../lib/pdfModel'
import { t } from '../../lib/i18n'
import { el } from '../dom'
import { pageSize, startRender, type PDFDocumentProxy, type RenderTask } from '../pdfEngine'
import { errorMessage, toast } from '../toast'

/** CSS pixels per PDF point at pdf.js's "100%". */
const CSS_PER_PT = 96 / 72
const MIN_ZOOM = 0.25
const MAX_ZOOM = 6
/** Largest zoom chosen automatically when a file opens (1.25 × pdf.js's 100%). */
const OPEN_MAX_ZOOM = CSS_PER_PT * 1.25
const ZOOM_STEP = 1.2
const STAGE_PADDING_PX = 24

export interface PageDims {
  /** Displayed size at scale 1, in PDF points (built-in rotation applied). */
  readonly w: number
  readonly h: number
}

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))
export const pageKey = (page: PageEntry): string => `${page.source}:${page.index}`

/** A page box turned by the user's rotation: the size it takes up and the CSS to place it. */
export function rotatedBox(w: number, h: number, rotation: Rotation): { width: number; height: number; transform: string } {
  switch (rotation) {
    case 90:
      return { width: h, height: w, transform: `translate(${h}px, 0) rotate(90deg)` }
    case 180:
      return { width: w, height: h, transform: `translate(${w}px, ${h}px) rotate(180deg)` }
    case 270:
      return { width: h, height: w, transform: `translate(0, ${w}px) rotate(270deg)` }
    default:
      return { width: w, height: h, transform: '' }
  }
}

export interface ViewportHost {
  hasDoc(): boolean
  entry(): PageEntry | undefined
  doc(source: number): PDFDocumentProxy
  /** Redraw the marks after the page box changed. */
  paintMarks(): void
  /** The zoom changed: bring the toolbar up to date. */
  changed(): void
  finishEditing(): void
}

export interface Viewport {
  /** The scrolling stage that holds the page. */
  readonly element: HTMLElement
  zoom(): number
  /** Zoom as the percentage shown to the user. */
  percent(): number
  dimsOf(page: PageEntry): Promise<PageDims>
  cachedDims(page: PageEntry | undefined): PageDims | undefined
  /** Show the current page: size and rotate the page box, paint the marks, (re)render pixels if needed. */
  show(): Promise<void>
  /** Fit the page to the stage width (the zoom button). */
  fitWidth(): void
  zoomIn(): void
  zoomOut(): void
  /** Pointer position → page space (unrotated, 0..1). */
  toPage(ev: PointerEvent | MouseEvent): Pt
  /** Forget the previous file; the next page shown is fitted to the stage. */
  reset(): void
  renderEmptyNote(): void
}

/** `overlay` is the marks layer, stacked over the page's pixels. */
export function createViewport(host: ViewportHost, overlay: HTMLElement): Viewport {
  const canvas = el('canvas', { class: 'pdf-canvas' })
  const pageBox = el('div', { class: 'pdf-page' }, canvas, overlay)
  const holder = el('div', { class: 'pdf-holder' }, pageBox)
  const emptyNote = el('p', { class: 'pdf-empty' })
  const element = el('div', { class: 'pdf-stage' }, emptyNote, holder)

  const dimsCache = new Map<string, PageDims>()
  let zoom = CSS_PER_PT
  let pendingFit = false
  let renderSeq = 0
  let renderTask: RenderTask | null = null
  let paintedKey = ''

  const cachedDims = (page: PageEntry | undefined): PageDims | undefined => (page ? dimsCache.get(pageKey(page)) : undefined)

  async function dimsOf(page: PageEntry): Promise<PageDims> {
    const key = pageKey(page)
    const known = dimsCache.get(key)
    if (known) return known
    const size = await pageSize(host.doc(page.source), page.index, 1)
    const dims = { w: size.width, h: size.height }
    dimsCache.set(key, dims)
    return dims
  }

  /**
   * `whole` is for opening a file: fit the whole page and never enlarge past OPEN_MAX_ZOOM,
   * so a small page is not blown up on a wide screen.
   */
  async function fit(whole: boolean): Promise<void> {
    const page = host.entry()
    if (!page || element.clientWidth === 0) return
    const dims = await dimsOf(page)
    const sideways = page.rotation === 90 || page.rotation === 270
    const widthPt = sideways ? dims.h : dims.w
    const heightPt = sideways ? dims.w : dims.h
    const byWidth = (element.clientWidth - STAGE_PADDING_PX * 2) / widthPt
    const byHeight = (element.clientHeight - STAGE_PADDING_PX * 2) / heightPt
    zoom = whole
      ? clamp(Math.min(byWidth, byHeight > 0 ? byHeight : byWidth, OPEN_MAX_ZOOM), MIN_ZOOM, MAX_ZOOM)
      : clamp(byWidth, MIN_ZOOM, MAX_ZOOM)
    pendingFit = false
    paintedKey = ''
    void show()
    host.changed()
  }

  function setZoom(next: number): void {
    host.finishEditing()
    zoom = clamp(next, MIN_ZOOM, MAX_ZOOM)
    void show()
    host.changed()
  }

  async function render(page: PageEntry): Promise<void> {
    const key = `${pageKey(page)}@${zoom.toFixed(4)}`
    if (key === paintedKey) return
    paintedKey = key
    renderTask?.cancel()
    try {
      const task = await startRender(host.doc(page.source), page.index, zoom, canvas)
      renderTask = task
      await task.promise
    } catch (error) {
      if (!(error instanceof Error && error.name === 'RenderingCancelledException')) {
        paintedKey = ''
        toast(errorMessage(error), true)
      }
    }
  }

  async function show(): Promise<void> {
    const seq = ++renderSeq
    const page = host.entry()
    emptyNote.hidden = host.hasDoc()
    holder.hidden = !host.hasDoc() || !page
    if (!page) return
    if (pendingFit && element.clientWidth > 0) {
      await fit(true)
      return
    }
    const dims = await dimsOf(page)
    if (seq !== renderSeq) return
    const w = dims.w * zoom
    const h = dims.h * zoom
    const box = rotatedBox(w, h, page.rotation)
    holder.style.width = `${box.width}px`
    holder.style.height = `${box.height}px`
    pageBox.style.width = `${w}px`
    pageBox.style.height = `${h}px`
    pageBox.style.transform = box.transform
    host.paintMarks()
    await render(page)
  }

  function toPage(ev: PointerEvent | MouseEvent): Pt {
    const rect = holder.getBoundingClientRect()
    const fx = clamp((ev.clientX - rect.left) / rect.width, 0, 1)
    const fy = clamp((ev.clientY - rect.top) / rect.height, 0, 1)
    return displayToBase(fx, fy, host.entry()?.rotation ?? 0)
  }

  element.addEventListener(
    'wheel',
    (ev) => {
      if (!ev.ctrlKey || !host.hasDoc()) return
      ev.preventDefault()
      setZoom(zoom * (ev.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP))
    },
    { passive: false },
  )

  // The tab is built while hidden: fit the first page once the stage has a real width.
  new ResizeObserver(() => {
    if (pendingFit && host.hasDoc() && element.clientWidth > 0) void fit(true)
  }).observe(element)

  return {
    element,
    zoom: () => zoom,
    percent: () => Math.round((zoom / CSS_PER_PT) * 100),
    dimsOf,
    cachedDims,
    show,
    fitWidth: () => void fit(false),
    zoomIn: () => setZoom(zoom * ZOOM_STEP),
    zoomOut: () => setZoom(zoom / ZOOM_STEP),
    toPage,
    reset() {
      renderTask?.cancel()
      dimsCache.clear()
      paintedKey = ''
      pendingFit = true
    },
    renderEmptyNote() {
      emptyNote.textContent = t('pdf.empty')
    },
  }
}
