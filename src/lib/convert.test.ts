import { describe, expect, it } from 'vitest'
import { convertToJson, formatFromFileName } from './convert'

describe('formatFromFileName', () => {
  it('detects supported formats', () => {
    expect(formatFromFileName('a.jsonl')).toBe('jsonl')
    expect(formatFromFileName('a.NDJSON')).toBe('jsonl')
    expect(formatFromFileName('a.csv')).toBe('csv')
    expect(formatFromFileName('a.yml')).toBe('yaml')
    expect(formatFromFileName('a.yaml')).toBe('yaml')
    expect(formatFromFileName('a.json')).toBeNull()
  })
})

describe('convertToJson', () => {
  it('turns JSON Lines into an array and skips blank lines', () => {
    expect(convertToJson('jsonl', '{"a":1}\n\n{"a":2}\n')).toEqual({
      ok: true,
      value: [{ a: 1 }, { a: 2 }],
    })
  })

  it('names the failing JSON Lines row', () => {
    const r = convertToJson('jsonl', '{"a":1}\n{bad}')
    expect(!r.ok && r.error).toMatch(/line 2/i)
  })

  it('turns CSV into objects keyed by the header row', () => {
    const r = convertToJson('csv', 'id,name\n1,Neko\n2,"Doe, J"\n')
    expect(r).toEqual({
      ok: true,
      value: [
        { id: '1', name: 'Neko' },
        { id: '2', name: 'Doe, J' },
      ],
    })
  })

  it('handles quoted newlines, escaped quotes, BOM and CRLF in CSV', () => {
    const r = convertToJson('csv', '﻿a,b\r\n"x\ny","he said ""hi"""\r\n')
    expect(r).toEqual({ ok: true, value: [{ a: 'x\ny', b: 'he said "hi"' }] })
  })

  it('fills missing CSV cells with empty strings', () => {
    const r = convertToJson('csv', 'a,b\n1\n')
    expect(r).toEqual({ ok: true, value: [{ a: '1', b: '' }] })
  })

  it('reports an unterminated CSV quote', () => {
    expect(convertToJson('csv', 'a\n"oops').ok).toBe(false)
  })

  it('rejects empty CSV', () => {
    expect(convertToJson('csv', '  \n').ok).toBe(false)
  })

  it('parses YAML', () => {
    const r = convertToJson('yaml', 'a: 1\nlist:\n  - x\n  - y\n')
    expect(r).toEqual({ ok: true, value: { a: 1, list: ['x', 'y'] } })
  })

  it('reports invalid YAML', () => {
    expect(convertToJson('yaml', 'a: [1, 2').ok).toBe(false)
  })
})
