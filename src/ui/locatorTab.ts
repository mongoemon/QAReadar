import type { Command } from '../lib/commands'
import type { FileHandleLike, FileKind, OpenedFile } from '../lib/fileAccess'
import { FRAMEWORKS, frameworkById, locatorsFor, type FormattedLocator } from '../lib/locatorFormats'
import { readStored, writeStored } from '../lib/safeStorage'
import { MARKER_ATTR, annotateSource, elementMarkerAt, startTagRange } from '../lib/sourceMap'
import { copyText } from './clipboard'
import { el } from './dom'
import { createPreview } from './locatorPreview'
import { scrollOffsetIntoView } from './textareaScroll'
import { toast } from './toast'
import type { TabController } from './types'

const RENDER_DELAY_MS = 300
const DEFAULT_NAME = 'page.html'
const FRAMEWORK_KEY = 'mdreadar:locator-framework'
const NO_SELECTION = 'Click an element in the preview'
const MAX_CLASSES_SHOWN = 3

const KIND: FileKind = {
  description: 'HTML',
  mime: 'text/html',
  extensions: ['html', 'htm'],
}

const describeElement = (target: Element): string => {
  const id = target.id ? `#${target.id}` : ''
  const classes = [...target.classList].slice(0, MAX_CLASSES_SHOWN).map((name) => `.${name}`).join('')
  return `<${target.localName}${id}${classes}>`
}

function matchBadge(matches: number | null): HTMLElement {
  const kind = matches === null ? 'unknown' : matches === 1 ? 'unique' : matches === 0 ? 'none' : 'multi'
  const text = matches === null ? '?' : matches === 1 ? 'unique' : `${matches} matches`
  const title =
    matches === null
      ? 'Could not be measured in this preview'
      : `Matches ${matches} element${matches === 1 ? '' : 's'} in this page`
  return el('span', { class: 'loc-badge', 'data-kind': kind, title }, text)
}

async function copyLocator(item: FormattedLocator): Promise<void> {
  const ok = await copyText(item.code)
  toast(ok ? `Copied ${item.label} locator` : 'Clipboard unavailable — select the locator and copy manually', !ok)
}

function locatorRow(item: FormattedLocator): HTMLElement {
  const code = el('code', { class: 'path-code' }, item.code)
  const copy = el('button', { class: 'btn small', type: 'button' }, 'Copy')
  copy.addEventListener('click', () => void copyLocator(item))
  code.addEventListener('dblclick', () => copy.click())
  return el('div', { class: 'loc-row' }, el('span', { class: 'path-label' }, item.label), code, matchBadge(item.matches), copy)
}

function storedFrameworkId(): string {
  const stored = readStored(FRAMEWORK_KEY)
  return stored !== null && frameworkById(stored) ? stored : FRAMEWORKS[0].id
}

export function createLocatorTab(): TabController {
  const listeners: Array<() => void> = []

  const input = el('textarea', {
    class: 'json-input',
    spellcheck: 'false',
    'aria-label': 'Page HTML source',
    placeholder: 'Paste the HTML source of a page here (or open a .html file), then click an element in the preview…',
  })
  const frameworkSelect = el('select', { class: 'json-select', 'aria-label': 'Locator syntax' })
  frameworkSelect.append(...FRAMEWORKS.map((f) => el('option', { value: f.id }, f.label)))
  frameworkSelect.value = storedFrameworkId()
  const parentBtn = el('button', { class: 'btn small', type: 'button' }, 'Select parent')
  const meta = el('p', { class: 'path-meta' }, NO_SELECTION)
  const list = el('div', { class: 'loc-list' })
  const pathBox = el('div', { class: 'pathbox' }, el('div', { class: 'path-head' }, meta, parentBtn), list)

  let selected: Element | null = null
  const preview = createPreview((target) => {
    select(target)
    revealInSource(target)
  })

  const left = el(
    'div',
    { class: 'json-col' },
    el('div', { class: 'pane-bar' }, el('span', { class: 'hint' }, 'HTML source — click a tag or its text to see the locators')),
    input,
  )
  const right = el(
    'div',
    { class: 'json-col' },
    el('div', { class: 'pane-bar' }, el('span', { class: 'hint' }, 'Locators for'), frameworkSelect),
    pathBox,
    preview.element,
  )
  const element = el('section', { class: 'pane json-pane' }, left, right)

  let name = DEFAULT_NAME
  let handle: FileHandleLike | null = null
  let savedText = ''
  let renderTimer: number | undefined
  // The source the preview was built from: cursor offsets only mean something against this text.
  let renderedSource = ''

  const notify = (): void => listeners.forEach((listener) => listener())

  function renderLocators(): void {
    if (selected === null) {
      meta.textContent = NO_SELECTION
      list.replaceChildren()
      return
    }
    meta.textContent = describeElement(selected)
    list.replaceChildren(...locatorsFor(frameworkSelect.value, selected).map(locatorRow))
  }

  function select(target: Element | null): void {
    selected = target
    preview.highlight(target)
    renderLocators()
  }

  function selectParent(): void {
    const parent = selected?.parentElement
    if (!parent || parent === parent.ownerDocument.documentElement) toast('No parent element to select', true)
    else select(parent)
  }

  function renderPreview(): void {
    // Also reached from open(): a debounce still pending would otherwise reload the preview again
    // and wipe a selection made in the meantime.
    window.clearTimeout(renderTimer)
    selected = null
    renderLocators()
    renderedSource = input.value
    preview.load(annotateSource(renderedSource))
  }

  /** Select the element's start tag in the source and scroll it into view (inverse of selectAtCursor). */
  function revealInSource(target: Element): void {
    if (input.value !== renderedSource) return
    const marker = Number(target.getAttribute(MARKER_ATTR))
    const range = target.hasAttribute(MARKER_ATTR) ? startTagRange(renderedSource, marker) : null
    if (!range) return
    input.focus({ preventScroll: true })
    input.setSelectionRange(range.start, range.end)
    scrollOffsetIntoView(input, range.start)
  }

  /** Show the locators of the element under the text cursor / selection start. */
  function selectAtCursor(): void {
    if (input.value !== renderedSource) return
    const marker = elementMarkerAt(renderedSource, input.selectionStart)
    const target = marker === null ? null : preview.findByMarker(marker)
    // <html> cannot be picked by clicking the preview either, and it has no parent to step up to.
    if (!target || target === target.ownerDocument.documentElement) return
    select(target)
    preview.reveal(target)
  }

  function scheduleRender(): void {
    window.clearTimeout(renderTimer)
    renderTimer = window.setTimeout(renderPreview, RENDER_DELAY_MS)
    notify()
  }

  function chooseFramework(id: string): void {
    if (!frameworkById(id)) return
    frameworkSelect.value = id
    writeStored(FRAMEWORK_KEY, id)
    renderLocators()
  }

  input.addEventListener('input', scheduleRender)
  input.addEventListener('click', selectAtCursor)
  input.addEventListener('keyup', (ev) => {
    if (ev.key.startsWith('Arrow') || ev.key.startsWith('Page') || ev.key === 'Home' || ev.key === 'End') selectAtCursor()
  })
  frameworkSelect.addEventListener('change', () => chooseFramework(frameworkSelect.value))
  parentBtn.addEventListener('click', selectParent)

  const commands = (): Command[] => [
    ...FRAMEWORKS.map((f): Command => ({
      id: `locator.framework.${f.id}`,
      title: `Locator: Show ${f.label} locators`,
      run: () => chooseFramework(f.id),
    })),
    { id: 'locator.parent', title: 'Locator: Select parent element', run: selectParent },
  ]

  return {
    id: 'locator',
    label: 'Locator',
    kind: KIND,
    element,
    commands,
    open(file: OpenedFile): void {
      name = file.name
      handle = file.handle
      input.value = file.text
      savedText = file.text
      renderPreview()
      notify()
    },
    snapshot: () => ({ name, text: input.value, handle }),
    markSaved(savedName: string, savedHandle: FileHandleLike | null): void {
      name = savedName
      handle = savedHandle
      savedText = input.value
      notify()
    },
    isDirty: () => input.value !== savedText,
    onChange(listener: () => void): void {
      listeners.push(listener)
    },
  }
}
