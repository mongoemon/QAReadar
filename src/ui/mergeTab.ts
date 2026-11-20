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
  innerDiff,
  mergeStats,
  mergeText,
  type Choice,
  type LineDiff,
  type MergeRow,
} from '../lib/lineMerge'
import { readStored, writeStored } from '../lib/safeStorage'
import type { Starter } from '../lib/samples'
import { copyText } from './clipboard'
import { el } from './dom'
import { iconButton, setIconButton } from './icons'
import { errorMessage, toast } from './toast'
import type { TabController } from './types'

type Side = 'left' | 'right'

const RECOMPUTE_DELAY_MS = 250
const DEFAULT_NAME = 'merged-test-cases.txt'
const IGNORE_WS_KEY = 'qareadar:merge-ignore-ws'
/** Unchanged lines shown around each change; longer unchanged runs fold. */
const CONTEXT = 3

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
const PICK_TIP: Record<Choice, MessageKey> = {
  left: 'mg.pickLeft',
  right: 'mg.pickRight',
  both: 'mg.pickBoth',
  none: 'mg.pickNone',
}
const PICK_TEXT: Record<Choice, string> = { left: 'M', right: 'A', both: 'M+A', none: '✕' }
const ALL_PICKS: readonly Choice[] = ['left', 'right', 'both', 'none']
const BULK: ReadonlyArray<readonly [Choice, MessageKey, MessageKey]> = [
  ['left', 'mg.allLeft', 'mg.allLeftTip'],
  ['right', 'mg.allRight', 'mg.allRightTip'],
  ['both', 'mg.allBoth', 'mg.allBothTip'],
  ['none', 'mg.allNone', 'mg.allNoneTip'],
]

/** Picks offered for a row: one-sided rows only have their side or nothing. */
function picksFor(row: MergeRow): readonly Choice[] {
  if (row.left !== null && row.right !== null) return ALL_PICKS
  return [row.left !== null ? 'left' : 'right', 'none']
}

/** Line text, with the part that differs from the paired line wrapped in <mark>. */
function lineText(text: string | null, other: string | null): HTMLElement {
  const span = el('span', { class: 'mtext' })
  if (text === null) return span
  if (other === null || text === other) {
    span.textContent = text
    return span
  }
  const { prefix, suffix } = innerDiff(text, other)
  const middle = text.slice(prefix, text.length - suffix)
  span.append(text.slice(0, prefix))
  if (middle) span.append(el('mark', {}, middle))
  span.append(text.slice(text.length - suffix))
  return span
}

function mergedName(base: string): string {
  const dot = base.lastIndexOf('.')
  return dot > 0 ? `${base.slice(0, dot)}.merged${base.slice(dot)}` : `${base}.merged.txt`
}

export function createMergeTab(starter?: { readonly manual: Starter; readonly automate: Starter }): TabController {
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
  const colLeft = el('span', { class: 'merge-tag left' })
  const colPick = el('span', { class: 'mhead-pick' })
  const colRight = el('span', { class: 'merge-tag right' })
  const diffHead = el('div', { class: 'mhead' }, el('span'), colLeft, colPick, el('span'), colRight)
  const diffRows = el('div', { class: 'mrows' })
  const diffEmpty = el('p', { class: 'merge-empty' })
  const diffView = el('div', { class: 'merge-diff' }, diffHead, diffRows, diffEmpty)

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
    el('div', { class: 'merge-body' }, diffView, resultBox),
  )

  // ── state ──
  let diff: LineDiff = diffLines('', '')
  let choices: Choice[] = []
  let rowEls: Array<HTMLElement | undefined> = []
  let blockHeads: HTMLElement[] = []
  let currentBlock = -1
  let recomputeTimer: number | undefined
  let handle: FileHandleLike | null = null
  let savedName: string | null = null
  let savedText = ''
  let merged = ''

  // ── rendering ──
  function pickButton(choice: Choice, attrs: Record<string, string>, tip: string): HTMLButtonElement {
    const button = el('button', { class: `mpick-btn pick-${choice}`, type: 'button', ...attrs }, PICK_TEXT[choice])
    button.title = tip
    button.setAttribute('aria-label', tip)
    return button
  }

  function rowElement(i: number): HTMLElement {
    const row = diff.rows[i]
    const cell = (side: Side): HTMLElement => {
      const text = side === 'left' ? row.left : row.right
      const other = row.kind === 'change' ? (side === 'left' ? row.right : row.left) : null
      const node = el(
        'div',
        { class: `mcell ${side}${text === null ? ' empty' : ''}`, 'data-side': side, 'data-i': String(i) },
        lineText(text, other),
      )
      if (text !== null) node.title = t('mg.cellTip')
      return node
    }
    const pick = el('div', { class: 'mpick' })
    if (row.kind === 'change') {
      pick.append(...picksFor(row).map((choice) => pickButton(choice, { 'data-pick': choice, 'data-i': String(i) }, t(PICK_TIP[choice]))))
    } else {
      pick.append(pickButton('none', { 'data-pick': 'toggle', 'data-i': String(i), class: 'mpick-btn pick-none same-toggle' }, ''))
    }
    const node = el(
      'div',
      { class: 'mrow', 'data-kind': row.kind },
      el('span', { class: 'mno' }, row.leftNo === null ? '' : String(row.leftNo)),
      cell('left'),
      pick,
      el('span', { class: 'mno' }, row.rightNo === null ? '' : String(row.rightNo)),
      cell('right'),
    )
    paintRow(node, i)
    return node
  }

  function paintRow(node: HTMLElement, i: number): void {
    const choice = choices[i]
    node.dataset.choice = choice
    for (const button of node.querySelectorAll<HTMLButtonElement>('[data-pick]')) {
      if (button.dataset.pick === 'toggle') {
        const dropped = choice === 'none'
        button.setAttribute('aria-pressed', String(dropped))
        button.title = t(dropped ? 'mg.keepSame' : 'mg.dropSame')
        button.setAttribute('aria-label', button.title)
      } else {
        button.setAttribute('aria-pressed', String(button.dataset.pick === choice))
      }
    }
  }

  function blockHead(block: number, firstRow: number): HTMLElement {
    let m = 0
    let a = 0
    for (let i = firstRow; i < diff.rows.length && diff.rows[i].block === block; i++) {
      if (diff.rows[i].left !== null) m++
      if (diff.rows[i].right !== null) a++
    }
    const buttons = ALL_PICKS.map((choice) =>
      pickButton(choice, { 'data-block-pick': choice, 'data-block': String(block) }, t('mg.blockPick', { pick: t(PICK_TIP[choice]) })),
    )
    return el(
      'div',
      { class: 'mblock-head' },
      el('span', { class: 'mblock-title' }, t('mg.block', { n: block + 1, total: diff.blocks })),
      el('span', { class: 'hint' }, t('mg.blockLines', { m, a })),
      el('span', { class: 'merge-spacer' }),
      ...buttons,
    )
  }

  function foldButton(from: number, to: number): HTMLElement {
    const button = el('button', { class: 'mfold', type: 'button' }, t('mg.fold', { n: to - from }))
    button.addEventListener('click', () => {
      const rows: HTMLElement[] = []
      for (let i = from; i < to; i++) {
        const node = rowElement(i)
        rowEls[i] = node
        rows.push(node)
      }
      button.replaceWith(...rows)
    })
    return button
  }

  function renderDiff(): void {
    const rows = diff.rows
    rowEls = new Array(rows.length)
    blockHeads = []
    currentBlock = -1
    const nodes: HTMLElement[] = []
    const addRow = (i: number): void => {
      const node = rowElement(i)
      rowEls[i] = node
      nodes.push(node)
    }
    let i = 0
    while (i < rows.length) {
      if (rows[i].kind === 'change') {
        const block = rows[i].block
        const head = blockHead(block, i)
        blockHeads.push(head)
        nodes.push(head)
        while (i < rows.length && rows[i].block === block) addRow(i++)
        continue
      }
      // A run of unchanged lines: keep CONTEXT lines next to each change, fold the middle.
      let end = i
      while (end < rows.length && rows[end].kind === 'same') end++
      const foldFrom = i === 0 ? 0 : i + CONTEXT
      const foldTo = end === rows.length ? end : end - CONTEXT
      if (diff.blocks > 0 && foldTo - foldFrom > 2) {
        for (let j = i; j < foldFrom; j++) addRow(j)
        nodes.push(foldButton(foldFrom, foldTo))
        for (let j = foldTo; j < end; j++) addRow(j)
      } else {
        for (let j = i; j < end; j++) addRow(j)
      }
      i = end
    }
    diffRows.replaceChildren(...nodes)
    const empty = sources.left.input.value === '' && sources.right.input.value === ''
    diffEmpty.hidden = !empty && diff.blocks > 0
    diffEmpty.textContent = empty ? t('mg.empty') : t('mg.identical')
  }

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
    renderDiff()
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
    const node = rowEls[i]
    if (node) paintRow(node, i)
    refreshOutput()
  }

  function applyAll(choice: Choice, block?: number): void {
    choices = applyToChanges(diff.rows, choices, choice, block)
    rowEls.forEach((node, i) => node && paintRow(node, i))
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

  diffRows.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement
    const blockBtn = target.closest<HTMLElement>('[data-block-pick]')
    if (blockBtn) {
      applyAll(blockBtn.dataset.blockPick as Choice, Number(blockBtn.dataset.block))
      return
    }
    const pickBtn = target.closest<HTMLElement>('[data-pick]')
    if (pickBtn) {
      const i = Number(pickBtn.dataset.i)
      if (pickBtn.dataset.pick === 'toggle') toggleSide(i, 'left')
      else setChoice(i, pickBtn.dataset.pick as Choice)
      return
    }
    const cell = target.closest<HTMLElement>('.mcell:not(.empty)')
    // Selecting text to copy it must not flip the pick.
    if (cell && !window.getSelection()?.toString()) toggleSide(Number(cell.dataset.i), cell.dataset.side as Side)
  })

  function goToBlock(delta: number): void {
    if (blockHeads.length === 0) {
      toast(t('mg.noChanges'))
      return
    }
    blockHeads[currentBlock]?.classList.remove('current')
    currentBlock =
      currentBlock < 0 && delta < 0 ? blockHeads.length - 1 : (currentBlock + delta + blockHeads.length) % blockHeads.length
    const head = blockHeads[currentBlock]
    head.classList.add('current')
    head.scrollIntoView({ block: 'start', behavior: 'smooth' })
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
  prevBtn.addEventListener('click', () => goToBlock(-1))
  nextBtn.addEventListener('click', () => goToBlock(1))
  swapBtn.addEventListener('click', swapSides)
  sourcesBtn.addEventListener('click', toggleSources)
  copyBtn.addEventListener('click', async () => {
    const ok = await copyText(merged)
    toast(ok ? t('mg.copied') : t('msg.clipboard'), !ok)
  })

  if (starter) {
    sources.left.input.value = starter.manual.text
    sources.right.input.value = starter.automate.text
    showingSample = true
  }

  localized(() => {
    wsText.textContent = t('mg.ignoreWs')
    bulk.setAttribute('aria-label', t('mg.bulkAria'))
    colLeft.textContent = t('mg.manual')
    colRight.textContent = t('mg.automate')
    colPick.textContent = t('mg.colPick')
    resultTitle.textContent = t('mg.result')
    resultHint.textContent = t('mg.resultHint')
    output.setAttribute('aria-label', t('mg.resultAria'))
    renderSourcesBtn()
    // Rows carry localized tooltips and labels: rebuild them (picks are kept).
    recompute(true)
  })
  savedText = merged

  const commands = (): Command[] => [
    { id: 'merge.left', title: t('mg.cmd.allLeft'), run: () => applyAll('left') },
    { id: 'merge.right', title: t('mg.cmd.allRight'), run: () => applyAll('right') },
    { id: 'merge.both', title: t('mg.cmd.allBoth'), run: () => applyAll('both') },
    { id: 'merge.none', title: t('mg.cmd.allNone'), run: () => applyAll('none') },
    { id: 'merge.next', title: t('mg.cmd.next'), run: () => goToBlock(1) },
    { id: 'merge.prev', title: t('mg.cmd.prev'), run: () => goToBlock(-1) },
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
