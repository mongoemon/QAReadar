// One editor split: its own document tabs, editor, find bar and status line.
import type { Command } from '../../lib/commands'
import { blockHeight, bounds } from '../../lib/columnSelection'
import { TABLE_EXTENSIONS } from '../../lib/csv'
import {
  activeDoc,
  addDoc,
  closeDoc,
  copyName,
  createDocSet,
  insertDocAfter,
  isDocDirty,
  keepOnly,
  markDocSaved,
  otherDocs,
  replaceDoc,
  setActive,
  steppedId,
  updateText,
  type Doc,
  type DocSet,
} from '../../lib/docSet'
import type { DocSnapshot, FileHandleLike, OpenedFile } from '../../lib/fileAccess'
import { extensionOf } from '../../lib/fileKind'
import { localized, t } from '../../lib/i18n'
import { readStored, writeStored } from '../../lib/safeStorage'
import { ALT_LABEL, keyHint, shortcutLabel, withShortcuts } from '../../lib/shortcuts'
import {
  countLines,
  detectEol,
  EOL_NAMES,
  EOLS,
  lineStartOffset,
  normalizeEol,
  TEXT_TOOLS,
  withEol,
  type Eol,
  type TextToolId,
} from '../../lib/textTools'
import { createCsvView } from '../csvTable'
import { createDocTabStrip } from '../docTabStrip'
import { el } from '../dom'
import { createFindBar } from '../findBar'
import { iconButton, setIconButton } from '../icons'
import type { MenuItem } from '../menu'
import { toast } from '../toast'
import { createColumnSelection } from './columnSelect'
import { createEditing, renderToolOptions, toolKey } from './editing'
import { createEditorSurface, type Hit } from './overlay'

const DEFAULT_NAME = 'untitled.txt'
const WRAP_KEY = 'qareadar:text-wrap'

/** Per-document editor state kept while another document tab is shown. */
export interface DocView {
  readonly eol: Eol
  readonly view: 'text' | 'table'
  readonly selStart: number
  readonly selEnd: number
  readonly scrollTop: number
  readonly scrollLeft: number
}

let docSeq = 0
/** Doc text is stored as it would be saved: line endings already in the doc's own EOL. */
const makeDoc = (name: string, text: string, handle: FileHandleLike | null, savedText: string = text): Doc => ({
  id: `txt${++docSeq}`,
  name,
  text,
  savedText,
  handle,
})

/** A document moving between splits, with everything needed to show it the same way. */
export interface DocEntry {
  readonly doc: Doc
  readonly view: DocView | undefined
  readonly ephemeral: boolean
}

/** What a split asks of the Text tab that holds it. */
export interface PaneHost {
  focus(pane: TextPane): void
  /** True when the split may disappear (it is not the last one). */
  canRemove(pane: TextPane): boolean
  remove(pane: TextPane): void
  /** Extra items for a document tab's context menu (split / move). */
  splitItems(pane: TextPane, docId: string): MenuItem[]
  changed(): void
}

/** One editor split, as seen by the Text tab. */
export interface TextPane {
  readonly element: HTMLElement
  commands(): Command[]
  activeId(): string
  docCount(): number
  open(file: OpenedFile): void
  /** Remove a document without asking (it is moving to another split). */
  takeDoc(id: string): DocEntry | null
  adopt(entry: DocEntry): void
  snapshot(): DocSnapshot
  markSaved(name: string, handle: FileHandleLike | null): void
  isDirty(): boolean
  focus(): void
}

export function createTextPane(host: PaneHost): TextPane {
  const notify = (): void => host.changed()

  /** Docs not worth keeping a tab for while clean (blank new doc, untouched sample). */
  const ephemeral = new Set<string>()
  const views = new Map<string, DocView>()
  const blank = makeDoc(DEFAULT_NAME, '', null)
  ephemeral.add(blank.id)
  let set: DocSet = createDocSet(blank)
  let eol: Eol = '\n'
  let wrap = readStored(WRAP_KEY) === 'on'
  let hit: Hit | null = null
  /** Plain text, or the CSV / TSV table view of the same document. */
  let view: 'text' | 'table' = 'text'

  // ── chrome ──
  const tableBtn = el('button', { class: 'btn with-icon small ghost te-view', type: 'button' })
  const findBtn = iconButton('search', () => t('te.find'), { variant: 'small ghost', shortcut: () => shortcutLabel('text.find') })
  const replaceBtn = iconButton('replace', () => t('te.replace'), { variant: 'small ghost', shortcut: () => shortcutLabel('text.replace') })
  const gotoBtn = iconButton('hash', () => t('te.goto'), { variant: 'small ghost', shortcut: () => shortcutLabel('text.goto') })
  const wrapBtn = el('button', { class: 'btn icon-only small ghost', type: 'button' })
  const toolsSelect = el('select', { class: 'te-tools' })
  const hint = el('span', { class: 'hint te-hint' })
  const textControls = el('div', { class: 'te-text-controls' }, findBtn, replaceBtn, gotoBtn, wrapBtn, toolsSelect)
  const spacer = el('span', { class: 'merge-spacer' })
  const bar = el('div', { class: 'pane-bar te-bar' }, tableBtn, textControls, spacer, hint)

  const surface = createEditorSurface({ isWrap: () => wrap, getBlock: () => column.get(), getHit: () => hit })
  const { input } = surface

  const posEl = el('span', {})
  const blockEl = el('span', { class: 'te-block-info' })
  const sizeEl = el('span', {})
  const eolBtn = el('button', { class: 'btn small ghost te-eol', type: 'button' })
  const status = el('div', { class: 'md-status te-status' }, posEl, blockEl, sizeEl, eolBtn)

  const editing = createEditing({
    surface,
    column: () => column,
    replaced() {
      hit = null
      afterChange()
    },
    afterChange,
    refreshStatus,
  })
  const column = createColumnSelection({
    surface,
    isWrap: () => wrap,
    unwrap: () => setWrap(false),
    replace: editing.replaceRange,
    isApplying: editing.isApplying,
    clearHit() {
      hit = null
    },
    indent: editing.indent,
    changed() {
      surface.renderOverlay()
      refreshStatus()
    },
  })

  const findBar = createFindBar({
    getText: () => input.value,
    setText(text) {
      column.clear()
      editing.replaceRange(0, input.value.length, text)
    },
    canSelect: () => true,
    select(start, end) {
      column.clear()
      input.setSelectionRange(start, end)
      hit = { start, end }
      surface.scrollToOffset(start)
      surface.renderOverlay()
      refreshStatus()
    },
    findInView: () => false,
  })

  const csv = createCsvView({
    getText: () => input.value,
    getFileName: () => activeDoc(set).name,
    replace(start, end, text) {
      // The textarea is hidden in table view, so write directly (the browser's undo can't follow).
      input.value = input.value.slice(0, start) + text + input.value.slice(end)
      afterChange()
    },
    revealLine(line) {
      setView('text')
      const start = lineStartOffset(input.value, line)
      const nl = input.value.indexOf('\n', start)
      input.focus({ preventScroll: true })
      input.setSelectionRange(start, nl === -1 ? input.value.length : nl)
      surface.scrollToOffset(start)
      refreshStatus()
    },
  })
  csv.element.hidden = true
  csv.controls.hidden = true
  bar.insertBefore(csv.controls, spacer)

  const docStrip = createDocTabStrip({
    commands: { newDoc: 'text.new', duplicate: 'text.duplicateDoc', close: 'text.close' },
    getSet: () => set,
    newDocument,
    switchTo,
    duplicate: duplicateById,
    close: closeById,
    closeOthers,
    extraItems: (id) => host.splitItems(api, id),
  })
  const element = el('section', { class: 'pane te-pane' }, bar, docStrip.element, findBar.element, surface.element, csv.element, status)

  // ── rendering ──
  function refreshStatus(): void {
    const text = input.value
    if (view === 'table') {
      posEl.textContent = csv.summary()
      blockEl.hidden = true
      sizeEl.textContent = t('te.size', { lines: countLines(text), chars: text.length })
      eolBtn.textContent = EOL_NAMES[eol]
      eolBtn.title = t('te.eolTip', { eol: EOL_NAMES[eol] })
      return
    }
    const { line, col } = surface.cellOf(input.selectionEnd)
    const selected = Math.abs(input.selectionEnd - input.selectionStart)
    posEl.textContent =
      t('te.pos', { line: line + 1, col: col + 1 }) + (selected > 0 ? ` · ${t('te.sel', { n: selected })}` : '')
    const block = column.get()
    if (block) {
      const b = bounds(block)
      blockEl.textContent = t('te.blockInfo', { rows: blockHeight(text, block), cols: b.right - b.left })
    }
    blockEl.hidden = block === null
    sizeEl.textContent = t('te.size', { lines: countLines(text), chars: text.length })
    eolBtn.textContent = EOL_NAMES[eol]
    eolBtn.title = t('te.eolTip', { eol: EOL_NAMES[eol] })
  }

  function renderWrapBtn(): void {
    setIconButton(wrapBtn, 'wrap', wrap ? t('te.wrapOn') : t('te.wrapOff'))
    wrapBtn.setAttribute('aria-pressed', String(wrap))
  }

  function setWrap(on: boolean): void {
    wrap = on
    writeStored(WRAP_KEY, on ? 'on' : 'off')
    surface.setWrapped(on)
    if (on) column.drop()
    renderWrapBtn()
    surface.renderGutter()
    surface.renderOverlay()
    refreshStatus()
  }

  function renderTableBtn(): void {
    const table = view === 'table'
    setIconButton(tableBtn, 'table', table ? t('te.viewTextTip') : t('te.viewTableTip'), t('te.viewTable'))
    tableBtn.setAttribute('aria-pressed', String(table))
  }

  function setView(next: 'text' | 'table'): void {
    if (next === view) return
    view = next
    const table = view === 'table'
    if (table) {
      column.drop()
      hit = null
      findBar.close()
      csv.render()
    }
    surface.element.hidden = table
    textControls.hidden = table
    hint.hidden = table
    csv.element.hidden = !table
    csv.controls.hidden = !table
    renderTableBtn()
    if (!table) {
      surface.renderGutter()
      surface.renderOverlay()
    }
    refreshStatus()
  }

  function afterChange(): void {
    // Keep the doc model current so tab dots, isDirty and switching never lag behind.
    const doc = activeDoc(set)
    const wasDirty = isDocDirty(doc)
    set = updateText(set, doc.id, withEol(input.value, eol))
    if (isDocDirty(activeDoc(set)) !== wasDirty) renderDocTabs()
    if (view === 'table') csv.render()
    surface.renderGutter()
    surface.renderOverlay()
    refreshStatus()
    notify()
  }

  // ── wiring ──
  input.addEventListener('input', () => {
    if (editing.isApplying()) return
    hit = null
    afterChange()
  })
  document.addEventListener('selectionchange', () => {
    if (document.activeElement === input) refreshStatus()
  })

  const openFind = (withReplace: boolean): void => {
    const seed = column.selectedText() ?? input.value.slice(input.selectionStart, input.selectionEnd)
    findBar.open(withReplace, seed)
  }

  const cycleEol = (): void => {
    eol = EOLS[(EOLS.indexOf(eol) + 1) % EOLS.length]
    toast(t('te.eolChanged', { eol: EOL_NAMES[eol] }))
    afterChange()
  }

  tableBtn.addEventListener('click', () => setView(view === 'table' ? 'text' : 'table'))
  findBtn.addEventListener('click', () => openFind(false))
  replaceBtn.addEventListener('click', () => openFind(true))
  gotoBtn.addEventListener('click', editing.goToLine)
  wrapBtn.addEventListener('click', () => setWrap(!wrap))
  eolBtn.addEventListener('click', cycleEol)
  toolsSelect.addEventListener('change', () => {
    const id = toolsSelect.value
    toolsSelect.value = ''
    if ((TEXT_TOOLS as readonly string[]).includes(id)) editing.runTool(id as TextToolId)
    input.focus()
  })
  // Shortcuts (Ctrl/⌘+F, H, G, D …) are dispatched by main.ts to the commands below.
  /** Find: in the table view, the table's own row filter. */
  function findCommand(): void {
    if (view === 'table') csv.focusFilter()
    else openFind(false)
  }
  /** Replace / go to line work on the text: leave the table first. */
  function textOnly(action: () => void): () => void {
    return () => {
      setView('text')
      action()
    }
  }
  function duplicateCommand(): void {
    if (view === 'table') return
    column.drop()
    editing.duplicateLines()
  }

  // ── documents (one tab per file) ──
  /** Remember the shown document's text, cursor, scroll and view before showing another. */
  function stash(): void {
    const doc = activeDoc(set)
    set = updateText(set, doc.id, withEol(input.value, eol))
    views.set(doc.id, {
      eol,
      view,
      selStart: input.selectionStart,
      selEnd: input.selectionEnd,
      scrollTop: input.scrollTop,
      scrollLeft: input.scrollLeft,
    })
  }

  /** Show the active document in the editor. */
  function loadActive(): void {
    const doc = activeDoc(set)
    const saved = views.get(doc.id)
    eol = saved?.eol ?? detectEol(doc.text)
    column.drop()
    hit = null
    findBar.close()
    input.value = normalizeEol(doc.text)
    csv.reset()
    // CSV / TSV open as a table; everything else as text. A doc seen before keeps its view.
    const next = saved?.view ?? (TABLE_EXTENSIONS.includes(extensionOf(doc.name)) ? 'table' : 'text')
    if (next !== view) setView(next)
    const max = input.value.length
    input.setSelectionRange(Math.min(saved?.selStart ?? 0, max), Math.min(saved?.selEnd ?? 0, max))
    input.scrollTop = saved?.scrollTop ?? 0
    input.scrollLeft = saved?.scrollLeft ?? 0
    afterChange()
    renderDocTabs()
  }

  /** A document as read from disk, with its line endings made consistent. */
  function docFrom(file: { readonly name: string; readonly text: string; readonly handle: FileHandleLike | null }): Doc {
    const text = withEol(normalizeEol(file.text), detectEol(file.text))
    return makeDoc(file.name, text, file.handle)
  }

  /** The blank untitled doc you start with is replaced by the first file opened. */
  const isReplaceable = (doc: Doc): boolean => !doc.handle && !isDocDirty(doc) && doc.name === DEFAULT_NAME && doc.text === ''

  function openDoc(doc: Doc): void {
    stash()
    const current = activeDoc(set)
    if (isReplaceable(current)) {
      views.delete(current.id)
      ephemeral.delete(current.id)
      set = { ...replaceDoc(set, current.id, doc), activeId: doc.id }
    } else {
      set = addDoc(set, doc)
    }
    loadActive()
  }

  function switchTo(id: string): void {
    if (id === set.activeId) return
    stash()
    set = setActive(set, id)
    loadActive()
  }

  function newDocument(): void {
    stash()
    const doc = makeDoc(DEFAULT_NAME, '', null)
    ephemeral.add(doc.id)
    set = addDoc(set, doc)
    loadActive()
    input.focus()
  }

  function duplicateById(id: string): void {
    stash()
    const source = set.docs.find((d) => d.id === id)
    if (!source) return
    // A copy is a new, unsaved document: no file link, so Save asks where to put it.
    const copy = makeDoc(copyName(source.name, set.docs.map((d) => d.name)), source.text, null, '')
    const sourceView = views.get(id)
    if (sourceView) views.set(copy.id, { ...sourceView, selStart: 0, selEnd: 0, scrollTop: 0, scrollLeft: 0 })
    set = insertDocAfter(set, id, copy)
    loadActive()
    input.focus()
  }

  function forget(id: string): void {
    views.delete(id)
    ephemeral.delete(id)
  }

  function closeById(id: string): void {
    stash()
    const doc = set.docs.find((d) => d.id === id)
    if (!doc) return
    if (isDocDirty(doc) && !window.confirm(t('md.confirmClose', { name: doc.name }))) return
    // Closing the last tab of a split closes the split (unless it is the only one).
    if (set.docs.length === 1 && host.canRemove(api)) {
      host.remove(api)
      return
    }
    const wasActive = id === set.activeId
    set = closeDoc(set, id, () => {
      const fresh = makeDoc(DEFAULT_NAME, '', null)
      ephemeral.add(fresh.id)
      return fresh
    })
    forget(id)
    if (wasActive || set.docs.length === 1) loadActive()
    else renderDocTabs()
    notify()
  }

  function closeOthers(id: string): void {
    stash()
    const others = otherDocs(set, id)
    const dirty = others.filter(isDocDirty)
    if (dirty.length > 0 && !window.confirm(t('md.confirmCloseOthers', { n: dirty.length }))) return
    for (const doc of others) forget(doc.id)
    const wasActive = id === set.activeId
    set = keepOnly(set, id)
    if (wasActive) renderDocTabs()
    else loadActive()
    notify()
  }

  /** Move to the next (+1) or previous (-1) document tab, wrapping around. */
  function cycleDoc(step: number): void {
    switchTo(steppedId(set, step))
  }

  function takeDoc(id: string): DocEntry | null {
    stash()
    const doc = set.docs.find((d) => d.id === id)
    if (!doc) return null
    const entry: DocEntry = { doc, view: views.get(id), ephemeral: ephemeral.has(id) }
    if (set.docs.length === 1 && host.canRemove(api)) {
      host.remove(api)
      return entry
    }
    const wasActive = id === set.activeId
    set = closeDoc(set, id, () => {
      const fresh = makeDoc(DEFAULT_NAME, '', null)
      ephemeral.add(fresh.id)
      return fresh
    })
    forget(id)
    if (wasActive || set.docs.length === 1) loadActive()
    else renderDocTabs()
    return entry
  }

  function adopt(entry: DocEntry): void {
    if (entry.ephemeral) ephemeral.add(entry.doc.id)
    if (entry.view) views.set(entry.doc.id, entry.view)
    openDoc(entry.doc)
  }

  function renderDocTabs(): void {
    docStrip.render()
  }

  surface.setWrapped(wrap)
  // Whichever split you click or type in becomes the one the toolbar, Save and Open act on.
  element.addEventListener('focusin', () => host.focus(api))
  element.addEventListener('pointerdown', () => host.focus(api))

  localized(() => {
    input.setAttribute('aria-label', t('te.aria'))
    input.placeholder = t('te.placeholder')
    renderHint()
    renderTableBtn()
    renderWrapBtn()
    renderToolOptions(toolsSelect)
    renderDocTabs()
    refreshStatus()
  })

  const commands = (): Command[] => [
    { id: 'text.find', title: t('te.cmd.find'), run: findCommand },
    { id: 'text.replace', title: t('te.cmd.replace'), run: textOnly(() => openFind(true)) },
    { id: 'text.goto', title: t('te.cmd.goto'), run: textOnly(editing.goToLine) },
    { id: 'text.duplicate', title: t('te.cmd.duplicate'), run: duplicateCommand },
    { id: 'text.table', title: t('te.cmd.table'), run: () => setView(view === 'table' ? 'text' : 'table') },
    { id: 'text.wrap', title: t('te.cmd.wrap'), run: () => setWrap(!wrap) },
    { id: 'text.eol', title: t('te.cmd.eol'), run: cycleEol },
    { id: 'text.new', title: t('te.cmd.new'), run: newDocument },
    { id: 'text.duplicateDoc', title: t('te.cmd.duplicateDoc'), run: () => duplicateById(set.activeId) },
    { id: 'text.close', title: t('te.cmd.close'), run: () => closeById(set.activeId) },
    { id: 'text.nextDoc', title: t('te.cmd.nextDoc'), run: () => cycleDoc(1) },
    { id: 'text.prevDoc', title: t('te.cmd.prevDoc'), run: () => cycleDoc(-1) },
    ...TEXT_TOOLS.map((id): Command => ({
      id: `text.tool.${id}`,
      title: t('te.cmd.tool', { tool: t(toolKey(id)) }),
      run: () => editing.runTool(id),
    })),
  ]

  const api: TextPane = {
    element,
    commands,
    activeId: () => set.activeId,
    docCount: () => set.docs.length,
    takeDoc,
    adopt,
    focus(): void {
      if (view === 'table') csv.element.focus()
      else input.focus({ preventScroll: true })
    },
    open(file: OpenedFile): void {
      if (file.sample) {
        // The same sample opened again (and untouched): just bring its tab forward.
        const existing = set.docs.find((d) => ephemeral.has(d.id) && !d.handle && !isDocDirty(d) && d.name === file.name)
        if (existing) {
          switchTo(existing.id)
          return
        }
      }
      const doc = docFrom(file)
      if (file.sample) ephemeral.add(doc.id)
      openDoc(doc)
    },
    snapshot() {
      const current = activeDoc(set)
      return { name: current.name, text: withEol(input.value, eol), handle: current.handle }
    },
    markSaved(savedName: string, savedHandle: FileHandleLike | null): void {
      const id = set.activeId
      const text = withEol(input.value, eol)
      set = markDocSaved(updateText(set, id, text), id, savedName, savedHandle, text)
      ephemeral.delete(id)
      renderDocTabs()
      notify()
    },
    isDirty: () => set.docs.some(isDocDirty),
  }

  /** Keys in the hint follow the platform (⌥ / ⌘ on a Mac) and any rebinding. */
  function renderHint(): void {
    hint.textContent = t('te.hint', { alt: ALT_LABEL, replace: keyHint('text.replace') })
  }

  loadActive()
  withShortcuts(renderDocTabs)
  withShortcuts(renderHint)
  return api
}
