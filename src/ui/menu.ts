import { el } from './dom'
import { icon, type IconName } from './icons'

export interface MenuItem {
  readonly label: string
  readonly icon?: IconName
  /** Shortcut shown on the right, e.g. 'Alt+N'. */
  readonly hint?: string
  readonly disabled?: boolean
  readonly run: () => void
}

/** Where the menu appears: under an anchor element, or at a pointer position. */
export type MenuAt = HTMLElement | { readonly x: number; readonly y: number }

let current: { close(): void } | null = null

/**
 * Show a popup menu (dropdown or context menu). Only one is open at a time.
 * Arrow keys / Home / End move, Enter or Space runs, Esc / outside click / blur closes.
 */
export function showMenu(items: readonly MenuItem[], at: MenuAt, label = ''): void {
  current?.close()
  const anchor = at instanceof HTMLElement ? at : null
  const returnFocus = anchor ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)

  const buttons = items.map((item) => {
    const button = el(
      'button',
      { class: 'menu-item', type: 'button', role: 'menuitem' },
      item.icon ? icon(item.icon, 15) : el('span', { class: 'menu-icon-gap' }),
      el('span', { class: 'menu-label' }, item.label),
      item.hint ? el('kbd', {}, item.hint) : '',
    )
    button.disabled = item.disabled ?? false
    button.addEventListener('click', () => {
      close(false)
      item.run()
    })
    return button
  })
  const menu = el('div', { class: 'menu', role: 'menu' }, ...buttons)
  if (label) menu.setAttribute('aria-label', label)
  document.body.append(menu)
  anchor?.setAttribute('aria-expanded', 'true')

  // Keep the menu inside the viewport (flip above the anchor / pointer when there is no room below).
  const rect = anchor?.getBoundingClientRect()
  const x = rect ? rect.left : (at as { x: number }).x
  const y = rect ? rect.bottom + 4 : (at as { y: number }).y
  const { width, height } = menu.getBoundingClientRect()
  const flipped = y + height > window.innerHeight - 4
  const top = flipped ? (rect ? rect.top - 4 : y) - height : y
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - width - 4))}px`
  menu.style.top = `${Math.max(4, top)}px`

  const enabled = (): HTMLButtonElement[] => buttons.filter((b) => !b.disabled)
  enabled()[0]?.focus()

  function onKey(ev: KeyboardEvent): void {
    const list = enabled()
    const index = list.indexOf(document.activeElement as HTMLButtonElement)
    if (ev.key === 'Escape') close(true)
    else if (ev.key === 'ArrowDown') list[(index + 1) % list.length]?.focus()
    else if (ev.key === 'ArrowUp') list[(index - 1 + list.length) % list.length]?.focus()
    else if (ev.key === 'Home') list[0]?.focus()
    else if (ev.key === 'End') list[list.length - 1]?.focus()
    else if (ev.key === 'Tab') {
      close(false)
      return
    } else return
    ev.preventDefault()
    ev.stopPropagation()
  }
  function onPointer(ev: PointerEvent): void {
    // The anchor's own click toggles the menu (see closeMenu), so leave that to it.
    if (!menu.contains(ev.target as Node) && !anchor?.contains(ev.target as Node)) close(false)
  }
  const onBlur = (): void => close(false)

  function close(restoreFocus: boolean): void {
    if (current !== handle) return
    current = null
    menu.remove()
    anchor?.setAttribute('aria-expanded', 'false')
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('pointerdown', onPointer, true)
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('resize', onBlur)
    if (restoreFocus) returnFocus?.focus()
  }
  const handle = { close: () => close(false) }
  current = handle
  document.addEventListener('keydown', onKey, true)
  document.addEventListener('pointerdown', onPointer, true)
  window.addEventListener('blur', onBlur)
  window.addEventListener('resize', onBlur)
}

/** Close the open menu, if any. Returns whether one was open (so a toggle button can stop there). */
export function closeMenu(): boolean {
  if (!current) return false
  current.close()
  return true
}
