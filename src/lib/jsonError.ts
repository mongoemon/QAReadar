export interface ErrorLocation {
  readonly offset: number
  /** 1-based */
  readonly line: number
  /** 1-based */
  readonly col: number
}

const MAX_DEPTH = 500
const WS = ' \t\n\r'
const NUMBER = /-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y
const ESCAPES = '"\\/bfnrt'

/** Strict JSON scanner. Returns the offset of the first syntax error, or -1 when valid. */
function scanJsonError(text: string): number {
  let i = 0
  let errorAt = -1

  const fail = (): false => {
    errorAt = i
    return false
  }
  const skipWs = (): void => {
    while (i < text.length && WS.includes(text[i])) i++
  }

  const string = (): boolean => {
    i++
    for (;;) {
      const c = text[i]
      if (c === undefined || c < ' ') return fail()
      if (c === '"') {
        i++
        return true
      }
      if (c !== '\\') {
        i++
        continue
      }
      const next = text[i + 1]
      if (next === 'u') {
        if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) {
          i += 2
          return fail()
        }
        i += 6
      } else if (next !== undefined && ESCAPES.includes(next)) {
        i += 2
      } else {
        i++
        return fail()
      }
    }
  }

  const number = (): boolean => {
    NUMBER.lastIndex = i
    const m = NUMBER.exec(text)
    if (!m) {
      i++
      return fail()
    }
    i += m[0].length
    return true
  }

  const value = (depth: number): boolean => {
    if (depth > MAX_DEPTH) return fail()
    skipWs()
    const c = text[i]
    if (c === '{') return container(depth, '}', true)
    if (c === '[') return container(depth, ']', false)
    if (c === '"') return string()
    if (c === '-' || (c !== undefined && c >= '0' && c <= '9')) return number()
    for (const literal of ['true', 'false', 'null']) {
      if (text.startsWith(literal, i)) {
        i += literal.length
        return true
      }
    }
    return fail()
  }

  const container = (depth: number, close: string, keyed: boolean): boolean => {
    i++
    skipWs()
    if (text[i] === close) {
      i++
      return true
    }
    for (;;) {
      skipWs()
      if (keyed) {
        if (text[i] !== '"') return fail()
        if (!string()) return false
        skipWs()
        if (text[i] !== ':') return fail()
        i++
      }
      if (!value(depth + 1)) return false
      skipWs()
      if (text[i] === ',') {
        i++
        continue
      }
      if (text[i] === close) {
        i++
        return true
      }
      return fail()
    }
  }

  if (!value(0)) return errorAt
  skipWs()
  return i < text.length ? i : -1
}

function locationOf(text: string, offset: number): ErrorLocation {
  const clamped = Math.max(0, Math.min(offset, text.length))
  const before = text.slice(0, clamped)
  const lastNewline = before.lastIndexOf('\n')
  const line = before.split('\n').length
  return { offset: clamped, line, col: clamped - lastNewline }
}

function offsetOfLine(text: string, line: number, col: number): number {
  let start = 0
  for (let n = 1; n < line; n++) {
    const next = text.indexOf('\n', start)
    if (next === -1) return text.length
    start = next + 1
  }
  return Math.min(start + col - 1, text.length)
}

/**
 * Finds where a JSON syntax error is. Prefers what the engine reported, then falls back
 * to an engine-independent scan because newer V8 messages carry no position.
 */
export function locateJsonError(text: string, message: string): ErrorLocation | null {
  const lineCol = /line (\d+) column (\d+)/i.exec(message)
  if (lineCol) {
    const offset = offsetOfLine(text, Number(lineCol[1]), Number(lineCol[2]))
    return locationOf(text, offset)
  }
  const position = /position (\d+)/i.exec(message)
  if (position) return locationOf(text, Number(position[1]))

  const scanned = scanJsonError(text)
  return scanned === -1 ? null : locationOf(text, scanned)
}
