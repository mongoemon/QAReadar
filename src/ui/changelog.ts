import { CHANGELOG, type Release } from '../lib/changelog'
import { localized, t, type MessageKey } from '../lib/i18n'
import { el } from './dom'
import { iconButton } from './icons'

export const HOLD_MS = 3000

const SECTIONS: ReadonlyArray<readonly [keyof Pick<Release, 'added' | 'changed' | 'fixed'>, MessageKey]> = [
  ['added', 'cl.added'],
  ['changed', 'cl.changed'],
  ['fixed', 'cl.fixed'],
]

function renderRelease(release: Release, current: string): HTMLElement {
  const heading = el(
    'h3',
    { class: 'cl-version' },
    `v${release.version}`,
    el('span', { class: 'cl-date' }, release.date),
  )
  if (release.version === current) heading.append(el('span', { class: 'cl-current' }, t('cl.current')))
  const body = SECTIONS.flatMap(([key, label]) => {
    const items = release[key]
    if (!items?.length) return []
    return [el('h4', { class: 'cl-kind' }, t(label)), el('ul', { class: 'cl-list' }, ...items.map((t) => el('li', {}, t)))]
  })
  return el('section', { class: 'cl-release' }, heading, ...body)
}

/** Native <dialog>: focus trapping, Esc to close and the backdrop come for free. */
function createDialog(current: string): HTMLDialogElement {
  const close = iconButton('close', () => t('cl.close'), { variant: 'ghost cl-close', shortcut: 'Esc' })
  const title = el('h2', { id: 'cl-title' })
  const body = el('div', { class: 'cl-body' })
  const dialog = el('dialog', { class: 'changelog', 'aria-labelledby': 'cl-title' }, el('header', { class: 'cl-head' }, title, close), body)
  localized(() => {
    title.textContent = t('cl.title')
    body.replaceChildren(...CHANGELOG.map((r) => renderRelease(r, current)))
  })
  close.addEventListener('click', () => dialog.close())
  // Click on the backdrop (outside the box) closes.
  dialog.addEventListener('click', (ev) => {
    if (ev.target === dialog) dialog.close()
  })
  document.body.append(dialog)
  return dialog
}

/**
 * Turns the version badge into a press-and-hold trigger: hold 3 s (mouse, touch or
 * Enter/Space) to open the changelog. A fill animates while holding; releasing early cancels.
 */
export function attachChangelog(badge: HTMLElement, current: string): { open: () => void } {
  let dialog: HTMLDialogElement | null = null
  let timer: number | undefined

  const open = (): void => {
    dialog ??= createDialog(current)
    if (!dialog.open) dialog.showModal()
  }
  const cancel = (): void => {
    window.clearTimeout(timer)
    timer = undefined
    badge.classList.remove('holding')
  }
  const start = (): void => {
    if (timer !== undefined) return
    badge.classList.add('holding')
    timer = window.setTimeout(() => {
      cancel()
      open()
    }, HOLD_MS)
  }

  badge.style.setProperty('--hold-ms', `${HOLD_MS}ms`)
  badge.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return
    badge.setPointerCapture(ev.pointerId)
    start()
  })
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) badge.addEventListener(type, cancel)
  // Long-press on touch would otherwise open the context menu / selection callout.
  badge.addEventListener('contextmenu', (ev) => ev.preventDefault())
  badge.addEventListener('keydown', (ev) => {
    if ((ev.key === 'Enter' || ev.key === ' ') && !ev.repeat) {
      ev.preventDefault()
      start()
    }
  })
  badge.addEventListener('keyup', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') cancel()
  })
  badge.addEventListener('blur', cancel)

  return { open }
}
