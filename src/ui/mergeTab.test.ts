// Characterization tests: how the Diff & Merge tab behaves, ahead of extracting its diff view.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installDom } from './testDom'

let dom: ReturnType<typeof installDom>

beforeEach(() => {
  vi.resetModules()
  dom = installDom()
  Object.assign(dom.window, { getSelection: () => null })
  Object.assign(dom.window.HTMLElement.prototype, { scrollIntoView(): void {}, focus(): void {} })
})

const lines = (...items: string[]): string => items.join('\n')
const COMMON = Array.from({ length: 10 }, (_, n) => `same ${n + 1}`)
const LEFT = lines(...COMMON, 'old', 'tail')
const RIGHT = lines(...COMMON, 'new', 'tail')

async function setup() {
  const { setLang } = await import('../lib/i18n')
  setLang('en')
  const { createMergeTab } = await import('./mergeTab')
  const starter = (fileName: string, text: string) => ({ fileName, text })
  const tab = createMergeTab({ manual: starter('m.txt', LEFT), automate: starter('a.txt', RIGHT) })
  const el = tab.element
  dom.document.body.append(el)
  const all = (selector: string): HTMLElement[] => [...el.querySelectorAll(selector)] as unknown as HTMLElement[]
  const click = (selector: string, index = 0): void => dom.fire(all(selector)[index], 'click')
  const run = (id: string): void => tab.commands!().find((c) => c.id === id)!.run()
  const result = (): string => tab.snapshot().text
  return { tab, el, all, click, run, result }
}

async function loaded() {
  const view = await setup()
  ;(view.tab as unknown as { loadSample(): void }).loadSample()
  return view
}

describe('Diff & Merge', () => {
  it('starts empty and clean', async () => {
    const { tab, all, result } = await setup()
    expect(result()).toBe('')
    expect(tab.isDirty()).toBe(false)
    expect(all('.merge-empty')[0].hidden).toBe(false)
  })

  it('folds the unchanged lines away from a change, and unfolds on click', async () => {
    const { all, click } = await loaded()
    // 3 context lines before the change, the change itself, and the line after it.
    expect(all('.mrow')).toHaveLength(5)
    expect(all('.mblock-head')).toHaveLength(1)
    click('.mfold')
    expect(all('.mrow')).toHaveLength(12)
    expect(all('.mfold')).toHaveLength(0)
  })

  it('picks a side for one row with its buttons', async () => {
    const { all, click, result, tab } = await loaded()
    click('.mpick-btn[data-pick="right"]')
    expect(result()).toBe(RIGHT)
    expect(all('.mrow[data-kind="change"]')[0].dataset.choice).toBe('right')
    expect(all('.mpick-btn[data-pick="right"]')[0].getAttribute('aria-pressed')).toBe('true')
    expect(tab.isDirty()).toBe(true)
  })

  it('includes or excludes a side by clicking the line', async () => {
    const { all, click, result } = await loaded()
    const change = '.mrow[data-kind="change"] .mcell.right'
    const before = result()
    click(change)
    expect(result()).not.toBe(before)
    click(change)
    expect(result()).toBe(before)
    expect(all('.mrow[data-kind="change"]')).toHaveLength(1)
  })

  it('drops and restores an unchanged line', async () => {
    const { click, result } = await loaded()
    click('.same-toggle')
    expect(result()).not.toContain('same 8')
    click('.same-toggle')
    expect(result()).toContain('same 8')
  })

  it('applies a pick to a whole block and to every change', async () => {
    const { click, run, result } = await loaded()
    click('.mpick-btn[data-block-pick="none"]')
    expect(result()).toBe(lines(...COMMON, 'tail'))
    run('merge.both')
    expect(result()).toBe(lines(...COMMON, 'old', 'new', 'tail'))
  })

  it('steps through the change blocks', async () => {
    const { all, run } = await loaded()
    run('merge.next')
    expect(all('.mblock-head.current')).toHaveLength(1)
    run('merge.prev')
    expect(all('.mblock-head.current')).toHaveLength(1)
  })

  it('swaps the sides and keeps what was picked', async () => {
    const { click, run, result } = await loaded()
    click('.mpick-btn[data-pick="right"]')
    run('merge.swap')
    expect(result()).toBe(RIGHT)
  })

  it('fills the first empty side when files are opened, and names the result', async () => {
    const { tab, all } = await setup()
    tab.open({ name: 'cases.txt', text: 'x', handle: null })
    tab.open({ name: 'script.js', text: 'y', handle: null })
    expect(all('.merge-file').map((n) => n.textContent)).toEqual(['cases.txt', 'script.js'])
    expect(tab.snapshot().name).toBe('cases.merged.txt')
    tab.markSaved('out.txt', null)
    expect(tab.snapshot().name).toBe('out.txt')
    expect(tab.isDirty()).toBe(false)
  })

  it('says when both sides are identical', async () => {
    const { tab, all } = await setup()
    tab.open({ name: 'a.txt', text: 'x', handle: null })
    tab.open({ name: 'b.txt', text: 'x', handle: null })
    expect(all('.merge-empty')[0].hidden).toBe(false)
    expect(all('.mblock-head')).toHaveLength(0)
  })
})
