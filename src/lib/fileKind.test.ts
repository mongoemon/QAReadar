import { describe, expect, it } from 'vitest'
import { extensionOf, looksBinary, sniffKind } from './fileKind'

describe('looksBinary', () => {
  it('flags content with NUL bytes, such as a PNG header', () => {
    expect(looksBinary('�PNG\r\n\u001a\n\u0000\u0000\u0000\rIHDR')).toBe(true)
  })
  it('accepts ordinary text, including Thai and emoji', () => {
    expect(looksBinary('# หัวข้อ\n\nhello 👋')).toBe(false)
    expect(looksBinary('')).toBe(false)
  })
})

describe('extensionOf', () => {
  it('lowercases the extension', () => expect(extensionOf('A.JSON')).toBe('json'))
  it('returns empty when there is no dot', () => expect(extensionOf('README')).toBe(''))
})

describe('sniffKind', () => {
  it('detects valid JSON objects and arrays', () => {
    expect(sniffKind('{"a":1}')).toBe('json')
    expect(sniffKind('﻿ [1,2]')).toBe('json')
  })
  it('falls back to markdown for invalid JSON or prose', () => {
    expect(sniffKind('{oops')).toBe('markdown')
    expect(sniffKind('# Title')).toBe('markdown')
  })
})
