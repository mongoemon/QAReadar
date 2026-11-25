// One to three editor splits side by side. Right-click a document tab to move it to a new split
// or another split; closing the last tab of a split removes that split.
import type { Command } from '../../lib/commands'
import { t } from '../../lib/i18n'
import { el } from '../dom'
import type { MenuItem } from '../menu'
import { toast } from '../toast'
import { createTextPane, type PaneHost, type TextPane } from './pane'

/** At most this many editor splits side by side. */
const MAX_SPLITS = 3

export interface Splits {
  readonly element: HTMLElement
  /** The split the toolbar, Save and Open act on. */
  active(): TextPane
  commands(): Command[]
  isDirty(): boolean
}

export function createSplits(changed: () => void): Splits {
  const panes: TextPane[] = []
  const element = el('section', { class: 'te-splits' })

  const host: PaneHost = {
    focus(pane) {
      if (pane === active) return
      active = pane
      renderSplits()
      changed()
    },
    canRemove: () => panes.length > 1,
    remove(pane) {
      const index = panes.indexOf(pane)
      if (index === -1) return
      panes.splice(index, 1)
      pane.element.remove()
      if (active === pane) active = panes[Math.min(index, panes.length - 1)]
      renderSplits()
      active.focus()
      changed()
    },
    splitItems(pane, docId) {
      const items: MenuItem[] = []
      if (panes.length < MAX_SPLITS) {
        items.push(
          { label: t('te.split.move'), icon: 'columns', disabled: pane.docCount() < 2, run: () => moveDoc(pane, docId, null) },
          { label: t('te.split.new'), icon: 'plus', run: () => newSplit(pane) },
        )
      }
      panes.forEach((other, index) => {
        if (other !== pane) items.push({ label: t('te.split.moveTo', { n: index + 1 }), run: () => moveDoc(pane, docId, other) })
      })
      return items
    },
    changed,
  }

  function addPane(after: TextPane | null): TextPane {
    const pane = createTextPane(host)
    const index = after ? panes.indexOf(after) + 1 : panes.length
    panes.splice(index, 0, pane)
    const next = panes[index + 1]
    element.insertBefore(pane.element, next ? next.element : null)
    return pane
  }

  let active: TextPane = addPane(null)

  function renderSplits(): void {
    element.classList.toggle('te-multi', panes.length > 1)
    panes.forEach((pane, index) => {
      pane.element.classList.toggle('te-active-split', pane === active)
      pane.element.dataset.split = String(index + 1)
    })
  }

  function activate(pane: TextPane): void {
    active = pane
    renderSplits()
    pane.focus()
    changed()
  }

  /** Move a document to `target`, or to a new split right of `from` when target is null. */
  function moveDoc(from: TextPane, docId: string, target: TextPane | null): void {
    if (!target && panes.length >= MAX_SPLITS) {
      toast(t('te.split.max', { n: MAX_SPLITS }), true)
      return
    }
    // Create the new split first: taking the last tab may remove `from`.
    const to = target ?? addPane(from)
    const entry = from.takeDoc(docId)
    if (entry) to.adopt(entry)
    activate(to)
  }

  function newSplit(from: TextPane): void {
    if (panes.length >= MAX_SPLITS) {
      toast(t('te.split.max', { n: MAX_SPLITS }), true)
      return
    }
    activate(addPane(from))
  }

  function cycleSplit(step: number): void {
    const index = panes.indexOf(active)
    activate(panes[(index + step + panes.length) % panes.length])
  }

  renderSplits()

  return {
    element,
    active: () => active,
    commands: () => [
      ...active.commands(),
      { id: 'text.split', title: t('te.cmd.split'), run: () => moveDoc(active, active.activeId(), null) },
      { id: 'text.splitNew', title: t('te.cmd.splitNew'), run: () => newSplit(active) },
      { id: 'text.nextSplit', title: t('te.cmd.nextSplit'), run: () => cycleSplit(1) },
    ],
    isDirty: () => panes.some((pane) => pane.isDirty()),
  }
}
