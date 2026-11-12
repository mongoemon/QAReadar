const HTML_NS = 'http://www.w3.org/1999/xhtml'

/** CSS.escape() equivalent that also works outside a browser (tests). */
export function cssEscape(value: string): string {
  let out = ''
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    const code = value.charCodeAt(i)
    if (code === 0) out += '�'
    else if (code <= 0x1f || code === 0x7f) out += `\\${code.toString(16)} `
    else if (i === 0 && code >= 0x30 && code <= 0x39) out += `\\${code.toString(16)} `
    else if (i === 1 && code >= 0x30 && code <= 0x39 && value[0] === '-') out += `\\${code.toString(16)} `
    else if (i === 0 && ch === '-' && value.length === 1) out += `\\${ch}`
    else if (code >= 0x80 || ch === '-' || ch === '_' || /[0-9A-Za-z]/.test(ch)) out += ch
    else out += `\\${ch}`
  }
  return out
}

/** A double-quoted CSS string literal, e.g. for attribute selectors. */
export function cssString(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\a ')
    .replace(/\r/g, '\\d ')
    .replace(/\f/g, '\\c ')
  return `"${escaped}"`
}

const PLAIN_XML_NAME = /^[A-Za-z_][\w.-]*$/

/**
 * An XPath node test for a tag. Names that are not plain (e.g. `o:p`, which XPath would read as a
 * namespace prefix) — and, with `force`, any name — are matched through name() instead.
 */
export function xpathName(localName: string, force = false): string {
  if (!force && PLAIN_XML_NAME.test(localName)) return localName
  const literal = localName.includes("'") ? xpathString(localName) : `'${localName}'`
  return `*[name()=${literal}]`
}

/** An XPath string literal; double quotes preferred, concat() when both kinds appear. */
export function xpathString(value: string): string {
  if (!value.includes('"')) return `"${value}"`
  if (!value.includes("'")) return `'${value}'`
  return `concat(${value.split('"').map((part) => `"${part}"`).join(`, '"', `)})`
}

function countMatches(doc: Document, selector: string): number {
  try {
    return doc.querySelectorAll(selector).length
  } catch {
    // An unparsable selector can never identify the element uniquely.
    return Number.POSITIVE_INFINITY
  }
}

const isUniqueId = (el: Element): boolean =>
  el.id !== '' && countMatches(el.ownerDocument, `[id=${cssString(el.id)}]`) === 1

const sameTagSiblings = (el: Element): Element[] =>
  [...(el.parentElement?.children ?? [])].filter(
    (sibling) => sibling.localName === el.localName && sibling.namespaceURI === el.namespaceURI,
  )

function cssSegment(el: Element): string {
  if (isUniqueId(el)) return `#${cssEscape(el.id)}`
  const tag = cssEscape(el.localName)
  const siblings = sameTagSiblings(el)
  if (siblings.length <= 1) return tag
  return `${tag}:nth-of-type(${siblings.indexOf(el) + 1})`
}

/** The shortest `a > b > c` selector, built upwards, that matches only this element. */
export function cssPath(el: Element): string {
  const doc = el.ownerDocument
  const segments: string[] = []
  let node: Element | null = el
  let selector = ''
  while (node) {
    segments.unshift(cssSegment(node))
    selector = segments.join(' > ')
    if (countMatches(doc, selector) === 1) return selector
    node = node.parentElement
  }
  return selector
}

function xpathSegment(el: Element): string {
  const name = xpathName(el.localName, el.namespaceURI !== HTML_NS && el.namespaceURI !== null)
  const siblings = sameTagSiblings(el)
  return siblings.length <= 1 ? name : `${name}[${siblings.indexOf(el) + 1}]`
}

/** `//*[@id="x"]` when the id is unique, otherwise an indexed absolute path. */
export function xpathOf(el: Element): string {
  if (isUniqueId(el)) return `//*[@id=${xpathString(el.id)}]`
  const segments: string[] = []
  for (let node: Element | null = el; node; node = node.parentElement) segments.unshift(xpathSegment(node))
  return `/${segments.join('/')}`
}
