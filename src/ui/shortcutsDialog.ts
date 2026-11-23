import type { Command } from '../lib/commands'
import { localized, t } from '../lib/i18n'
import {
  PLATFORM,
  DEFAULT_SHORTCUTS,
  checkCombo,
  comboFor,
  comboFromEvent,
  conflictsWith,
  defaultCombo,
  formatCombo,
  hasCustomCombos,
  isCustomized,
  resetAllCombos,
  resetCombo,
  setCombo,
  withShortcuts,
} from '../lib/shortcuts'
import { el } from './dom'
import { icon, iconButton } from './icons'

export interface ShortcutGroup {
  readonly title: string
  readonly commands: readonly Command[]
}

export interface ShortcutsDialog {
  open(): void
  /** True while the dialog is showing: the app's own shortcuts stand down. */
  isOpen(): boolean
}

const label = (combo: string | null): string => (combo ? formatCombo(combo, PLATFORM) : '')

/**
 * Keyboard shortcut editor: every command, grouped by tab. Click a key cap, press the new
 * combination (Esc cancels). Each row can go back to its default; "Reset all" restores everything.
 */
export function createShortcutsDialog(getGroups: () => readonly ShortcutGroup[]): ShortcutsDialog {
  const title = el('h2', { id: 'sc-title' })
  const close = iconButton('close', () => t('cl.close'), { variant: 'ghost cl-close', shortcut: 'Esc' })
  const search = el('input', { class: 'sc-search', type: 'search', autocomplete: 'off' })
  const resetAll = el('button', { class: 'btn small ghost', type: 'button' })
  const platformNote = el('p', { class: 'sc-note' })
  const fixedNote = el('p', { class: 'sc-note' })
  const message = el('p', { class: 'sc-message', role: 'status', 'aria-live': 'polite' })
  const body = el('div', { class: 'sc-body' })
  const dialog = el(
    'dialog',
    { class: 'changelog shortcuts', 'aria-labelledby': 'sc-title' },
    el('header', { class: 'cl-head' }, title, close),
    el('div', { class: 'sc-tools' }, search, resetAll),
    message,
    body,
    el('footer', { class: 'sc-foot' }, platformNote, fixedNote),
  )
  document.body.append(dialog)

  /** Command being re-bound, waiting for a key press. */
  let recording: string | null = null
  let groups: readonly ShortcutGroup[] = []

  const allIds = (): string[] => [...new Set([...groups.flatMap((g) => g.commands.map((c) => c.id)), ...Object.keys(DEFAULT_SHORTCUTS)])]
  const titleOf = (id: string): string => groups.flatMap((g) => g.commands).find((c) => c.id === id)?.title ?? id

  function say(text: string, error = false): void {
    message.textContent = text
    message.classList.toggle('error', error)
  }

  function row(command: Command): HTMLElement {
    const combo = comboFor(command.id)
    const isRecording = recording === command.id
    const cap = el(
      'button',
      {
        class: `sc-key${isCustomized(command.id) ? ' custom' : ''}${isRecording ? ' recording' : ''}${combo ? '' : ' empty'}`,
        type: 'button',
        'aria-label': t('sc.edit', { name: command.title }),
        title: t('sc.edit', { name: command.title }),
      },
      isRecording ? t('sc.press') : combo ? el('kbd', {}, label(combo)) : t('sc.none'),
    )
    cap.addEventListener('click', () => startRecording(command.id))

    const resetTip = t('sc.reset', { key: label(defaultCombo(command.id)) || t('sc.none') })
    const reset = el('button', { class: 'sc-act', type: 'button', title: resetTip, 'aria-label': resetTip }, icon('refresh', 14))
    reset.hidden = !isCustomized(command.id)
    reset.addEventListener('click', () => {
      resetCombo(command.id)
      say(t('sc.saved', { name: command.title, key: label(comboFor(command.id)) || t('sc.none') }))
    })

    const clear = el('button', { class: 'sc-act', type: 'button', title: t('sc.clear'), 'aria-label': t('sc.clear') }, icon('close', 14))
    clear.hidden = combo === null
    clear.addEventListener('click', () => {
      setCombo(command.id, null)
      say(t('sc.saved', { name: command.title, key: t('sc.none') }))
    })

    return el(
      'div',
      { class: 'sc-row', 'data-id': command.id },
      el('span', { class: 'sc-name' }, command.title),
      cap,
      el('span', { class: 'sc-acts' }, reset, clear),
    )
  }

  function render(): void {
    if (!dialog.open) return
    const query = search.value.trim().toLowerCase()
    const matches = (c: Command): boolean =>
      query === '' || c.title.toLowerCase().includes(query) || label(comboFor(c.id)).toLowerCase().includes(query)
    const sections = groups.flatMap((group) => {
      const rows = group.commands.filter(matches)
      return rows.length === 0 ? [] : [el('section', { class: 'sc-group' }, el('h3', {}, group.title), ...rows.map(row))]
    })
    const focusedId = (document.activeElement?.closest('.sc-row') as HTMLElement | null)?.dataset.id
    body.replaceChildren(...(sections.length ? sections : [el('p', { class: 'sc-note' }, t('sc.empty'))]))
    resetAll.disabled = !hasCustomCombos()
    // Keep keyboard users where they were after a re-render.
    if (focusedId) body.querySelector<HTMLElement>(`.sc-row[data-id="${CSS.escape(focusedId)}"] .sc-key`)?.focus()
  }

  function startRecording(id: string): void {
    recording = id
    say(t('sc.pressHint'))
    render()
  }

  function stopRecording(): void {
    recording = null
    render()
  }

  function assign(id: string, combo: string): void {
    const problem = checkCombo(combo, PLATFORM)
    const key = label(combo)
    if (problem === 'esc') return say(t('sc.esc'), true)
    if (problem === 'reserved') return say(t('sc.reserved', { key }), true)
    if (problem === 'modifier') return say(t(PLATFORM === 'mac' ? 'sc.needModifierMac' : 'sc.needModifierOther'), true)
    const clashes = conflictsWith(id, combo, allIds(), comboFor)
    if (clashes.length > 0 && !window.confirm(t('sc.conflict', { key, names: clashes.map(titleOf).join(', ') }))) {
      say('')
      stopRecording()
      return
    }
    for (const other of clashes) setCombo(other, null)
    recording = null
    setCombo(id, combo)
    say(t('sc.saved', { name: titleOf(id), key }))
  }

  // Capture phase on the dialog: while recording, every key belongs to the recorder.
  dialog.addEventListener(
    'keydown',
    (ev) => {
      if (!recording) return
      ev.preventDefault()
      ev.stopPropagation()
      if (ev.key === 'Escape') {
        say('')
        stopRecording()
        return
      }
      const combo = comboFromEvent(ev)
      if (combo) assign(recording, combo)
    },
    true,
  )
  // Esc while recording cancels the recording, not the dialog.
  dialog.addEventListener('cancel', (ev) => {
    if (recording) ev.preventDefault()
  })
  dialog.addEventListener('close', () => {
    recording = null
    say('')
  })
  dialog.addEventListener('click', (ev) => {
    if (ev.target === dialog) dialog.close()
  })
  close.addEventListener('click', () => dialog.close())
  search.addEventListener('input', render)
  resetAll.addEventListener('click', () => {
    if (!window.confirm(t('sc.confirmResetAll'))) return
    resetAllCombos()
    say(t('sc.resetDone'))
  })

  localized(() => {
    title.textContent = t('sc.title')
    search.placeholder = t('sc.search')
    search.setAttribute('aria-label', t('sc.search'))
    resetAll.textContent = t('sc.resetAll')
    platformNote.textContent = t(PLATFORM === 'mac' ? 'sc.platformMac' : 'sc.platformOther')
    fixedNote.textContent = t('sc.fixed', { block: formatCombo('Alt+Shift+Down', PLATFORM).replace(/↓$/, '↑↓←→') })
    if (dialog.open) {
      groups = getGroups()
      render()
    }
  })
  withShortcuts(render)

  return {
    open(): void {
      groups = getGroups()
      search.value = ''
      say('')
      if (!dialog.open) dialog.showModal()
      render()
      search.focus()
    },
    isOpen: () => dialog.open,
  }
}
