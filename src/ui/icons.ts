import { localized } from '../lib/i18n'
import { withShortcuts } from '../lib/shortcuts'
import { el } from './dom'

/**
 * Inline stroke icons (24×24 grid, Lucide-style shapes, ISC licence).
 * Built with createElementNS — no innerHTML, no runtime dependency.
 */
type Shape = readonly [tag: 'path' | 'circle' | 'rect', attrs: Readonly<Record<string, string>>]

const p = (d: string): Shape => ['path', { d }]
const circle = (cx: number, cy: number, r: number): Shape => ['circle', { cx: String(cx), cy: String(cy), r: String(r) }]
const rect = (x: number, y: number, w: number, h: number, rx: number): Shape =>
  ['rect', { x: String(x), y: String(y), width: String(w), height: String(h), rx: String(rx) }]

const ICONS = {
  open: [p('m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2')],
  recent: [p('M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8'), p('M3 3v5h5'), p('M12 7v5l4 2')],
  save: [
    p('M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z'),
    p('M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7'),
    p('M7 3v4a1 1 0 0 0 1 1h7'),
  ],
  saveAs: [
    p('M10 2v3a1 1 0 0 0 1 1h5'),
    p('M18 18v-6a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6'),
    p('M18 22H4a2 2 0 0 1-2-2V6'),
    p('M8 18a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9.172a2 2 0 0 1 1.414.586l2.828 2.828A2 2 0 0 1 22 6.828V16a2 2 0 0 1-2.01 2z'),
  ],
  sun: [
    circle(12, 12, 4),
    p('M12 2v2'), p('M12 20v2'), p('m4.93 4.93 1.41 1.41'), p('m17.66 17.66 1.41 1.41'),
    p('M2 12h2'), p('M20 12h2'), p('m6.34 17.66-1.41 1.41'), p('m19.07 4.93-1.41 1.41'),
  ],
  moon: [p('M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z')],
  monitor: [rect(2, 3, 20, 14, 2), p('M8 21h8'), p('M12 17v4')],
  command: [p('M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3')],
  refresh: [
    p('M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8'), p('M21 3v5h-5'),
    p('M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16'), p('M8 16H3v5'),
  ],
  outline: [p('M21 12h-8'), p('M21 6H8'), p('M21 18h-8'), p('M3 6v4c0 1.1.9 2 2 2h3'), p('M3 10v6c0 1.1.9 2 2 2h3')],
  search: [circle(11, 11, 8), p('m21 21-4.3-4.3')],
  book: [
    p('M12 7v14'),
    p('M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z'),
  ],
  code: [p('m16 18 6-6-6-6'), p('m8 6-6 6 6 6')],
  textSmaller: [p('M3.5 13h6'), p('m2 16 4.5-9 4.5 9'), p('M18 7v9'), p('m14 12 4 4 4-4')],
  textLarger: [p('M3.5 13h6'), p('m2 16 4.5-9 4.5 9'), p('M18 16V7'), p('m14 11 4-4 4 4')],
  widthNarrow: [p('M2 12h6'), p('M22 12h-6'), p('m5 9 3 3-3 3'), p('m19 9-3 3 3 3'), p('M12 4v16')],
  widthNormal: [p('M3 12h18'), p('m7 8-4 4 4 4'), p('m17 8 4 4-4 4')],
  widthWide: [p('M3 12h18'), p('m7 8-4 4 4 4'), p('m17 8 4 4-4 4'), p('M3 4v16'), p('M21 4v16')],
  copy: [rect(8, 8, 14, 14, 2), p('M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2')],
  chevronUp: [p('m18 15-6-6-6 6')],
  chevronDown: [p('m6 9 6 6 6-6')],
  close: [p('M18 6 6 18'), p('m6 6 12 12')],
  plus: [p('M5 12h14'), p('M12 5v14')],
  replace: [p('M14 4a1 1 0 0 1 1-1'), p('M15 10a1 1 0 0 1-1-1'), p('M21 4a1 1 0 0 0-1-1'), p('M21 9a1 1 0 0 1-1 1'), p('m3 7 3 3 3-3'), p('M6 10V5a2 2 0 0 1 2-2h2'), rect(3, 14, 7, 7, 1)],
  replaceAll: [p('M14 14a1 1 0 0 1 1-1'), p('M14 4a1 1 0 0 1 1-1'), p('M15 10a1 1 0 0 1-1-1'), p('M21 14a1 1 0 0 0-1-1'), p('M21 4a1 1 0 0 0-1-1'), p('M21 9a1 1 0 0 1-1 1'), p('m3 7 3 3 3-3'), p('M6 10V5a2 2 0 0 1 2-2h2'), rect(3, 14, 7, 7, 1), p('M21 20a1 1 0 0 1-1 1'), p('M15 21a1 1 0 0 1-1-1')],
  braces: [
    p('M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1'),
    p('M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1'),
  ],
  minify: [p('m14 10 7-7'), p('M20 10h-6V4'), p('m3 21 7-7'), p('M4 14h6v6')],
  alert: [circle(12, 12, 10), p('M12 8v4'), p('M12 16h.01')],
  parent: [p('M14 9 9 4 4 9'), p('M20 20h-7a4 4 0 0 1-4-4V4')],
  fileText: [
    p('M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z'), p('M14 2v4a2 2 0 0 0 2 2h4'),
    p('M10 9H8'), p('M16 13H8'), p('M16 17H8'),
  ],
  externalLink: [p('M15 3h6v6'), p('M10 14 21 3'), p('M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6')],
  crosshair: [circle(12, 12, 10), p('M22 12h-4'), p('M6 12H2'), p('M12 6V2'), p('M12 22v-4')],
  languages: [p('m5 8 6 6'), p('m4 14 6-6 2-3'), p('M2 5h12'), p('M7 2h1'), p('m22 22-5-10-5 10'), p('M14 18h6')],
  gitCompare: [circle(18, 18, 3), circle(6, 6, 3), p('M13 6h3a2 2 0 0 1 2 2v7'), p('M11 18H8a2 2 0 0 1-2-2V9')],
  swap: [p('M8 3 4 7l4 4'), p('M4 7h16'), p('m16 21 4-4-4-4'), p('M20 17H4')],
  wrap: [p('M3 6h18'), p('M3 12h15a3 3 0 1 1 0 6h-4'), p('m16 16-2 2 2 2'), p('M3 18h7')],
  table: [rect(3, 3, 18, 18, 2), p('M3 9h18'), p('M3 15h18'), p('M12 3v18')],
  columns: [rect(3, 3, 18, 18, 2), p('M12 3v18')],
  hash: [p('M4 9h16'), p('M4 15h16'), p('M10 3 8 21'), p('M16 3l-2 18')],
  notepad: [p('M13 21h8'), p('m15 5 4 4'), p('M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z')],
  focus: [p('M8 3H5a2 2 0 0 0-2 2v3'), p('M21 8V5a2 2 0 0 0-2-2h-3'), p('M3 16v3a2 2 0 0 0 2 2h3'), p('M16 21h3a2 2 0 0 0 2-2v-3')],
  exitFocus: [p('M8 3v3a2 2 0 0 1-2 2H3'), p('M21 8h-3a2 2 0 0 1-2-2V3'), p('M3 16h3a2 2 0 0 1 2 2v3'), p('M16 21v-3a2 2 0 0 1 2-2h3')],
  sample: [
    p('M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2'),
    p('M6.453 15h11.094'), p('M8.5 2h7'),
  ],
  keyboard: [rect(2, 4, 20, 16, 2), p('M6 8h.01'), p('M10 8h.01'), p('M14 8h.01'), p('M18 8h.01'), p('M8 12h.01'), p('M12 12h.01'), p('M16 12h.01'), p('M7 16h10')],
  duplicate: [p('M15 12v6'), p('M12 15h6'), rect(8, 8, 14, 14, 2), p('M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2')],
  filePdf: [
    p('M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z'), p('M14 2v4a2 2 0 0 0 2 2h4'),
    p('M9 13h1.5a1.5 1.5 0 0 1 0 3H9v-3z'), p('M9 16v2'), p('M14 18v-5h2'), p('M14 15.5h1.5'),
  ],
  mouse: [p('M12.586 12.586 19 19'), p('M3.688 3.037a.497.497 0 0 0-.651.651l6.5 15.999a.501.501 0 0 0 .947-.062l1.569-6.083a2 2 0 0 1 1.448-1.479l6.124-1.579a.5.5 0 0 0 .063-.947z')],
  type: [p('M4 7V4h16v3'), p('M9 20h6'), p('M12 4v16')],
  highlighter: [p('m9 11-6 6v3h9l3-3'), p('m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4')],
  square: [rect(3, 3, 18, 18, 2)],
  eraser: [p('m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21'), p('M22 21H7'), p('m5 11 9 9')],
  pen: [p('M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z'), p('m15 5 4 4')],
  undo: [p('M3 7v6h6'), p('M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13')],
  redo: [p('M21 7v6h-6'), p('M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7')],
  rotateCw: [p('M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8'), p('M21 3v5h-5')],
  rotateCcw: [p('M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8'), p('M3 3v5h5')],
  trash: [p('M3 6h18'), p('M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6'), p('M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2')],
  arrowUp: [p('m5 12 7-7 7 7'), p('M12 19V5')],
  arrowDown: [p('M12 5v14'), p('m19 12-7 7-7-7')],
  zoomIn: [circle(11, 11, 8), p('m21 21-4.3-4.3'), p('M11 8v6'), p('M8 11h6')],
  zoomOut: [circle(11, 11, 8), p('m21 21-4.3-4.3'), p('M8 11h6')],
  download: [p('M12 15V3'), p('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'), p('m7 10 5 5 5-5')],
  filePlus: [p('M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z'), p('M14 2v4a2 2 0 0 0 2 2h4'), p('M9 15h6'), p('M12 12v6')],
} as const satisfies Record<string, readonly Shape[]>

export type IconName = keyof typeof ICONS

const SVG_NS = 'http://www.w3.org/2000/svg'

export function icon(name: IconName, size = 16): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  const attrs: Record<string, string> = {
    class: 'icon',
    viewBox: '0 0 24 24',
    width: String(size),
    height: String(size),
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  }
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v)
  for (const [tag, shapeAttrs] of ICONS[name]) {
    const node = document.createElementNS(SVG_NS, tag)
    for (const [k, v] of Object.entries(shapeAttrs)) node.setAttribute(k, v)
    svg.append(node)
  }
  return svg
}

/** A fixed string, or a function re-evaluated whenever the UI language changes. */
export type Text = string | (() => string)

export interface IconButtonOptions {
  /** Extra classes after `btn` (e.g. 'ghost', 'small primary'). */
  readonly variant?: string
  /** Visible text next to the icon. Omit for an icon-only button. */
  readonly text?: Text
  /** Shortcut appended to the tooltip: a fixed key ('Esc') or a function (follows rebinding). */
  readonly shortcut?: string | (() => string | undefined)
  readonly attrs?: Readonly<Record<string, string>>
}

const tooltip = (label: string, shortcut?: string): string => (shortcut ? `${label} (${shortcut})` : label)
const resolve = (text: Text | undefined): string | undefined => (typeof text === 'function' ? text() : text)

/**
 * A `.btn` with an icon; icon-only buttons get aria-label + tooltip so they stay accessible.
 * Pass functions for `label` / `text` on long-lived buttons to follow language changes.
 */
export function iconButton(name: IconName, label: Text, options: IconButtonOptions = {}): HTMLButtonElement {
  const { variant = '', text, shortcut, attrs = {} } = options
  const classes = ['btn', text ? 'with-icon' : 'icon-only', ...variant.split(' ').filter(Boolean)].join(' ')
  const button = el('button', { class: classes, type: 'button', ...attrs })
  const render = (): void =>
    setIconButton(button, name, resolve(label) ?? '', resolve(text), typeof shortcut === 'function' ? shortcut() : shortcut)
  if (typeof label === 'function' || typeof text === 'function') localized(render)
  else render()
  // Rebinding a shortcut updates the tooltip too (render() above already ran once).
  if (typeof shortcut === 'function') withShortcuts(render)
  return button
}

/** Swap the icon / label of an existing icon button (for toggles such as theme or width). */
export function setIconButton(button: HTMLButtonElement, name: IconName, label: string, text?: string, shortcut?: string): void {
  const children: Array<Node | string> = [icon(name)]
  if (text) children.push(el('span', { class: 'btn-label' }, text))
  button.replaceChildren(...children)
  button.title = tooltip(label, shortcut)
  if (text) button.removeAttribute('aria-label')
  else button.setAttribute('aria-label', label)
}
