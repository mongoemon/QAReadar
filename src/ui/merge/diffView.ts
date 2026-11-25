// The side-by-side diff: rows, block headers, folded unchanged lines and the pick buttons.
// It draws what the host holds and reports clicks; the choices themselves live in the tab.
import { t, type MessageKey } from '../../lib/i18n'
import { innerDiff, type Choice, type LineDiff, type MergeRow } from '../../lib/lineMerge'
import { el } from '../dom'
import { toast } from '../toast'

export type Side = 'left' | 'right'

/** Unchanged lines shown around each change; longer unchanged runs fold. */
const CONTEXT = 3

const PICK_TIP: Record<Choice, MessageKey> = {
  left: 'mg.pickLeft',
  right: 'mg.pickRight',
  both: 'mg.pickBoth',
  none: 'mg.pickNone',
}
const PICK_TEXT: Record<Choice, string> = { left: 'M', right: 'A', both: 'M+A', none: '✕' }
const ALL_PICKS: readonly Choice[] = ['left', 'right', 'both', 'none']

export interface DiffViewHost {
  diff(): LineDiff
  choices(): readonly Choice[]
  /** True when neither side has any text. */
  isEmpty(): boolean
  setChoice(row: number, choice: Choice): void
  applyAll(choice: Choice, block: number): void
  toggleSide(row: number, side: Side): void
}

export interface DiffView {
  readonly element: HTMLElement
  /** Rebuild everything from the current diff. */
  render(): void
  /** Show the current choice of one row, or of every row drawn so far. */
  repaint(row?: number): void
  goToBlock(delta: number): void
  /** Re-apply the column headings after a language change. */
  localize(): void
}

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

function pickButton(choice: Choice, attrs: Record<string, string>, tip: string): HTMLButtonElement {
  const button = el('button', { class: `mpick-btn pick-${choice}`, type: 'button', ...attrs }, PICK_TEXT[choice])
  button.title = tip
  button.setAttribute('aria-label', tip)
  return button
}

function rowCell(row: MergeRow, i: number, side: Side): HTMLElement {
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

function rowPicks(row: MergeRow, i: number): HTMLElement {
  const pick = el('div', { class: 'mpick' })
  if (row.kind === 'change') {
    pick.append(...picksFor(row).map((choice) => pickButton(choice, { 'data-pick': choice, 'data-i': String(i) }, t(PICK_TIP[choice]))))
  } else {
    pick.append(pickButton('none', { 'data-pick': 'toggle', 'data-i': String(i), class: 'mpick-btn pick-none same-toggle' }, ''))
  }
  return pick
}

function paintRow(node: HTMLElement, choice: Choice): void {
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

function blockHead(diff: LineDiff, block: number, firstRow: number): HTMLElement {
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

export function createDiffView(host: DiffViewHost): DiffView {
  const colLeft = el('span', { class: 'merge-tag left' })
  const colPick = el('span', { class: 'mhead-pick' })
  const colRight = el('span', { class: 'merge-tag right' })
  const head = el('div', { class: 'mhead' }, el('span'), colLeft, colPick, el('span'), colRight)
  const rowsBox = el('div', { class: 'mrows' })
  const emptyNote = el('p', { class: 'merge-empty' })
  const element = el('div', { class: 'merge-diff' }, head, rowsBox, emptyNote)

  let rowEls: Array<HTMLElement | undefined> = []
  let blockHeads: HTMLElement[] = []
  let currentBlock = -1

  function rowElement(i: number): HTMLElement {
    const row = host.diff().rows[i]
    const node = el(
      'div',
      { class: 'mrow', 'data-kind': row.kind },
      el('span', { class: 'mno' }, row.leftNo === null ? '' : String(row.leftNo)),
      rowCell(row, i, 'left'),
      rowPicks(row, i),
      el('span', { class: 'mno' }, row.rightNo === null ? '' : String(row.rightNo)),
      rowCell(row, i, 'right'),
    )
    paintRow(node, host.choices()[i])
    rowEls[i] = node
    return node
  }

  const rowRange = (from: number, to: number): HTMLElement[] =>
    Array.from({ length: Math.max(0, to - from) }, (_, n) => rowElement(from + n))

  function foldButton(from: number, to: number): HTMLElement {
    const button = el('button', { class: 'mfold', type: 'button' }, t('mg.fold', { n: to - from }))
    button.addEventListener('click', () => button.replaceWith(...rowRange(from, to)))
    return button
  }

  /** A run of unchanged lines: keep CONTEXT lines next to each change, fold the middle. */
  function unchangedRun(from: number, end: number): HTMLElement[] {
    const { rows, blocks } = host.diff()
    const foldFrom = from === 0 ? 0 : from + CONTEXT
    const foldTo = end === rows.length ? end : end - CONTEXT
    if (blocks === 0 || foldTo - foldFrom <= 2) return rowRange(from, end)
    return [...rowRange(from, foldFrom), foldButton(foldFrom, foldTo), ...rowRange(foldTo, end)]
  }

  function render(): void {
    const diff = host.diff()
    const { rows } = diff
    rowEls = new Array(rows.length)
    blockHeads = []
    currentBlock = -1
    const nodes: HTMLElement[] = []
    let i = 0
    while (i < rows.length) {
      const first = i
      if (rows[i].kind === 'change') {
        const { block } = rows[i]
        const headEl = blockHead(diff, block, i)
        blockHeads.push(headEl)
        while (i < rows.length && rows[i].block === block) i++
        nodes.push(headEl, ...rowRange(first, i))
        continue
      }
      while (i < rows.length && rows[i].kind === 'same') i++
      nodes.push(...unchangedRun(first, i))
    }
    rowsBox.replaceChildren(...nodes)
    const empty = host.isEmpty()
    emptyNote.hidden = !empty && diff.blocks > 0
    emptyNote.textContent = empty ? t('mg.empty') : t('mg.identical')
  }

  function repaint(row?: number): void {
    const choices = host.choices()
    if (row === undefined) {
      rowEls.forEach((node, i) => node && paintRow(node, choices[i]))
      return
    }
    const node = rowEls[row]
    if (node) paintRow(node, choices[row])
  }

  rowsBox.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement
    const blockBtn = target.closest<HTMLElement>('[data-block-pick]')
    if (blockBtn) {
      host.applyAll(blockBtn.dataset.blockPick as Choice, Number(blockBtn.dataset.block))
      return
    }
    const pickBtn = target.closest<HTMLElement>('[data-pick]')
    if (pickBtn) {
      const i = Number(pickBtn.dataset.i)
      if (pickBtn.dataset.pick === 'toggle') host.toggleSide(i, 'left')
      else host.setChoice(i, pickBtn.dataset.pick as Choice)
      return
    }
    const cell = target.closest<HTMLElement>('.mcell:not(.empty)')
    // Selecting text to copy it must not flip the pick.
    if (cell && !window.getSelection()?.toString()) host.toggleSide(Number(cell.dataset.i), cell.dataset.side as Side)
  })

  function goToBlock(delta: number): void {
    if (blockHeads.length === 0) {
      toast(t('mg.noChanges'))
      return
    }
    blockHeads[currentBlock]?.classList.remove('current')
    currentBlock =
      currentBlock < 0 && delta < 0 ? blockHeads.length - 1 : (currentBlock + delta + blockHeads.length) % blockHeads.length
    const headEl = blockHeads[currentBlock]
    headEl.classList.add('current')
    headEl.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  return {
    element,
    render,
    repaint,
    goToBlock,
    localize() {
      colLeft.textContent = t('mg.manual')
      colRight.textContent = t('mg.automate')
      colPick.textContent = t('mg.colPick')
    },
  }
}
