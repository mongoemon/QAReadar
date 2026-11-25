import type { Command } from '../lib/commands'
import { openTextFile, saveBinaryFile, type DocSnapshot, type FileHandleLike, type OpenedFile, type SavedFile } from '../lib/fileAccess'
import { localized, t, type MessageKey } from '../lib/i18n'
import {
  addAnnotation,
  appendSource,
  deletePage,
  displayToBase,
  duplicatePage,
  EMPTY_MODEL,
  LINE_HEIGHT,
  movePage,
  nextId,
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
  type History,
  type PageEntry,
  type PdfModel,
  type Pt,
  type Rotation,
  type TextAnnotation,
} from '../lib/pdfModel'
import { shortcutLabel, withShortcuts } from '../lib/shortcuts'
import { el } from './dom'
import { iconButton, type IconName } from './icons'
import { showMenu } from './menu'
import { loadPdf, pageSize, releasePdf, startRender, type PDFDocumentProxy, type RenderTask } from './pdfEngine'
import {
  buildEdited,
  exportAllImages,
  exportPageImage,
  exportPdfCopy,
  exportText,
  PDF_KIND,
  type ExportInput,
} from './pdfExportActions'
import { errorMessage, toast } from './toast'
import type { TabController } from './types'

type Tool = 'select' | 'text' | 'highlight' | 'rect' | 'cover' | 'pen'

const DEFAULT_NAME = 'document.pdf'
/** CSS pixels per PDF point at pdf.js's "100%". */
const CSS_PER_PT = 96 / 72
const MIN_ZOOM = 0.25
const MAX_ZOOM = 6
/** Largest zoom chosen automatically when a file opens (1.25 × pdf.js's 100%). */
const OPEN_MAX_ZOOM = CSS_PER_PT * 1.25
const ZOOM_STEP = 1.2
const STAGE_PADDING_PX = 24
const THUMB_WIDTH_PX = 92
const PEN_WIDTH_PT = 2
const MIN_SHAPE = 0.004
const TEXT_SIZES: readonly number[] = [10, 12, 14, 18, 24, 36, 48]
const SVG_NS = 'http://www.w3.org/2000/svg'

const TOOLS: ReadonlyArray<{ id: Tool; icon: IconName; tip: MessageKey }> = [
  { id: 'select', icon: 'mouse', tip: 'pdf.tool.select' },
  { id: 'text', icon: 'type', tip: 'pdf.tool.text' },
  { id: 'highlight', icon: 'highlighter', tip: 'pdf.tool.highlight' },
  { id: 'rect', icon: 'square', tip: 'pdf.tool.rect' },
  { id: 'cover', icon: 'eraser', tip: 'pdf.tool.cover' },
  { id: 'pen', icon: 'pen', tip: 'pdf.tool.pen' },
]

const DEFAULT_COLORS: Readonly<Record<Tool, string>> = {
  select: '#e53935',
  text: '#111111',
  highlight: '#ffe600',
  rect: '#e53935',
  cover: '#ffffff',
  pen: '#e53935',
}

/** A page box turned by the user's rotation: the size it takes up and the CSS to place it. */
function rotatedBox(w: number, h: number, rotation: Rotation): { width: number; height: number; transform: string } {
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

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))
const pageKey = (page: PageEntry): string => `${page.source}:${page.index}`
const nearestSize = (pt: number): number =>
  TEXT_SIZES.reduce((best, size) => (Math.abs(size - pt) < Math.abs(best - pt) ? size : best), TEXT_SIZES[0])
const toolOf = (a: Annotation): Tool => (a.kind === 'pen' ? 'pen' : a.kind)

type Gesture =
  | { readonly kind: 'drag'; readonly original: Annotation; readonly start: Pt }
  | { readonly kind: 'box'; readonly tool: 'highlight' | 'rect' | 'cover'; readonly start: Pt }
  | { readonly kind: 'pen'; readonly points: Pt[] }

interface PageDims {
  /** Displayed size at scale 1, in PDF points (built-in rotation applied). */
  readonly w: number
  readonly h: number
}

export function createPdfTab(): TabController {
  // ── document state ──
  let sources: Uint8Array[] = []
  let docs: PDFDocumentProxy[] = []
  let history: History<PdfModel> = startHistory(EMPTY_MODEL)
  let savedModel: PdfModel = EMPTY_MODEL
  let name = DEFAULT_NAME
  let handle: FileHandleLike | null = null
  const dimsCache = new Map<string, PageDims>()
  const listeners: Array<() => void> = []

  // ── view state ──
  let current = 0
  let zoom = CSS_PER_PT
  let tool: Tool = 'select'
  const colors: Record<Tool, string> = { ...DEFAULT_COLORS }
  let textPt = 14
  let selected: number | null = null
  let draft: Annotation | null = null
  let gesture: Gesture | null = null
  let editor: { commit(): void } | null = null
  let pendingFit = false
  let busy = false
  let renderSeq = 0
  let renderTask: RenderTask | null = null
  let paintedKey = ''
  let thumbSignature = ''
  const thumbCache = new Map<string, string>()

  const model = (): PdfModel => history.present
  const hasDoc = (): boolean => docs.length > 0
  const entry = (): PageEntry | undefined => model().pages[current]
  const notify = (): void => listeners.forEach((listener) => listener())
  const selectedMark = (): Annotation | undefined =>
    selected === null ? undefined : entry()?.annotations.find((a) => a.id === selected)

  // ── elements ──
  const canvas = el('canvas', { class: 'pdf-canvas' })
  const overlay = el('div', { class: 'pdf-overlay' })
  const pageBox = el('div', { class: 'pdf-page' }, canvas, overlay)
  const holder = el('div', { class: 'pdf-holder' }, pageBox)
  const emptyNote = el('p', { class: 'pdf-empty' })
  const stage = el('div', { class: 'pdf-stage' }, emptyNote, holder)
  const thumbs = el('div', { class: 'pdf-thumbs', role: 'list' })
  const body = el('div', { class: 'pdf-body' }, thumbs, stage)

  const toolButtons = new Map<Tool, HTMLButtonElement>()
  const toolGroup = el('div', { class: 'btn-group' })
  for (const spec of TOOLS) {
    const button = iconButton(spec.icon, () => t(spec.tip), { variant: 'ghost', attrs: { 'aria-pressed': 'false' } })
    button.addEventListener('click', () => setTool(spec.id))
    toolButtons.set(spec.id, button)
    toolGroup.append(button)
  }
  const colorInput = el('input', { class: 'pdf-color', type: 'color', value: colors.text })
  const sizeSelect = el('select', { class: 'json-select pdf-size' })
  for (const size of TEXT_SIZES) sizeSelect.append(el('option', { value: String(size) }, `${size} pt`))
  sizeSelect.value = String(textPt)
  const deleteMarkBtn = iconButton('close', () => t('pdf.deleteAnn'), { variant: 'ghost' })
  const undoBtn = iconButton('undo', () => t('pdf.undo'), { variant: 'ghost', shortcut: () => shortcutLabel('pdf.undo') })
  const redoBtn = iconButton('redo', () => t('pdf.redo'), { variant: 'ghost', shortcut: () => shortcutLabel('pdf.redo') })
  const prevBtn = iconButton('chevronUp', () => t('pdf.prevPage'), { variant: 'ghost', shortcut: () => shortcutLabel('pdf.prev') })
  const nextBtn = iconButton('chevronDown', () => t('pdf.nextPage'), { variant: 'ghost', shortcut: () => shortcutLabel('pdf.next') })
  const pageLabel = el('span', { class: 'pdf-page-label hint' })
  const rotateCcwBtn = iconButton('rotateCcw', () => t('pdf.rotateCcw'), { variant: 'ghost' })
  const rotateCwBtn = iconButton('rotateCw', () => t('pdf.rotateCw'), { variant: 'ghost' })
  const moveUpBtn = iconButton('arrowUp', () => t('pdf.moveUp'), { variant: 'ghost' })
  const moveDownBtn = iconButton('arrowDown', () => t('pdf.moveDown'), { variant: 'ghost' })
  const duplicateBtn = iconButton('duplicate', () => t('pdf.duplicate'), { variant: 'ghost' })
  const deletePageBtn = iconButton('trash', () => t('pdf.deletePage'), { variant: 'ghost' })
  const zoomOutBtn = iconButton('zoomOut', () => t('pdf.zoomOut'), { variant: 'ghost' })
  const zoomInBtn = iconButton('zoomIn', () => t('pdf.zoomIn'), { variant: 'ghost' })
  const zoomBtn = el('button', { class: 'btn ghost small pdf-zoom', type: 'button' })
  const insertBtn = iconButton('filePlus', () => t('pdf.insert'), { variant: 'ghost' })
  const exportBtn = iconButton('download', () => t('pdf.export'), { variant: 'ghost', text: () => t('pdf.export'), attrs: { 'aria-haspopup': 'menu' } })

  const sep = (): HTMLElement => el('span', { class: 'pdf-sep', 'aria-hidden': 'true' })
  const bar = el(
    'div',
    { class: 'pane-bar pdf-bar' },
    toolGroup, colorInput, sizeSelect, deleteMarkBtn, sep(),
    undoBtn, redoBtn, sep(),
    prevBtn, pageLabel, nextBtn, sep(),
    rotateCcwBtn, rotateCwBtn, moveUpBtn, moveDownBtn, duplicateBtn, deletePageBtn, sep(),
    zoomOutBtn, zoomBtn, zoomInBtn, sep(),
    insertBtn, exportBtn,
  )
  const element = el('section', { class: 'pane pdf-pane', tabindex: '-1' }, bar, body)
  element.hidden = true

  // ── model changes ──
  const finishEditing = (): void => editor?.commit()

  function commit(next: PdfModel): void {
    const updated = pushHistory(history, next)
    if (updated === history) return
    history = updated
    afterModelChange()
  }

  function afterModelChange(): void {
    current = clamp(current, 0, Math.max(0, model().pages.length - 1))
    if (selected !== null && !selectedMark()) selected = null
    renderThumbs()
    void show()
    updateChrome()
    notify()
  }

  function undo(): void {
    finishEditing()
    history = undoHistory(history)
    afterModelChange()
  }

  function redo(): void {
    finishEditing()
    history = redoHistory(history)
    afterModelChange()
  }

  function goTo(index: number): void {
    if (!hasDoc()) return
    finishEditing()
    const next = clamp(index, 0, model().pages.length - 1)
    if (next === current) return
    current = next
    selected = null
    void show()
    updateChrome()
  }

  function setTool(next: Tool): void {
    finishEditing()
    tool = next
    if (next !== 'select') selected = null
    paintAnnotations()
    updateChrome()
  }

  function select(id: number | null): void {
    selected = id
    const picked = selectedMark()
    if (picked) {
      colors[toolOf(picked)] = picked.color
      const dims = dimsOfCached(entry())
      if (picked.kind === 'text' && dims) textPt = nearestSize(picked.size * dims.h)
    }
    paintAnnotations()
    updateChrome()
  }

  // ── page geometry ──
  const dimsOfCached = (page: PageEntry | undefined): PageDims | undefined => (page ? dimsCache.get(pageKey(page)) : undefined)

  async function dimsOf(page: PageEntry): Promise<PageDims> {
    const key = pageKey(page)
    const known = dimsCache.get(key)
    if (known) return known
    const size = await pageSize(docs[page.source], page.index, 1)
    const dims = { w: size.width, h: size.height }
    dimsCache.set(key, dims)
    return dims
  }

  /**
   * Fit the page to the stage width (the zoom button). `whole` is for opening a file: fit the
   * whole page and never enlarge past OPEN_MAX_ZOOM, so a small page is not blown up on a wide screen.
   */
  async function fitZoom(whole = false): Promise<void> {
    const page = entry()
    if (!page || stage.clientWidth === 0) return
    const dims = await dimsOf(page)
    const sideways = page.rotation === 90 || page.rotation === 270
    const widthPt = sideways ? dims.h : dims.w
    const heightPt = sideways ? dims.w : dims.h
    const byWidth = (stage.clientWidth - STAGE_PADDING_PX * 2) / widthPt
    const byHeight = (stage.clientHeight - STAGE_PADDING_PX * 2) / heightPt
    zoom = whole
      ? clamp(Math.min(byWidth, byHeight > 0 ? byHeight : byWidth, OPEN_MAX_ZOOM), MIN_ZOOM, MAX_ZOOM)
      : clamp(byWidth, MIN_ZOOM, MAX_ZOOM)
    pendingFit = false
    paintedKey = ''
    void show()
    updateChrome()
  }

  function setZoom(next: number): void {
    finishEditing()
    zoom = clamp(next, MIN_ZOOM, MAX_ZOOM)
    void show()
    updateChrome()
  }

  /** Show the current page: size and rotate the page box, paint the marks, (re)render pixels if needed. */
  async function show(): Promise<void> {
    const seq = ++renderSeq
    const page = entry()
    emptyNote.hidden = hasDoc()
    holder.hidden = !hasDoc() || !page
    if (!page) return
    if (pendingFit && stage.clientWidth > 0) {
      await fitZoom(true)
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
    paintAnnotations()

    const key = `${pageKey(page)}@${zoom.toFixed(4)}`
    if (key === paintedKey) return
    paintedKey = key
    renderTask?.cancel()
    try {
      const task = await startRender(docs[page.source], page.index, zoom, canvas)
      renderTask = task
      await task.promise
    } catch (error) {
      if (!(error instanceof Error && error.name === 'RenderingCancelledException')) {
        paintedKey = ''
        toast(errorMessage(error), true)
      }
    }
  }

  // ── marks on the page ──
  function annotationNode(a: Annotation, w: number, h: number): HTMLElement | SVGElement {
    const mark = (cls: string): string => `pdf-mark ${cls}${a.id === selected ? ' selected' : ''}`
    if (a.kind === 'pen') {
      const svg = document.createElementNS(SVG_NS, 'svg')
      svg.setAttribute('class', 'pdf-pen')
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
      const line = document.createElementNS(SVG_NS, 'polyline')
      line.setAttribute('class', mark('pen'))
      line.setAttribute('data-id', String(a.id))
      line.setAttribute('points', a.points.map((p) => `${p.x * w},${p.y * h}`).join(' '))
      line.setAttribute('stroke', a.color)
      line.setAttribute('stroke-width', String(Math.max(0.5, a.width * w)))
      line.setAttribute('stroke-linecap', 'round')
      line.setAttribute('stroke-linejoin', 'round')
      line.setAttribute('fill', 'none')
      svg.append(line)
      return svg
    }
    if (a.kind === 'text') {
      const node = el('div', { class: mark('text'), 'data-id': String(a.id) }, a.text)
      node.style.left = `${a.x * 100}%`
      node.style.top = `${a.y * 100}%`
      node.style.fontSize = `${a.size * h}px`
      node.style.lineHeight = String(LINE_HEIGHT)
      node.style.color = a.color
      return node
    }
    const node = el('div', { class: mark(a.kind), 'data-id': String(a.id) })
    node.style.left = `${a.x * 100}%`
    node.style.top = `${a.y * 100}%`
    node.style.width = `${a.w * 100}%`
    node.style.height = `${a.h * 100}%`
    if (a.kind === 'rect') node.style.borderColor = a.color
    else node.style.backgroundColor = a.color
    return node
  }

  function paintAnnotations(): void {
    const page = entry()
    const dims = dimsOfCached(page)
    overlay.classList.toggle('drawing', tool !== 'select')
    if (!page || !dims) {
      overlay.replaceChildren()
      return
    }
    const w = dims.w * zoom
    const h = dims.h * zoom
    const marks = page.annotations.map((a) => (draft && draft.id === a.id ? draft : a))
    if (draft && !marks.includes(draft)) marks.push(draft)
    overlay.replaceChildren(...marks.map((a) => annotationNode(a, w, h)))
  }

  /** Pointer position → page space (unrotated, 0..1). */
  function toPage(ev: PointerEvent | MouseEvent): Pt {
    const rect = holder.getBoundingClientRect()
    const fx = clamp((ev.clientX - rect.left) / rect.width, 0, 1)
    const fy = clamp((ev.clientY - rect.top) / rect.height, 0, 1)
    return displayToBase(fx, fy, entry()?.rotation ?? 0)
  }

  function startTextEditor(existing: TextAnnotation | undefined, at: Pt): void {
    const page = entry()
    const dims = dimsOfCached(page)
    if (!page || !dims) return
    finishEditing()
    const color = existing?.color ?? colors.text
    const sizeFraction = existing?.size ?? textPt / dims.h
    const x = existing?.x ?? at.x
    const y = existing?.y ?? at.y
    const area = el('textarea', { class: 'pdf-text-editor', placeholder: t('pdf.textPlaceholder'), rows: '1', spellcheck: 'false' })
    area.value = existing?.text ?? ''
    area.style.left = `${x * 100}%`
    area.style.top = `${y * 100}%`
    area.style.fontSize = `${sizeFraction * dims.h * zoom}px`
    area.style.lineHeight = String(LINE_HEIGHT)
    area.style.color = color
    const grow = (): void => {
      area.rows = Math.max(1, area.value.split('\n').length)
    }
    let done = false
    const finish = (save: boolean): void => {
      if (done) return
      done = true
      editor = null
      const text = area.value.replace(/\s+$/, '')
      area.remove()
      if (!save) return paintAnnotations()
      if (existing) {
        commit(text === '' ? removeAnnotation(model(), current, existing.id) : updateAnnotation(model(), current, { ...existing, text }))
      } else if (text !== '') {
        const added: TextAnnotation = { id: nextId(), kind: 'text', x, y, text, size: sizeFraction, color }
        commit(addAnnotation(model(), current, added))
        select(added.id)
      } else {
        paintAnnotations()
      }
    }
    editor = { commit: () => finish(true) }
    area.addEventListener('input', grow)
    area.addEventListener('blur', () => finish(true))
    area.addEventListener('keydown', (ev) => {
      ev.stopPropagation()
      if (ev.key === 'Escape') finish(false)
      else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) finish(true)
    })
    area.addEventListener('pointerdown', (ev) => ev.stopPropagation())
    overlay.append(area)
    grow()
    area.focus()
  }

  // ── pointer gestures ──
  const findMark = (id: number): Annotation | undefined => entry()?.annotations.find((a) => a.id === id)
  const markAt = (target: EventTarget | null): Annotation | undefined => {
    const node = target instanceof Element ? target.closest('[data-id]') : null
    return node ? findMark(Number(node.getAttribute('data-id'))) : undefined
  }

  function updateDraft(at: Pt): void {
    if (!gesture) return
    if (gesture.kind === 'drag') {
      draft = translateAnnotation(gesture.original, at.x - gesture.start.x, at.y - gesture.start.y)
    } else if (gesture.kind === 'pen') {
      gesture.points.push(at)
      const dims = dimsOfCached(entry())
      draft = { id: -1, kind: 'pen', points: [...gesture.points], width: PEN_WIDTH_PT / (dims?.w ?? 600), color: colors.pen }
    } else {
      draft = { id: -1, kind: gesture.tool, ...rectFrom(gesture.start, at), color: colors[gesture.tool] }
    }
    paintAnnotations()
  }

  overlay.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || !entry() || editor) return
    element.focus({ preventScroll: true })
    const at = toPage(ev)
    const hit = markAt(ev.target)
    if (tool === 'text') {
      ev.preventDefault()
      startTextEditor(hit?.kind === 'text' ? hit : undefined, at)
      return
    }
    if (tool === 'select') {
      if (!hit) return select(null)
      select(hit.id)
      gesture = { kind: 'drag', original: hit, start: at }
      overlay.setPointerCapture(ev.pointerId)
      return
    }
    overlay.setPointerCapture(ev.pointerId)
    gesture = tool === 'pen' ? { kind: 'pen', points: [] } : { kind: 'box', tool, start: at }
    updateDraft(at)
  })

  overlay.addEventListener('pointermove', (ev) => {
    if (gesture) updateDraft(toPage(ev))
  })

  const isBigEnough = (a: Annotation): boolean => a.kind === 'pen' || (a.kind !== 'text' && a.w > MIN_SHAPE && a.h > MIN_SHAPE)

  function endGesture(ev: PointerEvent, cancelled: boolean): void {
    if (!gesture) return
    const finished = draft
    const dragging = gesture.kind === 'drag'
    gesture = null
    draft = null
    if (overlay.hasPointerCapture(ev.pointerId)) overlay.releasePointerCapture(ev.pointerId)
    if (cancelled || !finished) return paintAnnotations()
    if (dragging) commit(updateAnnotation(model(), current, finished))
    else if (isBigEnough(finished)) commit(addAnnotation(model(), current, { ...finished, id: nextId() }))
    else paintAnnotations()
  }
  overlay.addEventListener('pointerup', (ev) => endGesture(ev, false))
  overlay.addEventListener('pointercancel', (ev) => endGesture(ev, true))
  overlay.addEventListener('dblclick', (ev) => {
    const hit = markAt(ev.target)
    if (hit?.kind === 'text') startTextEditor(hit, toPage(ev))
  })

  // ── thumbnails ──
  const observer = new IntersectionObserver((items) => {
    for (const item of items) {
      if (!item.isIntersecting) continue
      observer.unobserve(item.target)
      void fillThumb(item.target as HTMLElement)
    }
  })

  async function fillThumb(item: HTMLElement): Promise<void> {
    const page = model().pages[Number(item.dataset.at)]
    if (!page) return
    const key = pageKey(page)
    const dims = await dimsOf(page)
    const scale = THUMB_WIDTH_PX / dims.w
    let url = thumbCache.get(key)
    if (!url) {
      const scratch = document.createElement('canvas')
      try {
        await (await startRender(docs[page.source], page.index, scale, scratch)).promise
      } catch {
        return
      }
      url = scratch.toDataURL('image/jpeg', 0.7)
      thumbCache.set(key, url)
    }
    const frame = item.querySelector<HTMLElement>('.pdf-thumb-frame')
    if (!item.isConnected || !frame) return
    const box = rotatedBox(dims.w * scale, dims.h * scale, page.rotation)
    const img = el('img', { class: 'pdf-thumb-img', src: url, alt: '', draggable: 'false' })
    img.style.width = `${dims.w * scale}px`
    img.style.height = `${dims.h * scale}px`
    img.style.transform = box.transform
    frame.style.width = `${box.width}px`
    frame.style.height = `${box.height}px`
    frame.replaceChildren(img)
  }

  function renderThumbs(): void {
    const pages = model().pages
    const signature = pages.map((p) => `${p.id}:${p.rotation}`).join(',')
    if (signature === thumbSignature) return markActiveThumb()
    thumbSignature = signature
    observer.disconnect()
    thumbs.replaceChildren(
      ...pages.map((_, at) => {
        const frame = el('span', { class: 'pdf-thumb-frame' })
        frame.style.width = `${THUMB_WIDTH_PX}px`
        frame.style.height = `${Math.round(THUMB_WIDTH_PX * 1.3)}px`
        const item = el('button', { class: 'pdf-thumb', type: 'button', role: 'listitem', 'data-at': String(at) }, frame, el('span', { class: 'pdf-thumb-no' }, String(at + 1)))
        item.addEventListener('click', () => goTo(at))
        observer.observe(item)
        return item
      }),
    )
    markActiveThumb()
  }

  function markActiveThumb(): void {
    thumbs.querySelectorAll<HTMLElement>('.pdf-thumb').forEach((item) => {
      const active = Number(item.dataset.at) === current
      item.classList.toggle('active', active)
      item.setAttribute('aria-current', String(active))
      if (active) item.scrollIntoView({ block: 'nearest' })
    })
  }

  // ── toolbar state ──
  function updateChrome(): void {
    const pages = model().pages.length
    const has = hasDoc()
    const picked = selectedMark()
    for (const [id, button] of toolButtons) {
      button.setAttribute('aria-pressed', String(id === tool))
      button.disabled = !has
    }
    colorInput.value = picked?.color ?? colors[tool]
    colorInput.disabled = !has || (tool === 'select' && !picked)
    sizeSelect.value = String(textPt)
    sizeSelect.disabled = !has || !(tool === 'text' || picked?.kind === 'text')
    deleteMarkBtn.disabled = selected === null
    undoBtn.disabled = history.past.length === 0
    redoBtn.disabled = history.future.length === 0
    prevBtn.disabled = !has || current === 0
    nextBtn.disabled = !has || current >= pages - 1
    pageLabel.textContent = has ? t('pdf.pageOf', { n: current + 1, total: pages }) : ''
    for (const button of [rotateCcwBtn, rotateCwBtn, duplicateBtn, zoomInBtn, zoomOutBtn, insertBtn, exportBtn]) button.disabled = !has || busy
    moveUpBtn.disabled = !has || current === 0
    moveDownBtn.disabled = !has || current >= pages - 1
    deletePageBtn.disabled = !has || pages <= 1
    zoomBtn.disabled = !has
    zoomBtn.textContent = `${Math.round((zoom / CSS_PER_PT) * 100)}%`
    zoomBtn.title = t('pdf.fit')
    emptyNote.textContent = t('pdf.empty')
    markActiveThumb()
  }

  // ── actions ──
  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return
    busy = true
    element.classList.add('busy')
    updateChrome()
    try {
      await action()
    } catch (error) {
      toast(errorMessage(error), true)
    } finally {
      busy = false
      element.classList.remove('busy')
      updateChrome()
    }
  }

  const exportInput = (): ExportInput => ({ sources, docs, model: model(), baseName: name.replace(/\.pdf$/i, '') || 'document' })
  const reportSaved = (saved: string | null): void => {
    if (saved) toast(t('pdf.exported', { name: saved }))
  }

  function openExportMenu(): void {
    finishEditing()
    const at = current
    const job = (action: () => Promise<string | null>) => (): void => void run(async () => reportSaved(await action()))
    showMenu(
      [
        { label: t('pdf.exp.pdf'), icon: 'filePdf', run: job(() => exportPdfCopy(exportInput())) },
        { label: t('pdf.exp.png'), icon: 'fileText', run: job(() => exportPageImage(exportInput(), at, false)) },
        { label: t('pdf.exp.jpg'), icon: 'fileText', run: job(() => exportPageImage(exportInput(), at, true)) },
        {
          label: t('pdf.exp.allPng'),
          icon: 'fileText',
          run: () =>
            void run(async () => {
              const count = await exportAllImages(exportInput())
              if (count !== null) toast(t('pdf.exportedMany', { n: count }))
            }),
        },
        { label: t('pdf.exp.txt'), icon: 'notepad', run: job(() => exportText(exportInput(), false)) },
        { label: t('pdf.exp.md'), icon: 'notepad', run: job(() => exportText(exportInput(), true)) },
      ],
      exportBtn,
      t('pdf.export'),
    )
  }

  async function insertPdf(): Promise<void> {
    const file = await openTextFile([PDF_KIND])
    if (!file) return
    if (!file.bytes) throw new Error(t('msg.unsupported', { name: file.name }))
    const doc = await loadPdf(file.bytes)
    const source = sources.length
    sources = [...sources, file.bytes]
    docs = [...docs, doc]
    const first = model().pages.length
    commit(appendSource(model(), source, doc.numPages))
    goTo(first)
  }

  async function loadDocument(file: OpenedFile, bytes: Uint8Array): Promise<void> {
    const doc = await loadPdf(bytes)
    finishEditing()
    renderTask?.cancel()
    for (const old of docs) releasePdf(old)
    sources = [bytes]
    docs = [doc]
    dimsCache.clear()
    thumbCache.clear()
    thumbSignature = ''
    paintedKey = ''
    const fresh = appendSource(EMPTY_MODEL, 0, doc.numPages)
    history = startHistory(fresh)
    savedModel = fresh
    name = file.name
    handle = file.handle
    current = 0
    selected = null
    draft = null
    pendingFit = true
    renderThumbs()
    await show()
    updateChrome()
    notify()
  }

  const removeSelectedMark = (): void => {
    if (selected === null) return
    const id = selected
    selected = null
    commit(removeAnnotation(model(), current, id))
  }

  function shiftPage(by: number): void {
    const target = current + by
    const next = movePage(model(), current, target)
    if (next === model()) return
    current = target
    commit(next)
  }

  /** Colour / size changes apply to the selected mark as well as to what is drawn next. */
  colorInput.addEventListener('input', () => {
    const picked = selectedMark()
    if (picked) commit(updateAnnotation(model(), current, { ...picked, color: colorInput.value }))
    else if (tool !== 'select') colors[tool] = colorInput.value
  })
  sizeSelect.addEventListener('change', () => {
    textPt = Number(sizeSelect.value)
    const picked = selectedMark()
    const dims = dimsOfCached(entry())
    if (picked?.kind === 'text' && dims) commit(updateAnnotation(model(), current, { ...picked, size: textPt / dims.h }))
  })

  deleteMarkBtn.addEventListener('click', removeSelectedMark)
  undoBtn.addEventListener('click', undo)
  redoBtn.addEventListener('click', redo)
  prevBtn.addEventListener('click', () => goTo(current - 1))
  nextBtn.addEventListener('click', () => goTo(current + 1))
  rotateCcwBtn.addEventListener('click', () => commit(rotatePage(model(), current, false)))
  rotateCwBtn.addEventListener('click', () => commit(rotatePage(model(), current, true)))
  moveUpBtn.addEventListener('click', () => shiftPage(-1))
  moveDownBtn.addEventListener('click', () => shiftPage(1))
  duplicateBtn.addEventListener('click', () => {
    const next = duplicatePage(model(), current)
    current += 1
    commit(next)
  })
  deletePageBtn.addEventListener('click', () => {
    selected = null
    commit(deletePage(model(), current))
  })
  zoomOutBtn.addEventListener('click', () => setZoom(zoom / ZOOM_STEP))
  zoomInBtn.addEventListener('click', () => setZoom(zoom * ZOOM_STEP))
  zoomBtn.addEventListener('click', () => void fitZoom())
  insertBtn.addEventListener('click', () => void run(insertPdf))
  exportBtn.addEventListener('click', openExportMenu)

  stage.addEventListener(
    'wheel',
    (ev) => {
      if (!ev.ctrlKey || !hasDoc()) return
      ev.preventDefault()
      setZoom(zoom * (ev.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP))
    },
    { passive: false },
  )

  element.addEventListener('keydown', (ev) => {
    const target = ev.target
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && selected !== null) {
      ev.preventDefault()
      removeSelectedMark()
    } else if (ev.key === 'Escape') {
      select(null)
    }
  })

  // The tab is built while hidden: fit the first page once the stage has a real width.
  new ResizeObserver(() => {
    if (pendingFit && hasDoc() && stage.clientWidth > 0) void fitZoom(true)
  }).observe(stage)

  localized(updateChrome)
  withShortcuts(updateChrome)
  updateChrome()
  void show()

  const commands = (): Command[] => [
    { id: 'pdf.undo', title: t('pdf.cmd.undo'), run: undo },
    { id: 'pdf.redo', title: t('pdf.cmd.redo'), run: redo },
    { id: 'pdf.next', title: t('pdf.cmd.next'), run: () => goTo(current + 1) },
    { id: 'pdf.prev', title: t('pdf.cmd.prev'), run: () => goTo(current - 1) },
  ]

  return {
    id: 'pdf',
    get label() {
      return t('tab.pdf')
    },
    kind: PDF_KIND,
    element,
    commands,
    open(file: OpenedFile): void {
      if (!file.bytes) {
        toast(t('msg.unsupported', { name: file.name }), true)
        return
      }
      void loadDocument(file, file.bytes).catch((error: unknown) => toast(errorMessage(error), true))
    },
    async save(forceNew: boolean): Promise<SavedFile | null> {
      if (!hasDoc()) return null
      finishEditing()
      const bytes = await buildEdited(exportInput())
      return saveBinaryFile(name, bytes, PDF_KIND, handle, forceNew)
    },
    snapshot: (): DocSnapshot => ({ name, text: '', handle }),
    markSaved(savedName: string, savedHandle: FileHandleLike | null): void {
      name = savedName
      handle = savedHandle
      savedModel = model()
      notify()
    },
    isDirty: () => hasDoc() && history.present !== savedModel,
    onChange(listener: () => void): void {
      listeners.push(listener)
    },
  }
}
