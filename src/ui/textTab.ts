import type { Command } from '../lib/commands'
import {
  blockHeight,
  blockText,
  bounds,
  deleteAtCaret,
  indexToVisual,
  pasteRows,
  replaceBlock,
  visualToIndex,
  type Block,
  type BlockEdit,
} from '../lib/columnSelection'
import { TABLE_EXTENSIONS } from '../lib/csv'
import {
  activeDoc,
  addDoc,
  closeDoc,
  copyName,
  createDocSet,
  insertDocAfter,
  isDocDirty,
  markDocSaved,
  replaceDoc,
  setActive,
  updateText,
  type Doc,
  type DocSet,
} from '../lib/docSet'
import type { DocSnapshot, FileHandleLike, FileKind, OpenedFile } from '../lib/fileAccess'
import { extensionOf } from '../lib/fileKind'
import { offsetToPos } from '../lib/findReplace'
import { localized, t, type MessageKey } from '../lib/i18n'
import { readStored, writeStored } from '../lib/safeStorage'
import { shortcutLabel, withShortcuts } from '../lib/shortcuts'
import type { Starter } from '../lib/samples'
import {
  applyTextTool,
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
} from '../lib/textTools'
import { createCsvView } from './csvTable'
import { el } from './dom'
import { createFindBar } from './findBar'
import { icon, iconButton, setIconButton } from './icons'
import { showMenu, type MenuItem } from './menu'
import { scrollOffsetIntoView } from './textareaScroll'
import { toast } from './toast'
import type { TabController } from './types'

const TAB_SIZE = 4
const DEFAULT_NAME = 'untitled.txt'
const WRAP_KEY = 'qareadar:text-wrap'

const KIND: FileKind = {
  description: 'Text',
  mime: 'text/plain',
  extensions: [
    'txt', 'log', 'csv', 'tsv', 'ini', 'cfg', 'conf', 'env', 'properties', 'toml',
    'yaml', 'yml', 'xml', 'sql', 'sh', 'bat', 'ps1',
  ],
}

/** Tools that work on whole lines; the rest (case changes) work on the exact selection. */
const LINE_TOOLS: ReadonlySet<TextToolId> = new Set<TextToolId>([
  'sortAsc', 'sortDesc', 'sortNatural', 'reverse', 'unique', 'uniqueAdjacent', 'removeEmpty',
  'removeBlank', 'trimTrailing', 'trimLeading', 'trimBoth', 'joinLines', 'tabsToSpaces', 'spacesToTabs',
])

const TOOL_GROUPS: ReadonlyArray<readonly [MessageKey, readonly TextToolId[]]> = [
  ['te.group.lines', ['unique', 'uniqueAdjacent', 'removeEmpty', 'removeBlank', 'joinLines']],
  ['te.group.sort', ['sortAsc', 'sortDesc', 'sortNatural', 'reverse']],
  ['te.group.blank', ['trimTrailing', 'trimLeading', 'trimBoth', 'tabsToSpaces', 'spacesToTabs']],
  ['te.group.case', ['upper', 'lower', 'title', 'invertCase']],
]

const toolKey = (id: TextToolId): MessageKey => `te.tool.${id}` as MessageKey

interface Metrics {
  readonly char: number
  readonly line: number
  readonly padL: number
  readonly padT: number
}

/** Per-document editor state kept while another document tab is shown. */
interface DocView {
  readonly eol: Eol
  readonly view: 'text' | 'table'
  readonly selStart: number
  readonly selEnd: number
  readonly scrollTop: number
  readonly scrollLeft: number
}

/** "Label (shortcut)" for a tooltip, or just the label when the command has no shortcut. */
function withKey(label: string, id: string): string {
  const key = shortcutLabel(id)
  return key ? `${label} (${key})` : label
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

/** At most this many editor splits side by side. */
const MAX_SPLITS = 3

/** A document moving between splits, with everything needed to show it the same way. */
interface DocEntry {
  readonly doc: Doc
  readonly view: DocView | undefined
  readonly ephemeral: boolean
}

/** What a split asks of the Text tab that holds it. */
interface PaneHost {
  focus(pane: TextPane): void
  /** True when the split may disappear (it is not the last one). */
  canRemove(pane: TextPane): boolean
  remove(pane: TextPane): void
  /** Extra items for a document tab's context menu (split / move). */
  splitItems(pane: TextPane, docId: string): MenuItem[]
  changed(): void
}

/** One editor split: its own document tabs, editor, find bar and status line. */
interface TextPane {
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

function createTextPane(host: PaneHost): TextPane {
  const notify = (): void => host.changed()

  /** Docs not worth keeping a tab for while clean (blank new doc, untouched sample). */
  const ephemeral = new Set<string>()
  const views = new Map<string, DocView>()
  const blank = makeDoc(DEFAULT_NAME, '', null)
  ephemeral.add(blank.id)
  let set: DocSet = createDocSet(blank)
  let eol: Eol = '\n'
  let wrap = readStored(WRAP_KEY) === 'on'
  let block: Block | null = null
  /** Current find hit, drawn on the overlay so it stays visible while the find box has focus. */
  let hit: { start: number; end: number } | null = null
  /** Set while we feed our own edit through execCommand, so beforeinput lets it pass. */
  let applying = false
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

  const input = el('textarea', { class: 'te-input', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off' })
  const gutterInner = el('div', { class: 'te-gutter-inner' })
  const gutter = el('div', { class: 'te-gutter', 'aria-hidden': 'true' }, gutterInner)
  const overlay = el('div', { class: 'te-overlay', 'aria-hidden': 'true' })
  const surface = el('div', { class: 'te-surface' }, input, overlay)
  const editor = el('div', { class: 'te-editor' }, gutter, surface)

  const posEl = el('span', {})
  const blockEl = el('span', { class: 'te-block-info' })
  const sizeEl = el('span', {})
  const eolBtn = el('button', { class: 'btn small ghost te-eol', type: 'button' })
  const status = el('div', { class: 'md-status te-status' }, posEl, blockEl, sizeEl, eolBtn)

  const findBar = createFindBar({
    getText: () => input.value,
    setText(text) {
      clearBlock()
      replaceRange(0, input.value.length, text)
    },
    canSelect: () => true,
    select(start, end) {
      clearBlock()
      input.setSelectionRange(start, end)
      hit = { start, end }
      scrollToOffset(start)
      renderOverlay()
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
      scrollToOffset(start)
      refreshStatus()
    },
  })
  csv.element.hidden = true
  csv.controls.hidden = true
  bar.insertBefore(csv.controls, spacer)

  const docStrip = el('div', { class: 'doc-tabs', role: 'tablist' })
  const element = el('section', { class: 'pane te-pane' }, bar, docStrip, findBar.element, editor, csv.element, status)

  // ── geometry (monospace font, wrap off) ──
  let charWidth = 0
  function metrics(): Metrics {
    const style = getComputedStyle(input)
    if (charWidth === 0) {
      const probe = el('span', { class: 'te-probe' }, 'M'.repeat(200))
      surface.append(probe)
      charWidth = probe.getBoundingClientRect().width / 200
      probe.remove()
    }
    return {
      char: charWidth || 7.5,
      line: Number.parseFloat(style.lineHeight) || 19,
      padL: Number.parseFloat(style.paddingLeft) || 0,
      padT: Number.parseFloat(style.paddingTop) || 0,
    }
  }

  const lines = (): string[] => input.value.split('\n')

  function pointToCell(ev: MouseEvent): { line: number; col: number } {
    const m = metrics()
    const box = input.getBoundingClientRect()
    const x = ev.clientX - box.left - m.padL + input.scrollLeft
    const y = ev.clientY - box.top - m.padT + input.scrollTop
    const count = countLines(input.value)
    return {
      line: Math.max(0, Math.min(count - 1, Math.floor(y / m.line))),
      col: Math.max(0, Math.round(x / m.char)),
    }
  }

  function offsetOf(line: number, col: number): number {
    const text = input.value
    const lineText = text.split('\n')[line] ?? ''
    return lineStartOffset(text, line + 1) + visualToIndex(lineText, col, TAB_SIZE).index
  }

  function cellOf(offset: number): { line: number; col: number } {
    const [line, column] = offsetToPos(input.value, offset)
    const lineText = lines()[line - 1] ?? ''
    return { line: line - 1, col: indexToVisual(lineText, column - 1, TAB_SIZE) }
  }

  function scrollToOffset(offset: number): void {
    if (wrap) {
      scrollOffsetIntoView(input, offset)
      return
    }
    const m = metrics()
    const { line, col } = cellOf(offset)
    const top = line * m.line
    if (top < input.scrollTop || top > input.scrollTop + input.clientHeight - m.line * 2) {
      input.scrollTop = Math.max(0, top - input.clientHeight / 3)
    }
    const left = col * m.char
    if (left < input.scrollLeft || left > input.scrollLeft + input.clientWidth - m.char * 4) {
      input.scrollLeft = Math.max(0, left - input.clientWidth / 2)
    }
  }

  // ── rendering ──
  let gutterCount = 0
  function renderGutter(): void {
    gutter.hidden = wrap
    if (wrap) return
    const count = countLines(input.value)
    if (count !== gutterCount) {
      gutterCount = count
      const numbers: string[] = []
      for (let n = 1; n <= count; n++) numbers.push(String(n))
      gutterInner.textContent = numbers.join('\n')
      gutter.style.setProperty('--digits', String(Math.max(2, String(count).length)))
    }
    gutterInner.style.transform = `translateY(${-input.scrollTop}px)`
  }

  function cellRect(cls: string, line: number, fromCol: number, toCol: number, m: Metrics): HTMLElement {
    const node = el('div', { class: cls })
    node.style.top = `${m.padT + line * m.line - input.scrollTop}px`
    node.style.left = `${m.padL + fromCol * m.char - input.scrollLeft}px`
    node.style.height = `${m.line}px`
    if (toCol > fromCol) node.style.width = `${(toCol - fromCol) * m.char}px`
    return node
  }

  function renderOverlay(): void {
    const nodes: HTMLElement[] = []
    if (!wrap && (block || hit)) {
      const m = metrics()
      const all = lines()
      const firstVisible = Math.floor(input.scrollTop / m.line) - 1
      const lastVisible = firstVisible + Math.ceil(input.clientHeight / m.line) + 2
      if (block) {
        const b = bounds(block)
        const cls = b.left === b.right ? 'te-caret' : 'te-block'
        for (let n = Math.max(b.top, firstVisible); n <= Math.min(b.bottom, all.length - 1, lastVisible); n++) {
          nodes.push(cellRect(cls, n, b.left, b.right, m))
        }
      }
      if (hit) {
        const from = cellOf(hit.start)
        const to = cellOf(hit.end)
        for (let n = Math.max(from.line, firstVisible); n <= Math.min(to.line, lastVisible); n++) {
          const lineText = all[n] ?? ''
          const start = n === from.line ? from.col : 0
          const end = n === to.line ? to.col : indexToVisual(lineText, lineText.length, TAB_SIZE) + 1
          nodes.push(cellRect('te-hit', n, start, Math.max(end, start + 1), m))
        }
      }
    }
    overlay.replaceChildren(...nodes)
    editor.classList.toggle('te-has-block', block !== null)
  }

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
    const { line, col } = cellOf(input.selectionEnd)
    const selected = Math.abs(input.selectionEnd - input.selectionStart)
    posEl.textContent =
      t('te.pos', { line: line + 1, col: col + 1 }) + (selected > 0 ? ` · ${t('te.sel', { n: selected })}` : '')
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
    input.wrap = on ? 'soft' : 'off'
    editor.classList.toggle('te-wrap', on)
    if (on) block = null
    renderWrapBtn()
    renderGutter()
    renderOverlay()
    refreshStatus()
  }

  function renderTools(): void {
    const placeholder = el('option', { value: '' }, t('te.tools'))
    const groups = TOOL_GROUPS.map(([label, ids]) => {
      const group = el('optgroup', { label: t(label) })
      for (const id of ids) group.append(el('option', { value: id }, t(toolKey(id))))
      return group
    })
    toolsSelect.replaceChildren(placeholder, ...groups)
    toolsSelect.title = t('te.toolsTip')
    toolsSelect.setAttribute('aria-label', t('te.toolsTip'))
    toolsSelect.value = ''
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
      block = null
      hit = null
      findBar.close()
      csv.render()
    }
    editor.hidden = table
    textControls.hidden = table
    hint.hidden = table
    csv.element.hidden = !table
    csv.controls.hidden = !table
    renderTableBtn()
    if (!table) {
      renderGutter()
      renderOverlay()
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
    renderGutter()
    renderOverlay()
    refreshStatus()
    notify()
  }

  // ── editing ──
  /** Replace a range so the browser's undo (Ctrl+Z) still works; falls back to setRangeText. */
  function replaceRange(start: number, end: number, text: string): void {
    if (start === end && text === '') return
    applying = true
    try {
      input.focus({ preventScroll: true })
      input.setSelectionRange(start, end)
      const expected = input.value.slice(0, start) + text + input.value.slice(end)
      const ok = text === '' ? document.execCommand('delete') : document.execCommand('insertText', false, text)
      if (!ok || input.value !== expected) {
        input.value = expected
        input.setSelectionRange(start + text.length, start + text.length)
      }
    } finally {
      applying = false
    }
    hit = null
    afterChange()
  }

  function clearBlock(): void {
    if (!block) return
    block = null
    renderOverlay()
    refreshStatus()
  }

  function setBlock(next: Block): void {
    block = next
    hit = null
    const caret = offsetOf(next.headLine, next.headCol)
    input.setSelectionRange(caret, caret)
    renderOverlay()
    refreshStatus()
  }

  function applyBlockEdit(edit: BlockEdit): void {
    replaceRange(edit.from, edit.to, edit.insert)
    setBlock(edit.block)
  }

  function runTool(id: TextToolId): void {
    const text = input.value
    if (block && !LINE_TOOLS.has(id)) {
      // Case changes on a column selection: transform each row and keep the selection.
      const kept = block
      const rows = blockText(text, kept, TAB_SIZE).split('\n').map((row) => applyTextTool(id, row, TAB_SIZE))
      applyBlockEdit(replaceBlock(text, kept, rows, TAB_SIZE))
      setBlock(kept)
      return
    }
    let start = input.selectionStart
    let end = input.selectionEnd
    if (block) {
      // Line tools on a column selection: the lines it covers.
      const b = bounds(block)
      start = lineStartOffset(text, b.top + 1)
      end = lineStartOffset(text, b.bottom + 1) + 1
      clearBlock()
    }
    if (start === end) {
      start = 0
      end = text.length
    } else if (LINE_TOOLS.has(id)) {
      // Line tools take whole lines: widen the selection to line boundaries.
      start = text.lastIndexOf('\n', start - 1) + 1
      if (end > start && text[end - 1] === '\n') end--
      const nl = text.indexOf('\n', end)
      end = nl === -1 ? text.length : nl
    }
    const before = text.slice(start, end)
    const after = applyTextTool(id, before, TAB_SIZE)
    if (after === before) {
      toast(t('te.noChange'))
      return
    }
    replaceRange(start, end, after)
    input.setSelectionRange(start, start + after.length)
    refreshStatus()
    const removed = countLines(before) - countLines(after)
    toast(removed > 0 ? t('te.removedLines', { n: removed, tool: t(toolKey(id)) }) : t('te.applied', { tool: t(toolKey(id)) }))
  }

  /** Range of the whole lines touched by the selection (end excludes the last line break). */
  function selectedLineRange(): { from: number; to: number } {
    const text = input.value
    const start = input.selectionStart
    let end = input.selectionEnd
    const from = text.lastIndexOf('\n', start - 1) + 1
    if (end > from && text[end - 1] === '\n') end--
    const nl = text.indexOf('\n', end)
    return { from, to: nl === -1 ? text.length : nl }
  }

  /** Tab / Shift+Tab: indent or outdent every selected line when the selection spans lines. */
  function indent(outdent: boolean): void {
    const start = input.selectionStart
    const end = input.selectionEnd
    if (!outdent && !input.value.slice(start, end).includes('\n')) {
      replaceRange(start, end, '\t')
      return
    }
    const { from, to } = selectedLineRange()
    const changed = input.value
      .slice(from, to)
      .split('\n')
      .map((line) => (outdent ? line.replace(/^(\t| {1,4})/, '') : `\t${line}`))
      .join('\n')
    replaceRange(from, to, changed)
    input.setSelectionRange(from, from + changed.length)
  }

  function duplicateLines(): void {
    const { from, to } = selectedLineRange()
    const chunk = input.value.slice(from, to)
    replaceRange(to, to, `\n${chunk}`)
    input.setSelectionRange(to + 1, to + 1 + chunk.length)
  }

  function goToLine(): void {
    const count = countLines(input.value)
    const answer = window.prompt(t('te.gotoPrompt', { n: count }), String(cellOf(input.selectionEnd).line + 1))
    if (answer === null) return
    const line = Number.parseInt(answer, 10)
    if (!Number.isFinite(line)) return
    const offset = lineStartOffset(input.value, Math.max(1, Math.min(count, line)))
    block = null
    input.focus()
    input.setSelectionRange(offset, offset)
    scrollToOffset(offset)
    afterChange()
  }

  // ── column selection: Alt+drag, Alt+Shift+arrows ──
  input.addEventListener('mousedown', (ev) => {
    hit = null
    if (!ev.altKey || ev.button !== 0) {
      block = null
      renderOverlay()
      refreshStatus()
      return
    }
    ev.preventDefault()
    if (wrap) {
      setWrap(false)
      toast(t('te.wrapOffForBlock'))
    }
    input.focus({ preventScroll: true })
    const start = pointToCell(ev)
    setBlock({ anchorLine: start.line, anchorCol: start.col, headLine: start.line, headCol: start.col })
    const move = (mv: MouseEvent): void => {
      if (!block) return
      const head = pointToCell(mv)
      if (head.line !== block.headLine || head.col !== block.headCol) {
        setBlock({ ...block, headLine: head.line, headCol: head.col })
      }
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  })

  const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
  }

  input.addEventListener('keydown', (ev) => {
    const arrow = ARROWS[ev.key]
    if (arrow && ev.altKey && ev.shiftKey && !ev.ctrlKey && !ev.metaKey) {
      ev.preventDefault()
      if (wrap) setWrap(false)
      const caret = cellOf(input.selectionEnd)
      const from = block ?? { anchorLine: caret.line, anchorCol: caret.col, headLine: caret.line, headCol: caret.col }
      const maxLine = countLines(input.value) - 1
      setBlock({
        ...from,
        headLine: Math.max(0, Math.min(maxLine, from.headLine + arrow[0])),
        headCol: Math.max(0, from.headCol + arrow[1]),
      })
      return
    }
    if (ev.key === 'Tab' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      ev.preventDefault()
      if (block) applyBlockEdit(replaceBlock(input.value, block, '\t', TAB_SIZE))
      else indent(ev.shiftKey)
      return
    }
    if (!block) return
    if (ev.key === 'Escape') {
      ev.preventDefault()
      ev.stopPropagation()
      clearBlock()
      return
    }
    const navigation = arrow !== undefined || ['Home', 'End', 'PageUp', 'PageDown', 'Enter'].includes(ev.key)
    const selectAll = (ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'a'
    if (navigation || selectAll) clearBlock()
  })

  input.addEventListener('beforeinput', (ev) => {
    if (applying || !block) return
    const b = bounds(block)
    switch (ev.inputType) {
      case 'insertText':
      case 'insertReplacementText':
        ev.preventDefault()
        applyBlockEdit(replaceBlock(input.value, block, ev.data ?? '', TAB_SIZE))
        return
      case 'deleteContentBackward':
      case 'deleteContentForward': {
        ev.preventDefault()
        const forward = ev.inputType === 'deleteContentForward'
        applyBlockEdit(
          b.left === b.right
            ? deleteAtCaret(input.value, block, forward, TAB_SIZE)
            : replaceBlock(input.value, block, '', TAB_SIZE),
        )
        return
      }
      case 'insertFromPaste':
      case 'deleteByCut':
        // Handled by the paste / cut listeners below.
        return
      default:
        // Line breaks, undo/redo, IME composition…: leave column mode and let the browser act.
        clearBlock()
    }
  })

  input.addEventListener('copy', (ev) => {
    if (!block || !ev.clipboardData) return
    ev.preventDefault()
    ev.clipboardData.setData('text/plain', blockText(input.value, block, TAB_SIZE))
  })
  input.addEventListener('cut', (ev) => {
    if (!block || !ev.clipboardData) return
    ev.preventDefault()
    ev.clipboardData.setData('text/plain', blockText(input.value, block, TAB_SIZE))
    applyBlockEdit(replaceBlock(input.value, block, '', TAB_SIZE))
  })
  input.addEventListener('paste', (ev) => {
    if (!block || !ev.clipboardData) return
    ev.preventDefault()
    const rows = pasteRows(ev.clipboardData.getData('text/plain'), blockHeight(input.value, block))
    applyBlockEdit(replaceBlock(input.value, block, rows, TAB_SIZE))
  })

  // ── wiring ──
  input.addEventListener('input', () => {
    if (applying) return
    hit = null
    afterChange()
  })
  input.addEventListener('scroll', () => {
    renderGutter()
    renderOverlay()
  })
  document.addEventListener('selectionchange', () => {
    if (document.activeElement === input) refreshStatus()
  })
  new ResizeObserver(() => renderOverlay()).observe(surface)

  const openFind = (withReplace: boolean): void => {
    const seed = block
      ? blockText(input.value, block, TAB_SIZE)
      : input.value.slice(input.selectionStart, input.selectionEnd)
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
  gotoBtn.addEventListener('click', goToLine)
  wrapBtn.addEventListener('click', () => setWrap(!wrap))
  eolBtn.addEventListener('click', cycleEol)
  toolsSelect.addEventListener('change', () => {
    const id = toolsSelect.value
    toolsSelect.value = ''
    if ((TEXT_TOOLS as readonly string[]).includes(id)) runTool(id as TextToolId)
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
    block = null
    duplicateLines()
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
    block = null
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
    const dirty = set.docs.filter((d) => d.id !== id && isDocDirty(d))
    if (dirty.length > 0 && !window.confirm(t('md.confirmCloseOthers', { n: dirty.length }))) return
    for (const doc of set.docs) if (doc.id !== id) forget(doc.id)
    const wasActive = id === set.activeId
    set = { docs: set.docs.filter((d) => d.id === id), activeId: id }
    if (wasActive) renderDocTabs()
    else loadActive()
    notify()
  }

  /** Move to the next (+1) or previous (-1) document tab, wrapping around. */
  function cycleDoc(step: number): void {
    const index = set.docs.findIndex((d) => d.id === set.activeId)
    const next = set.docs[(index + step + set.docs.length) % set.docs.length]
    if (next) switchTo(next.id)
  }

  function showDocMenu(id: string, at: HTMLElement | { x: number; y: number }): void {
    const others = set.docs.filter((d) => d.id !== id)
    showMenu(
      [
        { label: t('md.newDoc'), icon: 'plus', hint: shortcutLabel('text.new'), run: newDocument },
        { label: t('md.duplicateDoc'), icon: 'duplicate', hint: shortcutLabel('text.duplicateDoc'), run: () => duplicateById(id) },
        { label: t('md.closeTip'), icon: 'close', hint: shortcutLabel('text.close'), run: () => closeById(id) },
        { label: t('md.closeOthers'), disabled: others.length === 0, run: () => closeOthers(id) },
        ...host.splitItems(api, id),
      ],
      at,
      t('md.docMenuAria'),
    )
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
    const addBtn = el('button', { class: 'doc-add', type: 'button', 'aria-label': t('md.newDoc'), title: withKey(t('md.newDoc'), 'text.new') }, icon('plus', 14))
    addBtn.addEventListener('click', newDocument)
    docStrip.replaceChildren(
      ...set.docs.map((doc) => {
        const selected = doc.id === set.activeId
        const tab = el(
          'button',
          { class: 'doc-tab', role: 'tab', type: 'button', 'aria-selected': String(selected), title: doc.name },
          isDocDirty(doc) ? '● ' : '',
          doc.name,
        )
        tab.addEventListener('click', () => switchTo(doc.id))
        const close = el('button', { class: 'doc-close', type: 'button', 'aria-label': t('md.closeDoc', { name: doc.name }), title: withKey(t('md.closeTip'), 'text.close') }, icon('close', 12))
        close.addEventListener('click', () => closeById(doc.id))
        const item = el('span', { class: selected ? 'doc-item active' : 'doc-item' }, tab, close)
        item.addEventListener('contextmenu', (ev) => {
          ev.preventDefault()
          ev.stopPropagation()
          switchTo(doc.id)
          showDocMenu(doc.id, { x: ev.clientX, y: ev.clientY })
        })
        // Shift+F10 / the context-menu key on a focused tab opens the same menu.
        tab.addEventListener('keydown', (ev) => {
          if (ev.key !== 'ContextMenu' && !(ev.shiftKey && ev.key === 'F10')) return
          ev.preventDefault()
          switchTo(doc.id)
          showDocMenu(doc.id, tab)
        })
        // Middle-click closes, as in a browser.
        item.addEventListener('auxclick', (ev) => {
          if (ev.button !== 1) return
          ev.preventDefault()
          closeById(doc.id)
        })
        return item
      }),
      addBtn,
    )
  }

  // Right-click on the empty part of the tab strip: just "New document".
  docStrip.addEventListener('contextmenu', (ev) => {
    ev.preventDefault()
    showMenu([{ label: t('md.newDoc'), icon: 'plus', hint: shortcutLabel('text.new'), run: newDocument }], { x: ev.clientX, y: ev.clientY })
  })
  // Double-click the empty part of the strip: new document.
  docStrip.addEventListener('dblclick', (ev) => {
    if (ev.target === docStrip) newDocument()
  })

  input.wrap = wrap ? 'soft' : 'off'
  editor.classList.toggle('te-wrap', wrap)
  // Whichever split you click or type in becomes the one the toolbar, Save and Open act on.
  element.addEventListener('focusin', () => host.focus(api))
  element.addEventListener('pointerdown', () => host.focus(api))

  localized(() => {
    input.setAttribute('aria-label', t('te.aria'))
    input.placeholder = t('te.placeholder')
    hint.textContent = t('te.hint')
    renderTableBtn()
    renderWrapBtn()
    renderTools()
    docStrip.setAttribute('aria-label', t('md.docsAria'))
    renderDocTabs()
    refreshStatus()
  })

  const commands = (): Command[] => [
    { id: 'text.find', title: t('te.cmd.find'), run: findCommand },
    { id: 'text.replace', title: t('te.cmd.replace'), run: textOnly(() => openFind(true)) },
    { id: 'text.goto', title: t('te.cmd.goto'), run: textOnly(goToLine) },
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
      run: () => runTool(id),
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

  loadActive()
  withShortcuts(renderDocTabs)
  return api
}

/**
 * The Text tab: one to three editor splits side by side, each with its own document tabs.
 * Right-click a document tab to move it to a new split or another split; closing the last
 * tab of a split removes that split.
 */
export function createTextTab(starter?: Starter): TabController {
  const listeners: Array<() => void> = []
  const notify = (): void => listeners.forEach((listener) => listener())
  const panes: TextPane[] = []
  const element = el('section', { class: 'te-splits' })

  const host: PaneHost = {
    focus(pane) {
      if (pane === active) return
      active = pane
      renderSplits()
      notify()
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
      notify()
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
    changed: notify,
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
    notify()
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
  if (starter) active.open({ name: starter.fileName, text: starter.text, handle: null, sample: true })

  const commands = (): Command[] => [
    ...active.commands(),
    { id: 'text.split', title: t('te.cmd.split'), run: () => moveDoc(active, active.activeId(), null) },
    { id: 'text.splitNew', title: t('te.cmd.splitNew'), run: () => newSplit(active) },
    { id: 'text.nextSplit', title: t('te.cmd.nextSplit'), run: () => cycleSplit(1) },
  ]

  return {
    id: 'text',
    get label() {
      return t('tab.text')
    },
    kind: KIND,
    multiDoc: true,
    element,
    commands,
    open: (file) => active.open(file),
    snapshot: () => active.snapshot(),
    markSaved: (name, handle) => active.markSaved(name, handle),
    isDirty: () => panes.some((pane) => pane.isDirty()),
    onChange(listener: () => void): void {
      listeners.push(listener)
    },
  }
}
