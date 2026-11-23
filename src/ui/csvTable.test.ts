import { parseHTML } from 'linkedom'
import { beforeAll, describe, expect, it } from 'vitest'

// The view builds real DOM nodes: give it a document before importing it.
beforeAll(() => {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>')
  Object.assign(globalThis, { window, document })
})

const CSV =
  'id,name,amount,note\n101,Nok,1200.50,"VIP, ลูกค้าประจำ"\n102,Ton,980,\n103,Mali,15,"say ""hi"""\n104,Short\n'

async function setup(text = CSV) {
  const { createCsvView } = await import('./csvTable')
  const doc = { text, revealed: 0 }
  const view = createCsvView({
    getText: () => doc.text,
    getFileName: () => 'users.csv',
    replace(start, end, insert) {
      doc.text = doc.text.slice(0, start) + insert + doc.text.slice(end)
    },
    revealLine(line) {
      doc.revealed = line
    },
  })
  document.body.replaceChildren(view.controls, view.element)
  view.render()
  return { view, doc }
}

/** linkedom has no MouseEvent / KeyboardEvent constructors: a bubbling Event with `key` is enough. */
const fire = (type: string, key?: string): Event =>
  Object.assign(new window.Event(type, { bubbles: true, cancelable: true }), key ? { key } : {})

const bodyRows = (): string[][] =>
  [...document.querySelectorAll('.csv-table tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent ?? ''))

describe('CSV table view', () => {
  it('renders header, rows with source line numbers, and flags short rows', async () => {
    const { view } = await setup()
    const head = [...document.querySelectorAll('.csv-table thead .csv-name')].map((c) => c.textContent)
    expect(head).toEqual(['id', 'name', 'amount', 'note'])
    expect(bodyRows()).toEqual([
      ['2', '101', 'Nok', '1200.50', 'VIP, ลูกค้าประจำ'],
      ['3', '102', 'Ton', '980', ''],
      ['4', '103', 'Mali', '15', 'say "hi"'],
      ['5', '104', 'Short', '', ''],
    ])
    expect(document.querySelectorAll('tr.csv-bad')).toHaveLength(1)
    expect(document.querySelectorAll('td.csv-num')).toHaveLength(7)
    expect(view.summary()).toBe('4 rows × 4 columns · delimiter ,')
  })

  it('sorts by a column without touching the text', async () => {
    const { doc } = await setup()
    const sortAmount = document.querySelector<HTMLElement>('[data-sort="2"]')!
    sortAmount.dispatchEvent(fire('click'))
    expect(bodyRows().map((r) => r[3])).toEqual(['', '15', '980', '1200.50'])
    expect(doc.text).toBe(CSV)
  })

  it('writes a cell edit back to exactly that field, quoting when needed', async () => {
    const { doc } = await setup()
    const cell = document.querySelector<HTMLElement>('td[data-r="2"][data-c="3"]')!
    cell.dispatchEvent(fire('dblclick'))
    const box = document.querySelector<HTMLTextAreaElement>('.csv-edit')!
    expect(box.value).toBe('')
    box.value = 'a, b'
    box.dispatchEvent(fire('keydown', 'Enter'))
    expect(doc.text).toBe(CSV.replace('102,Ton,980,\n', '102,Ton,980,"a, b"\n'))
  })

  it('pads a short row when a missing cell is filled', async () => {
    const { doc } = await setup()
    const cell = document.querySelector<HTMLElement>('td[data-r="4"][data-c="3"]')!
    cell.dispatchEvent(fire('dblclick'))
    const box = document.querySelector<HTMLTextAreaElement>('.csv-edit')!
    box.value = 'new'
    box.dispatchEvent(fire('keydown', 'Enter'))
    expect(doc.text.endsWith('104,Short,,new\n')).toBe(true)
  })

  it('double-clicking a line number reveals it in the text', async () => {
    const { doc } = await setup()
    document.querySelector<HTMLElement>('th[data-line="4"]')!.dispatchEvent(fire('dblclick'))
    expect(doc.revealed).toBe(4)
  })
})
