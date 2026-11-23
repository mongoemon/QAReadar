import { describe, expect, it } from 'vitest'
import { detectDelimiter, isNumeric, parseCsv, quoteField } from './csv'

const values = (text: string, d: ',' | ';' | '\t' | '|' = ','): string[][] =>
  parseCsv(text, d).rows.map((row) => row.cells.map((cell) => cell.value))

describe('parseCsv', () => {
  it('splits rows and cells', () => {
    expect(values('a,b,c\n1,2,3\n')).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
  })

  it('handles quotes, escaped quotes, delimiters and line breaks inside quotes', () => {
    const text = 'id,note\n1,"a, b"\n2,"say ""hi"""\n3,"line1\nline2"\n4,'
    expect(values(text)).toEqual([
      ['id', 'note'],
      ['1', 'a, b'],
      ['2', 'say "hi"'],
      ['3', 'line1\nline2'],
      ['4', ''],
    ])
    const rows = parseCsv(text, ',').rows
    expect(rows.map((r) => r.line)).toEqual([1, 2, 3, 4, 6])
  })

  it('keeps offsets of the raw field (quotes included)', () => {
    const text = 'x,"y,z",w'
    const [row] = parseCsv(text, ',').rows
    expect(row.cells.map((c) => text.slice(c.start, c.end))).toEqual(['x', '"y,z"', 'w'])
    expect(row.end).toBe(text.length)
  })

  it('skips blank lines but keeps rows of empty cells', () => {
    expect(values('a,b\n\n,\n')).toEqual([['a', 'b'], ['', '']])
  })

  it('reports the widest row and an unterminated quote', () => {
    const table = parseCsv('a\nb,c,d\n"open', ',')
    expect(table.columns).toBe(3)
    expect(table.unterminated).toBe(true)
  })

  it('parses other delimiters', () => {
    expect(values('a\tb\n1\t2', '\t')).toEqual([['a', 'b'], ['1', '2']])
    expect(values('a;b', ';')).toEqual([['a', 'b']])
  })

  it('returns no rows for empty text', () => {
    expect(parseCsv('', ',').rows).toEqual([])
  })
})

describe('detectDelimiter', () => {
  it('finds the consistent delimiter', () => {
    expect(detectDelimiter('a;b;c\n1;2,5;3\n4;5;6')).toBe(';')
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t')
    expect(detectDelimiter('a|b|c\n1|2|3')).toBe('|')
    expect(detectDelimiter('id,note\n1,"x; y; z"')).toBe(',')
  })

  it('falls back to the extension default', () => {
    expect(detectDelimiter('just text', 'data.tsv')).toBe('\t')
    expect(detectDelimiter('just text', 'data.csv')).toBe(',')
  })
})

describe('quoteField', () => {
  it('quotes only when needed', () => {
    expect(quoteField('plain', ',')).toBe('plain')
    expect(quoteField('a,b', ',')).toBe('"a,b"')
    expect(quoteField('a,b', ';')).toBe('a,b')
    expect(quoteField('say "hi"', ',')).toBe('"say ""hi"""')
    expect(quoteField('two\nlines', ',')).toBe('"two\nlines"')
    expect(quoteField(' padded', ',')).toBe('" padded"')
  })

  it('round-trips through the parser', () => {
    const value = 'a, "b"\nc'
    expect(values(`x,${quoteField(value, ',')}`)).toEqual([['x', value]])
  })
})

describe('isNumeric', () => {
  it('recognises numbers', () => {
    for (const v of ['1', '-2.5', '1,234.50', '12%', '1e3', '.5', ' 42 ']) expect(isNumeric(v)).toBe(true)
    for (const v of ['', 'abc', '1.2.3', '12abc', '-', '1,23']) expect(isNumeric(v)).toBe(false)
  })
})
