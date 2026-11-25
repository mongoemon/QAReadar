// Characterization tests: how the PDF tab behaves, ahead of splitting it into modules.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installDom } from './testDom'

const fake = vi.hoisted(() => ({
  pages: 3,
  renderError: null as Error | null,
  calls: [] as string[],
  menu: [] as Array<{ label: string; run(): void }>,
  insert: null as unknown,
}))

vi.mock('./pdfEngine', () => ({
  loadPdf: async () => ({ numPages: fake.pages }),
  releasePdf: () => fake.calls.push('release'),
  pageSize: async () => ({ width: 600, height: 800 }),
  startRender: async () => {
    if (fake.renderError) throw fake.renderError
    return { promise: Promise.resolve(), cancel() {} }
  },
}))
vi.mock('./pdfExportActions', () => {
  const record = (name: string) => async (_input: unknown, ...args: unknown[]) => {
    fake.calls.push([name, ...args].join(':'))
    return name === 'exportAllImages' ? 3 : `${name}.out`
  }
  return {
    PDF_KIND: { description: 'PDF', mime: 'application/pdf', extensions: ['pdf'] },
    buildEdited: async () => new Uint8Array([1]),
    exportPdfCopy: record('exportPdfCopy'),
    exportPageImage: record('exportPageImage'),
    exportAllImages: record('exportAllImages'),
    exportText: record('exportText'),
  }
})
vi.mock('../lib/fileAccess', async (original) => ({
  ...(await original<object>()),
  openTextFile: async () => fake.insert,
  saveBinaryFile: async (name: string) => ({ name, handle: null }),
}))
vi.mock('./menu', () => ({
  showMenu: (items: typeof fake.menu) => {
    fake.menu = items
  },
}))

let dom: ReturnType<typeof installDom>
let resized: () => void
let seen: (items: Array<{ isIntersecting: boolean; target: Element }>) => void
let observed: Element[]

beforeEach(() => {
  vi.resetModules()
  dom = installDom()
  Object.assign(fake, { pages: 3, renderError: null, calls: [], menu: [], insert: null })
  observed = []
  for (const name of ['Element', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement'] as const) {
    vi.stubGlobal(name, (dom.window as unknown as Record<string, unknown>)[name] ?? class {})
  }
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) {
      resized = callback
    }
    observe(): void {}
  })
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: typeof seen) {
      seen = callback
    }
    observe(target: Element): void {
      observed.push(target)
    }
    unobserve(): void {}
    disconnect(): void {
      observed = []
    }
  })
  Object.assign(dom.window.HTMLElement.prototype, {
    focus(): void {},
    scrollIntoView(): void {},
    setPointerCapture(): void {},
    hasPointerCapture: () => false,
    releasePointerCapture(): void {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 800 }),
    toDataURL: () => 'data:image/jpeg;base64,x',
  })
})

const settle = async (): Promise<void> => {
  for (let n = 0; n < 3; n++) await new Promise((resolve) => setTimeout(resolve, 0))
}
const BYTES = new Uint8Array([37, 80, 68, 70])

async function setup() {
  const { setLang } = await import('../lib/i18n')
  setLang('en')
  const { createPdfTab } = await import('./pdfTab')
  const tab = createPdfTab()
  const el = tab.element
  dom.document.body.append(el)
  const one = <T extends HTMLElement = HTMLElement>(selector: string): T => el.querySelector(selector) as unknown as T
  const all = (selector: string): HTMLElement[] => [...el.querySelectorAll(selector)] as unknown as HTMLElement[]
  const buttons = (): HTMLButtonElement[] => all('.pdf-bar button') as HTMLButtonElement[]
  /** Toolbar button by the start of its tooltip. */
  const button = (title: string): HTMLButtonElement => buttons().find((b) => (b.title ?? '').startsWith(title))!
  const press = async (title: string): Promise<void> => {
    dom.fire(button(title), 'click')
    await settle()
  }
  const run = async (id: string): Promise<void> => {
    tab.commands!().find((c) => c.id === id)!.run()
    await settle()
  }
  const pointer = (type: string, x: number, y: number, target: Element = one('.pdf-overlay')): void =>
    dom.fire(target, type, { button: 0, pointerId: 1, clientX: x, clientY: y })
  const tool = (index: number): void => dom.fire(all('.pdf-bar .btn-group button')[index], 'click')
  const draw = async (index: number, from: [number, number], to: [number, number]): Promise<void> => {
    tool(index)
    pointer('pointerdown', ...from)
    pointer('pointermove', ...to)
    pointer('pointerup', ...to)
    await settle()
  }
  const label = (): string => one('.pdf-page-label').textContent ?? ''
  const zoom = (): string => one('.pdf-zoom').textContent ?? ''
  const key = (name: string): void => dom.fire(el, 'keydown', { key: name })
  return { tab, el, one, all, button, press, run, pointer, tool, draw, label, zoom, key }
}

async function opened() {
  const view = await setup()
  view.tab.open({ name: 'a.pdf', text: '', handle: null, bytes: BYTES })
  await settle()
  return view
}

const SELECT = 0
const TEXT = 1
const HIGHLIGHT = 2
const RECT = 3
const PEN = 5

describe('PDF tab documents', () => {
  it('starts empty, with nothing to save', async () => {
    const { tab, one, button } = await setup()
    expect(one('.pdf-empty').hidden).toBe(false)
    expect(button('Undo').disabled).toBe(true)
    expect(tab.isDirty()).toBe(false)
    expect(await tab.save!(false)).toBeNull()
  })

  it('shows the first page of an opened file, with a thumbnail per page', async () => {
    const { tab, label, all, one } = await opened()
    expect(label()).toContain('1')
    expect(label()).toContain('3')
    expect(all('.pdf-thumb')).toHaveLength(3)
    expect(one('.pdf-holder').hidden).toBe(false)
    expect(tab.snapshot().name).toBe('a.pdf')
    expect(tab.isDirty()).toBe(false)
  })

  it('releases the previous file when another opens', async () => {
    const { tab } = await opened()
    tab.open({ name: 'b.pdf', text: '', handle: null, bytes: BYTES })
    await settle()
    expect(fake.calls).toContain('release')
    expect(tab.snapshot().name).toBe('b.pdf')
  })

  it('fits the page once the hidden tab gets a width', async () => {
    const { one, zoom } = await opened()
    const before = zoom()
    Object.defineProperty(one('.pdf-stage'), 'clientWidth', { configurable: true, value: 348 })
    Object.defineProperty(one('.pdf-stage'), 'clientHeight', { configurable: true, value: 2000 })
    resized()
    await settle()
    expect(zoom()).not.toBe(before)
    expect(one('.pdf-page').style.width).toBe('300px')
  })

  it('fills a thumbnail when it scrolls into view', async () => {
    const { all } = await opened()
    seen([{ isIntersecting: true, target: observed[0] }])
    await settle()
    expect(all('.pdf-thumb-img')).toHaveLength(1)
  })

  it('reports a page that fails to render', async () => {
    fake.renderError = new Error('boom')
    dom.document.body.innerHTML = '<div id="toast"></div>'
    await opened()
    expect(dom.document.querySelector('#toast')!.textContent).toContain('boom')
  })

  it('moves between pages by command and thumbnail', async () => {
    const { run, label, all } = await opened()
    await run('pdf.next')
    expect(label()).toContain('2')
    await run('pdf.prev')
    dom.fire(all('.pdf-thumb')[2], 'click')
    await settle()
    expect(label()).toContain('3 ')
    expect(all('.pdf-thumb')[2].classList.contains('active')).toBe(true)
  })

  it('rotates, with undo and redo', async () => {
    const { tab, press, run, one } = await opened()
    await press('Rotate page clockwise')
    expect(one('.pdf-page').style.transform).toContain('rotate(90deg)')
    expect(tab.isDirty()).toBe(true)
    await run('pdf.undo')
    expect(one('.pdf-page').style.transform ?? '').not.toContain('rotate')
    expect(tab.isDirty()).toBe(false)
    await run('pdf.redo')
    expect(one('.pdf-page').style.transform).toContain('rotate(90deg)')
    await press('Rotate page counter-clockwise')
    expect(one('.pdf-page').style.transform ?? '').not.toContain('rotate')
  })

  it('duplicates, moves and deletes pages', async () => {
    const { press, label, all } = await opened()
    await press('Duplicate this page')
    expect(all('.pdf-thumb')).toHaveLength(4)
    expect(label()).toContain('2')
    await press('Move page later')
    expect(label()).toContain('3')
    await press('Move page earlier')
    expect(label()).toContain('2')
    await press('Delete this page')
    expect(all('.pdf-thumb')).toHaveLength(3)
  })

  it('zooms with the buttons and ctrl+wheel, within limits', async () => {
    const { press, zoom, one } = await opened()
    expect(zoom()).toBe('100%')
    await press('Zoom in')
    expect(zoom()).toBe('120%')
    await press('Zoom out')
    expect(zoom()).toBe('100%')
    dom.fire(one('.pdf-stage'), 'wheel', { ctrlKey: true, deltaY: -1 })
    expect(zoom()).toBe('120%')
    for (let n = 0; n < 30; n++) await press('Zoom in')
    expect(zoom()).toBe('450%')
  })
})

describe('PDF tab marks', () => {
  it('draws a rectangle, ignoring a stray click', async () => {
    const { draw, all, tab } = await opened()
    await draw(RECT, [60, 80], [61, 81])
    expect(all('.pdf-mark')).toHaveLength(0)
    await draw(RECT, [60, 80], [360, 480])
    const [mark] = all('.pdf-mark.rect')
    expect([mark.style.left, mark.style.top, mark.style.width, mark.style.height]).toEqual(['10%', '10%', '50%', '50%'])
    expect(tab.isDirty()).toBe(true)
  })

  it('draws highlights and pen strokes in their own colours', async () => {
    const { draw, all } = await opened()
    await draw(HIGHLIGHT, [0, 0], [300, 80])
    await draw(PEN, [0, 0], [300, 400])
    expect(all('.pdf-mark.highlight')[0].style.backgroundColor).toBe('#ffe600')
    expect(all('polyline')[0].getAttribute('stroke')).toBe('#e53935')
    expect(all('polyline')[0].getAttribute('points')!.split(' ')).toHaveLength(2)
  })

  it('discards a cancelled stroke', async () => {
    const { tool, pointer, all } = await opened()
    tool(RECT)
    pointer('pointerdown', 0, 0)
    pointer('pointermove', 300, 400)
    pointer('pointercancel', 300, 400)
    expect(all('.pdf-mark')).toHaveLength(0)
  })

  it('selects, drags, recolours and deletes a mark', async () => {
    const { draw, tool, pointer, all, one, button, key } = await opened()
    await draw(RECT, [0, 0], [300, 400])
    tool(SELECT)
    pointer('pointerdown', 60, 80, all('.pdf-mark')[0])
    expect(all('.pdf-mark.selected')).toHaveLength(1)
    pointer('pointermove', 120, 160)
    pointer('pointerup', 120, 160)
    await settle()
    expect(all('.pdf-mark')[0].style.left).toBe('10%')
    one<HTMLInputElement>('.pdf-color').value = '#00ff00'
    dom.fire(one('.pdf-color'), 'input')
    await settle()
    expect(all('.pdf-mark')[0].style.borderColor).toBe('#00ff00')
    key('Escape')
    expect(all('.pdf-mark.selected')).toHaveLength(0)
    pointer('pointerdown', 60, 80, all('.pdf-mark')[0])
    pointer('pointerup', 60, 80)
    expect(button('Delete selected mark').disabled).toBe(false)
    key('Delete')
    await settle()
    expect(all('.pdf-mark')).toHaveLength(0)
  })

  it('adds, edits and resizes text', async () => {
    const { tool, pointer, all, one } = await opened()
    const write = async (value: string, end: 'blur' | 'Escape' = 'blur'): Promise<void> => {
      const area = one<HTMLTextAreaElement>('.pdf-text-editor')
      area.value = value
      if (end === 'blur') dom.fire(area, 'blur')
      else dom.fire(area, 'keydown', { key: end })
      await settle()
    }
    tool(TEXT)
    pointer('pointerdown', 60, 80)
    await write('hello  ')
    expect(all('.pdf-mark.text').map((n) => n.textContent)).toEqual(['hello'])
    expect(all('.pdf-mark.selected')).toHaveLength(1)

    pointer('dblclick', 60, 80, all('.pdf-mark.text')[0])
    await write('changed', 'Escape')
    expect(all('.pdf-mark.text')[0].textContent).toBe('hello')

    const before = all('.pdf-mark.text')[0].style.fontSize
    tool(SELECT)
    pointer('pointerdown', 60, 80, all('.pdf-mark.text')[0])
    pointer('pointerup', 60, 80)
    one<HTMLSelectElement>('.pdf-size').value = '36'
    dom.fire(one('.pdf-size'), 'change')
    await settle()
    expect(all('.pdf-mark.text')[0].style.fontSize).not.toBe(before)

    tool(TEXT)
    pointer('pointerdown', 60, 80, all('.pdf-mark.text')[0])
    await write('')
    expect(all('.pdf-mark.text')).toHaveLength(0)
  })
})

describe('PDF tab files', () => {
  it('offers every export and runs the chosen one', async () => {
    const { press, run } = await opened()
    await run('pdf.next')
    await press('Export')
    for (const item of fake.menu) {
      item.run()
      await settle()
    }
    expect(fake.calls).toEqual([
      'exportPdfCopy',
      'exportPageImage:1:false',
      'exportPageImage:1:true',
      'exportAllImages',
      'exportText:false',
      'exportText:true',
    ])
  })

  it('inserts another PDF and shows its first page', async () => {
    const { press, all, label } = await opened()
    fake.insert = { name: 'b.pdf', text: '', handle: null, bytes: BYTES }
    await press('Insert')
    expect(all('.pdf-thumb')).toHaveLength(6)
    expect(label()).toContain('4')
  })

  it('saves under the file name and is clean afterwards', async () => {
    const { tab, press } = await opened()
    await press('Rotate page clockwise')
    const saved = await tab.save!(false)
    expect(saved).toEqual({ name: 'a.pdf', handle: null })
    tab.markSaved('b.pdf', null)
    expect(tab.isDirty()).toBe(false)
    expect(tab.snapshot().name).toBe('b.pdf')
  })
})
