// Characterization tests: how the Text tab edits today, ahead of splitting it into modules.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installDom, installLayout } from './testDom'

let dom: ReturnType<typeof installDom>

beforeEach(() => {
  vi.resetModules()
  dom = installDom()
  installLayout(dom)
})

const BASE = 'alpha\nbeta\ngamma'

async function setup(text = BASE, caret = 0) {
  const { setLang } = await import('../lib/i18n')
  setLang('en')
  const { createTextTab } = await import('./textTab')
  const tab = createTextTab()
  const el = tab.element
  dom.document.body.append(el)
  tab.open({ name: 'a.txt', text, handle: null })
  const one = <T extends Element>(selector: string): T => el.querySelector(selector) as unknown as T
  const input = one<HTMLTextAreaElement>('.te-input')
  input.setSelectionRange(caret, caret)
  const run = (id: string): void => tab.commands!().find((c) => c.id === id)!.run()
  const fire = (type: string, props: object = {}): void => dom.fire(input, type, props)
  const key = (name: string, props: object = {}): void =>
    fire('keydown', { key: name, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, ...props })
  const columnKey = (name: string): void => key(name, { altKey: true, shiftKey: true })
  const marks = (selector: string): number => el.querySelectorAll(selector).length
  const status = (): string => one('.te-status').textContent ?? ''
  const clip = (type: string, data = ''): string => {
    let written = data
    fire(type, { clipboardData: { getData: () => written, setData: (_: string, next: string) => (written = next) } })
    return written
  }
  /** Column selection over the first two characters of the first two lines. */
  const selectColumn = (): void => {
    columnKey('ArrowDown')
    columnKey('ArrowRight')
    columnKey('ArrowRight')
  }
  return { tab, el, one, input, run, fire, key, columnKey, selectColumn, marks, status, clip }
}

describe('Text tab line editing', () => {
  it('inserts a tab at the caret', async () => {
    const { input, key } = await setup(BASE, 2)
    key('Tab')
    expect(input.value).toBe('al\tpha\nbeta\ngamma')
  })

  it('indents and outdents every selected line', async () => {
    const { input, key } = await setup()
    input.setSelectionRange(0, 8)
    key('Tab')
    expect(input.value).toBe('\talpha\n\tbeta\ngamma')
    key('Tab', { shiftKey: true })
    expect(input.value).toBe(BASE)
  })

  it('duplicates the current line', async () => {
    const { input, run, tab } = await setup(BASE, 2)
    run('text.duplicate')
    expect(input.value).toBe('alpha\nalpha\nbeta\ngamma')
    expect(tab.isDirty()).toBe(true)
  })

  it('sorts the whole text when nothing is selected', async () => {
    const { input, run } = await setup('b\nc\na')
    run('text.tool.sortAsc')
    expect(input.value).toBe('a\nb\nc')
  })

  it('widens a selection to whole lines for line tools only', async () => {
    const { input, run } = await setup('c\nb\nz\na')
    input.setSelectionRange(0, 3)
    run('text.tool.sortAsc')
    expect(input.value).toBe('b\nc\nz\na')
    input.setSelectionRange(2, 3)
    run('text.tool.upper')
    expect(input.value).toBe('b\nC\nz\na')
  })

  it('goes to the asked line, clamped to the document', async () => {
    const { input, run } = await setup()
    Object.assign(dom.window, { prompt: () => '99' })
    run('text.goto')
    expect(input.selectionStart).toBe(BASE.lastIndexOf('gamma'))
  })

  it('cycles the line ending it saves with', async () => {
    const { tab, run } = await setup('x\ny')
    run('text.eol')
    expect(tab.snapshot().text).toBe('x\r\ny')
  })

  it('numbers the lines, and hides the numbers while wrapping', async () => {
    const { one, run } = await setup()
    expect(one('.te-gutter-inner').textContent).toBe('1\n2\n3')
    run('text.wrap')
    expect(one<HTMLElement>('.te-gutter').hidden).toBe(true)
    expect(one('.te-editor').classList.contains('te-wrap')).toBe(true)
  })
})

describe('Text tab column selection', () => {
  it('draws one block per selected line and reports its size', async () => {
    const { selectColumn, marks, status, one } = await setup()
    selectColumn()
    expect(marks('.te-block')).toBe(2)
    expect(status()).toContain('2 × 2')
    expect(one('.te-editor').classList.contains('te-has-block')).toBe(true)
  })

  it('types into every line, then deletes from the shared caret', async () => {
    const { input, selectColumn, fire, marks } = await setup()
    selectColumn()
    fire('beforeinput', { inputType: 'insertText', data: 'Z' })
    expect(input.value).toBe('Zpha\nZta\ngamma')
    expect(marks('.te-caret')).toBe(2)
    fire('beforeinput', { inputType: 'deleteContentBackward' })
    expect(input.value).toBe('pha\nta\ngamma')
  })

  it('deletes the block itself', async () => {
    const { input, selectColumn, fire } = await setup()
    selectColumn()
    fire('beforeinput', { inputType: 'deleteContentForward' })
    expect(input.value).toBe('pha\nta\ngamma')
  })

  it('copies, cuts and pastes rows', async () => {
    const { input, selectColumn, clip } = await setup()
    selectColumn()
    expect(clip('copy')).toBe('al\nbe')
    expect(clip('cut')).toBe('al\nbe')
    expect(input.value).toBe('pha\nta\ngamma')
    clip('paste', '1\n2')
    expect(input.value).toBe('1pha\n2ta\ngamma')
  })

  it('puts a tab on every selected line', async () => {
    const { input, selectColumn, key } = await setup()
    selectColumn()
    key('Tab')
    expect(input.value).toBe('\tpha\n\tta\ngamma')
  })

  it('changes case on the block and keeps it selected', async () => {
    const { input, selectColumn, run, marks } = await setup()
    selectColumn()
    run('text.tool.upper')
    expect(input.value).toBe('ALpha\nBEta\ngamma')
    expect(marks('.te-block')).toBe(2)
  })

  it('applies a line tool to the covered lines and drops the block', async () => {
    const { input, columnKey, run, marks } = await setup('b\na\nc')
    columnKey('ArrowDown')
    run('text.tool.sortAsc')
    expect(input.value).toBe('a\nb\nc')
    expect(marks('.te-caret')).toBe(0)
  })

  it.each(['Escape', 'ArrowLeft', 'Home'])('leaves column mode on %s', async (name) => {
    const { selectColumn, key, marks } = await setup()
    selectColumn()
    key(name)
    expect(marks('.te-block')).toBe(0)
  })

  it('leaves column mode when the browser makes another edit', async () => {
    const { selectColumn, fire, marks } = await setup()
    selectColumn()
    fire('beforeinput', { inputType: 'insertLineBreak' })
    expect(marks('.te-block')).toBe(0)
  })

  it('selects by Alt+drag and clears on a plain click', async () => {
    const { fire, marks } = await setup()
    fire('mousedown', { altKey: true, button: 0, clientX: 12, clientY: 10 })
    dom.fire(dom.window as unknown as EventTarget, 'mousemove', { clientX: 28, clientY: 35 })
    dom.fire(dom.window as unknown as EventTarget, 'mouseup')
    expect(marks('.te-block')).toBe(2)
    fire('mousedown', { altKey: false, button: 0 })
    expect(marks('.te-block')).toBe(0)
  })

  it('turns wrapping off, which column selection needs', async () => {
    const { run, columnKey, one, marks } = await setup()
    run('text.wrap')
    columnKey('ArrowDown')
    expect(one('.te-editor').classList.contains('te-wrap')).toBe(false)
    expect(marks('.te-caret')).toBe(2)
  })
})

describe('Text tab splits', () => {
  const splits = (el: Element): number => el.querySelectorAll('.te-pane').length

  it('stops at three splits and cycles between them', async () => {
    const { tab, el, run } = await setup()
    run('text.splitNew')
    run('text.splitNew')
    run('text.splitNew')
    expect(splits(el)).toBe(3)
    expect(tab.snapshot().name).toBe('untitled.txt')
    run('text.nextSplit')
    expect(tab.snapshot().name).toBe('a.txt')
    expect(el.querySelectorAll('.te-active-split')).toHaveLength(1)
  })

  it('keeps the text and unsaved state of a moved document', async () => {
    const { tab, el, run, key } = await setup()
    tab.open({ name: 'b.txt', text: 'two', handle: null })
    key('Tab')
    run('text.split')
    expect(splits(el)).toBe(2)
    expect(tab.snapshot()).toEqual({ name: 'b.txt', text: '\ttwo', handle: null })
    expect(tab.isDirty()).toBe(true)
  })
})
