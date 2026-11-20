import { describe, expect, it } from 'vitest'
import {
  applyTextTool,
  countLines,
  detectEol,
  expandTabs,
  leadingSpacesToTabs,
  lineStartOffset,
  normalizeEol,
  withEol,
} from './textTools'

describe('applyTextTool', () => {
  it('sorts lines and keeps a trailing newline in place', () => {
    expect(applyTextTool('sortAsc', 'b\nc\na\n')).toBe('a\nb\nc\n')
    expect(applyTextTool('sortDesc', 'b\nc\na')).toBe('c\nb\na')
  })

  it('sorts numbers naturally', () => {
    expect(applyTextTool('sortNatural', 'TC10\nTC2\nTC1')).toBe('TC1\nTC2\nTC10')
  })

  it('removes duplicates keeping the first occurrence', () => {
    expect(applyTextTool('unique', 'a\nb\na\nc\nb')).toBe('a\nb\nc')
    expect(applyTextTool('uniqueAdjacent', 'a\na\nb\na\na')).toBe('a\nb\na')
  })

  it('removes empty vs blank lines', () => {
    expect(applyTextTool('removeEmpty', 'a\n\n  \nb')).toBe('a\n  \nb')
    expect(applyTextTool('removeBlank', 'a\n\n  \nb')).toBe('a\nb')
  })

  it('trims spaces and tabs per line', () => {
    expect(applyTextTool('trimTrailing', 'a  \n\tb\t')).toBe('a\n\tb')
    expect(applyTextTool('trimLeading', '  a \n\tb')).toBe('a \nb')
    expect(applyTextTool('trimBoth', '  a \n\tb\t')).toBe('a\nb')
  })

  it('joins lines with single spaces', () => {
    expect(applyTextTool('joinLines', 'Given a\n  When b\nThen c\n')).toBe('Given a When b Then c\n')
  })

  it('changes case', () => {
    expect(applyTextTool('upper', 'abc')).toBe('ABC')
    expect(applyTextTool('lower', 'ABC')).toBe('abc')
    expect(applyTextTool('title', "hello WORLD, it's ok")).toBe("Hello World, It's Ok")
    expect(applyTextTool('invertCase', 'aBc')).toBe('AbC')
  })

  it('converts tabs and leading spaces', () => {
    expect(applyTextTool('tabsToSpaces', '\ta\tb', 4)).toBe('    a   b')
    expect(applyTextTool('spacesToTabs', '      x  y', 4)).toBe('\t  x  y')
  })
})

describe('tab helpers', () => {
  it('honours tab stops', () => {
    expect(expandTabs('ab\tc', 4)).toBe('ab  c')
    expect(leadingSpacesToTabs(' \t x', 4)).toBe('\t x')
  })
})

describe('line endings', () => {
  it('detects the dominant EOL', () => {
    expect(detectEol('a\r\nb\r\nc')).toBe('\r\n')
    expect(detectEol('a\nb')).toBe('\n')
    expect(detectEol('a\rb\rc')).toBe('\r')
    expect(detectEol('one line')).toBe('\n')
  })

  it('normalizes and restores', () => {
    expect(normalizeEol('a\r\nb\rc\n')).toBe('a\nb\nc\n')
    expect(withEol('a\nb', '\r\n')).toBe('a\r\nb')
  })
})

describe('lines', () => {
  it('finds line starts and counts lines', () => {
    const text = 'ab\ncd\nef'
    expect(lineStartOffset(text, 1)).toBe(0)
    expect(lineStartOffset(text, 3)).toBe(6)
    expect(lineStartOffset(text, 99)).toBe(6)
    expect(countLines(text)).toBe(3)
    expect(countLines('')).toBe(1)
  })
})
