import { describe, expect, it } from 'vitest'
import { computeStats } from './textStats'

describe('computeStats', () => {
  it('returns zeros for empty text', () => {
    expect(computeStats('')).toEqual({ chars: 0, words: 0, minutes: 0 })
  })

  it('counts words and characters', () => {
    const s = computeStats('hello brave new world')
    expect(s.words).toBe(4)
    expect(s.chars).toBe(21)
  })

  it('rounds reading time up to at least one minute', () => {
    expect(computeStats('one two three').minutes).toBe(1)
    expect(computeStats(Array(401).fill('w').join(' ')).minutes).toBe(3)
  })

  it('counts Thai text as words rather than one token', () => {
    expect(computeStats('สวัสดีครับ ผมชื่อเนโกะ').words).toBeGreaterThan(2)
  })
})
