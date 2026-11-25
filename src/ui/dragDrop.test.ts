import { beforeEach, describe, expect, it, vi } from 'vitest'
import { attachFileDrop } from './dragDrop'
import { installDom } from './testDom'

let dom: ReturnType<typeof installDom>

beforeEach(() => {
  dom = installDom()
})

function setup() {
  const opened: string[] = []
  const pending: Array<Promise<void>> = []
  attachFileDrop(dom.window as unknown as Window, {
    run: (action) => void pending.push(action()),
    open: (file) => void opened.push(`${file.name}:${file.text}`),
  })
  const drop = async (type: string, transfer: object) => {
    const event = Object.assign(new dom.window.Event(type, { cancelable: true }), { dataTransfer: transfer })
    const prevented = vi.spyOn(event, 'preventDefault')
    ;(dom.window as unknown as EventTarget).dispatchEvent(event)
    await Promise.all(pending)
    return prevented
  }
  return { opened, drop }
}

const files = (...items: Array<[string, string]>) => ({
  types: ['Files'],
  dropEffect: 'none',
  items: items.map(([name, text]) => ({ getAsFile: () => new File([text], name) })),
})

describe('file drag and drop', () => {
  it('opens every dropped file in order', async () => {
    const { opened, drop } = setup()
    const prevented = await drop('drop', files(['a.md', '1'], ['b.txt', '2']))
    expect(opened).toEqual(['a.md:1', 'b.txt:2'])
    expect(prevented).toHaveBeenCalled()
  })

  it('offers to copy while files are dragged over', async () => {
    const { drop } = setup()
    const transfer = files()
    await drop('dragover', transfer)
    expect(transfer.dropEffect).toBe('copy')
  })

  it('ignores a text drag, but never lets the browser navigate', async () => {
    const { opened, drop } = setup()
    const prevented = await drop('drop', { types: ['text/plain'], items: [] })
    expect(opened).toEqual([])
    expect(prevented).toHaveBeenCalled()
  })
})
