// Test-only: just enough of a browser, on top of linkedom, to run a whole tab.
import { parseHTML } from 'linkedom'
import { vi } from 'vitest'

export function installDom() {
  const { window, document, HTMLElement, Node } = parseHTML('<!doctype html><html><body></body></html>')
  const confirm = vi.fn((_message?: string) => true)
  Object.assign(window, {
    confirm,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
  })
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', document)
  vi.stubGlobal('HTMLElement', HTMLElement)
  vi.stubGlobal('Node', Node)
  vi.stubGlobal('ResizeObserver', class { observe(): void {} })

  // linkedom's textarea has no value / selection model.
  const proto = Object.getPrototypeOf(document.createElement('textarea')) as object
  type Area = { _value?: string; selectionStart: number; selectionEnd: number; scrollTop: number; scrollLeft: number }
  Object.defineProperty(proto, 'value', {
    configurable: true,
    get(this: Area) {
      return this._value ?? ''
    },
    set(this: Area, next: string) {
      this._value = next
      this.selectionStart = this.selectionEnd = next.length
    },
  })
  Object.assign(proto, {
    selectionStart: 0,
    selectionEnd: 0,
    scrollTop: 0,
    scrollLeft: 0,
    setSelectionRange(this: Area, start: number, end: number) {
      this.selectionStart = start
      this.selectionEnd = end
    },
  })

  // linkedom's select.value is read-only; the tabs only ever reset or preset it.
  const select = Object.getPrototypeOf(document.createElement('select')) as object
  Object.defineProperty(select, 'value', {
    configurable: true,
    get(this: { _value?: string }) {
      return this._value ?? ''
    },
    set(this: { _value?: string }, next: string) {
      this._value = next
    },
  })

  const fire = (target: EventTarget, type: string, props: object = {}): void => {
    target.dispatchEvent(Object.assign(new window.Event(type, { bubbles: true, cancelable: true }), props))
  }
  return { window, document, confirm, fire }
}

/** Names on a tab's document strip, with the unsaved dot, in order. */
export const docNames = (root: ParentNode): string[] =>
  [...root.querySelectorAll('.doc-tab')].map((node) => node.textContent ?? '')

/** Fixed monospace geometry (8px cells, 20px lines) for the tests that draw on the Text editor. */
export function installLayout({ window, document }: ReturnType<typeof installDom>): void {
  vi.stubGlobal('getComputedStyle', () => ({ lineHeight: '20px', paddingLeft: '0px', paddingTop: '0px' }))
  // No native editing here: report failure so the editor writes the value itself.
  Object.assign(document, { execCommand: () => false })
  Object.assign(window.HTMLElement.prototype, {
    focus(): void {},
    // The width probe holds 200 characters.
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1600, height: 20 }),
  })
  const area = Object.getPrototypeOf(document.createElement('textarea')) as object
  Object.assign(area, { clientHeight: 400, clientWidth: 800 })
}
