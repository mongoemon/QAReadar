import { describe, expect, it } from 'vitest'
import { MARKER_ATTR, annotateSource, elementMarkerAt, startTagRange } from './sourceMap'

/** Offset of the first occurrence of `needle` (plus `shift`) in `source`. */
const at = (source: string, needle: string, shift = 0): number => {
  const index = source.indexOf(needle)
  if (index < 0) throw new Error(`fixture is missing ${needle}`)
  return index + shift
}

/** The marker value is the offset where the element's start tag begins. */
const startOf = (source: string, needle: string): number => at(source, needle)

describe('annotateSource', () => {
  it('adds a marker holding the start-tag offset after each tag name', () => {
    expect(annotateSource('<div class="a">x</div>')).toBe(`<div ${MARKER_ATTR}="0" class="a">x</div>`)
  })

  it('works for void and self-closing tags', () => {
    expect(annotateSource('<br><img src=a />')).toBe(
      `<br ${MARKER_ATTR}="0"><img ${MARKER_ATTR}="4" src=a />`,
    )
  })

  it('does not touch end tags, comments, doctype, or tag-like text inside script/style', () => {
    const source = '<!doctype html><!-- <b> --><script>var a = "<i>"</script><style>a<b{}</style><p>1 < 2</p>'
    const out = annotateSource(source)
    expect(out.match(new RegExp(MARKER_ATTR, 'g'))).toHaveLength(3)
    expect(out).toContain(`<script ${MARKER_ATTR}=`)
    expect(out).toContain(`<style ${MARKER_ATTR}=`)
    expect(out).toContain(`<p ${MARKER_ATTR}=`)
    expect(out).toContain('<!-- <b> -->')
    expect(out).toContain('var a = "<i>"')
  })

  it('does not split a tag name at a non-breaking space (the parser keeps it in the name)', () => {
    expect(annotateSource('<div class="x">t</div>')).toBe(`<div class="x" ${MARKER_ATTR}="0">t</div>`)
  })

  it('recognises the degenerate comments <!--> and <!--->', () => {
    expect(annotateSource('<!--><b>x</b>')).toBe(`<!--><b ${MARKER_ATTR}="5">x</b>`)
    expect(annotateSource('<!---><b>x</b>')).toBe(`<!---><b ${MARKER_ATTR}="6">x</b>`)
  })

  it('ends a comment at --!> as well as -->', () => {
    expect(annotateSource('<!-- a --!><b>x</b>')).toBe(`<!-- a --!><b ${MARKER_ATTR}="11">x</b>`)
  })

  it('is not fooled by > inside a quoted attribute value', () => {
    const out = annotateSource('<a title="a>b" href="x">t</a>')
    expect(out.match(new RegExp(MARKER_ATTR, 'g'))).toHaveLength(1)
    expect(out).toBe(`<a ${MARKER_ATTR}="0" title="a>b" href="x">t</a>`)
  })
})

describe('startTagRange', () => {
  it('spans the whole start tag, attributes included', () => {
    const source = '<div><button class="go" title="a>b">Go</button></div>'
    const start = source.indexOf('<button')
    const end = source.indexOf('>Go') + 1
    expect(startTagRange(source, start)).toEqual({ start, end })
  })

  it('works for void elements', () => {
    const source = '<p>a<br>b</p>'
    expect(startTagRange(source, 4)).toEqual({ start: 4, end: 8 })
  })

  it('returns null when no start tag begins at the offset', () => {
    expect(startTagRange('<p>x</p>', 1)).toBeNull()
    expect(startTagRange('<p>x</p>', 4)).toBeNull()
  })

  it('round-trips with elementMarkerAt', () => {
    const source = '<ul><li>a</li><li class="b">b</li></ul>'
    const marker = elementMarkerAt(source, source.indexOf('b</li>'))
    expect(marker).not.toBeNull()
    const range = startTagRange(source, marker ?? -1)
    expect(source.slice(range?.start, range?.end)).toBe('<li class="b">')
  })
})

describe('elementMarkerAt', () => {
  it('returns the element when the cursor is inside its start tag', () => {
    const source = '<div><button class="go">Go</button></div>'
    expect(elementMarkerAt(source, at(source, 'class'))).toBe(startOf(source, '<button'))
    expect(elementMarkerAt(source, at(source, '<button'))).toBe(startOf(source, '<button'))
  })

  it('returns the enclosing element for text', () => {
    const source = '<div><button>Go</button></div>'
    expect(elementMarkerAt(source, at(source, 'Go', 1))).toBe(startOf(source, '<button'))
  })

  it('treats a cursor right after the start tag as inside the element', () => {
    const source = '<p>hello</p>'
    expect(elementMarkerAt(source, at(source, 'hello'))).toBe(0)
  })

  it('treats a cursor right before the end tag as inside the element', () => {
    const source = '<p>hello</p>'
    expect(elementMarkerAt(source, at(source, '</p>'))).toBe(0)
  })

  it('returns the matching start for a cursor inside an end tag', () => {
    const source = '<div><span>a</span> b</div>'
    expect(elementMarkerAt(source, at(source, '</span>', 3))).toBe(startOf(source, '<span'))
  })

  it('returns the parent for text that follows a closed child', () => {
    const source = '<div><span>a</span> after</div>'
    expect(elementMarkerAt(source, at(source, 'after'))).toBe(0)
  })

  it('returns the parent for text that follows a void element', () => {
    const source = '<p>a<br>b</p>'
    expect(elementMarkerAt(source, at(source, 'b</p>'))).toBe(0)
  })

  it('picks the right sibling', () => {
    const source = '<ul><li>a</li><li>b</li></ul>'
    expect(elementMarkerAt(source, at(source, 'b</li>'))).toBe(startOf(source, '<li>b'))
  })

  it('handles elements whose end tag is omitted', () => {
    const source = '<ul><li>a<li>b</ul>'
    expect(elementMarkerAt(source, at(source, 'b</ul>'))).toBe(startOf(source, '<li>b'))
  })

  it('maps text inside script content to the script element', () => {
    const source = '<body><script>var x = "<b>"</script></body>'
    expect(elementMarkerAt(source, at(source, 'var'))).toBe(startOf(source, '<script'))
  })

  it('ignores a < that does not start a tag', () => {
    const source = '<p>1 < 2 and 3</p>'
    expect(elementMarkerAt(source, at(source, 'and'))).toBe(0)
  })

  it('is not fooled by > inside a quoted attribute value', () => {
    const source = '<a title="a>b" href="x">t</a>'
    expect(elementMarkerAt(source, at(source, 'href'))).toBe(0)
  })

  it('ignores the self-closing slash on ordinary HTML elements, as the parser does', () => {
    const source = '<div/>text'
    expect(elementMarkerAt(source, at(source, 'text'))).toBe(0)
  })

  it('honours the self-closing slash inside svg', () => {
    const source = '<svg><circle/>t</svg>'
    expect(elementMarkerAt(source, at(source, 't</svg>'))).toBe(0)
  })

  it('does not let an end tag with no open match disturb the stack', () => {
    const source = '<p>a</i>b</p>'
    expect(elementMarkerAt(source, at(source, 'b</p>'))).toBe(0)
  })

  it('stays fast on deep markup with many unmatched end tags', () => {
    const source = '<li>item<p>para</i></b>'.repeat(20_000)
    const started = performance.now()
    elementMarkerAt(source, source.length - 1)
    startTagRange(source, 0)
    expect(performance.now() - started).toBeLessThan(1500)
  })

  it('returns null outside any element', () => {
    expect(elementMarkerAt('just text', 3)).toBeNull()
    expect(elementMarkerAt('<p>x</p> tail', 10)).toBeNull()
    expect(elementMarkerAt('', 0)).toBeNull()
  })
})
