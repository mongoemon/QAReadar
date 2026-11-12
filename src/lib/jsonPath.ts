export type PathSegment = string | number
export type PathStyle = 'jsonpath' | 'js' | 'lodash'

export interface FlatNode {
  readonly path: string
  /** Last path segment as text, or "$" for the root. */
  readonly key: string
  readonly segments: readonly PathSegment[]
  readonly type: string
  readonly preview: string
  readonly value: unknown
}

export type ParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string }

const SIMPLE_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/

const quoteKey = (key: string): string =>
  `['${key.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`

export function formatPath(
  segments: readonly PathSegment[],
  style: PathStyle,
): string {
  const root = style === 'jsonpath' ? '$' : style === 'js' ? 'data' : ''
  return segments.reduce<string>((acc, seg, i) => {
    if (typeof seg === 'number') return `${acc}[${seg}]`
    if (SIMPLE_KEY.test(seg)) {
      return acc === '' ? seg : `${acc}.${seg}`
    }
    void i
    return `${acc}${quoteKey(seg)}`
  }, root)
}

export function parseJsonSafe(text: string): ParseResult {
  if (text.trim() === '') return { ok: false, error: 'Empty input' }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export const typeOf = (v: unknown): string =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v

export function previewOf(v: unknown): string {
  if (Array.isArray(v)) return `Array(${v.length})`
  if (v !== null && typeof v === 'object') {
    return `Object(${Object.keys(v).length})`
  }
  const s = JSON.stringify(v)
  return s.length > 80 ? `${s.slice(0, 77)}...` : s
}

export function flattenJson(
  value: unknown,
  segments: readonly PathSegment[] = [],
): FlatNode[] {
  const last = segments[segments.length - 1]
  const self: FlatNode = {
    path: formatPath(segments, 'jsonpath'),
    key: last === undefined ? '$' : String(last),
    segments,
    type: typeOf(value),
    preview: previewOf(value),
    value,
  }
  if (Array.isArray(value)) {
    return [
      self,
      ...value.flatMap((v, i) => flattenJson(v, [...segments, i])),
    ]
  }
  if (value !== null && typeof value === 'object') {
    return [
      self,
      ...Object.entries(value).flatMap(([k, v]) =>
        flattenJson(v, [...segments, k]),
      ),
    ]
  }
  return [self]
}
