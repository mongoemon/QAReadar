import { readStored, writeStored } from '../safeStorage'
import { en, type MessageKey } from './en'
import { th } from './th'

export type { MessageKey }

/**
 * UI localization (English / Thai). Technical terms — JSONPath, locator syntaxes, framework
 * names — stay in English in both languages on purpose: that is what testers search for.
 *
 * Language switches live: components register their text with `localized()` and it re-runs
 * on every change, so nothing typed into the app is lost by switching.
 */
export type Lang = 'en' | 'th'

export const LANGS: readonly Lang[] = ['en', 'th']
export const LANG_NAMES: Readonly<Record<Lang, string>> = { en: 'English', th: 'ไทย' }

const LANG_KEY = 'qareadar:lang'

export const MESSAGES: Readonly<Record<Lang, Readonly<Record<MessageKey, string>>>> = { en, th }

export const isLang = (value: unknown): value is Lang => LANGS.includes(value as Lang)

/** Stored choice first, then the browser's preferred languages, then English. */
export function detectLang(stored: string | null, preferred: readonly string[]): Lang {
  if (isLang(stored)) return stored
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0]
    if (isLang(base)) return base
  }
  return 'en'
}

export type Vars = Readonly<Record<string, string | number>>

export function format(template: string, vars: Vars = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole))
}

const browserLangs = (): readonly string[] =>
  typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language ?? '']

let current: Lang = detectLang(readStored(LANG_KEY), browserLangs())
const listeners = new Set<() => void>()

export const getLang = (): Lang => current

export function t(key: MessageKey, vars?: Vars): string {
  return format(MESSAGES[current][key] ?? en[key], vars)
}

export function setLang(lang: Lang): void {
  if (lang === current) return
  current = lang
  writeStored(LANG_KEY, lang)
  if (typeof document !== 'undefined') document.documentElement.lang = lang
  for (const listener of [...listeners]) listener()
}

export const nextLang = (lang: Lang): Lang => LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length]

/** Run `update` now and again after every language change. For long-lived UI only. */
export function localized(update: () => void): () => void {
  update()
  listeners.add(update)
  return () => listeners.delete(update)
}

if (typeof document !== 'undefined') document.documentElement.lang = current
