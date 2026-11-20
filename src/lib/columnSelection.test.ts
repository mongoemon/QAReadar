import { describe, expect, it } from 'vitest'
import {
  blockHeight,
  blockText,
  deleteAtCaret,
  indexToVisual,
  pasteRows,
  replaceBlock,
  visualToIndex,
  type Block,
} from './columnSelection'

const block = (anchorLine: number, anchorCol: number, headLine: number, headCol: number): Block => ({
  anchorLine,
  anchorCol,
  headLine,
  headCol,
})

const TEXT = 'id,name\n01,alice\n02,bob\n03,carol'

describe('visual columns', () => {
  it('expands tabs to tab stops', () => {
    expect(indexToVisual('a\tb', 2, 4)).toBe(4)
    expect(visualToIndex('a\tb', 4, 4)).toEqual({ index: 2, overflow: 0 })
    expect(visualToIndex('a\tb', 2, 4)).toEqual({ index: 1, overflow: 0 })
    expect(visualToIndex('a\tb', 3, 4)).toEqual({ index: 2, overflow: 0 })
  })

  it('reports columns past the end of the line', () => {
    expect(visualToIndex('ab', 5, 4)).toEqual({ index: 2, overflow: 3 })
  })

  it('gives combining marks no width and keeps them with their base letter', () => {
    // "กี่" = ก + ี + ่ : one visible column
    expect(indexToVisual('กี่x', 3, 4)).toBe(1)
    expect(visualToIndex('กี่x', 1, 4)).toEqual({ index: 3, overflow: 0 })
  })
})

describe('blockText', () => {
  it('copies a rectangle, whichever corner the drag started from', () => {
    expect(blockText(TEXT, block(1, 0, 3, 2), 4)).toBe('01\n02\n03')
    expect(blockText(TEXT, block(3, 2, 1, 0), 4)).toBe('01\n02\n03')
  })

  it('clips short lines', () => {
    expect(blockText(TEXT, block(1, 3, 3, 8), 4)).toBe('alice\nbob\ncarol')
  })
})

describe('replaceBlock', () => {
  it('deletes the rectangle and leaves a caret column', () => {
    const edit = replaceBlock(TEXT, block(1, 0, 3, 3), '', 4)
    expect(edit.text).toBe('id,name\nalice\nbob\ncarol')
    expect(edit.block).toEqual(block(1, 0, 3, 0))
  })

  it('types on every line of a zero-width block', () => {
    const edit = replaceBlock(TEXT, block(1, 0, 3, 0), '#', 4)
    expect(edit.text).toBe('id,name\n#01,alice\n#02,bob\n#03,carol')
    expect(edit.block).toEqual(block(1, 1, 3, 1))
  })

  it('pads short lines with spaces when inserting past their end', () => {
    const edit = replaceBlock('abcdef\nab\nabcdef', block(0, 4, 2, 4), '|', 4)
    expect(edit.text).toBe('abcd|ef\nab  |\nabcd|ef')
  })

  it('pastes one row per line', () => {
    const edit = replaceBlock(TEXT, block(1, 0, 3, 2), ['A', 'B', 'C'], 4)
    expect(edit.text).toBe('id,name\nA,alice\nB,bob\nC,carol')
  })

  it('describes the minimal changed range of the old text', () => {
    const edit = replaceBlock(TEXT, block(1, 0, 2, 2), 'X', 4)
    expect(TEXT.slice(0, edit.from) + edit.insert + TEXT.slice(edit.to)).toBe(edit.text)
  })
})

describe('deleteAtCaret', () => {
  it('backspaces on every line', () => {
    const edit = deleteAtCaret(TEXT, block(1, 2, 3, 2), false, 4)
    expect(edit.text).toBe('id,name\n0,alice\n0,bob\n0,carol')
    expect(edit.block).toEqual(block(1, 1, 3, 1))
  })

  it('deletes forward on every line', () => {
    const edit = deleteAtCaret(TEXT, block(1, 2, 3, 2), true, 4)
    expect(edit.text).toBe('id,name\n01alice\n02bob\n03carol')
  })
})

describe('paste helpers', () => {
  it('splits the clipboard into rows', () => {
    expect(pasteRows('x', 3)).toBe('x')
    expect(pasteRows('a\r\nb\r\nc\r\n', 2)).toEqual(['a', 'b'])
    expect(pasteRows('a\nb', 4)).toEqual(['a', 'b'])
  })

  it('counts block height within the text', () => {
    expect(blockHeight(TEXT, block(2, 0, 9, 1))).toBe(2)
  })
})
