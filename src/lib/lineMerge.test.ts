import { describe, expect, it } from 'vitest'
import {
  applyToChanges,
  carryChoices,
  defaultChoices,
  diffLines,
  fitChoice,
  innerDiff,
  mergeStats,
  mergeText,
  splitLines,
  type Choice,
} from './lineMerge'

const MANUAL = ['Scenario: login', 'Given I open the login page', 'When I type a valid password', 'Then I see the dashboard', ''].join('\n')
const AUTOMATE = ['Scenario: login', 'Given I open the login page', 'When I enter valid credentials', 'And I click Login', 'Then I see the dashboard', ''].join('\n')

describe('splitLines', () => {
  it('detects the line ending and trailing newline', () => {
    expect(splitLines('a\r\nb\r\n')).toEqual({ lines: ['a', 'b'], eol: '\r\n', trailingNewline: true })
    expect(splitLines('a\nb')).toEqual({ lines: ['a', 'b'], eol: '\n', trailingNewline: false })
    expect(splitLines('')).toEqual({ lines: [], eol: null, trailingNewline: false })
  })
})

describe('diffLines', () => {
  it('pairs changed lines and keeps common lines as same rows', () => {
    const diff = diffLines(MANUAL, AUTOMATE)
    expect(diff.blocks).toBe(1)
    expect(diff.rows.map((r) => [r.kind, r.left, r.right])).toEqual([
      ['same', 'Scenario: login', 'Scenario: login'],
      ['same', 'Given I open the login page', 'Given I open the login page'],
      ['change', 'When I type a valid password', 'When I enter valid credentials'],
      ['change', null, 'And I click Login'],
      ['same', 'Then I see the dashboard', 'Then I see the dashboard'],
    ])
    expect(diff.rows[3]).toMatchObject({ leftNo: null, rightNo: 4 })
    expect(diff.rows[4]).toMatchObject({ leftNo: 4, rightNo: 5 })
  })

  it('reports identical texts as all same rows', () => {
    const diff = diffLines('a\nb', 'a\nb')
    expect(diff.blocks).toBe(0)
    expect(diff.rows.every((r) => r.kind === 'same')).toBe(true)
  })

  it('handles one empty side', () => {
    const diff = diffLines('', 'x\ny\n')
    expect(diff.rows.map((r) => [r.left, r.right])).toEqual([[null, 'x'], [null, 'y']])
    expect(diff.trailingNewline).toBe(true)
  })

  it('separates distinct change blocks', () => {
    const diff = diffLines('a\nb\nc\nd\ne', 'a\nB\nc\nd\nE')
    expect(diff.blocks).toBe(2)
    expect(diff.rows.filter((r) => r.kind === 'change').map((r) => r.block)).toEqual([0, 1])
  })

  it('can ignore whitespace differences', () => {
    expect(diffLines('  Given  x', 'Given x').blocks).toBe(1)
    expect(diffLines('  Given  x', 'Given x', { ignoreWhitespace: true }).blocks).toBe(0)
  })

  it('finds a minimal diff for reordered and interleaved lines', () => {
    const diff = diffLines('a\nb\nc\na\nb\nb\na', 'c\nb\na\nb\na\nc')
    // Classic Myers example: edit distance 5 → 4 common lines.
    expect(diff.rows.filter((r) => r.kind === 'same')).toHaveLength(4)
  })

  it('survives large, completely different inputs', () => {
    const a = Array.from({ length: 6000 }, (_, i) => `a${i}`).join('\n')
    const b = Array.from({ length: 6000 }, (_, i) => `b${i}`).join('\n')
    const diff = diffLines(a, b)
    expect(diff.rows).toHaveLength(6000)
    expect(diff.blocks).toBe(1)
  })
})

describe('choices and merge', () => {
  const diff = diffLines(MANUAL, AUTOMATE)

  it('keeps everything by default', () => {
    expect(mergeText(diff, defaultChoices(diff.rows))).toBe(
      ['Scenario: login', 'Given I open the login page', 'When I type a valid password', 'When I enter valid credentials', 'And I click Login', 'Then I see the dashboard', ''].join('\n'),
    )
  })

  it('takes the whole Manual or Automate side', () => {
    const base = defaultChoices(diff.rows)
    expect(mergeText(diff, applyToChanges(diff.rows, base, 'left'))).toBe(MANUAL)
    expect(mergeText(diff, applyToChanges(diff.rows, base, 'right'))).toBe(AUTOMATE)
  })

  it('drops both sides of a change with none', () => {
    const choices = applyToChanges(diff.rows, defaultChoices(diff.rows), 'none')
    expect(mergeText(diff, choices)).toBe('Scenario: login\nGiven I open the login page\nThen I see the dashboard\n')
  })

  it('mixes picks per line and can drop common lines', () => {
    const choices: Choice[] = ['none', 'both', 'right', 'none', 'both']
    expect(mergeText(diff, choices)).toBe('Given I open the login page\nWhen I enter valid credentials\nThen I see the dashboard\n')
  })

  it('fits a choice to what the row has', () => {
    const rightOnly = diff.rows[3]
    expect(fitChoice(rightOnly, 'left')).toBe('none')
    expect(fitChoice(rightOnly, 'both')).toBe('right')
    expect(fitChoice(diff.rows[0], 'left')).toBe('both')
  })

  it('preserves the Manual line ending', () => {
    const crlf = diffLines('a\r\nb\r\n', 'a\nc\n')
    expect(mergeText(crlf, applyToChanges(crlf.rows, defaultChoices(crlf.rows), 'right'))).toBe('a\r\nc\r\n')
  })

  it('uses an explicit line ending when given', () => {
    const lf = diffLines('a\nb\n', 'a\nc\n', { eol: '\r\n' })
    expect(mergeText(lf, defaultChoices(lf.rows))).toBe('a\r\nb\r\nc\r\n')
  })

  it('applies a pick to a single block only', () => {
    const two = diffLines('a\nb\nc\nd', 'A\nb\nc\nD')
    const choices = applyToChanges(two.rows, defaultChoices(two.rows), 'right', 1)
    expect(mergeText(two, choices)).toBe('a\nA\nb\nc\nD')
  })

  it('counts picks', () => {
    const choices: Choice[] = ['both', 'both', 'left', 'none', 'both']
    expect(mergeStats(diff.rows, choices)).toEqual({ changes: 2, manual: 1, automate: 0, both: 0, none: 1 })
  })

  it('carries picks across a re-diff', () => {
    const choices = applyToChanges(diff.rows, defaultChoices(diff.rows), 'right')
    const edited = diffLines(MANUAL.replace('Scenario: login', 'Scenario: sign in'), AUTOMATE)
    const carried = carryChoices(diff.rows, choices, edited.rows)
    const row = edited.rows.findIndex((r) => r.right === 'And I click Login')
    expect(carried[row]).toBe('right')
  })
})

describe('innerDiff', () => {
  it('measures the common prefix and suffix', () => {
    expect(innerDiff('When I type a password', 'When I enter a password')).toEqual({ prefix: 7, suffix: 11 })
    expect(innerDiff('abc', 'abc')).toEqual({ prefix: 3, suffix: 0 })
  })
})
