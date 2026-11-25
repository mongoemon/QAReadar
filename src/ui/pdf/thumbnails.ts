// The page thumbnails beside the stage, rendered only once they scroll into view.
import type { PageEntry } from '../../lib/pdfModel'
import { el } from '../dom'
import { startRender, type PDFDocumentProxy } from '../pdfEngine'
import { pageKey, rotatedBox, type PageDims } from './viewport'

const THUMB_WIDTH_PX = 92

export interface ThumbnailHost {
  pages(): readonly PageEntry[]
  current(): number
  doc(source: number): PDFDocumentProxy
  dimsOf(page: PageEntry): Promise<PageDims>
  goTo(index: number): void
}

export interface Thumbnails {
  readonly element: HTMLElement
  /** Rebuild when pages were added, removed, moved or rotated; otherwise just mark the current one. */
  render(): void
  markActive(): void
  /** Forget the previous file's pictures. */
  reset(): void
}

export function createThumbnails(host: ThumbnailHost): Thumbnails {
  const element = el('div', { class: 'pdf-thumbs', role: 'list' })
  const cache = new Map<string, string>()
  let signature = ''

  const observer = new IntersectionObserver((items) => {
    for (const item of items) {
      if (!item.isIntersecting) continue
      observer.unobserve(item.target)
      void fill(item.target as HTMLElement)
    }
  })

  /** The page as a JPEG data URL, rendered once per source page; null when rendering fails. */
  async function picture(page: PageEntry, scale: number): Promise<string | null> {
    const key = pageKey(page)
    const cached = cache.get(key)
    if (cached) return cached
    const scratch = document.createElement('canvas')
    try {
      await (await startRender(host.doc(page.source), page.index, scale, scratch)).promise
    } catch {
      return null
    }
    const url = scratch.toDataURL('image/jpeg', 0.7)
    cache.set(key, url)
    return url
  }

  async function fill(item: HTMLElement): Promise<void> {
    const page = host.pages()[Number(item.dataset.at)]
    if (!page) return
    const dims = await host.dimsOf(page)
    const scale = THUMB_WIDTH_PX / dims.w
    const url = await picture(page, scale)
    const frame = item.querySelector<HTMLElement>('.pdf-thumb-frame')
    if (url === null || !item.isConnected || !frame) return
    const box = rotatedBox(dims.w * scale, dims.h * scale, page.rotation)
    const img = el('img', { class: 'pdf-thumb-img', src: url, alt: '', draggable: 'false' })
    img.style.width = `${dims.w * scale}px`
    img.style.height = `${dims.h * scale}px`
    img.style.transform = box.transform
    frame.style.width = `${box.width}px`
    frame.style.height = `${box.height}px`
    frame.replaceChildren(img)
  }

  function markActive(): void {
    element.querySelectorAll<HTMLElement>('.pdf-thumb').forEach((item) => {
      const active = Number(item.dataset.at) === host.current()
      item.classList.toggle('active', active)
      item.setAttribute('aria-current', String(active))
      if (active) item.scrollIntoView({ block: 'nearest' })
    })
  }

  function thumb(at: number): HTMLElement {
    const frame = el('span', { class: 'pdf-thumb-frame' })
    frame.style.width = `${THUMB_WIDTH_PX}px`
    frame.style.height = `${Math.round(THUMB_WIDTH_PX * 1.3)}px`
    const item = el('button', { class: 'pdf-thumb', type: 'button', role: 'listitem', 'data-at': String(at) }, frame, el('span', { class: 'pdf-thumb-no' }, String(at + 1)))
    item.addEventListener('click', () => host.goTo(at))
    observer.observe(item)
    return item
  }

  function render(): void {
    const pages = host.pages()
    const next = pages.map((p) => `${p.id}:${p.rotation}`).join(',')
    if (next === signature) return markActive()
    signature = next
    observer.disconnect()
    element.replaceChildren(...pages.map((_, at) => thumb(at)))
    markActive()
  }

  return {
    element,
    render,
    markActive,
    reset() {
      cache.clear()
      signature = ''
    },
  }
}
