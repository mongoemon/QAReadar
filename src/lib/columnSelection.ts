/**
 * Column (block / rectangular) selection, as made with Alt+drag in Notepad++. Pure model: a
 * block is two corners in *visual* columns (tabs expand to tab stops, combining marks take no
 * width), so it stays a rectangle on screen however the lines are indented.
 *
 * A block of zero width is a multi-line caret: typing inserts on every line at once.
 */

export interface Block {
  /** 0-based line where the drag started / ends. */
  readonly anchorLine: number
  readonly anchorCol: number
  readonly headLine: number
  readonly headCol: number
}

export interface BlockBounds {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
}

export const bounds = (b: Block): BlockBounds => ({
  top: Math.min(b.anchorLine, b.headLine),
  bottom: Math.max(b.anchorLine, b.headLine),
  left: Math.min(b.anchorCol, b.headCol),
  right: Math.max(b.anchorCol, b.headCol),
})

const COMBINING = /\p{M}/u

/** Visual width of one character starting at visual column `col`. */
const widthAt = (ch: string, col: number, tabSize: number): number =>
  ch === '\t' ? tabSize - (col % tabSize) : COMBINING.test(ch) ? 0 : 1

/** Visual column where string index `index` of `line` starts. */
export function indexToVisual(line: string, index: number, tabSize: number): number {
  let col = 0
  for (let i = 0; i < Math.min(index, line.length); i++) col += widthAt(line[i], col, tabSize)
  return col
}

/**
 * String index for visual column `col`. A column inside a tab rounds to the nearer edge.
 * Past the end of the line it returns `line.length` and how many columns are left over
 * (so inserting there can pad with spaces, like Notepad++ "virtual space").
 */
export function visualToIndex(line: string, col: number, tabSize: number): { index: number; overflow: number } {
  let visual = 0
  for (let i = 0; i < line.length; i++) {
    const w = widthAt(line[i], visual, tabSize)
    // Zero-width marks stay attached to the character before them.
    if (visual >= col && w > 0) return { index: i, overflow: 0 }
    if (visual + w > col) return { index: col - visual < w / 2 ? i : i + 1, overflow: 0 }
    visual += w
  }
  return { index: line.length, overflow: Math.max(0, col - visual) }
}

/** Width of the line in visual columns. */
export const lineWidth = (line: string, tabSize: number): number => indexToVisual(line, line.length, tabSize)

interface LineSlice {
  readonly line: number
  /** Start / end index within the line. */
  readonly start: number
  readonly end: number
  /** Columns between the line end and the block's left edge (only when the line is too short). */
  readonly pad: number
}

function slices(lines: readonly string[], b: BlockBounds, tabSize: number): LineSlice[] {
  const out: LineSlice[] = []
  for (let n = b.top; n <= Math.min(b.bottom, lines.length - 1); n++) {
    const from = visualToIndex(lines[n], b.left, tabSize)
    const to = visualToIndex(lines[n], b.right, tabSize)
    out.push({ line: n, start: from.index, end: Math.max(from.index, to.index), pad: from.overflow })
  }
  return out
}

/** The selected text: one row per line, joined with `\n` (what Copy puts on the clipboard). */
export function blockText(text: string, block: Block, tabSize: number): string {
  const lines = text.split('\n')
  return slices(lines, bounds(block), tabSize)
    .map((s) => lines[s.line].slice(s.start, s.end))
    .join('\n')
}

/** Number of lines the block covers inside `text`. */
export function blockHeight(text: string, block: Block): number {
  const b = bounds(block)
  return Math.min(b.bottom, text.split('\n').length - 1) - b.top + 1
}

export interface BlockEdit {
  readonly text: string
  /** The block afterwards: a zero-width caret right after what was inserted. */
  readonly block: Block
  /** Changed range of the *old* text and what replaces it (for an undoable minimal edit). */
  readonly from: number
  readonly to: number
  readonly insert: string
}

/**
 * Replace the block on every line with `rows[i]` (a single string goes onto every line).
 * Lines shorter than the block's left edge are padded with spaces when something is inserted.
 */
export function replaceBlock(text: string, block: Block, rows: string | readonly string[], tabSize: number): BlockEdit {
  const lines = text.split('\n')
  const b = bounds(block)
  const rowFor = (i: number): string =>
    typeof rows === 'string' ? rows : rows.length === 0 ? '' : rows[i % rows.length]
  const edited = lines.slice()
  let caretCol = b.left
  slices(lines, b, tabSize).forEach((s, i) => {
    const row = rowFor(i)
    const line = lines[s.line]
    const pad = row === '' ? '' : ' '.repeat(s.pad)
    edited[s.line] = line.slice(0, s.start) + pad + row + line.slice(s.end)
    if (i === 0) caretCol = indexToVisual(edited[s.line], s.start + pad.length + row.length, tabSize)
  })
  return finish(lines, edited, b, caretCol)
}

/** Backspace / Delete on a zero-width block: remove one character before / after the caret on each line. */
export function deleteAtCaret(text: string, block: Block, forward: boolean, tabSize: number): BlockEdit {
  const lines = text.split('\n')
  const b = bounds(block)
  const edited = lines.slice()
  let caretCol = forward ? b.left : Math.max(0, b.left - 1)
  slices(lines, b, tabSize).forEach((s, i) => {
    // Caret in virtual space past the end of this line: nothing to delete here.
    if (s.pad > 0) return
    const line = lines[s.line]
    const from = forward ? s.start : Math.max(0, s.start - 1)
    const to = forward ? Math.min(line.length, s.start + 1) : s.start
    edited[s.line] = line.slice(0, from) + line.slice(to)
    if (i === 0) caretCol = indexToVisual(edited[s.line], from, tabSize)
  })
  return finish(lines, edited, b, caretCol)
}

function finish(lines: readonly string[], edited: readonly string[], b: BlockBounds, caretCol: number): BlockEdit {
  const last = Math.min(b.bottom, lines.length - 1)
  let from = 0
  for (let n = 0; n < b.top; n++) from += lines[n].length + 1
  const oldPart = lines.slice(b.top, last + 1).join('\n')
  return {
    text: edited.join('\n'),
    block: { anchorLine: b.top, anchorCol: caretCol, headLine: last, headCol: caretCol },
    from,
    to: from + oldPart.length,
    insert: edited.slice(b.top, last + 1).join('\n'),
  }
}

/** Rows to paste into a block: one clipboard line per block line when the counts allow it. */
export function pasteRows(clip: string, height: number): string | readonly string[] {
  const rows = clip.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n')
  if (rows.length === 1) return rows[0]
  return rows.length >= height ? rows.slice(0, height) : rows
}
