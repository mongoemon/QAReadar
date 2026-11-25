// Characterization tests: how the JSON Path tab behaves, as a safety net before any refactor.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installDom } from './testDom'

let dom: ReturnType<typeof installDom>
let copied: string[]
let clipboardWorks: boolean

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  dom = installDom()
  copied = []
  clipboardWorks = true
  vi.stubGlobal('navigator', {
    clipboard: {
      writeText: async (text: string) => {
        if (!clipboardWorks) throw new Error('denied')
        copied.push(text)
      },
    },
  })
  const host = dom.document.createElement('div')
  host.id = 'toast'
  dom.document.body.append(host)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const DATA = { name: 'Ann', tags: ['a', 'b'], nested: { id: 7 } }
const TEXT = JSON.stringify(DATA)
const PARSE_DELAY_MS = 250

async function setup() {
  const { setLang } = await import('../lib/i18n')
  setLang('en')
  const { createJsonTab } = await import('./jsonTab')
  const tab = createJsonTab()
  const el = tab.element
  dom.document.body.append(el)

  const one = <T = HTMLElement>(selector: string): T => el.querySelector(selector) as unknown as T
  const all = (selector: string): HTMLElement[] => [...el.querySelectorAll(selector)] as unknown as HTMLElement[]
  const input = one<HTMLTextAreaElement>('.json-input')
  const search = one<HTMLInputElement>('.json-search')
  const [importSelect, scopeSelect, depthSelect] = all('.json-select') as unknown as HTMLSelectElement[]
  const regex = one<HTMLInputElement>('input[type="checkbox"]')
  // linkedom does not preselect the first option the way a browser does.
  scopeSelect.value = 'all'

  const type = (text: string): void => {
    input.value = text
    dom.fire(input, 'input')
    vi.advanceTimersByTime(PARSE_DELAY_MS)
  }
  const find = (query: string): void => {
    search.value = query
    dom.fire(search, 'input')
  }
  const pick = (select: HTMLSelectElement, value: string): void => {
    select.value = value
    dom.fire(select, 'change')
  }
  const run = async (id: string): Promise<void> => {
    tab.commands!().find((c) => c.id === id)!.run()
    await vi.advanceTimersByTimeAsync(0)
  }
  const status = (): string => one('.json-status').textContent ?? ''
  const toast = (): string => dom.document.getElementById('toast')!.textContent ?? ''
  const paths = (): string[] => all('.path-code').map((n) => n.textContent ?? '')
  const row = (key: string): HTMLElement => all('.jrow').find((r) => r.querySelector('.jkey')?.textContent === key)!

  return { tab, el, one, all, input, search, importSelect, scopeSelect, depthSelect, regex, type, find, pick, run, status, toast, paths, row }
}

describe('JSON Path tab: editing and parsing', () => {
  it('starts empty, clean and waiting', async () => {
    const view = await setup()
    expect(view.tab.id).toBe('json')
    expect(view.tab.snapshot()).toEqual({ name: 'data.json', text: '', handle: null })
    expect(view.tab.isDirty()).toBe(false)
    expect(view.status()).toBe('Waiting for JSON…')
    expect(view.all('.jtree')).toHaveLength(0)
  })

  it('parses only after typing pauses, and reports the change at once', async () => {
    const view = await setup()
    const changed = vi.fn()
    view.tab.onChange(changed)

    view.input.value = TEXT
    dom.fire(view.input, 'input')
    expect(changed).toHaveBeenCalledTimes(1)
    expect(view.all('.jtree')).toHaveLength(0)

    vi.advanceTimersByTime(PARSE_DELAY_MS)
    expect(view.status()).toBe('Valid JSON')
    expect(view.all('.jtree')).toHaveLength(1)
    expect(view.paths()).toEqual(['$', 'data', ''])
    expect(view.tab.isDirty()).toBe(true)
  })

  it('keeps the last good tree, marked stale, while the text is broken', async () => {
    const view = await setup()
    view.type(TEXT)
    view.type('{"a": }')

    expect(view.status()).toContain('Invalid JSON')
    expect(view.one('.json-status').dataset.kind).toBe('error')
    expect(view.one('.json-view').classList.contains('stale')).toBe(true)
    expect(view.all('.jtree')).toHaveLength(1)
  })

  it('jumps to the error position', async () => {
    const view = await setup()
    view.type('{"a": }')
    const goto = view.all('button').find((b) => b.textContent?.includes('Go to error'))!
    expect(goto.hidden).toBe(false)

    view.input.setSelectionRange(0, 0)
    dom.fire(goto, 'click')
    expect(view.input.selectionEnd).toBe(view.input.selectionStart + 1)
    expect(view.input.selectionStart).toBeGreaterThan(0)
  })

  it('clears the view when the text is emptied', async () => {
    const view = await setup()
    view.type(TEXT)
    view.type('   ')
    expect(view.status()).toBe('Waiting for JSON…')
    expect(view.all('.jtree')).toHaveLength(0)
    expect(view.paths()).toEqual(['—', '—', '—'])
  })

  it('formats and minifies', async () => {
    const view = await setup()
    view.type(TEXT)
    await view.run('json.format')
    expect(view.input.value).toBe(JSON.stringify(DATA, null, 2))
    await view.run('json.minify')
    expect(view.input.value).toBe(TEXT)
  })

  it('refuses to format text that does not parse', async () => {
    const view = await setup()
    await view.run('json.format')
    expect(view.toast()).toContain('Fix the JSON first')
    expect(view.input.value).toBe('')
  })

  it('selects the node under the text cursor', async () => {
    const view = await setup()
    view.type(TEXT)
    view.input.setSelectionRange(TEXT.indexOf('7'), TEXT.indexOf('7'))
    dom.fire(view.input, 'click')
    expect(view.paths()[0]).toBe('$.nested.id')

    view.input.setSelectionRange(TEXT.indexOf('Ann'), TEXT.indexOf('Ann'))
    dom.fire(view.input, 'keyup', { key: 'a' })
    expect(view.paths()[0]).toBe('$.nested.id')
    dom.fire(view.input, 'keyup', { key: 'ArrowLeft' })
    expect(view.paths()[0]).toBe('$.name')
  })
})

describe('JSON Path tab: files', () => {
  it('opens a JSON file with its handle and stays clean', async () => {
    const view = await setup()
    const handle = { name: 'in.json' } as never
    view.tab.open({ name: 'in.json', text: TEXT, handle })
    expect(view.tab.snapshot()).toEqual({ name: 'in.json', text: TEXT, handle })
    expect(view.tab.isDirty()).toBe(false)
    expect(view.status()).toBe('Valid JSON')
  })

  it('converts a CSV file into a new unsaved JSON document without its handle', async () => {
    const view = await setup()
    view.tab.open({ name: 'users.csv', text: 'id,name\n1,Ann', handle: { name: 'users.csv' } as never })
    const snapshot = view.tab.snapshot()
    expect(snapshot.name).toBe('users.json')
    expect(snapshot.handle).toBeNull()
    expect(JSON.parse(snapshot.text)).toHaveLength(1)
    expect(view.tab.isDirty()).toBe(true)
    expect(view.toast()).toBe('Converted users.csv to JSON')
  })

  it('shows the raw text when a file cannot be converted', async () => {
    const view = await setup()
    view.tab.open({ name: 'bad.jsonl', text: '{oops', handle: null })
    expect(view.input.value).toBe('{oops')
    expect(view.toast()).toContain('Cannot convert')
  })

  it('becomes clean again once saved', async () => {
    const view = await setup()
    view.type(TEXT)
    view.tab.markSaved('out.json', null)
    expect(view.tab.snapshot().name).toBe('out.json')
    expect(view.tab.isDirty()).toBe(false)
  })

  it('converts the typed text from the import menu, then resets the menu', async () => {
    const view = await setup()
    view.input.value = 'id: 1'
    view.pick(view.importSelect, 'yaml')
    expect(JSON.parse(view.input.value)).toEqual({ id: 1 })
    expect(view.importSelect.value).toBe('')
  })

  it('converts the typed text from the command palette', async () => {
    const view = await setup()
    view.input.value = '{"a":1}\n{"a":2}'
    await view.run('json.import.jsonl')
    expect(JSON.parse(view.input.value)).toEqual([{ a: 1 }, { a: 2 }])
  })
})

describe('JSON Path tab: search', () => {
  it('lists matches and selects the clicked one', async () => {
    const view = await setup()
    view.type(TEXT)
    view.find('Ann')
    expect(view.one('.results-count').textContent).toBe('1 matches')

    dom.fire(view.all('.result')[0], 'click')
    expect(view.paths()).toEqual(['$.name', 'data.name', 'name'])
  })

  it('narrows by scope', async () => {
    const view = await setup()
    view.type(TEXT)
    view.find('name')
    expect(view.all('.result')).toHaveLength(1)
    view.pick(view.scopeSelect, 'value')
    expect(view.all('.result')).toHaveLength(0)
  })

  it('reports a bad regular expression', async () => {
    const view = await setup()
    view.type(TEXT)
    view.regex.checked = true
    view.find('(')
    expect(view.one('.results-count.error').textContent).toContain('Pattern:')
  })

  it('runs a JSONPath query', async () => {
    const view = await setup()
    view.type(TEXT)
    view.find('$.tags[*]')
    expect(view.one('.results-count').textContent).toBe('2 JSONPath results')
    view.find('$.name')
    expect(view.one('.results-count').textContent).toBe('1 JSONPath result')
  })

  it('reports a bad JSONPath', async () => {
    const view = await setup()
    view.type(TEXT)
    view.find('$[')
    expect(view.one('.results-count.error').textContent).toContain('JSONPath:')
  })

  it('caps a long result list', async () => {
    const view = await setup()
    view.type(JSON.stringify(Array.from({ length: 250 }, () => 'hit')))
    view.find('hit')
    expect(view.all('.result')).toHaveLength(200)
    expect(view.one('.results-count').textContent).toBe('250 matches (showing 200)')
  })

  it('limits how far a very large document expands', async () => {
    const view = await setup()
    view.type(JSON.stringify(Array.from({ length: 5100 }, (_, i) => i)))
    view.pick(view.depthSelect, '99')
    expect(view.toast()).toContain('expanded to depth 4')
  })
})

describe('JSON Path tab: copying', () => {
  it('copies a path and the selected value', async () => {
    const view = await setup()
    view.type(TEXT)
    dom.fire(view.row('name'), 'click')

    dom.fire(view.all('.path-row button')[0], 'click')
    await vi.advanceTimersByTimeAsync(0)
    await view.run('json.copyvalue')
    expect(copied).toEqual(['$.name', 'Ann'])
    expect(view.toast()).toBe('Copied value')
  })

  it('copies an object value as formatted JSON', async () => {
    const view = await setup()
    view.type(TEXT)
    dom.fire(view.row('nested'), 'click')
    await view.run('json.copyvalue')
    expect(copied).toEqual([JSON.stringify(DATA.nested, null, 2)])
  })

  it('asks for a selection first', async () => {
    const view = await setup()
    await view.run('json.copyvalue')
    expect(view.toast()).toBe('Select a node first')
    expect(copied).toEqual([])
  })

  it('says when the clipboard is unavailable', async () => {
    const view = await setup()
    view.type(TEXT)
    clipboardWorks = false
    await view.run('json.copyvalue')
    expect(view.toast()).toBe('Clipboard unavailable')
  })
})

describe('JSON Path tab: language', () => {
  it('re-renders status and search results in the new language', async () => {
    const view = await setup()
    view.type(TEXT)
    view.find('Ann')
    const before = view.status()
    const { setLang } = await import('../lib/i18n')
    setLang('th')
    expect(view.status()).not.toBe(before)
    expect(view.one('.results-count').textContent).not.toBe('1 matches')
    expect(view.tab.label).toBeTruthy()
  })
})
