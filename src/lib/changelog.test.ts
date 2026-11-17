import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CHANGELOG } from './changelog'

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }

describe('CHANGELOG', () => {
  it('starts with the version in package.json (add an entry when bumping)', () => {
    expect(CHANGELOG[0]?.version).toBe(pkg.version)
  })
  it('has unique versions, valid dates, and newest first', () => {
    const versions = CHANGELOG.map((r) => r.version)
    expect(new Set(versions).size).toBe(versions.length)
    for (const r of CHANGELOG) expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const dates = CHANGELOG.map((r) => r.date)
    expect([...dates].sort().reverse()).toEqual(dates)
  })
  it('gives every release at least one note', () => {
    for (const r of CHANGELOG) {
      expect((r.added?.length ?? 0) + (r.changed?.length ?? 0) + (r.fixed?.length ?? 0)).toBeGreaterThan(0)
    }
  })
})
