import { filterCommands, type Command } from '../lib/commands'
import { el } from './dom'

export interface Palette {
  open(initialQuery?: string): void
}

/** Ctrl+K command palette: fuzzy filter, arrow keys to move, Enter to run, Esc to close. */
export function createPalette(getCommands: () => Command[]): Palette {
  const input = el('input', {
    class: 'palette-input',
    type: 'text',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': 'palette-list',
    'aria-label': 'Command',
    placeholder: 'Type a command…',
    autocomplete: 'off',
  })
  const list = el('ul', { class: 'palette-list', id: 'palette-list', role: 'listbox' })
  const box = el('div', { class: 'palette-box', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command palette' }, input, list)
  const backdrop = el('div', { class: 'palette-backdrop' }, box)
  backdrop.hidden = true
  document.body.append(backdrop)

  let shown: Command[] = []
  let selected = 0
  let returnFocus: HTMLElement | null = null

  function render(): void {
    shown = filterCommands(getCommands(), input.value)
    selected = Math.min(selected, Math.max(0, shown.length - 1))
    if (shown.length === 0) {
      list.replaceChildren(el('li', { class: 'palette-empty' }, 'No matching command'))
      return
    }
    list.replaceChildren(
      ...shown.map((command, index) => {
        const item = el(
          'li',
          { class: 'palette-item', role: 'option', 'aria-selected': String(index === selected) },
          el('span', {}, command.title),
          el('kbd', {}, command.hint ?? ''),
        )
        item.addEventListener('mousedown', (ev) => {
          ev.preventDefault()
          run(command)
        })
        return item
      }),
    )
    list.children[selected]?.scrollIntoView({ block: 'nearest' })
  }

  function close(): void {
    backdrop.hidden = true
    returnFocus?.focus()
    returnFocus = null
  }

  function run(command: Command): void {
    close()
    // Deferred so the palette is gone before the command moves focus or opens pickers.
    window.setTimeout(command.run, 0)
  }

  input.addEventListener('input', () => {
    selected = 0
    render()
  })
  backdrop.addEventListener('mousedown', (ev) => {
    if (ev.target === backdrop) close()
  })
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault()
      close()
    } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault()
      if (shown.length === 0) return
      selected = (selected + (ev.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length
      render()
    } else if (ev.key === 'Enter') {
      ev.preventDefault()
      const command = shown[selected]
      if (command) run(command)
    }
  })

  return {
    open(initialQuery = ''): void {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
      input.value = initialQuery
      selected = 0
      backdrop.hidden = false
      render()
      input.focus()
    },
  }
}
