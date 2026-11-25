// Characterization tests: they pin what the Text tab does today, ahead of the refactor.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenedFile } from '../lib/fileAccess'
import { docNames, installDom } from './testDom'

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
  const { createTextTab } = await import('./textTab')
  const tab = createTextTab()
  const el = tab.element
  dom.document.body.append(el)
  const input = (split = 0) => el.querySelectorAll('.te-input')[split] as unknown as HTMLTextAreaElement
  const type = (text: string): void => {
    input().value = text
    dom.fire(input(), 'input')
  }
  const run = (id: string): void => tab.commands!().find((c) => c.id === id)!.run()
  const clickDoc = (index: number): void => dom.fire(el.querySelectorAll('.doc-tab')[index], 'click')
  return { tab, el, input, type, run, clickDoc, names: () => docNames(el) }
}

describe('Text tab documents', () => {
  it('starts with a clean blank document that the first opened file replaces', async () => {
    const { tab, names } = await setup()
    expect(names()).toEqual(['untitled.txt'])
    expect(tab.isDirty()).toBe(false)
    tab.open(file('a.txt', 'one'))
    expect(names()).toEqual(['a.txt'])
  })

  it('adds further files as tabs and keeps each text when switching', async () => {
    const { tab, type, clickDoc, input, names } = await setup()
    tab.open(file('a.txt', 'one'))
    tab.open(file('b.txt', 'two'))
    type('two edited')
    clickDoc(0)
    expect(input().value).toBe('one')
    clickDoc(1)
    expect(input().value).toBe('two edited')
    expect(names()).toEqual(['a.txt', '● b.txt'])
  })

  it('marks edits dirty until saved, and keeps the file line endings', async () => {
    const { tab, type, names } = await setup()
    tab.open(file('a.txt', 'x\r\ny'))
    expect(tab.snapshot().text).toBe('x\r\ny')
    type('x\ny\nz')
    expect(tab.isDirty()).toBe(true)
    expect(tab.snapshot().text).toBe('x\r\ny\r\nz')
    tab.markSaved('saved.txt', null)
    expect(tab.isDirty()).toBe(false)
    expect(names()).toEqual(['saved.txt'])
  })

  it('asks before closing a dirty document and leaves a blank one after the last', async () => {
    const { tab, type, run, names } = await setup()
    tab.open(file('a.txt', 'one'))
    type('changed')
    dom.confirm.mockReturnValueOnce(false)
    run('text.close')
    expect(names()).toEqual(['● a.txt'])
    run('text.close')
    expect(dom.confirm).toHaveBeenCalledTimes(2)
    expect(names()).toEqual(['untitled.txt'])
    expect(tab.isDirty()).toBe(false)
  })

  it('duplicates the active document as an unsaved copy next to it', async () => {
    const { tab, run, clickDoc, names } = await setup()
    tab.open(file('a.txt', 'one'))
    tab.open(file('b.txt', 'two'))
    clickDoc(0)
    run('text.duplicateDoc')
    expect(names()).toEqual(['a.txt', '● a (copy).txt', 'b.txt'])
    expect(tab.snapshot()).toEqual({ name: 'a (copy).txt', text: 'one', handle: null })
  })

  it('cycles through documents in both directions', async () => {
    const { tab, run } = await setup()
    tab.open(file('a.txt', '1'))
    tab.open(file('b.txt', '2'))
    run('text.nextDoc')
    expect(tab.snapshot().name).toBe('a.txt')
    run('text.prevDoc')
    expect(tab.snapshot().name).toBe('b.txt')
  })

  it('brings an untouched sample forward instead of opening it twice', async () => {
    const { tab, names } = await setup()
    tab.open(file('s.txt', 'demo', { sample: true }))
    tab.open(file('b.txt', '2'))
    tab.open(file('s.txt', 'demo', { sample: true }))
    expect(names()).toEqual(['s.txt', 'b.txt'])
    expect(tab.snapshot().name).toBe('s.txt')
  })

  it('closes on middle click and creates on double click of the empty strip', async () => {
    const { tab, el, names } = await setup()
    tab.open(file('a.txt', '1'))
    tab.open(file('b.txt', '2'))
    dom.fire(el.querySelectorAll('.doc-item')[0], 'auxclick', { button: 1 })
    expect(names()).toEqual(['b.txt'])
    dom.fire(el.querySelector('.doc-tabs')!, 'dblclick')
    expect(names()).toEqual(['b.txt', 'untitled.txt'])
  })

  it('closes the other documents after confirming the unsaved ones', async () => {
    const { tab, el, type, names } = await setup()
    tab.open(file('a.txt', '1'))
    tab.open(file('b.txt', '2'))
    type('changed')
    tab.open(file('c.txt', '3'))
    const choose = (index: number, label: string): void => {
      dom.fire(el.querySelectorAll('.doc-item')[index], 'contextmenu', { clientX: 0, clientY: 0 })
      menu.items.find((item) => item.label === label)!.run()
    }
    dom.confirm.mockReturnValueOnce(false)
    choose(0, 'Close other tabs')
    expect(names()).toEqual(['a.txt', '● b.txt', 'c.txt'])
    choose(0, 'Close other tabs')
    expect(dom.confirm).toHaveBeenCalledTimes(2)
    expect(names()).toEqual(['a.txt'])
    expect(tab.snapshot().text).toBe('1')
    expect(tab.isDirty()).toBe(false)
  })

  it('moves a document into a new split and removes the split when it closes', async () => {
    const { tab, el, run, input } = await setup()
    tab.open(file('a.txt', '1'))
    tab.open(file('b.txt', '2'))
    run('text.split')
    expect(el.querySelectorAll('.te-input')).toHaveLength(2)
    expect(input(0).value).toBe('1')
    expect(input(1).value).toBe('2')
    expect(tab.snapshot().name).toBe('b.txt')
    run('text.close')
    expect(el.querySelectorAll('.te-input')).toHaveLength(1)
    expect(tab.snapshot().name).toBe('a.txt')
  })
})
