// Characterization tests: the sandboxed preview of the Locator tab, with a fake iframe document.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMParser, parseHTML } from 'linkedom'
import { installDom } from './testDom'

let dom: ReturnType<typeof installDom>

beforeEach(() => {
  vi.resetModules()
  dom = installDom()
  vi.stubGlobal('DOMParser', DOMParser)
})

afterEach(() => vi.unstubAllGlobals())

const RECT = { left: 1, top: 2, width: 30, height: 40 }

async function setup() {
  const { createPreview } = await import('./locatorPreview')
  const onPick = vi.fn()
  const preview = createPreview(onPick)
  dom.document.body.append(preview.element)
  const frame = preview.element.querySelector('iframe') as unknown as HTMLIFrameElement
  const [hover, picked] = [...preview.element.querySelectorAll('.loc-box')] as unknown as HTMLElement[]

  const page = parseHTML('<!doctype html><html><body><button data-mdr-o="5">Go</button></body></html>')
  const doc = page.document as unknown as Document
  const button = doc.querySelector('button')!
  Object.assign(button, { getBoundingClientRect: () => RECT, scrollIntoView: vi.fn() })
  Object.defineProperty(frame, 'contentDocument', { configurable: true, get: () => doc })

  const loaded = (): void => dom.fire(frame, 'load')
  const inPage = (target: EventTarget, type: string): Event => {
    const event = new page.window.Event(type, { bubbles: true, cancelable: true }) as unknown as Event
    target.dispatchEvent(event)
    return event
  }
  return { preview, onPick, frame, hover, picked, doc, button, loaded, inPage }
}

describe('Locator preview', () => {
  it('sandboxes the frame without scripts', async () => {
    const { frame } = await setup()
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin')
  })

  it('loads a hardened copy of the page, and nothing for blank source', async () => {
    const { preview, frame } = await setup()
    preview.load('<html><head><base href="https://x.test/"></head><body>hi</body></html>')
    expect(frame.srcdoc).toContain('Content-Security-Policy')
    expect(frame.srcdoc).not.toContain('<base')
    preview.load('   ')
    expect(frame.srcdoc).toBe('')
  })

  it('reports clicks on elements and blocks their default action', async () => {
    const view = await setup()
    view.loaded()
    const event = view.inPage(view.button, 'click')
    expect(view.onPick).toHaveBeenCalledWith(view.button)
    expect(event.defaultPrevented).toBe(true)
  })

  it('ignores the old page while a new one is loading', async () => {
    const view = await setup()
    view.loaded()
    view.preview.load('<p>next</p>')
    view.inPage(view.button, 'click')
    expect(view.onPick).not.toHaveBeenCalled()
    expect(view.preview.findByMarker(5)).toBeNull()

    view.loaded()
    expect(view.preview.findByMarker(5)).toBe(view.button)
  })

  it('stays usable when the same page is loaded again', async () => {
    const view = await setup()
    view.preview.load('<p>same</p>')
    view.loaded()
    view.preview.load('<p>same</p>')
    expect(view.preview.findByMarker(5)).toBe(view.button)
  })

  it('returns null for a marker that is not there', async () => {
    const { preview } = await setup()
    expect(preview.findByMarker(99)).toBeNull()
  })

  it('outlines the selected element and clears the outline', async () => {
    const view = await setup()
    view.preview.highlight(view.button)
    expect(view.picked.hidden).toBe(false)
    expect(view.picked.style.width).toBe('30px')
    view.preview.highlight(null)
    expect(view.picked.hidden).toBe(true)
  })

  it('outlines the hovered element until the pointer leaves', async () => {
    const view = await setup()
    view.loaded()
    view.inPage(view.button, 'mouseover')
    expect(view.hover.hidden).toBe(false)
    view.inPage(view.doc, 'mouseleave')
    expect(view.hover.hidden).toBe(true)
  })

  it('scrolls the revealed element into view', async () => {
    const view = await setup()
    view.preview.reveal(view.button)
    expect(view.button.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
  })
})
