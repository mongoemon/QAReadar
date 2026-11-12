export type WidthPref = 'narrow' | 'normal' | 'wide'

export const FONT_MIN = 13
export const FONT_MAX = 24
export const FONT_DEFAULT = 17

export const WIDTH_CH: Readonly<Record<WidthPref, string>> = {
  narrow: '60ch',
  normal: '80ch',
  wide: '110ch',
}

const WIDTH_ORDER: readonly WidthPref[] = ['narrow', 'normal', 'wide']

export const isWidthPref = (v: unknown): v is WidthPref => WIDTH_ORDER.includes(v as WidthPref)

export const stepFontSize = (current: number, delta: number): number =>
  Math.max(FONT_MIN, Math.min(FONT_MAX, current + delta))

export const cycleWidth = (current: WidthPref): WidthPref =>
  WIDTH_ORDER[(WIDTH_ORDER.indexOf(current) + 1) % WIDTH_ORDER.length]
