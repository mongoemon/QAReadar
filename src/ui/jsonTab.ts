import type { Command } from '../lib/commands'
import {
  CONVERTIBLE_EXTENSIONS,
  convertToJson,
  formatFromFileName,
  type ConvertFormat,
} from '../lib/convert'
import type { FileHandleLike, FileKind, OpenedFile } from '../lib/fileAccess'
import { pathAtOffset, resolvePath } from '../lib/jsonCursor'
import { locateJsonError } from '../lib/jsonError'
import {
  flattenJson,
  formatPath,
  parseJsonSafe,
  previewOf,
  typeOf,
  type FlatNode,
  type PathSegment,
  type PathStyle,
} from '../lib/jsonPath'
import { queryJsonPath } from '../lib/jsonQuery'
import { searchNodes, type SearchScope } from '../lib/jsonSearch'
import { copyText } from './clipboard'
import { el } from './dom'
import { localized, t, type MessageKey } from '../lib/i18n'
import { iconButton } from './icons'
import { renderTree } from './jsonTree'
import { toast } from './toast'
import type { TabController } from './types'

const PARSE_DELAY_MS = 250
const MAX_RESULTS = 200
const DEFAULT_NAME = 'data.json'
const BIG_DOCUMENT_NODES = 5000
const FALLBACK_DEPTH = 4

const KIND: FileKind = {
  description: 'JSON',
  mime: 'application/json',
  extensions: ['json'],
}

const STYLES: ReadonlyArray<{ style: PathStyle; label: string }> = [
  { style: 'jsonpath', label: 'JSONPath' },
  { style: 'js', label: 'JavaScript' },
  { style: 'lodash', label: 'Lodash' },
]

const DEPTHS: ReadonlyArray<{ value: string; label: () => string }> = [
  { value: '0', label: () => t('json.depthCollapsed') },
  { value: '1', label: () => t('json.depthN', { n: 1 }) },
  { value: '2', label: () => t('json.depthN', { n: 2 }) },
  { value: '3', label: () => t('json.depthN', { n: 3 }) },
  { value: '99', label: () => t('json.depthAll') },
]

const SCOPES: ReadonlyArray<{ value: SearchScope; key: MessageKey }> = [
  { value: 'all', key: 'json.scopeAll' },
  { value: 'key', key: 'json.scopeKey' },
  { value: 'value', key: 'json.scopeValue' },
]

const IMPORTS: ReadonlyArray<{ format: ConvertFormat; label: string }> = [
  { format: 'jsonl', label: 'JSON Lines' },
  { format: 'csv', label: 'CSV' },
  { format: 'yaml', label: 'YAML' },
]

interface Row {
  readonly path: string
  readonly segments: readonly PathSegment[]
  readonly value: unknown
}

function option(value: string, label: string): HTMLOptionElement {
  return el('option', { value }, label)
}

export function createJsonTab(): TabController {
  const listeners: Array<() => void> = []

  const input = el('textarea', { class: 'json-input', spellcheck: 'false' })
  const status = el('p', { class: 'json-status', role: 'status' })
  const gotoError = iconButton('alert', () => t('json.gotoErrorTip'), { variant: 'small', text: () => t('json.gotoError') })
  gotoError.hidden = true
  const formatBtn = iconButton('braces', () => t('json.formatTip'), { variant: 'ghost', text: () => t('json.format') })
  const minifyBtn = iconButton('minify', () => t('json.minify'), { variant: 'ghost', text: () => t('json.minify') })
  const importPrompt = option('', '')
  const importSelect = el('select', { class: 'json-select' })
  importSelect.append(importPrompt, ...IMPORTS.map((i) => option(i.format, i.label)))

  const search = el('input', { class: 'json-search', type: 'search' })
  const scopeOptions = SCOPES.map((scope) => option(scope.value, ''))
  const scopeSelect = el('select', { class: 'json-select' }, ...scopeOptions)
  const regexBox = el('input', { type: 'checkbox' })
  const depthOptions = DEPTHS.map((d) => option(d.value, ''))
  const depthSelect = el('select', { class: 'json-select' }, ...depthOptions)
  depthSelect.value = '1'
  const view = el('div', { class: 'json-view' })
  const meta = el('p', { class: 'path-meta' })

  const codes = new Map<PathStyle, HTMLElement>()
  const pathRows = STYLES.map(({ style, label }) => {
    const code = el('code', { class: 'path-code' }, '—')
    codes.set(style, code)
    const copy = iconButton('copy', () => t('json.copyPath', { label }), { variant: 'small ghost' })
    copy.addEventListener('click', async () => {
      const ok = await copyText(code.textContent ?? '')
      toast(ok ? t('json.copiedPath', { label }) : t('json.clipboardPath'), !ok)
    })
    code.addEventListener('dblclick', () => copy.click())
    return el('div', { class: 'path-row' }, el('span', { class: 'path-label' }, label), code, copy)
  })
  const copyValueBtn = iconButton('copy', () => t('json.copyValueTip'), { variant: 'small', text: () => t('json.copyValue') })
  const pathBox = el('div', { class: 'pathbox' }, el('div', { class: 'path-head' }, meta, copyValueBtn), ...pathRows)

  const left = el(
    'div',
    { class: 'json-col' },
    el('div', { class: 'pane-bar' }, formatBtn, minifyBtn, importSelect),
    input,
    el('div', { class: 'pane-bar' }, status, gotoError),
  )
  const right = el(
    'div',
    { class: 'json-col' },
    el('div', { class: 'pane-bar' }, search, scopeSelect, el('label', { class: 'find-opt' }, regexBox, '.*'), depthSelect),
    pathBox,
    view,
  )
  const element = el('section', { class: 'pane json-pane' }, left, right)

  let name = DEFAULT_NAME
  let handle: FileHandleLike | null = null
  let savedText = ''
  let current: unknown = undefined
  let hasValue = false
  let selectedValue: unknown = undefined
  let hasSelection = false
  let flat: FlatNode[] | null = null
  let parseTimer: number | undefined
  let errorOffset = -1

  const notify = (): void => listeners.forEach((listener) => listener())

  function showSelection(segments: readonly PathSegment[], value: unknown): void {
    for (const { style } of STYLES) {
      const code = codes.get(style)
      if (code) code.textContent = formatPath(segments, style)
    }
    selectedValue = value
    hasSelection = true
    meta.textContent = `${typeOf(value)} · ${previewOf(value)}`
  }

  function clearSelection(): void {
    for (const code of codes.values()) code.textContent = '—'
    hasSelection = false
    selectedValue = undefined
    meta.textContent = t('json.noSelection')
  }

  function renderRows(rows: readonly Row[], summary: string): void {
    const list = el('div', { class: 'results' })
    for (const row of rows.slice(0, MAX_RESULTS)) {
      const item = el(
        'button',
        { class: 'result', type: 'button' },
        el('code', {}, row.path),
        el('span', { class: `jval t-${typeOf(row.value)}` }, previewOf(row.value)),
      )
      item.addEventListener('click', () => showSelection(row.segments, row.value))
      list.append(item)
    }
    const count = rows.length > MAX_RESULTS ? t('json.matchesMore', { n: rows.length, max: MAX_RESULTS }) : t('json.matches', { n: rows.length })
    view.replaceChildren(el('p', { class: 'results-count' }, summary || count), list)
  }

  function renderSearch(query: string): void {
    if (query.startsWith('$')) {
      const result = queryJsonPath(current, query)
      if (!result.ok) {
        view.replaceChildren(el('p', { class: 'results-count error' }, `JSONPath: ${result.error}`))
        return
      }
      const rows = result.hits.map((hit) => ({
        path: formatPath(hit.segments, 'jsonpath'),
        segments: hit.segments,
        value: hit.value,
      }))
      const more = result.truncated ? t('json.truncated') : ''
      const n = result.hits.length
      renderRows(rows, t(n === 1 ? 'json.pathResult' : 'json.pathResults', { n }) + more)
      return
    }
    flat ??= flattenJson(current)
    const result = searchNodes(flat, query, { regex: regexBox.checked, scope: scopeSelect.value as SearchScope })
    if (!result.ok) {
      view.replaceChildren(el('p', { class: 'results-count error' }, t('json.pattern', { e: result.error })))
      return
    }
    renderRows(
      result.nodes.map((n) => ({ path: n.path, segments: n.segments, value: n.value })),
      '',
    )
  }

  function treeDepth(): number {
    const requested = Number(depthSelect.value)
    if (requested < 99) return requested
    flat ??= flattenJson(current)
    if (flat.length <= BIG_DOCUMENT_NODES) return requested
    toast(t('json.large', { n: flat.length, d: FALLBACK_DEPTH }))
    return FALLBACK_DEPTH
  }

  function renderView(): void {
    if (!hasValue) {
      view.replaceChildren()
      clearSelection()
      return
    }
    const query = search.value.trim()
    if (query) {
      renderSearch(query)
      return
    }
    view.replaceChildren(
      renderTree(current, { onSelect: (segments, value) => showSelection(segments, value) }, treeDepth()),
    )
  }

  // Kept as a function so the status line can be re-rendered in a new language.
  let statusText: () => string = () => t('json.waiting')

  function setStatus(kind: 'idle' | 'ok' | 'error', text: () => string): void {
    status.dataset.kind = kind
    statusText = text
    status.textContent = text()
    if (kind !== 'error') {
      gotoError.hidden = true
      errorOffset = -1
    }
  }

  function reparse(): void {
    const text = input.value
    if (text.trim() === '') {
      hasValue = false
      current = undefined
      flat = null
      view.classList.remove('stale')
      setStatus('idle', () => t('json.waiting'))
      renderView()
      return
    }
    const result = parseJsonSafe(text)
    if (!result.ok) {
      view.classList.add('stale')
      const where = locateJsonError(text, result.error)
      const error = result.error
      setStatus('error', () => t('json.invalid', { e: error }) + (where ? t('json.where', { line: where.line, col: where.col }) : ''))
      errorOffset = where?.offset ?? -1
      gotoError.hidden = where === null
      return
    }
    current = result.value
    hasValue = true
    flat = null
    view.classList.remove('stale')
    setStatus('ok', () => t('json.valid'))
    renderView()
  }

  function scheduleParse(): void {
    window.clearTimeout(parseTimer)
    parseTimer = window.setTimeout(reparse, PARSE_DELAY_MS)
    notify()
  }

  function rewrite(text: string): void {
    input.value = text
    reparse()
    notify()
  }

  function format(indent: number | undefined): void {
    if (hasValue) rewrite(JSON.stringify(current, null, indent))
    else toast(t('json.fixFirst'), true)
  }

  function convertText(format: ConvertFormat, text: string): boolean {
    const result = convertToJson(format, text)
    if (!result.ok) {
      toast(t('json.cannotConvert', { e: result.error }), true)
      return false
    }
    rewrite(JSON.stringify(result.value, null, 2))
    return true
  }

  async function copySelectedValue(): Promise<void> {
    if (!hasSelection) {
      toast(t('json.selectFirst'), true)
      return
    }
    const text = typeof selectedValue === 'string' ? selectedValue : JSON.stringify(selectedValue, null, 2)
    const ok = await copyText(text)
    toast(ok ? t('json.copiedValue') : t('msg.clipboard'), !ok)
  }

  function selectAtCursor(): void {
    if (!hasValue || status.dataset.kind !== 'ok') return
    const segments = pathAtOffset(input.value, input.selectionStart)
    if (segments === null) return
    const resolved = resolvePath(current, segments)
    if (resolved.ok) showSelection(segments, resolved.value)
  }

  input.addEventListener('click', selectAtCursor)
  input.addEventListener('keyup', (ev) => {
    if (ev.key.startsWith('Arrow') || ev.key === 'Home' || ev.key === 'End') selectAtCursor()
  })
  input.addEventListener('input', scheduleParse)
  search.addEventListener('input', renderView)
  scopeSelect.addEventListener('change', renderView)
  regexBox.addEventListener('change', renderView)
  depthSelect.addEventListener('change', renderView)
  formatBtn.addEventListener('click', () => format(2))
  minifyBtn.addEventListener('click', () => format(undefined))
  copyValueBtn.addEventListener('click', () => void copySelectedValue())
  gotoError.addEventListener('click', () => {
    if (errorOffset < 0) return
    input.focus()
    input.setSelectionRange(errorOffset, Math.min(errorOffset + 1, input.value.length))
  })
  importSelect.addEventListener('change', () => {
    const chosen = importSelect.value as ConvertFormat | ''
    importSelect.value = ''
    if (chosen !== '') convertText(chosen, input.value)
  })

  localized(() => {
    input.setAttribute('aria-label', t('json.inputAria'))
    input.placeholder = t('json.placeholder')
    importSelect.setAttribute('aria-label', t('json.convertAria'))
    importPrompt.textContent = t('json.convertFrom')
    search.placeholder = t('json.searchPlaceholder')
    search.setAttribute('aria-label', t('json.searchAria'))
    scopeSelect.setAttribute('aria-label', t('json.scopeAria'))
    SCOPES.forEach((scope, i) => (scopeOptions[i].textContent = t(scope.key)))
    regexBox.setAttribute('aria-label', t('json.regexAria'))
    depthSelect.setAttribute('aria-label', t('json.depthAria'))
    DEPTHS.forEach((d, i) => (depthOptions[i].textContent = d.label()))
    status.textContent = statusText()
    if (!hasSelection) meta.textContent = t('json.noSelection')
    if (hasValue && search.value.trim()) renderView()
  })

  const commands = (): Command[] => [
    { id: 'json.format', title: t('json.cmd.format'), run: () => format(2) },
    { id: 'json.minify', title: t('json.cmd.minify'), run: () => format(undefined) },
    { id: 'json.copyvalue', title: t('json.cmd.copyValue'), run: () => void copySelectedValue() },
    { id: 'json.search', title: t('json.cmd.search'), run: () => search.focus() },
    ...IMPORTS.map((i): Command => ({
      id: `json.import.${i.format}`,
      title: t('json.cmd.convert', { f: i.label }),
      run: () => void convertText(i.format, input.value),
    })),
  ]

  return {
    id: 'json',
    get label() {
      return t('tab.json')
    },
    kind: KIND,
    extraExtensions: CONVERTIBLE_EXTENSIONS,
    element,
    commands,
    open(file: OpenedFile): void {
      const source = formatFromFileName(file.name)
      if (source === null) {
        name = file.name
        handle = file.handle
        input.value = file.text
        savedText = file.text
        reparse()
        notify()
        return
      }
      // Converted files are new JSON documents: never keep the original handle,
      // or Save would overwrite the CSV/YAML with JSON.
      name = `${file.name.replace(/\.[^.]+$/, '')}.json`
      handle = null
      savedText = ''
      if (convertText(source, file.text)) toast(t('json.converted', { name: file.name }))
      else {
        input.value = file.text
        reparse()
      }
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
