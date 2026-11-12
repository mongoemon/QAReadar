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

const DEPTHS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '0', label: 'Collapsed' },
  { value: '1', label: 'Depth 1' },
  { value: '2', label: 'Depth 2' },
  { value: '3', label: 'Depth 3' },
  { value: '99', label: 'Expand all' },
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

  const input = el('textarea', {
    class: 'json-input',
    spellcheck: 'false',
    'aria-label': 'JSON input',
    placeholder: 'Paste JSON here, or open a .json / .jsonl / .csv / .yaml file…',
  })
  const status = el('p', { class: 'json-status', role: 'status' }, 'Waiting for JSON…')
  const gotoError = el('button', { class: 'btn small', type: 'button' }, 'Go to error')
  gotoError.hidden = true
  const formatBtn = el('button', { class: 'btn ghost', type: 'button' }, 'Format')
  const minifyBtn = el('button', { class: 'btn ghost', type: 'button' }, 'Minify')
  const importSelect = el('select', { class: 'json-select', 'aria-label': 'Convert the text to JSON from…' })
  importSelect.append(option('', 'Convert from…'), ...IMPORTS.map((i) => option(i.format, i.label)))

  const search = el('input', {
    class: 'json-search',
    type: 'search',
    placeholder: 'Search, or type a JSONPath like $.users[*].name',
    'aria-label': 'Search in JSON or run a JSONPath',
  })
  const scopeSelect = el('select', { class: 'json-select', 'aria-label': 'Search scope' })
  scopeSelect.append(option('all', 'Keys + values'), option('key', 'Keys'), option('value', 'Values'))
  const regexBox = el('input', { type: 'checkbox', 'aria-label': 'Regular expression' })
  const depthSelect = el('select', { class: 'json-select', 'aria-label': 'Tree depth' })
  depthSelect.append(...DEPTHS.map((d) => option(d.value, d.label)))
  depthSelect.value = '1'
  const view = el('div', { class: 'json-view' })
  const meta = el('p', { class: 'path-meta' }, 'No selection')

  const codes = new Map<PathStyle, HTMLElement>()
  const pathRows = STYLES.map(({ style, label }) => {
    const code = el('code', { class: 'path-code' }, '—')
    codes.set(style, code)
    const copy = el('button', { class: 'btn small', type: 'button' }, 'Copy')
    copy.addEventListener('click', async () => {
      const ok = await copyText(code.textContent ?? '')
      toast(ok ? `Copied ${label} path` : 'Clipboard unavailable — select the path and copy manually', !ok)
    })
    code.addEventListener('dblclick', () => copy.click())
    return el('div', { class: 'path-row' }, el('span', { class: 'path-label' }, label), code, copy)
  })
  const copyValueBtn = el('button', { class: 'btn small', type: 'button' }, 'Copy value')
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
    meta.textContent = 'No selection'
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
    const count = rows.length > MAX_RESULTS ? `${rows.length} matches (showing ${MAX_RESULTS})` : `${rows.length} matches`
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
      const more = result.truncated ? ' (truncated)' : ''
      renderRows(rows, `${result.hits.length} JSONPath result${result.hits.length === 1 ? '' : 's'}${more}`)
      return
    }
    flat ??= flattenJson(current)
    const result = searchNodes(flat, query, { regex: regexBox.checked, scope: scopeSelect.value as SearchScope })
    if (!result.ok) {
      view.replaceChildren(el('p', { class: 'results-count error' }, `Pattern: ${result.error}`))
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
    toast(`Large document (${flat.length} nodes) — expanded to depth ${FALLBACK_DEPTH}`)
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

  function setStatus(kind: 'idle' | 'ok' | 'error', text: string): void {
    status.dataset.kind = kind
    status.textContent = text
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
      setStatus('idle', 'Waiting for JSON…')
      renderView()
      return
    }
    const result = parseJsonSafe(text)
    if (!result.ok) {
      view.classList.add('stale')
      const where = locateJsonError(text, result.error)
      const suffix = where ? ` (line ${where.line}, col ${where.col})` : ''
      setStatus('error', `Invalid JSON — ${result.error}${suffix}`)
      errorOffset = where?.offset ?? -1
      gotoError.hidden = where === null
      return
    }
    current = result.value
    hasValue = true
    flat = null
    view.classList.remove('stale')
    setStatus('ok', 'Valid JSON')
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
    else toast('Fix the JSON first — it does not parse yet', true)
  }

  function convertText(format: ConvertFormat, text: string): boolean {
    const result = convertToJson(format, text)
    if (!result.ok) {
      toast(`Cannot convert: ${result.error}`, true)
      return false
    }
    rewrite(JSON.stringify(result.value, null, 2))
    return true
  }

  async function copySelectedValue(): Promise<void> {
    if (!hasSelection) {
      toast('Select a node first', true)
      return
    }
    const text = typeof selectedValue === 'string' ? selectedValue : JSON.stringify(selectedValue, null, 2)
    const ok = await copyText(text)
    toast(ok ? 'Copied value' : 'Clipboard unavailable', !ok)
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

  const commands = (): Command[] => [
    { id: 'json.format', title: 'JSON: Format', run: () => format(2) },
    { id: 'json.minify', title: 'JSON: Minify', run: () => format(undefined) },
    { id: 'json.copyvalue', title: 'JSON: Copy selected value', run: () => void copySelectedValue() },
    { id: 'json.search', title: 'JSON: Focus search / JSONPath', run: () => search.focus() },
    ...IMPORTS.map((i): Command => ({
      id: `json.import.${i.format}`,
      title: `JSON: Convert text from ${i.label}`,
      run: () => void convertText(i.format, input.value),
    })),
  ]

  return {
    id: 'json',
    label: 'JSON Path',
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
      if (convertText(source, file.text)) toast(`Converted ${file.name} to JSON`)
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
