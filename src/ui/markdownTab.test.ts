// Characterization tests: they pin what the Markdown tab does today, ahead of the refactor.
// Toast UI needs a real browser, so it is replaced by a text-only stand-in.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenedFile } from '../lib/fileAccess'
import { docNames, installDom } from './testDom'

const fake = vi.hoisted(() => ({ type: (_text: string): void => {} }))

vi.mock('@toast-ui/editor', () => ({
  default: class {
    private text: string
    constructor(options: { initialValue: string; events: { change(): void } }) {
      this.text = options.initialValue
      fake.type = (next) => {
        this.text = next
        options.events.change()
      }
    }
    getMarkdown = (): string => this.text
    getHTML = (): string => this.text
    setMarkdown = (next: string): void => {
      this.text = next
    }
    isMarkdownMode = (): boolean => true
    focus(): void {}
    changeMode(): void {}
    setSelection(): void {}
  },
}))
vi.mock('@toast-ui/editor/dist/toastui-editor.css', () => ({}))
vi.mock('@toast-ui/editor/dist/theme/toastui-editor-dark.css', () => ({}))

const menu = vi.hoisted(() => ({ items: [] as Array<{ label: string; disabled?: boolean; run(): void }> }))
vi.mock('./menu', () => ({
  showMenu: (items: typeof menu.items) => {
    menu.items = items
  },
}))

let dom: ReturnType<typeof installDom>

beforeEach(() => {
  vi.resetModules()
  dom = installDom()
})

const file = (name: string, text: string, extra: Partial<OpenedFile> = {}): OpenedFile => ({
  name,
  text,
  handle: null,
  ...extra,
})

async function setup() {
  const { setLang } = await import('../lib/i18n')
  setLang('en')
  const { createMarkdownTab } = await import('./markdownTab')
  const tab = createMarkdownTab()
  const el = tab.element
  dom.document.body.append(el)
  const run = (id: string): void => tab.commands!().find((c) => c.id === id)!.run()
  const clickDoc = (index: number): void => dom.fire(el.querySelectorAll('.doc-tab')[index], 'click')
  return { tab, el, run, clickDoc, type: (text: string) => fake.type(text), names: () => docNames(el) }
}

describe('Markdown tab documents', () => {
  it('starts with a clean blank document that the first opened file replaces', async () => {
    const { tab, names } = await setup()
    expect(names()).toEqual(['untitled.md'])
    expect(tab.isDirty()).toBe(false)
    tab.open(file('a.md', '# one'))
    expect(names()).toEqual(['a.md'])
  })

  it('keeps each text when switching documents', async () => {
    const { tab, type, clickDoc } = await setup()
    tab.open(file('a.md', 'one'))
    tab.open(file('b.md', 'two'))
    type('two edited')
    clickDoc(0)
    expect(tab.snapshot().text).toBe('one')
    clickDoc(1)
    expect(tab.snapshot().text).toBe('two edited')
    expect(tab.isDirty()).toBe(true)
  })

  it('is clean again after saving', async () => {
    const { tab, type, names } = await setup()
    tab.open(file('a.md', 'one'))
    type('changed')
    tab.markSaved('saved.md', null)
    expect(tab.isDirty()).toBe(false)
    expect(names()).toEqual(['saved.md'])
  })

  it('asks before closing a dirty document and leaves a blank one after the last', async () => {
    const { tab, type, run, names } = await setup()
    tab.open(file('a.md', 'one'))
    type('changed')
    dom.confirm.mockReturnValueOnce(false)
    run('md.close')
    expect(tab.snapshot().name).toBe('a.md')
    run('md.close')
    expect(dom.confirm).toHaveBeenCalledTimes(2)
    expect(names()).toEqual(['untitled.md'])
    expect(tab.isDirty()).toBe(false)
  })

  it('duplicates the active document as an unsaved copy next to it', async () => {
    const { tab, run, clickDoc, names } = await setup()
    tab.open(file('a.md', 'one'))
    tab.open(file('b.md', 'two'))
    clickDoc(0)
    run('md.duplicate')
    expect(names()).toEqual(['a.md', '● a (copy).md', 'b.md'])
    expect(tab.snapshot()).toEqual({ name: 'a (copy).md', text: 'one', handle: null })
  })

  it('cycles through documents in both directions', async () => {
    const { tab, run } = await setup()
    tab.open(file('a.md', '1'))
    tab.open(file('b.md', '2'))
    run('md.nextDoc')
    expect(tab.snapshot().name).toBe('a.md')
    run('md.prevDoc')
    expect(tab.snapshot().name).toBe('b.md')
  })

  it('brings an untouched sample forward instead of opening it twice', async () => {
    const { tab, names } = await setup()
    tab.open(file('s.md', 'demo', { sample: true }))
    tab.open(file('b.md', '2'))
    tab.open(file('s.md', 'demo', { sample: true }))
    expect(names()).toEqual(['s.md', 'b.md'])
    expect(tab.snapshot().name).toBe('s.md')
  })

  it('closes the other documents after confirming the unsaved ones', async () => {
    const { tab, el, type, names } = await setup()
    tab.open(file('a.md', '1'))
    tab.open(file('b.md', '2'))
    type('changed')
    tab.open(file('c.md', '3'))
    const choose = (index: number, label: string): void => {
      dom.fire(el.querySelectorAll('.doc-item')[index], 'contextmenu', { clientX: 0, clientY: 0 })
      menu.items.find((item) => item.label === label)!.run()
    }
    dom.confirm.mockReturnValueOnce(false)
    choose(0, 'Close other tabs')
    expect(names()).toEqual(['a.md', '● b.md', 'c.md'])
    choose(0, 'Close other tabs')
    expect(dom.confirm).toHaveBeenCalledTimes(2)
    expect(names()).toEqual(['a.md'])
    expect(tab.snapshot().text).toBe('1')
    expect(tab.isDirty()).toBe(false)
  })

  it('closes on middle click and creates on double click of the empty strip', async () => {
    const { tab, el, names } = await setup()
    tab.open(file('a.md', '1'))
    tab.open(file('b.md', '2'))
    dom.fire(el.querySelectorAll('.doc-item')[0], 'auxclick', { button: 1 })
    expect(names()).toEqual(['b.md'])
    dom.fire(el.querySelector('.doc-tabs')!, 'dblclick')
    expect(names()).toEqual(['b.md', 'untitled.md'])
  })
})
