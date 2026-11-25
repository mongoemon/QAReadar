import type { Command } from '../lib/commands'
import { openTextFile, type FileHandleLike, type FileKind, type OpenedFile } from '../lib/fileAccess'
import { looksBinary } from '../lib/fileKind'
import { localized, t, type MessageKey } from '../lib/i18n'
import {
  applyToChanges,
  carryChoices,
  composeChoice,
  defaultChoices,
  diffLines,
  fitChoice,
  includesLeft,
  includesRight,
  mergeStats,
  mergeText,
  type Choice,
  type LineDiff,
  type MergeRow,
} from '../lib/lineMerge'
import { readStored, writeStored } from '../lib/safeStorage'
import { keyHint, withShortcuts } from '../lib/shortcuts'
import type { Starter } from '../lib/samples'
import { copyText } from './clipboard'
import { el } from './dom'
import { iconButton, setIconButton } from './icons'
import { createDiffView, type Side } from './merge/diffView'
import { errorMessage, toast } from './toast'
import type { TabController } from './types'

const RECOMPUTE_DELAY_MS = 250
const DEFAULT_NAME = 'merged-test-cases.txt'
const IGNORE_WS_KEY = 'qareadar:merge-ignore-ws'
/** What the merged result is saved as. */
const KIND: FileKind = {
  description: 'Test case',
  mime: 'text/plain',
  extensions: ['txt', 'feature', 'md', 'robot', 'csv'],
}

/** What either side can be loaded from: test cases and automation scripts. */
const SOURCE_KIND: FileKind = {
  description: 'Test case / script',
  mime: 'text/plain',
  extensions: [
    'txt', 'feature', 'md', 'csv', 'tsv', 'robot', 'gherkin', 'json', 'yaml', 'yml', 'xml',
    'js', 'ts', 'mjs', 'java', 'kt', 'py', 'cs', 'rb', 'go', 'groovy',
  ],
}

const SIDE_LABEL: Record<Side, MessageKey> = { left: 'mg.manual', right: 'mg.automate' }
const BULK: ReadonlyArray<readonly [Choice, MessageKey, MessageKey]> = [
  ['left', 'mg.allLeft', 'mg.allLeftTip'],
  ['right', 'mg.allRight', 'mg.allRightTip'],
  ['both', 'mg.allBoth', 'mg.allBothTip'],
  ['none', 'mg.allNone', 'mg.allNoneTip'],
]

function mergedName(base: string): string {
  const dot = base.lastIndexOf('.')
  return dot > 0 ? `${base.slice(0, dot)}.merged${base.slice(dot)}` : `${base}.merged.txt`
}

export interface MergeTab extends TabController {
  /** Show the built-in example pair (manual vs automate); replaced by the first file opened. */
  loadSample(): void
}

export function createMergeTab(sample: { readonly manual: Starter; readonly automate: Starter }): MergeTab {
  const listeners: Array<() => void> = []
  const notify = (): void => listeners.forEach((listener) => listener())

  // ── sources ──
  interface SourcePanel {
    readonly input: HTMLTextAreaElement
    readonly nameEl: HTMLElement
    readonly element: HTMLElement
    fileName: string | null
    /** Line ending of the loaded file — the textarea normalizes CRLF to LF, so remember it. */
    eol: '\n' | '\r\n' | null
  }

  let lastFocused: Side = 'left'
  // Set while the built-in example is showing: the first file opened replaces it entirely.
  let showingSample = false

  function sourcePanel(side: Side): SourcePanel {
    const input = el('textarea', { class: 'json-input merge-input', spellcheck: 'false', wrap: 'off' })
    const title = el('span', { class: `merge-tag ${side}` })
    const nameEl = el('span', { class: 'merge-file' })
    const sideName = (): string => t(SIDE_LABEL[side])
    const loadBtn = iconButton('open', () => t('mg.load', { side: sideName() }), { variant: 'small ghost' })
    const clearBtn = iconButton('close', () => t('mg.clear', { side: sideName() }), { variant: 'small ghost' })
    const element = el(
      'div',
      { class: `merge-src ${side}` },
      el('div', { class: 'pane-bar merge-src-bar' }, title, nameEl, el('span', { class: 'merge-spacer' }), loadBtn, clearBtn),
      input,
    )
    localized(() => {
      title.textContent = sideName()
      input.placeholder = t(side === 'left' ? 'mg.placeholderLeft' : 'mg.placeholderRight')
      input.setAttribute('aria-label', t('mg.sourceAria', { side: sideName() }))
    })
    loadBtn.addEventListener('click', () => void pickFile(side))
    clearBtn.addEventListener('click', () => {
      showingSample = false
      setSource(side, '', null)
      input.focus()
    })
    input.addEventListener('input', scheduleRecompute)
    input.addEventListener('focus', () => {
      lastFocused = side
    })
    return { input, nameEl, element, fileName: null, eol: null }
  }

  const sources: Record<Side, SourcePanel> = { left: sourcePanel('left'), right: sourcePanel('right') }
  const sourcesBox = el('div', { class: 'merge-sources' }, sources.left.element, sources.right.element)

  // ── toolbar ──
  const stats = el('span', { class: 'hint merge-stats' })
  const picks = el('span', { class: 'hint merge-picks' })
  const wsInput = el('input', { type: 'checkbox' })
  wsInput.checked = readStored(IGNORE_WS_KEY) === '1'
  const wsText = el('span')
  const wsLabel = el('label', { class: 'find-opt' }, wsInput, wsText)
  const bulkButtons = BULK.map(([choice, label, tip]) => {
    const button = el('button', { class: `btn small merge-bulk pick-${choice}`, type: 'button' })
    localized(() => {
      button.textContent = t(label)
      button.title = t(tip)
    })
    button.addEventListener('click', () => applyAll(choice))
    return button
  })
  const bulk = el('div', { class: 'btn-group merge-bulk-group', role: 'group' }, ...bulkButtons)
  const prevBtn = iconButton('chevronUp', () => t('mg.prev'), { variant: 'ghost' })
  const nextBtn = iconButton('chevronDown', () => t('mg.next'), { variant: 'ghost' })
  const swapBtn = iconButton('swap', () => t('mg.swap'), { variant: 'ghost' })
  const sourcesBtn = el('button', { class: 'btn with-icon small ghost', type: 'button', 'aria-pressed': 'true' })
  const bar = el(
    'div',
    { class: 'pane-bar merge-bar' },
    sourcesBtn,
    stats,
    picks,
    el('span', { class: 'merge-spacer' }),
    wsLabel,
    bulk,
    prevBtn,
    nextBtn,
    swapBtn,
  )

  // ── diff view ──
  const view = createDiffView({
    diff: () => diff,
    choices: () => choices,
    isEmpty: () => sources.left.input.value === '' && sources.right.input.value === '',
    setChoice,
    applyAll,
    toggleSide,
  })

  // ── result ──
  const resultTitle = el('span', { class: 'merge-tag result' })
  const resultLines = el('span', { class: 'hint' })
  const resultHint = el('span', { class: 'hint merge-result-hint' })
  const copyBtn = iconButton('copy', () => t('mg.copy'), { variant: 'small ghost' })
  const output = el('textarea', { class: 'json-input merge-output', readonly: '', spellcheck: 'false', wrap: 'off' })
  const resultBox = el(
    'div',
    { class: 'merge-result' },
    el('div', { class: 'pane-bar' }, resultTitle, resultLines, el('span', { class: 'merge-spacer' }), copyBtn),
    output,
    resultHint,
  )

  const element = el(
    'section',
    { class: 'pane merge-pane' },
    sourcesBox,
    bar,
    el('div', { class: 'merge-body' }, view.element, resultBox),
  )

  // ── state ──
  let diff: LineDiff = diffLines('', '')
  let choices: Choice[] = []
  let recomputeTimer: number | undefined
  let handle: FileHandleLike | null = null
  let savedName: string | null = null
  let savedText = ''
  let merged = ''

  function refreshOutput(): void {
    merged = mergeText(diff, choices)
    output.value = merged
    const lineCount = merged === '' ? 0 : merged.split(diff.eol).length - (diff.trailingNewline ? 1 : 0)
    resultLines.textContent = t('mg.resultLines', { n: lineCount })
    const s = mergeStats(diff.rows, choices)
    stats.textContent = diff.blocks === 0 ? t('mg.identical') : t('mg.stats', { changes: s.changes, blocks: diff.blocks })
    picks.textContent = t('mg.picks', { m: s.manual, a: s.automate, b: s.both, n: s.none })
    picks.hidden = diff.blocks === 0
    notify()
  }

  function recompute(carry: boolean): void {
    window.clearTimeout(recomputeTimer)
    const { left, right } = sources
    const eol = (left.input.value !== '' ? left.eol : null) ?? (right.input.value !== '' ? right.eol : null) ?? '\n'
    const next = diffLines(left.input.value, right.input.value, { ignoreWhitespace: wsInput.checked, eol })
    choices = carry ? carryChoices(diff.rows, choices, next.rows) : defaultChoices(next.rows)
    diff = next
    view.render()
    refreshOutput()
  }

  function scheduleRecompute(): void {
    showingSample = false
    window.clearTimeout(recomputeTimer)
    recomputeTimer = window.setTimeout(() => recompute(true), RECOMPUTE_DELAY_MS)
  }

  // ── choices ──
  function setChoice(i: number, choice: Choice): void {
    choices[i] = fitChoice(diff.rows[i], choice)
    view.repaint(i)
    refreshOutput()
  }

  function applyAll(choice: Choice, block?: number): void {
    choices = applyToChanges(diff.rows, choices, choice, block)
    view.repaint()
    refreshOutput()
  }

  /** Clicking a line includes / excludes just that side of the row. */
  function toggleSide(i: number, side: Side): void {
    const row = diff.rows[i]
    const choice = choices[i]
    if (row.kind === 'same') {
      setChoice(i, choice === 'none' ? 'both' : 'none')
      return
    }
    const left = side === 'left' ? !includesLeft(choice) : includesLeft(choice)
    const right = side === 'right' ? !includesRight(choice) : includesRight(choice)
    setChoice(i, composeChoice(left, right))
  }

  // ── sources in / out ──
  function showName(panel: SourcePanel): void {
    panel.nameEl.textContent = panel.fileName ?? ''
    panel.nameEl.title = panel.fileName ?? ''
  }

  function setSource(side: Side, text: string, fileName: string | null): void {
    const panel = sources[side]
    panel.input.value = text
    panel.fileName = fileName
    panel.eol = text.includes('\r\n') ? '\r\n' : text.includes('\n') ? '\n' : null
    showName(panel)
    recompute(true)
  }

  function suggestedName(): string {
    if (savedName) return savedName
    const base = sources.left.fileName ?? sources.right.fileName
    return base ? mergedName(base) : DEFAULT_NAME
  }

  function loadInto(side: Side, file: OpenedFile): void {
    if (looksBinary(file.text)) {
      toast(t('msg.unsupported', { name: file.name }), true)
      return
    }
    if (showingSample) {
      showingSample = false
      for (const panel of [sources.left, sources.right]) {
        panel.input.value = ''
        panel.fileName = null
        panel.eol = null
        showName(panel)
      }
    }
    // New sources mean a new result: never overwrite a previously saved merge by accident.
    handle = null
    savedName = null
    setSource(side, file.text, file.name)
    toast(t('mg.loaded', { name: file.name, side: t(SIDE_LABEL[side]) }))
  }

  /** Where a file opened from the top bar goes: the first empty side, else the last one edited. */
  function sideForOpen(): Side {
    if (showingSample || sources.left.input.value === '') return 'left'
    if (sources.right.input.value === '') return 'right'
    return lastFocused
  }

  async function pickFile(side: Side): Promise<void> {
    try {
      const file = await openTextFile([SOURCE_KIND])
      if (file) loadInto(side, file)
    } catch (error) {
      toast(errorMessage(error), true)
    }
  }

  function swapSides(): void {
    const { left, right } = sources
    ;[left.input.value, right.input.value] = [right.input.value, left.input.value]
    ;[left.fileName, right.fileName] = [right.fileName, left.fileName]
    ;[left.eol, right.eol] = [right.eol, left.eol]
    showName(left)
    showName(right)
    // Mirror the current rows and picks so recompute() carries them over to the swapped diff.
    diff = {
      ...diff,
      rows: diff.rows.map((row): MergeRow => ({ ...row, left: row.right, right: row.left, leftNo: row.rightNo, rightNo: row.leftNo })),
    }
    choices = choices.map((c): Choice => (c === 'left' ? 'right' : c === 'right' ? 'left' : c))
    recompute(true)
  }

  function renderSourcesBtn(): void {
    const shown = !sourcesBox.hidden
    sourcesBtn.setAttribute('aria-pressed', String(shown))
    setIconButton(sourcesBtn, shown ? 'chevronUp' : 'chevronDown', t('mg.sourcesTip'), t('mg.sources'))
  }

  function toggleSources(): void {
    sourcesBox.hidden = !sourcesBox.hidden
    renderSourcesBtn()
  }

  function toggleIgnoreWs(): void {
    writeStored(IGNORE_WS_KEY, wsInput.checked ? '1' : '0')
    recompute(true)
  }

  wsInput.addEventListener('change', toggleIgnoreWs)
  prevBtn.addEventListener('click', () => view.goToBlock(-1))
  nextBtn.addEventListener('click', () => view.goToBlock(1))
  swapBtn.addEventListener('click', swapSides)
  sourcesBtn.addEventListener('click', toggleSources)
  copyBtn.addEventListener('click', async () => {
    const ok = await copyText(merged)
    toast(ok ? t('mg.copied') : t('msg.clipboard'), !ok)
  })

  localized(() => {
    wsText.textContent = t('mg.ignoreWs')
    bulk.setAttribute('aria-label', t('mg.bulkAria'))
    view.localize()
    resultTitle.textContent = t('mg.result')
    renderResultHint()
    output.setAttribute('aria-label', t('mg.resultAria'))
    renderSourcesBtn()
    // Rows carry localized tooltips and labels: rebuild them (picks are kept).
    recompute(true)
  })
  // The Save key in the hint follows the platform (⌘S on a Mac) and any rebinding.
  function renderResultHint(): void {
    resultHint.textContent = t('mg.resultHint', { save: keyHint('file.save') })
  }
  withShortcuts(renderResultHint)
  savedText = merged

  function loadSample(): void {
    handle = null
    savedName = null
    for (const [side, starter] of [['left', sample.manual], ['right', sample.automate]] as const) {
      const panel = sources[side]
      panel.input.value = starter.text
      panel.fileName = starter.fileName
      panel.eol = '\n'
      showName(panel)
    }
    showingSample = true
    recompute(false)
    savedText = merged
    notify()
  }

  const commands = (): Command[] => [
    { id: 'merge.left', title: t('mg.cmd.allLeft'), run: () => applyAll('left') },
    { id: 'merge.right', title: t('mg.cmd.allRight'), run: () => applyAll('right') },
    { id: 'merge.both', title: t('mg.cmd.allBoth'), run: () => applyAll('both') },
    { id: 'merge.none', title: t('mg.cmd.allNone'), run: () => applyAll('none') },
    { id: 'merge.next', title: t('mg.cmd.next'), run: () => view.goToBlock(1) },
    { id: 'merge.prev', title: t('mg.cmd.prev'), run: () => view.goToBlock(-1) },
    { id: 'merge.swap', title: t('mg.cmd.swap'), run: swapSides },
    {
      id: 'merge.ws',
      title: t('mg.cmd.ignoreWs'),
      run: () => {
        wsInput.checked = !wsInput.checked
        toggleIgnoreWs()
      },
    },
    { id: 'merge.loadLeft', title: t('mg.cmd.loadLeft'), run: () => void pickFile('left') },
    { id: 'merge.loadRight', title: t('mg.cmd.loadRight'), run: () => void pickFile('right') },
  ]

  return {
    id: 'merge',
    get label() {
      return t('tab.merge')
    },
    kind: KIND,
    extraExtensions: ['feature', 'robot', 'gherkin'],
    multiDoc: true,
    element,
    commands,
    loadSample,
    open(file: OpenedFile): void {
      loadInto(sideForOpen(), file)
    },
    acceptDrop(file: OpenedFile, target: EventTarget | null): boolean {
      if (!(target instanceof Node) || !element.contains(target)) return false
      const side: Side = sources.right.element.contains(target)
        ? 'right'
        : sources.left.element.contains(target)
          ? 'left'
          : sideForOpen()
      loadInto(side, file)
      return true
    },
    snapshot: () => ({ name: suggestedName(), text: merged, handle }),
    markSaved(name: string, savedHandle: FileHandleLike | null): void {
      savedName = name
      handle = savedHandle
      savedText = merged
      notify()
    },
    isDirty: () => merged !== savedText,
    onChange(listener: () => void): void {
      listeners.push(listener)
    },
  }
}
