import { describe, expect, it } from 'vitest'
import { extensionOf, sniffKind } from './fileKind'

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
