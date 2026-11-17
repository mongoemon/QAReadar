import { describe, expect, it } from 'vitest'
import { filterCommands, type Command } from './commands'
import { buildHtmlDocument, escapeHtml } from './exportHtml'
import { pushRecent, type RecentEntry } from './recent'
import { nextTheme, resolveDark } from './theme'
import { SPLIT_DEFAULT, clampSplit, cycleWidth, isWidthPref, stepFontSize } from './readingPrefs'

describe('isWidthPref', () => {
  it('accepts only the known widths (e.g. from localStorage)', () => {
    expect(['narrow', 'normal', 'wide'].every(isWidthPref)).toBe(true)
    expect(isWidthPref('huge')).toBe(false)
    expect(isWidthPref(null)).toBe(false)
  })
})

describe('clampSplit', () => {
  it('keeps values inside 20–80%', () => {
    expect(clampSplit(35)).toBe(35)
    expect(clampSplit(5)).toBe(20)
    expect(clampSplit(99)).toBe(80)
  })
  it('parses stored strings and rounds to one decimal', () => {
    expect(clampSplit('62.345')).toBe(62.3)
  })
  it('falls back to the default for missing or junk values', () => {
    expect(clampSplit(null)).toBe(SPLIT_DEFAULT)
    expect(clampSplit('abc')).toBe(SPLIT_DEFAULT)
    expect(clampSplit(Number.NaN)).toBe(SPLIT_DEFAULT)
  })
})

const cmd = (id: string, title: string): Command => ({ id, title, run: () => {} })

describe('filterCommands', () => {
  const all = [cmd('a', 'Open file'), cmd('b', 'Toggle read mode'), cmd('c', 'Export as HTML')]

  it('returns everything for an empty query', () => {
    expect(filterCommands(all, '')).toHaveLength(3)
  })

  it('matches subsequences case-insensitively', () => {
    expect(filterCommands(all, 'trm').map((c) => c.id)).toEqual(['b'])
    expect(filterCommands(all, 'HTML').map((c) => c.id)).toEqual(['c'])
  })

  it('ranks prefix and contiguous matches first', () => {
    const list = [cmd('x', 'Save as'), cmd('y', 'Select all as')]
    expect(filterCommands(list, 'sa')[0].id).toBe('x')
  })

  it('returns nothing when no command matches', () => {
    expect(filterCommands(all, 'zzz')).toEqual([])
  })
})

describe('buildHtmlDocument', () => {
  it('escapes the title and embeds the body untouched', () => {
    const html = buildHtmlDocument('<b>x</b> & y', '<h1>Hi</h1>')
    expect(html).toContain('<title>&lt;b&gt;x&lt;/b&gt; &amp; y</title>')
    expect(html).toContain('<h1>Hi</h1>')
    expect(html.startsWith('<!doctype html>')).toBe(true)
  })

  it('escapeHtml covers quotes', () => {
    expect(escapeHtml(`"'<>&`)).toBe('&quot;&#39;&lt;&gt;&amp;')
  })
})

describe('pushRecent', () => {
  const e = (name: string, at: number, tab = 'markdown'): RecentEntry => ({
    id: `${tab}:${name}`,
    name,
    tab,
    openedAt: at,
  })

  it('puts the newest first and de-duplicates by id', () => {
    const list = pushRecent([e('a', 1), e('b', 2)], e('a', 3), 10)
    expect(list.map((x) => x.name)).toEqual(['a', 'b'])
    expect(list[0].openedAt).toBe(3)
  })

  it('caps the list length without mutating the input', () => {
    const input = [e('a', 1), e('b', 2)]
    const list = pushRecent(input, e('c', 3), 2)
    expect(list.map((x) => x.name)).toEqual(['c', 'a'])
    expect(input).toHaveLength(2)
  })
})

describe('theme', () => {
  it('cycles auto → light → dark → auto', () => {
    expect(nextTheme('auto')).toBe('light')
    expect(nextTheme('light')).toBe('dark')
    expect(nextTheme('dark')).toBe('auto')
  })

  it('resolves dark from preference and system', () => {
    expect(resolveDark('auto', true)).toBe(true)
    expect(resolveDark('auto', false)).toBe(false)
    expect(resolveDark('light', true)).toBe(false)
    expect(resolveDark('dark', false)).toBe(true)
  })
})

describe('readingPrefs', () => {
  it('steps font size within bounds', () => {
    expect(stepFontSize(17, 1)).toBe(18)
    expect(stepFontSize(24, 1)).toBe(24)
    expect(stepFontSize(13, -1)).toBe(13)
  })

  it('cycles the column width', () => {
    expect(cycleWidth('narrow')).toBe('normal')
    expect(cycleWidth('normal')).toBe('wide')
    expect(cycleWidth('wide')).toBe('narrow')
  })
})
