// One dispatcher for every shortcut (see lib/shortcuts.ts).
import type { Command } from '../lib/commands'
import { comboFor, comboFromEvent, scopeOf } from '../lib/shortcuts'

export interface DispatcherHost {
  /** The shortcut editor is recording keys itself. */
  isEditingShortcuts(): boolean
  isPaletteOpen(): boolean
  isZen(): boolean
  exitZen(): void
  activeTab(): string
  /** Candidates in priority order: the active tab's commands before the global ones. */
  commands(): readonly Command[]
}

/**
 * Handler for window keydown in the capture phase, so a bound combo beats the editors' and the
 * browser's own handling; unbound keys pass through untouched.
 */
export function createShortcutHandler(host: DispatcherHost): (ev: KeyboardEvent) => void {
  return (ev) => {
    if (ev.isComposing || host.isEditingShortcuts()) return
    if (ev.key === 'Escape' && host.isZen()) {
      host.exitZen()
      return
    }
    // Plain typing never matches a binding (only modifier combos and F-keys are bindable).
    if (!ev.ctrlKey && !ev.altKey && !ev.metaKey && !/^F\d{1,2}$/.test(ev.code)) return
    const combo = comboFromEvent(ev)
    if (!combo || host.isPaletteOpen()) return
    const active = host.activeTab()
    const command = host
      .commands()
      .find((c) => comboFor(c.id) === combo && (scopeOf(c.id) === 'global' || scopeOf(c.id) === active))
    if (!command) return
    ev.preventDefault()
    ev.stopPropagation()
    command.run()
  }
}
