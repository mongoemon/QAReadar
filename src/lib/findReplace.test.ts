import { describe, expect, it } from 'vitest'
import { findMatches, offsetToPos, replaceAll, replaceMatch, replacementFor, unescapeExtended } from './findReplace'

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

describe('extended mode (Notepad++)', () => {
  const ext = { caseSensitive: false, regex: false, extended: true }

  it('decodes escapes', () => {
    expect(unescapeExtended('a\\nb\\tc\\\\n')).toBe('a\nb\tc\\n')
    expect(unescapeExtended('\\x41\\u0E01\\o101\\d065\\b01000001')).toBe('Aก' + 'AAA')
    expect(unescapeExtended('\\0')).toBe('\0')
  })

  it('keeps unknown or incomplete escapes as typed', () => {
    expect(unescapeExtended('\\q \\x4 \\d99 end\\')).toBe('\\q \\x4 \\d99 end\\')
  })

  it('finds and replaces line breaks and tabs', () => {
    expect(replaceAll('a,b,c', ',', '\\n', ext)).toEqual({ text: 'a\nb\nc', count: 2 })
    expect(replaceAll('a\nb\nc', '\\n', '\\t', ext)).toEqual({ text: 'a\tb\tc', count: 2 })
  })

  it('leaves escapes literal when extended is off', () => {
    expect(replaceAll('a,b', ',', '\\n', plain)).toEqual({ text: 'a\\nb', count: 1 })
  })

  it('replacementFor decodes the replacement too', () => {
    const text = 'x;y'
    expect(replacementFor(text, { start: 1, end: 2 }, ';', '\\r\\n', ext)).toBe('\r\n')
  })
})

describe('regex replacement escapes', () => {
  const rx = { caseSensitive: false, regex: true }

  it('understands \\n and backslash backreferences', () => {
    expect(replaceAll('a=1;b=2', '(\\w)=(\\d);?', '\\2:\\1\\n', rx)).toEqual({ text: '1:a\n2:b\n', count: 2 })
  })

  it('does not decode escapes inside captured text', () => {
    expect(replaceAll('C:\\new', '(.+)', '[$1]', rx).text).toBe('[C:\\new]')
  })

  it('\\\\ gives a literal backslash', () => {
    expect(replaceAll('a', 'a', '\\\\n', rx).text).toBe('\\n')
  })
})

describe('whole word and dot-all', () => {
  it('matches whole words only, including Thai/Unicode letters as word characters', () => {
    const r = findMatches('cat concat cat_1 cat.', 'cat', { caseSensitive: false, regex: false, wholeWord: true })
    expect(r.ok && r.matches.map((m) => m.start)).toEqual([0, 17])
  })

  it('lets . cross line breaks when dotAll is on', () => {
    const on = findMatches('a\nb', 'a.b', { caseSensitive: false, regex: true, dotAll: true })
    const off = findMatches('a\nb', 'a.b', { caseSensitive: false, regex: true })
    expect(on.ok && on.matches.length).toBe(1)
    expect(off.ok && off.matches.length).toBe(0)
  })
})
