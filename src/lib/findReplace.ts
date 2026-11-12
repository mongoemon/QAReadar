export interface FindOptions {
  readonly caseSensitive: boolean
  readonly regex: boolean
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

function flagsFor(options: FindOptions, extra: string): string {
  return `${extra}${options.caseSensitive ? '' : 'i'}${options.regex ? 'm' : ''}`
}

function sourceFor(query: string, options: FindOptions): string {
  return options.regex ? query : escapeRegex(query)
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

function expand(template: string, match: string, groups: readonly (string | undefined)[]): string {
  return template.replace(/\$(\$|&|\d{1,2})/g, (_all, token: string) => {
    if (token === '$') return '$'
    if (token === '&') return match
    return groups[Number(token) - 1] ?? ''
  })
}

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

  const replaced = text.replace(compiled.re, (...args: unknown[]) => {
    const match = String(args[0])
    if (match === '') return ''
    if (!options.regex) return replacement
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
  if (!options.regex) return replacement
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
