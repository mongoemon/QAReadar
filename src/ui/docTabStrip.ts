import { isDocDirty, otherDocs, type Doc, type DocSet } from '../lib/docSet'
import { t } from '../lib/i18n'
import { shortcutLabel } from '../lib/shortcuts'
import { el } from './dom'
import { icon } from './icons'
import { showMenu, type MenuAt, type MenuItem } from './menu'

/** What the strip needs from the tab that owns the documents. */
export interface DocTabStripOptions {
  /** Command ids whose shortcuts appear in the tooltips and menu hints. */
  readonly commands: { readonly newDoc: string; readonly duplicate: string; readonly close: string }
  getSet(): DocSet
  newDocument(): void
  switchTo(id: string): void
  duplicate(id: string): void
  close(id: string): void
  closeOthers(id: string): void
  /** A mark before the name and the tooltip that explains it; null for an ordinary tab. */
  decorate?(doc: Doc): { readonly mark: Node; readonly title: string } | null
  /** More entries at the end of a document tab's context menu. */
  extraItems?(id: string): readonly MenuItem[]
}

export interface DocTabStrip {
  readonly element: HTMLElement
  /** Redraw from the current documents, language and shortcuts. */
  render(): void
}

/** "Label (shortcut)" for a tooltip, or just the label when the command has no shortcut. */
function withKey(label: string, id: string): string {
  const key = shortcutLabel(id)
  return key ? `${label} (${key})` : label
}

/**
 * The row of document tabs. Click switches, middle-click closes, right-click (or Shift+F10)
 * opens the document menu; double-clicking the empty part creates a new document.
 */
export function createDocTabStrip(options: DocTabStripOptions): DocTabStrip {
  const { commands } = options
  const element = el('div', { class: 'doc-tabs', role: 'tablist' })

  const newItem = (): MenuItem => ({
    label: t('md.newDoc'),
    icon: 'plus',
    hint: shortcutLabel(commands.newDoc),
    run: () => options.newDocument(),
  })

  function showDocMenu(id: string, at: MenuAt): void {
    showMenu(
      [
        newItem(),
        { label: t('md.duplicateDoc'), icon: 'duplicate', hint: shortcutLabel(commands.duplicate), run: () => options.duplicate(id) },
        { label: t('md.closeTip'), icon: 'close', hint: shortcutLabel(commands.close), run: () => options.close(id) },
        { label: t('md.closeOthers'), disabled: otherDocs(options.getSet(), id).length === 0, run: () => options.closeOthers(id) },
        ...(options.extraItems?.(id) ?? []),
      ],
      at,
      t('md.docMenuAria'),
    )
  }

  function openMenuFor(id: string, at: MenuAt): void {
    options.switchTo(id)
    showDocMenu(id, at)
  }

  function renderItem(doc: Doc, selected: boolean): HTMLElement {
    const decoration = options.decorate?.(doc) ?? null
    const tab = el(
      'button',
      { class: 'doc-tab', role: 'tab', type: 'button', 'aria-selected': String(selected), title: decoration?.title ?? doc.name },
      decoration?.mark ?? '',
      isDocDirty(doc) ? '● ' : '',
      doc.name,
    )
    tab.addEventListener('click', () => options.switchTo(doc.id))
    // Shift+F10 / the context-menu key on a focused tab opens the same menu as right-click.
    tab.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ContextMenu' && !(ev.shiftKey && ev.key === 'F10')) return
      ev.preventDefault()
      openMenuFor(doc.id, tab)
    })

    const close = el(
      'button',
      { class: 'doc-close', type: 'button', 'aria-label': t('md.closeDoc', { name: doc.name }), title: withKey(t('md.closeTip'), commands.close) },
      icon('close', 12),
    )
    close.addEventListener('click', () => options.close(doc.id))

    const item = el('span', { class: selected ? 'doc-item active' : 'doc-item' }, tab, close)
    item.addEventListener('contextmenu', (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      openMenuFor(doc.id, { x: ev.clientX, y: ev.clientY })
    })
    // Middle-click closes, as in a browser.
    item.addEventListener('auxclick', (ev) => {
      if (ev.button !== 1) return
      ev.preventDefault()
      options.close(doc.id)
    })
    return item
  }

  // Right-click on the empty part of the strip: just "New document".
  element.addEventListener('contextmenu', (ev) => {
    ev.preventDefault()
    showMenu([newItem()], { x: ev.clientX, y: ev.clientY })
  })
  element.addEventListener('dblclick', (ev) => {
    if (ev.target === element) options.newDocument()
  })

  function render(): void {
    const addBtn = el(
      'button',
      { class: 'doc-add', type: 'button', 'aria-label': t('md.newDoc'), title: withKey(t('md.newDoc'), commands.newDoc) },
      icon('plus', 14),
    )
    addBtn.addEventListener('click', () => options.newDocument())
    const { docs, activeId } = options.getSet()
    element.setAttribute('aria-label', t('md.docsAria'))
    element.replaceChildren(...docs.map((doc) => renderItem(doc, doc.id === activeId)), addBtn)
  }

  return { element, render }
}
