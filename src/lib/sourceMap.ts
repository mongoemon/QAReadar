/**
 * Maps a cursor position in pasted HTML source to an element of the rendered preview.
 *
 * A browser does not tell us which source characters produced which element, so every start tag
 * is stamped with its own source offset (`data-mdr-o`) before the preview is built, and the
 * cursor is resolved to such an offset here. The stamp is added at parse time (the DOM is never
 * mutated afterwards) and no locator reads it. Using the browser's own tree keeps the mapping
 * exact even where the parser adds or moves elements (implied <tbody>, omitted end tags, …).
 */

export const MARKER_ATTR = 'data-mdr-o'

interface Tag {
  readonly kind: 'start' | 'end'
  readonly name: string
  /** Offset of `<`. */
  readonly start: number
  /** Offset just after the tag name (where an attribute can be inserted). */
  readonly nameEnd: number
  /** Offset just after `>`. */
  readonly end: number
  readonly selfClosing: boolean
}

const NAME = /[A-Za-z][^\s/>]*/y
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes'])
const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
])

const skipPast = (source: string, token: string, from: number): number => {
  const at = source.indexOf(token, from)
  return at < 0 ? source.length : at + token.length
}

/** Offset just after the `>` that closes the tag, ignoring `>` inside quoted attribute values. */
function tagEnd(source: string, from: number): number {
  let i = from
  while (i < source.length) {
    if (source[i] === '>') return i + 1
    if (source[i] === '=') {
      let k = i + 1
      while (k < source.length && /\s/.test(source[k])) k++
      const quote = source[k]
      if (quote === '"' || quote === "'") {
        const close = source.indexOf(quote, k + 1)
        if (close < 0) return source.length
        i = close + 1
        continue
      }
    }
    i++
  }
  return source.length
}

/** Where the raw text of <script>/<style>/… ends: at the matching end tag. */
function rawTextEnd(source: string, name: string, from: number): number {
  const closing = new RegExp(`</${name}(?=[\\s/>])`, 'gi')
  closing.lastIndex = from
  const found = closing.exec(source)
  return found ? found.index : source.length
}

function tokenize(source: string): Tag[] {
  const tags: Tag[] = []
  let i = 0
  while (i < source.length) {
    const lt = source.indexOf('<', i)
    if (lt < 0) break
    if (source.startsWith('<!--', lt)) {
      i = skipPast(source, '-->', lt + 4)
      continue
    }
    const next = source[lt + 1]
    if (next === '!' || next === '?') {
      i = skipPast(source, '>', lt + 2)
      continue
    }
    const isEnd = next === '/'
    NAME.lastIndex = lt + (isEnd ? 2 : 1)
    const found = NAME.exec(source)
    if (!found) {
      i = lt + 1
      continue
    }
    const nameEnd = NAME.lastIndex
    const end = tagEnd(source, nameEnd)
    const name = found[0].toLowerCase()
    const selfClosing = source[end - 1] === '>' && source[end - 2] === '/'
    tags.push({ kind: isEnd ? 'end' : 'start', name, start: lt, nameEnd, end, selfClosing })
    i = !isEnd && RAW_TEXT.has(name) ? rawTextEnd(source, name, end) : end
  }
  return tags
}

const isVoid = (tag: Tag): boolean => VOID.has(tag.name) || tag.selfClosing

/** The source with ` data-mdr-o="<offset>"` added to every start tag. */
export function annotateSource(source: string): string {
  const parts: string[] = []
  let copied = 0
  for (const tag of tokenize(source)) {
    if (tag.kind !== 'start') continue
    parts.push(source.slice(copied, tag.nameEnd), ` ${MARKER_ATTR}="${tag.start}"`)
    copied = tag.nameEnd
  }
  parts.push(source.slice(copied))
  return parts.join('')
}

/** Source range of the start tag stamped with `marker` — the inverse of elementMarkerAt. */
export function startTagRange(source: string, marker: number): { start: number; end: number } | null {
  const tag = tokenize(source).find((t) => t.kind === 'start' && t.start === marker)
  return tag ? { start: tag.start, end: tag.end } : null
}

/**
 * The marker (start-tag offset) of the element at `offset`: the element whose tag the cursor is in,
 * or the innermost element still open there when the cursor is in text. Null outside any element.
 */
export function elementMarkerAt(source: string, offset: number): number | null {
  const open: Tag[] = []
  for (const tag of tokenize(source)) {
    if (offset < tag.start) break
    const inside = offset < tag.end
    if (tag.kind === 'start') {
      if (inside) return tag.start
      if (!isVoid(tag)) open.push(tag)
      continue
    }
    const index = open.map((t) => t.name).lastIndexOf(tag.name)
    if (inside) return index >= 0 ? open[index].start : null
    if (index >= 0) open.length = index
  }
  return open.length > 0 ? open[open.length - 1].start : null
}
