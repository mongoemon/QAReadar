import { describe, expect, it } from 'vitest'
import { flattenJson, formatPath, parseJsonSafe } from './jsonPath'

describe('formatPath', () => {
  it('formats root as $', () => {
    expect(formatPath([], 'jsonpath')).toBe('$')
  })
  it('formats keys and indexes as JSONPath', () => {
    expect(formatPath(['a', 'b', 0, 'c'], 'jsonpath')).toBe('$.a.b[0].c')
  })
  it('uses bracket notation for keys with special characters', () => {
    expect(formatPath(['a-b', 'c d', "it's"], 'jsonpath')).toBe(
      "$['a-b']['c d']['it\\'s']",
    )
  })
  it('formats as JS accessor', () => {
    expect(formatPath(['a', 0, 'b-c'], 'js')).toBe("data.a[0]['b-c']")
  })
  it('formats as lodash style path', () => {
    expect(formatPath(['a', 0, 'b'], 'lodash')).toBe('a[0].b')
  })
})

describe('parseJsonSafe', () => {
  it('returns ok with value for valid JSON', () => {
    expect(parseJsonSafe('{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
  })
  it('returns error message with position for invalid JSON', () => {
    const r = parseJsonSafe('{"a":')
    expect(r.ok).toBe(false)
  })
  it('rejects empty input', () => {
    expect(parseJsonSafe('  ').ok).toBe(false)
  })
})

describe('flattenJson', () => {
  const data = { user: { name: 'Neko', tags: ['a', 'b'] }, n: null }
  it('lists every node with its path', () => {
    const paths = flattenJson(data).map((n) => n.path)
    expect(paths).toContain('$')
    expect(paths).toContain('$.user.name')
    expect(paths).toContain('$.user.tags[1]')
    expect(paths).toContain('$.n')
  })
  it('does not mutate input', () => {
    const copy = JSON.parse(JSON.stringify(data))
    flattenJson(data)
    expect(data).toEqual(copy)
  })
  it('reports type and preview for leaves', () => {
    const n = flattenJson(data).find((x) => x.path === '$.user.name')!
    expect(n.type).toBe('string')
    expect(n.preview).toBe('"Neko"')
  })
})
