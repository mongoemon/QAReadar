import { describe, expect, it } from 'vitest'
import { extractHeadings } from './outline'

describe('extractHeadings', () => {
  it('returns level, text and 1-based line for ATX headings', () => {
    const md = '# Title\n\ntext\n\n## Sub *one*\n### Deep ###\n'
    expect(extractHeadings(md)).toEqual([
      { level: 1, text: 'Title', line: 1 },
      { level: 2, text: 'Sub one', line: 5 },
      { level: 3, text: 'Deep', line: 6 },
    ])
  })

  it('ignores headings inside fenced code blocks', () => {
    const md = '# A\n```sh\n# not a heading\n```\n~~~\n## nope\n~~~\n## B'
    expect(extractHeadings(md).map((h) => h.text)).toEqual(['A', 'B'])
  })

  it('requires a space after the hashes and at most six levels', () => {
    expect(extractHeadings('#nope\n####### seven\n')).toEqual([])
  })

  it('strips links and inline code markers', () => {
    expect(extractHeadings('## See [docs](http://x.y) and `code`')[0].text).toBe(
      'See docs and code',
    )
  })

  it('handles CRLF line endings', () => {
    expect(extractHeadings('# A\r\n## B\r\n').map((h) => h.line)).toEqual([1, 2])
  })
})
