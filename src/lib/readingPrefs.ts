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

/** Source view split: share of the width (%) given to the markdown side; the preview gets the rest. */
export const SPLIT_DEFAULT = 50
export const SPLIT_MIN = 20
export const SPLIT_MAX = 80

/** Clamps a split percentage to the allowed range; anything unparsable falls back to the default. */
export const clampSplit = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value))
  if (!Number.isFinite(n)) return SPLIT_DEFAULT
  return Math.round(Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, n)) * 10) / 10
}

export const cycleWidth = (current: WidthPref): WidthPref =>
  WIDTH_ORDER[(WIDTH_ORDER.indexOf(current) + 1) % WIDTH_ORDER.length]
