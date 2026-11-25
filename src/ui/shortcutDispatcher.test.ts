import { describe, expect, it, vi } from 'vitest'
import { comboFor } from '../lib/shortcuts'
import { createShortcutHandler, type DispatcherHost } from './shortcutDispatcher'

/** A key event that produces the default binding of `id`. */
function press(id: string, extra: object = {}) {
  const parts = comboFor(id)!.split('+')
  const key = parts.at(-1)!
  const code = /^\d$/.test(key) ? `Digit${key}` : /^[A-Z]$/.test(key) ? `Key${key}` : key
  return {
    code,
    key,
    ctrlKey: parts.includes('Ctrl'),
    altKey: parts.includes('Alt'),
    shiftKey: parts.includes('Shift'),
    metaKey: false,
    isComposing: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...extra,
  } as unknown as KeyboardEvent
}

function setup(extra: Partial<DispatcherHost> = {}) {
  const run = vi.fn()
  const host: DispatcherHost = {
    isEditingShortcuts: () => false,
    isPaletteOpen: () => false,
    isZen: () => false,
    exitZen: vi.fn(),
    activeTab: () => 'markdown',
    commands: () => [{ id: 'file.open', title: 'Open', run }],
    ...extra,
  }
  return { handle: createShortcutHandler(host), host, run }
}

describe('shortcut dispatcher', () => {
  it('runs the bound command and keeps the key from the editors', () => {
    const { handle, run } = setup()
    const event = press('file.open')
    handle(event)
    expect(run).toHaveBeenCalledOnce()
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopPropagation).toHaveBeenCalled()
  })

  it.each([
    ['an input method is composing', {}, { isComposing: true }],
    ['the shortcut editor is open', { isEditingShortcuts: () => true }, {}],
    ['the palette is open', { isPaletteOpen: () => true }, {}],
    ['there is no modifier', {}, { ctrlKey: false, altKey: false, metaKey: false }],
  ])('ignores keys while %s', (_case, host, event) => {
    const { handle, run } = setup(host)
    handle(press('file.open', event))
    expect(run).not.toHaveBeenCalled()
  })

  it('leaves focus mode on Escape', () => {
    const { handle, host } = setup({ isZen: () => true })
    handle(press('file.open', { key: 'Escape', code: 'Escape', ctrlKey: false, altKey: false }))
    expect(host.exitZen).toHaveBeenCalled()
  })

  it('does not run a command that belongs to another tab', () => {
    const run = vi.fn()
    const { handle } = setup({ activeTab: () => 'json', commands: () => [{ id: 'md.new', title: 'New', run }] })
    handle(press('md.new'))
    expect(run).not.toHaveBeenCalled()
  })
})
