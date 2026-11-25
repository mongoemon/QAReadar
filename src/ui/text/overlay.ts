// The editor surface of one split: textarea, line numbers, and the overlay drawn on top of it.
import { bounds, indexToVisual, visualToIndex, type Block } from '../../lib/columnSelection'
import { offsetToPos } from '../../lib/findReplace'
import { countLines, lineStartOffset } from '../../lib/textTools'
import { el } from '../dom'
import { scrollOffsetIntoView } from '../textareaScroll'

export const TAB_SIZE = 4

export interface Cell {
  readonly line: number
  readonly col: number
}

export interface Hit {
  readonly start: number
  readonly end: number
}

/** What the surface needs to know to draw itself. */
export interface OverlayHost {
  isWrap(): boolean
  getBlock(): Block | null
  /** Current find hit, drawn on the overlay so it stays visible while the find box has focus. */
  getHit(): Hit | null
}

export interface EditorSurface {
  readonly element: HTMLElement
  readonly input: HTMLTextAreaElement
  setWrapped(on: boolean): void
  renderGutter(): void
  renderOverlay(): void
  pointToCell(ev: MouseEvent): Cell
  offsetOf(line: number, col: number): number
  cellOf(offset: number): Cell
  scrollToOffset(offset: number): void
}

interface Metrics {
  readonly char: number
  readonly line: number
  readonly padL: number
  readonly padT: number
}

export function createEditorSurface(host: OverlayHost): EditorSurface {
  const input = el('textarea', { class: 'te-input', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off' })
  const gutterInner = el('div', { class: 'te-gutter-inner' })
  const gutter = el('div', { class: 'te-gutter', 'aria-hidden': 'true' }, gutterInner)
  const overlay = el('div', { class: 'te-overlay', 'aria-hidden': 'true' })
  const surface = el('div', { class: 'te-surface' }, input, overlay)
  const element = el('div', { class: 'te-editor' }, gutter, surface)

  // ── geometry (monospace font, wrap off) ──
  let charWidth = 0
  function metrics(): Metrics {
    const style = getComputedStyle(input)
    if (charWidth === 0) {
      const probe = el('span', { class: 'te-probe' }, 'M'.repeat(200))
      surface.append(probe)
      charWidth = probe.getBoundingClientRect().width / 200
      probe.remove()
    }
    return {
      char: charWidth || 7.5,
      line: Number.parseFloat(style.lineHeight) || 19,
      padL: Number.parseFloat(style.paddingLeft) || 0,
      padT: Number.parseFloat(style.paddingTop) || 0,
    }
  }

  const lines = (): string[] => input.value.split('\n')

  function pointToCell(ev: MouseEvent): Cell {
    const m = metrics()
    const box = input.getBoundingClientRect()
    const x = ev.clientX - box.left - m.padL + input.scrollLeft
    const y = ev.clientY - box.top - m.padT + input.scrollTop
    const count = countLines(input.value)
    return {
      line: Math.max(0, Math.min(count - 1, Math.floor(y / m.line))),
      col: Math.max(0, Math.round(x / m.char)),
    }
  }

  function offsetOf(line: number, col: number): number {
    const text = input.value
    const lineText = text.split('\n')[line] ?? ''
    return lineStartOffset(text, line + 1) + visualToIndex(lineText, col, TAB_SIZE).index
  }

  function cellOf(offset: number): Cell {
    const [line, column] = offsetToPos(input.value, offset)
    const lineText = lines()[line - 1] ?? ''
    return { line: line - 1, col: indexToVisual(lineText, column - 1, TAB_SIZE) }
  }

  function scrollToOffset(offset: number): void {
    if (host.isWrap()) {
      scrollOffsetIntoView(input, offset)
      return
    }
    const m = metrics()
    const { line, col } = cellOf(offset)
    const top = line * m.line
    if (top < input.scrollTop || top > input.scrollTop + input.clientHeight - m.line * 2) {
      input.scrollTop = Math.max(0, top - input.clientHeight / 3)
    }
    const left = col * m.char
    if (left < input.scrollLeft || left > input.scrollLeft + input.clientWidth - m.char * 4) {
      input.scrollLeft = Math.max(0, left - input.clientWidth / 2)
    }
  }

  // ── rendering ──
  let gutterCount = 0
  function renderGutter(): void {
    gutter.hidden = host.isWrap()
    if (host.isWrap()) return
    const count = countLines(input.value)
    if (count !== gutterCount) {
      gutterCount = count
      const numbers: string[] = []
      for (let n = 1; n <= count; n++) numbers.push(String(n))
      gutterInner.textContent = numbers.join('\n')
      gutter.style.setProperty('--digits', String(Math.max(2, String(count).length)))
    }
    gutterInner.style.transform = `translateY(${-input.scrollTop}px)`
  }

  function cellRect(cls: string, line: number, fromCol: number, toCol: number, m: Metrics): HTMLElement {
    const node = el('div', { class: cls })
    node.style.top = `${m.padT + line * m.line - input.scrollTop}px`
    node.style.left = `${m.padL + fromCol * m.char - input.scrollLeft}px`
    node.style.height = `${m.line}px`
    if (toCol > fromCol) node.style.width = `${(toCol - fromCol) * m.char}px`
    return node
  }

  /** Rectangles for the column selection and the find hit, for the visible lines only. */
  function overlayRects(block: Block | null, hit: Hit | null): HTMLElement[] {
    const m = metrics()
    const all = lines()
    const firstVisible = Math.floor(input.scrollTop / m.line) - 1
    const lastVisible = firstVisible + Math.ceil(input.clientHeight / m.line) + 2
    const nodes: HTMLElement[] = []
    if (block) {
      const b = bounds(block)
      const cls = b.left === b.right ? 'te-caret' : 'te-block'
      for (let n = Math.max(b.top, firstVisible); n <= Math.min(b.bottom, all.length - 1, lastVisible); n++) {
        nodes.push(cellRect(cls, n, b.left, b.right, m))
      }
    }
    if (hit) {
      const from = cellOf(hit.start)
      const to = cellOf(hit.end)
      for (let n = Math.max(from.line, firstVisible); n <= Math.min(to.line, lastVisible); n++) {
        const lineText = all[n] ?? ''
        const start = n === from.line ? from.col : 0
        const end = n === to.line ? to.col : indexToVisual(lineText, lineText.length, TAB_SIZE) + 1
        nodes.push(cellRect('te-hit', n, start, Math.max(end, start + 1), m))
      }
    }
    return nodes
  }

  function renderOverlay(): void {
    const block = host.getBlock()
    const hit = host.getHit()
    overlay.replaceChildren(...(!host.isWrap() && (block || hit) ? overlayRects(block, hit) : []))
    element.classList.toggle('te-has-block', block !== null)
  }

  input.addEventListener('scroll', () => {
    renderGutter()
    renderOverlay()
  })
  new ResizeObserver(() => renderOverlay()).observe(surface)

  return {
    element,
    input,
    setWrapped(on: boolean): void {
      input.wrap = on ? 'soft' : 'off'
      element.classList.toggle('te-wrap', on)
    },
    renderGutter,
    renderOverlay,
    pointToCell,
    offsetOf,
    cellOf,
    scrollToOffset,
  }
}
