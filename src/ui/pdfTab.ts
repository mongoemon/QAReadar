// The PDF tab: document state, toolbar and the tab interface. The page itself lives in `pdf/`.
import type { Command } from '../lib/commands'
import { saveBinaryFile, type DocSnapshot, type FileHandleLike, type OpenedFile, type SavedFile } from '../lib/fileAccess'
import { localized, t, type MessageKey } from '../lib/i18n'
import {
  appendSource,
  deletePage,
  duplicatePage,
  EMPTY_MODEL,
  movePage,
  pushHistory,
  redoHistory,
  removeAnnotation,
  rotatePage,
  startHistory,
  undoHistory,
  updateAnnotation,
  type Annotation,
  type History,
  type PageEntry,
  type PdfModel,
} from '../lib/pdfModel'
import { shortcutLabel, withShortcuts } from '../lib/shortcuts'
import { el } from './dom'
import { iconButton, type IconName } from './icons'
import { createActions } from './pdf/actions'
import { createAnnotationLayer, type Tool } from './pdf/annotationLayer'
import { attachGestures } from './pdf/gestures'
import { createThumbnails } from './pdf/thumbnails'
import { clamp, createViewport } from './pdf/viewport'
import { loadPdf, releasePdf, type PDFDocumentProxy } from './pdfEngine'
import { buildEdited, PDF_KIND, type ExportInput } from './pdfExportActions'
import { errorMessage, toast } from './toast'
import type { TabController } from './types'

const DEFAULT_NAME = 'document.pdf'
const TEXT_SIZES: readonly number[] = [10, 12, 14, 18, 24, 36, 48]

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

const nearestSize = (pt: number): number =>
  TEXT_SIZES.reduce((best, size) => (Math.abs(size - pt) < Math.abs(best - pt) ? size : best), TEXT_SIZES[0])
const toolOf = (a: Annotation): Tool => (a.kind === 'pen' ? 'pen' : a.kind)

export function createPdfTab(): TabController {
  // ── document state ──
  let sources: Uint8Array[] = []
  let docs: PDFDocumentProxy[] = []
  let history: History<PdfModel> = startHistory(EMPTY_MODEL)
  let savedModel: PdfModel = EMPTY_MODEL
  let name = DEFAULT_NAME
  let handle: FileHandleLike | null = null
  const listeners: Array<() => void> = []

  // ── view state ──
  let current = 0
  let tool: Tool = 'select'
  const colors: Record<Tool, string> = { ...DEFAULT_COLORS }
  let textPt = 14
  let selected: number | null = null

  const model = (): PdfModel => history.present
  const hasDoc = (): boolean => docs.length > 0
  const entry = (): PageEntry | undefined => model().pages[current]
  const notify = (): void => listeners.forEach((listener) => listener())
  const selectedMark = (): Annotation | undefined =>
    selected === null ? undefined : entry()?.annotations.find((a) => a.id === selected)

  // ── page, marks and thumbnails ──
  const layer = createAnnotationLayer({
    entry,
    index: () => current,
    model,
    commit,
    select,
    selectedId: () => selected,
    dims: () => view.cachedDims(entry()),
    zoom: () => view.zoom(),
    tool: () => tool,
    textColor: () => colors.text,
    textPt: () => textPt,
  })
  const view = createViewport(
    { hasDoc, entry, doc: (source) => docs[source], paintMarks: layer.paint, changed: updateChrome, finishEditing: layer.finishEditing },
    layer.element,
  )
  const thumbnails = createThumbnails({
    pages: () => model().pages,
    current: () => current,
    doc: (source) => docs[source],
    dimsOf: view.dimsOf,
    goTo,
  })
  const body = el('div', { class: 'pdf-body' }, thumbnails.element, view.element)

  // ── toolbar ──
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

  const exportInput = (): ExportInput => ({ sources, docs, model: model(), baseName: name.replace(/\.pdf$/i, '') || 'document' })

  const actions = createActions({
    exportInput,
    current: () => current,
    finishEditing: layer.finishEditing,
    busyChanged(busy) {
      element.classList.toggle('busy', busy)
      updateChrome()
    },
    addSource(bytes, doc) {
      const source = sources.length
      sources = [...sources, bytes]
      docs = [...docs, doc]
      const first = model().pages.length
      commit(appendSource(model(), source, doc.numPages))
      goTo(first)
    },
  })

  attachGestures({
    layer,
    entry,
    index: () => current,
    model,
    commit,
    select,
    tool: () => tool,
    color: (of) => colors[of],
    dims: () => view.cachedDims(entry()),
    toPage: view.toPage,
    focus: () => element.focus({ preventScroll: true }),
  })

  // ── model changes ──
  function commit(next: PdfModel): void {
    const updated = pushHistory(history, next)
    if (updated === history) return
    history = updated
    afterModelChange()
  }

  function afterModelChange(): void {
    current = clamp(current, 0, Math.max(0, model().pages.length - 1))
    if (selected !== null && !selectedMark()) selected = null
    thumbnails.render()
    void view.show()
    updateChrome()
    notify()
  }

  function undo(): void {
    layer.finishEditing()
    history = undoHistory(history)
    afterModelChange()
  }

  function redo(): void {
    layer.finishEditing()
    history = redoHistory(history)
    afterModelChange()
  }

  function goTo(index: number): void {
    if (!hasDoc()) return
    layer.finishEditing()
    const next = clamp(index, 0, model().pages.length - 1)
    if (next === current) return
    current = next
    selected = null
    void view.show()
    updateChrome()
  }

  function setTool(next: Tool): void {
    layer.finishEditing()
    tool = next
    if (next !== 'select') selected = null
    layer.paint()
    updateChrome()
  }

  function select(id: number | null): void {
    selected = id
    const picked = selectedMark()
    if (picked) {
      colors[toolOf(picked)] = picked.color
      const dims = view.cachedDims(entry())
      if (picked.kind === 'text' && dims) textPt = nearestSize(picked.size * dims.h)
    }
    layer.paint()
    updateChrome()
  }

  // ── toolbar state ──
  function updateChrome(): void {
    const pages = model().pages.length
    const has = hasDoc()
    const busy = actions.isBusy()
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
    zoomBtn.textContent = `${view.percent()}%`
    zoomBtn.title = t('pdf.fit')
    view.renderEmptyNote()
    thumbnails.markActive()
  }

  // ── actions ──
  async function loadDocument(file: OpenedFile, bytes: Uint8Array): Promise<void> {
    const doc = await loadPdf(bytes)
    layer.finishEditing()
    view.reset()
    for (const old of docs) releasePdf(old)
    sources = [bytes]
    docs = [doc]
    thumbnails.reset()
    const fresh = appendSource(EMPTY_MODEL, 0, doc.numPages)
    history = startHistory(fresh)
    savedModel = fresh
    name = file.name
    handle = file.handle
    current = 0
    selected = null
    layer.setDraft(null)
    thumbnails.render()
    await view.show()
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
    const dims = view.cachedDims(entry())
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
  zoomOutBtn.addEventListener('click', view.zoomOut)
  zoomInBtn.addEventListener('click', view.zoomIn)
  zoomBtn.addEventListener('click', view.fitWidth)
  insertBtn.addEventListener('click', actions.insertPdf)
  exportBtn.addEventListener('click', () => actions.openExportMenu(exportBtn))

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

  localized(updateChrome)
  withShortcuts(updateChrome)
  updateChrome()
  void view.show()

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
      layer.finishEditing()
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
