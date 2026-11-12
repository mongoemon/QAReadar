import type { PathSegment } from './jsonPath'

const WHITESPACE = /\s/
const SCALAR_END = /[\s,\]}]/

interface Scanner {
  readonly text: string
  readonly offset: number
  pos: number
  found: PathSegment[] | null
}

function skipWs(s: Scanner): void {
  while (s.pos < s.text.length && WHITESPACE.test(s.text[s.pos])) s.pos++
}

function skipString(s: Scanner): string {
  const start = s.pos
  s.pos++ // opening quote
  while (s.pos < s.text.length && s.text[s.pos] !== '"') {
    if (s.text[s.pos] === '\\') s.pos++
    s.pos++
  }
  s.pos++ // closing quote
  try {
    return JSON.parse(s.text.slice(start, s.pos)) as string
  } catch {
    return s.text.slice(start + 1, s.pos - 1)
  }
}

function skipScalar(s: Scanner): void {
  while (s.pos < s.text.length && !SCALAR_END.test(s.text[s.pos])) s.pos++
}

function claim(s: Scanner, start: number, path: readonly PathSegment[]): void {
  if (s.found === null && s.offset >= start && s.offset <= s.pos) s.found = [...path]
}

/** Scans one value; the deepest container/scalar holding the offset wins. */
function scanValue(s: Scanner, path: readonly PathSegment[]): void {
  skipWs(s)
  const start = s.pos
  const ch = s.text[s.pos]
  if (ch === '{') scanObject(s, path, start)
  else if (ch === '[') scanArray(s, path, start)
  else if (ch === '"') skipString(s)
  else skipScalar(s)
  claim(s, start, path)
}

function scanObject(s: Scanner, path: readonly PathSegment[], start: number): void {
  s.pos++
  skipWs(s)
  while (s.pos < s.text.length && s.text[s.pos] === '"') {
    const keyStart = s.pos
    const key = skipString(s)
    const childPath = [...path, key]
    claim(s, keyStart, childPath)
    skipWs(s)
    if (s.text[s.pos] === ':') s.pos++
    scanValue(s, childPath)
    skipWs(s)
    if (s.text[s.pos] === ',') s.pos++
    skipWs(s)
  }
  s.pos++
  claim(s, start, path)
}

function scanArray(s: Scanner, path: readonly PathSegment[], start: number): void {
  s.pos++
  skipWs(s)
  let index = 0
  while (s.pos < s.text.length && s.text[s.pos] !== ']') {
    scanValue(s, [...path, index])
    index++
    skipWs(s)
    if (s.text[s.pos] === ',') s.pos++
    skipWs(s)
  }
  s.pos++
  claim(s, start, path)
}

/**
 * Returns the JSON path of the key/value under a text offset, or null when
 * the offset is outside any value. Assumes the text is valid JSON.
 */
export function pathAtOffset(text: string, offset: number): PathSegment[] | null {
  const s: Scanner = { text, offset, pos: 0, found: null }
  scanValue(s, [])
  return s.found
}

/** Walks a parsed value along the segments; `ok` is false when it cannot. */
export function resolvePath(
  root: unknown,
  segments: readonly PathSegment[],
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  let node: unknown = root
  for (const seg of segments) {
    if (node === null || typeof node !== 'object' || !Object.prototype.hasOwnProperty.call(node, seg)) {
      return { ok: false }
    }
    node = (node as Record<string | number, unknown>)[seg]
  }
  return { ok: true, value: node }
}
