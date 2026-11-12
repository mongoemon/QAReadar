import { describe, expect, it } from 'vitest'
import { queryJsonPath } from './jsonQuery'

const data = {
  users: [
    { id: 1, name: 'a', tags: ['x', 'y'] },
    { id: 2, name: 'b', tags: [] },
    { id: 3, name: 'c', tags: ['z'] },
  ],
  'odd key': { 'it\'s': true },
}

const values = (path: string): unknown[] => {
  const r = queryJsonPath(data, path)
  if (!r.ok) throw new Error(r.error)
  return r.hits.map((h) => h.value)
}

describe('queryJsonPath', () => {
  it('returns the root for $', () => {
    expect(values('$')).toEqual([data])
  })

  it('walks dot and index segments', () => {
    expect(values('$.users[0].name')).toEqual(['a'])
  })

  it('supports negative indexes', () => {
    expect(values('$.users[-1].id')).toEqual([3])
  })

  it('supports wildcards on arrays and objects', () => {
    expect(values('$.users[*].id')).toEqual([1, 2, 3])
    expect(values('$.users[0].*')).toEqual([1, 'a', ['x', 'y']])
  })

  it('supports recursive descent', () => {
    expect(values('$..id')).toEqual([1, 2, 3])
    expect(values('$..tags[*]')).toEqual(['x', 'y', 'z'])
  })

  it('supports unions and slices', () => {
    expect(values('$.users[0,2].id')).toEqual([1, 3])
    expect(values('$.users[1:3].id')).toEqual([2, 3])
    expect(values('$.users[:2].id')).toEqual([1, 2])
  })

  it('supports quoted keys including escaped quotes', () => {
    expect(values("$['odd key']['it\\'s']")).toEqual([true])
    expect(values('$["odd key"]')).toEqual([data['odd key']])
  })

  it('records the segments of every hit', () => {
    const r = queryJsonPath(data, '$.users[1].name')
    expect(r.ok && r.hits[0].segments).toEqual(['users', 1, 'name'])
  })

  it('returns an empty list when nothing matches', () => {
    expect(values('$.missing.deep')).toEqual([])
    expect(values('$.users[9]')).toEqual([])
  })

  it('reports syntax errors instead of throwing', () => {
    expect(queryJsonPath(data, 'users').ok).toBe(false)
    expect(queryJsonPath(data, '$.users[').ok).toBe(false)
    expect(queryJsonPath(data, '$.users[?(@.id>1)]').ok).toBe(false)
    expect(queryJsonPath(data, '$.').ok).toBe(false)
  })

  it('ignores prototype properties', () => {
    expect(values('$.constructor')).toEqual([])
  })
})
