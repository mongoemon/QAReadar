import { describe, expect, it } from 'vitest'
import { pathAtOffset, resolvePath } from './jsonCursor'

const text = '{"users": [{"name": "Ann", "age": 3}, {"name": "Bob"}], "ok": true}'

describe('pathAtOffset', () => {
  it('finds a nested string value', () => {
    expect(pathAtOffset(text, text.indexOf('Ann') + 1)).toEqual(['users', 0, 'name'])
  })

  it('finds a key', () => {
    expect(pathAtOffset(text, text.indexOf('age') + 1)).toEqual(['users', 0, 'age'])
  })

  it('finds array elements by index', () => {
    expect(pathAtOffset(text, text.indexOf('Bob'))).toEqual(['users', 1, 'name'])
  })

  it('finds literals', () => {
    expect(pathAtOffset(text, text.indexOf('true') + 1)).toEqual(['ok'])
  })

  it('returns the container path on whitespace inside it', () => {
    expect(pathAtOffset(text, text.indexOf('}, {') + 2)).toEqual(['users'])
  })

  it('returns root for a top-level scalar', () => {
    expect(pathAtOffset('42', 1)).toEqual([])
  })

  it('returns null outside any value', () => {
    expect(pathAtOffset('  {"a":1}  ', 0)).toBeNull()
  })
})

describe('resolvePath', () => {
  it('resolves existing paths and fails on missing ones', () => {
    const root = { a: [{ b: 1 }] }
    expect(resolvePath(root, ['a', 0, 'b'])).toEqual({ ok: true, value: 1 })
    expect(resolvePath(root, ['a', 1])).toEqual({ ok: false })
  })
})
