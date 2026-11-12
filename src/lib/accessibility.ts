import { cssString } from './domSelectors'

/**
 * A deliberately small approximation of ARIA role and accessible-name computation —
 * enough to suggest Playwright `getByRole` / `getByLabel` locators, not a full implementation.
 */

const ELEMENT_NODE = 1
const TEXT_NODE = 3

const LABELABLE = new Set(['input', 'select', 'textarea', 'button', 'meter', 'output', 'progress'])

const NAME_FROM_CONTENT = new Set([
  'button', 'link', 'heading', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'option', 'checkbox', 'radio', 'switch', 'treeitem', 'tooltip', 'columnheader', 'rowheader',
])

const TAG_ROLES: Readonly<Record<string, string>> = {
  button: 'button', nav: 'navigation', main: 'main', aside: 'complementary', header: 'banner',
  footer: 'contentinfo', form: 'form', table: 'table', tr: 'row', td: 'cell', th: 'columnheader',
  ul: 'list', ol: 'list', li: 'listitem', dialog: 'dialog', option: 'option', progress: 'progressbar',
  article: 'article', textarea: 'textbox', hr: 'separator', fieldset: 'group', details: 'group',
  h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
}

const INPUT_ROLES: Readonly<Record<string, string | null>> = {
  button: 'button', submit: 'button', reset: 'button', image: 'button',
  checkbox: 'checkbox', radio: 'radio', range: 'slider', number: 'spinbutton',
  search: 'searchbox', hidden: null, password: null,
  // Types with no ARIA role (Playwright's getByRole cannot find them as "textbox").
  date: null, time: null, 'datetime-local': null, month: null, week: null, color: null, file: null,
}

/** With a `list` attribute (datalist), these text-like inputs become comboboxes. */
const LIST_COMBOBOX_TYPES = new Set(['text', 'search', 'tel', 'url', 'email'])

const SKIPPED_TAGS = new Set(['script', 'style', 'template'])

export const normalizeText = (text: string): string => text.replace(/\s+/g, ' ').trim()

function inputRole(el: Element): string | null {
  const type = (el.getAttribute('type') ?? 'text').toLowerCase()
  if (el.hasAttribute('list') && LIST_COMBOBOX_TYPES.has(type)) return 'combobox'
  return type in INPUT_ROLES ? INPUT_ROLES[type] : 'textbox'
}

function selectRole(el: Element): string {
  const size = Number(el.getAttribute('size') ?? '1')
  return el.hasAttribute('multiple') || size > 1 ? 'listbox' : 'combobox'
}

function implicitRole(el: Element): string | null {
  const tag = el.localName
  switch (tag) {
    case 'a':
    case 'area':
      return el.hasAttribute('href') ? 'link' : null
    case 'input':
      return inputRole(el)
    case 'select':
      return selectRole(el)
    case 'img':
      return el.getAttribute('alt') === '' ? null : 'img'
    default:
      return TAG_ROLES[tag] ?? null
  }
}

export function roleOf(el: Element): string | null {
  const explicit = (el.getAttribute('role') ?? '').trim().split(/\s+/)[0]?.toLowerCase()
  return explicit ? explicit : implicitRole(el)
}

/** Text of a subtree; images contribute their alt text, hidden/script content is skipped. */
function textOf(node: Node, skip?: Element): string {
  if (node.nodeType === TEXT_NODE) return node.textContent ?? ''
  if (node.nodeType !== ELEMENT_NODE) return ''
  const el = node as Element
  if (el === skip || SKIPPED_TAGS.has(el.localName)) return ''
  if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return ''
  if (el.localName === 'img') return el.getAttribute('alt') ?? ''
  return [...el.childNodes].map((child) => textOf(child, skip)).join('')
}

function labelledByText(el: Element): string {
  const ids = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)
  const parts = ids.flatMap((id) => {
    const target = el.ownerDocument.getElementById(id)
    return target ? [normalizeText(textOf(target))] : []
  })
  return normalizeText(parts.join(' '))
}

function nativeLabelText(el: Element): string {
  if (!LABELABLE.has(el.localName)) return ''
  const doc = el.ownerDocument
  const byFor = el.id ? [...doc.querySelectorAll(`label[for=${cssString(el.id)}]`)] : []
  const wrapping = el.closest('label')
  const labels = wrapping && !byFor.includes(wrapping) ? [...byFor, wrapping] : byFor
  return normalizeText(labels.map((label) => textOf(label, el)).join(' '))
}

/** What `getByLabel` looks at: aria-labelledby, aria-label, then native <label>. */
export function labelTextOf(el: Element): string {
  return labelledByText(el) || normalizeText(el.getAttribute('aria-label') ?? '') || nativeLabelText(el)
}

function inputButtonName(el: Element): string {
  const type = (el.getAttribute('type') ?? '').toLowerCase()
  if (type === 'image') return normalizeText(el.getAttribute('alt') ?? '')
  const value = normalizeText(el.getAttribute('value') ?? '')
  if (value) return value
  if (type === 'submit') return 'Submit'
  return type === 'reset' ? 'Reset' : ''
}

function nativeName(el: Element): string {
  if (el.localName === 'img') return normalizeText(el.getAttribute('alt') ?? '')
  if (el.localName === 'input' && inputRole(el) === 'button') return inputButtonName(el)
  return ''
}

export function accessibleName(el: Element): string {
  const labelled = labelTextOf(el) || nativeName(el)
  if (labelled) return labelled
  const role = roleOf(el)
  if (role !== null && NAME_FROM_CONTENT.has(role)) {
    const content = normalizeText(textOf(el))
    if (content) return content
  }
  return normalizeText(el.getAttribute('title') ?? '')
}
