export interface Heading {
  readonly level: number
  readonly text: string
  /** 1-based line number in the source markdown. */
  readonly line: number
}

const ATX = /^(#{1,6})[ \t]+(.+?)[ \t]*$/
const FENCE = /^ {0,3}(`{3,}|~{3,})/

function cleanHeading(raw: string): string {
  return raw
    .replace(/[ \t]+#+$/, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*]/g, '')
    .trim()
}

/** Lists ATX headings, ignoring anything inside fenced code blocks. */
export function extractHeadings(markdown: string): Heading[] {
  const headings: Heading[] = []
  let fence: { char: string; length: number } | null = null

  markdown.split(/\r?\n/).forEach((line, index) => {
    const fenceMatch = FENCE.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (fence === null) {
        fence = { char: marker[0], length: marker.length }
      } else if (marker[0] === fence.char && marker.length >= fence.length) {
        fence = null
      }
      return
    }
    if (fence !== null) return

    const match = ATX.exec(line)
    if (!match) return
    const text = cleanHeading(match[2])
    if (text === '') return
    headings.push({ level: match[1].length, text, line: index + 1 })
  })

  return headings
}
