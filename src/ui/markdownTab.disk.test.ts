// Characterization tests: the Markdown tab's session restore and file-on-disk checks.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../lib/docSession'
import type { FileHandleLike } from '../lib/fileAccess'
import { docNames, installDom } from './testDom'

const fake = vi.hoisted(() => ({
  type: (_text: string): void => {},
  session: null as unknown,
  saved: [] as unknown[],
  probe: 1000 as number | 'missing' | 'unknown',
  read: null as unknown,
}))

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
vi.mock('../lib/docSession', async (original) => ({
  ...(await original<object>()),
  loadSession: async () => fake.session,
  saveSession: async (session: unknown) => {
    fake.saved.push(session)
  },
}))
vi.mock('../lib/fileAccess', async (original) => ({
  ...(await original<object>()),
  statHandle: async () => fake.probe,
  readHandle: async () => fake.read,
}))

let dom: ReturnType<typeof installDom>
const stored = new Map<string, string>()

// Cancels the tab's debounced side effects, which would otherwise fire after the DOM is gone.
afterEach(() => dom.fire(dom.window as unknown as EventTarget, 'pagehide'))

beforeEach(() => {
  vi.resetModules()
  dom = installDom()
  stored.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  })
  Object.assign(fake, { session: null, saved: [], probe: 1000, read: null })
})

const handle = {} as FileHandleLike
const linked = (name: string, text: string, stamp = 1000): Session['docs'][number] => ({
  name,
  text,
  savedText: text,
  handle,
  stamp,
})
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function setup() {
  const { setLang } = await import('../lib/i18n')
  setLang('en')
  const { createMarkdownTab } = await import('./markdownTab')
  const tab = createMarkdownTab()
  const el = tab.element
  dom.document.body.append(el)
  await settle()
  const one = <T extends Element>(selector: string): T => el.querySelector(selector) as unknown as T
  const run = async (id: string): Promise<void> => {
    tab.commands!().find((c) => c.id === id)!.run()
    await settle()
  }
  return {
    tab,
    run,
    names: () => docNames(el),
    refresh: () => one<HTMLButtonElement>('.refresh-btn'),
    warning: () => one<HTMLElement>('.disk-warn'),
  }
}

describe('Markdown tab session', () => {
  it('restores the documents and the active one', async () => {
    fake.session = { docs: [linked('a.md', 'one'), linked('b.md', 'two')], activeIndex: 1 }
    const { tab, names } = await setup()
    expect(names()).toEqual(['a.md', 'b.md'])
    expect(tab.snapshot().text).toBe('two')
  })

  it('replaces the legacy drafts with the stored session', async () => {
    stored.set('mdreadar:md-drafts', JSON.stringify([{ name: 'old.md', text: 'draft' }]))
    fake.session = { docs: [linked('a.md', 'one')], activeIndex: 0 }
    const { names } = await setup()
    expect(names()).toEqual(['a.md'])
  })

  it('falls back to the drafts when there is no session', async () => {
    stored.set('mdreadar:md-drafts', JSON.stringify([{ name: 'old.md', text: 'draft' }]))
    const { tab, names } = await setup()
    expect(names()).toEqual(['● old.md'])
    expect(tab.snapshot().text).toBe('draft')
  })

  it('does not remember the untouched blank document', async () => {
    await setup()
    expect(fake.saved.at(-1)).toBeNull()
  })

  it('remembers opened files, with their disk timestamp', async () => {
    const { tab } = await setup()
    tab.open({ name: 'a.md', text: 'one', handle, lastModified: 42 })
    expect(fake.saved.at(-1)).toEqual({ docs: [linked('a.md', 'one', 42)], activeIndex: 0 })
  })

  it('flushes unsaved text when the page goes away', async () => {
    const { tab } = await setup()
    tab.open({ name: 'a.md', text: 'one', handle: null })
    fake.type('edited')
    dom.fire(dom.window as unknown as EventTarget, 'pagehide')
    expect(stored.get('mdreadar:md-drafts')).toBe(JSON.stringify([{ name: 'a.md', text: 'edited' }]))
  })
})

describe('Markdown tab files on disk', () => {
  const restore = (): void => {
    fake.session = { docs: [linked('a.md', 'one')], activeIndex: 0 }
  }

  it('disables refresh for a document without a file', async () => {
    const { refresh } = await setup()
    expect(refresh().disabled).toBe(true)
  })

  it('warns about a file that disappeared', async () => {
    restore()
    fake.probe = 'missing'
    const { names, warning, refresh } = await setup()
    expect(warning().hidden).toBe(false)
    expect(refresh().disabled).toBe(false)
    expect(names()).toEqual(['a.md'])
  })

  it('marks a file changed elsewhere, again when the window gets focus', async () => {
    restore()
    const { refresh } = await setup()
    expect(refresh().classList.contains('has-update')).toBe(false)
    fake.probe = 2000
    dom.fire(dom.window as unknown as EventTarget, 'focus')
    await settle()
    expect(refresh().classList.contains('has-update')).toBe(true)
  })

  it('reloads from disk, asking first when there are unsaved edits', async () => {
    restore()
    fake.read = { status: 'ok', file: { name: 'a.md', text: 'from disk', handle, lastModified: 2000 } }
    const { tab, run } = await setup()
    fake.type('mine')
    dom.confirm.mockReturnValueOnce(false)
    await run('md.refresh')
    expect(tab.snapshot().text).toBe('mine')
    await run('md.refresh')
    expect(tab.snapshot().text).toBe('from disk')
    expect(tab.isDirty()).toBe(false)
  })

  it('shows the warning when refreshing finds the file gone, and drops it after saving', async () => {
    restore()
    fake.read = { status: 'missing' }
    const { tab, run, warning } = await setup()
    await run('md.refresh')
    expect(warning().hidden).toBe(false)
    tab.markSaved('a.md', handle)
    expect(warning().hidden).toBe(true)
    await settle()
    expect((fake.saved.at(-1) as Session).docs[0].stamp).toBe(1000)
  })
})
