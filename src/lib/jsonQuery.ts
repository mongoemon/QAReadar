import type { PathSegment } from './jsonPath'

export interface QueryHit {
  readonly segments: readonly PathSegment[]
  readonly value: unknown
}

export type QueryResult =
  | { readonly ok: true; readonly hits: readonly QueryHit[]; readonly truncated: boolean }
  | { readonly ok: false; readonly error: string }

export const MAX_HITS = 5000

type Selector =
  | { readonly k: 'name'; readonly v: string }
  | { readonly k: 'index'; readonly v: number }
  | { readonly k: 'wild' }
  | { readonly k: 'slice'; readonly from: number | null; readonly to: number | null; readonly step: number }

interface Step {
  readonly descend: boolean
  readonly selectors: readonly Selector[]
}

class SyntaxProblem extends Error {}

const INDEX = /^-?\d+$/
const SLICE = /^(-?\d*):(-?\d*)(?::(-?\d*))?$/

function parsePath(path: string): Step[] {
  if (!path.startsWith('$')) throw new SyntaxProblem('Path must start with $')
  const steps: Step[] = []
  let i = 1

  const readName = (): string => {
    const start = i
    while (i < path.length && path[i] !== '.' && path[i] !== '[') i++
    const name = path.slice(start, i).trim()
    if (name === '') throw new SyntaxProblem(`Expected a key at position ${start}`)
    return name
  }

  const readQuoted = (): string => {
    const quote = path[i++]
    let out = ''
    while (i < path.length && path[i] !== quote) {
      if (path[i] === '\\' && i + 1 < path.length) i++
      out += path[i++]
    }
    if (i >= path.length) throw new SyntaxProblem('Unterminated string')
    i++
    return out
  }

  const parseToken = (token: string): Selector => {
    const text = token.trim()
    if (INDEX.test(text)) return { k: 'index', v: Number(text) }
    const slice = SLICE.exec(text)
    if (!slice) throw new SyntaxProblem(`Unsupported selector "${text}"`)
    const num = (s: string | undefined): number | null =>
      s === undefined || s === '' ? null : Number(s)
    const step = num(slice[3]) ?? 1
    if (step <= 0) throw new SyntaxProblem('Slice step must be positive')
    return { k: 'slice', from: num(slice[1]), to: num(slice[2]), step }
  }

  const readBracket = (): Selector[] => {
    i++ // [
    const selectors: Selector[] = []
    for (;;) {
      while (path[i] === ' ') i++
      const c = path[i]
      if (c === undefined) throw new SyntaxProblem('Missing ]')
      if (c === '?' || c === '(') throw new SyntaxProblem('Filter expressions are not supported')
      if (c === '*') {
        selectors.push({ k: 'wild' })
        i++
      } else if (c === "'" || c === '"') {
        selectors.push({ k: 'name', v: readQuoted() })
      } else {
        const start = i
        while (i < path.length && path[i] !== ',' && path[i] !== ']') i++
        selectors.push(parseToken(path.slice(start, i)))
      }
      while (path[i] === ' ') i++
      if (path[i] === ',') {
        i++
        continue
      }
      if (path[i] === ']') {
        i++
        return selectors
      }
      throw new SyntaxProblem('Missing ]')
    }
  }

  while (i < path.length) {
    if (path.startsWith('..', i)) {
      i += 2
      if (path[i] === '[') steps.push({ descend: true, selectors: readBracket() })
      else if (path[i] === '*') {
        i++
        steps.push({ descend: true, selectors: [{ k: 'wild' }] })
      } else steps.push({ descend: true, selectors: [{ k: 'name', v: readName() }] })
    } else if (path[i] === '.') {
      i++
      if (path[i] === '*') {
        i++
        steps.push({ descend: false, selectors: [{ k: 'wild' }] })
      } else steps.push({ descend: false, selectors: [{ k: 'name', v: readName() }] })
    } else if (path[i] === '[') {
      steps.push({ descend: false, selectors: readBracket() })
    } else {
      throw new SyntaxProblem(`Unexpected "${path[i]}" at position ${i}`)
    }
  }
  return steps
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

function childrenOf(node: QueryHit, selector: Selector): QueryHit[] {
  const { value, segments } = node
  switch (selector.k) {
    case 'name':
      return isObject(value) && Object.prototype.hasOwnProperty.call(value, selector.v)
        ? [{ segments: [...segments, selector.v], value: value[selector.v] }]
        : []
    case 'index': {
      if (!Array.isArray(value)) return []
      const idx = selector.v < 0 ? value.length + selector.v : selector.v
      return idx >= 0 && idx < value.length
        ? [{ segments: [...segments, idx], value: value[idx] }]
        : []
    }
    case 'wild':
      if (Array.isArray(value)) return value.map((v, i) => ({ segments: [...segments, i], value: v }))
      if (isObject(value)) {
        return Object.entries(value).map(([k, v]) => ({ segments: [...segments, k], value: v }))
      }
      return []
    case 'slice': {
      if (!Array.isArray(value)) return []
      const len = value.length
      const norm = (n: number): number => Math.max(0, Math.min(len, n < 0 ? len + n : n))
      const from = selector.from === null ? 0 : norm(selector.from)
      const to = selector.to === null ? len : norm(selector.to)
      const out: QueryHit[] = []
      for (let i = from; i < to; i += selector.step) {
        out.push({ segments: [...segments, i], value: value[i] })
      }
      return out
    }
  }
}

function descendantsOrSelf(node: QueryHit): QueryHit[] {
  const out: QueryHit[] = []
  const walk = (n: QueryHit): void => {
    out.push(n)
    if (Array.isArray(n.value)) {
      n.value.forEach((v, i) => walk({ segments: [...n.segments, i], value: v }))
    } else if (isObject(n.value)) {
      for (const [k, v] of Object.entries(n.value)) walk({ segments: [...n.segments, k], value: v })
    }
  }
  walk(node)
  return out
}

/** Evaluates a JSONPath subset: $ . .. [] * indexes, unions, slices, quoted keys. */
export function queryJsonPath(root: unknown, path: string): QueryResult {
  let steps: Step[]
  try {
    steps = parsePath(path.trim())
  } catch (e) {
    if (e instanceof SyntaxProblem) return { ok: false, error: e.message }
    throw e
  }

  let nodes: QueryHit[] = [{ segments: [], value: root }]
  for (const step of steps) {
    const sources = step.descend ? nodes.flatMap(descendantsOrSelf) : nodes
    nodes = sources.flatMap((node) => step.selectors.flatMap((sel) => childrenOf(node, sel)))
  }
  const truncated = nodes.length > MAX_HITS
  return { ok: true, hits: truncated ? nodes.slice(0, MAX_HITS) : nodes, truncated }
}
