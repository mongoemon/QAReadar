import { parseHTML } from 'linkedom'
import { describe, expect, it } from 'vitest'
import { cssEscape, cssPath, cssString, xpathOf, xpathString } from './domSelectors'

const dom = (html: string): Document => parseHTML(`<!doctype html><html><body>${html}</body></html>`).document
const pick = (doc: Document, selector: string): Element => {
  const found = doc.querySelector(selector)
  if (!found) throw new Error(`fixture is missing ${selector}`)
  return found
}

describe('cssEscape', () => {
  it('leaves plain identifiers alone', () => {
    expect(cssEscape('login-btn_2')).toBe('login-btn_2')
  })

  it('escapes characters that are not valid in an identifier', () => {
    expect(cssEscape('a.b:c')).toBe('a\\.b\\:c')
  })

  it('escapes a leading digit', () => {
    expect(cssEscape('1abc')).toBe('\\31 abc')
  })
})

describe('cssString / xpathString', () => {
  it('quotes and escapes for CSS', () => {
    expect(cssString('say "hi"\\')).toBe('"say \\"hi\\"\\\\"')
  })

  it('prefers double quotes for xpath (easy to embed in JS / Robot strings)', () => {
    expect(xpathString("it's")).toBe('"it\'s"')
  })

  it('falls back to single quotes when the value has a double quote', () => {
    expect(xpathString('say "hi"')).toBe(`'say "hi"'`)
  })

  it('uses concat() when the value has both quote kinds', () => {
    expect(xpathString(`a'b"c`)).toBe(`concat("a'b", '"', "c")`)
  })
})

describe('cssPath', () => {
  it('stops at a unique id', () => {
    const doc = dom('<div><button id="go">Go</button></div>')
    expect(cssPath(pick(doc, 'button'))).toBe('#go')
  })

  it('adds nth-of-type only where siblings are ambiguous', () => {
    const doc = dom('<ul><li>a</li><li>b</li></ul><p>x</p>')
    const path = cssPath(pick(doc, 'li:nth-of-type(2)'))
    expect(doc.querySelectorAll(path)).toHaveLength(1)
    expect(doc.querySelector(path)?.textContent).toBe('b')
  })

  it('ignores an id that is not unique', () => {
    const doc = dom('<p id="x">1</p><p id="x">2</p>')
    const target = doc.querySelectorAll('p')[1]
    const path = cssPath(target)
    expect(doc.querySelectorAll(path)).toHaveLength(1)
    expect(doc.querySelector(path)).toBe(target)
  })

  it('is as short as it can be while staying unique', () => {
    const doc = dom('<main><section><form><input name="q"></form></section></main>')
    expect(cssPath(pick(doc, 'input'))).toBe('input')
  })
})

describe('namespaced tag names (e.g. Word-exported <o:p>)', () => {
  const doc = dom('<div><o:p>a</o:p><o:p>b</o:p></div>')
  const second = doc.querySelectorAll('div > *')[1]

  it('builds a valid, unique css path', () => {
    const path = cssPath(second)
    expect(() => doc.querySelectorAll(path)).not.toThrow()
    expect(doc.querySelector(path)).toBe(second)
  })

  it('addresses the element by name() in xpath', () => {
    expect(xpathOf(second)).toBe("/html/body/div/*[name()='o:p'][2]")
  })
})

describe('control characters in string literals', () => {
  it('escapes CR and FF for CSS', () => {
    expect(cssString('a\rb\fc')).toBe('"a\\d b\\c c"')
  })
})

describe('xpathOf', () => {
  it('uses a unique id', () => {
    const doc = dom('<div><button id="go">Go</button></div>')
    expect(xpathOf(pick(doc, 'button'))).toBe('//*[@id="go"]')
  })

  it('builds an indexed absolute path otherwise', () => {
    const doc = dom('<div><span>a</span><span>b</span></div>')
    expect(xpathOf(pick(doc, 'span:nth-of-type(2)'))).toBe('/html/body/div/span[2]')
  })

  it('omits the index for an only child of its tag', () => {
    const doc = dom('<div><span>a</span></div>')
    expect(xpathOf(pick(doc, 'span'))).toBe('/html/body/div/span')
  })
})
