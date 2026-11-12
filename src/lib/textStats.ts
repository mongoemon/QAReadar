export interface TextStats {
  readonly chars: number
  readonly words: number
  readonly minutes: number
}

const WORDS_PER_MINUTE = 200

const segmenter: Intl.Segmenter | null =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'word' })
    : null

function countWords(text: string): number {
  if (text.trim() === '') return 0
  if (segmenter === null) return text.trim().split(/\s+/).length
  let count = 0
  for (const part of segmenter.segment(text)) {
    if (part.isWordLike) count++
  }
  return count
}

/** Character, word and estimated reading-time figures for the status bar. */
export function computeStats(text: string): TextStats {
  const words = countWords(text)
  return {
    chars: Array.from(text).length,
    words,
    minutes: words === 0 ? 0 : Math.max(1, Math.ceil(words / WORDS_PER_MINUTE)),
  }
}
