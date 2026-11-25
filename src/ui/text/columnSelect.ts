// Column (block) selection: Alt+drag and Alt+Shift+arrows, with typing, deleting and clipboard.
// Also owns the Tab key, which acts on the block when there is one.
import {
  blockHeight,
  blockText,
  bounds,
  deleteAtCaret,
  pasteRows,
  replaceBlock,
  type Block,
  type BlockEdit,
} from '../../lib/columnSelection'
import { t } from '../../lib/i18n'
import { countLines } from '../../lib/textTools'
import { toast } from '../toast'
import { TAB_SIZE, type EditorSurface } from './overlay'

export interface ColumnHost {
  readonly surface: EditorSurface
  isWrap(): boolean
  /** Column selection needs wrapping off. */
  unwrap(): void
  replace(start: number, end: number, text: string): void
  /** True while one of our own edits is going through the browser. */
  isApplying(): boolean
  clearHit(): void
  /** Tab / Shift+Tab without a column selection. */
  indent(outdent: boolean): void
  /** Redraw the overlay and status line after the selection changed. */
  changed(): void
}

export interface ColumnSelection {
  get(): Block | null
  /** Select a block and put the caret at its head. */
  set(block: Block): void
  /** Leave column mode and redraw. */
  clear(): void
  /** Forget the block without redrawing: the caller redraws anyway. */
  drop(): void
  apply(edit: BlockEdit): void
  /** The selected rows, or null when there is no block. */
  selectedText(): string | null
}

const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
}

const NAVIGATION_KEYS: readonly string[] = ['Home', 'End', 'PageUp', 'PageDown', 'Enter']

export function createColumnSelection(host: ColumnHost): ColumnSelection {
  const { surface } = host
  const { input } = surface
  let block: Block | null = null

  function clear(): void {
    if (!block) return
    block = null
    host.changed()
  }

  function set(next: Block): void {
    block = next
    host.clearHit()
    const caret = surface.offsetOf(next.headLine, next.headCol)
    input.setSelectionRange(caret, caret)
    host.changed()
  }

  function apply(edit: BlockEdit): void {
    host.replace(edit.from, edit.to, edit.insert)
    set(edit.block)
  }

  const selectedText = (): string | null => (block ? blockText(input.value, block, TAB_SIZE) : null)

  /** Replace what the block covers, in every row. */
  const replaceSelected = (current: Block, insert: string | readonly string[]): void =>
    apply(replaceBlock(input.value, current, insert, TAB_SIZE))

  function startDrag(ev: MouseEvent): void {
    host.clearHit()
    if (!ev.altKey || ev.button !== 0) {
      block = null
      host.changed()
      return
    }
    ev.preventDefault()
    if (host.isWrap()) {
      host.unwrap()
      toast(t('te.wrapOffForBlock'))
    }
    input.focus({ preventScroll: true })
    const start = surface.pointToCell(ev)
    set({ anchorLine: start.line, anchorCol: start.col, headLine: start.line, headCol: start.col })
    const move = (mv: MouseEvent): void => {
      if (!block) return
      const head = surface.pointToCell(mv)
      if (head.line !== block.headLine || head.col !== block.headCol) {
        set({ ...block, headLine: head.line, headCol: head.col })
      }
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  function extendByArrow([lineStep, colStep]: readonly [number, number]): void {
    if (host.isWrap()) host.unwrap()
    const caret = surface.cellOf(input.selectionEnd)
    const from = block ?? { anchorLine: caret.line, anchorCol: caret.col, headLine: caret.line, headCol: caret.col }
    const maxLine = countLines(input.value) - 1
    set({
      ...from,
      headLine: Math.max(0, Math.min(maxLine, from.headLine + lineStep)),
      headCol: Math.max(0, from.headCol + colStep),
    })
  }

  function onKeyDown(ev: KeyboardEvent): void {
    const arrow = ARROWS[ev.key]
    if (arrow && ev.altKey && ev.shiftKey && !ev.ctrlKey && !ev.metaKey) {
      ev.preventDefault()
      extendByArrow(arrow)
      return
    }
    if (ev.key === 'Tab' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      ev.preventDefault()
      if (block) replaceSelected(block, '\t')
      else host.indent(ev.shiftKey)
      return
    }
    if (!block) return
    if (ev.key === 'Escape') {
      ev.preventDefault()
      ev.stopPropagation()
      clear()
      return
    }
    const navigation = arrow !== undefined || NAVIGATION_KEYS.includes(ev.key)
    const selectAll = (ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'a'
    if (navigation || selectAll) clear()
  }

  function onBeforeInput(ev: InputEvent): void {
    if (host.isApplying() || !block) return
    const b = bounds(block)
    switch (ev.inputType) {
      case 'insertText':
      case 'insertReplacementText':
        ev.preventDefault()
        replaceSelected(block, ev.data ?? '')
        return
      case 'deleteContentBackward':
      case 'deleteContentForward': {
        ev.preventDefault()
        const forward = ev.inputType === 'deleteContentForward'
        if (b.left === b.right) apply(deleteAtCaret(input.value, block, forward, TAB_SIZE))
        else replaceSelected(block, '')
        return
      }
      case 'insertFromPaste':
      case 'deleteByCut':
        // Handled by the paste / cut listeners below.
        return
      default:
        // Line breaks, undo/redo, IME composition…: leave column mode and let the browser act.
        clear()
    }
  }

  input.addEventListener('mousedown', startDrag)
  input.addEventListener('keydown', onKeyDown)
  input.addEventListener('beforeinput', onBeforeInput)
  input.addEventListener('copy', (ev) => {
    if (!block || !ev.clipboardData) return
    ev.preventDefault()
    ev.clipboardData.setData('text/plain', blockText(input.value, block, TAB_SIZE))
  })
  input.addEventListener('cut', (ev) => {
    if (!block || !ev.clipboardData) return
    ev.preventDefault()
    ev.clipboardData.setData('text/plain', blockText(input.value, block, TAB_SIZE))
    replaceSelected(block, '')
  })
  input.addEventListener('paste', (ev) => {
    if (!block || !ev.clipboardData) return
    ev.preventDefault()
    replaceSelected(block, pasteRows(ev.clipboardData.getData('text/plain'), blockHeight(input.value, block)))
  })

  return {
    get: () => block,
    set,
    clear,
    drop(): void {
      block = null
    },
    apply,
    selectedText,
  }
}
