import { describe, expect, it } from 'vitest'
import { detectLang, format, LANGS, MESSAGES, nextLang } from './i18n'

const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('message catalogs', () => {
  const enKeys = Object.keys(MESSAGES.en).sort()

  it.each(LANGS)('%s has exactly the English keys', (lang) => {
    expect(Object.keys(MESSAGES[lang]).sort()).toEqual(enKeys)
  })

  it.each(LANGS)('%s has no empty messages', (lang) => {
    const empty = Object.entries(MESSAGES[lang]).filter(([, v]) => v.trim() === '')
    expect(empty).toEqual([])
  })

  it.each(LANGS)('%s uses the same placeholders as English', (lang) => {
    const mismatched = enKeys.filter((key) => {
      const k = key as keyof typeof MESSAGES.en
      return placeholders(MESSAGES[lang][k]).join() !== placeholders(MESSAGES.en[k]).join()
    })
    expect(mismatched).toEqual([])
  })
})

describe('detectLang', () => {
  it('prefers a valid stored choice', () => {
    expect(detectLang('th', ['en-US'])).toBe('th')
  })

  it('ignores an invalid stored value and falls back to the browser languages', () => {
    expect(detectLang('xx', ['fr-FR', 'th-TH'])).toBe('th')
  })

  it('defaults to English', () => {
    expect(detectLang(null, ['ja-JP'])).toBe('en')
    expect(detectLang(null, [])).toBe('en')
  })
})

describe('format', () => {
  it('fills named placeholders', () => {
    expect(format('{n} of {total}', { n: 2, total: 5 })).toBe('2 of 5')
  })

  it('leaves unknown placeholders untouched', () => {
    expect(format('Hello {name}', {})).toBe('Hello {name}')
  })
})

describe('nextLang', () => {
  it('cycles through every language', () => {
    expect(nextLang('en')).toBe('th')
    expect(nextLang('th')).toBe('en')
  })
})
