import { describe, expect, it } from 'vitest'
import { locateJsonError } from './jsonError'

describe('locateJsonError', () => {
  it('uses line and column from the engine message when present', () => {
    const loc = locateJsonError('{\n  "a": }', 'Unexpected token } (line 2 column 8)')
    expect(loc).toMatchObject({ line: 2, col: 8 })
    expect(loc?.offset).toBe(9)
  })

  it('derives line and column from a position offset', () => {
    const text = '{\n  "a": }'
    const loc = locateJsonError(text, 'Unexpected token } in JSON at position 9')
    expect(loc).toEqual({ offset: 9, line: 2, col: 8 })
  })

  it('returns null when no location can be found', () => {
    expect(locateJsonError('{}', 'something odd')).toBeNull()
  })

  it('clamps offsets past the end of the text', () => {
    const loc = locateJsonError('{"a":', 'Unexpected end of JSON input at position 99')
    expect(loc?.offset).toBe(5)
  })

  it('locates real JSON.parse failures', () => {
    const text = '{"a": 1,\n "b": }'
    let message = ''
    try {
      JSON.parse(text)
    } catch (e) {
      message = (e as Error).message
    }
    const loc = locateJsonError(text, message)
    expect(loc).not.toBeNull()
    expect(loc!.line).toBe(2)
  })
})
