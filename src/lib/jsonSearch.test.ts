import { describe, expect, it } from 'vitest'
import { flattenJson } from './jsonPath'
import { searchNodes } from './jsonSearch'

const flat = flattenJson({ name: 'Neko', nick: 'neko-chan', meta: { name2: 42 } })
const paths = (r: ReturnType<typeof searchNodes>): string[] =>
  r.ok ? r.nodes.map((n) => n.path) : []

describe('searchNodes', () => {
  it('matches path or value in "all" scope, case-insensitively', () => {
    expect(paths(searchNodes(flat, 'NEKO', { regex: false, scope: 'all' }))).toEqual([
      '$.name',
      '$.nick',
    ])
  })

  it('limits matching to keys', () => {
    expect(paths(searchNodes(flat, 'name', { regex: false, scope: 'key' }))).toEqual([
      '$.name',
      '$.meta.name2',
    ])
  })

  it('limits matching to primitive values', () => {
    expect(paths(searchNodes(flat, '42', { regex: false, scope: 'value' }))).toEqual([
      '$.meta.name2',
    ])
    expect(paths(searchNodes(flat, 'Object', { regex: false, scope: 'value' }))).toEqual([])
  })

  it('supports regex and reports invalid patterns', () => {
    expect(paths(searchNodes(flat, '^"n', { regex: true, scope: 'value' }))).toEqual([
      '$.name',
      '$.nick',
    ])
    expect(searchNodes(flat, '(', { regex: true, scope: 'all' }).ok).toBe(false)
  })
})
