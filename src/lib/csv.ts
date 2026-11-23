/**
 * CSV / TSV parsing for the Text tab's table view (RFC 4180 + common variants).
 *
 * Every cell keeps the offsets of its raw field in the source text, so an edit made in the
 * table replaces exactly that field and leaves the rest of the file byte-for-byte as it was.
 * Input line endings are `\n` (the editor normalizes them).
 */

export type Delimiter = ',' | ';' | '\t' | '|'

export const DELIMITERS: readonly Delimiter[] = [',', ';', '\t', '|']
export const DELIMITER_NAMES: Readonly<Record<Delimiter, string>> = { ',': ',', ';': ';', '\t': 'Tab', '|': '|' }

export const isDelimiter = (value: unknown): value is Delimiter => DELIMITERS.includes(value as Delimiter)

export interface CsvCell {
  /** Unquoted, unescaped value. */
  readonly value: string
  /** Offset of the raw field (including its quotes) in the source text. */
  readonly start: number
  readonly end: number
}

export interface CsvRow {
  /** 1-based line the row starts on. */
  readonly line: number
  readonly cells: readonly CsvCell[]
  /** Offset just past the row's last field (before its line break). */
  readonly end: number
}

export interface CsvTable {
  readonly rows: readonly CsvRow[]
  /** Widest row. */
  readonly columns: number
  /** A quoted field was still open at the end of the text. */
  readonly unterminated: boolean
}

/** Parse the whole text. Rows that are completely empty (blank lines) are skipped. */
export function parseCsv(text: string, delimiter: Delimiter): CsvTable {
  const rows: CsvRow[] = []
  const n = text.length
  let cells: CsvCell[] = []
  let line = 1
  let rowLine = 1
  let i = 0
  let unterminated = false

  for (;;) {
    const start = i
    let value: string
    if (text[i] === '"') {
      value = ''
      i++
      for (;;) {
        if (i >= n) {
          unterminated = true
          break
        }
        const ch = text[i]
        if (ch === '"') {
          if (text[i + 1] === '"') {
            value += '"'
            i += 2
            continue
          }
          i++
          break
        }
        if (ch === '\n') line++
        value += ch
        i++
      }
      // Lenient: anything between the closing quote and the delimiter is kept as-is.
      while (i < n && text[i] !== delimiter && text[i] !== '\n') value += text[i++]
    } else {
      while (i < n && text[i] !== delimiter && text[i] !== '\n') i++
      value = text.slice(start, i)
    }
    cells.push({ value, start, end: i })
    if (i < n && text[i] === delimiter) {
      i++
      continue
    }
    const blank = cells.length === 1 && start === i
    if (!blank) rows.push({ line: rowLine, cells, end: i })
    cells = []
    if (i >= n) break
    i++ // line break
    line++
    rowLine = line
    if (i >= n) break
  }
  return { rows, columns: rows.reduce((max, row) => Math.max(max, row.cells.length), 0), unterminated }
}

/** Delimiter count for each of the first `maxLines` non-empty lines, ignoring quoted text. */
function countsPerLine(text: string, delimiter: Delimiter, maxLines: number): number[] {
  const counts: number[] = []
  let count = 0
  let empty = true
  let quoted = false
  for (let i = 0; i <= text.length && counts.length < maxLines; i++) {
    const ch = text[i]
    if (ch === '"') quoted = !quoted
    if (quoted) {
      empty = false
      continue
    }
    if (ch === '\n' || ch === undefined) {
      if (!empty) counts.push(count)
      count = 0
      empty = true
    } else {
      empty = false
      if (ch === delimiter) count++
    }
  }
  return counts
}

/**
 * Pick the delimiter that splits the first lines most consistently into more than one column.
 * Falls back to the file extension's default (Tab for .tsv, comma otherwise).
 */
export function detectDelimiter(text: string, fileName = ''): Delimiter {
  const fallback: Delimiter = /\.tsv$/i.test(fileName) ? '\t' : ','
  let best: Delimiter = fallback
  let bestScore = 0
  for (const delimiter of DELIMITERS) {
    const counts = countsPerLine(text, delimiter, 20)
    const first = counts[0] ?? 0
    if (first === 0) continue
    // Consistency matters most; more columns breaks ties. Ties go to the extension's default.
    const consistent = counts.filter((c) => c === first).length / counts.length
    const score = consistent * 100 + Math.min(first, 50) + (delimiter === fallback ? 0.5 : 0)
    if (score > bestScore) {
      best = delimiter
      bestScore = score
    }
  }
  return best
}

/** Quote a value for writing back when it needs it (delimiter, quote, line break, edge spaces). */
export function quoteField(value: string, delimiter: Delimiter): string {
  const needs = value.includes(delimiter) || value.includes('"') || value.includes('\n') || /^\s|\s$/.test(value)
  return needs ? `"${value.replace(/"/g, '""')}"` : value
}

const NUMBER = /^[-+]?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?([eE][-+]?\d+)?%?$/

/** True for values that read as numbers (1, -2.5, 1,234.50, 12%, 1e3): right-aligned in the table. */
export const isNumeric = (value: string): boolean => {
  const v = value.trim()
  return /\d/.test(v) && NUMBER.test(v)
}

/** Extensions that open in table view by default. */
export const TABLE_EXTENSIONS: readonly string[] = ['csv', 'tsv']
