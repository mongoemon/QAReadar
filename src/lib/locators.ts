import { accessibleName, labelTextOf, normalizeText, roleOf } from './accessibility'
import { cssEscape, cssPath, xpathOf } from './domSelectors'

/** A framework-neutral way of pointing at one element. Formatters turn these into code. */
export type CandidateKind =
  | 'testid'
  | 'role'
  | 'label'
  | 'placeholder'
  | 'text'
  | 'alt'
  | 'title'
  | 'id'
  | 'name'
  | 'link'
  | 'css-class'
  | 'css'
  | 'xpath'

export interface Candidate {
  readonly kind: CandidateKind
  /** Main value: the text, id, selector… */
  readonly value: string
  readonly tag: string
  /**
   * For `role`: the ARIA role. For `testid`: the attribute name.
   * For `text`: `nbsp` when the original text had a non-breaking space (normalization hides it,
   * but XPath's normalize-space() does not treat it as whitespace).
   */
  readonly extra?: string
}

const NBSP = ' '

/** Attributes teams commonly use as automation hooks; `data-testid` is Playwright's default. */
export const TEST_ID_ATTRIBUTES: readonly string[] = ['data-testid', 'data-test-id', 'data-test', 'data-qa', 'data-cy']

const MAX_TEXT_LENGTH = 80
const NO_TEXT_LOCATOR_TAGS = new Set(['input', 'textarea', 'select', 'img', 'script', 'style', 'html', 'body'])
const FORM_FIELD_TAGS = new Set(['input', 'textarea', 'select'])

function hasChildWithSameText(el: Element, text: string): boolean {
  const needle = text.toLowerCase()
  return [...el.children].some((child) => normalizeText(child.textContent ?? '').toLowerCase().includes(needle))
}

function textCandidate(el: Element): Candidate[] {
  if (NO_TEXT_LOCATOR_TAGS.has(el.localName)) return []
  const raw = el.textContent ?? ''
  const text = normalizeText(raw)
  if (text === '' || text.length > MAX_TEXT_LENGTH || hasChildWithSameText(el, text)) return []
  return [{ kind: 'text', value: text, tag: el.localName, extra: raw.includes(NBSP) ? 'nbsp' : undefined }]
}

function roleCandidate(el: Element): Candidate[] {
  const role = roleOf(el)
  const name = role === null ? '' : accessibleName(el)
  return role !== null && name !== '' ? [{ kind: 'role', value: name, tag: el.localName, extra: role }] : []
}

/** The raw attribute value is kept: exact-match selectors (CSS, Robot) must equal it character for character. */
function attributeCandidate(el: Element, kind: 'placeholder' | 'alt' | 'title'): Candidate[] {
  const value = el.getAttribute(kind) ?? ''
  return value.trim() === '' ? [] : [{ kind, value, tag: el.localName }]
}

function simpleCandidate(el: Element, kind: 'id' | 'name'): Candidate[] {
  const value = el.getAttribute(kind) ?? ''
  return value === '' ? [] : [{ kind, value, tag: el.localName }]
}

function labelCandidate(el: Element): Candidate[] {
  const value = labelTextOf(el)
  return value !== '' && FORM_FIELD_TAGS.has(el.localName) ? [{ kind: 'label', value, tag: el.localName }] : []
}

function linkCandidate(el: Element): Candidate[] {
  const value = normalizeText(el.textContent ?? '')
  return el.localName === 'a' && el.hasAttribute('href') && value !== '' ? [{ kind: 'link', value, tag: 'a' }] : []
}

function classCandidate(el: Element): Candidate[] {
  const classes = [...el.classList]
  if (classes.length === 0) return []
  const value = `${cssEscape(el.localName)}.${classes.map(cssEscape).join('.')}`
  return [{ kind: 'css-class', value, tag: el.localName }]
}

function testIdCandidates(el: Element): Candidate[] {
  return TEST_ID_ATTRIBUTES.flatMap((name): Candidate[] => {
    const value = el.getAttribute(name)
    return value ? [{ kind: 'testid', value, tag: el.localName, extra: name }] : []
  })
}

/** Every sensible way to locate `el`, most recommended first. */
export function findCandidates(el: Element): Candidate[] {
  const tag = el.localName
  return [
    ...testIdCandidates(el),
    ...roleCandidate(el),
    ...labelCandidate(el),
    ...attributeCandidate(el, 'placeholder'),
    ...textCandidate(el),
    ...attributeCandidate(el, 'alt'),
    ...attributeCandidate(el, 'title'),
    ...simpleCandidate(el, 'id'),
    ...simpleCandidate(el, 'name'),
    ...linkCandidate(el),
    ...classCandidate(el),
    { kind: 'css', value: cssPath(el), tag },
    { kind: 'xpath', value: xpathOf(el), tag },
  ]
}
