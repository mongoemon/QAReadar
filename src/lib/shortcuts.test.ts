import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SHORTCUTS,
  checkCombo,
  comboFromEvent,
  conflictsWith,
  detectPlatform,
  formatCombo,
  keyName,
  normalizeCombo,
  parseOverrides,
  resolveDefault,
  scopeOf,
  type KeyLike,
  type Platform,
} from './shortcuts'

const key = (code: string, mods: Partial<KeyLike> = {}, k = ''): KeyLike => ({
  code,
  key: k,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
})

describe('keyName', () => {
  it('uses the physical key, whatever the layout types', () => {
    expect(keyName('KeyN', '˜')).toBe('N') // macOS Option+N
    expect(keyName('KeyD', 'ก')).toBe('D') // Thai layout
    expect(keyName('Digit1', '¡')).toBe('1')
    expect(keyName('Numpad5', '5')).toBe('5')
    expect(keyName('Period', '.')).toBe('.')
    expect(keyName('ArrowUp', 'ArrowUp')).toBe('Up')
    expect(keyName('F7', 'F7')).toBe('F7')
  })

  it('ignores bare modifiers', () => {
    for (const code of ['ShiftLeft', 'ControlRight', 'AltLeft', 'MetaLeft', 'CapsLock']) expect(keyName(code, '')).toBeNull()
  })

  it('falls back to the character when there is no code', () => {
    expect(keyName('', 'k')).toBe('K')
    expect(keyName('', 'Unidentified')).toBeNull()
  })
})

describe('comboFromEvent', () => {
  it('orders modifiers canonically', () => {
    expect(comboFromEvent(key('KeyS', { shiftKey: true, ctrlKey: true }))).toBe('Ctrl+Shift+S')
    expect(comboFromEvent(key('KeyF', { metaKey: true, altKey: true }))).toBe('Alt+Meta+F')
  })

  it('returns null while only a modifier is down', () => {
    expect(comboFromEvent(key('ShiftLeft', { shiftKey: true }))).toBeNull()
  })
})

describe('normalizeCombo / formatCombo', () => {
  it('maps Mod to ⌘ on a Mac and Ctrl elsewhere', () => {
    expect(normalizeCombo('Mod+Shift+S', 'mac')).toBe('Shift+Meta+S')
    expect(normalizeCombo('Mod+Shift+S', 'other')).toBe('Ctrl+Shift+S')
  })

  it('shows Mac symbols in Apple order, words with + elsewhere', () => {
    expect(formatCombo('Alt+Shift+Meta+S', 'mac')).toBe('⌥⇧⌘S')
    expect(formatCombo('Ctrl+Alt+Shift+S', 'other')).toBe('Ctrl+Alt+Shift+S')
    expect(formatCombo('Alt+Up', 'mac')).toBe('⌥↑')
    expect(formatCombo('Meta+K', 'other')).toBe('Win+K')
    expect(formatCombo('Alt+PageDown', 'other')).toBe('Alt+PgDn')
  })
})

describe('checkCombo', () => {
  it('refuses keys that would break typing', () => {
    expect(checkCombo('A', 'other')).toBe('modifier')
    expect(checkCombo('Shift+A', 'mac')).toBe('modifier')
    expect(checkCombo('Esc', 'other')).toBe('esc')
  })

  it('allows modifier combos and function keys', () => {
    expect(checkCombo('Ctrl+Shift+S', 'other')).toBeNull()
    expect(checkCombo('F7', 'other')).toBeNull()
    expect(checkCombo('Shift+F7', 'mac')).toBeNull()
  })

  it('refuses combos the browser keeps', () => {
    expect(checkCombo('Ctrl+T', 'other')).toBe('reserved')
    expect(checkCombo('Meta+H', 'mac')).toBe('reserved')
    expect(checkCombo('F5', 'other')).toBe('reserved')
    // Ctrl+W is only reserved where Ctrl is the browser's modifier.
    expect(checkCombo('Ctrl+W', 'mac')).toBeNull()
  })
})

describe('detectPlatform', () => {
  it('recognises Apple devices', () => {
    expect(detectPlatform({ platform: 'MacIntel' })).toBe('mac')
    expect(detectPlatform({ userAgentData: { platform: 'macOS' } })).toBe('mac')
    expect(detectPlatform({ platform: 'Win32' })).toBe('other')
    expect(detectPlatform(undefined)).toBe('other')
  })
})

describe('scopes and conflicts', () => {
  it('derives the scope from the id prefix', () => {
    expect(scopeOf('md.find')).toBe('markdown')
    expect(scopeOf('merge.next')).toBe('merge')
    expect(scopeOf('file.save')).toBe('global')
  })

  it('reports clashes only where both would fire', () => {
    const combos: Record<string, string> = { 'md.find': 'Ctrl+F', 'text.find': 'Ctrl+F', 'file.save': 'Ctrl+S' }
    const ids = Object.keys(combos)
    const of = (id: string): string | null => combos[id] ?? null
    expect(conflictsWith('json.search', 'Ctrl+F', ids, of)).toEqual([])
    expect(conflictsWith('file.open', 'Ctrl+F', ids, of)).toEqual(['md.find', 'text.find'])
    expect(conflictsWith('md.save', 'Ctrl+S', ids, of)).toEqual(['file.save'])
  })

  it.each<Platform>(['mac', 'other'])('ships conflict-free, bindable defaults on %s', (platform) => {
    const ids = Object.keys(DEFAULT_SHORTCUTS)
    const of = (id: string): string | null => resolveDefault(DEFAULT_SHORTCUTS[id], platform)
    for (const id of ids) {
      const combo = of(id)
      expect(combo, id).not.toBeNull()
      expect(checkCombo(combo as string, platform), `${id} → ${combo}`).toBeNull()
      expect(conflictsWith(id, combo as string, ids, of), `${id} → ${combo}`).toEqual([])
    }
  })
})

describe('parseOverrides', () => {
  it('keeps combos and explicit unbinds, drops junk', () => {
    expect(parseOverrides('{"file.save":"Ctrl+Alt+S","md.print":null,"x":3,"y":""}')).toEqual({
      'file.save': 'Ctrl+Alt+S',
      'md.print': null,
    })
    expect(parseOverrides('nope')).toEqual({})
    expect(parseOverrides('[1]')).toEqual({})
    expect(parseOverrides(null)).toEqual({})
  })
})
