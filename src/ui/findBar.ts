import {
  findMatches,
  replaceAll,
  replacementFor,
  replaceMatch,
  type FindOptions,
  type Match,
} from '../lib/findReplace'
import { localized, t } from '../lib/i18n'
import { el } from './dom'
import { iconButton } from './icons'

export interface FindHost {
  getText(): string
  setText(text: string): void
  /** True when exact match offsets can be selected (markdown source mode). */
  canSelect(): boolean
  select(start: number, end: number): void
  /** Fallback for rendered view: highlight the next hit in the page. */
  findInView(query: string, options: FindOptions, backwards: boolean): boolean
}

export interface FindBar {
  readonly element: HTMLElement
  open(withReplace: boolean): void
  close(): void
}

function checkbox(label: string): { box: HTMLInputElement; node: HTMLElement } {
  const box = el('input', { type: 'checkbox' })
  return { box, node: el('label', { class: 'find-opt' }, box, label) }
}

export function createFindBar(host: FindHost): FindBar {
  const findInput = el('input', { class: 'find-input', type: 'search' })
  const replaceInput = el('input', { class: 'find-input', type: 'text' })
  const status = el('span', { class: 'find-status', role: 'status' })
  const prev = iconButton('chevronUp', () => t('find.prev'), { variant: 'small ghost', shortcut: 'Shift+Enter' })
  const next = iconButton('chevronDown', () => t('find.next'), { variant: 'small ghost', shortcut: 'Enter' })
  const replaceOne = iconButton('replace', () => t('find.replaceOneTip'), { variant: 'small', text: () => t('find.replaceOne') })
  const replaceEvery = iconButton('replaceAll', () => t('find.replaceAllTip'), { variant: 'small', text: () => t('find.replaceAll') })
  const closeBtn = iconButton('close', () => t('find.close'), { variant: 'small ghost', shortcut: 'Esc' })
  const caseOpt = checkbox('Aa')
  const regexOpt = checkbox('.*')
  localized(() => {
    findInput.setAttribute('aria-label', t('find.aria'))
    findInput.placeholder = t('find.placeholder')
    replaceInput.setAttribute('aria-label', t('find.replaceAria'))
    replaceInput.placeholder = t('find.replacePlaceholder')
    caseOpt.box.title = t('find.case')
    regexOpt.box.title = t('find.regex')
  })

  const replaceRow = el('div', { class: 'find-row' }, replaceInput, replaceOne, replaceEvery)
  const element = el(
    'div',
    { class: 'findbar', role: 'search' },
    el('div', { class: 'find-row' }, findInput, prev, next, caseOpt.node, regexOpt.node, status, closeBtn),
    replaceRow,
  )
  element.hidden = true

  let current = -1

  const options = (): FindOptions => ({ caseSensitive: caseOpt.box.checked, regex: regexOpt.box.checked })

  function matches(): readonly Match[] | null {
    const result = findMatches(host.getText(), findInput.value, options())
    if (!result.ok) {
      status.textContent = result.error
      return null
    }
    return result.matches
  }

  function step(direction: 1 | -1): void {
    if (findInput.value === '') {
      status.textContent = ''
      return
    }
    if (!host.canSelect()) {
      const found = host.findInView(findInput.value, options(), direction === -1)
      status.textContent = found ? '' : t('find.none')
      return
    }
    const list = matches()
    if (list === null) return
    if (list.length === 0) {
      current = -1
      status.textContent = t('find.none')
      return
    }
    current = (current + direction + list.length) % list.length
    host.select(list[current].start, list[current].end)
    status.textContent = `${current + 1} / ${list.length}`
  }

  function doReplaceOne(): void {
    if (!host.canSelect()) {
      status.textContent = t('find.sourceOnly')
      return
    }
    const list = matches()
    if (list === null || list.length === 0) return
    const index = current >= 0 && current < list.length ? current : 0
    const text = host.getText()
    const hit = list[index]
    const replacement = replacementFor(text, hit, findInput.value, replaceInput.value, options())
    host.setText(replaceMatch(text, hit, replacement))
    current = index - 1
    step(1)
  }

  function doReplaceAll(): void {
    const result = replaceAll(host.getText(), findInput.value, replaceInput.value, options())
    if (result.count > 0) host.setText(result.text)
    status.textContent = result.count > 0 ? t('find.replaced', { n: result.count }) : t('find.none')
    current = -1
  }

  findInput.addEventListener('input', () => {
    current = -1
    status.textContent = ''
  })
  findInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault()
      step(ev.shiftKey ? -1 : 1)
    }
  })
  element.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.stopPropagation()
      close()
    }
  })
  prev.addEventListener('click', () => step(-1))
  next.addEventListener('click', () => step(1))
  replaceOne.addEventListener('click', doReplaceOne)
  replaceEvery.addEventListener('click', doReplaceAll)
  closeBtn.addEventListener('click', () => close())

  function open(withReplace: boolean): void {
    element.hidden = false
    replaceRow.hidden = !withReplace
    findInput.focus()
    findInput.select()
  }

  function close(): void {
    element.hidden = true
    status.textContent = ''
    current = -1
  }

  return { element, open, close }
}
