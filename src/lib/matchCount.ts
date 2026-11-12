import { accessibleName, labelTextOf, normalizeText, roleOf } from './accessibility'
import { cssString } from './domSelectors'

/**
 * How many elements a locator hits in a document. `null` means "cannot tell here"
 * (e.g. XPath in an environment without document.evaluate).
 * Text-ish matching mirrors Playwright: case-insensitive substring on normalized text.
 */

const ORDERED_NODE_SNAPSHOT_TYPE = 7
const LABELLED_SELECTOR = 'input,select,textarea,button,meter,output,progress,[aria-label],[aria-labelledby]'
const SKIPPED_TAGS = new Set(['script', 'style', 'template'])

const includesText = (haystack: string, needle: string): boolean =>
  haystack.toLowerCase().includes(needle.toLowerCase())

const allElements = (doc: Document): Element[] => [...doc.querySelectorAll('*')]

export function countCss(doc: Document, selector: string): number | null {
  try {
    return doc.querySelectorAll(selector).length
  } catch {
    // An invalid selector is reported as "unknown" rather than as a wrong number.
    return null
  }
}

export function countXpath(doc: Document, xpath: string): number | null {
  if (typeof doc.evaluate !== 'function') return null
  try {
    return doc.evaluate(xpath, doc, null, ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotLength
  } catch {
    return null
  }
}

export const countAttrEquals = (doc: Document, attr: string, value: string): number | null =>
  countCss(doc, `[${attr}=${cssString(value)}]`)

export function countAttrContains(doc: Document, attr: string, text: string): number {
  return [...doc.querySelectorAll(`[${attr}]`)].filter((el) => includesText(el.getAttribute(attr) ?? '', text)).length
}

export function countRole(doc: Document, role: string, name: string): number {
  return allElements(doc).filter((el) => roleOf(el) === role && includesText(accessibleName(el), name)).length
}

export function countLabel(doc: Document, text: string): number {
  return [...doc.querySelectorAll(LABELLED_SELECTOR)].filter((el) => includesText(labelTextOf(el), text)).length
}

export function countLinkText(doc: Document, text: string): number {
  return [...doc.querySelectorAll('a')].filter((a) => normalizeText(a.textContent ?? '') === text).length
}

/** Elements whose text contains `text`, counting only the innermost such element. */
export function countText(doc: Document, text: string): number {
  const has = (el: Element): boolean => includesText(normalizeText(el.textContent ?? ''), text)
  const visible = [...(doc.body?.querySelectorAll('*') ?? [])]
  return visible.filter((el) => !SKIPPED_TAGS.has(el.localName) && has(el) && ![...el.children].some(has)).length
}
