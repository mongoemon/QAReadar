/**
 * Notepad++-style text operations for the Text editor tab. All pure: they take the text (or the
 * selected part of it) and return the new text. Line endings inside are always `\n` — the
 * editor normalizes them and restores the file's own EOL on save.
 */

export type TextToolId =
  | 'sortAsc'
  | 'sortDesc'
  | 'sortNatural'
  | 'reverse'
  | 'unique'
  | 'uniqueAdjacent'
  | 'removeEmpty'
  | 'removeBlank'
  | 'trimTrailing'
  | 'trimLeading'
  | 'trimBoth'
  | 'joinLines'
  | 'upper'
  | 'lower'
  | 'title'
  | 'invertCase'
  | 'tabsToSpaces'
  | 'spacesToTabs'

export const TEXT_TOOLS: readonly TextToolId[] = [
  'sortAsc', 'sortDesc', 'sortNatural', 'reverse', 'unique', 'uniqueAdjacent', 'removeEmpty', 'removeBlank',
  'trimTrailing', 'trimLeading', 'trimBoth', 'joinLines',
  'upper', 'lower', 'title', 'invertCase',
  'tabsToSpaces', 'spacesToTabs',
]

const split = (text: string): string[] => text.split('\n')
const join = (lines: readonly string[]): string => lines.join('\n')

/** Line-wise ops keep a trailing newline where it was, instead of sorting an empty last line. */
function byLines(text: string, transform: (lines: string[]) => string[]): string {
  const endsWithNewline = text.endsWith('\n')
  const body = endsWithNewline ? text.slice(0, -1) : text
  const out = join(transform(split(body)))
  return endsWithNewline ? `${out}\n` : out
}

const collator = new Intl.Collator(undefined, { sensitivity: 'variant' })
const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Expand tabs to spaces, honouring tab stops (a tab fills up to the next multiple of `size`). */
export function expandTabs(line: string, size: number): string {
  let out = ''
  for (const ch of line) {
    if (ch === '\t') out += ' '.repeat(size - (out.length % size))
    else out += ch
  }
  return out
}

/** Turn leading whitespace into tabs + leftover spaces (indentation only, like Notepad++'s "Leading"). */
export function leadingSpacesToTabs(line: string, size: number): string {
  const match = /^[ \t]*/.exec(line)?.[0] ?? ''
  const width = expandTabs(match, size).length
  return '\t'.repeat(Math.floor(width / size)) + ' '.repeat(width % size) + line.slice(match.length)
}

const titleCase = (text: string): string =>
  text
    .toLocaleLowerCase()
    .replace(/(^|[^\p{L}\p{N}'’])(\p{L})/gu, (_all, before: string, letter: string) => before + letter.toLocaleUpperCase())

const invertCase = (text: string): string =>
  Array.from(text, (ch) => {
    const upper = ch.toLocaleUpperCase()
    return ch === upper ? ch.toLocaleLowerCase() : upper
  }).join('')

export function applyTextTool(id: TextToolId, text: string, tabSize = 4): string {
  switch (id) {
    case 'sortAsc':
      return byLines(text, (lines) => lines.sort(collator.compare))
    case 'sortDesc':
      return byLines(text, (lines) => lines.sort((a, b) => collator.compare(b, a)))
    case 'sortNatural':
      return byLines(text, (lines) => lines.sort(naturalCollator.compare))
    case 'reverse':
      return byLines(text, (lines) => lines.reverse())
    case 'unique':
      return byLines(text, (lines) => [...new Set(lines)])
    case 'uniqueAdjacent':
      return byLines(text, (lines) => lines.filter((line, i) => i === 0 || line !== lines[i - 1]))
    case 'removeEmpty':
      return byLines(text, (lines) => lines.filter((line) => line !== ''))
    case 'removeBlank':
      return byLines(text, (lines) => lines.filter((line) => line.trim() !== ''))
    case 'trimTrailing':
      return join(split(text).map((line) => line.replace(/[ \t]+$/, '')))
    case 'trimLeading':
      return join(split(text).map((line) => line.replace(/^[ \t]+/, '')))
    case 'trimBoth':
      return join(split(text).map((line) => line.replace(/^[ \t]+|[ \t]+$/g, '')))
    case 'joinLines':
      return byLines(text, (lines) => [lines.map((line, i) => (i === 0 ? line : line.trimStart())).join(' ')])
    case 'upper':
      return text.toLocaleUpperCase()
    case 'lower':
      return text.toLocaleLowerCase()
    case 'title':
      return titleCase(text)
    case 'invertCase':
      return invertCase(text)
    case 'tabsToSpaces':
      return join(split(text).map((line) => expandTabs(line, tabSize)))
    case 'spacesToTabs':
      return join(split(text).map((line) => leadingSpacesToTabs(line, tabSize)))
  }
}

export type Eol = '\n' | '\r\n' | '\r'

/** The dominant line ending of a file as loaded (before the textarea normalizes it to LF). */
export function detectEol(text: string): Eol {
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length
  const cr = (text.match(/\r(?!\n)/g) ?? []).length
  if (crlf > 0 && crlf >= lf && crlf >= cr) return '\r\n'
  if (cr > lf) return '\r'
  return '\n'
}

export const normalizeEol = (text: string): string => text.replace(/\r\n?/g, '\n')
export const withEol = (text: string, eol: Eol): string => (eol === '\n' ? text : text.replace(/\n/g, eol))
export const EOLS: readonly Eol[] = ['\n', '\r\n', '\r']
export const EOL_NAMES: Readonly<Record<Eol, string>> = { '\n': 'LF', '\r\n': 'CRLF', '\r': 'CR' }

/** Line number (1-based) → offset of its first character; clamps to the last line. */
export function lineStartOffset(text: string, line: number): number {
  let offset = 0
  for (let current = 1; current < line; current++) {
    const next = text.indexOf('\n', offset)
    if (next === -1) break
    offset = next + 1
  }
  return offset
}

export function countLines(text: string): number {
  let n = 1
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) n++
  return n
}
