import { parseHTML } from 'linkedom'
import { describe, expect, it } from 'vitest'
import { accessibleName, labelTextOf, normalizeText, roleOf } from './accessibility'

const dom = (html: string): Document => parseHTML(`<!doctype html><html><body>${html}</body></html>`).document
const pick = (doc: Document, selector: string): Element => {
  const found = doc.querySelector(selector)
  if (!found) throw new Error(`fixture is missing ${selector}`)
  return found
}

describe('normalizeText', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeText('  a \n\t b  ')).toBe('a b')
  })
})

describe('roleOf', () => {
  it.each([
    ['<button>x</button>', 'button', 'button'],
    ['<a href="/x">x</a>', 'a', 'link'],
    ['<a>x</a>', 'a', null],
    ['<input type="text">', 'input', 'textbox'],
    ['<input>', 'input', 'textbox'],
    ['<input type="email">', 'input', 'textbox'],
    ['<input type="checkbox">', 'input', 'checkbox'],
    ['<input type="radio">', 'input', 'radio'],
    ['<input type="submit">', 'input', 'button'],
    ['<input type="hidden">', 'input', null],
    ['<input type="date">', 'input', null],
    ['<input type="color">', 'input', null],
    ['<input type="file">', 'input', null],
    ['<input type="text" list="opts">', 'input', 'combobox'],
    ['<input type="tel">', 'input', 'textbox'],
    ['<textarea></textarea>', 'textarea', 'textbox'],
    ['<select></select>', 'select', 'combobox'],
    ['<h2>t</h2>', 'h2', 'heading'],
    ['<img src="a.png" alt="logo">', 'img', 'img'],
    ['<img src="a.png" alt="">', 'img', null],
    ['<nav></nav>', 'nav', 'navigation'],
    ['<div role="alert">x</div>', 'div', 'alert'],
    ['<button role="tab">x</button>', 'button', 'tab'],
    ['<div>x</div>', 'div', null],
  ])('%s -> %s', (html, selector, expected) => {
    expect(roleOf(pick(dom(html), selector))).toBe(expected)
  })
})

describe('labelTextOf', () => {
  it('finds a label[for]', () => {
    const doc = dom('<label for="e">Email</label><input id="e">')
    expect(labelTextOf(pick(doc, 'input'))).toBe('Email')
  })

  it('finds a wrapping label', () => {
    const doc = dom('<label>Remember me <input type="checkbox"></label>')
    expect(labelTextOf(pick(doc, 'input'))).toBe('Remember me')
  })

  it('uses aria-labelledby', () => {
    const doc = dom('<span id="a">First</span> <span id="b">name</span><input aria-labelledby="a b">')
    expect(labelTextOf(pick(doc, 'input'))).toBe('First name')
  })

  it('uses aria-label', () => {
    const doc = dom('<input aria-label="Search">')
    expect(labelTextOf(pick(doc, 'input'))).toBe('Search')
  })

  it('is empty when nothing labels the control', () => {
    expect(labelTextOf(pick(dom('<input>'), 'input'))).toBe('')
  })
})

describe('accessibleName', () => {
  it('reads button content', () => {
    expect(accessibleName(pick(dom('<button> Sign   in </button>'), 'button'))).toBe('Sign in')
  })

  it('prefers aria-label over content', () => {
    expect(accessibleName(pick(dom('<button aria-label="Close">×</button>'), 'button'))).toBe('Close')
  })

  it('reads the label of a form control', () => {
    const doc = dom('<label for="e">Email</label><input id="e">')
    expect(accessibleName(pick(doc, 'input'))).toBe('Email')
  })

  it('reads image alt text', () => {
    expect(accessibleName(pick(dom('<img src="a.png" alt="Logo">'), 'img'))).toBe('Logo')
  })

  it('uses the value of a submit input', () => {
    expect(accessibleName(pick(dom('<input type="submit" value="Go">'), 'input'))).toBe('Go')
  })

  it('falls back to title', () => {
    expect(accessibleName(pick(dom('<a href="/" title="Home page"></a>'), 'a'))).toBe('Home page')
  })

  it('does not take a name from the content of a generic container', () => {
    expect(accessibleName(pick(dom('<div role="alert">Boom</div>'), 'div'))).toBe('')
  })
})
