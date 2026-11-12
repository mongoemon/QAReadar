import { prepareForPreview } from '../lib/previewDoc'
import { MARKER_ATTR } from '../lib/sourceMap'
import { el } from './dom'

/**
 * Sandboxed live preview of pasted HTML. Clicking an element reports it through `onPick`.
 *
 * Safety: `sandbox="allow-same-origin"` without `allow-scripts` means page scripts never run
 * (so they cannot lift the sandbox); prepareForPreview adds a CSP and strips the tags that could
 * still navigate the frame or reach a remote host — the page renders from its own inline styles
 * only. Highlight boxes live outside the iframe so the analysed DOM is never modified (that
 * would change the locators we generate).
 */

const ELEMENT_NODE = 1

export interface Preview {
  readonly element: HTMLElement
  /** Replace the page. Clears any selection. */
  load(source: string): void
  /** Outline `target` (or nothing) as the selected element. */
  highlight(target: Element | null): void
  /** The element stamped with this source offset (see sourceMap.ts); null while loading or if absent. */
  findByMarker(marker: number): Element | null
  /** Scroll `target` into view and keep its outline in place. */
  reveal(target: Element): void
}

const buildSrcdoc = (source: string): string =>
  prepareForPreview(new DOMParser().parseFromString(source, 'text/html'))

function place(box: HTMLElement, target: Element | null): void {
  if (!target?.isConnected) {
    box.hidden = true
    return
  }
  const rect = target.getBoundingClientRect()
  box.hidden = rect.width === 0 && rect.height === 0
  box.style.left = `${rect.left}px`
  box.style.top = `${rect.top}px`
  box.style.width = `${rect.width}px`
  box.style.height = `${rect.height}px`
}

/** Event targets from inside the iframe are a different realm, so `instanceof Element` cannot be used. */
const elementTarget = (ev: Event, doc: Document): Element | null => {
  const target = ev.target as Node | null
  return target?.nodeType === ELEMENT_NODE && target !== doc.documentElement ? (target as Element) : null
}

export function createPreview(onPick: (target: Element) => void): Preview {
  const frame = el('iframe', { class: 'loc-frame', sandbox: 'allow-same-origin', title: 'Page preview' })
  const hoverBox = el('div', { class: 'loc-box hover' })
  const pickedBox = el('div', { class: 'loc-box picked' })
  hoverBox.hidden = true
  pickedBox.hidden = true
  const element = el('div', { class: 'loc-stage' }, frame, hoverBox, pickedBox)
  let picked: Element | null = null
  // False while a new srcdoc is loading: the old document is still clickable until then, and a
  // pick from it would show locators for an element that is about to be discarded.
  let live = true

  const refresh = (): void => place(pickedBox, picked)

  function attach(doc: Document): void {
    doc.addEventListener(
      'click',
      (ev) => {
        ev.preventDefault()
        const target = elementTarget(ev, doc)
        if (live && target) onPick(target)
      },
      true,
    )
    doc.addEventListener('mouseover', (ev) => {
      if (live) place(hoverBox, elementTarget(ev, doc))
    })
    doc.addEventListener('mouseleave', () => {
      hoverBox.hidden = true
    })
    doc.addEventListener('scroll', refresh, true)
  }

  frame.addEventListener('load', () => {
    live = true
    if (frame.contentDocument) attach(frame.contentDocument)
  })
  window.addEventListener('resize', refresh)
  // Re-place the outline when the tab becomes visible again (layout is 0×0 while hidden).
  if ('ResizeObserver' in window) new ResizeObserver(refresh).observe(frame)

  return {
    element,
    load(source: string): void {
      const next = source.trim() === '' ? '' : buildSrcdoc(source)
      picked = null
      hoverBox.hidden = true
      pickedBox.hidden = true
      // Unchanged page: keep the loaded document (no reload, no flicker). Not every engine fires
      // `load` when srcdoc is set to the value it already has, and `live` is only restored by
      // that event — so reassigning here could leave the preview unclickable. If a load is still
      // pending, its own event restores `live`.
      if (next === frame.srcdoc) return
      live = false
      frame.srcdoc = next
    },
    highlight(target: Element | null): void {
      picked = target
      refresh()
    },
    findByMarker(marker: number): Element | null {
      if (!live) return null
      return frame.contentDocument?.querySelector(`[${MARKER_ATTR}="${marker}"]`) ?? null
    },
    reveal(target: Element): void {
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      refresh()
    },
  }
}
