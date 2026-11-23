import {
  DELIMITER_NAMES,
  DELIMITERS,
  detectDelimiter,
  isDelimiter,
  isNumeric,
  parseCsv,
  quoteField,
  type CsvRow,
  type CsvTable,
  type Delimiter,
} from '../lib/csv'
import { localized, t } from '../lib/i18n'
import { readStored, writeStored } from '../lib/safeStorage'
import { el } from './dom'
import { icon } from './icons'

const HEADER_KEY = 'qareadar:csv-header'
/** Rows rendered at once; "Show more" adds another page. Keeps huge files responsive. */
const PAGE = 500

export interface CsvViewHost {
  getText(): string
  getFileName(): string
  /** Replace a range of the document (a cell edit). */
  replace(start: number, end: number, text: string): void
  /** Leave the table and show this 1-based line in the text view. */
  revealLine(line: number): void
}

export interface CsvView {
  /** The table area (goes where the text editor is). */
  readonly element: HTMLElement
  /** Table controls (go in the tab's toolbar). */
  readonly controls: HTMLElement
  /** Re-parse and redraw from the host's text. */
  render(): void
  /** A new file was loaded: back to auto delimiter, no sort / filter. */
  reset(): void
  focusFilter(): void
  /** One-line summary for the status bar. */
  summary(): string
}

type SortDir = 'asc' | 'desc'

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Column count rows are checked against: the header's, or the most common one. */
function expectedColumns(rows: readonly CsvRow[], header: boolean): number {
  if (header && rows[0]) return rows[0].cells.length
  const freq = new Map<number, number>()
  for (const row of rows) freq.set(row.cells.length, (freq.get(row.cells.length) ?? 0) + 1)
  let best = 0
  let bestN = -1
  for (const [cols, n] of freq) if (n > bestN) [best, bestN] = [cols, n]
  return best
}

export function createCsvView(host: CsvViewHost): CsvView {
  let choice: Delimiter | 'auto' = 'auto'
  let header = readStored(HEADER_KEY) !== 'off'
  let sort: { col: number; dir: SortDir } | null = null
  let filter = ''
  let onlyBad = false
  let limit = PAGE
  let table: CsvTable = { rows: [], columns: 0, unterminated: false }
  let delimiter: Delimiter = ','
  let shownCount = 0

  // ── controls ──
  const delimSelect = el('select', { class: 'te-tools csv-delim' })
  const headerBox = el('input', { type: 'checkbox' })
  const headerLabel = el('span', {})
  const headerOpt = el('label', { class: 'find-opt csv-header-opt' }, headerBox, headerLabel)
  const filterInput = el('input', { class: 'csv-filter', type: 'search', spellcheck: 'false' })
  const badCountEl = el('span', { class: 'btn-label' })
  const badBtn = el('button', { class: 'btn with-icon small ghost csv-bad-btn', type: 'button', 'aria-pressed': 'false' }, icon('alert'), badCountEl)
  const controls = el('div', { class: 'csv-controls' }, delimSelect, headerOpt, filterInput, badBtn)

  // ── table ──
  const thead = el('thead', {})
  const tbody = el('tbody', {})
  const grid = el('table', { class: 'csv-table' }, thead, tbody)
  const moreBtn = el('button', { class: 'btn small csv-more', type: 'button' })
  const empty = el('div', { class: 'csv-empty-note' })
  const scroller = el('div', { class: 'csv-scroll', tabindex: '-1' }, grid, moreBtn, empty)
  const element = el('div', { class: 'csv-view' }, scroller)

  const width = (): number => table.columns

  function renderDelimOptions(): void {
    const auto = el('option', { value: 'auto' }, t('csv.delimAuto', { d: DELIMITER_NAMES[delimiter] }))
    const fixed = DELIMITERS.map((d) => el('option', { value: d }, t('csv.delimIs', { d: DELIMITER_NAMES[d] })))
    for (const option of [auto, ...fixed]) option.selected = option.value === choice
    delimSelect.replaceChildren(auto, ...fixed)
  }

  function headerCell(col: number, name: string, editable: boolean): HTMLTableCellElement {
    const dir = sort?.col === col ? sort.dir : null
    const sortBtn = el(
      'button',
      { class: 'csv-sort', type: 'button', 'data-sort': String(col), title: t('csv.sortTip'), 'aria-label': t('csv.sortTip') },
      dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '↕',
    )
    const th = el('th', { scope: 'col' }, el('div', { class: 'csv-th' }, el('span', { class: 'csv-name' }, name), sortBtn))
    if (dir) {
      th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending')
      sortBtn.classList.add('active')
    }
    if (editable) {
      th.dataset.r = '0'
      th.dataset.c = String(col)
    }
    return th
  }

  function bodyCell(row: CsvRow, r: number, col: number): HTMLTableCellElement {
    const cell = row.cells[col]
    const td = el('td', { 'data-r': String(r), 'data-c': String(col) })
    if (!cell) td.className = 'csv-missing'
    else if (cell.value === '') td.className = 'csv-blank'
    else {
      td.textContent = cell.value
      if (isNumeric(cell.value)) td.className = 'csv-num'
    }
    return td
  }

  function render(): void {
    const text = host.getText()
    delimiter = choice === 'auto' ? detectDelimiter(text, host.getFileName()) : choice
    table = parseCsv(text, delimiter)
    renderDelimOptions()
    headerBox.checked = header

    const cols = width()
    const all = table.rows
    const head = header ? all[0] : undefined
    const expected = expectedColumns(all, header)
    const isBad = (row: CsvRow): boolean => row.cells.length !== expected

    // Indices into `all`, so an edit can find its row back after sorting / filtering.
    let body = all.map((_, i) => i).slice(head ? 1 : 0)
    const badCount = body.filter((i) => isBad(all[i])).length
    if (onlyBad) body = body.filter((i) => isBad(all[i]))
    const needle = filter.trim().toLocaleLowerCase()
    if (needle) body = body.filter((i) => all[i].cells.some((c) => c.value.toLocaleLowerCase().includes(needle)))
    if (sort) {
      const { col, dir } = sort
      const sign = dir === 'asc' ? 1 : -1
      body.sort((a, b) => sign * collator.compare(all[a].cells[col]?.value ?? '', all[b].cells[col]?.value ?? ''))
    }
    shownCount = body.length

    const corner = el('th', { class: 'csv-rownum', scope: 'col', title: t('csv.lineTip') }, '#')
    const headCells = Array.from({ length: cols }, (_, c) =>
      headerCell(c, head?.cells[c]?.value || t('csv.col', { n: c + 1 }), head !== undefined),
    )
    thead.replaceChildren(el('tr', {}, corner, ...headCells))

    tbody.replaceChildren(
      ...body.slice(0, limit).map((i) => {
        const row = all[i]
        const num = el('th', { class: 'csv-rownum', scope: 'row', 'data-line': String(row.line), title: t('csv.lineTip') }, String(row.line))
        const tr = el('tr', {}, num, ...Array.from({ length: cols }, (_, c) => bodyCell(row, i, c)))
        if (isBad(row)) {
          tr.classList.add('csv-bad')
          tr.title = t('csv.badRow', { n: row.cells.length, expected })
        }
        return tr
      }),
    )

    moreBtn.hidden = body.length <= limit
    moreBtn.textContent = t('csv.more', { shown: Math.min(limit, body.length), total: body.length })
    grid.hidden = all.length === 0
    empty.hidden = all.length > 0 && body.length > 0
    empty.textContent = all.length === 0 ? t('csv.emptyFile') : t('csv.noMatch')

    badBtn.hidden = badCount === 0 && !onlyBad
    badBtn.setAttribute('aria-pressed', String(onlyBad))
    badCountEl.textContent = String(badCount)
    badBtn.title = t('csv.onlyBad', { n: badCount, expected })
  }

  // ── cell editing: double-click; Enter commits, Shift+Enter adds a line break, Esc cancels ──
  function commitEdit(r: number, c: number, value: string): void {
    const row = table.rows[r]
    if (!row) return
    const cell = row.cells[c]
    if (cell) {
      if (cell.value !== value) host.replace(cell.start, cell.end, quoteField(value, delimiter))
    } else if (value !== '') {
      // A short row: pad the missing cells with delimiters.
      host.replace(row.end, row.end, delimiter.repeat(c - row.cells.length + 1) + quoteField(value, delimiter))
    }
  }

  function startEdit(target: HTMLElement): void {
    const r = Number(target.dataset.r)
    const c = Number(target.dataset.c)
    const original = table.rows[r]?.cells[c]?.value ?? ''
    const box = el('textarea', { class: 'csv-edit', spellcheck: 'false', rows: String(Math.min(8, original.split('\n').length)) })
    box.value = original
    target.classList.add('csv-editing')
    target.replaceChildren(box)
    box.focus()
    box.select?.()
    let done = false
    const finish = (save: boolean): void => {
      if (done) return
      done = true
      if (save) commitEdit(r, c, box.value)
      render()
    }
    box.addEventListener('keydown', (ev) => {
      ev.stopPropagation()
      if (ev.key === 'Escape') {
        ev.preventDefault()
        finish(false)
      } else if (ev.key === 'Enter' && !ev.shiftKey && !ev.altKey) {
        ev.preventDefault()
        finish(true)
      }
    })
    box.addEventListener('blur', () => finish(true))
  }

  // ── wiring ──
  grid.addEventListener('click', (ev) => {
    const sortBtn = (ev.target as HTMLElement).closest<HTMLElement>('[data-sort]')
    if (!sortBtn) return
    const col = Number(sortBtn.dataset.sort)
    sort = sort?.col !== col ? { col, dir: 'asc' } : sort.dir === 'asc' ? { col, dir: 'desc' } : null
    render()
  })
  grid.addEventListener('dblclick', (ev) => {
    const target = ev.target as HTMLElement
    if (target.closest('.csv-edit, [data-sort]')) return
    const lineCell = target.closest<HTMLElement>('[data-line]')
    if (lineCell) {
      host.revealLine(Number(lineCell.dataset.line))
      return
    }
    const cell = target.closest<HTMLElement>('[data-r][data-c]')
    if (cell) {
      window.getSelection?.()?.removeAllRanges()
      startEdit(cell)
    }
  })
  delimSelect.addEventListener('change', () => {
    const value = delimSelect.value
    choice = isDelimiter(value) ? value : 'auto'
    sort = null
    render()
  })
  headerBox.addEventListener('change', () => {
    header = headerBox.checked
    writeStored(HEADER_KEY, header ? 'on' : 'off')
    sort = null
    render()
  })
  filterInput.addEventListener('input', () => {
    filter = filterInput.value
    limit = PAGE
    render()
  })
  badBtn.addEventListener('click', () => {
    onlyBad = !onlyBad
    render()
  })
  moreBtn.addEventListener('click', () => {
    limit += PAGE
    render()
  })

  localized(() => {
    headerLabel.textContent = t('csv.header')
    headerOpt.title = t('csv.headerTip')
    filterInput.placeholder = t('csv.filter')
    filterInput.setAttribute('aria-label', t('csv.filter'))
    delimSelect.title = t('csv.delimTip')
    delimSelect.setAttribute('aria-label', t('csv.delimTip'))
    grid.setAttribute('aria-label', t('csv.aria'))
    if (!element.hidden) render()
  })

  return {
    element,
    controls,
    render,
    reset() {
      choice = 'auto'
      sort = null
      filter = ''
      filterInput.value = ''
      onlyBad = false
      limit = PAGE
      scroller.scrollTo?.(0, 0)
    },
    focusFilter() {
      filterInput.focus()
      filterInput.select()
    },
    summary() {
      const total = Math.max(0, table.rows.length - (header && table.rows.length > 0 ? 1 : 0))
      const parts = [t('csv.summary', { rows: total, cols: width(), d: DELIMITER_NAMES[delimiter] })]
      if (shownCount !== total) parts.push(t('csv.shown', { n: shownCount }))
      if (table.unterminated) parts.push(t('csv.unterminated'))
      return parts.join(' · ')
    },
  }
}
