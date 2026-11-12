/**
 * Maps a cursor position in pasted HTML source to an element of the rendered preview.
 *
 * A browser does not tell us which source characters produced which element, so every start tag
 * is stamped with its own source offset (`data-mdr-o`) before the preview is built, and the
 * cursor is resolved to such an offset here. The stamp is added at parse time (the DOM is never
 * mutated afterwards) and no locator reads it.
 *
 * Preview -> source is exact: it uses the browser's own tree, so it holds even where the parser adds
 * or moves elements (implied <tbody>, omitted end tags, …). Source -> preview is a heuristic: the
 * open-element stack below does not model implied end tags, so text after an element the parser
 * closed implicitly (`<p>a<p>b</p>c`) can resolve to the wrong ancestor.
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

// HTML whitespace is only tab, LF, FF, CR and space: \s would also split at NBSP and friends,
// which the parser keeps inside a tag name.
const NAME = /[A-Za-z][^\t\n\f\r />]*/y
const HTML_SPACE = /[\t\n\f\r ]/
const COMMENT_CLOSE = /--!?>/g
const FOREIGN_ROOTS = new Set(['svg', 'math'])
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
      while (k < source.length && HTML_SPACE.test(source[k])) k++
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

/** Offset just after the comment that starts at `lt`, including the degenerate `<!-->` and `<!--->`. */
function commentEnd(source: string, lt: number): number {
  if (source.startsWith('<!-->', lt)) return lt + 5
  if (source.startsWith('<!--->', lt)) return lt + 6
  COMMENT_CLOSE.lastIndex = lt + 4
  const close = COMMENT_CLOSE.exec(source)
  return close ? close.index + close[0].length : source.length
}

function scan(source: string): Tag[] {
  const tags: Tag[] = []
  let foreignDepth = 0
  let i = 0
  while (i < source.length) {
    const lt = source.indexOf('<', i)
    if (lt < 0) break
    if (source.startsWith('<!--', lt)) {
      i = commentEnd(source, lt)
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
    // The parser only honours `/>` on SVG/MathML elements; on `<div/>` the element stays open.
    const foreign = foreignDepth > 0 || (!isEnd && FOREIGN_ROOTS.has(name))
    const selfClosing = !isEnd && foreign && source[end - 1] === '>' && source[end - 2] === '/'
    tags.push({ kind: isEnd ? 'end' : 'start', name, start: lt, nameEnd, end, selfClosing })
    if (FOREIGN_ROOTS.has(name)) foreignDepth = isEnd ? Math.max(0, foreignDepth - 1) : foreignDepth + (selfClosing ? 0 : 1)
    i = !isEnd && RAW_TEXT.has(name) ? rawTextEnd(source, name, end) : end
  }
  return tags
}

// The same source is tokenized on every click and key press; it only changes when the preview is rebuilt.
let cached: { readonly source: string; readonly tags: Tag[] } | null = null
function tokenize(source: string): Tag[] {
  if (cached?.source !== source) cached = { source, tags: scan(source) }
  return cached.tags
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
  // How many open elements carry each name: an end tag with no open match is then O(1), and a
  // matching one only walks the elements it closes. (Rescanning the stack made unclosed <li>/<p>
  // markup quadratic.)
  const openCount = new Map<string, number>()
  const indexOfOpen = (name: string): number => {
    if (!openCount.get(name)) return -1
    let index = open.length - 1
    while (open[index].name !== name) index--
    return index
  }
  const closeDownTo = (index: number): void => {
    while (open.length > index) {
      const closed = open.pop() as Tag
      openCount.set(closed.name, (openCount.get(closed.name) ?? 1) - 1)
    }
  }
  for (const tag of tokenize(source)) {
    if (offset < tag.start) break
    const inside = offset < tag.end
    if (tag.kind === 'start') {
      if (inside) return tag.start
      if (!isVoid(tag)) {
        open.push(tag)
        openCount.set(tag.name, (openCount.get(tag.name) ?? 0) + 1)
      }
      continue
    }
    const index = indexOfOpen(tag.name)
    if (inside) return index >= 0 ? open[index].start : null
    if (index >= 0) closeDownTo(index)
  }
  return open.length > 0 ? open[open.length - 1].start : null
}
