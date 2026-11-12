import { describe, expect, it } from 'vitest'
import { findMatches, offsetToPos, replaceAll, replaceMatch } from './findReplace'

const plain = { caseSensitive: false, regex: false }

describe('findMatches', () => {
  it('finds literal matches case-insensitively', () => {
    const r = findMatches('Foo foo FOO', 'foo', plain)
    expect(r).toEqual({
      ok: true,
      matches: [
        { start: 0, end: 3 },
        { start: 4, end: 7 },
        { start: 8, end: 11 },
      ],
    })
  })

  it('respects case sensitivity', () => {
    const r = findMatches('Foo foo', 'foo', { caseSensitive: true, regex: false })
    expect(r.ok && r.matches).toEqual([{ start: 4, end: 7 }])
  })

  it('treats regex metacharacters literally when regex is off', () => {
    const r = findMatches('a.b axb', 'a.b', plain)
    expect(r.ok && r.matches.length).toBe(1)
  })

  it('supports regex mode', () => {
    const r = findMatches('a1 b22', '\\d+', { caseSensitive: false, regex: true })
    expect(r.ok && r.matches).toEqual([
      { start: 1, end: 2 },
      { start: 4, end: 6 },
    ])
  })

  it('reports an invalid regex instead of throwing', () => {
    const r = findMatches('x', '(', { caseSensitive: false, regex: true })
    expect(r.ok).toBe(false)
  })

  it('returns no matches for an empty query and skips empty regex matches', () => {
    expect(findMatches('abc', '', plain)).toEqual({ ok: true, matches: [] })
    const r = findMatches('abc', 'x*', { caseSensitive: false, regex: true })
    expect(r).toEqual({ ok: true, matches: [] })
  })
})

describe('replace', () => {
  it('replaces all literal matches and reports the count', () => {
    expect(replaceAll('a-b-c', '-', '$&', plain)).toEqual({ text: 'a$&b$&c', count: 2 })
  })

  it('expands capture groups in regex mode', () => {
    const r = replaceAll('2020-01', '(\\d+)-(\\d+)', '$2/$1', {
      caseSensitive: false,
      regex: true,
    })
    expect(r).toEqual({ text: '01/2020', count: 1 })
  })

  it('replaces a single match without touching the others', () => {
    const text = 'x x x'
    const out = replaceMatch(text, { start: 2, end: 3 }, 'Y')
    expect(out).toBe('x Y x')
  })
})

describe('offsetToPos', () => {
  it('maps offsets to 1-based [line, column]', () => {
    const text = 'ab\ncde\nf'
    expect(offsetToPos(text, 0)).toEqual([1, 1])
    expect(offsetToPos(text, 4)).toEqual([2, 2])
    expect(offsetToPos(text, 7)).toEqual([3, 1])
  })
})
