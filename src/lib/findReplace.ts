export interface FindOptions {
  readonly caseSensitive: boolean
  readonly regex: boolean
  /**
   * Notepad++ "Extended" mode: \n \r \t \0 \\ \xHH \uHHHH \oNNN \dNNN \bNNNNNNNN in the
   * search and replace text stand for the characters they name. Ignored for the search text in
   * regex mode (the regex engine already understands escapes).
   */
  readonly extended?: boolean
  /** Only match where the hit is not inside a longer word (letters, digits, underscore). */
  readonly wholeWord?: boolean
  /** Regex mode: `.` also matches line breaks. */
  readonly dotAll?: boolean
}

export interface Match {
  readonly start: number
  readonly end: number
}

export type FindResult =
  | { readonly ok: true; readonly matches: readonly Match[] }
  | { readonly ok: false; readonly error: string }

export const MAX_MATCHES = 10_000

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Escape sequences understood in Extended mode, Notepad++ style. */
export const EXTENDED_ESCAPES = '\\n \\r \\t \\0 \\\\ \\xHH \\uHHHH \\oNNN \\dNNN \\bNNNNNNNN'

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = { n: '\n', r: '\r', t: '\t', '0': '\0', '\\': '\\' }
const NUMERIC_ESCAPES: Readonly<Record<string, readonly [radix: number, digits: number, pattern: RegExp]>> = {
  x: [16, 2, /^[0-9a-fA-F]{2}$/],
  u: [16, 4, /^[0-9a-fA-F]{4}$/],
  o: [8, 3, /^[0-7]{3}$/],
  d: [10, 3, /^[0-9]{3}$/],
  b: [2, 8, /^[01]{8}$/],
}

/**
 * Turn Extended-mode escapes into the characters they stand for. Anything that is not a
 * complete, known escape (e.g. `\q`, `\x4`) is kept as typed.
 */
export function unescapeExtended(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch !== '\\' || i === text.length - 1) {
      out += ch
      continue
    }
    const next = text[i + 1]
    const simple = SIMPLE_ESCAPES[next]
    if (simple !== undefined) {
      out += simple
      i++
      continue
    }
    const numeric = NUMERIC_ESCAPES[next]
    if (numeric) {
      const [radix, digits, pattern] = numeric
      const body = text.slice(i + 2, i + 2 + digits)
      const code = pattern.test(body) ? Number.parseInt(body, radix) : Number.NaN
      if (!Number.isNaN(code) && code <= 0xffff) {
        out += String.fromCharCode(code)
        i += 1 + digits
        continue
      }
    }
    out += ch
  }
  return out
}

/** The search text as the engine should see it (Extended escapes decoded outside regex mode). */
const effectiveQuery = (query: string, options: FindOptions): string =>
  options.extended && !options.regex ? unescapeExtended(query) : query

function flagsFor(options: FindOptions, extra: string): string {
  return (
    extra +
    (options.caseSensitive ? '' : 'i') +
    (options.regex ? 'm' : '') +
    (options.regex && options.dotAll ? 's' : '') +
    (options.wholeWord ? 'u' : '')
  )
}

const WORD_CHAR = '[\\p{L}\\p{N}\\p{M}_]'

function sourceFor(query: string, options: FindOptions): string {
  const base = options.regex ? query : escapeRegex(effectiveQuery(query, options))
  return options.wholeWord ? `(?<!${WORD_CHAR})(?:${base})(?!${WORD_CHAR})` : base
}

function compile(
  query: string,
  options: FindOptions,
  extraFlags: string,
): { ok: true; re: RegExp } | { ok: false; error: string } {
  try {
    return { ok: true, re: new RegExp(sourceFor(query, options), flagsFor(options, extraFlags)) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function findMatches(text: string, query: string, options: FindOptions): FindResult {
  if (query === '') return { ok: true, matches: [] }
  const compiled = compile(query, options, 'g')
  if (!compiled.ok) return compiled

  const { re } = compiled
  const matches: Match[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null && matches.length < MAX_MATCHES) {
    if (m[0] === '') {
      re.lastIndex++
      continue
    }
    matches.push({ start: m.index, end: m.index + m[0].length })
  }
  return { ok: true, matches }
}

/**
 * Regex-mode replacement: `$&` / `$1`…`$99` / `$$` as in JavaScript, plus Notepad++-style
 * `\0` (whole match), `\1`…`\9` and the Extended escapes (`\n`, `\t`, `\x41`…).
 */
function expand(template: string, match: string, groups: readonly (string | undefined)[]): string {
  // One pass, so text captured from the document is inserted verbatim, never re-decoded.
  return template.replace(
    /\$(\$|&|\d{1,2})|\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|o[0-7]{3}|d[0-9]{3}|b[01]{8}|[nrt\\]|\d)/g,
    (all, dollar: string | undefined, slash: string | undefined) => {
      if (dollar === '$') return '$'
      if (dollar === '&') return match
      if (dollar !== undefined) return groups[Number(dollar) - 1] ?? ''
      if (slash === undefined) return all
      if (slash === '0') return match
      if (/^\d$/.test(slash)) return groups[Number(slash) - 1] ?? ''
      return unescapeExtended(all)
    },
  )
}

/** The replacement text for a literal (non-regex) match. */
const literalReplacement = (replacement: string, options: FindOptions): string =>
  options.extended ? unescapeExtended(replacement) : replacement

export function replaceAll(
  text: string,
  query: string,
  replacement: string,
  options: FindOptions,
): { text: string; count: number } {
  const found = findMatches(text, query, options)
  if (!found.ok || found.matches.length === 0) return { text, count: 0 }

  const compiled = compile(query, options, 'g')
  if (!compiled.ok) return { text, count: 0 }

  const literal = literalReplacement(replacement, options)
  const replaced = text.replace(compiled.re, (...args: unknown[]) => {
    const match = String(args[0])
    if (match === '') return ''
    if (!options.regex) return literal
    const rest = args.slice(1)
    const offsetAt = rest.findIndex((a) => typeof a === 'number')
    return expand(replacement, match, rest.slice(0, offsetAt) as (string | undefined)[])
  })
  return { text: replaced, count: found.matches.length }
}

/** Replacement text for one match, expanding $1/$& in regex mode using the real context. */
export function replacementFor(
  text: string,
  match: Match,
  query: string,
  replacement: string,
  options: FindOptions,
): string {
  if (!options.regex) return literalReplacement(replacement, options)
  const compiled = compile(query, options, 'y')
  if (!compiled.ok) return replacement
  compiled.re.lastIndex = match.start
  const m = compiled.re.exec(text)
  if (!m) return replacement
  return expand(replacement, m[0], m.slice(1))
}

export function replaceMatch(text: string, match: Match, replacement: string): string {
  return text.slice(0, match.start) + replacement + text.slice(match.end)
}

/** Converts a string offset to a 1-based [line, column] position. */
export function offsetToPos(text: string, offset: number): [number, number] {
  const clamped = Math.max(0, Math.min(offset, text.length))
  let line = 1
  let lastNewline = -1
  for (let i = text.indexOf('\n'); i !== -1 && i < clamped; i = text.indexOf('\n', i + 1)) {
    line++
    lastNewline = i
  }
  return [line, clamped - lastNewline]
}
