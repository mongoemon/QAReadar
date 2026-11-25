// Characterization tests: the lazy, keyboard-navigable tree of the JSON Path tab.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installDom } from './testDom'

let dom: ReturnType<typeof installDom>
let focused: HTMLElement | null

beforeEach(() => {
  vi.resetModules()
  dom = installDom()
  focused = null
  Object.defineProperty(dom.document, 'activeElement', { configurable: true, get: () => focused })
  // linkedom has no layout: "visible" means not inside a hidden branch.
  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) {
      return this.closest('[hidden]') ? null : dom.document.body
    },
  })
  Object.assign(dom.window.HTMLElement.prototype, {
    focus(this: HTMLElement): void {
      focused = this
    },
  })
})

afterEach(() => vi.unstubAllGlobals())

async function setup(value: unknown, depth?: number) {
  const { renderTree } = await import('./jsonTree')
  const onSelect = vi.fn()
  const tree = renderTree(value, { onSelect }, depth)
  dom.document.body.append(tree)
  const rows = (): HTMLElement[] => [...tree.querySelectorAll('.jrow')] as unknown as HTMLElement[]
  const keys = (): string[] => rows().map((r) => r.querySelector('.jkey')!.textContent ?? '')
  const row = (key: string): HTMLElement => rows()[keys().indexOf(key)]
  const key = (target: HTMLElement, name: string): void => dom.fire(target, 'keydown', { key: name })
  return { tree, onSelect, rows, keys, row, key }
}

const DATA = { a: { b: 1 }, list: [10], empty: {} }

describe('JSON tree', () => {
  it('opens to the requested depth and selects the root', async () => {
    const view = await setup(DATA)
    expect(view.keys()).toEqual(['$', 'a', 'list', 'empty'])
    expect(view.onSelect).toHaveBeenCalledWith([], DATA)
    expect(view.row('$').classList.contains('selected')).toBe(true)
  })

  it('builds children only when a branch is opened', async () => {
    const view = await setup(DATA, 1)
    dom.fire(view.row('a').querySelector('.jtoggle')!, 'click')
    expect(view.keys()).toContain('b')
    expect(view.row('a').getAttribute('aria-expanded')).toBe('true')

    dom.fire(view.row('a'), 'dblclick')
    expect(view.row('a').getAttribute('aria-expanded')).toBe('false')
  })

  it('moves the selection and reports the path', async () => {
    const view = await setup(DATA, 2)
    dom.fire(view.row('[0]'), 'click')
    expect(view.onSelect).toHaveBeenLastCalledWith(['list', 0], 10)
    expect(view.row('$').classList.contains('selected')).toBe(false)
    expect(view.tree.querySelectorAll('.selected')).toHaveLength(1)
  })

  it('selects, opens and closes from the keyboard', async () => {
    const view = await setup(DATA, 1)
    view.key(view.row('a'), 'Enter')
    expect(view.onSelect).toHaveBeenLastCalledWith(['a'], DATA.a)

    view.key(view.row('a'), 'ArrowRight')
    expect(view.row('a').getAttribute('aria-expanded')).toBe('true')
    view.key(view.row('a'), 'ArrowLeft')
    expect(view.row('a').getAttribute('aria-expanded')).toBe('false')
  })

  it('walks the visible rows with the arrow keys and stops at the ends', async () => {
    const view = await setup(DATA, 1)
    focused = view.row('$')
    view.key(view.row('$'), 'ArrowDown')
    expect(focused).toBe(view.row('a'))
    view.key(view.row('a'), 'ArrowUp')
    view.key(view.row('$'), 'ArrowUp')
    expect(focused).toBe(view.row('$'))
  })

  it('does not expand an empty object', async () => {
    const view = await setup(DATA, 1)
    dom.fire(view.row('empty'), 'dblclick')
    expect(view.row('empty').getAttribute('aria-expanded')).toBeNull()
  })

  it('pages long lists behind a "more" button', async () => {
    const view = await setup(Array.from({ length: 450 }, (_, i) => i))
    expect(view.rows()).toHaveLength(201)
    const more = (): HTMLElement => view.tree.querySelector('.jmore') as unknown as HTMLElement
    expect(more().textContent).toBe('… 250 more')
    dom.fire(more(), 'click')
    expect(view.rows()).toHaveLength(401)
    dom.fire(more(), 'click')
    expect(view.rows()).toHaveLength(451)
    expect(view.tree.querySelector('.jmore')).toBeNull()
  })
})
