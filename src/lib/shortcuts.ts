import { readStored, writeStored } from './safeStorage'

/**
 * Customisable keyboard shortcuts.
 *
 * A combo is a canonical string: modifiers in the order Ctrl, Alt, Shift, Meta, then the key —
 * e.g. `Ctrl+Shift+S`, `Meta+K`, `Alt+1`, `F7`. Keys come from `KeyboardEvent.code` (the physical
 * key), so shortcuts keep working on a Thai layout and with macOS Option+letter (which types a
 * symbol). Defaults are written with `Mod`, which means ⌘ on a Mac and Ctrl everywhere else.
 */

export type Platform = 'mac' | 'other'

export interface KeyLike {
  readonly code: string
  readonly key: string
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
  readonly metaKey: boolean
}

const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const
type Modifier = (typeof MODIFIERS)[number]

const NAMED_CODES: Readonly<Record<string, string>> = {
  Period: '.', Comma: ',', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'", Backquote: '`',
  BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', NumpadSubtract: '-', NumpadAdd: '=',
  NumpadDecimal: '.', NumpadDivide: '/', NumpadMultiply: '*',
  Enter: 'Enter', NumpadEnter: 'Enter', Space: 'Space', Tab: 'Tab', Backspace: 'Backspace',
  Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc',
}

const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$|^(CapsLock|Fn|FnLock|ContextMenu)$/

/** The physical key's name, or null for a bare modifier / unknown key. */
export function keyName(code: string, key: string): string | null {
  if (MODIFIER_CODES.test(code)) return null
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return letter[1]
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(code)
  if (digit) return digit[1]
  if (/^F\d{1,2}$/.test(code)) return code
  if (code in NAMED_CODES) return NAMED_CODES[code]
  // No usable code (some virtual keyboards): fall back to a single printable character.
  if (code === '' && key.length === 1 && key.trim() !== '' && key !== '+') return key.toUpperCase()
  return null
}

export function comboFromEvent(ev: KeyLike): string | null {
  const name = keyName(ev.code, ev.key)
  if (!name) return null
  const held: Record<Modifier, boolean> = { Ctrl: ev.ctrlKey, Alt: ev.altKey, Shift: ev.shiftKey, Meta: ev.metaKey }
  return [...MODIFIERS.filter((m) => held[m]), name].join('+')
}

/** Split a combo into modifiers and key (key names never contain `+`; plus is `=`). */
function splitCombo(combo: string): { mods: Set<string>; key: string } {
  const parts = combo.split('+')
  return { mods: new Set(parts.slice(0, -1)), key: parts[parts.length - 1] }
}

/** Resolve `Mod` for the platform and put modifiers in canonical order. */
export function normalizeCombo(combo: string, platform: Platform): string {
  const { mods, key } = splitCombo(combo)
  if (mods.delete('Mod')) mods.add(platform === 'mac' ? 'Meta' : 'Ctrl')
  return [...MODIFIERS.filter((m) => mods.has(m)), key].join('+')
}

// Same order as MODIFIERS, which is also Apple's ⌃⌥⇧⌘ order.
const MAC_SYMBOLS: Readonly<Record<Modifier, string>> = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' }
const MAC_KEYS: Readonly<Record<string, string>> = {
  Up: '↑', Down: '↓', Left: '←', Right: '→', Enter: '↩', Backspace: '⌫', Delete: '⌦', Esc: '⎋', Tab: '⇥',
  PageUp: 'PgUp', PageDown: 'PgDn',
}
const OTHER_KEYS: Readonly<Record<string, string>> = { Up: '↑', Down: '↓', Left: '←', Right: '→', PageUp: 'PgUp', PageDown: 'PgDn' }
const OTHER_MODS: Readonly<Record<Modifier, string>> = { Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Win' }

/** How a combo is shown: `⌥⇧⌘S` on a Mac, `Ctrl+Alt+Shift+S` on Windows / Linux. */
export function formatCombo(combo: string, platform: Platform): string {
  const { mods, key } = splitCombo(combo)
  const held = MODIFIERS.filter((m) => mods.has(m))
  if (platform === 'mac') return held.map((m) => MAC_SYMBOLS[m]).join('') + (MAC_KEYS[key] ?? key)
  return [...held.map((m) => OTHER_MODS[m]), OTHER_KEYS[key] ?? key].join('+')
}

/** Combos the browser or OS keeps for itself: a web page never receives them. */
const RESERVED: Readonly<Record<Platform, readonly string[]>> = {
  other: [
    'Ctrl+T', 'Ctrl+W', 'Ctrl+N', 'Ctrl+Tab', 'Ctrl+Shift+T', 'Ctrl+Shift+N', 'Ctrl+Shift+W', 'Ctrl+Shift+Tab',
    'Ctrl+F4', 'Alt+F4', 'Ctrl+Esc', 'Alt+Tab',
  ],
  mac: [
    'Meta+T', 'Meta+W', 'Meta+N', 'Meta+Q', 'Meta+H', 'Meta+M', 'Meta+Tab', 'Meta+Space', 'Meta+`',
    'Shift+Meta+T', 'Shift+Meta+N', 'Shift+Meta+W', 'Alt+Meta+H', 'Ctrl+Meta+Q', 'Ctrl+Meta+F',
  ],
}
/** Keys that stay with the browser even on their own (reload, full screen, dev tools). */
const RESERVED_KEYS = new Set(['F5', 'F11', 'F12'])

export type ComboProblem = 'modifier' | 'reserved' | 'esc'

/**
 * Whether a combo can be bound. Plain keys (with or without Shift) are refused — they would
 * break typing — except function keys. Esc stays the universal "cancel / close".
 */
export function checkCombo(combo: string, platform: Platform): ComboProblem | null {
  const { mods, key } = splitCombo(combo)
  if (key === 'Esc') return 'esc'
  if (RESERVED[platform].includes(combo) || (mods.size === 0 && RESERVED_KEYS.has(key))) return 'reserved'
  const fnKey = /^F\d{1,2}$/.test(key)
  const strong = mods.has('Ctrl') || mods.has('Alt') || mods.has('Meta')
  return strong || fnKey ? null : 'modifier'
}

export function detectPlatform(nav: { platform?: string; userAgentData?: { platform?: string } } | undefined): Platform {
  const name = nav?.userAgentData?.platform || nav?.platform || ''
  return /mac|iphone|ipad|ipod/i.test(name) ? 'mac' : 'other'
}

// ── defaults ──────────────────────────────────────────────────────────────

/** A default combo, or one per platform where the usual one is taken (⌘H hides the app on a Mac). */
export type DefaultSpec = string | { readonly mac: string; readonly other: string }

/** Command ids (as used by the command palette) → default shortcut. */
export const DEFAULT_SHORTCUTS: Readonly<Record<string, DefaultSpec>> = {
  // general
  'file.open': 'Mod+O',
  'file.save': 'Mod+S',
  'file.saveas': 'Mod+Shift+S',
  'file.recent': 'Alt+R',
  'file.samples': 'Alt+S',
  'view.palette': 'Mod+K',
  'view.focus': 'Mod+.',
  'view.theme': 'Alt+T',
  'view.lang': 'Alt+L',
  'help.shortcuts': 'Mod+/',
  'tab.markdown': 'Alt+1',
  'tab.text': 'Alt+2',
  'tab.json': 'Alt+3',
  'tab.locator': 'Alt+4',
  'tab.merge': 'Alt+5',
  'tab.next': 'Alt+PageDown',
  'tab.prev': 'Alt+PageUp',
  // Markdown
  'md.new': 'Alt+N',
  'md.close': 'Alt+W',
  'md.duplicate': 'Alt+D',
  'md.nextDoc': 'Alt+]',
  'md.prevDoc': 'Alt+[',
  'md.find': 'Mod+F',
  'md.replace': { mac: 'Mod+Alt+F', other: 'Mod+H' },
  'md.clean': 'Alt+E',
  'md.outline': 'Alt+O',
  'md.bigger': 'Alt+=',
  'md.smaller': 'Alt+-',
  'md.refresh': 'Alt+Shift+R',
  'md.export': 'Mod+Shift+E',
  'md.print': 'Mod+P',
  // Text
  'text.new': 'Alt+N',
  'text.close': 'Alt+W',
  'text.duplicateDoc': 'Alt+D',
  'text.nextDoc': 'Alt+]',
  'text.prevDoc': 'Alt+[',
  'text.find': 'Mod+F',
  'text.replace': { mac: 'Mod+Alt+F', other: 'Mod+H' },
  'text.goto': 'Mod+G',
  'text.duplicate': 'Mod+D',
  'text.table': 'Alt+V',
  'text.wrap': 'Alt+Z',
  // JSON Path
  'json.search': 'Mod+F',
  'json.format': 'Alt+Shift+F',
  'json.minify': 'Alt+Shift+M',
  'json.copyvalue': 'Alt+Shift+C',
  // Locator
  'locator.parent': 'Alt+P',
  // Diff & Merge
  'merge.next': 'F7',
  'merge.prev': 'Shift+F7',
  'merge.left': 'Alt+Shift+1',
  'merge.right': 'Alt+Shift+2',
  'merge.both': 'Alt+Shift+3',
  'merge.none': 'Alt+Shift+4',
  'merge.swap': 'Alt+Shift+X',
}

export function resolveDefault(spec: DefaultSpec | undefined, platform: Platform): string | null {
  if (spec === undefined) return null
  return normalizeCombo(typeof spec === 'string' ? spec : spec[platform], platform)
}

/** Which tab a command belongs to (from its id prefix); everything else is global. */
const SCOPE_PREFIXES: Readonly<Record<string, string>> = { md: 'markdown', text: 'text', json: 'json', locator: 'locator', merge: 'merge' }

export function scopeOf(id: string): string {
  return SCOPE_PREFIXES[id.split('.')[0]] ?? 'global'
}

/** A tab's own shortcut and a global one clash; two different tabs never do. */
const overlaps = (a: string, b: string): boolean => a === b || a === 'global' || b === 'global'

/** Other commands among `ids` that already answer to `combo` where `id` would. */
export function conflictsWith(
  id: string,
  combo: string,
  ids: readonly string[],
  comboOf: (id: string) => string | null,
): string[] {
  const scope = scopeOf(id)
  return ids.filter((other) => other !== id && comboOf(other) === combo && overlaps(scope, scopeOf(other)))
}

/** Stored user changes: id → combo, or null for "no shortcut". Malformed entries are dropped. */
export function parseOverrides(raw: string | null): Record<string, string | null> {
  if (raw === null) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const out: Record<string, string | null> = {}
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value === null || (typeof value === 'string' && value !== '')) out[id] = value
  }
  return out
}

// ── store ─────────────────────────────────────────────────────────────────

const STORE_KEY = 'mdreadar:shortcuts'

export const PLATFORM: Platform = detectPlatform(typeof navigator === 'undefined' ? undefined : navigator)

let overrides: Record<string, string | null> = parseOverrides(readStored(STORE_KEY))
const listeners = new Set<() => void>()

function commit(next: Record<string, string | null>): void {
  overrides = next
  writeStored(STORE_KEY, Object.keys(overrides).length === 0 ? null : JSON.stringify(overrides))
  for (const listener of [...listeners]) listener()
}

function without(id: string): Record<string, string | null> {
  const rest = { ...overrides }
  delete rest[id]
  return rest
}

export const defaultCombo = (id: string): string | null => resolveDefault(DEFAULT_SHORTCUTS[id], PLATFORM)

export function comboFor(id: string): string | null {
  return Object.prototype.hasOwnProperty.call(overrides, id) ? overrides[id] : defaultCombo(id)
}

export const isCustomized = (id: string): boolean => Object.prototype.hasOwnProperty.call(overrides, id)

/** Bind (or, with null, unbind) a command. Setting the default back drops the override. */
export function setCombo(id: string, combo: string | null): void {
  commit(combo === defaultCombo(id) ? without(id) : { ...without(id), [id]: combo })
}

export function resetCombo(id: string): void {
  if (isCustomized(id)) commit(without(id))
}

export function resetAllCombos(): void {
  commit({})
}

export const hasCustomCombos = (): boolean => Object.keys(overrides).length > 0

/** The shortcut as this machine shows it, or undefined when the command has none. */
export function shortcutLabel(id: string): string | undefined {
  const combo = comboFor(id)
  return combo ? formatCombo(combo, PLATFORM) : undefined
}

/** Run `update` now and after every change to the shortcuts. For long-lived UI only. */
/** The shortcut for `id` as shown to the user, or a dash when it has none (for hint text). */
export const keyHint = (id: string): string => shortcutLabel(id) ?? '—'

/** The Alt / Option key as this platform names it (for "Alt+drag" style hints). */
export const ALT_LABEL = PLATFORM === 'mac' ? '⌥' : 'Alt'

export function withShortcuts(update: () => void): () => void {
  update()
  listeners.add(update)
  return () => listeners.delete(update)
}
