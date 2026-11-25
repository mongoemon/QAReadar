import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addDoc, createDocSet, type Doc } from '../lib/docSet'
import type { DocTabStripOptions } from './docTabStrip'
import { docNames, installDom } from './testDom'

const menu = vi.hoisted(() => ({ items: [] as Array<{ label: string; disabled?: boolean }> }))
vi.mock('./menu', () => ({
  showMenu: (items: typeof menu.items) => {
    menu.items = items
  },
}))

let dom: ReturnType<typeof installDom>

beforeEach(() => {
  vi.resetModules()
  menu.items = []
  dom = installDom()
})

const doc = (id: string): Doc => ({ id, name: `${id}.md`, text: '', savedText: '', handle: null })

async function setup(extra: Partial<DocTabStripOptions> = {}) {
  const { setLang } = await import('../lib/i18n')
  setLang('en')
  const { createDocTabStrip } = await import('./docTabStrip')
  const set = addDoc(createDocSet(doc('a')), doc('b'))
  const options: DocTabStripOptions = {
    commands: { newDoc: 'md.new', duplicate: 'md.duplicate', close: 'md.close' },
    getSet: () => set,
    newDocument: vi.fn(),
    switchTo: vi.fn(),
    duplicate: vi.fn(),
    close: vi.fn(),
    closeOthers: vi.fn(),
    ...extra,
  }
  const strip = createDocTabStrip(options)
  strip.render()
  const tab = (index: number): Element => strip.element.querySelectorAll('.doc-tab')[index]
  return { strip, options, tab, labels: () => menu.items.map((item) => item.label) }
}

describe('document tab strip', () => {
  it('draws one tab per document and marks the active one', async () => {
    const { strip, tab } = await setup()
    expect(docNames(strip.element)).toEqual(['a.md', 'b.md'])
    expect(tab(1).getAttribute('aria-selected')).toBe('true')
    expect(strip.element.getAttribute('aria-label')).toBeTruthy()
  })

  it('opens the document menu from the keyboard, switching to that tab first', async () => {
    const { options, tab, labels } = await setup()
    dom.fire(tab(0), 'keydown', { key: 'F10', shiftKey: true })
    expect(options.switchTo).toHaveBeenCalledWith('a')
    expect(labels()).toEqual(['New document', 'Duplicate', 'Close', 'Close other tabs'])
  })

  it('ignores other keys', async () => {
    const { options, tab } = await setup()
    dom.fire(tab(0), 'keydown', { key: 'F10', shiftKey: false })
    expect(options.switchTo).not.toHaveBeenCalled()
  })

  it('appends the extra menu entries of the tab', async () => {
    const { tab, labels } = await setup({ extraItems: (id) => [{ label: `move ${id}`, run: () => {} }] })
    dom.fire(tab(0), 'keydown', { key: 'ContextMenu' })
    expect(labels().at(-1)).toBe('move a')
  })

  it('offers only "New document" on the empty part of the strip', async () => {
    const { strip, labels } = await setup()
    dom.fire(strip.element, 'contextmenu', { clientX: 0, clientY: 0 })
    expect(labels()).toEqual(['New document'])
  })

  it('shows the mark and tooltip of a decorated tab', async () => {
    const { tab } = await setup({
      decorate: (d) => (d.id === 'a' ? { mark: document.createTextNode('! '), title: 'file is gone' } : null),
    })
    expect(tab(0).textContent).toBe('! a.md')
    expect(tab(0).getAttribute('title')).toBe('file is gone')
    expect(tab(1).getAttribute('title')).toBe('b.md')
  })
})
