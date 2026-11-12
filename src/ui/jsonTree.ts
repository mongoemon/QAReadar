import { previewOf, typeOf, type PathSegment } from '../lib/jsonPath'
import { el } from './dom'

const PAGE_SIZE = 200

export interface TreeHandlers {
  onSelect(segments: readonly PathSegment[], value: unknown): void
}

interface Ctx {
  selected: HTMLElement | null
  readonly handlers: TreeHandlers
  /** Nodes shallower than this depth start expanded. */
  readonly openDepth: number
}

type Entry = readonly [PathSegment, unknown]

function entriesOf(value: unknown): Entry[] {
  if (Array.isArray(value)) return value.map((v, i): Entry => [i, v])
  if (value !== null && typeof value === 'object') return Object.entries(value)
  return []
}

function buildNode(
  ctx: Ctx,
  label: string,
  value: unknown,
  segments: readonly PathSegment[],
  depth: number,
): HTMLElement {
  const entries = entriesOf(value)
  const expandable = entries.length > 0
  const toggle = el('span', { class: 'jtoggle', 'aria-hidden': 'true' }, expandable ? '▸' : '')
  const row = el(
    'div',
    { class: 'jrow', role: 'treeitem', tabindex: '-1' },
    toggle,
    el('span', { class: 'jkey' }, label),
    el('span', { class: 'jsep' }, ':'),
    el('span', { class: `jval t-${typeOf(value)}` }, previewOf(value)),
  )
  const node = el('div', { class: 'jnode' }, row)
  let kids: HTMLElement | null = null

  const isOpen = (): boolean => kids !== null && !kids.hidden

  const setOpen = (open: boolean): void => {
    if (!expandable) return
    if (open && kids === null) {
      kids = el('div', { class: 'jchildren', role: 'group' })
      renderChunk(ctx, kids, entries, 0, segments, depth + 1)
      node.append(kids)
    }
    if (kids) kids.hidden = !open
    toggle.textContent = open ? '▾' : '▸'
    row.setAttribute('aria-expanded', String(open))
  }

  const select = (): void => {
    if (ctx.selected) {
      ctx.selected.classList.remove('selected')
      ctx.selected.tabIndex = -1
    }
    ctx.selected = row
    row.classList.add('selected')
    row.tabIndex = 0
    ctx.handlers.onSelect(segments, value)
  }

  row.addEventListener('click', (ev) => {
    select()
    if (ev.target === toggle) setOpen(!isOpen())
  })
  row.addEventListener('dblclick', () => setOpen(!isOpen()))
  row.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault()
      select()
    } else if (ev.key === 'ArrowRight' && expandable) {
      ev.preventDefault()
      setOpen(true)
    } else if (ev.key === 'ArrowLeft' && isOpen()) {
      ev.preventDefault()
      setOpen(false)
    }
  })

  if (depth < ctx.openDepth) setOpen(true)
  return node
}

function renderChunk(
  ctx: Ctx,
  parent: HTMLElement,
  entries: readonly Entry[],
  start: number,
  base: readonly PathSegment[],
  depth: number,
): void {
  const end = Math.min(start + PAGE_SIZE, entries.length)
  for (let i = start; i < end; i++) {
    const [key, value] = entries[i]
    const label = typeof key === 'number' ? `[${key}]` : key
    parent.append(buildNode(ctx, label, value, [...base, key], depth))
  }
  if (end < entries.length) {
    const more = el('button', { class: 'jmore', type: 'button' }, `… ${entries.length - end} more`)
    more.addEventListener('click', () => {
      more.remove()
      renderChunk(ctx, parent, entries, end, base, depth)
    })
    parent.append(more)
  }
}

function moveFocus(container: HTMLElement, direction: 1 | -1): void {
  const rows = [...container.querySelectorAll<HTMLElement>('.jrow')].filter(
    (row) => row.offsetParent !== null,
  )
  const current = rows.indexOf(document.activeElement as HTMLElement)
  const next = rows[Math.max(0, Math.min(rows.length - 1, current + direction))]
  next?.focus()
}

/** Builds a lazy, keyboard-navigable tree and selects the root node. */
export function renderTree(root: unknown, handlers: TreeHandlers, openDepth = 1): HTMLElement {
  const ctx: Ctx = { selected: null, handlers, openDepth }
  const container = el('div', { class: 'jtree', role: 'tree' })
  const rootNode = buildNode(ctx, '$', root, [], 0)
  container.append(rootNode)
  container.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault()
      moveFocus(container, ev.key === 'ArrowDown' ? 1 : -1)
    }
  })
  rootNode.querySelector<HTMLElement>('.jrow')?.click()
  return container
}
