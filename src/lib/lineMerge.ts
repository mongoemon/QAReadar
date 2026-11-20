/**
 * Line-based diff of two texts (Manual test case = left, Automate test case = right) plus a
 * per-line pick of what goes into the merged output. Pure logic, no DOM.
 *
 * Diff: Myers O(ND) on whole lines, after trimming the common prefix/suffix. Inside a changed
 * block the removed (left-only) and added (right-only) lines are paired by position, so a
 * row can hold one line from each side and the user picks Manual, Automate, both or neither.
 */

/** Which lines of a row go into the output. 'both' = Manual line first, then Automate. */
export type Choice = 'left' | 'right' | 'both' | 'none'

export interface MergeRow {
  /** 'same' = identical on both sides; 'change' = part of a differing block. */
  readonly kind: 'same' | 'change'
  readonly left: string | null
  readonly right: string | null
  /** 1-based line numbers in each source, null when the row has no line on that side. */
  readonly leftNo: number | null
  readonly rightNo: number | null
  /** Index of the change block this row belongs to; -1 for 'same' rows. */
  readonly block: number
}

export interface LineDiff {
  readonly rows: readonly MergeRow[]
  readonly blocks: number
  /** Line ending used for the output (taken from the Manual side first). */
  readonly eol: '\n' | '\r\n'
  /** Whether the output ends with a line ending (taken from the Manual side first). */
  readonly trailingNewline: boolean
}

export interface DiffOptions {
  /** Compare lines ignoring leading/trailing whitespace and runs of spaces. */
  readonly ignoreWhitespace?: boolean
  /**
   * Line ending for the output, when the texts no longer carry it (a <textarea> turns CRLF
   * into LF). Default: whatever the Manual text uses, else the Automate text, else LF.
   */
  readonly eol?: '\n' | '\r\n'
}

/** Above this edit distance the middle is reported as one big change instead (memory bound). */
const MAX_EDIT_DISTANCE = 4000

interface SplitText {
  readonly lines: string[]
  readonly eol: '\n' | '\r\n' | null
  readonly trailingNewline: boolean
}

export function splitLines(text: string): SplitText {
  if (text === '') return { lines: [], eol: null, trailingNewline: false }
  const eol = text.includes('\r\n') ? '\r\n' : text.includes('\n') ? '\n' : null
  const lines = text.split(/\r?\n/)
  const trailingNewline = lines[lines.length - 1] === ''
  if (trailingNewline) lines.pop()
  return { lines, eol, trailingNewline }
}

const normalize = (line: string): string => line.trim().replace(/\s+/g, ' ')

type Op = 'equal' | 'delete' | 'insert'

/** Myers shortest edit script from a to b; null when they are too far apart. */
function myers(a: readonly string[], b: readonly string[]): Op[] | null {
  const n = a.length
  const m = b.length
  const max = n + m
  if (max === 0) return []
  const offset = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  let found = -1
  for (let d = 0; d <= Math.min(max, MAX_EDIT_DISTANCE); d++) {
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) {
        found = d
        break
      }
    }
    // Only k in [-d, d] of this step is read back while backtracking.
    trace.push(v.slice(offset - d, offset + d + 1))
    if (found >= 0) break
  }
  if (found < 0) return null

  const ops: Op[] = []
  let x = n
  let y = m
  for (let d = found; d > 0; d--) {
    const prev = trace[d - 1]
    const at = (k: number): number => prev[k + d - 1]
    const k = x - y
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1
    const prevX = at(prevK)
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      ops.push('equal')
      x--
      y--
    }
    if (x === prevX) {
      ops.push('insert')
      y--
    } else {
      ops.push('delete')
      x--
    }
  }
  while (x > 0 && y > 0) {
    ops.push('equal')
    x--
    y--
  }
  return ops.reverse()
}

function editScript(a: readonly string[], b: readonly string[]): Op[] {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  const middle: Op[] =
    myers(midA, midB) ?? [...midA.map((): Op => 'delete'), ...midB.map((): Op => 'insert')]
  const equal = (count: number): Op[] => Array.from({ length: count }, (): Op => 'equal')
  return [...equal(start), ...middle, ...equal(a.length - endA)]
}

export function diffLines(leftText: string, rightText: string, options: DiffOptions = {}): LineDiff {
  const left = splitLines(leftText)
  const right = splitLines(rightText)
  const key = options.ignoreWhitespace ? normalize : (line: string): string => line
  const ops = editScript(left.lines.map(key), right.lines.map(key))

  const rows: MergeRow[] = []
  let blocks = 0
  let ai = 0
  let bi = 0
  let pendingLeft: number[] = []
  let pendingRight: number[] = []

  const flush = (): void => {
    if (pendingLeft.length === 0 && pendingRight.length === 0) return
    const size = Math.max(pendingLeft.length, pendingRight.length)
    for (let i = 0; i < size; i++) {
      const la = pendingLeft[i]
      const rb = pendingRight[i]
      rows.push({
        kind: 'change',
        left: la === undefined ? null : left.lines[la],
        right: rb === undefined ? null : right.lines[rb],
        leftNo: la === undefined ? null : la + 1,
        rightNo: rb === undefined ? null : rb + 1,
        block: blocks,
      })
    }
    blocks++
    pendingLeft = []
    pendingRight = []
  }

  for (const op of ops) {
    if (op === 'equal') {
      flush()
      rows.push({ kind: 'same', left: left.lines[ai], right: right.lines[bi], leftNo: ai + 1, rightNo: bi + 1, block: -1 })
      ai++
      bi++
    } else if (op === 'delete') {
      pendingLeft.push(ai++)
    } else {
      pendingRight.push(bi++)
    }
  }
  flush()

  const eol = options.eol ?? left.eol ?? right.eol ?? '\n'
  const trailingNewline = left.lines.length > 0 ? left.trailingNewline : right.trailingNewline
  return { rows, blocks, eol, trailingNewline }
}

export const includesLeft = (choice: Choice): boolean => choice === 'left' || choice === 'both'
export const includesRight = (choice: Choice): boolean => choice === 'right' || choice === 'both'

export const composeChoice = (left: boolean, right: boolean): Choice =>
  left && right ? 'both' : left ? 'left' : right ? 'right' : 'none'

/**
 * Fit a wished-for choice to what the row actually has. A 'same' row is either kept ('both')
 * or dropped ('none'); a one-sided row cannot take the side it does not have.
 */
export function fitChoice(row: MergeRow, wish: Choice): Choice {
  if (row.kind === 'same') return wish === 'none' ? 'none' : 'both'
  return composeChoice(includesLeft(wish) && row.left !== null, includesRight(wish) && row.right !== null)
}

/** Default picks: keep everything (nothing is lost until the user decides). */
export const defaultChoices = (rows: readonly MergeRow[]): Choice[] => rows.map((row) => fitChoice(row, 'both'))

/** Apply `wish` to every change row (or only those of `block`); 'same' rows are left alone. */
export function applyToChanges(rows: readonly MergeRow[], choices: readonly Choice[], wish: Choice, block?: number): Choice[] {
  return rows.map((row, i) =>
    row.kind === 'change' && (block === undefined || row.block === block) ? fitChoice(row, wish) : choices[i],
  )
}

const rowKey = (row: MergeRow): string => `${row.kind}\u0000${row.left ?? '\u0001'}\u0000${row.right ?? '\u0001'}`

/**
 * Keep the user's picks across a re-diff (e.g. after editing one side): rows with the same
 * kind and text get the same choice, matched in order of occurrence. New rows get defaults.
 */
export function carryChoices(
  oldRows: readonly MergeRow[],
  oldChoices: readonly Choice[],
  newRows: readonly MergeRow[],
): Choice[] {
  const remembered = new Map<string, Choice[]>()
  oldRows.forEach((row, i) => {
    const key = rowKey(row)
    const list = remembered.get(key)
    if (list) list.push(oldChoices[i])
    else remembered.set(key, [oldChoices[i]])
  })
  return newRows.map((row) => remembered.get(rowKey(row))?.shift() ?? fitChoice(row, 'both'))
}

/** The merged output lines, in row order. */
export function mergedLines(rows: readonly MergeRow[], choices: readonly Choice[]): string[] {
  const out: string[] = []
  rows.forEach((row, i) => {
    const choice = choices[i] ?? 'none'
    if (row.kind === 'same') {
      if (choice !== 'none' && row.left !== null) out.push(row.left)
      return
    }
    if (includesLeft(choice) && row.left !== null) out.push(row.left)
    if (includesRight(choice) && row.right !== null) out.push(row.right)
  })
  return out
}

export function mergeText(diff: LineDiff, choices: readonly Choice[]): string {
  const lines = mergedLines(diff.rows, choices)
  if (lines.length === 0) return ''
  return lines.join(diff.eol) + (diff.trailingNewline ? diff.eol : '')
}

export interface MergeStats {
  readonly changes: number
  readonly manual: number
  readonly automate: number
  readonly both: number
  readonly none: number
}

export function mergeStats(rows: readonly MergeRow[], choices: readonly Choice[]): MergeStats {
  const stats = { changes: 0, manual: 0, automate: 0, both: 0, none: 0 }
  rows.forEach((row, i) => {
    if (row.kind !== 'change') return
    stats.changes++
    const choice = choices[i]
    if (choice === 'left') stats.manual++
    else if (choice === 'right') stats.automate++
    else if (choice === 'both') stats.both++
    else stats.none++
  })
  return stats
}

/** Common prefix / suffix lengths of two lines — used to highlight what differs inside a pair. */
export function innerDiff(a: string, b: string): { readonly prefix: number; readonly suffix: number } {
  let prefix = 0
  const max = Math.min(a.length, b.length)
  while (prefix < max && a[prefix] === b[prefix]) prefix++
  let suffix = 0
  while (suffix < max - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++
  return { prefix, suffix }
}
