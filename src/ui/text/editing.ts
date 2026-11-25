// Edits made by the app itself: undoable replacements, indent, line duplication, text tools.
import { blockText, bounds, replaceBlock, type Block } from '../../lib/columnSelection'
import { t, type MessageKey } from '../../lib/i18n'
import { applyTextTool, countLines, lineStartOffset, type TextToolId } from '../../lib/textTools'
import { el } from '../dom'
import { toast } from '../toast'
import type { ColumnSelection } from './columnSelect'
import { TAB_SIZE, type EditorSurface } from './overlay'

export interface EditingHost {
  readonly surface: EditorSurface
  column(): ColumnSelection
  /** The text was replaced by `replaceRange`. */
  replaced(): void
  /** Bring the document, overlay and status line up to date. */
  afterChange(): void
  refreshStatus(): void
}

export interface Editing {
  /** True while an edit is going through execCommand, so beforeinput / input let it pass. */
  isApplying(): boolean
  replaceRange(start: number, end: number, text: string): void
  runTool(id: TextToolId): void
  indent(outdent: boolean): void
  duplicateLines(): void
  goToLine(): void
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

export const toolKey = (id: TextToolId): MessageKey => `te.tool.${id}` as MessageKey

/** Fill the text-tools dropdown in the current language. */
export function renderToolOptions(select: HTMLSelectElement): void {
  const placeholder = el('option', { value: '' }, t('te.tools'))
  const groups = TOOL_GROUPS.map(([label, ids]) => {
    const group = el('optgroup', { label: t(label) })
    for (const id of ids) group.append(el('option', { value: id }, t(toolKey(id))))
    return group
  })
  select.replaceChildren(placeholder, ...groups)
  select.title = t('te.toolsTip')
  select.setAttribute('aria-label', t('te.toolsTip'))
  select.value = ''
}

export function createEditing(host: EditingHost): Editing {
  const { surface } = host
  const { input } = surface
  let applying = false

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
    host.replaced()
  }

  /** Case changes on a column selection: transform each row and keep the selection. */
  function runOnBlockRows(id: TextToolId, kept: Block): void {
    const text = input.value
    const rows = blockText(text, kept, TAB_SIZE).split('\n').map((row) => applyTextTool(id, row, TAB_SIZE))
    host.column().apply(replaceBlock(text, kept, rows, TAB_SIZE))
    host.column().set(kept)
  }

  /** The range a tool works on: the selection or covered lines, else the whole text. */
  function toolRange(id: TextToolId): { start: number; end: number } {
    const text = input.value
    const block = host.column().get()
    let start = input.selectionStart
    let end = input.selectionEnd
    if (block) {
      // Line tools on a column selection: the lines it covers.
      const b = bounds(block)
      start = lineStartOffset(text, b.top + 1)
      end = lineStartOffset(text, b.bottom + 1) + 1
      host.column().clear()
    }
    if (start === end) return { start: 0, end: text.length }
    if (!LINE_TOOLS.has(id)) return { start, end }
    // Line tools take whole lines: widen the selection to line boundaries.
    start = text.lastIndexOf('\n', start - 1) + 1
    if (end > start && text[end - 1] === '\n') end--
    const nl = text.indexOf('\n', end)
    return { start, end: nl === -1 ? text.length : nl }
  }

  function runTool(id: TextToolId): void {
    const text = input.value
    const block = host.column().get()
    if (block && !LINE_TOOLS.has(id)) {
      runOnBlockRows(id, block)
      return
    }
    const { start, end } = toolRange(id)
    const before = text.slice(start, end)
    const after = applyTextTool(id, before, TAB_SIZE)
    if (after === before) {
      toast(t('te.noChange'))
      return
    }
    replaceRange(start, end, after)
    input.setSelectionRange(start, start + after.length)
    host.refreshStatus()
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
    const answer = window.prompt(t('te.gotoPrompt', { n: count }), String(surface.cellOf(input.selectionEnd).line + 1))
    if (answer === null) return
    const line = Number.parseInt(answer, 10)
    if (!Number.isFinite(line)) return
    const offset = lineStartOffset(input.value, Math.max(1, Math.min(count, line)))
    host.column().drop()
    input.focus()
    input.setSelectionRange(offset, offset)
    surface.scrollToOffset(offset)
    host.afterChange()
  }

  return { isApplying: () => applying, replaceRange, runTool, indent, duplicateLines, goToLine }
}
