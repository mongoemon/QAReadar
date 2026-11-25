// The marks drawn over a page, and the text box for writing on it.
import {
  addAnnotation,
  LINE_HEIGHT,
  nextId,
  removeAnnotation,
  updateAnnotation,
  type Annotation,
  type PageEntry,
  type PdfModel,
  type Pt,
  type TextAnnotation,
} from '../../lib/pdfModel'
import { t } from '../../lib/i18n'
import { el } from '../dom'
import type { PageDims } from './viewport'

export type Tool = 'select' | 'text' | 'highlight' | 'rect' | 'cover' | 'pen'

const SVG_NS = 'http://www.w3.org/2000/svg'

export interface LayerHost {
  entry(): PageEntry | undefined
  /** Index of the page being shown. */
  index(): number
  model(): PdfModel
  commit(next: PdfModel): void
  select(id: number | null): void
  selectedId(): number | null
  /** Size of the shown page, once known. */
  dims(): PageDims | undefined
  zoom(): number
  tool(): Tool
  textColor(): string
  /** Size for new text, in points. */
  textPt(): number
}

export interface AnnotationLayer {
  readonly element: HTMLElement
  paint(): void
  /** The mark being drawn or dragged, shown instead of (or besides) the saved ones. */
  setDraft(draft: Annotation | null): void
  draft(): Annotation | null
  markAt(target: EventTarget | null): Annotation | undefined
  startTextEditor(existing: TextAnnotation | undefined, at: Pt): void
  isEditing(): boolean
  /** Keep what is in the text box, if one is open. */
  finishEditing(): void
}

function penNode(a: Extract<Annotation, { kind: 'pen' }>, cls: string, w: number, h: number): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', 'pdf-pen')
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
  const line = document.createElementNS(SVG_NS, 'polyline')
  line.setAttribute('class', cls)
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

/** One mark for a page drawn `w` × `h` CSS pixels. */
function annotationNode(a: Annotation, selected: boolean, w: number, h: number): HTMLElement | SVGElement {
  const cls = `pdf-mark ${a.kind}${selected ? ' selected' : ''}`
  if (a.kind === 'pen') return penNode(a, cls, w, h)
  if (a.kind === 'text') {
    const node = el('div', { class: cls, 'data-id': String(a.id) }, a.text)
    node.style.left = `${a.x * 100}%`
    node.style.top = `${a.y * 100}%`
    node.style.fontSize = `${a.size * h}px`
    node.style.lineHeight = String(LINE_HEIGHT)
    node.style.color = a.color
    return node
  }
  const node = el('div', { class: cls, 'data-id': String(a.id) })
  node.style.left = `${a.x * 100}%`
  node.style.top = `${a.y * 100}%`
  node.style.width = `${a.w * 100}%`
  node.style.height = `${a.h * 100}%`
  if (a.kind === 'rect') node.style.borderColor = a.color
  else node.style.backgroundColor = a.color
  return node
}

export function createAnnotationLayer(host: LayerHost): AnnotationLayer {
  const element = el('div', { class: 'pdf-overlay' })
  let draft: Annotation | null = null
  let editor: { commit(): void } | null = null

  function paint(): void {
    const page = host.entry()
    const dims = host.dims()
    element.classList.toggle('drawing', host.tool() !== 'select')
    if (!page || !dims) {
      element.replaceChildren()
      return
    }
    const w = dims.w * host.zoom()
    const h = dims.h * host.zoom()
    const marks = page.annotations.map((a) => (draft && draft.id === a.id ? draft : a))
    if (draft && !marks.includes(draft)) marks.push(draft)
    element.replaceChildren(...marks.map((a) => annotationNode(a, a.id === host.selectedId(), w, h)))
  }

  const finishEditing = (): void => editor?.commit()

  function markAt(target: EventTarget | null): Annotation | undefined {
    const node = target instanceof Element ? target.closest('[data-id]') : null
    return node ? host.entry()?.annotations.find((a) => a.id === Number(node.getAttribute('data-id'))) : undefined
  }

  /** Save what was typed: update or remove an existing mark, or add a new one. */
  function applyText(text: string, existing: TextAnnotation | undefined, fresh: Omit<TextAnnotation, 'id' | 'kind' | 'text'>): void {
    const model = host.model()
    const at = host.index()
    if (existing) {
      host.commit(text === '' ? removeAnnotation(model, at, existing.id) : updateAnnotation(model, at, { ...existing, text }))
    } else if (text !== '') {
      const added: TextAnnotation = { id: nextId(), kind: 'text', text, ...fresh }
      host.commit(addAnnotation(model, at, added))
      host.select(added.id)
    } else {
      paint()
    }
  }

  function startTextEditor(existing: TextAnnotation | undefined, at: Pt): void {
    const dims = host.dims()
    if (!host.entry() || !dims) return
    finishEditing()
    const color = existing?.color ?? host.textColor()
    const size = existing?.size ?? host.textPt() / dims.h
    const x = existing?.x ?? at.x
    const y = existing?.y ?? at.y
    const area = el('textarea', { class: 'pdf-text-editor', placeholder: t('pdf.textPlaceholder'), rows: '1', spellcheck: 'false' })
    area.value = existing?.text ?? ''
    area.style.left = `${x * 100}%`
    area.style.top = `${y * 100}%`
    area.style.fontSize = `${size * dims.h * host.zoom()}px`
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
      if (!save) return paint()
      applyText(text, existing, { x, y, size, color })
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
    element.append(area)
    grow()
    area.focus()
  }

  return {
    element,
    paint,
    setDraft(next) {
      draft = next
    },
    draft: () => draft,
    markAt,
    startTextEditor,
    isEditing: () => editor !== null,
    finishEditing,
  }
}
