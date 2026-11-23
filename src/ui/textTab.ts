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
import type { FileHandleLike, FileKind, OpenedFile } from '../lib/fileAccess'
import { extensionOf } from '../lib/fileKind'
import { offsetToPos } from '../lib/findReplace'
import { localized, t, type MessageKey } from '../lib/i18n'
import { readStored, writeStored } from '../lib/safeStorage'
import { shortcutLabel } from '../lib/shortcuts'
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
import { iconButton, setIconButton } from './icons'
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

export function createTextTab(starter?: Starter): TabController {
  const listeners: Array<() => void> = []
  const notify = (): void => listeners.forEach((listener) => listener())

  let name = DEFAULT_NAME
  let handle: FileHandleLike | null = null
  let eol: Eol = '\n'
  let savedText = ''
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
    getFileName: () => name,
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

  const element = el('section', { class: 'pane te-pane' }, bar, findBar.element, editor, csv.element, status)

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

  function load(file: { readonly name: string; readonly text: string; readonly handle: FileHandleLike | null }): void {
    name = file.name
    handle = file.handle
    eol = detectEol(file.text)
    block = null
    hit = null
    input.value = normalizeEol(file.text)
    input.setSelectionRange(0, 0)
    input.scrollTop = 0
    input.scrollLeft = 0
    savedText = withEol(input.value, eol)
    csv.reset()
    // CSV / TSV open as a table; everything else as text.
    const table = TABLE_EXTENSIONS.includes(extensionOf(name))
    if (table !== (view === 'table')) setView(table ? 'table' : 'text')
    afterChange()
  }

  input.wrap = wrap ? 'soft' : 'off'
  editor.classList.toggle('te-wrap', wrap)
  if (starter) load({ name: starter.fileName, text: starter.text, handle: null })

  localized(() => {
    input.setAttribute('aria-label', t('te.aria'))
    input.placeholder = t('te.placeholder')
    hint.textContent = t('te.hint')
    renderTableBtn()
    renderWrapBtn()
    renderTools()
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
    { id: 'text.new', title: t('te.cmd.new'), run: () => load({ name: DEFAULT_NAME, text: '', handle: null }) },
    ...TEXT_TOOLS.map((id): Command => ({
      id: `text.tool.${id}`,
      title: t('te.cmd.tool', { tool: t(toolKey(id)) }),
      run: () => runTool(id),
    })),
  ]

  return {
    id: 'text',
    get label() {
      return t('tab.text')
    },
    kind: KIND,
    element,
    commands,
    open(file: OpenedFile): void {
      load(file)
    },
    snapshot: () => ({ name, text: withEol(input.value, eol), handle }),
    markSaved(savedName: string, savedHandle: FileHandleLike | null): void {
      name = savedName
      handle = savedHandle
      savedText = withEol(input.value, eol)
      notify()
    },
    isDirty: () => withEol(input.value, eol) !== savedText,
    onChange(listener: () => void): void {
      listeners.push(listener)
    },
  }
}
