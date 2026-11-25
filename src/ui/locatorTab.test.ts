// Characterization tests: how the Locator tab behaves, as a safety net before any refactor.
// The iframe preview is faked here; locatorPreview.test.ts covers the real one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseHTML } from 'linkedom'
import { installDom } from './testDom'

const fake = vi.hoisted(() => ({
  loads: [] as string[],
  highlighted: null as Element | null,
  revealed: [] as Element[],
  scrolled: [] as number[],
  doc: null as Document | null,
  pick: null as unknown as (target: Element) => void,
}))

vi.mock('./locatorPreview', () => ({
  createPreview: (onPick: (target: Element) => void) => {
    fake.pick = onPick
    return {
      element: document.createElement('div'),
      load: (source: string) => {
        fake.loads.push(source)
        fake.doc = parseHTML(`<!doctype html>${source}`).document as unknown as Document
      },
      highlight: (target: Element | null) => {
        fake.highlighted = target
      },
      findByMarker: (marker: number) => fake.doc?.querySelector(`[data-mdr-o="${marker}"]`) ?? null,
      reveal: (target: Element) => fake.revealed.push(target),
    }
  },
}))
vi.mock('./textareaScroll', () => ({
  scrollOffsetIntoView: (_area: unknown, offset: number) => fake.scrolled.push(offset),
}))

const RENDER_DELAY_MS = 300
const STORAGE_KEY = 'mdreadar:locator-framework'
const SOURCE = '<html><body><div id="box" class="a b c d"><button>Save</button></div></body></html>'

let dom: ReturnType<typeof installDom>
let stored: Map<string, string>
let copied: string[]

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  dom = installDom()
  Object.assign(dom.window.HTMLElement.prototype, { focus(): void {} })
  Object.assign(fake, { loads: [], highlighted: null, revealed: [], scrolled: [], doc: null })
  stored = new Map()
  copied = []
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  })
  vi.stubGlobal('navigator', { clipboard: { writeText: async (text: string) => void copied.push(text) } })
  const host = dom.document.createElement('div')
  host.id = 'toast'
  dom.document.body.append(host)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function setup() {
  const { setLang } = await import('../lib/i18n')
  setLang('en')
  const { createLocatorTab } = await import('./locatorTab')
  const tab = createLocatorTab()
  const el = tab.element
  dom.document.body.append(el)

  const one = <T = HTMLElement>(selector: string): T => el.querySelector(selector) as unknown as T
  const all = (selector: string): HTMLElement[] => [...el.querySelectorAll(selector)] as unknown as HTMLElement[]
  const input = one<HTMLTextAreaElement>('.json-input')
  const framework = one<HTMLSelectElement>('.json-select')
  const open = (text = SOURCE): void => tab.open({ name: 'p.html', text, handle: null })
  const inPage = (selector: string): Element => fake.doc!.querySelector(selector)!
  const meta = (): string => one('.path-meta').textContent ?? ''
  const codes = (): string[] => all('.loc-row .path-code').map((n) => n.textContent ?? '')
  const run = (id: string): void => tab.commands!().find((c) => c.id === id)!.run()
  const toast = (): string => dom.document.getElementById('toast')!.textContent ?? ''
  const cursor = (offset: number, type = 'click', props: object = {}): void => {
    input.setSelectionRange(offset, offset)
    dom.fire(input, type, props)
  }
  return { tab, el, one, all, input, framework, open, inPage, meta, codes, run, toast, cursor }
}

describe('Locator tab: source and files', () => {
  it('starts empty, clean, with nothing selected', async () => {
    const view = await setup()
    expect(view.tab.id).toBe('locator')
    expect(view.tab.snapshot()).toEqual({ name: 'page.html', text: '', handle: null })
    expect(view.tab.isDirty()).toBe(false)
    expect(view.meta()).toBe('Click an element in the preview')
    expect(view.codes()).toEqual([])
  })

  it('opens a file, renders it with source markers and stays clean', async () => {
    const view = await setup()
    view.open()
    expect(view.tab.snapshot().name).toBe('p.html')
    expect(view.tab.isDirty()).toBe(false)
    expect(fake.loads).toHaveLength(1)
    expect(fake.loads[0]).toContain('data-mdr-o="0"')
  })

  it('re-renders only after typing pauses', async () => {
    const view = await setup()
    const changed = vi.fn()
    view.tab.onChange(changed)
    view.input.value = '<p>x</p>'
    dom.fire(view.input, 'input')
    expect(changed).toHaveBeenCalledTimes(1)
    expect(fake.loads).toHaveLength(0)
    vi.advanceTimersByTime(RENDER_DELAY_MS)
    expect(fake.loads).toHaveLength(1)
    expect(view.tab.isDirty()).toBe(true)
  })

  it('drops a pending render when a file is opened', async () => {
    const view = await setup()
    view.input.value = '<p>x</p>'
    dom.fire(view.input, 'input')
    view.open()
    vi.advanceTimersByTime(RENDER_DELAY_MS)
    expect(fake.loads).toHaveLength(1)
  })

  it('becomes clean again once saved', async () => {
    const view = await setup()
    view.input.value = '<p>x</p>'
    view.tab.markSaved('out.html', null)
    expect(view.tab.snapshot().name).toBe('out.html')
    expect(view.tab.isDirty()).toBe(false)
  })
})

describe('Locator tab: selecting', () => {
  it('shows locators for a picked element and marks its tag in the source', async () => {
    const view = await setup()
    view.open()
    fake.pick(view.inPage('button'))

    expect(view.meta()).toBe('<button>')
    expect(view.codes().length).toBeGreaterThan(0)
    expect(fake.highlighted).toBe(view.inPage('button'))
    const start = SOURCE.indexOf('<button>')
    expect([view.input.selectionStart, view.input.selectionEnd]).toEqual([start, start + '<button>'.length])
    expect(fake.scrolled).toEqual([start])
  })

  it('describes an element by id and at most three classes', async () => {
    const view = await setup()
    view.open()
    fake.pick(view.inPage('div'))
    expect(view.meta()).toBe('<div#box.a.b.c>')
  })

  it('leaves the source selection alone once the text has moved on', async () => {
    const view = await setup()
    view.open()
    view.input.value = `${SOURCE} `
    fake.pick(view.inPage('button'))
    expect(view.meta()).toBe('<button>')
    expect(fake.scrolled).toEqual([])
  })

  it('selects the element under the text cursor', async () => {
    const view = await setup()
    view.open()
    view.cursor(SOURCE.indexOf('Save'))
    expect(view.meta()).toBe('<button>')
    expect(fake.revealed).toEqual([view.inPage('button')])
  })

  it('follows navigation keys only', async () => {
    const view = await setup()
    view.open()
    view.cursor(SOURCE.indexOf('Save'), 'keyup', { key: 'a' })
    expect(view.meta()).toBe('Click an element in the preview')
    view.cursor(SOURCE.indexOf('Save'), 'keyup', { key: 'ArrowRight' })
    expect(view.meta()).toBe('<button>')
  })

  it('ignores the cursor on the <html> tag', async () => {
    const view = await setup()
    view.open()
    view.cursor(1)
    expect(view.meta()).toBe('Click an element in the preview')
  })

  it('ignores the cursor while the preview is out of date', async () => {
    const view = await setup()
    view.open()
    view.input.value = `${SOURCE} `
    view.cursor(SOURCE.indexOf('Save'))
    expect(view.meta()).toBe('Click an element in the preview')
  })

  it('steps up to the parent and stops below <html>', async () => {
    const view = await setup()
    view.open()
    fake.pick(view.inPage('button'))
    view.run('locator.parent')
    expect(view.meta()).toBe('<div#box.a.b.c>')
    view.run('locator.parent')
    expect(view.meta()).toBe('<body>')
    view.run('locator.parent')
    expect(view.meta()).toBe('<body>')
    expect(view.toast()).toBe('No parent element to select')
  })

  it('says there is no parent when nothing is selected', async () => {
    const view = await setup()
    view.run('locator.parent')
    expect(view.toast()).toBe('No parent element to select')
  })

  it('forgets the selection when a new page is rendered', async () => {
    const view = await setup()
    view.open()
    fake.pick(view.inPage('button'))
    view.open('<p>other</p>')
    expect(view.meta()).toBe('Click an element in the preview')
    expect(view.codes()).toEqual([])
  })
})

describe('Locator tab: syntax and copying', () => {
  it('defaults to Playwright and ignores an unknown stored choice', async () => {
    stored.set(STORAGE_KEY, 'nope')
    const view = await setup()
    expect(view.framework.value).toBe('playwright')
  })

  it('restores the stored framework', async () => {
    stored.set(STORAGE_KEY, 'robot')
    const view = await setup()
    expect(view.framework.value).toBe('robot')
  })

  it('switches syntax, remembers it and updates the docs links', async () => {
    const view = await setup()
    view.open()
    fake.pick(view.inPage('button'))
    const before = view.codes()
    const [docs, companion] = view.all('.docs-link') as unknown as HTMLAnchorElement[]
    const docsBefore = docs.getAttribute('href') ?? docs.href

    view.framework.value = 'robot'
    dom.fire(view.framework, 'change')

    expect(stored.get(STORAGE_KEY)).toBe('robot')
    expect(view.codes()).not.toEqual(before)
    expect(docs.getAttribute('href') ?? docs.href).not.toBe(docsBefore)
    expect(companion.textContent).toContain('BuiltIn')
  })

  it('switches syntax from the command palette', async () => {
    const view = await setup()
    view.run('locator.framework.playwright-java')
    expect(view.framework.value).toBe('playwright-java')
    expect(stored.get(STORAGE_KEY)).toBe('playwright-java')
  })

  it('copies a locator', async () => {
    const view = await setup()
    view.open()
    fake.pick(view.inPage('button'))
    dom.fire(view.all('.loc-row button')[0], 'click')
    await vi.advanceTimersByTimeAsync(0)
    expect(copied).toEqual([view.codes()[0]])
    expect(view.toast()).toContain('Copied')
  })

  it('re-renders its text in the new language', async () => {
    const view = await setup()
    const before = view.meta()
    const { setLang } = await import('../lib/i18n')
    setLang('th')
    expect(view.meta()).not.toBe(before)
    expect(view.tab.label).toBeTruthy()
  })
})
