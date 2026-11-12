export type ThemePref = 'auto' | 'light' | 'dark'

const ORDER: readonly ThemePref[] = ['auto', 'light', 'dark']

export const isThemePref = (v: unknown): v is ThemePref => ORDER.includes(v as ThemePref)

export const nextTheme = (pref: ThemePref): ThemePref =>
  ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length]

export const resolveDark = (pref: ThemePref, systemDark: boolean): boolean =>
  pref === 'auto' ? systemDark : pref === 'dark'
